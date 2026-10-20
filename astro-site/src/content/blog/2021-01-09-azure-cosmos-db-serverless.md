---
title: "Cosmos DB Serverless vs Provisioned: Working Out the Break-Even"
description: "How to work out whether Azure Cosmos DB serverless (preview) beats 400 RU/s of provisioned throughput, with the break-even maths and a way to measure it."
author: Michael John Peña
draft: false
date: 2021-01-09
tags:
  - Azure
  - Cosmos DB
  - Serverless
  - Cost Optimization
---

The usual pitch for Azure Cosmos DB serverless is "it's cheaper for small workloads", which is true but not useful when you're the one signing off the architecture. What counts as small? The answer is a number you can calculate. Get it wrong one way and you pay $23 a month for an idle database; get it wrong the other and you pay a per-request premium on a workload that would be cheaper at a flat hourly rate.

I covered what serverless is and how to create an account in [Azure Cosmos DB Serverless: Pay-Per-Request NoSQL](/blog/2020-12-14-azure-cosmos-db-serverless/). This post covers the next question: how to decide between serverless and provisioned throughput with arithmetic instead of gut feel.

## Where serverless stands in January 2021

Serverless is still in **preview**. It [launched for the Core (SQL) API in August 2020](https://devblogs.microsoft.com/cosmosdb/serverless-preview/), and in November 2020 the preview [extended to the MongoDB, Cassandra, Gremlin and Table APIs](https://learn.microsoft.com/azure/cosmos-db/serverless). These preview constraints matter for any cost decision:

- **One Azure region per account.** No geo-replication and no multi-region writes.
- **5,000 RU/s maximum per logical partition.** Microsoft dropped the earlier 5,000 RU/s per-container burst figure from the docs in late November 2020 and doesn't publish a container-level number during the preview, so load-test any burst above that before relying on it.
- **50 GB maximum storage per container.**
- **No free tier.** A serverless account can't use the free tier discount.
- **No financially backed SLA.** Like every Azure preview, it isn't covered by the standard SLA yet.
- **No in-place switch.** You choose serverless or provisioned when you create the account. Moving between them means migrating data to a new account.
- **Portal-only account creation during the preview.** ARM templates and the Azure CLI aren't supported for creating serverless accounts yet, which matters if you provision everything through infrastructure as code.

None of these rules serverless out for dev/test or internal tools. Several of them rule it out for customer-facing production today, whatever the cost maths says.

## The two billing models side by side

Both models charge for storage the same way, at $0.25 per GB per month, so storage drops out of the comparison. The difference is entirely in how you pay for request units (RUs).

| | Serverless (preview) | Standard provisioned | Autoscale provisioned |
|---|---|---|---|
| What you pay for | RUs consumed | RU/s reserved, per hour | Highest RU/s reached each hour |
| Unit price (US list, single-region) | $0.25 per million RUs | $0.008 per 100 RU/s per hour | $0.012 per 100 RU/s per hour |
| Minimum monthly throughput cost | $0 | $23.36 (400 RU/s) | $35.04 (400 RU/s floor, 4,000 RU/s max) |
| Throughput ceiling | 5,000 RU/s per logical partition (no published container figure) | What you provision | Your chosen maximum |
| Multi-region | No | Yes | Yes |

The serverless rate comes from the [preview announcement](https://devblogs.microsoft.com/cosmosdb/serverless-preview/). Provisioned prices vary by region, so check the [pricing page](https://azure.microsoft.com/pricing/details/cosmos-db/) for yours before you put these numbers in front of a finance team. The method doesn't change, only the constants.

One thing doesn't change between the modes: **an operation costs the same number of RUs either way.** A 1 KB point read is about 1 RU and a 1 KB insert with default indexing is roughly 5 to 6 RUs, whether the account is serverless or provisioned. So you can measure RU consumption on whatever account you already have and price it both ways.

## The break-even number

Take the cheapest provisioned option: a single container (or a shared-throughput database) at the 400 RU/s minimum.

- 400 RU/s × $0.008 per 100 RU/s per hour × 730 hours = **$23.36 per month**
- $23.36 ÷ $0.25 per million RUs = **93.4 million RUs per month**
- 93.4 million ÷ 2,628,000 seconds in a 730-hour month = **about 36 RU/s on average**

That's the threshold. **If your workload averages more than roughly 36 RU/s around the clock, 400 RU/s of provisioned throughput is cheaper than serverless.** That is only about 9% utilisation of the provisioned capacity. Serverless charges roughly 11 times more per RU than a fully used provisioned container. You come out ahead only when the provisioned capacity would sit mostly idle.

Against autoscale at its minimum ($35.04 a month), the break-even rises to about 140 million RUs a month, or roughly 53 RU/s average. Autoscale earns its 50% premium on spiky production workloads that need to scale past 400 RU/s. It's rarely the right comparison point for the small workloads serverless targets.

To make 93 million RUs concrete, it's roughly:

- 93 million 1 KB point reads a month, about 3 million a day, or
- 15 to 18 million 1 KB inserts a month, or
- far fewer queries if they fan out across partitions or return large result sets.

Take an internal line-of-business API that does 200,000 point reads and 20,000 small writes on a working day. At 20 working days, that's about 4 million reads plus 2.4 million write RUs, so around 6.4 million RUs a month. Serverless bills that at $1.60 against $23.36 provisioned. For workloads shaped like that, the decision isn't close.

## The free tier changes the answer

The comparison above assumes you pay for the first 400 RU/s. If the subscription hasn't used its [free tier](https://learn.microsoft.com/azure/cosmos-db/free-tier) account yet, the first 400 RU/s and 5 GB on one account cost nothing (at the time of writing; Microsoft has since raised the allowance). Serverless can't beat free. A single small app that fits in 400 RU/s and 5 GB belongs on a free tier provisioned account, which also gives you multi-region options and an SLA.

Serverless wins when you've already used the free tier, or when you have many small databases. Think a dev/test account per developer, per-feature environments, or a handful of rarely used internal tools. That's where 400 RU/s minimums multiply into a real line item. Within one app, a shared-throughput database already removes the per-container minimum (one 400 RU/s database can hold up to 25 containers), so serverless only wins when the minimums are per account or per database, as with per-developer accounts.

## Measure before you decide

Estimates from RU tables go wrong as soon as queries get involved, so I measure. The approach: run a representative business operation a few hundred times, record the RU charge, and multiply by how many of those operations you expect each month. The v3 .NET SDK makes this easy with a custom `RequestHandler`, which sees every response and its `x-ms-request-charge` header. The probe runs unchanged against the local [Azure Cosmos DB Emulator](https://learn.microsoft.com/azure/cosmos-db/local-emulator) (connection string `AccountEndpoint=https://localhost:8081/;AccountKey=<emulator-key>`). The emulator doesn't support serverless, but it reports the standard RU charges, so measuring costs nothing.

Create the project with `dotnet new console`, then `dotnet add package Microsoft.Azure.Cosmos --version 3.15.1` (the current v3 release, from December 2020).

```csharp
using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Azure.Cosmos;

var meter = new RuMeter();
var options = new CosmosClientOptions();
options.CustomHandlers.Add(meter);

using var client = new CosmosClient("<your-connection-string>", options);
Database database = await client.CreateDatabaseIfNotExistsAsync("costprobe");
// No throughput argument: works on a serverless account, and on a provisioned
// account the container gets the default 400 RU/s.
Container container = await database.CreateContainerIfNotExistsAsync("orders", "/customerId");

const int samples = 500;
for (int i = 0; i < samples; i++)
{
    // One "business operation": save an order, then read it back.
    var order = new Order
    {
        id = Guid.NewGuid().ToString(),
        customerId = $"customer-{i % 50}",
        status = "placed",
        total = 42.50m
    };
    await container.UpsertItemAsync(order, new PartitionKey(order.customerId));
    await container.ReadItemAsync<Order>(order.id, new PartitionKey(order.customerId));
}

double ruPerOperation = meter.TotalCharge / samples;
double expectedOperationsPerMonth = 2_000_000; // replace with your own forecast
double monthlyRus = ruPerOperation * expectedOperationsPerMonth;

Console.WriteLine($"RU per operation:   {ruPerOperation:F2}");
Console.WriteLine($"Projected RU/month: {monthlyRus:N0}");
Console.WriteLine($"Serverless cost:    ${monthlyRus / 1_000_000 * 0.25:F2}");
Console.WriteLine($"400 RU/s provisioned: $23.36");

public class Order
{
    public string id { get; set; }
    public string customerId { get; set; }
    public string status { get; set; }
    public decimal total { get; set; }
}

public class RuMeter : RequestHandler
{
    private readonly object _lock = new object();
    public double TotalCharge { get; private set; }

    public override async Task<ResponseMessage> SendAsync(
        RequestMessage request, CancellationToken cancellationToken)
    {
        ResponseMessage response = await base.SendAsync(request, cancellationToken);
        lock (_lock)
        {
            TotalCharge += response.Headers.RequestCharge;
        }
        return response;
    }
}
```

This uses C# 9 top-level statements, so it needs the .NET 5 SDK. The total includes the one-off database and container creation calls. Over 500 samples they barely move the average, but subtract them if you're probing a cheap operation. The handler only counts operations that go through the SDK's request pipeline, which covers the item, query and container calls used here.

If the workload already runs on a provisioned account, skip the synthetic test and read what it actually consumed. The `TotalRequestUnits` metric in Azure Monitor gives you real RU usage, and the `CollectionName` dimension splits it by container. Start with hourly totals for the month:

```bash
az monitor metrics list \
    --resource "/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.DocumentDB/databaseAccounts/<account-name>" \
    --metric TotalRequestUnits \
    --aggregation Total \
    --interval PT1H \
    --filter "CollectionName eq '*'" \
    --start-time 2020-12-01T00:00:00Z \
    --end-time 2021-01-01T00:00:00Z
```

Sum the hourly totals across containers and compare against 93 million. An hourly total can't show a burst, so pull the busiest day again at one-minute granularity:

```bash
az monitor metrics list \
    --resource "/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.DocumentDB/databaseAccounts/<account-name>" \
    --metric TotalRequestUnits \
    --aggregation Total \
    --interval PT1M \
    --filter "CollectionName eq '*'" \
    --start-time 2020-12-14T00:00:00Z \
    --end-time 2020-12-15T00:00:00Z
```

Divide each minute's total by 60 for the average RU/s in that minute, per container. Even per-minute data understates per-second peaks, so treat it as a floor. If a container regularly averages thousands of RU/s within a minute, you're relying on burst capacity that serverless doesn't guarantee during the preview, with no SLA behind it, no matter how cheap the monthly sum looks.

## When the cheap option is the wrong one

The break-even maths covers cost. These are the cases where I'd pick provisioned even when serverless comes out cheaper:

- **Customer-facing production during the preview.** No SLA and a single region is a hard no for anything with an availability commitment.
- **Bursty batch jobs.** A nightly import that pushes 20,000 RU/s for ten minutes might average out cheap, but serverless gives you no guaranteed burst ceiling and no SLA during the preview. The SDK's default retry policy hides 429s for a while (nine retries, up to 30 seconds of waiting), then the job fails. Provisioned or autoscale lets you size for the burst.
- **Containers heading past 50 GB.** You'll hit the storage cap and need to migrate to a new account, which is a worse day than paying $23 a month from the start.
- **Anything that might need a second region.** There's no upgrade path, so pick provisioned upfront.

## My rule of thumb

Measure RUs per operation, multiply by monthly volume, and compare against 93 million RUs. Below 93 million RUs a month serverless is cheaper on paper. Well below it (under about 10 million) it's an easy call for dev/test, prototypes and quiet internal tools, provided the preview limits don't bite. In between, weigh growth forecasts and the preview limits, because a workload that doubles crosses the line. Above it, provisioned throughput wins on cost. And if the free tier is still available on the subscription, use it for your one small production app before you consider either.
