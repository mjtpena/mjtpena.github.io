---
title: Mastering Log Analytics Queries with KQL
author: Michael John Peña
draft: false
date: 2021-02-23
url: /blog/log-analytics-queries/
tags:
  - Azure
  - Log Analytics
  - KQL
  - Monitoring
  - Observability
---

KQL is the query language I've spent the most hours in this year that most developers have never heard of. If you use Log Analytics, Sentinel, Application Insights, or Azure Data Explorer, you're writing KQL whether you know it or not. Today's post is the queries I actually use during incidents and reviews—not the introductory documentation examples, but the ones I've used to find a slow dependency, correlate an alert with a deployment event, and build a 30-day error trend in under five minutes.

## KQL Fundamentals

### Basic Query Structure

```kusto
// Select all columns from a table
AzureDiagnostics
| take 100

// Select specific columns
AzureDiagnostics
| project TimeGenerated, ResourceId, OperationName
| take 100

// Filter rows
AzureDiagnostics
| where TimeGenerated > ago(1h)
| where Category == "SQLSecurityAuditEvents"
| take 100
```

### Time Filtering

```kusto
// Relative time
| where TimeGenerated > ago(1h)
| where TimeGenerated > ago(7d)
| where TimeGenerated between (ago(2d) .. ago(1d))

// Absolute time
| where TimeGenerated > datetime(2021-02-01)
| where TimeGenerated between (datetime(2021-02-01) .. datetime(2021-02-15))

// Time functions
| extend Hour = datetime_part("hour", TimeGenerated)
| extend DayOfWeek = dayofweek(TimeGenerated)
| extend WeekNumber = week_of_year(TimeGenerated)
```

### String Operations

```kusto
// Contains
| where Message contains "error"
| where Message contains_cs "Error"  // Case sensitive

// Starts/ends with
| where ResourceId startswith "/subscriptions"
| where FileName endswith ".exe"

// Regular expressions
| where Message matches regex @"\d{3}-\d{4}"

// String extraction
| extend ErrorCode = extract(@"Error code: (\d+)", 1, Message)
| parse Message with * "User " Username " logged in from " IPAddress
```

## Aggregations and Summarization

```kusto
// Count by category
AzureDiagnostics
| where TimeGenerated > ago(24h)
| summarize Count = count() by Category
| order by Count desc

// Multiple aggregations
Perf
| where TimeGenerated > ago(1h)
| where ObjectName == "Processor"
| summarize
    AvgCPU = avg(CounterValue),
    MaxCPU = max(CounterValue),
    MinCPU = min(CounterValue),
    StdDevCPU = stdev(CounterValue)
    by Computer, bin(TimeGenerated, 5m)

// Distinct count
SecurityEvent
| where TimeGenerated > ago(24h)
| summarize
    UniqueComputers = dcount(Computer),
    UniqueUsers = dcount(Account)

// Percentiles
AppRequests
| where TimeGenerated > ago(1h)
| summarize
    P50 = percentile(DurationMs, 50),
    P95 = percentile(DurationMs, 95),
    P99 = percentile(DurationMs, 99)
    by AppRoleName
```

## Joins and Unions

```kusto
// Inner join
AppRequests
| where TimeGenerated > ago(1h)
| where Success == false
| join kind=inner (
    AppExceptions
    | where TimeGenerated > ago(1h)
) on OperationId
| project TimeGenerated, RequestName = Name, ExceptionType = Type, ExceptionMessage = OuterMessage

// Left outer join
Heartbeat
| where TimeGenerated > ago(1h)
| summarize LastHeartbeat = max(TimeGenerated) by Computer
| join kind=leftouter (
    Perf
    | where TimeGenerated > ago(1h)
    | where ObjectName == "Memory"
    | summarize AvgMemory = avg(CounterValue) by Computer
) on Computer

// Union tables
AppRequests
| where Success == false
| project TimeGenerated, Type = "Request", Name, Message = ResultCode
| union (
    AppExceptions
    | project TimeGenerated, Type = "Exception", Name = Type, Message = OuterMessage
)
| order by TimeGenerated desc
```

## Advanced Analytics

### Time Series Analysis

```kusto
// Create time series
AppRequests
| where TimeGenerated > ago(7d)
| make-series RequestCount = count() on TimeGenerated step 1h
| render timechart

// Anomaly detection
AppRequests
| where TimeGenerated > ago(7d)
| make-series RequestCount = count() on TimeGenerated step 1h
| extend anomalies = series_decompose_anomalies(RequestCount)
| mv-expand TimeGenerated, RequestCount, anomalies
| where anomalies != 0
| project TimeGenerated, RequestCount, AnomalyScore = anomalies

// Forecasting
Perf
| where TimeGenerated > ago(30d)
| where ObjectName == "Memory" and CounterName == "% Committed Bytes In Use"
| make-series MemoryUsage = avg(CounterValue) on TimeGenerated step 1d
| extend forecast = series_decompose_forecast(MemoryUsage, 7)
| render timechart
```

### Window Functions

```kusto
// Running total
AppRequests
| where TimeGenerated > ago(24h)
| summarize RequestCount = count() by bin(TimeGenerated, 1h)
| order by TimeGenerated asc
| extend RunningTotal = row_cumsum(RequestCount)

// Moving average
Perf
| where TimeGenerated > ago(7d)
| where ObjectName == "Processor"
| summarize AvgCPU = avg(CounterValue) by bin(TimeGenerated, 1h)
| order by TimeGenerated asc
| extend MovingAvg = row_window_session(AvgCPU, TimeGenerated, 24h, 0)

// Previous value comparison
AppRequests
| where TimeGenerated > ago(24h)
| summarize RequestCount = count() by bin(TimeGenerated, 1h)
| order by TimeGenerated asc
| extend PrevCount = prev(RequestCount)
| extend Change = RequestCount - PrevCount
| extend ChangePercent = round(100.0 * Change / PrevCount, 2)
```

## Practical Query Examples

### Application Performance

```kusto
// Slow requests by operation
AppRequests
| where TimeGenerated > ago(24h)
| where DurationMs > 5000
| summarize
    SlowCount = count(),
    AvgDuration = avg(DurationMs),
    P95Duration = percentile(DurationMs, 95)
    by Name
| order by SlowCount desc
| take 20

// Error rate over time
AppRequests
| where TimeGenerated > ago(24h)
| summarize
    TotalRequests = count(),
    FailedRequests = countif(Success == false)
    by bin(TimeGenerated, 1h)
| extend ErrorRate = round(100.0 * FailedRequests / TotalRequests, 2)
| render timechart

// Dependency analysis
AppDependencies
| where TimeGenerated > ago(1h)
| summarize
    CallCount = count(),
    FailedCount = countif(Success == false),
    AvgDuration = avg(DurationMs)
    by DependencyType, Target
| extend FailureRate = round(100.0 * FailedCount / CallCount, 2)
| order by FailedCount desc
```

### Security Analysis

```kusto
// Failed sign-ins by location
SigninLogs
| where TimeGenerated > ago(24h)
| where ResultType != 0
| summarize FailedAttempts = count() by Location
| order by FailedAttempts desc
| take 10

// Brute force detection
SigninLogs
| where TimeGenerated > ago(1h)
| where ResultType != 0
| summarize
    FailedAttempts = count(),
    UniqueUsers = dcount(UserPrincipalName)
    by IPAddress
| where FailedAttempts > 20
| order by FailedAttempts desc

// Suspicious admin activities
AuditLogs
| where TimeGenerated > ago(24h)
| where Category == "RoleManagement"
| where Result == "success"
| extend InitiatedBy = tostring(InitiatedBy.user.userPrincipalName)
| project TimeGenerated, Activity = ActivityDisplayName, InitiatedBy, TargetResources
```

### Infrastructure Monitoring

```kusto
// VM availability
Heartbeat
| where TimeGenerated > ago(24h)
| summarize LastHeartbeat = max(TimeGenerated) by Computer
| extend MinutesSinceHeartbeat = datetime_diff('minute', now(), LastHeartbeat)
| where MinutesSinceHeartbeat > 5
| order by MinutesSinceHeartbeat desc

// Disk space critical
Perf
| where TimeGenerated > ago(1h)
| where ObjectName == "LogicalDisk" and CounterName == "% Free Space"
| where InstanceName !in ("_Total", "HarddiskVolume1")
| summarize AvgFreeSpace = avg(CounterValue) by Computer, InstanceName
| where AvgFreeSpace < 10
| order by AvgFreeSpace asc

// Network traffic analysis
AzureNetworkAnalytics_CL
| where TimeGenerated > ago(1h)
| where FlowType_s == "ExternalPublic"
| summarize
    BytesIn = sum(InboundBytes_d),
    BytesOut = sum(OutboundBytes_d),
    Connections = count()
    by bin(TimeGenerated, 5m), DestIP_s
| render timechart
```

### Cost Analysis

```kusto
// Usage by resource type
Usage
| where TimeGenerated > ago(30d)
| summarize TotalGB = sum(Quantity) / 1024 by DataType
| order by TotalGB desc
| render piechart

// Daily ingestion trend
Usage
| where TimeGenerated > ago(30d)
| summarize DailyGB = sum(Quantity) / 1024 by bin(TimeGenerated, 1d)
| render timechart

// Top data contributors
Usage
| where TimeGenerated > ago(7d)
| summarize TotalMB = sum(Quantity) by Computer, DataType
| top 20 by TotalMB desc
```

## Creating Functions

```kusto
// Save as function: GetSlowRequests
// Parameters: threshold:long = 5000, timeRange:timespan = 1h
AppRequests
| where TimeGenerated > ago(timeRange)
| where DurationMs > threshold
| summarize
    Count = count(),
    AvgDuration = avg(DurationMs),
    MaxDuration = max(DurationMs)
    by Name
| order by Count desc

// Usage
GetSlowRequests(10000, 24h)
```

## Best Practices

1. **Start with time filters** - Always filter by time first
2. **Use project early** - Select only needed columns
3. **Limit results during development** - Use take or limit
4. **Create reusable functions** - Save common queries
5. **Use bin() for time aggregations** - Consistent time buckets
6. **Consider query performance** - Large time ranges and complex joins can be slow

## Conclusion

KQL is a powerful language for analyzing data in Azure Log Analytics. By mastering these query patterns, you can effectively monitor your applications, troubleshoot issues, and gain valuable insights from your Azure resources.

Practice with the Log Analytics demo environment to improve your skills before querying production data.
