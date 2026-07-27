---
title: "Kusto Functions for Reusable Query Patterns"
author: "Michael John Peña"
draft: false
date: 2021-10-15
tags: ["Azure", "Kusto", "KQL", "Azure Data Explorer", "Log Analytics"]

---

I wrote "Kusto Functions for Reusable Query Patterns" to share practical, production-minded guidance on this topic.

KQL functions in Azure Data Explorer are the reusability mechanism that prevents the same complex query logic from being copy-pasted across dashboards, alerts, and analysis notebooks. A stored function encapsulates a query pattern—a parameterised aggregation, a join template, a normalisation expression—and makes it callable by name across the cluster. The types: stored functions (persisted in the database schema, callable in queries), let-bound functions (inline, local to one query), and views (parameterless functions that act like virtual tables). For monitoring data, the patterns that benefit most from functions: normalising raw telemetry into a standard schema (so downstream consumers don't need to know the raw schema), defining organisation-standard alert threshold calculations, and building composable aggregation building blocks. Functions that reference other functions form query pipelines that are significantly easier to maintain than deeply nested inline KQL.

## Types of Functions

KQL supports several function types:
- **User-defined functions** - Custom functions you create
- **Stored functions** - Persisted in the database
- **Query-defined functions** - Scoped to a single query
- **Built-in functions** - Provided by Kusto

## Query-Defined Functions

Define functions within a query using `let`:

```kusto
// Simple function
let getRecentErrors = (namespace: string) {
    ContainerLog
    | where TimeGenerated > ago(1h)
    | where Namespace == namespace
    | where LogEntry contains "error"
};

getRecentErrors("production")
| summarize count() by Computer
```

### Function with Multiple Parameters

```kusto
let getMetrics = (counterName: string, timeRange: timespan, threshold: real) {
    Perf
    | where TimeGenerated > ago(timeRange)
    | where CounterName == counterName
    | where CounterValue > threshold
    | summarize AvgValue = avg(CounterValue) by bin(TimeGenerated, 5m), Computer
};

getMetrics("cpuUsageNanoCores", 24h, 500000000)
| render timechart
```

### Function with Default Parameters

```kusto
let getContainerLogs = (
    namespace: string = "default",
    severity: string = "error",
    lookback: timespan = 1h
) {
    ContainerLog
    | where TimeGenerated > ago(lookback)
    | where Namespace == namespace
    | where LogEntry contains severity
};

// Use with defaults
getContainerLogs()

// Override specific parameters
getContainerLogs(namespace="production", lookback=24h)
```

## Stored Functions

Create persistent functions in the database:

```kusto
// Create a stored function
.create-or-alter function with (folder = "Monitoring", docstring = "Get pod errors by namespace")
GetPodErrors(namespace: string, hours: int) {
    KubePodInventory
    | where TimeGenerated > ago(hours * 1h)
    | where Namespace == namespace
    | where PodStatus == "Failed" or ContainerStatus contains "Error"
    | project TimeGenerated, Name, Namespace, PodStatus, ContainerStatus
}

// Use the stored function
GetPodErrors("production", 24)
```

### Organizing Functions in Folders

```kusto
// Create function with folder organization
.create-or-alter function with (folder = "Monitoring/Kubernetes")
GetNodeHealth() {
    KubeNodeInventory
    | where TimeGenerated > ago(1h)
    | summarize arg_max(TimeGenerated, *) by Computer
    | project Computer, Status, KubeletVersion, Labels
}

.create-or-alter function with (folder = "Monitoring/Application")
GetAppErrors() {
    ContainerLog
    | where TimeGenerated > ago(1h)
    | where LogEntry contains "error" or LogEntry contains "exception"
    | project TimeGenerated, ContainerID, LogEntry
}
```

## Table-Valued Functions

Functions that return tabular data:

```kusto
.create-or-alter function GetHighCPUContainers(thresholdPercent: real = 80.0) {
    let cpuLimit = Perf
    | where CounterName == "cpuLimitNanoCores"
    | summarize Limit = avg(CounterValue) by InstanceName;

    Perf
    | where CounterName == "cpuUsageNanoCores"
    | summarize Usage = avg(CounterValue) by InstanceName
    | join kind=inner cpuLimit on InstanceName
    | extend UsagePercent = (Usage / Limit) * 100
    | where UsagePercent > thresholdPercent
    | project InstanceName, UsagePercent, Usage, Limit
    | order by UsagePercent desc
}
```

## Scalar Functions

Functions that return a single value:

```kusto
// Calculate error rate
.create-or-alter function CalculateErrorRate(namespace: string, hours: int) {
    let total = toscalar(
        ContainerLog
        | where TimeGenerated > ago(hours * 1h)
        | where Namespace == namespace
        | count
    );
    let errors = toscalar(
        ContainerLog
        | where TimeGenerated > ago(hours * 1h)
        | where Namespace == namespace
        | where LogEntry contains "error"
        | count
    );
    iff(total > 0, (errors * 100.0) / total, 0.0)
}

// Use in query
print ErrorRate = CalculateErrorRate("production", 24)
```

## Pattern-Based Functions

### Log Parsing Function

```kusto
.create-or-alter function ParseJsonLog(logEntry: string) {
    parse_json(logEntry)
}

// Usage
ContainerLog
| extend ParsedLog = ParseJsonLog(LogEntry)
| extend
    Level = tostring(ParsedLog.level),
    Message = tostring(ParsedLog.message),
    TraceId = tostring(ParsedLog.traceId)
```

### Time Window Function

```kusto
.create-or-alter function GetTimeWindow(windowName: string) {
    case(
        windowName == "last_hour", ago(1h),
        windowName == "last_day", ago(24h),
        windowName == "last_week", ago(7d),
        windowName == "last_month", ago(30d),
        ago(1h)  // default
    )
}

// Usage
ContainerLog
| where TimeGenerated > GetTimeWindow("last_day")
```

## Views Using Functions

Create logical views with functions:

```kusto
// Create a view of healthy pods
.create-or-alter function HealthyPods() {
    KubePodInventory
    | where TimeGenerated > ago(5m)
    | summarize arg_max(TimeGenerated, *) by Name, Namespace
    | where PodStatus == "Running"
    | where ContainerStatus !contains "Error"
}

// Create a view of problematic pods
.create-or-alter function ProblematicPods() {
    KubePodInventory
    | where TimeGenerated > ago(5m)
    | summarize arg_max(TimeGenerated, *) by Name, Namespace
    | where PodStatus != "Running" or ContainerStatus contains "Error" or ContainerRestartCount > 5
}
```

## Function Composition

Combine functions for complex scenarios:

```kusto
// Base function
.create-or-alter function GetContainerMetrics(containerName: string) {
    Perf
    | where InstanceName contains containerName
    | where TimeGenerated > ago(1h)
}

// Composed function
.create-or-alter function GetContainerHealth(containerName: string) {
    let metrics = GetContainerMetrics(containerName);
    let cpu = metrics | where CounterName == "cpuUsageNanoCores" | summarize AvgCPU = avg(CounterValue);
    let memory = metrics | where CounterName == "memoryWorkingSetBytes" | summarize AvgMemory = avg(CounterValue);
    cpu | extend AvgMemory = toscalar(memory | project AvgMemory)
}
```

## Managing Functions

### List Functions

```kusto
// List all functions
.show functions

// List functions in folder
.show functions | where Folder startswith "Monitoring"

// Show function definition
.show function GetPodErrors
```

### Delete Functions

```kusto
// Delete a function
.drop function GetPodErrors

// Delete functions by pattern (careful!)
.drop functions <| .show functions | where Name startswith "Test"
```

## Best Practices

1. **Use descriptive names** - Functions should be self-documenting
2. **Add documentation** - Use docstring parameter
3. **Organize in folders** - Group related functions
4. **Set defaults wisely** - Make common cases easy
5. **Test thoroughly** - Verify with different inputs
6. **Version control** - Store function definitions in source control

## Example: Complete Monitoring Library

```kusto
// Core monitoring functions
.create-or-alter function with (folder = "Core", docstring = "Get pods by status")
GetPodsByStatus(status: string) {
    KubePodInventory
    | where TimeGenerated > ago(5m)
    | summarize arg_max(TimeGenerated, *) by Name, Namespace
    | where PodStatus == status
}

.create-or-alter function with (folder = "Core", docstring = "Get container logs with parsed JSON")
GetParsedLogs(namespace: string, hours: int = 1) {
    ContainerLog
    | where TimeGenerated > ago(hours * 1h)
    | where Namespace == namespace
    | extend Parsed = parse_json(LogEntry)
    | extend Level = tostring(Parsed.level), Message = tostring(Parsed.message)
}

.create-or-alter function with (folder = "Alerts", docstring = "High memory containers")
HighMemoryContainers(thresholdGB: real = 4.0) {
    Perf
    | where CounterName == "memoryWorkingSetBytes"
    | where TimeGenerated > ago(15m)
    | summarize AvgMemory = avg(CounterValue) by InstanceName
    | where AvgMemory > (thresholdGB * 1073741824)
}
```

## Conclusion

Kusto functions are essential for building maintainable, reusable monitoring solutions. By encapsulating complex logic in well-designed functions, you can simplify queries and ensure consistency across your monitoring platform.

Tomorrow, we'll explore materialized views for optimizing repeated query patterns.

