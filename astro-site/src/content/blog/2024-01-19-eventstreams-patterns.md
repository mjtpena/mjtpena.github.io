---
title: "Fabric Eventstream Patterns: Deciding Where Stream Logic Lives"
description: "Practical Fabric Eventstream patterns: what belongs in the no-code event processor, what belongs in KQL, and what to fix before events arrive."
author: Michael John Peña
draft: false
date: 2024-01-19
tags:
  - Microsoft Fabric
  - Eventstreams
  - Streaming
  - KQL
  - Architecture
---

Eventstream became generally available with Microsoft Fabric at Ignite in November 2023, and the design question that matters now is not "how do I connect Event Hubs?" but "where should this logic go?" A Fabric streaming pipeline has three places to put logic: the producer, the Eventstream event processor, and the KQL database behind it. Put a rule in the wrong place and you get pipelines that are hard to change, results you can't correct, and capacity spent on work you didn't need to do.

For the basics of creating an eventstream, see my [introduction to Eventstreams](/blog/2023-07-21-eventstreams/); for the end-to-end picture, see [yesterday's post on Fabric streaming analytics](/blog/2024-01-18-fabric-realtime-intelligence/).

## What Eventstream actually gives you today

It's worth being precise, because a lot of content describes Eventstream as if it were Azure Stream Analytics with a Fabric badge. It isn't. As of January 2024, the [Eventstream docs](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/overview) listed an item with:

| Area | What's available |
|---|---|
| Sources | Azure Event Hubs, Azure IoT Hub, Sample data, Custom App (an endpoint you push to over the Event Hubs, AMQP or Kafka protocols) |
| Destinations | KQL Database, Lakehouse, Custom App (for consumers), Reflex (Data Activator, still in preview) |
| Processing | The no-code event processor: Filter, Manage fields, Aggregate, Group by, Expand, Union |
| Windows (Group by) | Tumbling, hopping, sliding, session and snapshot |

There is no SQL query surface in Eventstream. There is no reference-data join against a Lakehouse table, no user-defined functions, and no public REST API for defining an eventstream. You build the topology on a canvas. If a design depends on any of those things, that's a signal the logic belongs somewhere else, not a gap to work around.

## Pattern 1: Land raw first, shape in KQL

My default for almost every new stream is a KQL Database destination using **direct ingestion**: events go straight into a table through an ingestion mapping, with no event processor in the path. The [KQL Database destination docs](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/add-destination-kql-database) describe the two modes, direct ingestion and event processing before ingestion. Choose the mode deliberately; changing it later means deleting and re-adding the destination.

Why raw first:

- **You can replay your own mistakes.** If a parsing rule is wrong, the raw table still has the original events. If you filtered or reshaped in the event processor, the discarded data is gone.
- **KQL is better at transformation than a canvas.** Update policies, materialized views and functions are versionable as scripts. A canvas isn't.
- **Late data gets handled for you.** A materialized view keeps re-aggregating as late rows arrive. A windowed Group by in the event processor emits a result when the window closes, and a straggler that turns up afterwards won't fix the number you already wrote.

The shaping then lives in the database. In a KQL queryset, run each control command on its own. First the raw table:

```kusto
.create table RawTelemetry (
    deviceId: string,
    eventTime: datetime,
    temperature: real,
    humidity: real,
    eventType: string,
    severity: int
)
```

Then a summary view over it. If the raw table already holds data, add `with (backfill=true)` after `materialized-view` so existing rows are included; on a new, empty table it makes no difference.

```kusto
.create materialized-view DeviceTelemetry5m on table RawTelemetry
{
    RawTelemetry
    | summarize
        events = count(),
        avgTemperature = avg(temperature),
        maxTemperature = max(temperature)
        by deviceId, bin(eventTime, 5m)
}
```

And when producers retry and send duplicates (they will), a last-value view gives you a clean "current state per device" without touching the stream:

```kusto
.create materialized-view DeviceLatest on table RawTelemetry
{
    RawTelemetry
    | summarize arg_max(eventTime, *) by deviceId
}
```

**When not to use it:** if the raw volume is large and most of it is noise you will never query, landing everything costs ingestion and storage you don't need. That's the case for Pattern 2.

## Pattern 2: Filter and trim in the event processor

The event processor earns its place when it *reduces* data in ways you're sure about. Good candidates:

- **Filter** out heartbeat or debug events that no consumer reads.
- **Manage fields** to drop large payload fields, rename awkward source names, and cast types before they reach a table.
- **Expand** an array of readings into one row per reading, so the destination table has a sensible grain.

Each of these is a stateless, row-by-row decision that's easy to reason about. Use **event processing before ingestion** on the KQL destination, or the Lakehouse destination, which runs through the event processor to define the table schema.

The trade-off is reversibility. Anything you drop here is gone. My rule of thumb: filter in Eventstream only when you'd be comfortable explaining to an auditor why that data was never stored. If you hesitate, land it raw, put a short retention policy on the raw table, and filter in KQL.

## Pattern 3: Fan out the same stream by consumer, not by rule

One eventstream can feed several destinations, and each destination can have its own processing. This is where Eventstream is genuinely useful, because the alternative is consumer groups and separate jobs on the Event Hub.

A pattern that holds up well:

| Destination | Processing | Purpose |
|---|---|---|
| KQL Database | Direct ingestion | Raw, queryable history for operations and investigation |
| Lakehouse | Manage fields, light filtering | Delta tables for Spark, data science and Power BI models |
| Reflex | None, or Filter on the events that matter | Alerts and actions via Data Activator |

Route by *who consumes it*, not by business rule. One eventstream supports at most 11 sources and destinations combined, so fan-out by consumer, not by category, also keeps you under that ceiling. The temptation is to build three filtered branches for "high", "normal" and "error" events and send each to a different table. That pushes classification logic into a canvas where it's hard to test, and every new category means editing the topology. Classify in KQL with a column or a function, and let downstream queries filter.

Reflex is still preview, so treat that branch as something you can lose without breaking the other two. I'll cover the alerting side in [the Data Activator post](/blog/2024-01-21-reflex-alerts/).

**When not to use it:** if two destinations need materially different shapes of the same data, you can end up maintaining two event processors that drift apart. At that point, land once in KQL and derive the second shape from there.

## Pattern 4: Windowed aggregates only when the consumer needs the aggregate

Group by in the event processor supports tumbling, hopping, sliding, session and snapshot windows, with the same semantics as the [Stream Analytics window functions](https://learn.microsoft.com/en-us/azure/stream-analytics/stream-analytics-window-functions). They're useful, but they're the pattern I recommend least often.

Use an Eventstream window when the destination should *only ever* see the aggregate: a Lakehouse table of per-minute counts for a report, where storing every raw event in the Lakehouse would be wasteful. Even then, I'd usually keep the raw events in KQL alongside it.

Watch file sizes on any Lakehouse branch. The destination writes files either by **Rows per file** (1 to 2 million) or by **Duration** (1 minute to 2 hours); for a low-volume stream, pick Duration so you aren't writing a tiny file every few seconds. Streaming Delta tables still accumulate small files, so schedule table optimisation (`OPTIMIZE`, which the destination's table optimisation shortcut runs for you in a notebook) rather than waiting for reads to slow down.

Don't use one for dashboards or anomaly checks that people will query interactively. A materialized view or a query over `bin()` gives you the same answer, lets you change the window size without redeploying anything, and copes with late events. Window size is a business decision that changes more often than people expect ("can we see it per minute instead?"), and changing a KQL query is cheaper than reworking a stream.

## Pattern 5: Fix event quality at the producer

Some problems can't be solved downstream, and the cheapest fix is in the code that sends the events:

- **Include an event timestamp.** Eventstream records when it received an event, not when it happened. Without your own `eventTime`, every time-based query is really measuring network and buffering delay.
- **Partition by entity.** Using the device or customer ID as the partition key keeps ordering per entity.
- **Send JSON with a stable shape.** Add fields freely, but don't change the type of an existing field. Mappings and Lakehouse schemas don't forgive that.
- **Batch.** Sending one event per call is a common and avoidable cause of poor throughput.

The Custom App source gives you an Event Hubs-compatible connection string, so the standard [`azure-eventhub` Python library](https://learn.microsoft.com/en-us/python/api/overview/azure/eventhub-readme) works unchanged. This producer sends a batch per device with a partition key and an explicit event time:

```python
import json
import os
from datetime import datetime, timezone

from azure.eventhub import EventData, EventHubProducerClient

# Copy the connection string from the Custom App source in your eventstream.
# It already includes the EntityPath, so no event hub name is needed.
CONNECTION_STRING = os.environ["EVENTSTREAM_CONNECTION_STRING"]


def build_reading(device_id: str, temperature: float, humidity: float) -> dict:
    return {
        "deviceId": device_id,
        "eventTime": datetime.now(timezone.utc).isoformat(),
        "temperature": temperature,
        "humidity": humidity,
        "eventType": "TELEMETRY",
        "severity": 1,
    }


def send_readings(device_id: str, readings: list[dict]) -> None:
    producer = EventHubProducerClient.from_connection_string(CONNECTION_STRING)
    with producer:
        batch = producer.create_batch(partition_key=device_id)
        for reading in readings:
            event = EventData(json.dumps(reading))
            try:
                batch.add(event)
            except ValueError:
                # Batch is full: send it and start a new one.
                producer.send_batch(batch)
                batch = producer.create_batch(partition_key=device_id)
                batch.add(event)
        if len(batch) > 0:
            producer.send_batch(batch)


if __name__ == "__main__":
    sample = [build_reading("device-001", 21.5 + i * 0.1, 48.0) for i in range(100)]
    send_readings("device-001", sample)
```

Keep the connection string in Key Vault or your app's secret store, not in source control. It's a shared access key with send rights to the stream.

## Watching the pipeline

Eventstream shows data insights for each source and destination (incoming and outgoing event counts) and runtime logs for errors such as mapping failures. Those are the first places to look when a table stops growing. Because there's no metrics API for Eventstream yet, I monitor the outcome instead of the pipe. A freshness query like the one below tells you more than any canvas; run it on a schedule from a Data Factory pipeline [KQL activity](https://learn.microsoft.com/en-us/fabric/data-factory/kql-activity), or pin it to a Power BI report and put a Data Activator alert on the visual.

```kusto
RawTelemetry
| where ingestion_time() > ago(1h)
| summarize
    events = count(),
    lastIngested = max(ingestion_time()),
    medianDelay = percentile(ingestion_time() - eventTime, 50)
    by window = bin(ingestion_time(), 5m)
| order by window desc
```

A rising median delay between `eventTime` and ingestion time is your early warning for producer batching problems, throttling, or a capacity under pressure. That only works because Pattern 5 put the timestamp in the event.

## The placement rule

If I had to compress this into one decision rule: **the producer owns correctness, Eventstream owns routing and safe reduction, KQL owns meaning.** Timestamps, keys and schema stability belong at the source. Fan-out, filtering noise and trimming payloads belong in Eventstream. Classification, aggregation, deduplication and anything you might want to change next month belong in KQL, where they can be re-run against raw data.

Eventstream is a good router with a capable but deliberately simple processor. Designs go wrong when they treat it as the place for business logic. Keep the canvas boring and the interesting work in a database that can replay history.
