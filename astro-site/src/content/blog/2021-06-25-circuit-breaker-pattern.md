---
title: Circuit Breaker Pattern with Polly and Azure
author: Michael John Peña
draft: false
date: 2021-06-25
url: /blog/circuit-breaker-pattern/
tags:
  - Azure
  - Circuit Breaker
  - Resilience
  - Polly

---

I wrote "2021-06-25-circuit-breaker-pattern" to share practical, production-minded guidance on this topic.

## Circuit Breaker States

```
        ┌────────────────────────────────────────────────────┐
        │                                                     │
        │  ┌──────────┐                                      │
        │  │  Closed  │◄──────────────┐                      │
        │  │ (Normal) │               │                      │
        │  └────┬─────┘               │                      │
        │       │                     │                      │
        │  Failure threshold          │ Success in           │
        │  exceeded                   │ half-open state      │
        │       │                     │                      │
        │       ▼                     │                      │
        │  ┌──────────┐          ┌────┴─────┐               │
        │  │   Open   │──Timer──►│Half-Open │               │
        │  │(Failing) │ expires  │ (Testing)│               │
        │  └──────────┘          └────┬─────┘               │
        │       ▲                     │                      │
        │       │                     │                      │
        │       └─────────────────────┘                      │
        │         Failure in half-open state                 │
        └────────────────────────────────────────────────────┘
```

## Basic Circuit Breaker with Polly

```csharp
public static class CircuitBreakerPolicies
{
    public static IAsyncPolicy<HttpResponseMessage> CreateHttpCircuitBreaker()
    {
        return HttpPolicyExtensions
            .HandleTransientHttpError()  // 5xx and 408
            .OrResult(msg => msg.StatusCode == HttpStatusCode.TooManyRequests)
            .CircuitBreakerAsync(
                handledEventsAllowedBeforeBreaking: 5,
                durationOfBreak: TimeSpan.FromSeconds(30),
                onBreak: (outcome, breakDelay) =>
                {
                    Log.Warning(
                        "Circuit breaker opened for {BreakDelay}s due to {Exception}",
                        breakDelay.TotalSeconds,
                        outcome.Exception?.Message ?? outcome.Result.StatusCode.ToString());
                },
                onReset: () =>
                {
                    Log.Information("Circuit breaker reset");
                },
                onHalfOpen: () =>
                {
                    Log.Information("Circuit breaker half-open, testing...");
                });
    }
}
```

## Advanced Circuit Breaker Configuration

### Combining with Retry and Timeout

```csharp
public static class ResiliencePolicies
{
    public static IAsyncPolicy<HttpResponseMessage> CreateResiliencePolicy()
    {
        // Timeout policy (innermost)
        var timeoutPolicy = Policy.TimeoutAsync<HttpResponseMessage>(
            TimeSpan.FromSeconds(10),
            TimeoutStrategy.Optimistic,
            onTimeoutAsync: (context, timespan, task) =>
            {
                Log.Warning("Request timed out after {Timeout}s", timespan.TotalSeconds);
                return Task.CompletedTask;
            });

        // Retry policy
        var retryPolicy = HttpPolicyExtensions
            .HandleTransientHttpError()
            .Or<TimeoutRejectedException>()
            .WaitAndRetryAsync(
                retryCount: 3,
                sleepDurationProvider: attempt => TimeSpan.FromSeconds(Math.Pow(2, attempt)),
                onRetry: (outcome, timespan, attempt, context) =>
                {
                    Log.Warning(
                        "Retry {Attempt} after {Delay}s",
                        attempt,
                        timespan.TotalSeconds);
                });

        // Circuit breaker policy (outermost)
        var circuitBreakerPolicy = HttpPolicyExtensions
            .HandleTransientHttpError()
            .Or<TimeoutRejectedException>()
            .AdvancedCircuitBreakerAsync(
                failureThreshold: 0.5,  // 50% failure rate
                samplingDuration: TimeSpan.FromSeconds(60),
                minimumThroughput: 10,
                durationOfBreak: TimeSpan.FromSeconds(30),
                onBreak: (outcome, state, breakDelay, context) =>
                {
                    Log.Error(
                        "Circuit OPEN. Failure rate: {FailureRate}%. Breaking for {BreakDelay}s",
                        state.FailureRate * 100,
                        breakDelay.TotalSeconds);
                },
                onReset: context =>
                {
                    Log.Information("Circuit RESET");
                },
                onHalfOpen: () =>
                {
                    Log.Information("Circuit HALF-OPEN");
                });

        // Wrap policies: CircuitBreaker -> Retry -> Timeout
        return Policy.WrapAsync(circuitBreakerPolicy, retryPolicy, timeoutPolicy);
    }
}
```

## Service Registration

### HttpClient with Polly

```csharp
public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddResilientHttpClients(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // Create policies
        var circuitBreakerPolicy = ResiliencePolicies.CreateResiliencePolicy();

        // Register named HTTP clients
        services.AddHttpClient("OrderService", client =>
        {
            client.BaseAddress = new Uri(configuration["Services:Orders:BaseUrl"]);
            client.DefaultRequestHeaders.Add("Accept", "application/json");
        })
        .AddPolicyHandler(circuitBreakerPolicy);

        services.AddHttpClient("PaymentService", client =>
        {
            client.BaseAddress = new Uri(configuration["Services:Payments:BaseUrl"]);
        })
        .AddPolicyHandler(circuitBreakerPolicy);

        // Or use typed clients
        services.AddHttpClient<IInventoryClient, InventoryClient>(client =>
        {
            client.BaseAddress = new Uri(configuration["Services:Inventory:BaseUrl"]);
        })
        .AddPolicyHandler(circuitBreakerPolicy);

        return services;
    }
}
```

## Circuit Breaker Registry

### Sharing Circuit Breakers Across Services

```csharp
public class CircuitBreakerRegistry
{
    private readonly ConcurrentDictionary<string, AsyncCircuitBreakerPolicy> _breakers = new();

    public AsyncCircuitBreakerPolicy GetOrCreate(string name, CircuitBreakerOptions options)
    {
        return _breakers.GetOrAdd(name, _ => CreateCircuitBreaker(name, options));
    }

    private AsyncCircuitBreakerPolicy CreateCircuitBreaker(
        string name,
        CircuitBreakerOptions options)
    {
        return Policy
            .Handle<Exception>()
            .AdvancedCircuitBreakerAsync(
                failureThreshold: options.FailureThreshold,
                samplingDuration: options.SamplingDuration,
                minimumThroughput: options.MinimumThroughput,
                durationOfBreak: options.BreakDuration,
                onBreak: (exception, state, breakDuration, context) =>
                {
                    Log.Error(
                        "Circuit {Name} OPEN: {Exception}. Breaking for {Duration}s",
                        name,
                        exception.Message,
                        breakDuration.TotalSeconds);
                },
                onReset: context =>
                {
                    Log.Information("Circuit {Name} RESET", name);
                },
                onHalfOpen: () =>
                {
                    Log.Information("Circuit {Name} HALF-OPEN", name);
                });
    }

    public CircuitState GetState(string name)
    {
        return _breakers.TryGetValue(name, out var breaker)
            ? breaker.CircuitState
            : CircuitState.Closed;
    }

    public void Isolate(string name)
    {
        if (_breakers.TryGetValue(name, out var breaker))
        {
            breaker.Isolate();
            Log.Warning("Circuit {Name} manually ISOLATED", name);
        }
    }

    public void Reset(string name)
    {
        if (_breakers.TryGetValue(name, out var breaker))
        {
            breaker.Reset();
            Log.Information("Circuit {Name} manually RESET", name);
        }
    }
}

public record CircuitBreakerOptions
{
    public double FailureThreshold { get; init; } = 0.5;
    public TimeSpan SamplingDuration { get; init; } = TimeSpan.FromSeconds(60);
    public int MinimumThroughput { get; init; } = 10;
    public TimeSpan BreakDuration { get; init; } = TimeSpan.FromSeconds(30);
}
```

## Fallback Strategies

### Implementing Fallbacks

```csharp
public class ResilientOrderService
{
    private readonly HttpClient _httpClient;
    private readonly IAsyncPolicy<HttpResponseMessage> _resiliencePolicy;
    private readonly IAsyncPolicy<HttpResponseMessage> _fallbackPolicy;
    private readonly ICache _cache;

    public ResilientOrderService(
        HttpClient httpClient,
        ICache cache)
    {
        _httpClient = httpClient;
        _cache = cache;

        _resiliencePolicy = ResiliencePolicies.CreateResiliencePolicy();

        _fallbackPolicy = Policy<HttpResponseMessage>
            .Handle<BrokenCircuitException>()
            .Or<HttpRequestException>()
            .FallbackAsync(
                fallbackAction: async (context, cancellationToken) =>
                {
                    // Return cached data or default response
                    var cachedData = await _cache.GetAsync<OrderResponse>("last-orders");
                    if (cachedData != null)
                    {
                        return new HttpResponseMessage(HttpStatusCode.OK)
                        {
                            Content = JsonContent.Create(cachedData)
                        };
                    }

                    return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
                    {
                        Content = new StringContent("Service temporarily unavailable")
                    };
                },
                onFallbackAsync: (result, context) =>
                {
                    Log.Warning("Fallback activated due to {Exception}", result.Exception?.Message);
                    return Task.CompletedTask;
                });
    }

    public async Task<OrderResponse?> GetOrdersAsync()
    {
        var policy = Policy.WrapAsync(_fallbackPolicy, _resiliencePolicy);

        var response = await policy.ExecuteAsync(async () =>
        {
            var result = await _httpClient.GetAsync("/api/orders");
            result.EnsureSuccessStatusCode();
            return result;
        });

        if (response.IsSuccessStatusCode)
        {
            var orders = await response.Content.ReadFromJsonAsync<OrderResponse>();

            // Cache successful response
            await _cache.SetAsync("last-orders", orders, TimeSpan.FromMinutes(5));

            return orders;
        }

        return null;
    }
}
```

## Health Monitoring

### Exposing Circuit Breaker State

```csharp
public class CircuitBreakerHealthCheck : IHealthCheck
{
    private readonly CircuitBreakerRegistry _registry;
    private readonly string[] _criticalCircuits;

    public CircuitBreakerHealthCheck(
        CircuitBreakerRegistry registry,
        IConfiguration configuration)
    {
        _registry = registry;
        _criticalCircuits = configuration
            .GetSection("CircuitBreakers:Critical")
            .Get<string[]>() ?? Array.Empty<string>();
    }

    public Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        var states = _criticalCircuits
            .Select(name => new { Name = name, State = _registry.GetState(name) })
            .ToList();

        var openCircuits = states.Where(s => s.State == CircuitState.Open).ToList();
        var halfOpenCircuits = states.Where(s => s.State == CircuitState.HalfOpen).ToList();

        if (openCircuits.Any())
        {
            return Task.FromResult(HealthCheckResult.Unhealthy(
                $"Circuit breakers open: {string.Join(", ", openCircuits.Select(c => c.Name))}",
                data: states.ToDictionary(s => s.Name, s => (object)s.State.ToString())));
        }

        if (halfOpenCircuits.Any())
        {
            return Task.FromResult(HealthCheckResult.Degraded(
                $"Circuit breakers testing: {string.Join(", ", halfOpenCircuits.Select(c => c.Name))}",
                data: states.ToDictionary(s => s.Name, s => (object)s.State.ToString())));
        }

        return Task.FromResult(HealthCheckResult.Healthy(
            "All circuit breakers closed",
            data: states.ToDictionary(s => s.Name, s => (object)s.State.ToString())));
    }
}

// Registration
services.AddHealthChecks()
    .AddCheck<CircuitBreakerHealthCheck>("circuit-breakers");
```

### Metrics and Telemetry

```csharp
public class TelemetryCircuitBreakerPolicy
{
    private readonly TelemetryClient _telemetryClient;

    public IAsyncPolicy<HttpResponseMessage> CreatePolicy(string serviceName)
    {
        return HttpPolicyExtensions
            .HandleTransientHttpError()
            .AdvancedCircuitBreakerAsync(
                failureThreshold: 0.5,
                samplingDuration: TimeSpan.FromSeconds(60),
                minimumThroughput: 10,
                durationOfBreak: TimeSpan.FromSeconds(30),
                onBreak: (outcome, state, breakDuration, context) =>
                {
                    _telemetryClient.TrackEvent("CircuitBreakerOpened", new Dictionary<string, string>
                    {
                        ["ServiceName"] = serviceName,
                        ["FailureRate"] = (state.FailureRate * 100).ToString("F2"),
                        ["BreakDuration"] = breakDuration.TotalSeconds.ToString()
                    });

                    _telemetryClient.GetMetric("CircuitBreakerState", "ServiceName")
                        .TrackValue(1, serviceName);  // 1 = Open
                },
                onReset: context =>
                {
                    _telemetryClient.TrackEvent("CircuitBreakerReset", new Dictionary<string, string>
                    {
                        ["ServiceName"] = serviceName
                    });

                    _telemetryClient.GetMetric("CircuitBreakerState", "ServiceName")
                        .TrackValue(0, serviceName);  // 0 = Closed
                },
                onHalfOpen: () =>
                {
                    _telemetryClient.GetMetric("CircuitBreakerState", "ServiceName")
                        .TrackValue(0.5, serviceName);  // 0.5 = Half-Open
                });
    }
}
```

## API Endpoint for Manual Control

```csharp
app.MapGet("/api/circuits", (CircuitBreakerRegistry registry) =>
{
    var states = new[] { "OrderService", "PaymentService", "InventoryService" }
        .Select(name => new { Name = name, State = registry.GetState(name).ToString() });

    return Results.Ok(states);
});

app.MapPost("/api/circuits/{name}/isolate", (string name, CircuitBreakerRegistry registry) =>
{
    registry.Isolate(name);
    return Results.Ok(new { Name = name, Action = "Isolated" });
}).RequireAuthorization("Admin");

app.MapPost("/api/circuits/{name}/reset", (string name, CircuitBreakerRegistry registry) =>
{
    registry.Reset(name);
    return Results.Ok(new { Name = name, Action = "Reset" });
}).RequireAuthorization("Admin");
```

## Conclusion

The Circuit Breaker pattern is essential for building resilient microservices. Polly provides a mature implementation with advanced features like sampling-based thresholds. Combined with fallback strategies, health checks, and monitoring, you can build systems that gracefully handle failures and recover automatically.

## References

- [Circuit Breaker Pattern](https://docs.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
- [Polly Documentation](https://github.com/App-vNext/Polly)

