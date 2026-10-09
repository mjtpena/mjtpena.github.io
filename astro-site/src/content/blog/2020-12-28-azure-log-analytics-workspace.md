---
title: "Azure Log Analytics: Central Logging Platform"
description: "Log Analytics is the database I've spent the most hours in this year that nobody calls a database. It's where every Azure diagnostic, AppInsights trace…"
author: Michael John Peña
draft: false
date: 2020-12-28
tags:
  - Azure
  - Log Analytics
  - Monitoring
  - Observability
---

Log Analytics is the database I've spent the most hours in this year that nobody calls a database. It's where every Azure diagnostic, AppInsights trace, Sentinel event, and custom log eventually lives, queryable in KQL. Two pieces of advice from experience: set the retention deliberately (the per-GB pricing is usually fine, the long retention isn't), and learn enough KQL to write a `summarize ... by bin(TimeGenerated, 5m)` without thinking. That single query template has paid for itself a thousand times over.

## Create Workspace

```bash
az monitor log-analytics workspace create \
    --workspace-name my-workspace \
    --resource-group myRG \
    --location eastus \
    --retention-time 90
```

## Data Sources

| Source | Method |
|--------|--------|
| Azure Resources | Diagnostic settings |
| VMs | Log Analytics agent |
| Containers | Container Insights |
| Applications | Application Insights |
| Custom | Data Collector API |

## Enable Diagnostics

```bash
# Enable VM diagnostics
az monitor diagnostic-settings create \
    --name vm-diagnostics \
    --resource /subscriptions/.../virtualMachines/myVM \
    --logs '[{"category":"VMPerfCounters","enabled":true}]' \
    --metrics '[{"category":"AllMetrics","enabled":true}]' \
    --workspace /subscriptions/.../workspaces/my-workspace
```

## KQL Queries

### Basic Queries

```kusto
// Search across all tables
search "error"
| take 100

// Query specific table
Heartbeat
| where TimeGenerated > ago(1h)
| summarize count() by Computer
```

### Performance Analysis

```kusto
// CPU usage by VM
Perf
| where ObjectName == "Processor" and CounterName == "% Processor Time"
| where InstanceName == "_Total"
| summarize AvgCPU = avg(CounterValue), MaxCPU = max(CounterValue) by Computer, bin(TimeGenerated, 5m)
| render timechart

// Memory usage
Perf
| where ObjectName == "Memory" and CounterName == "% Used Memory"
| summarize AvgMemory = avg(CounterValue) by Computer, bin(TimeGenerated, 5m)
| render timechart
```

### Security Analysis

```kusto
// Failed sign-ins
SigninLogs
| where ResultType != 0
| summarize FailedAttempts = count() by UserPrincipalName, IPAddress
| where FailedAttempts > 5
| order by FailedAttempts desc

// Unusual sign-in locations
SigninLogs
| where ResultType == 0
| summarize Locations = dcount(Location) by UserPrincipalName
| where Locations > 3
```

### Application Logs

```kusto
// Exceptions by type
exceptions
| summarize count() by type
| order by count_ desc

// Slow requests
requests
| where duration > 1000
| project timestamp, name, duration, resultCode
| order by duration desc
```

## Saved Queries

```bash
# Save query as function
az monitor log-analytics workspace saved-search create \
    --workspace-name my-workspace \
    --resource-group myRG \
    --name HighCPU \
    --category "Performance" \
    --display-name "High CPU VMs" \
    --query "Perf | where ObjectName == 'Processor' | where CounterValue > 90"
```

## Alerts

```bash
# Create log alert
az monitor scheduled-query create \
    --name high-cpu-alert \
    --resource-group myRG \
    --scopes /subscriptions/.../workspaces/my-workspace \
    --condition "count > 5" \
    --condition-query "Perf | where CounterName == '% Processor Time' | where CounterValue > 90" \
    --action-groups /subscriptions/.../actionGroups/ops-team \
    --evaluation-frequency 5m \
    --window-size 15m \
    --severity 2
```

## Data Collection Rules

```bash
az monitor data-collection rule create \
    --name my-dcr \
    --resource-group myRG \
    --location eastus \
    --data-flows '[{
        "streams": ["Microsoft-Perf"],
        "destinations": ["my-workspace"]
    }]' \
    --data-sources '{
        "performanceCounters": [{
            "name": "perfCounters",
            "streams": ["Microsoft-Perf"],
            "samplingFrequencyInSeconds": 60,
            "counterSpecifiers": [
                "\\Processor(_Total)\\% Processor Time",
                "\\Memory\\Available Bytes"
            ]
        }]
    }'
```

## Export Data

```bash
# Export to storage
az monitor log-analytics workspace data-export create \
    --workspace-name my-workspace \
    --resource-group myRG \
    --name export-to-storage \
    --destination /subscriptions/.../storageAccounts/mystorageaccount \
    --table-names Heartbeat Perf
```

Log Analytics: insights from all your data.
