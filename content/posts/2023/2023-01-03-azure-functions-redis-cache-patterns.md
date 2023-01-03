---
title: "Implementing Redis Caching Patterns with Azure Functions"
author: MJ Peña
draft: false
date: 2023-01-03
image: /2023/01/azure-functions-redis-cache-patterns.png
url: /blog/azure-functions-redis-cache-patterns/
tags:
  - redis
  - cache
  - functions
  - patterns
  - azure
---

Caching is a technique used to store frequently accessed data in a temporary storage location in order to speed up the performance of an application. There are several different caching patterns that can be implemented to improve the performance of an application, and each has its own set of benefits and drawbacks. In this blog post, we will explore the different caching patterns and how they can be implemented using Redis and Azure Functions.

# What are the different caching patterns?

There are several different caching patterns that can be used to improve the performance of an application. Some of the most common caching patterns include:

1.  **Cache-Aside**: In this pattern, the cache is not pre-populated with data. Instead, the application is responsible for loading data into the cache when it is needed. This allows the application to have complete control over what data is stored in the cache and when it is refreshed.
2.  **Write-Through**: In this pattern, data is written to the cache and the backing store at the same time. This ensures that the cache is always up-to-date, but can result in slower write performance.
3.  **Write-Behind**: In this pattern, data is written to the cache and then asynchronously written to the backing store at a later time. This can improve write performance, but there is a risk of data loss if the cache goes down before the data is written to the backing store.
4.  **Refresh-ahead**: In this pattern, cache is pre-populated with data for clients to use. A scheduled job is triggered to request the cache data for clients in advanced.

# How can these patterns be implemented on Redis with Azure Functions?

Redis is a popular in-memory data store that can be used as a cache. Azure Functions is a serverless compute service that can be used to run code on-demand in response to a variety of triggers.

## Prerequisites

- An Azure account
- Azure Functions Tools
- The Azure Functions extension for Visual Studio Code (Visual Studio / Rider)
- The **Microsoft.Extensions.Caching.StackExchangeRedis** NuGet package
- Azure Functions and Azure Redis Cache

_Note: This example can also be replicated locally by using the Redis docker image instead of Azure Redis Cache._

## Common Setup

To implement any of the cache patterns below with Azure Functions and Redis, we can use the **Microsoft.Extensions.Caching.StackExchangeRedis** NuGet package, which provides a .NET client for Redis. I prefer to use **ISOLATED process** mode as it's more close to the ASP.NET Core implementations but still leverages the serverless nature of Functions. So the rest of the code samples won't work on IN-PROCESS mode, but the concept and idea will be the same - just different implementation.

After importing the nuget package, in your Program.cs, inject Redis by adding the following:

```csharp
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services =>
    {
        // Azure Redis Cache (or Redis via Docker)
        services.AddStackExchangeRedisCache(options =>
        {
            options.Configuration = Environment.GetEnvironmentVariable("RedisCache");
            options.InstanceName = "MyRedisCacheInstance";
        });
    })
    .Build();

host.Run();
```

Then in your local.settings.json file, add the following:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated",
    "RedisCache": "***.redis.cache.windows.net:6380,password=***=,ssl=True,abortConnect=False"
  }
}
```

# Cache-Aside

The cache-aside pattern is a common approach to caching that involves checking the cache for a requested value, and if it is not present, retrieving it from the source and storing it in the cache before returning it to the client. This pattern is useful for maintaining a consistent cache and avoiding stale data.

![Cache Aside with Azure](/2023/01/afr-cache-aside.png)

In this diagram, the client sends a request to the application. The application checks the cache for the requested data. If the data is found in the cache, the application retrieves it from the cache and returns it to the client. If the data is not found in the cache, the application retrieves it from the original source (e.g., a CosmosDB database) and stores it in the cache before returning it to the client.

Here is an example of Cache-Aside in action using Azure Functions, .NET 7, C#, and Azure Redis:

```csharp
using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Logging;

namespace RedisCachePatterns.Functions;

public class CacheAsideFunction
{
    private readonly IDistributedCache _redisCache;

    public CacheAsideFunction(IDistributedCache redisCache)
    {
        _redisCache = redisCache;
    }

    [Function("CacheAsideFunction")]
    public async Task<HttpResponseData> Run([HttpTrigger(AuthorizationLevel.Function, "get", "post")] HttpRequestData req,
        FunctionContext executionContext, CancellationToken cancellationToken)
    {
        var logger = executionContext.GetLogger("CacheAsideFunction");
        logger.LogInformation("Starting Cache-Aside Function.");

        // Get the requested key
        var cacheKey = await req.ReadAsStringAsync();
        // Get the cache value
        var cacheValue = await _redisCache.GetStringAsync(cacheKey, token: cancellationToken);

        // If the key is not present in the cache, retrieve it from the source and store it in the cache
        if (cacheValue == null)
        {
            cacheValue = await GetValueFromDatabase(cacheKey);
            await _redisCache.SetStringAsync(cacheKey, cacheValue, token: cancellationToken);
        }

        // Return the value to the client
        var response = req.CreateResponse(HttpStatusCode.OK);
        await response.WriteStringAsync(cacheValue);

        return response;
    }

    private async Task<string?> GetValueFromDatabase(string cacheKey)
    {
        return "Value from Database";
    }
}
```

In this example, we first check the cache for the requested key using the `GetStringAsync` method. If the key is not present in the cache, we retrieve the value from the source using the `GetValueFromDatabase` method and store it in the cache using the `StringSet` method. We then return the value of the key back to the user.

## Write-Through

The write-through cache pattern is a common approach to caching that involves writing data to both the cache and the source in a single operation. This pattern ensures that the cache is always consistent with the source and avoids the need for a separate cache update operation.

![Write Through Cache on Azure](/2023/01/afr-write-through.png)

In this diagram, the client sends a request to the application to write a value to the cache. The application writes the value to the cache and to the original source (e.g., a CosmosDB database).

Here is an example of Write-Through in action using Azure Functions, .NET 7, C#, and Azure Redis:

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Logging;

namespace RedisCachePatterns.Functions;

public class WriteThroughFunction
{
    private readonly IDistributedCache _redisCache;

    public WriteThroughFunction(IDistributedCache redisCache)
    {
        _redisCache = redisCache;
    }

    [Function("CacheAsideFunction")]
    public async Task<CacheResponse> Run([HttpTrigger(AuthorizationLevel.Function, "get", "post")] CacheRequest request,
        FunctionContext executionContext, CancellationToken cancellationToken)
    {
        var logger = executionContext.GetLogger("WriteThroughFunction");
        logger.LogInformation("Starting Write-Through Function.");

        // Write the value to the cache and the source
        await _redisCache.SetStringAsync(request.Key, request.ValueToInsert, token: cancellationToken);
        await WriteValueToDatabase(request.Key, request.ValueToInsert);

        // Return the value to the client
        return new CacheResponse
        {
            Message = "Value written to cache and source"
        };
    }

    private async Task WriteValueToDatabase(string requestKey, string requestValueToInsert)
    {
        // Perform an insert operation to your database
    }
}
```

In this example, we first get the key and value from the request. We then use the `StringSet` method to write the value to the cache, and the `WriteValueToDatabase` method to write the value to the source. Finally, we return a success message to the client using the `OkObjectResult` class.

# Write-Behind

The write-behind cache pattern is a common approach to caching that involves writing data to the cache and asynchronously updating the source at a later time. This pattern is useful for reducing the load on the source data store and improving the performance of write operations.

![Write-Behind Caching on Azure](/2023/01/afr-write-behind.png)

In this diagram, the client sends a request to the application to write a value to the cache. The application stores the value in the cache and adds it to a write queue (Azure Event Hubs). A separate process reads from the write queue and writes the values to the original source (e.g., a CosmosDB database).

Here is an example of Write-Behind in action using Azure Functions, .NET 7, C#, and Azure Redis:

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Logging;

namespace RedisCachePatterns.Functions;

public class WriteBehindFunction
{
    private readonly IDistributedCache _redisCache;

    public WriteBehindFunction(IDistributedCache redisCache)
    {
        _redisCache = redisCache;
    }

    [Function("WriteBehindFunction")]
    public async Task<CacheResponse> Run([HttpTrigger(AuthorizationLevel.Function, "get", "post")] CacheRequest request,
        FunctionContext executionContext, CancellationToken cancellationToken)
    {
        var logger = executionContext.GetLogger("WriteBehindFunction");
        logger.LogInformation("Starting Write-Behind Function.");

        // Write the value to the cache (Synchronously)
        _redisCache.SetString(request.Key, request.ValueToInsert);

		// Asynchronously update the source
        await PublishToEventHubsAsync(request.Key, request.ValueToInsert);

        return new CacheResponse
        {
            Message = "Value written to cache and update to source scheduled"
        };
    }

    private async Task PublishToEventHubsAsync(string requestKey, string requestValueToInsert)
    {
        // Schedule an insert operation to your database
    }
}
```

In this example, we first get the key and value from the request. We then use the `SetString` method to write the value to the cache, and the `PublishToEventHubsAsync` method to asynchronously update the source.

Note that you can even improve this by creating an Event Hub Output binding from this function. And then create another Event Hub Trigger function to react on the published message, and save it to the database like CosmosDB.

# Refresh-Ahead

Read-Through pattern is a similar concept with Cache-Aside, except that it's specific for Reading data. There are a lot of variations on Read-Through as there are different techniques on how to serve "hot" data to clients as fast as possible. One of the trivial and popular pattern is Refresh-ahead.

The Refresh-ahead cache pattern is a variation of the Read-Through pattern where data is preemptively retrieved from the original source and stored in the cache before it is actually needed. This can improve the performance of an application by reducing the latency of retrieving data from the original source.

![Refresh Ahead Cache on Azure](/2023/01/afr-refresh-ahead.png)

In this diagram, the client sends a request to the application to read a value from the cache. The application retrieves the value from the cache and returns it to the client. In the background, the application also retrieves the value from the original source (e.g., a CosmosDB database) and stores it in the cache. This way, the next time the value is needed, it will already be in the cache and can be retrieved more quickly.

Here is an example of Refresh-ahead in action using Azure Functions, .NET 7, C#, and Azure Redis:

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Logging;

namespace RedisCachePatterns.Functions;

public class RefreshAheadFunction
{
    private readonly IDistributedCache _redisCache;

    public RefreshAheadFunction(IDistributedCache redisCache)
    {
        _redisCache = redisCache;
    }

    [Function("HttpRefreshAheadFunction")]
    public async Task<CacheResponse> Get([HttpTrigger(AuthorizationLevel.Function, "get", "post")] CacheRequest request,
        FunctionContext executionContext, CancellationToken cancellationToken)
    {
        var logger = executionContext.GetLogger("HttpRefreshAheadFunction");
        logger.LogInformation("Starting HTTP Refresh-Ahead Function.");

        // Get the requested key
        var cacheKey = request.Key;
        // Get the cache value. It is guaranteed that there is a value here because of the timer refresh.
        var cacheValue = await _redisCache.GetStringAsync(cacheKey, token: cancellationToken);

        // Return the value to the client
        return new CacheResponse
        {
            CacheValue = cacheValue,
            Message = "Success"
        };
    }

    [Function("TimerRefreshAheadFunction")]
    public async Task<CacheResponse> Refresh([TimerTrigger("0 */5 * * * *")] CacheRequest request,
FunctionContext context, CancellationToken cancellationToken)
    {
        var logger = context.GetLogger("TimerRefreshAheadFunction");
        logger.LogInformation("Starting Timer for Refresh-Ahead Function.");

        // Get the requested key
        var cacheKey = request.Key;
        // Get the cache value
        var cacheValue = await _redisCache.GetStringAsync(cacheKey, token: cancellationToken);
        // If cache value is not set, retrieve from original source and store in cache
        if (string.IsNullOrEmpty(cacheValue))
        {
            string value = await GetValueFromOriginalSourceAsync();
            cacheValue = value;
            await _redisCache.SetStringAsync(request.Key, request.ValueToReturn, token: cancellationToken);
        }

        // Return the value to the client
        return new CacheResponse
        {
            CacheValue = cacheValue,
            Message = "Success"
        };
    }

    private static async Task<string> GetValueFromOriginalSourceAsync()
    {
        return "Retrieve data from original source (e.g., CosmosDB database)";
    }

    private static async Task SetCacheValueAsync(string cacheName, string key, string value)
    {
        // Store value in cache
    }

}
```

In this example, we have two Azure Functions functions (weird naming). The first function, `Get`, is an HTTP trigger that handles incoming requests to read a value from the cache.

The second function, `Refresh`, is a timer trigger that runs every 5 minutes. If the value is not set, it retrieves the value from the original source (e.g., CosmosDB) and stores it in the cache using the `GetValueFromOriginalSourceAsync` and `SetCacheValueAsync` methods, respectively.

This way, the cache is continually refreshed with the latest data from the original source, ensuring that the next time the data is needed, it will already be in the cache and can be retrieved more quickly. This is beneficial if you're trying to serve the same set of information to a lot of users.

# Conclusion

In this blog post, we looked at four cache patterns: Cache-Aside, Write-Through, Write-Behind, and Refresh-Ahead. We implemented these patterns using Azure Functions (ISOLATED process), .NET 7, C#, and Azure Redis. These patterns can be used to improve the performance of an application by temporarily storing frequently accessed data.

![azure-functions-redis-cache](/2023/01/azure-functions-redis-cache-rider.png)

I hope this helps! Let me know if you have any questions.

For the code above, refer to this repository: [AzureFunctions.Samples/RedisCachePatterns at main · mjtpena/AzureFunctions.Samples (github.com)](https://github.com/mjtpena/AzureFunctions.Samples/tree/main/RedisCachePatterns)
