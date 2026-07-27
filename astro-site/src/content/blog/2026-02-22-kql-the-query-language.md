---
title: "KQL: The Query Language You're Probably Ignoring"
author: Michael John Peña
draft: false
date: 2026-02-22
tags:
  - KQL
  - Azure
  - Fabric
  - Data

---

I wrote "KQL: The Query Language You're Probably Ignoring" to share practical, production-minded guidance on this topic.

That's a missed opportunity.

## What KQL Is

Kusto Query Language. Developed by Microsoft. Used across Azure Monitor, Azure Data Explorer, Microsoft Sentinel, and now Microsoft Fabric's Real-Time Intelligence.

It's a read-only, pipe-based query language designed for large-scale log and telemetry data.

```kql
// Basic structure: table | operator | operator | ...
AppTraces
| where TimeGenerated > ago(1h)
| where SeverityLevel >= 2
| summarize count() by bin(TimeGenerated, 5m), AppName
| render timechart
```

That query reads like English. Filter → aggregate → visualize. No subqueries. No joins required for the common case.

## Why It's Worth Learning

**It's everywhere in Azure.** Application Insights, Log Analytics, Azure Monitor Alerts, Sentinel—all KQL. If you work in Azure, you encounter it constantly. Most engineers copy-paste queries they don't understand.

**It's fast for time-series data.** KQL is purpose-built for high-cardinality, time-ordered data at scale. SQL works. KQL excels.

**Fabric's Real-Time Intelligence runs on it.** If you're building event streaming or IoT scenarios in Fabric, KQL is your primary interface.

## The Core Operators

**Filter:** `where`
```kql
Events
| where EventType == "error" and UserId != ""
```

**Project (select columns):** `project`
```kql
Events
| project TimeGenerated, UserId, EventType, Details
```

**Aggregate:** `summarize`
```kql
Events
| summarize event_count = count(), unique_users = dcount(UserId) by EventType
```

**Time bucketing:** `bin()`
```kql
Events
| summarize count() by bin(TimeGenerated, 1h)
```

**Join:** `join` (use sparingly—KQL joins differ from SQL)
```kql
Errors
| join kind=inner (
    Users
    | project UserId, UserName, Region
) on UserId
```

**Top N:** `top`
```kql
PageViews
| top 10 by Count desc
```

**String operations:** `contains`, `startswith`, `matches regex`
```kql
Logs
| where Message contains "timeout" or Message matches regex @"Error \d{4}"
```

## A Real Pattern: Monitoring AI Costs

This is one I use regularly in production:

```kql
// Azure OpenAI token usage by model and hour
AzureDiagnostics
| where ResourceType == "OPENAI"
| where OperationName == "completions"
| summarize
    total_prompt_tokens = sum(toint(properties_promptTokens_d)),
    total_completion_tokens = sum(toint(properties_completionTokens_d)),
    request_count = count()
  by
    model_s,
    bin(TimeGenerated, 1h)
| extend estimated_cost_usd = (total_prompt_tokens / 1000.0 * 0.01) + (total_completion_tokens / 1000.0 * 0.03)
| order by TimeGenerated desc
```

That's production monitoring for AI costs. Clean. Readable. Fast.

## KQL in Microsoft Fabric

Fabric's Eventhouse uses KQL databases. If you're building real-time analytics—IoT telemetry, clickstream, security events—this is where the data lands.

```kql
// Fabric Eventhouse: Real-time event analysis
SensorReadings
| where ingestion_time() > ago(15m)
| where SensorType == "temperature"
| summarize avg_temp = avg(Value), max_temp = max(Value) by DeviceId
| where avg_temp > 75
| project DeviceId, avg_temp, max_temp
| order by avg_temp desc
```

Sub-second latency on millions of rows. SQL on a traditional warehouse can't compete here.

## How to Get Good at KQL

**Start with Log Analytics in the Azure portal.** There's a query window with IntelliSense. Run queries against your existing Application Insights or Log Analytics workspace.

**Use the KQL playground.** Microsoft has a public demo cluster. Free. Pre-loaded with sample data.

**Read the reference.** Microsoft's KQL documentation is excellent. Better than most.

**Write one real query per week.** Copy-paste is the enemy of learning here.

## The Bottom Line

KQL isn't a specialty skill. If you work in Azure, it's a baseline skill you're probably missing.

One week of focused practice will make you fluent enough for 80% of use cases. The remaining 20% covers advanced scenarios most people never need.

Start with Log Analytics. Write a real query. Find something useful in your own logs.

You'll be surprised what was always there.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
