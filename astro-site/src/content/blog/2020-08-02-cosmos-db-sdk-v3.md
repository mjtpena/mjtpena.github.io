---
title: "Moving to the Azure Cosmos DB .NET SDK v3: Patterns I Keep"
description: "What changed from the v2 DocumentClient to the Cosmos DB .NET SDK v3, and the client, query, batch and bulk patterns I reuse after migrating."
author: Michael John Peña
draft: false
date: 2020-08-02
tags:
  - Azure
  - Cosmos DB
  - .NET
  - C#
  - NoSQL
---

The Azure Cosmos DB .NET SDK v3 went GA with version 3.0.0 in July 2019, and I've finally migrated all the Cosmos work I had on v2. The migration was less painful than I expected: containers and items replace URI plumbing, and the LINQ provider honours a camel-case serialiser setting where v2's silently ignored it. But v3 also flipped the default connection mode, and that is what bites in production.

## What actually changed from v2

v2 lives in the `Microsoft.Azure.DocumentDB` (.NET Framework) and `Microsoft.Azure.DocumentDB.Core` (.NET Core) packages and is built around `DocumentClient`, `UriFactory` and resource links. v3 is a single open-source `Microsoft.Azure.Cosmos` package targeting .NET Standard 2.0 that replaces both, and it swaps the URI plumbing for an object model: `CosmosClient` gives you a `Database`, which gives you a `Container`, and you call methods on the container.

| Concern | v2 (`DocumentClient`) | v3 (`CosmosClient`) |
|---|---|---|
| Addressing | `UriFactory.CreateDocumentUri(db, coll, id)` | `container.ReadItemAsync<T>(id, pk)` |
| Default connection | Gateway mode, HTTPS | Direct mode, TCP |
| Query paging | `IDocumentQuery<T>` + `ExecuteNextAsync` | `FeedIterator<T>` + `ReadNextAsync` |
| Missing item on read | `DocumentClientException` | `CosmosException`, or a status code via stream APIs |
| Multi-item writes | Stored procedures | `TransactionalBatch` and bulk mode |
| Configuration | `ConnectionPolicy` | `CosmosClientOptions` or `CosmosClientBuilder` |
| Change feed processor | Separate `Microsoft.Azure.DocumentDB.ChangeFeedProcessor` package | Built in: `container.GetChangeFeedProcessorBuilder` |
| Bulk imports | Separate Bulk Executor library | Built in: `AllowBulkExecution` |

The connection default is the change most likely to break a deployment in a locked-down network. v2 defaulted to Gateway over HTTPS on port 443. v3 defaults to Direct mode over TCP, which is faster because it skips the gateway hop, but it needs outbound access to ports 10000 to 20000 as well as 443. Microsoft's [v3 migration guide](https://learn.microsoft.com/azure/cosmos-db/nosql/migrate-dotnet-v3) and the [connectivity modes page](https://learn.microsoft.com/azure/cosmos-db/nosql/sdk-connection-modes) both spell this out. Direct mode has caught me out behind a corporate firewall before. If you can't get those ports opened, set `ConnectionMode.Gateway` explicitly and accept the extra hop. The other common trigger is a host with a limited pool of outbound SNAT ports, such as [Azure Functions v3](/blog/2020-08-01-azure-functions-v3-dotnet-core/) on the Consumption plan or a small App Service plan: Direct mode opens more TCP connections than Gateway, so on those hosts a single shared client matters even more, and Gateway is a reasonable fallback if you still see port exhaustion.

At the time of writing the current stable release is 3.11.0, so pin to that or later:

```bash
dotnet add package Microsoft.Azure.Cosmos --version 3.11.0
```

## One client, created once

`CosmosClient` is designed to be a singleton for the lifetime of the application. It holds the connection pool, the cached partition address map and the region routing information. I once had a function that created a new client per invocation; every invocation paid the client warm-up cost and the connection churn made the whole thing flaky. Register it once and reuse it everywhere.

```csharp
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.DependencyInjection;

public static class CosmosRegistration
{
    public static IServiceCollection AddCosmos(
        this IServiceCollection services,
        string connectionString,
        ConnectionMode mode,
        string applicationRegion)
    {
        var options = new CosmosClientOptions
        {
            ApplicationRegion = applicationRegion,
            ConnectionMode = mode,
            SerializerOptions = new CosmosSerializationOptions
            {
                PropertyNamingPolicy = CosmosPropertyNamingPolicy.CamelCase
            }
        };

        services.AddSingleton(new CosmosClient(connectionString, options));
        return services;
    }
}
```

The connection mode and region are parameters rather than hard-coded values, so each deployment can choose: pass `ConnectionMode.Direct` (the default) where the TCP ports are open, and `ConnectionMode.Gateway` behind a restrictive firewall or on a SNAT-limited host such as Functions Consumption. I'd read both from configuration and always set them explicitly, so the next person reading the code knows they were deliberate choices. `ApplicationRegion` tells the SDK which region the app runs in (pass a constant such as `Regions.AustraliaEast` from that deployment's settings), so reads go to the nearest replica on a multi-region account and fail over in proximity order.

The camel-case naming policy matters more than it looks. The v3 serialiser is still Newtonsoft.Json under the hood, and Cosmos requires a lowercase `id` property. With `CamelCase` set, a C# `Id` property serialises to `id` without attributes, and the LINQ provider honours the same policy when it translates expressions. Without it, you need `[JsonProperty("id")]` on every model, and your LINQ queries and your stored documents can disagree about property names.

## The repository shape I keep landing on

```csharp
using System;
using System.Net;
using System.Threading.Tasks;
using Microsoft.Azure.Cosmos;

public class Product
{
    public string Id { get; set; }
    public string Category { get; set; }
    public string Name { get; set; }
    public decimal Price { get; set; }
}

public class ProductRepository
{
    private readonly CosmosClient _client;
    private readonly Container _container;

    public ProductRepository(CosmosClient client)
    {
        _client = client;
        _container = client.GetContainer("<your-database>", "products");
    }

    public async Task<Product> CreateAsync(Product product)
    {
        product.Id ??= Guid.NewGuid().ToString();
        ItemResponse<Product> response = await _container.CreateItemAsync(
            product, new PartitionKey(product.Category));
        return response.Resource;
    }

    public async Task<Product> GetAsync(string id, string category)
    {
        using ResponseMessage response = await _container.ReadItemStreamAsync(
            id, new PartitionKey(category));

        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }

        response.EnsureSuccessStatusCode();
        return _client.ClientOptions.Serializer.FromStream<Product>(response.Content);
    }

    public async Task<Product> UpsertAsync(Product product)
    {
        ItemResponse<Product> response = await _container.UpsertItemAsync(
            product, new PartitionKey(product.Category));
        return response.Resource;
    }

    public Task DeleteAsync(string id, string category) =>
        _container.DeleteItemAsync<Product>(id, new PartitionKey(category));
}
```

This assumes the `products` container was created with partition key path `/category`.

Two decisions in there are worth explaining.

**Always pass the partition key.** Every point operation takes a `PartitionKey`. You can omit it on some calls and let the SDK extract it, but being explicit makes the cost model visible in code review: a point read by id and partition key is the cheapest operation Cosmos offers, roughly 1 RU for a 1 KB item.

**Use the stream API when "not found" is normal.** `ReadItemAsync<T>` throws a `CosmosException` on a 404. That's fine when a missing item is genuinely exceptional, but on a cache-aside lookup or an existence check, exceptions on a hot path cost CPU and fill your telemetry with noise. `ReadItemStreamAsync` returns a `ResponseMessage` with a status code and never throws for service errors, so you branch on the status instead. `ClientOptions.Serializer` (populated from 3.9.0) reuses the client's configured serialiser, so the camel-case policy still applies; on older builds, catch `CosmosException` with a `when (ex.StatusCode == HttpStatusCode.NotFound)` filter instead.

## Queries: LINQ for shape, SQL for control

LINQ is the right default when the query is simple and typed. `ToFeedIterator()` turns it into a paged iterator so you control how many round trips you make.

```csharp
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Azure.Cosmos;
using Microsoft.Azure.Cosmos.Linq;

public static class ProductQueries
{
    public static async Task<(List<Product> Items, double RequestCharge)> ByCategoryAsync(
        Container container, string category)
    {
        using FeedIterator<Product> iterator = container.GetItemLinqQueryable<Product>(
                requestOptions: new QueryRequestOptions { PartitionKey = new PartitionKey(category) })
            .Where(p => p.Price > 10)
            .OrderBy(p => p.Name)
            .ToFeedIterator();

        var results = new List<Product>();
        double totalCharge = 0;

        while (iterator.HasMoreResults)
        {
            FeedResponse<Product> page = await iterator.ReadNextAsync();
            totalCharge += page.RequestCharge;
            results.AddRange(page);
        }

        return (results, totalCharge);
    }
}
```

Returning the summed `RequestCharge` alongside the items keeps the cost of the query visible to the caller, which I come back to below. Since 3.10.0 `FeedIterator` is `IDisposable`, so dispose it; the `using` declaration handles that. Setting `PartitionKey` on `QueryRequestOptions` scopes the query to one logical partition. Leave it off and the same LINQ expression becomes a cross-partition fan-out, which works but costs more as the container grows. If the query you're writing can't name a partition key, that's usually a signal to revisit the model, not the query.

When I need a function LINQ doesn't translate cleanly, or I want the exact SQL visible in the code, I switch to `QueryDefinition` with parameters. Never concatenate user input into the query text.

```csharp
var query = new QueryDefinition(
        "SELECT * FROM c WHERE STARTSWITH(c.name, @prefix)")
    .WithParameter("@prefix", "<prefix>");

using FeedIterator<Product> iterator = container.GetItemQueryIterator<Product>(
    query,
    requestOptions: new QueryRequestOptions { PartitionKey = new PartitionKey("<category>") });
```

That's a fragment; the partition key on the request options scopes it to one category, so the `WHERE` clause doesn't need to repeat it. Drain it with the same `while (iterator.HasMoreResults)` loop as above.

## Batch versus bulk: different jobs

Version 3.4.0 (November 2019) made two features public that sound similar but solve different problems, and mixing them up is a common mistake.

**`TransactionalBatch`** is atomic. Every operation must target the same logical partition, and either all succeed or none do. The [transactional batch documentation](https://learn.microsoft.com/azure/cosmos-db/nosql/transactional-batch) explains the model, and the documented limits are up to 100 operations and a 2 MB payload per batch, with a 5-second execution cap. Use it when the items have to change together, such as an order header and its lines that share a partition key. It replaces most of the stored procedures I used to write purely for atomicity.

```csharp
TransactionalBatchResponse response = await container
    .CreateTransactionalBatch(new PartitionKey("<category>"))
    .CreateItem(new Product { Id = "<id-1>", Category = "<category>", Name = "Widget", Price = 12m })
    .UpsertItem(new Product { Id = "<id-2>", Category = "<category>", Name = "Gadget", Price = 20m })
    .ExecuteAsync();

using (response)
{
    if (!response.IsSuccessStatusCode)
    {
        throw new InvalidOperationException(
            $"Batch failed with {response.StatusCode}: {response.ErrorMessage}");
    }
}
```

Fragment: assumes a `Container` named `container` and `using System;`. A batch returns a response rather than throwing on failure, so check `IsSuccessStatusCode`. If one operation fails, the others report status 424 (failed dependency).

**Bulk mode** is about throughput, not atomicity. Set `AllowBulkExecution = true` on `CosmosClientOptions`, then fire many concurrent point operations; the SDK groups them by partition behind the scenes. The [bulk support post](https://devblogs.microsoft.com/cosmosdb/introducing-bulk-support-in-the-net-sdk/) covers how it works, and it replaces the separate Bulk Executor library for .NET. Use it for data loads and backfills. Each operation succeeds or fails independently, and you need enough provisioned RU/s to absorb the load. Bulk mode trades a little latency per operation for throughput, so I give it its own `CosmosClient` instance rather than switching it on for the client that serves user requests.

```csharp
const int chunkSize = 5000;

using var bulkClient = new CosmosClient(connectionString, new CosmosClientOptions { AllowBulkExecution = true });
Container bulkContainer = bulkClient.GetContainer("<your-database>", "products");

var chunk = new List<Product>(chunkSize);
foreach (Product product in products)
{
    chunk.Add(product);
    if (chunk.Count == chunkSize)
    {
        await LoadChunkAsync(bulkContainer, chunk);
        chunk.Clear();
    }
}

if (chunk.Count > 0)
{
    await LoadChunkAsync(bulkContainer, chunk);
}

static async Task LoadChunkAsync(Container container, List<Product> items)
{
    List<Task<ItemResponse<Product>>> tasks = items
        .Select(p => container.CreateItemAsync(p, new PartitionKey(p.Category)))
        .ToList();

    try
    {
        await Task.WhenAll(tasks);
    }
    catch (Exception)
    {
        // Task.WhenAll surfaces only the first failure; inspect each task below.
    }

    foreach (Task<ItemResponse<Product>> task in tasks.Where(t => t.IsFaulted))
    {
        Console.WriteLine(task.Exception.InnerException.Message);
    }
}
```

Fragment: assumes `connectionString`, an `IEnumerable<Product>` named `products` (ideally streamed from the source rather than loaded into memory), and `using System; using System.Collections.Generic; using System.Linq; using System.Threading.Tasks;`. The point is the shape: concurrent tasks within each chunk, not a sequential `await` in a loop, which would give the SDK nothing to group. Chunking matters for real loads: one task per item across millions of rows holds every task and response in memory at once, while a few thousand per `Task.WhenAll` gives the SDK plenty to group and keeps memory flat. Check every task individually, because some items can land while others are throttled or rejected. The `using` declaration disposes the bulk client when the load finishes; if bulk loads run regularly inside a long-lived service, keep one bulk client as a singleton instead of creating one per run.

## Watch the request charge

Every response carries `RequestCharge`. It's the number that tells you whether you've written a query you can afford to run a million times a day. I log it in development and alert on it in production for the hot paths. When a call is slow or expensive, `response.Diagnostics.ToString()` gives you the client-side breakdown: retries, regions contacted and time spent in each stage. That's usually enough to tell a throttling problem from a network one.

## When v3 isn't the answer

Not every v2 codebase should move today. If you built on the v2 change feed processor library or the Bulk Executor library, plan a deliberate cutover rather than a package swap: the change feed processor in v3 uses a different lease format, and Microsoft's [change feed migration guide](https://learn.microsoft.com/azure/cosmos-db/nosql/how-to-migrate-from-change-feed-library) walks through moving leases without reprocessing. And if an application still targets a .NET Framework version older than 4.6.1, it can't consume a .NET Standard 2.0 package at all, so the framework upgrade comes first.

## Where the SDK can't save you

The SDK doesn't fix modelling mistakes. Partition key choice is effectively permanent: you can't change it without moving the data to a new container. Pick a key that spreads writes evenly *and* matches your most common read path. That one decision drives your bill more than any SDK setting.

Cosmos also isn't the right database for everything. If your workload is relational, ad-hoc and query-heavy, Azure SQL Database will cost less and fight you less. If the team doesn't yet understand RUs and consistency levels, Cosmos will be expensive when it's misused.

## My take

If you're still on `DocumentClient`, migrate, and do it in this order so each step is small and testable:

1. Swap the client: a singleton `CosmosClient` with an explicit connection mode and the camel-case serialiser settings.
2. Port point reads and writes, passing partition keys everywhere and using the stream APIs where a 404 is routine.
3. Port queries from `IDocumentQuery<T>` to `FeedIterator<T>`, checking request charges as you go.
4. Replace stored procedures that exist only for atomicity with `TransactionalBatch`, and the Bulk Executor with `AllowBulkExecution`.

For the workloads where Cosmos fits, v3 is the first version of the SDK whose developer experience matches the platform.
