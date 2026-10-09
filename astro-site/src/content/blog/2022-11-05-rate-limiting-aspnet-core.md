---
title: "Rate Limiting Middleware in ASP.NET Core 7"
author: Michael John Peña
draft: false
date: 2022-11-05
tags:
  - ASP.NET Core
  - .NET
  - Security
  - Azure
  - API
---

## Why Rate Limiting?

Rate limiting protects your application by:
- Preventing denial-of-service attacks
- Ensuring fair usage among clients
- Protecting downstream services
- Managing costs in pay-per-request scenarios
- Complying with API usage policies

## Built-in Rate Limiters

ASP.NET Core 7 provides four rate limiting algorithms:

### Fixed Window Limiter

Limits requests in fixed time windows:

```csharp
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRateLimiter(options =>
{
    options.AddFixedWindowLimiter("fixed", limiterOptions =>
    {
        limiterOptions.PermitLimit = 100;
        limiterOptions.Window = TimeSpan.FromMinutes(1);
        limiterOptions.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
        limiterOptions.QueueLimit = 10;
    });
});

var app = builder.Build();
app.UseRateLimiter();

app.MapGet("/api/data", () => "Hello!")
    .RequireRateLimiting("fixed");

app.Run();
```

### Sliding Window Limiter

Smoother distribution by dividing windows into segments:

```csharp
builder.Services.AddRateLimiter(options =>
{
    options.AddSlidingWindowLimiter("sliding", limiterOptions =>
    {
        limiterOptions.PermitLimit = 100;
        limiterOptions.Window = TimeSpan.FromMinutes(1);
        limiterOptions.SegmentsPerWindow = 6; // 10-second segments
        limiterOptions.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
        limiterOptions.QueueLimit = 10;
    });
});
```

### Token Bucket Limiter

Allows bursting while maintaining average rate:

```csharp
builder.Services.AddRateLimiter(options =>
{
    options.AddTokenBucketLimiter("token", limiterOptions =>
    {
        limiterOptions.TokenLimit = 100;
        limiterOptions.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
        limiterOptions.QueueLimit = 10;
        limiterOptions.ReplenishmentPeriod = TimeSpan.FromSeconds(10);
        limiterOptions.TokensPerPeriod = 10;
        limiterOptions.AutoReplenishment = true;
    });
});
```

### Concurrency Limiter

Limits concurrent requests:

```csharp
builder.Services.AddRateLimiter(options =>
{
    options.AddConcurrencyLimiter("concurrent", limiterOptions =>
    {
        limiterOptions.PermitLimit = 10;
        limiterOptions.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
        limiterOptions.QueueLimit = 5;
    });
});
```

## Partitioned Rate Limiting

The most powerful feature - rate limit by user, IP, or any criteria:

```csharp
builder.Services.AddRateLimiter(options =>
{
    // Rate limit by user identity
    options.AddPolicy("per-user", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.User?.Identity?.Name ?? "anonymous",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 100,
                Window = TimeSpan.FromMinutes(1)
            }));

    // Rate limit by IP address
    options.AddPolicy("per-ip", context =>
        RateLimitPartition.GetTokenBucketLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new TokenBucketRateLimiterOptions
            {
                TokenLimit = 50,
                TokensPerPeriod = 10,
                ReplenishmentPeriod = TimeSpan.FromSeconds(10),
                AutoReplenishment = true
            }));

    // Rate limit by API key
    options.AddPolicy("per-api-key", context =>
    {
        var apiKey = context.Request.Headers["X-API-Key"].FirstOrDefault() ?? "no-key";

        return RateLimitPartition.GetSlidingWindowLimiter(
            partitionKey: apiKey,
            factory: key => new SlidingWindowRateLimiterOptions
            {
                PermitLimit = key == "premium" ? 1000 : 100,
                Window = TimeSpan.FromMinutes(1),
                SegmentsPerWindow = 6
            });
    });
});
```

## Tiered Rate Limiting

Different limits for different subscription tiers:

```csharp
builder.Services.AddRateLimiter(options =>
{
    options.AddPolicy("tiered", context =>
    {
        var tier = context.User?.FindFirst("subscription_tier")?.Value ?? "free";

        var (permitLimit, window) = tier switch
        {
            "enterprise" => (10000, TimeSpan.FromMinutes(1)),
            "professional" => (1000, TimeSpan.FromMinutes(1)),
            "basic" => (100, TimeSpan.FromMinutes(1)),
            _ => (10, TimeSpan.FromMinutes(1)) // free tier
        };

        return RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.User?.Identity?.Name ?? context.Connection.RemoteIpAddress?.ToString() ?? "anonymous",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permitLimit,
                Window = window
            });
    });
});
```

## Global Rate Limiting

Apply rate limiting to all endpoints:

```csharp
builder.Services.AddRateLimiter(options =>
{
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
    {
        // Combine IP and user for the partition key
        var clientId = context.User?.Identity?.Name
            ?? context.Connection.RemoteIpAddress?.ToString()
            ?? "unknown";

        return RateLimitPartition.GetSlidingWindowLimiter(
            partitionKey: clientId,
            factory: _ => new SlidingWindowRateLimiterOptions
            {
                PermitLimit = 1000,
                Window = TimeSpan.FromMinutes(1),
                SegmentsPerWindow = 10
            });
    });

    // Customize rejection response
    options.OnRejected = async (context, token) =>
    {
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;

        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
        {
            context.HttpContext.Response.Headers.RetryAfter = retryAfter.TotalSeconds.ToString();
        }

        await context.HttpContext.Response.WriteAsJsonAsync(new
        {
            error = "Too many requests",
            retryAfter = retryAfter.TotalSeconds
        }, cancellationToken: token);
    };
});
```

## Complete API Example

```csharp
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRateLimiter(options =>
{
    // Global limiter - applies to all requests
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 1000,
                Window = TimeSpan.FromMinutes(1)
            }));

    // Strict policy for expensive operations
    options.AddPolicy("expensive", context =>
        RateLimitPartition.GetTokenBucketLimiter(
            partitionKey: context.User?.Identity?.Name ?? "anonymous",
            factory: _ => new TokenBucketRateLimiterOptions
            {
                TokenLimit = 5,
                TokensPerPeriod = 1,
                ReplenishmentPeriod = TimeSpan.FromMinutes(1),
                AutoReplenishment = true
            }));

    // Standard API policy
    options.AddPolicy("api", context =>
        RateLimitPartition.GetSlidingWindowLimiter(
            partitionKey: context.Request.Headers["X-API-Key"].FirstOrDefault() ?? "no-key",
            factory: _ => new SlidingWindowRateLimiterOptions
            {
                PermitLimit = 100,
                Window = TimeSpan.FromMinutes(1),
                SegmentsPerWindow = 6
            }));

    options.OnRejected = async (context, token) =>
    {
        context.HttpContext.Response.StatusCode = 429;

        var retryAfter = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var ra)
            ? ra.TotalSeconds
            : 60;

        context.HttpContext.Response.Headers.RetryAfter = retryAfter.ToString();

        await context.HttpContext.Response.WriteAsJsonAsync(new
        {
            error = "Rate limit exceeded",
            message = "Too many requests. Please slow down.",
            retryAfterSeconds = retryAfter
        }, cancellationToken: token);
    };
});

var app = builder.Build();

app.UseRateLimiter();

// Public endpoints with standard rate limiting
var api = app.MapGroup("/api").RequireRateLimiting("api");

api.MapGet("/products", () => new[]
{
    new { Id = 1, Name = "Product 1" },
    new { Id = 2, Name = "Product 2" }
});

api.MapGet("/products/{id}", (int id) => new { Id = id, Name = $"Product {id}" });

// Expensive operation with strict rate limiting
app.MapPost("/api/reports/generate", async () =>
{
    await Task.Delay(5000); // Simulate expensive operation
    return new { ReportId = Guid.NewGuid(), Status = "Generated" };
}).RequireRateLimiting("expensive");

// Health check - no rate limiting
app.MapGet("/health", () => "OK").DisableRateLimiting();

app.Run();
```

## Testing Rate Limiting

```csharp
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

public class RateLimitingTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client;

    public RateLimitingTests(WebApplicationFactory<Program> factory)
    {
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task Should_Return_429_When_Rate_Limited()
    {
        // Send requests until rate limited
        var responses = new List<HttpResponseMessage>();

        for (int i = 0; i < 150; i++)
        {
            var response = await _client.GetAsync("/api/products");
            responses.Add(response);
        }

        // At least one should be rate limited
        Assert.Contains(responses, r => r.StatusCode == HttpStatusCode.TooManyRequests);
    }

    [Fact]
    public async Task Should_Include_RetryAfter_Header()
    {
        // Exhaust rate limit
        for (int i = 0; i < 150; i++)
        {
            await _client.GetAsync("/api/products");
        }

        var response = await _client.GetAsync("/api/products");

        if (response.StatusCode == HttpStatusCode.TooManyRequests)
        {
            Assert.True(response.Headers.Contains("Retry-After"));
        }
    }
}
```

## Azure Deployment Considerations

When deploying to Azure, consider:

1. **Multiple instances**: Use distributed rate limiting with Redis
2. **Azure API Management**: Has built-in rate limiting - avoid double-limiting
3. **Application Gateway**: Can also provide rate limiting at the edge

```csharp
// For distributed scenarios, consider using Redis-backed rate limiting
builder.Services.AddStackExchangeRedisCache(options =>
{
    options.Configuration = builder.Configuration["Redis:ConnectionString"];
});

// Custom distributed rate limiter would use Redis for state
```

## Conclusion

ASP.NET Core 7's built-in rate limiting is a significant addition that eliminates the need for third-party packages for most scenarios. The partitioned rate limiters provide the flexibility needed for real-world applications with different client tiers and access patterns.

## Resources

- [Rate Limiting Middleware](https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit)
- [System.Threading.RateLimiting](https://learn.microsoft.com/en-us/dotnet/api/system.threading.ratelimiting)
- [API Management Rate Limiting](https://learn.microsoft.com/en-us/azure/api-management/api-management-sample-flexible-throttling)
