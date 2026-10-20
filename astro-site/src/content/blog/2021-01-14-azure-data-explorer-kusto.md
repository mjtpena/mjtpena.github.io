---
title: "Azure Data Explorer for IoT Telemetry: Ingestion, Caching and Rollups"
description: "Designing an Azure Data Explorer database for device telemetry: queued vs streaming ingestion, hot cache sizing, materialized views and KQL time series."
author: Michael John Peña
draft: false
date: 2021-01-14
tags:
  - Azure
  - Azure Data Explorer
  - KQL
  - IoT
  - Time Series
---

If you've used Log Analytics or Azure Sentinel, you've already used the Azure Data Explorer (ADX) engine; they're built on it. As a standalone service, it's what I recommend for IoT and product telemetry when "billions of events, interactive queries" becomes a product requirement, in the space where Synapse would be too heavy and Cosmos DB too expensive. Most of the ADX projects I see that go wrong don't fail on KQL, though. They fail on three design decisions made in the first week: how data gets in, how much of it stays hot, and what gets pre-aggregated.

I covered the KQL basics for log data in [an earlier post](/blog/2020-08-31-azure-data-explorer-basics/). This one is about device telemetry specifically, and the choices that decide whether your cluster bill and your dashboard latency stay reasonable.

## Start with the table, not the cluster

Telemetry tables in ADX should be narrow, typed and append-only. Resist the urge to land the raw JSON into a single `dynamic` column and "sort it out later". It works, but every query then pays the cost of parsing, the columns you filter on constantly (device, time) don't get the same compression, and time filters can't prune extents on a timestamp buried in JSON.

```kusto
.create table Telemetry (
    Timestamp: datetime,
    DeviceId: string,
    DeviceType: string,
    Temperature: real,
    Humidity: real,
    Pressure: real
)

.create table Telemetry ingestion json mapping 'TelemetryMapping' '[{"column":"Timestamp","path":"$.timestamp","datatype":"datetime"},{"column":"DeviceId","path":"$.deviceId","datatype":"string"},{"column":"DeviceType","path":"$.deviceType","datatype":"string"},{"column":"Temperature","path":"$.temperature","datatype":"real"},{"column":"Humidity","path":"$.humidity","datatype":"real"},{"column":"Pressure","path":"$.pressure","datatype":"real"}]'
```

Create the ingestion mapping up front and give it a name. Event Hub and IoT Hub data connections reference it by name, and streaming ingestion requires a pre-created mapping; it won't accept an inline one.

My one exception to "no `dynamic`": if devices send a long tail of optional fields that differ by firmware version, keep the core measurements as typed columns and put the rest into a single `dynamic` column. You get fast queries on what matters and you don't lose data when a new firmware ships.

The middle ground I use most is a two-table pattern: land events as-is in a narrow staging table, and attach an [update policy](https://learn.microsoft.com/azure/data-explorer/kusto/management/updatepolicy) to the typed table that runs a parsing query on every ingested batch and appends the result. The raw table keeps a short retention as a replay buffer, and a firmware change that breaks parsing becomes a fix to one function rather than lost data. The cost is that the transformation runs as part of ingestion, so a heavy or failing policy query slows or fails ingestion into the source table too; keep the query simple.

## Queued or streaming ingestion

This is the decision people most often get backwards. Streaming ingestion sounds like the obvious choice for "real-time" telemetry, and it's [generally available](https://learn.microsoft.com/azure/data-explorer/ingest-data-streaming), no longer a preview feature. But queued (batched) ingestion is the default for good reasons.

| | Queued ingestion | Streaming ingestion |
|---|---|---|
| Latency to query | Governed by the batching policy (by default, up to 5 minutes, 1,000 items or 1 GB, whichever comes first) | Typically under 10 seconds |
| Best fit | High volume into a few tables | Many tables, each with low volume |
| Throughput guidance | Scales to very large volumes | Use bulk ingestion above about 4 GB per hour per table |
| Per-request limit | Large files and blobs | 4 MB per request |
| Cluster cost | No reserved resources | Uses part of the local SSD, reducing hot cache, once enabled on the cluster |
| Other restrictions | None notable | No database cursors, no extent tags, the database can't be a leader for follower databases or a data provider for Azure Data Share |

The default [batching policy](https://learn.microsoft.com/azure/data-explorer/kusto/management/batchingpolicy) is the part most teams don't know about. If a dashboard needs data within a minute rather than five, the first thing I'd try is tightening the batching policy on that table, not turning on streaming:

```kusto
.alter table Telemetry policy ingestionbatching @'{"MaximumBatchingTimeSpan":"00:00:30", "MaximumNumberOfItems": 500, "MaximumRawDataSizeMB": 1024}'
```

Smaller batches mean more, smaller extents and more merge work in the background, so don't drop it lower than the business genuinely needs. "Real-time" in a requirements document very often means "fresher than yesterday's report".

Streaming earns its place when you have a genuine sub-minute requirement, or when you ingest into hundreds of tables each receiving a trickle (one table per customer, for example) and batching would leave every table waiting on its own timer. To use it, switch **Streaming ingestion** on under the cluster's **Configurations** blade, then enable the policy on the table or database:

```kusto
.alter table Telemetry policy streamingingestion enable
```

### Where the data comes from

For devices, the sensible path is IoT Hub or Event Hubs with an ADX data connection. You configure the target table, the format and the mapping name on the connection, and ADX pulls the events. There's no code to own. Both [Event Hub](https://learn.microsoft.com/azure/data-explorer/create-event-hubs-connection) and IoT Hub connections honour the table's streaming policy if you've enabled it.

You write custom ingestion code when the data arrives somewhere else, such as an API gateway, a gateway process on site, or a back-fill job. The Python SDK (`azure-kusto-data` and `azure-kusto-ingest`) shipped version 2.0.0 last week, and the main change you'll notice is that `KustoIngestClient` is now `QueuedIngestClient`. The streaming client is unchanged. Note that it talks to the engine endpoint, not the `ingest-` endpoint the queued client uses:

```python
import io
import json
import os
from datetime import datetime, timezone

from azure.kusto.data import KustoConnectionStringBuilder
from azure.kusto.data.exceptions import KustoServiceError
from azure.kusto.ingest import (
    DataFormat,
    IngestionMappingType,
    IngestionProperties,
    KustoStreamingIngestClient,
)

# azure-kusto-data==2.0.0 and azure-kusto-ingest==2.0.0
cluster = "https://<your-cluster>.<region>.kusto.windows.net"
kcsb = KustoConnectionStringBuilder.with_aad_application_key_authentication(
    cluster,
    os.environ["KUSTO_CLIENT_ID"],
    os.environ["KUSTO_CLIENT_SECRET"],
    os.environ["KUSTO_TENANT_ID"],
)
client = KustoStreamingIngestClient(kcsb)

properties = IngestionProperties(
    database="telemetry",
    table="Telemetry",
    data_format=DataFormat.JSON,
    ingestion_mapping_type=IngestionMappingType.JSON,
    ingestion_mapping_reference="TelemetryMapping",
)

readings = [
    {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "deviceId": "sensor-001",
        "deviceType": "Sensor",
        "temperature": 23.5,
        "humidity": 65.2,
        "pressure": 1013.25,
    }
]

# Newline-delimited JSON; keep each request well under the 4 MB limit
payload = "\n".join(json.dumps(r) for r in readings).encode("utf-8")
try:
    client.ingest_from_stream(io.BytesIO(payload), properties)
except KustoServiceError as err:
    # Raised when streaming isn't enabled, the request is throttled or the
    # payload doesn't match the mapping. Retry transient failures with backoff,
    # or hand the batch to a QueuedIngestClient instead.
    print(f"Streaming ingestion failed: {err}")
    raise
```

If streaming isn't enabled on the cluster and table, this call fails rather than silently falling back to queued ingestion. Catch the error and retry or fall back yourself; the client doesn't do it for you.

## Hot cache is your real cost lever

ADX keeps all data in Azure Storage and caches the most recent slice on the cluster's local SSDs. Queries over the hot window are fast; queries that reach into cold data still work but read from storage and are noticeably slower. The cluster size you need is mostly a function of how much compressed data you keep hot, not how much you keep in total.

```kusto
.alter-merge table Telemetry policy retention softdelete = 365d recoverability = enabled

.alter table Telemetry policy caching hot = 31d
```

Set both explicitly; don't rely on defaults. My rule of thumb: the hot window should match what people actually look at on dashboards and in investigations, which for device telemetry is usually days to a few weeks. A year of history for trend analysis can live cold, especially once the rollups below exist. If a stakeholder insists on a year hot, put the cost of the extra nodes in front of them before you agree.

## Materialized views for rollups and latest state

Dashboards rarely want raw readings. They want "the latest reading per device" and "hourly averages per device", and recomputing those over billions of rows on every refresh is wasteful. [Materialized views](https://learn.microsoft.com/azure/data-explorer/kusto/management/materialized-views/materialized-view-overview) keep an aggregation up to date as data is ingested, and querying the view combines the materialized part with the small delta not yet processed.

```kusto
.create async materialized-view with (backfill=true, autoUpdateSchema=true) DeviceLatest on table Telemetry
{
    Telemetry
    | summarize arg_max(Timestamp, *) by DeviceId
}

.create async materialized-view with (backfill=true) TelemetryHourly on table Telemetry
{
    Telemetry
    | summarize AvgTemp = avg(Temperature), MaxTemp = max(Temperature), Readings = count()
        by DeviceId, bin(Timestamp, 1h)
}
```

`DeviceLatest` answers "what is every device reporting right now" without scanning the table. Both views use `backfill=true`; without it a view only covers records ingested after it was created, so `DeviceLatest` would miss every device that hasn't reported since. `autoUpdateSchema=true` matters because of the schema advice above: with `arg_max(Timestamp, *)`, adding a column to `Telemetry` changes the view's schema, and without that option the view is automatically disabled. The trade-off is that dropping a source column also drops it from the view irreversibly, so if your schema is fixed, listing explicit columns in `arg_max` is the safer choice. `TelemetryHourly` is what the trend charts should read from. Because the view aggregates by event `Timestamp`, readings that arrive late from a device that was offline still land in the right hour.

Two caveats as of today. Materialized views are still in **preview**, and the guidance while they're in preview is to keep at least seven days of retention with recoverability enabled on the source table, and to keep the number of views per cluster small (Microsoft suggests no more than ten). The `summarize` must be the last operator, and only a defined list of aggregations is supported. Each view also consumes cluster CPU continuously, so a view nobody queries is pure overhead. I'd build them for the two or three access patterns that dominate your dashboards and leave ad-hoc questions to the raw table.

## Time series analysis without leaving KQL

This is where ADX pulls ahead of a general-purpose database for telemetry. `make-series` turns rows into regular time series per device, and the series functions work on all of them at once:

```kusto
Telemetry
| where Timestamp > ago(14d)
| make-series AvgTemp = avg(Temperature) default = real(null) on Timestamp step 1h by DeviceId
| extend AvgTemp = series_fill_linear(AvgTemp)
| extend (Flags, Score, Baseline) = series_decompose_anomalies(AvgTemp, 2.5)
| mv-expand Timestamp to typeof(datetime), AvgTemp to typeof(real), Flags to typeof(int), Score to typeof(real)
| where Flags != 0
| project DeviceId, Timestamp, AvgTemp, Score
| order by abs(Score) desc
```

Note the `default = real(null)` and `series_fill_linear`. By default `make-series` fills empty bins with zero, and for a temperature sensor that went offline for an hour, a zero reading is itself an "anomaly". That one detail accounts for most of the false positives I see when people first try [`series_decompose_anomalies`](https://learn.microsoft.com/azure/data-explorer/kusto/query/series-decompose-anomalies-function).

Forecasting works the same way, except the series has to extend into the future so there are empty points to fill:

```kusto
Telemetry
| where DeviceId == "sensor-001"
| make-series AvgTemp = avg(Temperature) default = real(null) on Timestamp from ago(14d) to now() + 24h step 1h
| extend AvgTemp = series_fill_linear(AvgTemp)
| extend Forecast = series_decompose_forecast(AvgTemp, 24)
| render timechart
```

These are seasonal decomposition models, not machine learning platforms. They're excellent at "flag the devices behaving unlike their own last two weeks" across thousands of devices in seconds. If you need models that learn from labelled failures, export the features to Azure Machine Learning and keep ADX as the feature store.

## When ADX is the wrong choice

- **Point lookups and updates.** ADX is append-oriented. If the application needs to read and update individual device records (configuration, ownership), that's Cosmos DB or Azure SQL. Use ADX for the readings, not the device registry.
- **Low volume.** If total telemetry is a few gigabytes a month, an always-on cluster is hard to justify. Azure SQL with a clustered columnstore index, or Log Analytics, will be cheaper and simpler. Even the Dev (No SLA) SKU is a running VM you pay for while it's up, and it has no SLA, so it isn't for production. Stopping the cluster outside working hours helps for dev and test, but not for a workload devices write to around the clock.
- **Stream processing with actions.** ADX answers questions over data that has landed. If you need to react to each event in flight (window, join, trigger an alert or a command), put Stream Analytics or Functions in front of it.
- **Your team only needs IoT dashboards.** Time Series Insights Gen2 is a more packaged option for operational IoT exploration. ADX gives you more control and a far more capable query language in exchange for more design work.

## The short version

For device telemetry, I'd start with queued ingestion from IoT Hub or Event Hubs and tighten the batching policy before reaching for streaming. Size the cluster around the hot cache window, not total retention. Add materialized views for the latest-state and hourly-rollup queries your dashboards hit constantly, accepting that they're in preview for now. Then let `make-series` and the [anomaly detection and forecasting functions](https://learn.microsoft.com/kusto/query/anomaly-detection?view=azure-data-explorer) do the analysis that would otherwise need a separate pipeline. Get those three decisions right in the first week and the KQL is the easy part.
