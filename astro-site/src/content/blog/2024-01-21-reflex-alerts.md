---
title: "Designing Reflex Triggers in Data Activator Without Alert Spam"
description: "How Data Activator preview triggers really fire: objects, Is vs Becomes conditions, timers, Power Automate custom actions and the throughput limits to plan for."
author: Michael John Peña
draft: false
date: 2024-01-21
tags:
  - Data Activator
  - Microsoft Fabric
  - Eventstreams
  - Alerts
  - Power Automate
---

Most bad alerting is a modelling problem rather than a tooling problem. People pick a threshold, wire it to an inbox, and a week later everyone has a mail rule that sends the alerts straight to a folder nobody reads. Data Activator, which has been in public preview in Microsoft Fabric since October 2023, makes it very easy to build that kind of alert in a few clicks. It also gives you the tools to avoid it, but only if you understand how a Reflex item decides when to fire.

I've used Reflex on projects where real-time alerts matter, and the questions I get are rarely "how do I connect it?". They are "why did it fire 40 times?" and "why didn't it fire at all?". This post is about the trigger design choices that answer both. If you want the broader picture of where Reflex sits in a streaming design, start with [my end-to-end Fabric real-time post](/blog/2024-01-18-fabric-realtime-intelligence/). For preview readiness and governance, see [the Data Activator preview post](/blog/2024-01-22-data-activator-preview/).

## What a Reflex item is, as of January 2024

A Reflex is the Fabric item that holds your Data Activator logic. In the current preview it is a no-code experience: you build it in the browser, there is no public API or SDK for defining triggers, and nothing to deploy from source control. Any blog post showing a JSON or YAML "Reflex configuration" is describing something that doesn't exist.

According to the [Data Activator introduction on Microsoft Learn](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/data-activator/activator-introduction), the model has four parts:

| Concept | What it means in practice |
|---|---|
| Events | Every source is treated as a stream of observations: an object ID, a timestamp and some values |
| Objects | The business thing you monitor (a freezer, a package, a store), keyed by one ID column |
| Properties | Reusable values or logic on an object, such as a one-hour maximum temperature |
| Triggers | A condition on an object plus an action, evaluated per object instance |

Data reaches a Reflex in two ways today. You can add a **Reflex destination** to an Eventstream, or you can select **Set alert** on a supported Power BI visual in a report published to a workspace on Premium or Fabric capacity. Reflex does not query a KQL database or a lakehouse directly in this preview. Data Activator also has to be switched on by a Fabric admin, either for the tenant or for specific capacities.

The two sources behave very differently, and that matters for trigger design. Eventstream data arrives as it happens. Power BI data is sampled on a schedule that typically follows the semantic model's refresh, so a "real-time" alert on a daily-refreshed model is a daily alert with extra steps.

## Model the object before you write a trigger

The single most important decision is the object key. When you assign data in Data mode, you choose an object name and a key column, and every trigger then fires *per object instance*. Get the key wrong and every trigger downstream is wrong.

For Eventstream sources, each event must be a JSON dictionary with a key that identifies the object. This shape works:

```json
{
  "FreezerId": "FRZ-0042",
  "StoreId": "SYD-017",
  "Temperature": -14.2,
  "DoorOpen": false,
  "EventTime": "2024-01-21T03:15:00Z"
}
```

A few rules I follow:

- **Pick the grain you want to act on.** If the person who responds is a store manager, a `Store` object may be a better trigger target than `Freezer`. You can assign the same stream to more than one object, so you can have both.
- **Combine slow and fast data on one object.** You can assign several streams to an existing object, for example reference data (which technician owns the freezer) alongside telemetry. The key column must contain the same IDs in every stream, or you'll get odd results.
- **Put smoothing in properties, not in each trigger.** A property such as "average temperature over 10 minutes" can be reused by many triggers, and when you change the window you change it once.

## How triggers decide to fire

A trigger has three cards: **Select** (the value), **Detect** (the condition) and **Act** (the action). The detail in Detect is where most alert noise comes from. The [detection conditions documentation](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/data-activator/activator-detection-conditions) describes the options; this is how I think about them.

### Summaries and filters in Select

In the Select card you can add a summary over a time window between 1 minute and 24 hours: average, count, minimum or maximum. You can also add up to three filters, typically on text columns, such as only events where `StoreId` is a Sydney store.

Use a summary whenever the raw signal is noisy. A single sensor spike to -5°C while a door is open is not a failing freezer. A 10-minute average above -12°C probably is.

### Is versus Becomes

This is the distinction that causes the "it fired 40 times" complaint.

| Condition type | Fires when | Typical use |
|---|---|---|
| **Is** (e.g. is greater than) | Every event where the condition is true | Rarely what you want for notifications |
| **Becomes** (e.g. becomes greater than) | Only when the condition goes from false to true | Threshold breaches |
| **Enters / Exits range** | When the value moves into or out of a range | Operating bands, such as -25°C to -15°C |
| **Changes, Changes to, Changes from** | When a value changes, or changes to or from a specific value | Status fields and true/false flags |

An **Is** condition on a stream that reports every 30 seconds fires every 30 seconds for as long as the freezer is warm. **Becomes** fires once when it crosses the line, then not again until the value has dropped back below and crossed again. My default for any notification is a **Becomes** or **Enters range** condition. I only reach for **Is** when every matching event genuinely needs its own action, which is rare for a person and more common for a flow.

The flip side is that **Becomes** won't remind anyone. If the first email is ignored, nothing else arrives. If you need repeated reminders or escalation, that logic belongs in the system you hand off to, not in Reflex.

### Timers: the cheapest noise filter

After the condition you choose a timer:

- **Each time**: fire whenever the condition is true.
- **Number of times**: fire only after the condition has been true a set number of times.
- **Stays**: fire only if the condition remains true continuously for a set duration.

"Temperature becomes greater than -12 and stays that way for 10 minutes" is a far better freezer alert than any threshold on its own. It ignores door openings and defrost cycles without needing extra logic. I'd add a **Stays** timer to almost every alert built on physical telemetry.

### Test before you start

Triggers are created **stopped**. Before starting one, the Detect card shows how often it would have fired across the sampled instances and the whole population, and **Send me a test alert** sends you an example built from a past event where the condition was true. If the history chart shows hundreds of activations a day, fix the condition before anyone gets an email. After you edit a running trigger, select **Update**, or the running version keeps using the old logic.

## Choosing the action

The Act card offers email, a Teams message, or a **custom action** that calls a Power Automate flow.

Email and Teams cover most notification needs. Email recipients must be internal to the tenant that owns Fabric; external and guest addresses are not allowed. That rules out notifying a supplier or a managed service partner directly.

Custom actions are the extension point for everything else: creating a ticket, posting to another system, or starting an approval. Someone comfortable with Power Automate defines the action once, with named input fields, and creates the flow from Data Activator. After that, other Reflex users can pick it from the Act card without touching Power Automate. Inside the flow, you read each input field with an expression like this one, as shown in the [custom actions documentation](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/data-activator/activator-trigger-power-automate-flows):

```text
triggerBody()?['customProperties/FreezerId']
```

I like this split. The people who understand the business condition own the trigger, and the people who understand the downstream system own the flow.

## Limits that should shape your design

The [preview limitations page](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/data-activator/activator-limitations) is short, and you should read it before you promise anyone anything. As of January 2024 the numbers that matter are:

| Limit | Value |
|---|---|
| Eventstream input to Data Activator | Up to 2 events per second; above that, input may be throttled |
| Email or Teams messages per Reflex item | 500 per hour |
| Email or Teams messages per trigger per recipient | 30 per hour |
| Teams messages per recipient | 100 per hour |
| Power Automate flow runs per trigger | 10,000 per hour |

The 2 events per second figure is the big one. A fleet of 500 freezers reporting every 30 seconds produces about 17 events per second, well over the limit, and throttled input means events silently missing from evaluation. In my view, that pushes Reflex towards a specific pattern: don't send raw telemetry to it. Use the Eventstream event processor to filter, or aggregate upstream, so that only the events a trigger cares about reach the Reflex destination. My [Eventstream patterns post](/blog/2024-01-19-eventstreams-patterns/) covers where that logic should live.

If you want to generate test traffic that stays under the limit, the Eventstream **Custom App** source gives you an Event Hubs-compatible connection string. This script uses the `azure-eventhub` 5.x library to send one event per freezer every five seconds:

```python
import json
import random
import time
from datetime import datetime, timezone

from azure.eventhub import EventData, EventHubProducerClient

# Connection string from the Eventstream Custom App source (includes EntityPath)
CONNECTION_STR = "<your-eventstream-custom-app-connection-string>"
FREEZERS = ["FRZ-0041", "FRZ-0042", "FRZ-0043"]

producer = EventHubProducerClient.from_connection_string(CONNECTION_STR)

with producer:
    while True:
        batch = producer.create_batch()
        for freezer_id in FREEZERS:
            reading = {
                "FreezerId": freezer_id,
                "StoreId": "SYD-017",
                "Temperature": round(random.uniform(-20.0, -8.0), 1),
                "DoorOpen": random.random() < 0.1,
                "EventTime": datetime.now(timezone.utc).isoformat(),
            }
            batch.add(EventData(json.dumps(reading)))
        producer.send_batch(batch)
        time.sleep(5)  # 3 events every 5 seconds stays under 2 events/second
```

Run it, assign the stream to a `Freezer` object keyed on `FreezerId`, and compare an **Is greater than -12** trigger with **Becomes greater than -12, stays for 2 minutes** in the Detect history chart. The difference in activation counts makes the case better than any argument.

## When not to use Reflex yet

Data Activator is a preview, with no SLA and with behaviour that can change. I wouldn't use it today for:

- **Anything that controls equipment or pages on-call.** A missed or duplicated action has to be acceptable. For operational paging, Azure Monitor alerts or an Azure Function reading from Event Hubs are still the safer path.
- **High-volume per-event processing.** At 2 events per second of input, Reflex is not a stream processor. Do that work in Eventstream or a KQL database.
- **Alerts that need to live in source control.** There is no code-first definition today, so you can't review or promote triggers through a pipeline.
- **Notifications to people outside your tenant.** Route those through a custom action and a flow, or use another tool.

## The short version

Reflex is good at one thing right now: telling the right internal person, once, that something about a specific object has changed in a way they care about. Design for that. Choose the object key deliberately, smooth noisy values with properties, prefer **Becomes** and **Enters range** over **Is**, add a **Stays** timer to anything physical, and filter upstream so you stay under the input limit. Do that and the alerts get read. Skip it and you've built another inbox folder.
