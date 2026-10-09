---
title: "Real-Time Intelligence in Microsoft Fabric: A Working Example"
description: "Here's what it is, how it works, and a pattern that's running in production. Traditional analytics is batch-oriented. Data lands in storage, gets processed…"
author: Michael John Peña
draft: false
date: 2026-02-26
tags:
  - Fabric
  - Real-Time
  - Data
  - Engineering
---

Here's what it is, how it works, and a pattern that's running in production.

## The Problem RTI Solves

Traditional analytics is batch-oriented. Data lands in storage, gets processed, then queried.

That's fine for historical reporting. It's not fine when a customer's order is stuck, a sensor is overheating, or a payment is being fraudulently processed.

Real-time analytics bridges the gap between "data arrived" and "insight available." In Fabric, that gap is measured in seconds.

## The Components

**Eventstream:** Ingest events from sources—IoT Hub, Event Hubs, Kafka, custom apps. Route, filter, and transform in flight before storage.

**Eventhouse:** KQL-based database optimized for high-cardinality, time-series event data. Sub-second queries across billions of rows.

**Real-Time Dashboard:** Live visuals that refresh on a cadence you define—every few seconds if needed.

**Activator (Reflex):** Event-driven automation. When X happens in your data, trigger Y. Email, Teams message, Power Automate flow.

## A Production Pattern: Equipment Monitoring

This is a simplified version of a real deployment. Manufacturing client. 200+ sensors across multiple facilities.

**The setup:**

```
IoT Hub
    ↓
Eventstream (filter + route)
    ↓              ↓
Eventhouse    Lakehouse
(real-time)   (historical)
    ↓              ↓
RTI Dashboard  Power BI
    ↓
Activator
(alert when threshold exceeded)
```

**Eventstream configuration:**

Events arrive from IoT Hub. The Eventstream:
- Filters out calibration events (known noise)
- Adds facility metadata via lookup
- Routes to Eventhouse for real-time
- Routes to Lakehouse for historical analysis

No code. Point-and-click in the Fabric portal.

**Eventhouse KQL query for live monitoring:**

```kql
SensorReadings
| where ingestion_time() > ago(5m)
| where SensorType == "temperature"
| summarize
    avg_temp = avg(ReadingValue),
    max_temp = max(ReadingValue),
    reading_count = count()
  by DeviceId, FacilityId, bin(ingestion_time(), 1m)
| where avg_temp > 75
| join kind=leftouter (
    DeviceMetadata
    | project DeviceId, DeviceName, CriticalThreshold
) on DeviceId
| extend alert_level = case(
    avg_temp > CriticalThreshold, "critical",
    avg_temp > 75, "warning",
    "normal"
)
| order by avg_temp desc
```

This query powers a dashboard tile that refreshes every 30 seconds.

**Activator rule:**

When any sensor's 5-minute average exceeds critical threshold: send Teams message to the facility manager, log alert to Lakehouse, create maintenance ticket via Power Automate.

Zero code for the alerting layer. The business logic is in KQL.

## What Makes This Different from Traditional Approaches

Before Fabric RTI, this architecture required:

- Azure IoT Hub (same)
- Azure Stream Analytics for real-time processing
- Azure Data Explorer for the KQL database
- Custom alerting logic in Azure Functions
- Separate visualization in Grafana or custom app

Five services. Five billing meters. Five sets of credentials and access controls.

Fabric RTI: all of this in one workspace. Same OneLake storage. Unified access control. One billing model.

The engineering complexity dropped significantly. The time to build this pattern went from weeks to days.

## Limitations to Know

**RTI is optimized for append-only data.** Corrections and updates to past events are awkward. Design your event schema to be immutable.

**Long-term retention costs.** Eventhouse pricing scales with data volume. For data older than your real-time window, move it to Lakehouse. Keep Eventhouse lean.

**Dashboard refresh latency.** Real-time dashboards have a minimum refresh of about 30 seconds. True second-level latency requires custom apps querying the Eventhouse API directly.

**KQL learning curve.** If your team knows only SQL, plan for ramp-up time.

## When to Use It

RTI earns its place when:

- You need insights within seconds, not hours
- You have continuous event streams (IoT, clickstream, transactions)
- You're already on Microsoft Fabric

If your analytics can tolerate hourly or daily latency, standard Fabric pipelines to Lakehouse serve you better.

## The Bottom Line

Real-Time Intelligence closes the gap between event-driven systems and analytical insights.

If you're running sensor networks, monitoring customer behaviour in real time, or building operational dashboards that need to reflect the current state of the world—this is the Fabric capability to invest in.

Most teams haven't touched it yet. That's an opportunity.
