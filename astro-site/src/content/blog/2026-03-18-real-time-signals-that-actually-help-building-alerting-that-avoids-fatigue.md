---
title: "Alerts People Don't Mute: Designing Activator Rules in Fabric"
description: "How to design Fabric Activator and KQL queryset alerts that fire on transitions, carry an owner and a next step, and stop teams muting the channel."
author: Michael John Peña
draft: false
date: 2026-03-18
tags:
  - Microsoft Fabric
  - Real-Time Intelligence
  - Data Activator
  - KQL
  - Alerts
---

Most real-time projects I look at don't have an alerting problem; they have a trust problem. The pattern is predictable: someone wires an Activator rule to a Teams channel in the week after go-live, it fires hundreds of times, and soon the channel is muted. From then on, the expensive streaming platform is backed by people checking a dashboard when they remember to.

Fabric Real-Time Intelligence gives you good tools for avoiding this. Activator has been generally available since November 2024, and its rule model has the controls you need. But the easiest rule to build is one that tells you something happened, and what you usually want is one that wakes you only when it matters. The fix is mostly in which condition, occurrence and summarisation you pick.

## Start with the decision, not the data

Before opening Activator, I ask one question for every proposed alert: **who does what when this fires?** If nobody can name the owner and the first action, treat it as a report and put it on a Real-Time Dashboard or in a daily summary email.

My rule of thumb is three fields per alert, written down before anyone builds it:

| Field | Example |
|---|---|
| Owner | Cold-chain operations on-call |
| Trigger | Average container temperature above 8°C for 10 minutes |
| First action | Call the driver, then log the incident against the shipment ID |

Writing these down forces the conversation most teams skip. Most noisy alerting I see comes from rules built straight from a metric ("alert on temperature") with no agreed meaning. Once the owner and action are written down, a lot of proposed rules quietly die, and that is the point.

## Configure the rule for transitions, persistence and stability

The most common cause of noise I see in Activator is picking the wrong condition family. The [detection conditions documentation](https://learn.microsoft.com/fabric/real-time-intelligence/data-activator/activator-detection-conditions) splits them clearly:

- **Is** conditions (for example, *Is greater than*) activate **for each event** where the condition is true.
- **Becomes** conditions activate only when the condition goes from false to true.
- **Enters range** and **Exits range** activate only on the transition across the boundary.
- **Changes**, **Changes to** and **Changes from** activate when a value moves to or from a specified state.

If a sensor reports every five seconds and sits above threshold for an hour, *Is greater than* gives you 720 activations. *Becomes greater than* gives you one. For human notification, I default to the transition conditions and treat *Is* conditions as a deliberate exception, usually when the action is idempotent automation rather than a person.

The trade-off is that a transition condition fires once and then stays quiet. If nobody acts on that single message, there is no reminder. If that worries you, add a second rule with an *Is* condition and a longer **Stays** duration, say 60 minutes, routed to an escalation contact, so a breach that is still open after an hour notifies a second person, whether or not the owner has acted. Activator doesn't track acknowledgement, so this rule can't tell a breach someone is already handling from one nobody has seen. That's also why the owner field matters: one message to a named owner beats a hundred messages to a channel of 40 people.

### Use occurrence to require persistence

After the condition, Activator asks for an **occurrence**: every time, a number of times, or **Stays**, meaning the condition must be continuously true for a set duration; for example, *Is greater than* 8 with Stays 10 minutes. The occurrence options are offered only for some condition types, so check that Stays is available for the condition you picked. Stays is the cheapest debounce you will ever get. A temperature spike that lasts one reading is often a door opening; one that stays for ten minutes is a refrigeration fault.

Pick the duration from the cost of the delay, not from what "feels" responsive. If nothing bad happens to the stock in the first 15 minutes, a 10-minute Stays window costs you nothing and removes most of the transient noise.

### Summarise before you compare

Activator rules can apply a summarisation (average, count, minimum/maximum or total) over a window with a step size, both between 10 seconds and 24 hours. Comparing a 5-minute average against a threshold is far more stable than comparing raw readings.

Two caveats. First, summarisation adds latency: the [latency documentation](https://learn.microsoft.com/fabric/real-time-intelligence/data-activator/activator-latency) is explicit that a rule with an aggregation only activates once the window completes, on top of the default two-minute late arrival tolerance. A 4-hour average is not a real-time alert. Second, when you summarise a property, the action carries the original value rather than the summarised one, so write the message text so it doesn't mislead the reader.

## Alert per object, not per stream

Activator tracks objects, such as packages, devices or stores, keyed on an ID column. Rules evaluate per object, and the **Analytics** tab on a rule charts total activations alongside the object IDs that contribute the most. I check that tab during the first week of every rule. If one or two IDs dominate, look for a faulty device, a mis-mapped ID or a site that needs its own threshold before touching the global one. Fix that object, and leave the rule tight for everyone else.

Use **filters** (up to three per rule) to scope rules to the objects an owner is responsible for. A rule per region, routed to that region's team, generates less noise than one global rule that everyone sees.

## Watch the pipeline, not only the values

The alert that matters most is often the one that says nothing is arriving. If an upstream connector stops, every value-based rule goes silent, and silence looks exactly like health.

Activator's **Heartbeat** condition, *No presence of data*, covers this. Microsoft's [stopped-events walkthrough](https://learn.microsoft.com/fabric/real-time-intelligence/data-activator/alert-stop-events) uses a pattern I'd copy as-is: add a Group by node in the eventstream that emits a count per minute, send only that summarised stream to Activator, and alert when nothing arrives for an hour. Activator bills capacity for rule uptime, event ingestion and per-event computation, so sending one event per minute instead of the raw stream is cheaper as well as quieter.

I treat this as mandatory. Every production stream gets one heartbeat rule, owned by the platform team, before any business alert goes live.

## KQL queryset alerts: one incident, one row

For conditions that need joins or history, I'd rather write KQL than click together a rule. In a KQL queryset connected to an Eventhouse KQL database, **Set Alert** creates an Activator rule that runs the query on a schedule (the default is every five minutes). See [Create Activator alerts from a KQL Queryset](https://learn.microsoft.com/fabric/real-time-intelligence/data-activator/activator-alert-queryset).

The detail that catches people: for a query without a visualisation, Activator sends **one alert per row returned**. A query that returns every error record is a pager storm by design. Shape the result so one row equals one incident:

```kusto
// Runs every 5 minutes as a KQL queryset alert.
// Returns at most one row: the services breaching the error threshold.
let lookback = 5m;
let threshold = 20;
AppLogs
// Aligned window: the last complete 5-minute interval.
// Simpler but less precise: | where ingestion_time() > ago(lookback)
| where ingestion_time() >= bin(now(), lookback) - lookback
    and ingestion_time() < bin(now(), lookback)
| where Level == "Error"
| summarize ErrorCount = count() by ServiceName
| where ErrorCount > threshold
| summarize Services = make_list(ServiceName), TotalErrors = sum(ErrorCount)
| where array_length(Services) > 0
```

The last line matters. A `summarize` with no `by` clause returns a row even when its input is empty, so without that filter the query would return an empty list every five minutes and fire every time. Set `lookback` equal to the schedule frequency. I filter on an aligned window rather than `ago(lookback)` because scheduled runs don't start at exactly aligned times, so a sliding window can double-count or miss records at the edge. The aligned filter trades up to one interval of extra delay for fewer duplicates, but it still isn't exactly-once if a scheduled run slips past a boundary. `ingestion_time()` relies on the table's IngestionTime policy, which is on by default for Fabric KQL database tables; if someone has disabled it, filter on an event timestamp column instead. Remember too that a query running every few minutes keeps the Eventhouse from going idle, which has a capacity cost.

`AppLogs`, `Level` and `ServiceName` are placeholders for your own table and columns.

## Choose thresholds from history, not instinct

Thresholds picked in a workshop are another big source of noise. Before a rule goes live, I replay the candidate threshold against a couple of weeks of history and count how often it would have fired:

```kusto
// Count how many times each device would have crossed the threshold
// in the last 14 days, using 10-minute averages and a "becomes" style
// transition (below or at threshold, then above).
let threshold = 8.0;
DeviceTelemetry
| where Timestamp > ago(14d)
| summarize AvgTemp = avg(Temperature) by DeviceId, bin(Timestamp, 10m)
| order by DeviceId asc, Timestamp asc
| extend PrevTemp = prev(AvgTemp), PrevDevice = prev(DeviceId), Gap = Timestamp - prev(Timestamp)
// Treat a data gap like a new device so non-adjacent bins don't count as a transition.
| where AvgTemp > threshold
    and (PrevDevice != DeviceId or Gap != 10m or PrevTemp <= threshold)
| summarize Crossings = count() by DeviceId
| order by Crossings desc
```

If the answer is "about 60 times a day across the fleet", the owner now knows what they are signing up for, before anything is muted. If a handful of devices account for most crossings, you've found the per-object problem described above. This is a rough model of Activator's behaviour, not an exact replay, but it's close enough to argue about thresholds with numbers.

## Make every message actionable

Activator actions can send email, post to Teams (individuals, a group chat or a channel), run a Fabric item such as a pipeline or notebook, or call a Power Automate flow as a custom action. Whichever you pick, the message should answer three questions without a click: what crossed, for which object, and what to do next. Use `@` property references in the headline and add context fields such as the object ID and the reading. I include a link to a one-page runbook in the notes field. It doesn't need to be long; three steps and an escalation contact is enough.

Use **Send me a test alert** before starting a rule. It picks a past event where the condition was true and sends the alert to you only, whoever the recipients are. Read that message as if you'd just been woken up by it.

## When not to alert

Not everything deserves a real-time rule:

- **Slow-moving metrics.** If the trend matters over days, a scheduled report is cheaper and more honest than a summarised rule with a 24-hour window.
- **Things nobody can act on.** If the response is "note it and move on", put it on a dashboard.
- **Power BI-sourced rules that need minutes.** Activator [queries Power BI visuals once an hour by default](https://learn.microsoft.com/fabric/real-time-intelligence/data-activator/ingestion/ingestion-powerbi), so a rule can fire up to an hour after the event. You can shorten **Run query every** on the source, but every query costs capacity, so time-critical signals still belong on an eventstream or Eventhouse.

## The short version

Treat alert volume as a design budget. Every rule needs a named owner and a first action, should fire on transitions rather than states, should require persistence before it notifies a human, and should be checked against history before it goes live. Add one heartbeat rule per stream so silence can't pass for health. For the broader streaming architecture these rules sit on, see my earlier posts on [Real-Time Intelligence patterns](/blog/2025-06-18-fabric-real-time-intelligence-patterns/) and [Eventhouses](/blog/2024-06-02-eventhouses-fabric/).
