---
title: "Fabric Real-Time Analytics After GA: An End-to-End Streaming Design"
description: "How Eventstream, KQL databases, Power BI and the Data Activator preview fit together in Fabric as of January 2024, and when to choose something else."
author: Michael John Peña
draft: false
date: 2024-01-18
tags:
  - Microsoft Fabric
  - Real-Time Analytics
  - Eventstreams
  - KQL
  - Data Activator
  - Streaming
---

I've built several streaming pipelines on Fabric, and the hard part is never getting events to land. It's deciding where each job belongs: what Eventstream should do, what the KQL database should do, and what still isn't ready to trust in production. Two months after [Fabric went GA](/blog/2023-11-10-microsoft-fabric-ga/), the pieces have different maturity levels, and a design that treats every component as production-ready will put a preview feature on your critical path. Here is the end-to-end design I'd use today for a telemetry-style workload (devices, apps or clickstream sending JSON events), with deeper dives on [Eventstream patterns](/blog/2024-01-19-eventstreams-patterns/) and [KQL performance](/blog/2024-01-20-kql-realtime-analytics/) to follow.

## What is actually in the box in January 2024

Microsoft announced GA at Ignite on 15 November 2023, and the workload is called **Real-Time Analytics**. The "Synapse" prefix from the preview has gone. Not every component shares the GA status, though:

| Component | Job | Status (Jan 2024) |
|---|---|---|
| Eventstream | No-code capture, light transformation and routing of events | GA, part of Real-Time Analytics |
| KQL database | Storage and query engine (the Kusto engine behind Azure Data Explorer) | GA |
| KQL queryset | Saved KQL queries, shareable, can feed a Power BI report | GA |
| OneLake data availability (one logical copy) | Exposes KQL table data to OneLake as Delta | [Preview](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-house-onelake-availability) |
| Data Activator (Reflex items) | Detect conditions and trigger email, Teams or Power Automate actions | Public preview |

The OneLake row carries constraints worth knowing before you switch it on. Once a table has availability enabled, existing data isn't backfilled, the table schema can't be altered, and data can't be deleted or purged. Enable it only on stable, typed tables, never on a table you expect to reshape.

The Data Activator row is the one to plan around. If an alert is part of an operational process with an SLA, you should not hang it off a preview feature.

## The reference design

```text
Devices / apps ──► Event Hubs or Eventstream custom app
                          │
                     Eventstream ──────────────► Reflex (Data Activator, preview)
                          │
                          ▼
                KQL database: RawTelemetry (landing)
                          │  update policy
                          ▼
                DeviceTelemetry (typed) ──► materialized views
                          │
             KQL querysets + Power BI (DirectQuery)
```

My view is that every stage should do the smallest job it can. Eventstream routes events. The KQL database owns parsing, history and aggregation. Power BI and Data Activator read results and own nothing. When a transformation lives in exactly one place, you know where to look when the numbers look wrong.

## Ingestion: keep Eventstream thin

[Eventstream sources](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/add-manage-eventstream-sources) currently include Azure Event Hubs, Azure IoT Hub, sample data and a **custom app** endpoint. Destinations include a KQL database, a lakehouse, a custom app and a Reflex. The custom app source gives you a connection string, so anything that can talk to Event Hubs can send to it with the `azure-eventhub` SDK:

```python
# pip install azure-eventhub
import json
import os
import random
from datetime import datetime, timezone

from azure.eventhub import EventData, EventHubProducerClient

# Connection string copied from the Eventstream custom app source (includes EntityPath).
producer = EventHubProducerClient.from_connection_string(
    os.environ["EVENTSTREAM_CONNECTION_STRING"]
)


def reading(device_id: str) -> dict:
    return {
        "deviceId": device_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "sensors": {"temperature": round(random.uniform(18, 45), 2),
                    "humidity": round(random.uniform(30, 80), 2)},
        "battery": round(random.uniform(10, 100), 1),
    }


with producer:
    batch = producer.create_batch()
    for i in range(500):
        event = EventData(json.dumps(reading(f"device-{i % 20:03d}")))
        try:
            batch.add(event)
        except ValueError:  # batch full: send it and start a new one
            producer.send_batch(batch)
            batch = producer.create_batch()
            batch.add(event)
    producer.send_batch(batch)
```

If you already run Event Hubs for other consumers, point Eventstream at the hub with its own consumer group rather than moving producers to the custom app endpoint. That keeps Fabric as one consumer among many, and nothing in Fabric becomes a single point of failure for your event backbone.

The no-code event processor (filter, manage fields, aggregate, group by, expand and union) is useful for dropping junk or splitting a stream before it hits a destination. I wouldn't put business logic there. It's harder to version and test than KQL, and the logic is hidden from anyone who only reads the database. My rule of thumb: Eventstream can *remove* things, the KQL database *derives* things.

## Storage: land raw, parse with an update policy

The mistake I see most often is mapping JSON straight into a wide typed table. The first time a firmware update renames a field, ingestion either fails or silently writes nulls. Land the payload as `dynamic`, then project it into a typed table with an [update policy](https://learn.microsoft.com/en-us/kusto/management/update-policy). Run each command separately, in order, in a KQL queryset; the tables and the function must exist before the update policy that references them:

```kql
.create table RawTelemetry (Payload: dynamic)

.create table RawTelemetry ingestion json mapping 'RawMapping' '[{"column":"Payload","Properties":{"Path":"$"}}]'

.create table DeviceTelemetry (Timestamp: datetime, DeviceId: string, Temperature: real, Humidity: real, BatteryLevel: real)

.create-or-alter function ParseTelemetry() {
    RawTelemetry
    | project
        Timestamp = todatetime(Payload.timestamp),
        DeviceId = tostring(Payload.deviceId),
        Temperature = toreal(Payload.sensors.temperature),
        Humidity = toreal(Payload.sensors.humidity),
        BatteryLevel = toreal(Payload.battery)
    | where isnotempty(DeviceId) and isnotnull(Timestamp)
}

.alter table DeviceTelemetry policy update @'[{"IsEnabled": true, "Source": "RawTelemetry", "Query": "ParseTelemetry()", "IsTransactional": true}]'

.alter-merge table RawTelemetry policy retention softdelete = 14d

.alter table DeviceTelemetry policy caching hot = 30d
```

When you add the KQL database destination in Eventstream, choose **Direct ingestion**, point it at the existing `RawTelemetry` table and select the `RawMapping` JSON mapping, rather than letting the wizard create a new table and mapping of its own.

With this setup a schema change becomes a function change, and you can replay from `RawTelemetry` while it's still within retention. Set the raw table's retention to cover the replay window you'd actually need. Two weeks is usually enough to notice a parsing bug.

Then pre-aggregate the queries dashboards will hammer. Materialized views are maintained incrementally, so a dashboard reading five-minute buckets doesn't rescan the raw rows on every refresh:

```kql
.create materialized-view with (backfill=true) DeviceTelemetry5m on table DeviceTelemetry
{
    DeviceTelemetry
    | summarize AvgTemp = avg(Temperature), MaxTemp = max(Temperature), Readings = count()
        by DeviceId, bin(Timestamp, 5m)
}

.create materialized-view with (backfill=true) DeviceLastSeen on table DeviceTelemetry
{
    DeviceTelemetry
    | summarize arg_max(Timestamp, *) by DeviceId
}
```

Don't put `now()` or `ago()` inside a materialized view. The view is computed incrementally, so time-relative filters belong in the query that reads it.

## Serving: querysets and Power BI

For analysts, KQL querysets are the natural workspace. For business users, build Power BI reports over the KQL database in DirectQuery mode and turn on automatic page refresh where it earns its cost. The capacity admin controls the minimum refresh interval, and every refresh is a query against your capacity. Point visuals at the materialized views:

```kql
// Fleet health tile
DeviceLastSeen
| extend MinutesSilent = datetime_diff('minute', now(), Timestamp)
| extend Status = case(MinutesSilent < 5, "Online", MinutesSilent < 30, "Degraded", "Offline")
| summarize Devices = count() by Status

// Devices running hot relative to their own baseline
let baseline = DeviceTelemetry5m
    | where Timestamp between (ago(24h) .. ago(15m))
    | summarize Mean = avg(AvgTemp), Sd = stdev(AvgTemp) by DeviceId;
DeviceTelemetry5m
| where Timestamp > ago(15m)
| summarize Current = avg(AvgTemp) by DeviceId
| join kind=inner baseline on DeviceId
| where Sd > 0
| extend ZScore = (Current - Mean) / Sd
| where abs(ZScore) > 3
| project DeviceId, Current, Mean, ZScore
```

Comparing each device against its own history catches more than a fixed threshold. Note that the baseline is computed over five-minute means, not raw readings, so the spread is narrower than the raw data and short spikes are smoothed out; the threshold is less sensitive to single bad readings than it would be on the raw table. A sensor that normally sits at 22°C and jumps to 35°C matters. One that always reads 38°C usually doesn't. It is still a statistical heuristic, not a model, so tune the threshold with the people who'll respond to it.

Refresh-driven dashboards also consume capacity continuously. Before you put a wall screen on a ten-second refresh, read how [Fabric smooths and throttles capacity usage](/blog/2024-01-14-fabric-capacity-management/).

## Actions: Data Activator, for notifications only

[Data Activator](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/data-activator/activator-introduction) is the piece most people want, and it's the least mature. In preview, a Reflex gets data from an Eventstream (as a destination) or from Power BI visuals. It doesn't query a KQL database directly yet, and no public API lets you define triggers in code. You model *objects* (a device, say), define triggers on their properties, and choose an action: email, a Teams message, or a Power Automate flow for anything custom.

I'd use it today for notification-grade alerts: "tell the site lead when a freezer has been above threshold for ten minutes". I wouldn't use it for anything where a missed or duplicated action has real consequences, such as shutting down equipment or paging on-call. For those, keep your existing path (Azure Monitor alerts, Logic Apps, or an Azure Function consuming Event Hubs) until Data Activator reaches GA and you've seen how it behaves under load.

## When not to use this stack

- **You need complex stateful stream processing** (windowed joins across streams, custom logic, exactly-once outputs to another system). Azure Stream Analytics or Spark Structured Streaming are the right tools. Eventstream's processor is deliberately simple.
- **You already run Azure Data Explorer well.** Moving to a KQL database in Fabric buys you OneLake integration and a single capacity bill, not a better engine. Migrate when you have a reason, not because it's new.
- **Your organisation hasn't sized a Fabric capacity.** Streaming ingestion and frequent dashboard queries create steady background load. On a small F SKU shared with Spark and warehouse jobs, that load competes with everything else.
- **The "real-time" requirement is really hourly.** A scheduled pipeline into a lakehouse is cheaper and simpler. Be honest about the latency the business actually acts on.

## The decision

Real-Time Analytics in Fabric is a sound choice in January 2024 if you treat it as three layers with three maturity levels. Eventstream and KQL databases are GA and production-ready for ingestion and analytics. OneLake data availability (one logical copy) is preview, doesn't backfill and locks the table schema, so turn it on only for stable typed tables and don't make it the only path to your lakehouse. Data Activator is preview, so use it for notifications, not control. Keep transformations in KQL, land raw before you parse, and point every consumer at materialized views. That design holds up whether Data Activator ships next quarter or later.
