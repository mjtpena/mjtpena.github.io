---
title: "Redis Caching Patterns in .NET 7 Isolated Azure Functions"
description: "Cache-aside, write-through, write-behind and refresh-ahead with Azure Cache for Redis in .NET 7 isolated Azure Functions, and when each one is the wrong choice."
author: Michael John Peña
draft: false
date: 2023-01-03
url: /blog/azure-functions-redis-cache-patterns/
tags:
  - Azure Functions
  - Redis
  - Caching
  - Serverless
  - .NET
---

Serverless functions are stateless by design, so every invocation that needs data goes back to the database. That works until a popular endpoint starts hammering Cosmos DB or SQL with the same reads, or a burst of writes saturates a backend that can't scale as fast as Functions can. A shared cache like Azure Cache for Redis fixes that, but the pattern you pick decides whether you get speed, consistency, or a data-loss bug you won't find until production.

I covered the general patterns with Azure Cache for Redis [in an earlier post](/blog/2020-10-24-azure-redis-cache-patterns/). This one is narrower: how cache-aside, write-through, write-behind and refresh-ahead map onto Azure Functions running in the .NET 7 isolated worker, what each costs you, and when I wouldn't use them.

## Why the isolated worker, and why there's no Redis binding

Functions has supported [.NET 7 in the isolated worker process](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide) since .NET 7 shipped in November 2022 ([my notes on that release](/blog/2022-11-03-azure-functions-dotnet-7-isolated/)). The in-process model is still tied to the LTS release (.NET 6), so if you want .NET 7 on Functions, isolated is the only option. I prefer it anyway: `Program.cs`, dependency injection and middleware look like ASP.NET Core, and your code no longer shares a process with the Functions host.

There's no first-party Redis trigger or binding for Azure Functions, so every pattern here talks to Redis directly through a client library. I use `IDistributedCache` from the `Microsoft.Extensions.Caching.StackExchangeRedis` package rather than raw `StackExchange.Redis`. The abstraction only gives you get, set, refresh and remove with expiry, and that is all these four patterns need. The moment you need atomic counters, Lua scripts, pub/sub or locks, inject `IConnectionMultiplexer` instead. `AddStackExchangeRedisCache` doesn't make it injectable, so register it yourself with `services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(...))`, and point the cache at the same instance through `options.ConnectionMultiplexerFactory` so you keep one connection rather than opening a second.

## Common setup

Packages: `Microsoft.Azure.Functions.Worker`, `Microsoft.Azure.Functions.Worker.Sdk`, `Microsoft.Azure.Functions.Worker.Extensions.Http`, `Microsoft.Azure.Functions.Worker.Extensions.Timer`, `Microsoft.Azure.Functions.Worker.Extensions.ServiceBus` and `Microsoft.Extensions.Caching.StackExchangeRedis`. Register the cache once in `Program.cs`:

```csharp
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services =>
    {
        services.AddStackExchangeRedisCache(options =>
        {
            options.Configuration = Environment.GetEnvironmentVariable("RedisCache");
            options.InstanceName = "products-api:";
        });

        // Your data access implementation (Cosmos DB, SQL, etc.)
        services.AddSingleton<IProductStore, CosmosProductStore>();
    })
    .Build();

host.Run();
```

`AddStackExchangeRedisCache` registers a singleton that opens one multiplexed connection and reuses it across invocations. That matters on the Consumption plan: creating a connection per invocation is the fastest way to exhaust connections and pay a TLS handshake on every request. `InstanceName` is prefixed to every key, which keeps two apps sharing one cache from colliding.

The connection string goes in app settings (or `local.settings.json` locally). Azure Cache for Redis uses TLS on port 6380, and the [non-TLS port 6379 is disabled by default](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-configure#access-ports), so keep `ssl=True`:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated",
    "RedisCache": "<your-cache-name>.redis.cache.windows.net:6380,password=<your-access-key>,ssl=True,abortConnect=False",
    "ServiceBusConnection": "<your-service-bus-connection-string>"
  }
}
```

For local development, `docker run -p 6379:6379 redis` and a `RedisCache` value of `localhost:6379` is enough. The samples below share this model and store interface (a fragment; `CosmosProductStore` is your implementation):

```csharp
public record Product(string Id, string Name, decimal Price);

public interface IProductStore
{
    Task<Product?> GetAsync(string id);
    Task UpsertAsync(Product product);
    Task<IReadOnlyList<Product>> GetHotProductsAsync();
}
```

## Cache-aside: the default

The function checks Redis first; on a miss it reads the database, writes the result to Redis with an expiry, and returns it. The cache only ever holds data someone asked for. The [cache-aside pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside) in the Azure Architecture Center covers the theory well.

```csharp
using System.Net;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Logging;
using StackExchange.Redis;

public class GetProductFunction
{
    private readonly IDistributedCache _cache;
    private readonly IProductStore _store;
    private readonly ILogger<GetProductFunction> _logger;

    public GetProductFunction(IDistributedCache cache, IProductStore store,
        ILogger<GetProductFunction> logger)
    {
        _cache = cache;
        _store = store;
        _logger = logger;
    }

    [Function("GetProduct")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Function, "get", Route = "products/{id}")] HttpRequestData req,
        string id)
    {
        var key = $"product:{id}";
        string? json = null;

        try
        {
            json = await _cache.GetStringAsync(key);
        }
        catch (Exception ex) when (ex is RedisConnectionException or RedisTimeoutException)
        {
            // The cache is an optimisation: fail open and read the database.
            _logger.LogWarning(ex, "Cache read failed for {Key}", key);
        }

        if (json is null)
        {
            var product = await _store.GetAsync(id);
            if (product is null)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            json = JsonSerializer.Serialize(product);

            try
            {
                await _cache.SetStringAsync(key, json, new DistributedCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10)
                });
            }
            catch (Exception ex) when (ex is RedisConnectionException or RedisTimeoutException)
            {
                _logger.LogWarning(ex, "Cache write failed for {Key}", key);
            }
        }

        var response = req.CreateResponse(HttpStatusCode.OK);
        response.Headers.Add("Content-Type", "application/json");
        await response.WriteStringAsync(json);
        return response;
    }
}
```

Two details matter here. First, always set an expiry. A cache entry without a TTL is a consistency bug waiting for the day someone updates the database through another path. Second, build the key from a fixed prefix plus the ID (`$"product:{id}"`), never from caller-supplied text alone. Route values are caller input like anything else; the fixed `product:` prefix plus `InstanceName` is what stops a caller reaching keys outside the product namespace.

The try/catch blocks are there because the cache must fail open. `abortConnect=False` only stops the app failing at startup when Redis is unreachable; after that, `GetStringAsync` and `SetStringAsync` throw `RedisConnectionException` or `RedisTimeoutException` on every call while the cache is down. Without the catch, a Redis outage becomes a 500 on every request, even though the database is healthy and could have answered. Log the failure, fall through to `_store`, and accept slower responses until the cache comes back. The same applies to every cache call in the samples below; I've left the try/catch out of them only to keep them short, except where it changes the response.

The weakness is the stampede: when a hot key expires, every concurrent invocation misses at once and they all hit the database. With Functions scaling out under load, that can be dozens of instances. If a key is hot enough for that to hurt, look at refresh-ahead below rather than adding locking to cache-aside. For the long tail, where you can't predict which keys are hot, the cheap fix is to jitter the TTL (for example 10 minutes plus a random 0 to 60 seconds) so keys written together don't expire together. Only if that isn't enough would I add a short-lived lock with `SET NX` through `IConnectionMultiplexer` (registered as described above, sharing the cache's connection), so one invocation reloads the key while the others wait or serve the old value. As a fragment, where `db` is `multiplexer.GetDatabase()`:

```csharp
// Fragment: true means this invocation owns the reload for the next 10 seconds.
var acquired = await db.StringSetAsync($"lock:{key}", instanceId, TimeSpan.FromSeconds(10), When.NotExists);
```

The expiry matters: if the invocation holding the lock dies, the lock releases itself. StackExchange.Redis also wraps this as `LockTakeAsync` and `LockReleaseAsync`, which check the token on release so one invocation can't delete another's lock.

## Write-through: consistent reads after writes

Write-through updates the database and the cache in the same request, so the next read sees the new value without a miss.

```csharp
using System.Net;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Logging;
using StackExchange.Redis;

public class PutProductFunction
{
    private readonly IDistributedCache _cache;
    private readonly IProductStore _store;
    private readonly ILogger<PutProductFunction> _logger;

    public PutProductFunction(IDistributedCache cache, IProductStore store,
        ILogger<PutProductFunction> logger)
    {
        _cache = cache;
        _store = store;
        _logger = logger;
    }

    [Function("PutProduct")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Function, "put", Route = "products/{id}")] HttpRequestData req,
        string id)
    {
        var body = await req.ReadFromJsonAsync<Product>();
        if (body is null)
        {
            return req.CreateResponse(HttpStatusCode.BadRequest);
        }

        var product = body with { Id = id };

        // Database first: it is the source of truth.
        await _store.UpsertAsync(product);

        try
        {
            await _cache.SetStringAsync($"product:{id}", JsonSerializer.Serialize(product),
                new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10) });
        }
        catch (Exception ex) when (ex is RedisConnectionException or RedisTimeoutException)
        {
            // The database write succeeded, so the caller still gets 204.
            _logger.LogWarning(ex, "Cache update failed for product {Id}", id);
        }

        return req.CreateResponse(HttpStatusCode.NoContent);
    }
}
```

Order matters. Write the database first. If the cache write fails afterwards, the update is already saved, so the function logs it and still returns 204; reporting a 500 for a write that succeeded only invites a retry. The stale cache entry is corrected when its TTL runs out. If you write the cache first and the database write fails, readers see data that never existed.

Note what "write-through" means here: Redis isn't writing through to anything; your function does two independent writes with no transaction around them. Two concurrent updates to the same product can land in the database in one order and in Redis in the other. If that's unacceptable, replace the `SetStringAsync` with `RemoveAsync` and let the next read repopulate through cache-aside. Invalidation is less elegant but much harder to get wrong.

## Write-behind: fast writes, deferred persistence

Write-behind writes to the cache, acknowledges the caller, and persists to the database later. The classic description has the cache flush itself to the store, but Redis doesn't do that for you, so in Functions you put a durable queue in the middle. I use a Service Bus queue through an output binding, because Service Bus gives you retries, dead-lettering and per-message settlement, which is what a queue of pending database writes needs. The isolated model returns multiple outputs through a class:

```csharp
using System.Net;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Caching.Distributed;

public class WriteBehindOutput
{
    [ServiceBusOutput("product-writes", Connection = "ServiceBusConnection")]
    public string? PendingWrite { get; set; }

    public HttpResponseData HttpResponse { get; set; } = default!;
}

public class WriteBehindFunctions
{
    private readonly IDistributedCache _cache;
    private readonly IProductStore _store;

    public WriteBehindFunctions(IDistributedCache cache, IProductStore store)
    {
        _cache = cache;
        _store = store;
    }

    [Function("AcceptProductWrite")]
    public async Task<WriteBehindOutput> Accept(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = "products/{id}")] HttpRequestData req,
        string id)
    {
        var body = await req.ReadFromJsonAsync<Product>();
        if (body is null)
        {
            return new WriteBehindOutput { HttpResponse = req.CreateResponse(HttpStatusCode.BadRequest) };
        }

        var json = JsonSerializer.Serialize(body with { Id = id });
        await _cache.SetStringAsync($"product:{id}", json,
            new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30) });

        return new WriteBehindOutput
        {
            PendingWrite = json,
            HttpResponse = req.CreateResponse(HttpStatusCode.Accepted)
        };
    }

    [Function("PersistProductWrite")]
    public async Task Persist(
        [ServiceBusTrigger("product-writes", Connection = "ServiceBusConnection")] string message)
    {
        var product = JsonSerializer.Deserialize<Product>(message)
            ?? throw new InvalidOperationException("Empty product message.");

        // Throwing here lets Service Bus retry, then dead-letter.
        await _store.UpsertAsync(product);
    }
}
```

The HTTP function returns 202 Accepted, not 200, because the write isn't durable in the database yet. The queue consumer has to be idempotent, since Service Bus delivers at least once; an upsert keyed on the product ID is. Idempotent isn't the same as ordered, though. A plain queue with competing consumers doesn't guarantee processing order, so two quick writes to the same product can be persisted out of order, and the upsert leaves the older value in the database while Redis holds the newer one. Either enable [Service Bus sessions](https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-sessions) with the product ID as the `SessionId` and `IsSessionsEnabled = true` on the trigger (the string output binding can't set `SessionId`, so you'd send with `ServiceBusSender` from `Azure.Messaging.ServiceBus`), or carry a version or timestamp in the message and make the upsert conditional so it ignores older writes.

This pattern is the one I push back on most. You've traded consistency for write latency: until the consumer runs, Redis is the only place the new value exists outside the queue, and a cache eviction under memory pressure plus a dead-lettered message means a lost update. The cache write and the queue send aren't atomic either: the output binding sends after the function returns, so if that send fails, Redis serves a value that was never queued and will never reach the database. That's another reason to keep write-behind for low-value writes. Use it for high-volume, low-stakes writes such as view counts, telemetry or session activity. Don't use it for orders, payments or anything a person will later ask you to prove was saved.

## Refresh-ahead: keep hot keys warm

Refresh-ahead loads data into the cache before anyone asks for it. In Functions that's a timer trigger that reloads a known set of hot keys, combined with the cache-aside read path so a miss still works.

```csharp
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Logging;

public class RefreshHotProductsFunction
{
    private readonly IDistributedCache _cache;
    private readonly IProductStore _store;
    private readonly ILogger<RefreshHotProductsFunction> _logger;

    public RefreshHotProductsFunction(IDistributedCache cache, IProductStore store,
        ILogger<RefreshHotProductsFunction> logger)
    {
        _cache = cache;
        _store = store;
        _logger = logger;
    }

    [Function("RefreshHotProducts")]
    public async Task Run([TimerTrigger("0 */5 * * * *")] TimerInfo timer)
    {
        var products = await _store.GetHotProductsAsync();

        foreach (var product in products)
        {
            // TTL is longer than the refresh interval, so keys never expire between runs.
            await _cache.SetStringAsync($"product:{product.Id}", JsonSerializer.Serialize(product),
                new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(15) });
        }

        _logger.LogInformation("Refreshed {Count} hot products", products.Count);
    }
}
```

The TTL (15 minutes) is deliberately three times the schedule (5 minutes). If one timer run fails, the keys survive until the next one. Timer triggers run as a singleton across scaled-out instances, so you won't get ten instances refreshing the same keys at once.

The trap is refreshing too much. Every key you pre-load costs a database read every five minutes whether anyone reads it or not. Refresh-ahead pays off for a small, predictable hot set: a home page catalogue, reference data, a leaderboard. It's wasteful for a long tail of rarely read items, where plain cache-aside is cheaper.

## Choosing between them

| Pattern | Read latency | Consistency | Main risk | Use it for |
|---|---|---|---|---|
| Cache-aside | Slow on miss, fast on hit | Stale up to the TTL | Stampede on hot keys | Almost everything, as the default |
| Write-through | Fast after writes | Good, not transactional | Race between concurrent writers | Read-heavy data that changes through your API |
| Write-behind | Fast | Eventual | Lost writes | High-volume, low-value writes |
| Refresh-ahead | Fast for the hot set | Stale up to the refresh interval | Wasted reads on cold keys | Small, predictable hot data |

## Where I'd start

Start with cache-aside and a sensible TTL on every key. Add write-through, or better, invalidation on write, only when users notice stale reads after their own updates. Add refresh-ahead only for keys whose misses you can see hurting the database. Treat write-behind as a deliberate decision to accept data loss, and write that decision down.

Also ask whether you need Redis at all. If the data fits in memory and is the same for every caller, a static in-memory cache per instance is free and fast, and Functions instances live long enough for it to be useful. Redis earns its cost when the cache has to be shared across instances, survive scale-in, or be invalidated from one place. Microsoft's [caching guidance](https://learn.microsoft.com/en-us/azure/architecture/best-practices/caching) is a good checklist before you commit.

An earlier, less complete version of these samples (which used Event Hubs for the write-behind queue) is in my [AzureFunctions.Samples repository](https://github.com/mjtpena/AzureFunctions.Samples/tree/main/RedisCachePatterns).
