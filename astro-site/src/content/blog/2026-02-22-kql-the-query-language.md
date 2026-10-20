---
title: "KQL for SQL People: The Query Language Azure Already Runs On"
description: "Why KQL is a baseline Azure skill, how its pipe model differs from SQL, and the operators, join defaults and has-vs-contains traps that matter most."
author: Michael John Peña
draft: false
date: 2026-02-22
tags:
  - KQL
  - Azure Monitor
  - Microsoft Fabric
  - Observability
---

If you work on Azure, you're probably already running KQL every week, often copied from a blog and pasted into the portal. That's a waste: Application Insights, Log Analytics, Microsoft Sentinel, Microsoft Defender XDR advanced hunting, Azure Data Explorer and the Eventhouse in Microsoft Fabric Real-Time Intelligence all answer questions in KQL, so the people who can write it fluently get to diagnose incidents, cost spikes and data quality problems without waiting on someone else.

I covered the Log Analytics side in depth years ago in [Mastering Log Analytics Queries with KQL](/blog/2021-02-23-log-analytics-queries/). This post is aimed at people who already think in SQL: what changes in your head, which operators carry most of the load, the join default that drops rows without warning, and the string operator that turns an index lookup into a scan.

## The mental shift: a pipeline, not a statement

SQL clauses are written in a fixed order (`SELECT`, `FROM`, `WHERE`) that doesn't match the order the engine evaluates them. KQL is written in the order the data flows. You start with a table and pipe it through operators, each of which takes a tabular input and produces a tabular output.

```kql
// Application Insights (workspace-based) traces, warnings and above
AppTraces
| where TimeGenerated > ago(1h)
| where SeverityLevel >= 2
| summarize Traces = count() by bin(TimeGenerated, 5m), AppRoleName
| render timechart
```

Read it top to bottom: take the traces, keep the last hour, keep warnings and above, count them in five-minute buckets per role, chart it. There's no nesting, and you can comment out the last line to inspect the intermediate table. That last point is the real productivity win. Debugging a KQL query means deleting operators from the bottom until the output looks right, which is far easier than unpicking a nested SQL subquery.

Two other differences matter early:

- **A query is read-only.** Anything that changes data or schema is a separate management command (they start with a dot, such as `.create table`), and in Log Analytics you mostly don't get those at all. That makes it safe to hand query access to a wide audience.
- **Time is built into the language.** `ago()`, `bin()`, `between`, `datetime()` and `timespan` literals like `5m` are built in, because the engine was designed for append-only telemetry where nearly every question has a time window.

## The operators that do most of the work

You can be productive with a short list. Every example in this section runs as-is against the free `help` cluster's `Samples` database, which you can open in the [Azure Data Explorer web UI](https://dataexplorer.azure.com/clusters/help/databases/Samples) with any Microsoft account.

| SQL habit | KQL operator | Notes |
|---|---|---|
| `WHERE` | `where` | Put the time filter first; it prunes data before anything else runs |
| `SELECT col1, col2` | `project` | `project-away` drops columns instead, handy on wide tables |
| computed column | `extend` | Adds a column without dropping the rest |
| `GROUP BY` | `summarize ... by` | Aggregates and grouping keys in one operator |
| `ORDER BY ... LIMIT` | `top N by` | Same result and cost as `order by` + `take`, just shorter to write |
| CTE | `let` | Names a scalar, a tabular expression or a function |

Here's a filter, aggregate and rank in one pass:

```kql
StormEvents
| where StartTime >= datetime(2007-01-01) and StartTime < datetime(2008-01-01)
| where EventType has "Flood"
| summarize Events = count(), PropertyDamage = sum(DamageProperty) by State
| top 5 by PropertyDamage desc
```

And `let` used the way you'd use a CTE, to keep thresholds out of the body of the query:

```kql
let minInjuries = 10;
let costlyStates = StormEvents
    | summarize Damage = sum(DamageProperty) by State
    | top 10 by Damage desc
    | project State;
StormEvents
| where State in (costlyStates)
| where InjuriesDirect >= minInjuries
| project StartTime, State, EventType, InjuriesDirect
| order by InjuriesDirect desc
```

## Two habits that will burn a SQL developer

### `join` is not an inner join unless you say so

The default `join` flavour in KQL is `innerunique`, not `inner`. It deduplicates the left side on the join key before matching, so if your left table has repeated keys you silently lose rows. This is the single most common bug I see in KQL written by people coming from SQL.

```kql
let Left = datatable(Key:string, Value:int) ["a", 1, "a", 2];
let Right = datatable(Key:string, Label:string) ["a", "first"];
Left
| join kind=inner Right on Key
// Returns 2 rows. Remove "kind=inner" and you get 1 row (innerunique).
```

My rule is to always write `kind=` explicitly, so the reader knows the choice was deliberate. The [join operator reference](https://learn.microsoft.com/en-us/kusto/query/join-operator) lists all the flavours, including `leftanti` and `leftsemi`, which replace most `NOT EXISTS` and `EXISTS` patterns. For a single-column filter, though, `where Key in (subquery)` beats `leftsemi`, as in the `costlyStates` example above. The `in` operator supports up to 1,000,000 values from a subquery, so keep the subquery small or `summarize` it down first.

Also put the smaller table on the left, and filter both sides before joining. KQL joins are fine, but they're not where the engine shines, and on high-volume log tables a `summarize` with `arg_max()` or a `lookup` against a small dimension table is often the better tool. The most common case is "latest row per key", where SQL people write a self-join against `MAX()`. In KQL it's one line. In a Log Analytics workspace, `Heartbeat | summarize arg_max(TimeGenerated, *) by Computer` returns the most recent heartbeat row, with every column, for each computer.

`lookup` flips the rule: the large fact table goes on the left and the small dimension on the right, and the right side must stay small (tens of megabytes at most) or the query fails:

```kql
StormEvents
| summarize Events = count() by State
| lookup kind=inner (PopulationData) on State
| extend EventsPerMillion = round(Events * 1000000.0 / Population, 1)
| project State, Events, Population, EventsPerMillion
| top 10 by EventsPerMillion desc
```

### `contains` is the slow way to search text

SQL people reach for `contains` because it feels like `LIKE '%x%'`. In KQL, `has` looks up whole terms in the term index the engine builds for string columns, while `contains` scans for substrings. Microsoft's [query best practices](https://learn.microsoft.com/en-us/kusto/query/best-practices) say plainly to prefer `has` over `contains` when you're looking for full tokens. On a small table you won't notice. On a busy Log Analytics workspace or Sentinel table, it's the difference between a query that returns and one that times out. In Log Analytics that ceiling is real: the query API defaults to a three-minute timeout and caps any query at 10 minutes.

The trade-off is semantics: `"KustoExplorerQueryRun" has "Explorer"` is false, because "Explorer" isn't a standalone term. Use `has` for words, IDs and error codes, and save `contains` or `matches regex` for when you genuinely need substring or pattern matching. Terms are runs of alphanumeric characters, split on everything else. One detail decides real queries: only terms of three characters or more are indexed, so `has "DB"` or `has "42"` quietly falls back to a scan. When you know the case, `has_cs` is faster still.

## A practical example: Azure OpenAI token usage

Token consumption is a question I find myself coming back to on any Azure OpenAI workload, and it's a good example of KQL meeting a real operational need. Azure OpenAI publishes token counts as platform metrics, including `ProcessedPromptTokens` and `GeneratedTokens`. If you add a diagnostic setting that sends `AllMetrics` to a Log Analytics workspace, they land in the `AzureMetrics` table:

```kql
AzureMetrics
| where TimeGenerated > ago(7d)
| where ResourceProvider == "MICROSOFT.COGNITIVESERVICES"
| where MetricName in ("ProcessedPromptTokens", "GeneratedTokens")
| summarize Tokens = sum(Total) by Resource, MetricName, bin(TimeGenerated, 1h)
| render timechart
```

There's a catch worth knowing before you build a dashboard on this. Diagnostic settings export metrics flattened, aggregated across dimension values, so you get totals per resource rather than a split by model deployment. The [Azure OpenAI monitoring reference](https://learn.microsoft.com/en-us/azure/foundry/openai/monitor-openai-reference) lists the dimensions, but you only see them in Metrics Explorer or via [metrics export through data collection rules](https://learn.microsoft.com/en-us/azure/azure-monitor/data-collection/metrics-export-create), which is still in preview at the time of writing and keeps dimensions and writes to the `AzureMetricsV2` table. If you need per-model or per-consumer numbers in Log Analytics, the cleaner route is to put Azure API Management in front of the models and enable its [LLM logs](https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-llm-logs) (also in preview), which record prompt tokens, completion tokens and model name per request in the `ApiManagementGatewayLlmLog` table.

I deliberately don't multiply tokens by a hard-coded price inside the query. Prices differ by model, deployment type and region and they change; a stale constant in a saved query is how a cost dashboard ends up confidently wrong. Keep token counts in KQL and do the pricing in Cost Management or a small reference table you maintain.

## Where KQL runs, and what differs

The language is shared, but each host exposes a different slice of it.

| Host | What you get | Watch out for |
|---|---|---|
| Log Analytics / Application Insights | Query, alerts, workbooks | No management commands; 10-minute query limit; Basic and Auxiliary table plans support a reduced set of KQL and charge for data scanned |
| Microsoft Sentinel | Hunting, analytics rules, workbooks | Rules re-run on a schedule, so an inefficient query burns engine time and can hit query limits on every run; keep rule queries tight and time-bounded |
| Microsoft Defender XDR advanced hunting | Hunting across endpoint, identity, email and cloud app tables, custom detection rules | Per-tenant resource quotas throttle heavy queries; Sentinel workspace tables appear only when Sentinel is onboarded to the Defender portal |
| Azure Data Explorer | Full engine, management commands, policies | You own the cluster sizing and caching policy |
| Fabric Eventhouse (Real-Time Intelligence) | KQL databases, querysets, Real-Time Dashboards | Consumes Fabric capacity units, so heavy queries compete with other workloads |

In Fabric, an Eventhouse hosts one or more KQL databases, and Eventstream is the usual way data arrives. The query side looks identical to Azure Data Explorer:

```kql
// Fragment: assumes a SensorReadings table with Timestamp, DeviceId, SensorType and Value columns
SensorReadings
| where Timestamp > ago(15m)
| where SensorType == "temperature"
| summarize AvgTemp = avg(Value), MaxTemp = max(Value) by DeviceId
| where AvgTemp > 75
| order by AvgTemp desc
```

I filter on the event's own timestamp rather than `ingestion_time()`. Ingestion time tells you when the row arrived, which drifts from when the event happened as soon as a device buffers or a pipeline backs up. For more on the Fabric side, see [Microsoft Fabric Real-Time Intelligence: Patterns for Streaming Analytics](/blog/2025-06-18-fabric-real-time-intelligence-patterns/).

## When KQL is the wrong tool

KQL is built for append-only, time-stamped data where you ask aggregate questions. It's a poor fit when:

- **You need transactions or row-level updates.** There are no `UPDATE` statements in queries, and updates in the engine are bulk operations, not OLTP. Use Azure SQL Database or a SQL database in Fabric for the transactional side, and stream its changes into KQL if you need to analyse them.
- **Your model is wide and relational.** A star schema with many joins and slowly changing dimensions belongs in a Fabric Warehouse or a Power BI semantic model, where joins and conformed dimensions are the point rather than a cost.
- **Your team only needs one query a quarter.** If a saved query and a workbook cover it, don't make everyone learn a new language. Teach the two or three people who will own it, and keep everyone else on workbooks and dashboards.

## How I'd learn it in a week

Skip the courses at first. Open Log Analytics against a workspace you already own, or the `help` cluster above, and answer one real question a day: which role logs the most errors, which dependency is slowest, which alerts never fire. When the query works, rewrite it with an explicit `join kind=`, `has` instead of `contains`, and the time filter first. Those three habits cover most of what separates a working KQL query from a good one.

KQL isn't a specialist skill on Azure. Every service in the table above answers in it, so the time to get fluent is now. Learn it before the next incident, not during it.
