---
title: Building Interactive Dashboards with Azure Monitor Workbooks
author: Michael John Pena
draft: false
date: 2021-01-21
url: /blog/azure-monitor-workbooks-dashboards/
tags:
  - Azure
  - Azure Monitor
  - Workbooks
  - Observability
  - KQL
---

Operational dashboards in Azure used to mean Power BI, a custom data export, and a refresh schedule nobody could remember. Workbooks killed all of that for me. Live KQL against Log Analytics, parameter pickers at the top, charts that drill into other workbooks, all of it shareable as a JSON definition you can check into Git. Today I'm walking through building a real operational dashboard end to end—not a tile gallery, an actual incident-response tool.

## Workbook Fundamentals

Workbooks combine multiple visualization types:
- Text blocks for context and documentation
- Query-based visualizations (charts, grids, tiles)
- Metrics visualizations
- Parameter controls for interactivity
- Links and navigation

## Creating Your First Workbook

Here is a JSON template for a basic application monitoring workbook:

```json
{
  "version": "Notebook/1.0",
  "items": [
    {
      "type": 1,
      "content": {
        "json": "# Application Health Dashboard\n\nThis workbook provides an overview of application health and performance."
      }
    },
    {
      "type": 9,
      "content": {
        "version": "KqlParameterItem/1.0",
        "parameters": [
          {
            "name": "TimeRange",
            "type": 4,
            "value": {
              "durationMs": 3600000
            },
            "typeSettings": {
              "selectableValues": [
                {"durationMs": 900000, "displayName": "Last 15 minutes"},
                {"durationMs": 3600000, "displayName": "Last hour"},
                {"durationMs": 86400000, "displayName": "Last 24 hours"},
                {"durationMs": 604800000, "displayName": "Last 7 days"}
              ]
            }
          },
          {
            "name": "Application",
            "type": 2,
            "query": "AppRequests | distinct AppRoleName | order by AppRoleName asc",
            "typeSettings": {
              "additionalResourceOptions": ["value::all"]
            }
          }
        ]
      }
    }
  ]
}
```

## KQL Queries for Monitoring

### Application Performance Overview

```kusto
// Request success rate and latency
AppRequests
| where TimeGenerated {TimeRange}
| where AppRoleName in ({Application}) or '*' in ({Application})
| summarize
    TotalRequests = count(),
    SuccessfulRequests = countif(Success == true),
    FailedRequests = countif(Success == false),
    AvgDuration = avg(DurationMs),
    P95Duration = percentile(DurationMs, 95),
    P99Duration = percentile(DurationMs, 99)
    by bin(TimeGenerated, {TimeRange:grain})
| extend SuccessRate = round(100.0 * SuccessfulRequests / TotalRequests, 2)
| project TimeGenerated, TotalRequests, SuccessRate, AvgDuration, P95Duration, P99Duration
```

### Error Analysis

```kusto
// Top errors by frequency
AppExceptions
| where TimeGenerated {TimeRange}
| where AppRoleName in ({Application}) or '*' in ({Application})
| summarize Count = count() by ExceptionType, ProblemId, OuterMessage
| top 10 by Count
| project ExceptionType,
    ErrorMessage = substring(OuterMessage, 0, 100),
    Count,
    ProblemId
```

### Dependency Health

```kusto
// External dependency performance
AppDependencies
| where TimeGenerated {TimeRange}
| where AppRoleName in ({Application}) or '*' in ({Application})
| summarize
    Calls = count(),
    Failures = countif(Success == false),
    AvgDuration = avg(DurationMs)
    by DependencyType, Target, Name
| extend FailureRate = round(100.0 * Failures / Calls, 2)
| project DependencyType, Target, Name, Calls, FailureRate, AvgDuration
| order by Calls desc
```

## Advanced Parameter Techniques

Create cascading parameters for drill-down scenarios:

```json
{
  "type": 9,
  "content": {
    "version": "KqlParameterItem/1.0",
    "parameters": [
      {
        "name": "Subscription",
        "type": 6,
        "isRequired": true,
        "multiSelect": true,
        "query": "Resources | summarize by subscriptionId | project value = subscriptionId"
      },
      {
        "name": "ResourceGroup",
        "type": 2,
        "isRequired": true,
        "query": "Resources | where subscriptionId in ({Subscription}) | summarize by resourceGroup | project value = resourceGroup",
        "dependsOn": ["Subscription"]
      },
      {
        "name": "Resource",
        "type": 5,
        "isRequired": true,
        "query": "Resources | where subscriptionId in ({Subscription}) | where resourceGroup in ({ResourceGroup}) | project value = id, label = name",
        "dependsOn": ["Subscription", "ResourceGroup"]
      }
    ]
  }
}
```

## Building a Kubernetes Monitoring Workbook

Here is a comprehensive workbook for AKS monitoring:

```kusto
// Node resource utilization
let nodeCpu = KubeNodeInventory
| where TimeGenerated {TimeRange}
| where ClusterName == '{Cluster}'
| distinct Computer, ClusterName
| join kind=inner (
    Perf
    | where TimeGenerated {TimeRange}
    | where ObjectName == "K8SNode"
    | where CounterName == "cpuCapacityNanoCores"
    | summarize CpuCapacity = max(CounterValue) by Computer
) on Computer
| join kind=inner (
    Perf
    | where TimeGenerated {TimeRange}
    | where ObjectName == "K8SNode"
    | where CounterName == "cpuUsageNanoCores"
    | summarize CpuUsed = avg(CounterValue) by Computer
) on Computer
| project Node = Computer, CpuCapacity, CpuUsed,
    CpuUtilization = round(100.0 * CpuUsed / CpuCapacity, 2);

// Pod status summary
KubePodInventory
| where TimeGenerated {TimeRange}
| where ClusterName == '{Cluster}'
| summarize arg_max(TimeGenerated, *) by Name, Namespace
| summarize
    Running = countif(PodStatus == "Running"),
    Pending = countif(PodStatus == "Pending"),
    Failed = countif(PodStatus == "Failed"),
    Succeeded = countif(PodStatus == "Succeeded")
| project Running, Pending, Failed, Succeeded,
    Total = Running + Pending + Failed + Succeeded
```

### Container Restart Analysis

```kusto
// Containers with frequent restarts
ContainerInventory
| where TimeGenerated {TimeRange}
| where ClusterName == '{Cluster}'
| where RestartCount > 0
| summarize
    MaxRestarts = max(RestartCount),
    AvgRestarts = avg(RestartCount),
    LastSeen = max(TimeGenerated)
    by ContainerHostname, Name, Image
| where MaxRestarts > 3
| project
    Pod = ContainerHostname,
    Container = Name,
    Image,
    MaxRestarts,
    LastSeen
| order by MaxRestarts desc
```

## Conditional Formatting

Apply visual indicators based on thresholds:

```json
{
  "type": 3,
  "content": {
    "version": "KqlItem/1.0",
    "query": "// Your query here",
    "visualization": "table",
    "gridSettings": {
      "formatters": [
        {
          "columnMatch": "SuccessRate",
          "formatter": 18,
          "formatOptions": {
            "thresholdsOptions": "icons",
            "thresholdsGrid": [
              {"operator": ">=", "thresholdValue": "99", "representation": "success"},
              {"operator": ">=", "thresholdValue": "95", "representation": "warning"},
              {"operator": "Default", "representation": "critical"}
            ]
          }
        },
        {
          "columnMatch": "Latency",
          "formatter": 8,
          "formatOptions": {
            "palette": "greenRed",
            "min": 0,
            "max": 1000
          }
        }
      ]
    }
  }
}
```

## Cross-Resource Queries

Query multiple resources in a single workbook:

```kusto
// Cross-workspace query
union
(workspace('workspace-prod-east').AppRequests | extend Region = 'East'),
(workspace('workspace-prod-west').AppRequests | extend Region = 'West')
| where TimeGenerated {TimeRange}
| summarize
    Requests = count(),
    AvgDuration = avg(DurationMs)
    by Region, bin(TimeGenerated, 5m)
| render timechart
```

## ARM Template for Workbook Deployment

Deploy workbooks as infrastructure:

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "workbookName": {
      "type": "string",
      "defaultValue": "Application Health Dashboard"
    },
    "workbookId": {
      "type": "string",
      "defaultValue": "[newGuid()]"
    },
    "workspaceId": {
      "type": "string"
    }
  },
  "resources": [
    {
      "type": "Microsoft.Insights/workbooks",
      "apiVersion": "2021-08-01",
      "name": "[parameters('workbookId')]",
      "location": "[resourceGroup().location]",
      "kind": "shared",
      "properties": {
        "displayName": "[parameters('workbookName')]",
        "serializedData": "{\"version\":\"Notebook/1.0\",\"items\":[...]}",
        "category": "workbook",
        "sourceId": "[parameters('workspaceId')]"
      }
    }
  ]
}
```

## Workbook Links and Navigation

Create drill-down experiences with links:

```json
{
  "type": 3,
  "content": {
    "query": "// Your query",
    "gridSettings": {
      "linkColumnSettings": [
        {
          "columnMatch": "PodName",
          "linkTarget": "workbook",
          "linkDetails": {
            "workbookId": "/subscriptions/.../workbooks/pod-details",
            "linkParameters": [
              {
                "parameterName": "PodName",
                "columnMatch": "PodName",
                "linkType": "column"
              }
            ]
          }
        }
      ]
    }
  }
}
```

## Best Practices

1. **Use Parameters Effectively**: Allow users to filter without editing queries
2. **Progressive Disclosure**: Start with summary views, link to details
3. **Consistent Time Ranges**: Use a global time parameter across all queries
4. **Performance**: Limit query scope and use summarize early
5. **Documentation**: Include text blocks explaining metrics and thresholds
6. **Version Control**: Export workbooks as JSON and store in Git

Azure Monitor Workbooks bridge the gap between static dashboards and full analytics platforms. They provide the interactivity needed for troubleshooting while being shareable and maintainable as code.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
