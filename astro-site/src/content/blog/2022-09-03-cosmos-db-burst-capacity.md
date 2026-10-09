---
title: "Burst Capacity in Azure Cosmos DB"
description: "When your Cosmos DB container isn't fully utilizing its provisioned throughput, the unused capacity accumulates as burst credits. These credits can be used…"
author: "Michael John Peña"
draft: false
date: 2022-09-03
tags: ["Azure", "Cosmos DB", "Performance", "Throughput"]
---

## Understanding Burst Capacity

When your Cosmos DB container isn't fully utilizing its provisioned throughput, the unused capacity accumulates as burst credits. These credits can be used during traffic spikes to handle requests that would otherwise be rate-limited.

### How Burst Capacity Works

```csharp
using Microsoft.Azure.Cosmos;

// Provisioned throughput container - burst capacity is automatic
var containerProperties = new ContainerProperties("Events", "/eventType");

// Create container with 1000 RU/s provisioned throughput
var container = await database.CreateContainerIfNotExistsAsync(
    containerProperties,
    throughput: 1000);

// During low traffic, unused RUs accumulate as burst credits
// Maximum accumulation: 5 minutes worth of provisioned throughput
// At 1000 RU/s = 300,000 RU burst credits max

public class ThroughputManager
{
    private readonly Container _container;

    public ThroughputManager(Container container)
    {
        _container = container;
    }

    public async Task<ThroughputInfo> GetThroughputInfoAsync()
    {
        var throughput = await _container.ReadThroughputAsync(new RequestOptions());

        return new ThroughputInfo
        {
            ProvisionedThroughput = throughput.Resource.Throughput ?? 0,
            AutoscaleMaxThroughput = throughput.Resource.AutoscaleMaxThroughput
        };
    }
}
```

### Handling Traffic Spikes

```csharp
public class EventProcessor
{
    private readonly Container _container;
    private readonly ILogger _logger;

    public EventProcessor(Container container, ILogger logger)
    {
        _container = container;
        _logger = logger;
    }

    public async Task ProcessEventBatchAsync(List<Event> events)
    {
        var tasks = new List<Task<ItemResponse<Event>>>();
        var successCount = 0;
        var throttledCount = 0;

        foreach (var evt in events)
        {
            tasks.Add(ProcessSingleEventAsync(evt));
        }

        var results = await Task.WhenAll(tasks);

        foreach (var result in results)
        {
            if (result != null)
            {
                successCount++;
                _logger.LogDebug($"Event processed. RU charge: {result.RequestCharge}");
            }
            else
            {
                throttledCount++;
            }
        }

        _logger.LogInformation(
            $"Batch complete. Success: {successCount}, Throttled: {throttledCount}");
    }

    private async Task<ItemResponse<Event>> ProcessSingleEventAsync(Event evt)
    {
        try
        {
            // Burst capacity kicks in automatically when needed
            return await _container.CreateItemAsync(
                evt,
                new PartitionKey(evt.EventType));
        }
        catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.TooManyRequests)
        {
            // Even with burst capacity, you might hit limits
            _logger.LogWarning($"Request throttled. Retry after: {ex.RetryAfter}");

            // Wait and retry
            if (ex.RetryAfter.HasValue)
            {
                await Task.Delay(ex.RetryAfter.Value);
                return await _container.CreateItemAsync(
                    evt,
                    new PartitionKey(evt.EventType));
            }

            return null;
        }
    }
}
```

### Monitoring Burst Capacity Usage

```csharp
public class CosmosMetricsCollector
{
    private readonly CosmosClient _client;
    private readonly string _databaseId;
    private readonly string _containerId;

    public async Task CollectMetricsAsync()
    {
        var container = _client.GetContainer(_databaseId, _containerId);

        // Track RU consumption over time
        var metrics = new Dictionary<string, double>();

        // Execute sample query to measure consumption
        var query = new QueryDefinition("SELECT * FROM c WHERE c.timestamp > @start")
            .WithParameter("@start", DateTime.UtcNow.AddHours(-1));

        double totalRUs = 0;
        int requestCount = 0;

        using var iterator = container.GetItemQueryIterator<dynamic>(query);
        while (iterator.HasMoreResults)
        {
            var response = await iterator.ReadNextAsync();
            totalRUs += response.RequestCharge;
            requestCount++;
        }

        Console.WriteLine($"Total RUs consumed: {totalRUs}");
        Console.WriteLine($"Average RUs per request: {totalRUs / requestCount}");
    }
}
```

### Best Practices for Burst Capacity

```csharp
public class BurstCapacityOptimizer
{
    // 1. Use batch operations to maximize burst utilization
    public async Task<TransactionalBatchResponse> BatchInsertAsync(
        Container container,
        List<Product> products,
        string partitionKeyValue)
    {
        var batch = container.CreateTransactionalBatch(
            new PartitionKey(partitionKeyValue));

        foreach (var product in products.Take(100)) // Max 100 operations per batch
        {
            batch.CreateItem(product);
        }

        return await batch.ExecuteAsync();
    }

    // 2. Implement intelligent retry logic
    public async Task<T> ExecuteWithRetryAsync<T>(
        Func<Task<T>> operation,
        int maxRetries = 5)
    {
        var retryCount = 0;
        var delay = TimeSpan.FromMilliseconds(100);

        while (true)
        {
            try
            {
                return await operation();
            }
            catch (CosmosException ex) when (
                ex.StatusCode == HttpStatusCode.TooManyRequests &&
                retryCount < maxRetries)
            {
                retryCount++;
                var waitTime = ex.RetryAfter ?? delay;
                await Task.Delay(waitTime);
                delay = TimeSpan.FromMilliseconds(delay.TotalMilliseconds * 2);
            }
        }
    }

    // 3. Monitor and alert on burst usage
    public void SetupAlerts()
    {
        // Use Azure Monitor to track:
        // - NormalizedRUConsumption > 80% sustained
        // - TotalRequests with StatusCode = 429
        // - ProvisionedThroughput vs actual consumption
    }
}
```

## Key Takeaways

1. **Automatic feature** - No configuration needed, works out of the box
2. **Credits accumulate** - Up to 5 minutes of unused throughput
3. **Perfect for spiky workloads** - Handles traffic bursts gracefully
4. **Monitor usage** - Track when burst capacity is being utilized
5. **Plan capacity** - Burst is temporary; size for sustained workloads

Burst capacity makes Cosmos DB more cost-effective by allowing you to provision for average load while handling peaks automatically.
