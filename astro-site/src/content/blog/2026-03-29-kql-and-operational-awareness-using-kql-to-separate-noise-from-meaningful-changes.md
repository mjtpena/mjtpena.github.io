---
title: "Noise or a Real Change? Three KQL Checks Before Anyone Gets Paged"
description: "Use KQL baselines, week-over-week comparison and diffpatterns in an Eventhouse to tell a meaningful operational change from ordinary noise, and to explain it."
author: Michael John Peña
draft: false
date: 2026-03-29
tags:
  - KQL
  - Microsoft Fabric
  - Real-Time Intelligence
  - Anomaly Detection
  - Observability
---

Most operational data is noisy by nature. Error counts wobble every hour, traffic dips every weekend, and a single retry storm can double a chart for five minutes. When the only test for "something changed" is a fixed threshold, teams end up with two bad choices: set it low and drown in false alarms, or set it high and find out about real regressions from customers.

KQL already has the tools to do better, and they run in a Fabric Eventhouse, Azure Data Explorer, and (for most of them) Log Analytics. I use three checks, in order: is this point unusual against its own history, is it different from the same time last week, and if so, what is different about it. This post walks through each, with queries you can adapt, and where I'd stop writing KQL and use something else.

## What "meaningful" actually means

Before writing any query, I make the team agree on what counts as a meaningful change. My working definition has three parts:

1. **Unusual for this time.** 300 errors at 9am on a Monday may be normal; 300 at 3am on a Sunday may not. A threshold that ignores seasonality can't tell the difference.
2. **Big enough to matter.** A failure count going from 2 to 6 is a 200% increase and is statistically odd, and it's still not worth anyone's evening. Every check needs an absolute floor as well as a relative one.
3. **Explainable.** A change you can't attribute to a region, endpoint, release, or node is hard to act on. The fastest incidents are the ones where the first message already says "it's the new client version in Australia East".

Each check below maps to one of these. None of them replaces the alert design work covered in [Alerts People Don't Mute](/blog/2026-03-18-real-time-signals-that-actually-help-building-alerting-that-avoids-fatigue/); they're the queries that decide what is worth alerting on in the first place.

The examples use a placeholder table, `ServiceEvents`, with one row per request: `Timestamp`, `Service`, `Region`, `Endpoint`, `ClientVersion`, `Node`, `ResultCode`. Swap in your own schema.

## Check 1: compare each point with its own seasonal baseline

The function doing the heavy lifting is [`series_decompose_anomalies()`](https://learn.microsoft.com/kusto/query/series-decompose-anomalies-function). It splits a time series into seasonal, trend and residual components, then flags points whose residual falls outside a Tukey fence. It returns three series: a flag (+1 spike, -1 dip, 0 normal), a score, and the baseline it expected.

```kusto
let lookback = 21d;
let binSize = 1h;
ServiceEvents
| where Timestamp > ago(lookback)
| make-series Requests = count(), Failures = countif(ResultCode >= 500) default = 0
    on Timestamp from bin(ago(lookback), binSize) to bin(now(), binSize) step binSize
    by Service
| extend (Flag, Score, Baseline) = series_decompose_anomalies(Failures, 2.5, 168, 'linefit')
| mv-expand Timestamp to typeof(datetime), Requests to typeof(long), Failures to typeof(long),
    Flag to typeof(int), Score to typeof(real), Baseline to typeof(real)
| where Timestamp > ago(3h)
| where Flag == 1 and Failures >= 20
| project Timestamp, Service, Requests, Failures, Baseline = round(Baseline, 1), Score = round(Score, 1)
| order by Score desc
```

A few of these choices are deliberate, and they are where most of the noise reduction comes from.

- **Seasonality is set, not detected.** The default (`-1`) autodetects the period. That works on clean data, but on a quiet service it can pick the wrong period or none. With hourly bins, `168` says "weekly", which matches how most business systems behave. Use `24` if weekends look like weekdays.
- **Threshold 2.5, not the default 1.5.** The default flags mild anomalies, which is right for exploration and wrong for anything that ends up in front of a person. Raising the threshold is the cheapest noise cut there is. Microsoft's own examples step it up from 1.5 to 2.5 for the same reason.
- **`linefit` trend.** The default trend is a flat average. If traffic is growing, the baseline lags behind and every week looks like a spike. `linefit` follows the growth.
- **The current hour is excluded.** In [`make-series`](https://learn.microsoft.com/kusto/query/make-series-operator), the `to` bound is exclusive, so ending at `bin(now(), 1h)` drops the partial hour. A half-filled bin looks like a dip every single time.
- **An absolute floor.** `Failures >= 20` is the "big enough to matter" rule. Choose the number with the service owner, not in the query editor.

Three weeks of hourly data gives the decomposition three full weekly cycles, which is about the minimum I'd trust. More history is better if your retention allows it, but every extra week is more data scanned on every run, so check the query cost before you put this on a five-minute schedule.

### Counts or rates?

Failure counts rise with traffic. If a marketing campaign doubles requests, a count-based check will flag it even though nothing is broken. That's why the query carries `Requests` alongside `Failures`: when both are flagged together, it's usually load, not a fault. For services where traffic swings a lot, I run the decomposition on the failure rate instead. Rates have their own trap, though. At 3am, two failures out of ten requests is a 20% failure rate, so the absolute floor matters even more there.

## Check 2: compare with the same window last week

The baseline check is good at "unusual". It's less good at answering the question an on-call engineer actually asks: "is this worse than normal for a Sunday at this hour?" A plain week-over-week comparison is easier to read and easier to explain in a post-incident review.

```kusto
let window = 1h;
let current = ServiceEvents
    | where Timestamp between (ago(window) .. now())
    | summarize Requests = count(), Failures = countif(ResultCode >= 500) by Service;
let lastWeek = ServiceEvents
    | where Timestamp between (ago(7d + window) .. ago(7d))
    | summarize PrevRequests = count(), PrevFailures = countif(ResultCode >= 500) by Service;
current
| join kind=leftouter lastWeek on Service
| project-away Service1
| extend FailRatePct = round(100.0 * Failures / Requests, 2),
         PrevFailRatePct = round(100.0 * PrevFailures / PrevRequests, 2)
| extend DeltaPts = FailRatePct - PrevFailRatePct
| where Failures >= 20 and (DeltaPts >= 1.0 or isnull(PrevRequests))
| order by DeltaPts desc
```

Two details matter. The join is written as `kind=leftouter` on purpose; KQL's default join kind is `innerunique`, which isn't what a SQL developer expects (I covered that trap in [KQL for SQL People](/blog/2026-02-22-kql-the-query-language/)). And a service with no traffic last week shows up with a null `PrevRequests` instead of disappearing, because a brand-new service that is failing is exactly the case you don't want filtered out.

Week-over-week has a weakness: if last week was itself an incident, this week looks fine by comparison. That's why I treat it as a second opinion, not a replacement for Check 1. When both checks agree, I'm confident. When only one fires, it's worth a look but not a page.

## Check 3: explain what is different

Once a change is real, the next question is "where?". Teams usually answer it by slicing a dashboard one dimension at a time: by region, then by endpoint, then by version. The [`diffpatterns` plugin](https://learn.microsoft.com/kusto/query/diffpatterns-plugin) does that search in one pass. You give it two sets of rows that share a schema, and it returns the combinations of column values that are over-represented in one set compared with the other.

```kusto
let svc = "<your-service-name>";
ServiceEvents
| where Service == svc and ResultCode >= 500
| where Timestamp between (ago(25h) .. now())
| extend Period = iff(Timestamp >= ago(1h), "Incident", "Baseline")
| project Period, Region, Endpoint, ClientVersion, Node, ResultCode = tostring(ResultCode)
| evaluate diffpatterns(Period, "Baseline", "Incident")
| top 5 by PercentDiffAB desc
```

This compares failures in the last hour with failures in the 24 hours before. The output has one row per pattern, with `PercentA` and `PercentB` (the share of each set the pattern covers), `PercentDiffAB` (the gap in percentage points, which is the main significance measure), and the dimension values that define the pattern. Columns that don't constrain a pattern are left empty. A top row saying "Baseline 3%, Incident 61%, `ClientVersion` 4.2.0, `Region` australiaeast" is a much better opening line for an incident than "errors are up".

Some things to know before relying on it:

- **Feed it discrete columns only.** Drop timestamps, durations and IDs before the `evaluate`. High-cardinality columns such as request IDs produce patterns nobody can act on and slow the query down. That's why `Timestamp` is projected away, and `ResultCode` is cast to a string so it's treated as a category.
- **Choose the comparison deliberately.** Failures now versus failures before answers "what changed about the failures". Failures versus successes in the same window answers "what do failing requests have in common". Both are useful, and they answer different questions.
- **Patterns overlap.** The documentation is explicit that results aren't distinct and don't cover every row. Treat the output as leads to check, not a root cause.

`diffpatterns` is documented for Fabric Eventhouse and Azure Data Explorer. The time series functions in Checks 1 and 2 also run in Azure Monitor Log Analytics and Microsoft Sentinel.

## When I'd use the no-code detector instead

Fabric Real-Time Intelligence now has a built-in option: [anomaly detection in Real-Time Intelligence](https://learn.microsoft.com/fabric/real-time-intelligence/anomaly-detection), announced in preview in September 2025. It runs on Eventhouse tables, recommends a model from your history, and can publish continuous monitoring with alerts, without anyone writing KQL. It needs the Python plugin enabled on the Eventhouse and a tenant setting turned on, and [billing for it started in December 2025](https://learn.microsoft.com/fabric/real-time-intelligence/anomaly-detection-billing), charged per query run.

My rule of thumb: if the people who own the metric don't write KQL, start with the detector. If you need the logic in source control, need absolute floors and week-over-week rules combined with the statistical check, or need to explain the change as well as detect it, write the queries. It's still a preview, so I wouldn't make it the only thing standing between a production regression and the on-call engineer.

## When not to do any of this

- **Hard limits are hard limits.** If a disk at 95% or a certificate expiring in seven days needs action regardless of history, use a plain threshold. Seasonal baselines only add ambiguity there.
- **Sparse or young data.** A service with a handful of events a day, or less than a few weeks of history, gives the decomposition nothing to learn from. Use absolute floors until the history exists.
- **Known change windows.** A deployment, a migration, or a public holiday will look anomalous because it is. Suppress or annotate those windows instead of loosening thresholds for everyone else.

## The takeaway

Fixed thresholds are noisy because they ask the wrong question. Ask instead whether a point is unusual for its own history, whether it's worse than the same time last week, and whether it's big enough to matter. Then let `diffpatterns` say where the difference is before anyone opens a dashboard. Three queries, run in that order, turn "the chart looks weird" into a short list of changes worth someone's time, each with a likely cause attached.
