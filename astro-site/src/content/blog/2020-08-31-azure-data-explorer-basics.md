---
title: "Azure Data Explorer or Log Analytics? Choosing Where Logs Live"
description: "Log Analytics and Azure Data Explorer share the Kusto engine; here is when a dedicated ADX cluster is worth it for log data and when it isn't."
author: Michael John Peña
draft: false
date: 2020-08-31
tags:
  - Azure
  - Azure Data Explorer
  - KQL
  - Log Analytics
---

Most teams on Azure already run Kusto queries every day without calling it that. Log Analytics and Application Insights sit on the same engine as Azure Data Explorer (ADX), so the real question isn't whether KQL is good for logs. It is whether you should keep paying per GB for a managed workspace, or run your own ADX cluster and own the retention, caching and schema yourself. Get this wrong and you either overpay for years of logs nobody queries, or you take on a cluster you never needed.

## Same engine, different products

ADX has been generally available since February 2019. It is a managed cluster: you choose the VM SKU and instance count, create databases and tables with explicit schemas, and pay for compute and storage whether you query or not. Log Analytics is a SaaS layer on the same engine. Microsoft runs the cluster, the tables come predefined by whichever agent or diagnostic setting writes to them, and you pay mostly for ingestion volume.

That shared engine is the reason the choice can be made later rather than up front. A query you write against Application Insights `requests` will run against an ADX table with the same shape. The differences are in operations and cost, not in the language. The [Azure Data Explorer overview](https://learn.microsoft.com/azure/data-explorer/data-explorer-overview) covers the service and its intended scenarios if you want Microsoft's own framing.

| Concern | Log Analytics workspace | Azure Data Explorer cluster |
|---|---|---|
| Who runs the compute | Microsoft | You (SKU, instance count, scaling) |
| Schema | Fixed by the data source, plus custom logs | Whatever you define |
| Retention | Up to 730 days | Set per database or table, as long as you need |
| Cost driver | GB ingested and retained | Cluster hours plus storage |
| Native Azure integration | Diagnostic settings, agents, alerts, Sentinel | Event Hub, Event Grid, IoT Hub, SDKs |
| Best at | Operational monitoring of Azure resources | High-volume custom telemetry and long history |

## When a dedicated cluster pays off

My rule of thumb is that ADX starts to make sense when two of these three are true.

**The volume is large and steady.** Per-GB pricing is great when volume is small or spiky, and it gets painful when you push a few hundred GB a day of application or device telemetry. Cluster compute is a largely fixed cost that does not rise with every extra GB, although storage and the hot-cache footprint still grow with volume, so plan node count from the hot window, not from ingestion alone. Before you leave, price the workspace capacity reservation tiers (from 100 GB/day). They cut the per-GB rate, and that is the real number to compare with cluster hours plus storage.

**You need history beyond what a workspace holds.** Log Analytics retention tops out at 730 days. If audit, product analytics or a regulator wants three or five years of queryable data, ADX lets you set the retention policy per table and keep only recent data in hot cache, so old data sits on cheaper storage and is still queryable.

**You own the schema.** IoT readings, clickstream, game telemetry and custom business events don't fit neatly into the tables an agent creates. In ADX you design the table, the ingestion mapping and the update policies that reshape raw data on arrival.

If none of these apply, stay in Log Analytics. You get alert rules, workbooks, diagnostic settings for nearly every Azure resource and Azure Sentinel on top, all without a cluster to size, patch or watch.

## When not to use ADX

ADX is not a cheaper Log Analytics with the same features. A few things I'd flag before anyone commits:

- **Azure Monitor alerting does not point at your cluster.** Log alert rules run against workspaces and Application Insights. With ADX you build alerting yourself, usually with a scheduled job or a Logic App that runs a query and acts on the result.
- **Diagnostic settings don't write to ADX directly.** To land resource logs in a cluster you route them through Event Hubs and add an Event Hub data connection. That is one more moving part per data source.
- **The minimum cost is real.** A production cluster runs around the clock. The Dev (No SLA) SKU is fine for proofs of concept, but it has no SLA and limited capacity, so it is not a production answer.
- **It is not a transactional store.** ADX is append-mostly and optimised for scans and aggregations. Point updates and frequent deletes are the wrong workload.

The split I'd recommend for most organisations is simple: platform and security logs go to Log Analytics, high-volume application or device telemetry that the business analyses goes to ADX.

## Designing a log table in ADX

Once you choose ADX, the decisions that matter most are schema, retention and cache. Here is a table for request telemetry with a one-year retention policy and 14 days of hot cache. Run each of these control commands separately (select it and run) in the ADX Web UI or Kusto.Explorer:

```kql
.create table Requests (
    Timestamp: datetime,
    Name: string,
    DurationMs: real,
    ResultCode: int,
    OperationId: string
)

.alter-merge table Requests policy retention softdelete = 365d

.alter table Requests policy caching hot = 14d
```

The [cache policy](https://learn.microsoft.com/azure/data-explorer/kusto/management/cache-policy) is the setting that drives cost. Queries over hot data hit local SSD and memory on the cluster nodes, while older data stays in storage and is still queryable, just slower. Size the hot window to what people actually query day to day, not to the full retention period. That gap is where ADX gets cheaper than keeping everything hot.

## Querying it

The language is the same KQL you use in Log Analytics, which is why moving workloads between the two isn't a rewrite. Finding the slowest requests in the last hour:

```kql
Requests
| where Timestamp > ago(1h)
| where DurationMs > 5000
| project Timestamp, Name, DurationMs, ResultCode
| order by DurationMs desc
| take 100
```

Trends over time are where ADX feels fast on large tables, because `bin()` aggregations over a time column are exactly what the engine is built for:

```kql
Requests
| where Timestamp > ago(24h)
| summarize Requests = count(), AvgDurationMs = avg(DurationMs), P95DurationMs = percentile(DurationMs, 95) by bin(Timestamp, 1h)
| render timechart
```

I always look at percentiles alongside the average. An average hides the slow tail, and the slow tail is usually what users complain about.

## Getting data in: queued or streaming

ADX gives you two ingestion paths, and choosing the wrong one is a common source of either latency complaints or wasted capacity.

**Queued (batched) ingestion** is the default. Data is buffered and committed in batches, by default within about five minutes. It is the most efficient path for high throughput, and the default for Event Hub, IoT Hub and Event Grid data connections and for the queued SDK clients (Event Hub and IoT Hub connections can also stream into a table that has a streaming ingestion policy).

**Streaming ingestion** is generally available (since July 2020). Data is queryable within seconds, and it is aimed at many tables that each receive a small amount of data. Microsoft's guidance is to stay with queued ingestion for more than about 4 GB per hour per table. Streaming also has to be [enabled on the cluster first](https://learn.microsoft.com/azure/data-explorer/ingest-data-streaming) and then on the table or database:

```kql
.alter table Requests policy streamingingestion enable
```

Read the limits before you switch it on. Each streaming request is capped at 4 MB. Ingestion mappings must be created in advance, because a streaming request can't carry an inline mapping. Concurrency scales with cores, at about six concurrent requests per core, so a two-core D11 node handles 12. The one that catches people out is cost: enabling streaming on a cluster reserves part of each node's local SSD for streaming data, even if nothing streams, and that shrinks the space left for hot cache. Since the hot cache is the main cost lever covered above, turn streaming on only for a workload that needs seconds of latency.

Here is a complete console program using the `Microsoft.Azure.Kusto.Ingest` NuGet package (tested shape: version 8.1.x, the current release in August 2020, on .NET Core 3.1, which gives you the C# 8 `using var` syntax) that streams a small CSV payload into that table with an Azure AD application. The column order in the CSV matches the table schema, so no mapping is needed.

```csharp
using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Kusto.Data;
using Kusto.Data.Common;
using Kusto.Data.Exceptions;
using Kusto.Ingest;

public static class Program
{
    public static async Task Main()
    {
        // Engine endpoint, not the ingest- endpoint: streaming goes straight to the engine.
        var clusterUri = "https://<your-cluster>.<region>.kusto.windows.net";
        var appId = Environment.GetEnvironmentVariable("ADX_APP_ID");
        var appKey = Environment.GetEnvironmentVariable("ADX_APP_KEY");
        var tenantId = Environment.GetEnvironmentVariable("ADX_TENANT_ID");

        var kcsb = new KustoConnectionStringBuilder(clusterUri)
            .WithAadApplicationKeyAuthentication(appId, appKey, tenantId);

        var csv = new StringBuilder()
            .AppendLine("2020-08-31T01:15:00Z,GET /orders,6120.5,200,op-0001")
            .AppendLine("2020-08-31T01:15:02Z,POST /checkout,830.0,500,op-0002")
            .ToString();

        using var client = KustoIngestFactory.CreateStreamingIngestClient(kcsb);
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(csv));

        var properties = new KustoIngestionProperties("<your-database>", "Requests")
        {
            Format = DataSourceFormat.csv
        };

        try
        {
            var result = await client.IngestFromStreamAsync(stream, properties);
            foreach (var status in result.GetIngestionStatusCollection())
            {
                Console.WriteLine($"Ingestion status: {status.Status}");
            }
        }
        catch (KustoException ex)
        {
            // Streaming has no queue behind it: a failed request is not retried for you.
            // Retry with backoff when ex.IsPermanent is false (throttling, transient errors);
            // fix the payload or schema when it is true.
            Console.Error.WriteLine($"Streaming ingestion failed (permanent: {ex.IsPermanent}): {ex.Message}");
            throw;
        }
    }
}
```

Streaming is the right call for a modest stream you want to see immediately. If you're pushing serious volume from many producers, put Event Hubs in front of the cluster and use an Event Hub data connection with queued ingestion. You get buffering, retries and back-pressure without writing them yourself.

## How I'd decide

Start in Log Analytics. It is the right home for Azure resource logs, security data and anything you want to alert on, and if you're already sending [Application Insights telemetry from ASP.NET Core](/blog/2020-08-11-azure-application-insights-monitoring/) you're writing KQL there today. It also doesn't have to be either/or: the Azure Data Explorer proxy (preview) lets you [query Log Analytics workspaces and Application Insights apps from ADX](https://learn.microsoft.com/azure/data-explorer/query-monitor-data) and join them with cluster tables, so platform logs can stay in the workspace while custom telemetry lives in the cluster. Move a workload to Azure Data Explorer when the per-GB bill, the 730-day retention ceiling or a custom schema becomes the constraint, and plan the routing (usually Event Hubs) before you plan the cluster. Because the query language carries across, that move is about operations and cost, not about relearning how to ask questions of your data.

Before you commit, do the break-even sum yourself with the [Azure Data Explorer pricing page](https://azure.microsoft.com/pricing/details/data-explorer/) and the pricing calculator. The cluster side has four components: the VM cost of the engine nodes (two is the production minimum, for example two D11_v2 nodes), the Azure Data Explorer markup charged per vCore, the storage for the full retention period, and the choice between pay-as-you-go and reserved capacity, which discounts the markup and VMs for a one- or three-year commitment. The workspace side is your daily ingestion at either the pay-as-you-go rate or the nearest capacity reservation tier, plus retention beyond the included period. Run both at your real daily volume, and remember that streaming ingestion and a bigger hot window both push the cluster towards larger nodes. If the cluster is not clearly cheaper, or clearly solving a retention or schema problem, the workspace is still the better deal.
