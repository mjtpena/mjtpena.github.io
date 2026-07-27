---
title: "Cross-Workspace Queries in Azure Monitor"
author: "Michael John Peña"
draft: false
date: 2021-10-12
tags: ["Azure", "Log Analytics", "Kusto", "Monitoring", "KQL"]

---

I wrote "Cross-Workspace Queries in Azure Monitor" to share practical, production-minded guidance on this topic.

Cross-workspace queries in KQL let you write a single query that spans multiple Log Analytics workspaces—essential when your monitoring architecture splits data across workspaces by team, region, or compliance boundary but you need a unified view for incident investigation or capacity reporting. The `workspace("workspace-name")` or `workspace("/subscriptions/.../workspaces/name")` syntax references another workspace in your query: `workspace("security-logs").SecurityEvent | where ... | union workspace("app-team-logs").AppException`. The limitation: cross-workspace queries don't automatically optimise across workspace boundaries; query performance depends on the size of each workspace's data being scanned. For dashboards that need to aggregate across workspaces, Azure Monitor Workbooks with cross-workspace queries work well; for high-frequency automated queries, consider consolidating the data into Azure Data Explorer for better query performance at scale.

## Understanding Cross-Workspace Queries

Cross-workspace queries allow you to:
- Query data from multiple workspaces in a single query
- Create unified dashboards across environments
- Correlate events across clusters
- Build centralized alerting

## Basic Syntax

### Using workspace() Function

```kusto
// Query another workspace by name
workspace("production-workspace").ContainerLog
| where TimeGenerated > ago(1h)
| limit 100

// Query by workspace ID
workspace("12345678-1234-1234-1234-123456789abc").ContainerLog
| where TimeGenerated > ago(1h)
| limit 100

// Query by resource ID
workspace("/subscriptions/{sub}/resourcegroups/{rg}/providers/microsoft.operationalinsights/workspaces/{name}").ContainerLog
| where TimeGenerated > ago(1h)
```

### Union Across Workspaces

```kusto
// Combine data from multiple workspaces
union
    workspace("dev-workspace").ContainerLog,
    workspace("staging-workspace").ContainerLog,
    workspace("prod-workspace").ContainerLog
| where TimeGenerated > ago(1h)
| where LogEntry contains "error"
| summarize count() by bin(TimeGenerated, 5m)
| render timechart
```

## Practical Examples

### Cross-Cluster Pod Status

```kusto
let devPods = workspace("dev-logs").KubePodInventory
| extend Cluster = "Development";
let stagingPods = workspace("staging-logs").KubePodInventory
| extend Cluster = "Staging";
let prodPods = workspace("prod-logs").KubePodInventory
| extend Cluster = "Production";

union devPods, stagingPods, prodPods
| where TimeGenerated > ago(1h)
| summarize
    Running = countif(PodStatus == "Running"),
    Pending = countif(PodStatus == "Pending"),
    Failed = countif(PodStatus == "Failed")
    by Cluster
| order by Cluster asc
```

### Unified Error Dashboard

```kusto
let getErrors = (ws: string) {
    workspace(ws).ContainerLog
    | where TimeGenerated > ago(24h)
    | where LogEntry contains "error" or LogEntry contains "exception"
    | extend Workspace = ws
};

union
    getErrors("dev-logs"),
    getErrors("staging-logs"),
    getErrors("prod-logs")
| summarize ErrorCount = count() by bin(TimeGenerated, 1h), Workspace
| render timechart
```

### Cross-Environment Latency Comparison

```kusto
let getLatency = (ws: string, env: string) {
    workspace(ws).Perf
    | where ObjectName == "K8SContainer"
    | where CounterName == "cpuUsageNanoCores"
    | extend Environment = env
};

union
    getLatency("dev-logs", "Dev"),
    getLatency("staging-logs", "Staging"),
    getLatency("prod-logs", "Production")
| summarize AvgCPU = avg(CounterValue) by bin(TimeGenerated, 5m), Environment
| render timechart
```

## Using app() for Application Insights

Query Application Insights alongside Log Analytics:

```kusto
// Combine Log Analytics with App Insights
let containerErrors = workspace("prod-logs").ContainerLog
| where LogEntry contains "error"
| project TimeGenerated, Source = "Container", Message = LogEntry;

let appErrors = app("prod-app-insights").exceptions
| project TimeGenerated, Source = "AppInsights", Message = outerMessage;

union containerErrors, appErrors
| where TimeGenerated > ago(1h)
| order by TimeGenerated desc
```

## Resource-Centric Queries

Query across all workspaces in a resource group:

```kusto
// Query all workspaces in resource scope
resources
| where type == "microsoft.operationalinsights/workspaces"
| project workspaceId = tostring(id)
| mv-expand workspaceId to typeof(string)
| evaluate workspace_centric_query(
    ContainerLog
    | where TimeGenerated > ago(1h)
    | summarize count() by Computer
)
```

## Performance Optimization

### Limit Time Ranges

```kusto
// Always specify time filter first
workspace("prod-logs").ContainerLog
| where TimeGenerated > ago(1h)  // Filter early
| where LogEntry contains "error"
| summarize count()
```

### Use Materialized Views

Create summarized data for faster cross-workspace queries:

```kusto
// Create a function that pre-aggregates data
.create function with (folder = "Views") CrossClusterSummary() {
    union
        workspace("dev-logs").KubePodInventory | extend Cluster = "Dev",
        workspace("prod-logs").KubePodInventory | extend Cluster = "Prod"
    | where TimeGenerated > ago(1h)
    | summarize PodCount = count() by Cluster, PodStatus, bin(TimeGenerated, 5m)
}
```

### Parallel Execution

Structure queries to enable parallel execution:

```kusto
// Each workspace query runs in parallel
let devData = workspace("dev-logs").ContainerLog | where TimeGenerated > ago(1h) | summarize DevCount = count();
let prodData = workspace("prod-logs").ContainerLog | where TimeGenerated > ago(1h) | summarize ProdCount = count();

devData | extend ProdCount = toscalar(prodData | project ProdCount)
```

## Cross-Workspace Alerting

### Creating Multi-Workspace Alerts

```json
{
  "type": "Microsoft.Insights/scheduledQueryRules",
  "apiVersion": "2021-08-01",
  "name": "cross-cluster-alert",
  "location": "eastus",
  "properties": {
    "displayName": "Cross-Cluster Error Alert",
    "severity": 2,
    "enabled": true,
    "evaluationFrequency": "PT5M",
    "scopes": [
      "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/central-logs"
    ],
    "targetResourceTypes": [
      "Microsoft.OperationalInsights/workspaces"
    ],
    "windowSize": "PT15M",
    "criteria": {
      "allOf": [
        {
          "query": "union workspace('dev-logs').ContainerLog, workspace('prod-logs').ContainerLog | where LogEntry contains 'critical' | summarize count()",
          "timeAggregation": "Count",
          "operator": "GreaterThan",
          "threshold": 10
        }
      ]
    }
  }
}
```

## Cross-Workspace Dashboard

Create an Azure Workbook with cross-workspace data:

```json
{
  "version": "Notebook/1.0",
  "items": [
    {
      "type": 3,
      "content": {
        "version": "KqlItem/1.0",
        "query": "union workspace('dev-logs').KubePodInventory, workspace('staging-logs').KubePodInventory, workspace('prod-logs').KubePodInventory | where TimeGenerated > ago(1h) | summarize count() by PodStatus | render piechart",
        "size": 1,
        "title": "Pod Status Across All Clusters"
      }
    }
  ]
}
```

## Limitations and Considerations

1. **Query limits** - Maximum 100 workspaces per query
2. **Performance** - Cross-workspace queries are slower
3. **Permissions** - Need read access to all workspaces
4. **Region** - Best performance when workspaces are in same region
5. **Costs** - Each workspace processes the query independently

## Best Practices

1. **Filter early** - Apply time and other filters before union
2. **Project needed columns** - Reduce data transfer
3. **Use summarize** - Aggregate before combining results
4. **Cache common queries** - Use functions for repeated patterns
5. **Monitor query performance** - Track query durations

## Conclusion

Cross-workspace queries unlock unified visibility across your distributed Log Analytics architecture. By understanding the syntax and optimization techniques, you can build powerful enterprise-wide monitoring solutions.

Tomorrow, we'll explore Azure Data Explorer integration for advanced analytics on your operational data.

