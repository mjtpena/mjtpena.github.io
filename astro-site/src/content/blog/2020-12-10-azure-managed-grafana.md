---
title: "Azure Monitor Workbooks: Custom Visualizations"
author: Michael John Peña
draft: false
date: 2020-12-10
tags:
  - Azure
  - Monitoring
  - Workbooks
  - Visualization
---

Every dashboard request that hit my inbox in 2019 had the same wishlist: parameters at the top, charts that talk to each other, KQL on the inside, and shareable with a URL. Workbooks deliver all of that without spinning up Power BI. They're the most under-promoted feature of Azure Monitor—turn an ad-hoc KQL exploration into a parameterised, shareable report in an hour, ship it, and forget you built it.

## Workbook Components

- **Text**: Markdown documentation
- **Query**: KQL, metrics, ARG
- **Parameters**: Interactive filters
- **Charts**: Line, bar, pie, scatter
- **Grids**: Tabular data
- **Tiles**: Single values
- **Maps**: Geographic visualization

## Creating a Workbook

```json
{
    "version": "Notebook/1.0",
    "items": [
        {
            "type": 1,
            "content": {
                "json": "# Infrastructure Dashboard\nMonitor your Azure resources"
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
                        "value": { "durationMs": 3600000 }
                    },
                    {
                        "name": "Subscription",
                        "type": 6,
                        "multiSelect": true
                    }
                ]
            }
        }
    ]
}
```

## KQL Query Step

```kusto
// VM Performance
Perf
| where TimeGenerated {TimeRange}
| where ObjectName == "Processor" and CounterName == "% Processor Time"
| summarize AvgCPU = avg(CounterValue), MaxCPU = max(CounterValue)
    by Computer, bin(TimeGenerated, 5m)
| order by TimeGenerated desc
```

## Metrics Query

```json
{
    "type": 10,
    "content": {
        "chartType": 2,
        "metrics": [
            {
                "resourceMetadata": {
                    "id": "{VirtualMachine}"
                },
                "name": "Percentage CPU",
                "aggregationType": 4,
                "namespace": "microsoft.compute/virtualmachines"
            }
        ],
        "title": "VM CPU Usage",
        "timeContext": { "durationMs": 3600000 }
    }
}
```

## Azure Resource Graph

```kusto
// Find all VMs and their sizes
resources
| where type == "microsoft.compute/virtualmachines"
| project name, resourceGroup, location,
    size = properties.hardwareProfile.vmSize,
    os = properties.storageProfile.osDisk.osType
| order by name
```

## Conditional Formatting

```json
{
    "type": 3,
    "content": {
        "query": "...",
        "gridSettings": {
            "formatters": [
                {
                    "columnMatch": "CPU",
                    "formatter": 8,
                    "formatOptions": {
                        "palette": "redGreen",
                        "min": 0,
                        "max": 100
                    }
                },
                {
                    "columnMatch": "Status",
                    "formatter": 18,
                    "formatOptions": {
                        "thresholdsOptions": "icons",
                        "thresholdsGrid": [
                            { "operator": "==", "thresholdValue": "Healthy", "representation": "success" },
                            { "operator": "==", "thresholdValue": "Warning", "representation": "warning" },
                            { "operator": "Default", "representation": "error" }
                        ]
                    }
                }
            ]
        }
    }
}
```

## Links and Actions

```json
{
    "type": 3,
    "content": {
        "query": "...",
        "gridSettings": {
            "linkColumn": "ResourceId",
            "linkTarget": "Resource",
            "linkLabel": "View Resource"
        }
    }
}
```

## Tabs and Groups

```json
{
    "type": 11,
    "content": {
        "version": "LinkItem/1.0",
        "style": "tabs",
        "links": [
            { "cellValue": "Overview", "linkTarget": "step" },
            { "cellValue": "Compute", "linkTarget": "step" },
            { "cellValue": "Storage", "linkTarget": "step" },
            { "cellValue": "Network", "linkTarget": "step" }
        ]
    }
}
```

## Export and Share

```bash
# Export workbook as ARM template
az monitor workbook show \
    --resource-group myRG \
    --name my-workbook \
    --output json > workbook-template.json

# Deploy workbook
az deployment group create \
    --resource-group myRG \
    --template-file workbook-template.json
```

## Gallery Templates

Pre-built workbooks:
- VM Insights
- Container Insights
- Application Insights
- Network Insights
- Storage Insights

Workbooks: storytelling with your monitoring data.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
