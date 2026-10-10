---
title: "Data Activator Preview Readiness: Limits, Admin Settings and Risks"
description: "A readiness checklist for the Data Activator preview in Fabric: tenant switches, throughput and alert limits, failure modes, and when to wait for GA."
author: Michael John Peña
draft: false
date: 2024-01-22
tags:
  - Data Activator
  - Microsoft Fabric
  - Preview
  - Governance
  - Alerts
---

Data Activator has been in public preview since October 2023, and the demos are convincing: click a Power BI visual, choose "Set alert", and a Teams message turns up when sales drop. The problem is the gap between that demo and something an operations team can rely on. Before a business unit builds its alerting on Reflex items, someone has to know what the preview actually supports, where its hard limits are, and what happens when it fails quietly. Here is what the preview supports as of January 2024, and where it breaks.

For the concepts and trigger patterns themselves, see yesterday's post on [Data Activator (Reflex) alerts](/blog/2024-01-21-reflex-alerts/). For where it sits in a streaming design, see [Fabric Real-Time Analytics after GA](/blog/2024-01-18-fabric-realtime-intelligence/).

## What is actually in the preview

Fabric itself went GA at Ignite in November 2023. Data Activator did not. It still carries the preview banner on every documentation page, and the item you create in a workspace is called a **Reflex**. Here is the surface area today, taken from the [Data Activator introduction](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/data-activator/activator-introduction) and its companion articles:

| Area | Supported in the preview |
|---|---|
| Data sources | Power BI reports (via "Set alert" on a visual) and Eventstreams (via a Reflex destination) |
| Modelling | Objects keyed on an ID column, with properties and triggers per object |
| Summaries | Average, count, minimum and maximum over a window of 1 minute to 24 hours |
| Conditions | *Is*, *Becomes*, *Enters/Exits range*, *Changes / Changes to / Changes from* |
| Timers | Each time, number of times, or *stays* true for a duration |
| Actions | Email, Teams message, and custom actions that call a Power Automate flow |
| Authoring | No-code designer only (data mode and design mode) |

The list of what's missing matters just as much. There is no KQL database or lakehouse source; if your data lives there, it has to reach Data Activator through an Eventstream or a Power BI report. There is no public API or Git integration for Reflex items, so triggers can't be versioned, reviewed or promoted between workspaces as code. If your governance model depends on deploying alert definitions through a pipeline, the preview doesn't fit it yet.

## Admin settings come first

Nothing works until an admin turns it on. The switch is the **Data Activator (preview)** setting in the [Fabric tenant settings](https://learn.microsoft.com/en-us/fabric/admin/tenant-settings-index). A Fabric admin, Power Platform admin or Microsoft 365 Global admin can enable it for the whole tenant or for chosen security groups, and capacity admins can override the tenant choice for a single capacity. The tenant setting also notes that Data Activator is only available in some regions, and that turning it on means accepting the preview terms.

My recommendation is to use the capacity-level override deliberately. Leave the tenant switch off, or limited to a pilot security group, and enable it on one non-production capacity where the people experimenting understand they're working with a preview. That gives you a contained blast radius and an obvious list of who built what when GA arrives.

Two other settings sit outside Fabric and catch teams out:

- **Teams.** Teams alerts are delivered by a Data Activator bot. If your Teams admin blocks the Data Activator app, or your Entra ID admin blocks the Teams service principal, triggers fail with `TeamsAppBlockedInTenant` or `TeamsDisabled`.
- **Microsoft 365 licensing.** Email and Teams actions need the trigger owner to have an Office subscription (error `OfficeSubscriptionMissing`).

Check both with your Microsoft 365 admins before anyone demos it to a business sponsor.

## The limits that shape your design

The [Data Activator limitations](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/data-activator/activator-limitations) page is short, but every line on it changes a design decision.

| Limit | Value in January 2024 |
|---|---|
| Eventstream input throughput | Up to **2 events per second**; above that, input may be throttled and events skipped |
| Email | 500 messages per Reflex item per hour; 30 per trigger per recipient per hour |
| Teams | 500 per Reflex item per hour; 30 per trigger per recipient per hour; 100 per recipient per hour; 50 per second per Teams tenant |
| Power Automate | 10,000 flow executions per trigger per hour |
| Email recipients | Internal addresses only, no external or guest recipients |
| Power BI visuals | Column, bar, line, area, ribbon, combo, pie, donut, gauge, card, KPI and some map visuals; no tables or matrices |
| Power BI reports | Must be in a workspace on a Premium capacity; reports using Dynamic M parameters aren't supported |

The one I'd underline is two events per second. That is fine for a few hundred devices reporting every few minutes. It is nowhere near enough to point a raw telemetry stream at a Reflex and let it sort things out. Data Activator in this preview is a decision layer for a reduced stream, not a stream processor.

The recipient limits deserve the same respect. A trigger that fires for every object instance in a population of 2,000 stores will hit 500 messages per item per hour quickly, and anything over the limit is throttled, not queued. If your condition could plausibly fire for a large share of objects at once (a shared upstream outage is the usual cause), that is a design problem, not a tuning problem.

## Reduce the stream before it reaches the Reflex

Because of the throughput limit, I'd send Data Activator state changes and heartbeats rather than every reading. The producer below is a complete example that sends to an Eventstream **custom app** source (an Event Hubs-compatible endpoint) using `azure-eventhub` 5.x. It only emits an event when a device's temperature band changes, plus a heartbeat every five minutes so a *stays* condition and an absence check still have data, and it paces sends to stay under two events per second. The simulated sensor drifts slowly, as a real freezer does, so bands change occasionally rather than on every read. It needs Python 3.9 or later and `pip install azure-eventhub` (5.x).

```python
import json
import os
import random
import time
from datetime import datetime, timezone

from azure.eventhub import EventData, EventHubProducerClient

# Connection string from the Eventstream custom app source (includes EntityPath).
CONNECTION_STRING = os.environ["EVENTSTREAM_CONNECTION_STRING"]

DEVICES = [f"freezer-{n:03d}" for n in range(1, 51)]
HEARTBEAT_SECONDS = 300
MAX_EVENTS_PER_SECOND = 2


_current: dict[str, float] = {}


def read_temperature(device_id: str) -> float:
    """Stand-in for a real sensor read: each freezer drifts slowly around -18."""
    value = _current.get(device_id, -18.0) + random.gauss(0.0, 0.3)
    value += (-18.0 - value) * 0.02  # gentle pull back towards the set point
    _current[device_id] = value
    return round(value, 1)


def band(temperature: float) -> str:
    if temperature > -12:
        return "Critical"
    if temperature > -15:
        return "Warning"
    return "Normal"


def main() -> None:
    producer = EventHubProducerClient.from_connection_string(CONNECTION_STRING)
    last_band: dict[str, str] = {}
    last_sent: dict[str, float] = {}

    with producer:
        while True:
            for device_id in DEVICES:
                temperature = read_temperature(device_id)
                current = band(temperature)
                now = time.monotonic()
                changed = last_band.get(device_id) != current
                stale = now - last_sent.get(device_id, 0) >= HEARTBEAT_SECONDS
                if not (changed or stale):
                    continue

                payload = {
                    "DeviceId": device_id,
                    "Temperature": temperature,
                    "Band": current,
                    "EventTime": datetime.now(timezone.utc).isoformat(),
                }
                batch = producer.create_batch()
                batch.add(EventData(json.dumps(payload)))
                producer.send_batch(batch)

                last_band[device_id] = current
                last_sent[device_id] = now
                time.sleep(1 / MAX_EVENTS_PER_SECOND)

            time.sleep(10)


if __name__ == "__main__":
    main()
```

Each event is a flat JSON dictionary with a unique key (`DeviceId`), which is what the Eventstreams source requires. In the Reflex you'd assign these events to a *Freezer* object keyed on `DeviceId` and build a trigger such as "Band becomes Critical", or "Temperature stays above -15 for 10 minutes". Sending one event per send call is deliberate here: the pacing matters more than batching efficiency at this volume.

If you already have the full-rate stream in a KQL database for analytics, keep it there. Use a separate, reduced stream for Data Activator rather than trying to make one stream serve both.

## Know how it fails

The [troubleshooting article](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/data-activator/activator-troubleshooting) is the most useful page for operations planning, because it lists how the preview tells you something broke: it emails the trigger owner an error code. A few worth knowing:

- `PowerBiSourceNotFoundOrInsufficientPermission` and `QueryEvaluationError`: the semantic model was deleted, its permissions changed, or its structure changed. A model refactor can silently break every alert built on it.
- `ProcessingLimitsReached`: too many events per second, or a trigger firing too often.
- `WorkspaceCapacityDeallocated`: the workspace lost its Fabric capacity. If you pause an F SKU at night to save money, your alerts stop too.
- `MaxDelayReached`: Data Activator hasn't received data for the trigger in seven days and has stopped evaluating it. The docs treat this as an internal problem to raise with support, not something you fix by sending more data.
- `RecipientThrottled`, `UserNotFound`, `BotBlockedByUser`: delivery problems on the action side.

All of these go to one person's inbox. If that person leaves or is on holiday, nobody knows the alert is broken. That is my main objection to using the preview for anything important: the failure signal goes to the author, not to an operations channel.

It also changes how Power BI alerts behave compared with what people expect. Data from Power BI arrives as observations taken on a schedule that typically follows the semantic model's refresh. A model refreshed daily gives you daily alerts at best, whatever the trigger says.

## Where I'd use it now, and where I wouldn't

Start by asking whether you need Data Activator at all. [Power BI data alerts](https://learn.microsoft.com/en-us/power-bi/create-reports/service-set-data-alerts) on dashboard tiles (cards, gauges and KPIs) are generally available, don't need a Premium capacity, and already send an email and a notification when a value crosses a threshold. If the requirement is "tell me when this one number goes above X" on a report someone already pins to a dashboard, a classic data alert is enough, and enabling a preview workload for it isn't worth the admin and support overhead. Data Activator earns its place when you need per-object logic (every store, every freezer), conditions over time such as *stays* or *becomes*, Teams or Power Automate actions, or Eventstream data that never touches a dashboard. Bear in mind too that a Reflex runs on your Fabric capacity, so watch it in the capacity metrics during the pilot rather than assuming it is free.

I'd use the preview for:

- Notification-grade alerts to internal people: "tell the store manager when weekly sales fall below target", "let the site lead know a freezer has been warm for ten minutes".
- Letting business analysts self-serve simple alerts on Power BI reports they already own, on a capacity set aside for the pilot.
- Prototyping custom actions with Power Automate, so you learn the object and trigger model before GA.

I wouldn't use it for:

- Anything with an SLA, a regulatory obligation or an on-call page. Keep Azure Monitor alerts, Logic Apps, or an Azure Function consuming Event Hubs for those.
- Control actions such as shutting down equipment or changing customer state, where a throttled or duplicated action has real consequences.
- Alerts to customers or partners. External recipients aren't supported anyway.
- High-volume streams, unless you reduce them first as shown above.

If you do build something real on it, write down every Reflex item, its owner, its source and its actions in a simple register. There is no export or API for these items yet, so that register is your only inventory when the product changes before GA.

## The readiness decision

Data Activator's model of objects, properties and triggers is the right one, and the Power BI "Set alert" path is the fastest way I've seen to get analysts building their own alerts. The preview, though, is a notification tool with tight throughput limits, owner-only error reporting and no deployment story. Enable it on a pilot capacity for a named group, feed it reduced streams, keep critical alerting on Azure-native services, and keep a register of what you build. That way you can adopt it quickly once it reaches GA without having bet anything important on a preview.
