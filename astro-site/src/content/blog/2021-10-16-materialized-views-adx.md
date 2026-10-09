---
title: "Materialized Views in Azure Data Explorer"
description: "Materialized views in ADX pre-aggregate data according to a defined query, updating continuously as new data is ingested—so when you query the view, you're…"
author: "Michael John Peña"
draft: false
date: 2021-10-16
tags: ["Azure", "Azure Data Explorer", "ADX", "Performance", "Kusto"]
---

Materialized views in ADX pre-aggregate data according to a defined query, updating continuously as new data is ingested—so when you query the view, you're reading pre-computed results rather than scanning and aggregating the raw table at query time. The performance gain is significant for common aggregation patterns: `summarize count() by bin(Timestamp, 1h), Region` over billions of rows returns in milliseconds from a materialized view versus seconds from the raw table. The practical use cases: hourly/daily rollups of high-cardinality event streams, distinct count approximations (using HyperLogLog) that would be expensive to recompute, and filtered subsets of large tables that multiple queries need frequently. The tradeoff: materialized views consume cluster resources continuously for the aggregation computation, and the initial backfill of a new view over existing data can be resource-intensive.

## What Are Materialized Views?

Materialized views:
- Pre-compute aggregations as data arrives
- Store results for fast querying
- Update automatically with new data
- Reduce compute costs for repeated queries

## When to Use Materialized Views

Ideal scenarios:
- Dashboard queries that run frequently
- Aggregations over large time ranges
- Deduplication requirements
- Downsampling high-frequency data

## Creating Basic Materialized Views

### Hourly Aggregation

```kusto
// Create materialized view for hourly metrics
.create materialized-view with (backfill=true) HourlyMetrics on table PerfMetrics
{
    PerfMetrics
    | summarize
        AvgValue = avg(CounterValue),
        MinValue = min(CounterValue),
        MaxValue = max(CounterValue),
        SampleCount = count()
        by bin(TimeGenerated, 1h), Computer, CounterName, InstanceName
}
```

### Error Summary

```kusto
// Aggregate errors by hour and namespace
.create materialized-view ErrorSummary on table ContainerLogs
{
    ContainerLogs
    | where LogEntry contains "error" or LogEntry contains "exception"
    | summarize
        ErrorCount = count(),
        FirstSeen = min(TimeGenerated),
        LastSeen = max(TimeGenerated)
        by bin(TimeGenerated, 1h), Namespace, PodName
}
```

## Deduplication Views

### Remove Duplicate Events

```kusto
// Keep only the latest record per pod
.create materialized-view LatestPodStatus on table KubePodInventory
{
    KubePodInventory
    | summarize arg_max(TimeGenerated, *) by Name, Namespace
}
```

### Dedup by Custom Key

```kusto
// Deduplicate by request ID
.create materialized-view UniqueRequests on table RequestLogs
{
    RequestLogs
    | summarize arg_min(TimeGenerated, *) by RequestId
}
```

## Advanced Aggregations

### Multiple Aggregation Levels

```kusto
// Create minute-level aggregation
.create materialized-view MinuteMetrics on table PerfMetrics
{
    PerfMetrics
    | summarize
        AvgValue = avg(CounterValue),
        P95Value = percentile(CounterValue, 95),
        P99Value = percentile(CounterValue, 99)
        by bin(TimeGenerated, 1m), Computer, CounterName
}

// Create hour-level from minute-level
.create materialized-view HourlyFromMinute on table MinuteMetrics
{
    MinuteMetrics
    | summarize
        AvgValue = avg(AvgValue),
        P95Value = max(P95Value),
        P99Value = max(P99Value)
        by bin(TimeGenerated, 1h), Computer, CounterName
}
```

### Cardinality Estimation

```kusto
// Count unique values efficiently
.create materialized-view UniqueUsers on table RequestLogs
{
    RequestLogs
    | summarize
        UniqueUsers = dcount(UserId),
        TotalRequests = count()
        by bin(TimeGenerated, 1h), Endpoint
}
```

## Querying Materialized Views

### Direct Query

```kusto
// Query the materialized view directly
HourlyMetrics
| where TimeGenerated > ago(7d)
| where CounterName == "cpuUsageNanoCores"
| render timechart
```

### Using materialized_view() Function

```kusto
// Explicitly query materialized portion
materialized_view('HourlyMetrics')
| where TimeGenerated > ago(30d)
| summarize sum(SampleCount) by Computer
```

### Combining with Live Data

```kusto
// Get historical from view, recent from table
let historical = materialized_view('HourlyMetrics')
    | where TimeGenerated between (ago(30d) .. ago(1h));

let recent = PerfMetrics
    | where TimeGenerated > ago(1h)
    | summarize AvgValue = avg(CounterValue) by bin(TimeGenerated, 1h), Computer, CounterName;

union historical, recent
| summarize avg(AvgValue) by bin(TimeGenerated, 1d), Computer
```

## Managing Materialized Views

### Check View Status

```kusto
// Show all materialized views
.show materialized-views

// Show specific view details
.show materialized-view HourlyMetrics

// Check materialization progress
.show materialized-view HourlyMetrics extents
```

### View Statistics

```kusto
// Get materialization statistics
.show materialized-view HourlyMetrics statistics

// Check for lag
.show materialized-view HourlyMetrics statistics
| project MaterializationLag = LastRun - now()
```

### Alter Views

```kusto
// Disable view
.disable materialized-view HourlyMetrics

// Enable view
.enable materialized-view HourlyMetrics

// Drop view
.drop materialized-view HourlyMetrics
```

## Backfill Strategies

### Full Backfill

```kusto
// Create with full backfill (processes all existing data)
.create materialized-view with (backfill=true) HourlyMetrics on table PerfMetrics
{
    PerfMetrics
    | summarize avg(CounterValue) by bin(TimeGenerated, 1h), Computer
}
```

### Partial Backfill

```kusto
// Backfill from specific date
.create materialized-view with (effectiveDateTime=datetime(2021-09-01)) HourlyMetrics on table PerfMetrics
{
    PerfMetrics
    | summarize avg(CounterValue) by bin(TimeGenerated, 1h), Computer
}
```

### Async Backfill

```kusto
// Create view and backfill asynchronously
.create async materialized-view with (backfill=true) LargeViewBackfill on table MassiveTable
{
    MassiveTable
    | summarize count() by bin(TimeGenerated, 1h), Category
}
```

## Policies and Configuration

### Retention Policy

```kusto
// Set retention for materialized view
.alter materialized-view HourlyMetrics policy retention ```
{
  "SoftDeletePeriod": "365.00:00:00",
  "Recoverability": "Enabled"
}```
```

### Caching Policy

```kusto
// Set hot cache for fast queries
.alter materialized-view HourlyMetrics policy caching hot = 90d
```

## Performance Considerations

### Query Performance Comparison

```kusto
// Without materialized view (slow on large data)
PerfMetrics
| where TimeGenerated > ago(30d)
| summarize avg(CounterValue) by bin(TimeGenerated, 1h), Computer
| count

// With materialized view (fast)
HourlyMetrics
| where TimeGenerated > ago(30d)
| count
```

### Monitoring View Health

```kusto
// Create alert for materialization lag
.show materialized-view HourlyMetrics statistics
| extend LagMinutes = datetime_diff('minute', now(), LastRun)
| where LagMinutes > 30
```

## Real-World Examples

### Dashboard Summary View

```kusto
.create materialized-view DashboardSummary on table ContainerLogs
{
    ContainerLogs
    | summarize
        TotalLogs = count(),
        ErrorLogs = countif(LogEntry contains "error"),
        WarningLogs = countif(LogEntry contains "warning")
        by bin(TimeGenerated, 5m), Namespace, PodName
}
```

### SLA Metrics View

```kusto
.create materialized-view SLAMetrics on table RequestLogs
{
    RequestLogs
    | summarize
        TotalRequests = count(),
        SuccessfulRequests = countif(StatusCode < 500),
        P50Latency = percentile(DurationMs, 50),
        P99Latency = percentile(DurationMs, 99)
        by bin(TimeGenerated, 1h), ServiceName, Endpoint
}
```

## Best Practices

1. **Start with common queries** - Materialize patterns you run frequently
2. **Choose appropriate granularity** - Match aggregation to query needs
3. **Monitor lag** - Ensure views stay current
4. **Set retention** - Don't keep materialized data longer than needed
5. **Test query patterns** - Verify views improve performance
6. **Document views** - Keep track of what each view provides

## Conclusion

Materialized views are a powerful optimization technique for Azure Data Explorer. By pre-computing aggregations, you can dramatically improve query performance and reduce costs for common monitoring scenarios.

Tomorrow, we'll explore external tables in ADX for querying data stored outside the cluster.
