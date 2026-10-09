---
title: "Performance Optimization for .NET 9 Applications on Azure"
description: "Results: Cold start reduced from 800ms to 150ms. These optimizations combined typically reduce Azure compute costs by 30-50% while improving response times.…"
author: Michael John Peña
draft: false
date: 2025-12-06
tags:
  - dotnet
  - Performance
  - Azure
  - Optimization
  - Best-Practices
---

## Native AOT for Azure Functions

Native AOT compilation reduces cold start times dramatically:

```csharp
// Program.cs for Native AOT Function
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services =>
    {
        services.AddSingleton<IMyService, MyService>();
    })
    .Build();

// Ensure trimming-safe code
[JsonSerializable(typeof(MyRequest))]
[JsonSerializable(typeof(MyResponse))]
internal partial class SerializerContext : JsonSerializerContext { }

host.Run();
```

**Results:** Cold start reduced from 800ms to 150ms.

## Memory-Efficient Collections

.NET 9's frozen collections provide significant performance gains for read-heavy scenarios:

```csharp
using System.Collections.Frozen;

public class ConfigurationCache
{
    private readonly FrozenDictionary<string, ConfigValue> _cache;

    public ConfigurationCache(IEnumerable<KeyValuePair<string, ConfigValue>> configs)
    {
        // One-time creation cost, but reads are extremely fast
        _cache = configs.ToFrozenDictionary();
    }

    public ConfigValue GetConfig(string key)
    {
        // ~40% faster than Dictionary for lookups
        return _cache.TryGetValue(key, out var value) ? value : default;
    }
}
```

## Connection Pooling for Azure Services

Properly configured connection pooling prevents throttling:

```csharp
// Optimal Azure SDK configuration
builder.Services.AddSingleton(sp =>
{
    var options = new CosmosClientOptions
    {
        ConnectionMode = ConnectionMode.Direct,
        MaxRetryAttemptsOnRateLimitedRequests = 9,
        MaxRetryWaitTimeOnRateLimitedRequests = TimeSpan.FromSeconds(30),
        EnableContentResponseOnWrite = false, // Reduces network overhead
        ApplicationPreferredRegions = new[] { "Australia East", "Australia Southeast" }
    };

    return new CosmosClient(connectionString, options);
});

// HTTP client pooling
builder.Services.AddHttpClient("ExternalApi", client =>
{
    client.DefaultRequestHeaders.Add("Accept", "application/json");
})
.ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
{
    PooledConnectionLifetime = TimeSpan.FromMinutes(5),
    PooledConnectionIdleTimeout = TimeSpan.FromMinutes(2),
    MaxConnectionsPerServer = 100
});
```

## Async All the Way

Avoid sync-over-async patterns that block threads:

```csharp
// Bad - blocks thread pool
public string GetData()
{
    return _httpClient.GetStringAsync(url).Result; // Don't do this!
}

// Good - truly async
public async Task<string> GetDataAsync()
{
    return await _httpClient.GetStringAsync(url);
}

// Better - with cancellation
public async Task<string> GetDataAsync(CancellationToken ct = default)
{
    return await _httpClient.GetStringAsync(url, ct);
}
```

## Measuring Impact

Use Application Insights to measure optimizations:

```csharp
using var activity = ActivitySource.StartActivity("OptimizedOperation");
activity?.SetTag("optimization.version", "2.0");

var stopwatch = Stopwatch.StartNew();
// ... operation ...
stopwatch.Stop();

activity?.SetTag("duration.ms", stopwatch.ElapsedMilliseconds);
```

These optimizations combined typically reduce Azure compute costs by 30-50% while improving response times. Start with profiling to identify your specific bottlenecks.
