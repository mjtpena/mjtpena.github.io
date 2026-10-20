---
title: "Where Streaming Logic Belongs in Fabric: Eventstream, KQL or Spark"
description: "A decision guide for placing filters, enrichment, aggregation and alerts across Eventstream, Eventhouse and Spark in Fabric Real-Time Intelligence."
author: Michael John Peña
draft: false
date: 2025-01-12
tags:
  - Microsoft Fabric
  - Real-Time Intelligence
  - Eventstream
  - KQL
  - Streaming
  - Architecture
---

Fabric gives you at least three places to put streaming logic: the Eventstream canvas, the Eventhouse (through KQL update policies and materialized views), and Spark Structured Streaming in a notebook. All three can filter, reshape and aggregate events, so most teams pick whichever one the first engineer was comfortable with. That choice decides your cost profile, how you replay bad data, and who can debug the pipeline when it breaks out of hours, so it deserves more thought than it usually gets.

With Real-Time Intelligence now generally available (Microsoft announced GA for Real-Time hub, the enhanced Eventstream, Eventhouse, Real-Time Dashboards and Activator at Ignite in November 2024; the [Real-Time Intelligence overview](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/overview) maps the pieces), this is a good moment to settle the question before patterns harden. This post is a placement guide, not a feature tour. If you want the tour, I covered the [Eventstream enhancements](/blog/2024-11-23-eventstream-enhancements/) and [Eventhouses](/blog/2024-06-02-eventhouses-fabric/) separately.

## The default I start from

My rule of thumb: **land raw events in an Eventhouse first, and move logic upstream only when you have a specific reason.**

The reasoning is simple. Once raw events are in a KQL table, you can re-derive anything. If a parsing rule was wrong, you fix the function and backfill the affected time range from the raw table. If logic ran upstream in Eventstream and dropped or mangled events before they landed, those events are gone. Eventstream retains events for a configurable window (1 day by default, up to 90), which is a buffer, not a replayable history you'd want to depend on. Keeping raw data costs storage, which is cheap in an Eventhouse with a sensible retention policy. Losing raw data costs you an incident review.

That default pushes most transformation into KQL, which suits the people who usually own these pipelines: analysts and data engineers who already think in queries, not in Spark jobs.

## What each layer is good at

| Concern | Eventstream operators | Eventhouse (KQL) | Spark Structured Streaming |
|---|---|---|---|
| Filtering and dropping fields | Good, cheap to configure | Good, via update policy | Good |
| Routing to several destinations | Best fit | Not its job | Possible, more code |
| Enrichment with reference data | Limited (Join is stream-to-stream) | Strong (`lookup`, joins to dimension tables) | Strong |
| Windowed aggregation | Group by with tumbling, hopping, sliding, session windows | Materialized views, `bin()` at query time | Full control, watermarks |
| Replay after a logic bug | Hard | Easy, raw table stays | Possible via checkpoints and Delta history |
| Complex logic, ML scoring | No | Some (KQL ML functions, Python plugin) | Best fit |
| Skills needed | Low-code canvas | KQL | PySpark, checkpoint management |

### Eventstream: route and trim, don't compute

The [Eventstream event processor](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/process-events-using-event-processor-editor) offers Filter, Manage fields, Aggregate, Group by, Expand, Union and Join. These are useful for two jobs: shaping events so they fit a destination, and splitting a single source into derived streams for different consumers.

The detail that matters most is how the Eventhouse destination ingests. The [Eventhouse destination](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/add-destination-kql-database) has two modes:

- **Direct ingestion** lets the Eventhouse pull events from the default stream (or a derived stream) with no Eventstream operators in between.
- **Event processing before ingestion** runs your operators first and then pushes the result into the table.

Direct ingestion keeps the pipeline simple and leaves the raw shape intact. Processing before ingestion is what you need when you want operators applied on the way into that table, and it brings the Eventstream processor's capacity consumption with it. So every operator you add to the canvas has a cost on your Fabric capacity and a cost in lost replayability.

I use Eventstream operators when:

- A noisy source sends fields or event types nobody will ever query, and dropping them early saves meaningful storage.
- The same feed needs to go to an Eventhouse, a lakehouse and Activator with different shapes.
- A downstream system needs a pre-aggregated feed and you're comfortable that the raw copy lands somewhere else.

I avoid them for business logic. The canvas isn't version-controlled in a form most reviewers can read, and the Join operator joins two streams inside a time window. It isn't a lookup against a customer or device table, so enrichment doesn't belong there.

### Eventhouse: the transformation layer for most teams

Inside an Eventhouse, the pattern I recommend is a raw table, a parsing function, an [update policy](https://learn.microsoft.com/en-us/kusto/management/update-policy) that runs that function on every ingestion, and [materialized views](https://learn.microsoft.com/en-us/kusto/management/materialized-views/materialized-view-overview) for the aggregates dashboards hit repeatedly.

```kusto
// Raw landing table: Eventstream writes here using direct ingestion
.create table RawTelemetry (payload: dynamic)

// Map the whole JSON event into the payload column.
// Select 'RawMapping' as the existing mapping when you configure the data connection.
.create table RawTelemetry ingestion json mapping 'RawMapping' '[{"column":"payload","Properties":{"Path":"$"}}]'

// Curated table with a typed schema
.create table Telemetry (
    DeviceId: string,
    Temperature: real,
    Humidity: real,
    ReadingTime: datetime,
    IngestedAt: datetime
)

// Parsing logic lives in a function, so it can be versioned and re-run
.create-or-alter function with (folder = "transforms") ParseTelemetry() {
    RawTelemetry
    | extend
        DeviceId = tostring(payload.deviceId),
        Temperature = todouble(payload.temperature),
        Humidity = todouble(payload.humidity),
        ReadingTime = todatetime(payload.timestamp)
    | where isnotempty(DeviceId) and isnotnull(ReadingTime)
    | project DeviceId, Temperature, Humidity, ReadingTime, IngestedAt = ingestion_time()
}

// Run the function on every batch that lands in RawTelemetry
.alter table Telemetry policy update
@'[{"IsEnabled": true, "Source": "RawTelemetry", "Query": "ParseTelemetry()", "IsTransactional": false}]'

// Keep raw data long enough to replay, curated data as long as the business needs
.alter-merge table RawTelemetry policy retention softdelete = 30d
.alter-merge table Telemetry policy retention softdelete = 365d

// Pre-aggregate what dashboards query every few seconds
.create materialized-view with (backfill = true) DeviceMetrics5m on table Telemetry {
    Telemetry
    | summarize
        AvgTemp = avg(Temperature),
        MaxTemp = max(Temperature),
        Readings = count()
        by DeviceId, bin(ReadingTime, 5m)
}
```

Two decisions in there are worth explaining.

`IsTransactional: false` means a failure in the parsing function doesn't fail ingestion into the raw table. I prefer that for telemetry: the raw events still land and I can fix the function and backfill.

Backfill needs care, because re-running `ParseTelemetry()` over all of `RawTelemetry` re-appends rows that are already in `Telemetry`. Bound it to the window the bug affected, after removing the bad rows for that range (or rebuild into a new table and swap it in):

```kusto
// Remove the rows the broken function produced, then re-derive only that range
.delete table Telemetry records <| Telemetry | where IngestedAt between (datetime(<start>) .. datetime(<end>))

.set-or-append Telemetry <| ParseTelemetry() | where IngestedAt between (datetime(<start>) .. datetime(<end>))
```

`IngestedAt` is the raw row's `ingestion_time()`, so the same window selects the same source events both times. One catch: a materialized view doesn't see deletes on its source table, so `DeviceMetrics5m` will still hold the old aggregates for that range. After a backfill I drop and recreate the view with `backfill = true` rather than trying to patch it. If downstream correctness matters more than availability (for example, finance events that must never appear in one table and not the other), set it to `true` and accept that a bad function blocks ingestion until it's fixed.

The materialized view handles the "dashboard tiles hammer the same aggregate" problem. Real-Time Dashboards and Power BI both benefit, because the aggregation is maintained incrementally instead of recomputed on every refresh. I keep views to aggregates that are queried constantly; a view nobody queries is just extra ingestion work.

Enrichment also lands well here. A small `Devices` dimension table and a `lookup` in the parsing function (or at query time) beats any attempt to do the same in Eventstream.

### Spark: when the logic outgrows KQL

Spark Structured Streaming earns its place when you need scoring with a trained model, logic that's awkward in KQL (multi-step stateful processing, complex deduplication across long horizons), or when the destination is a lakehouse Delta table feeding a medallion architecture that the rest of your platform already uses.

Add a [custom endpoint destination](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/add-destination-custom-app) to the eventstream; its Kafka tab exposes a Kafka-compatible endpoint that a Fabric notebook can read with Spark's Kafka source. This is a fragment for a Fabric notebook. Take the bootstrap server, topic and connection string from that destination's Details pane (SAS Key Authentication), and keep the connection string in Key Vault rather than in the notebook.

```python
from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StructField, StringType, DoubleType, TimestampType

# Values from the Eventstream custom endpoint destination (Kafka tab) details pane
bootstrap_servers = "<your-namespace>.servicebus.windows.net:9093"
topic = "<your-eventstream-topic>"
connection_string = notebookutils.credentials.getSecret(
    "https://<your-key-vault>.vault.azure.net/", "<eventstream-connection-secret>"
)

jaas = (
    'org.apache.kafka.common.security.plain.PlainLoginModule required '
    f'username="$ConnectionString" password="{connection_string}";'
)

schema = StructType([
    StructField("deviceId", StringType()),
    StructField("temperature", DoubleType()),
    StructField("humidity", DoubleType()),
    StructField("timestamp", TimestampType()),
])

events = (
    spark.readStream.format("kafka")
    .option("kafka.bootstrap.servers", bootstrap_servers)
    .option("subscribe", topic)
    .option("kafka.security.protocol", "SASL_SSL")
    .option("kafka.sasl.mechanism", "PLAIN")
    .option("kafka.sasl.jaas.config", jaas)
    .option("startingOffsets", "latest")
    .load()
    .select(F.from_json(F.col("value").cast("string"), schema).alias("e"))
    .select("e.*")
)

# Five-minute averages per device, tolerating ten minutes of late data
per_device = (
    events.withWatermark("timestamp", "10 minutes")
    .groupBy(F.window("timestamp", "5 minutes"), "deviceId")
    .agg(F.avg("temperature").alias("avg_temp"), F.count("*").alias("readings"))
    .select(
        F.col("window.start").alias("window_start"),
        F.col("window.end").alias("window_end"),
        "deviceId", "avg_temp", "readings",
    )
)

query = (
    per_device.writeStream.format("delta")
    .outputMode("append")
    .option("checkpointLocation", "Files/checkpoints/device_5m")
    .toTable("device_metrics_5m")
)
```

The costs of this route are real. A streaming notebook holds Spark compute for as long as it runs, so it consumes capacity continuously, not just when events arrive. You own the checkpoint directory, and changing the query shape often means a new checkpoint and a decision about where to restart from. Watermarks need tuning per source. None of that is hard for a data engineering team that already runs Spark, but it's a lot to hand to a team that just wanted a live dashboard.

If what you actually need is "latest minute of data, queryable in seconds", Spark into Delta is usually the wrong tool. Write latency to Delta plus the lakehouse's SQL analytics endpoint sync is not what an operations dashboard needs. That's what an Eventhouse is for.

## Alerts: keep them close to the curated data

Activator is the alerting layer in Real-Time Intelligence, and it can watch an Eventstream directly, and (in preview) run against KQL queryset queries and Real-Time Dashboard visuals. My preference is to alert on curated data (the `Telemetry` table or a materialized view) rather than on the raw stream, for the same reason as above: thresholds belong next to the logic that defines what a "reading" is. Alerting on the raw stream means duplicating parsing rules in two places, and they will drift.

The exception is a hard, simple threshold on a field that needs no parsing, where seconds matter. Then attaching Activator to the Eventstream is reasonable.

## When not to use Real-Time Intelligence at all

Not every "real-time" request needs streaming. If the business reviews the numbers every morning, a scheduled pipeline into a lakehouse is cheaper and easier to support. If the source is an operational database and the goal is analytical queries over near-current data, look at [mirroring](/blog/2024-08-02-fabric-mirroring-ga/) before building an event pipeline. And if your organisation has no one comfortable with KQL, budget for that learning curve explicitly; the Eventhouse-centred design above depends on it.

## The decision, in short

- Land raw events in an Eventhouse with direct ingestion wherever you can. It's the cheapest path and keeps replay possible.
- Use Eventstream operators for routing and trimming, not business logic.
- Put parsing, enrichment and standing aggregates in KQL with update policies and materialized views.
- Reach for Spark only when the logic needs it or the destination is your lakehouse medallion layers, and accept that you're signing up for always-on compute and checkpoint management.
- Alert on curated data unless a raw-field threshold genuinely can't wait.

Most of the messy Fabric streaming designs I see come down to logic being split across all three layers without a reason. Choose a home for each concern, write it down, and the pipeline stays debuggable long after the person who built it has moved on.
