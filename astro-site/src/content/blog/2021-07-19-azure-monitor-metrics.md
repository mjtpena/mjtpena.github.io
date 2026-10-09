---
title: Deep Dive into Azure Monitor Metrics
author: Michael John Peña
draft: false
date: 2021-07-19
url: /blog/azure-monitor-metrics/
tags:
  - Azure
  - Monitoring
  - DevOps
  - Metrics
  - Observability
---

## Understanding Azure Monitor Metrics

Azure Monitor collects two types of metrics:

- **Platform Metrics**: Automatically collected from Azure resources
- **Custom Metrics**: Application-specific metrics you define

## Querying Metrics with Azure CLI

Query metrics directly from the command line:

```bash
# Get CPU percentage for a VM
az monitor metrics list \
    --resource /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-compute/providers/Microsoft.Compute/virtualMachines/vm-web-01 \
    --metric "Percentage CPU" \
    --interval PT5M \
    --aggregation Average Maximum \
    --start-time $(date -u -d '1 hour ago' '+%Y-%m-%dT%H:%M:%SZ') \
    --end-time $(date -u '+%Y-%m-%dT%H:%M:%SZ')

# List available metrics for a resource
az monitor metrics list-definitions \
    --resource /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-storage/providers/Microsoft.Storage/storageAccounts/mystorageaccount \
    --output table

# Get multiple metrics
az monitor metrics list \
    --resource /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-sql/providers/Microsoft.Sql/servers/sqlserver/databases/mydb \
    --metrics "cpu_percent" "storage_percent" "dtu_consumption_percent" \
    --interval PT1H \
    --aggregation Average
```

## Python SDK for Metrics

Query and analyze metrics programmatically:

```python
from azure.identity import DefaultAzureCredential
from azure.mgmt.monitor import MonitorManagementClient
from datetime import datetime, timedelta
import pandas as pd

credential = DefaultAzureCredential()
monitor_client = MonitorManagementClient(credential, subscription_id)

def get_resource_metrics(resource_id, metric_names, timespan_hours=24, interval="PT1H"):
    """Get metrics for an Azure resource."""

    end_time = datetime.utcnow()
    start_time = end_time - timedelta(hours=timespan_hours)
    timespan = f"{start_time.isoformat()}Z/{end_time.isoformat()}Z"

    metrics = monitor_client.metrics.list(
        resource_uri=resource_id,
        metricnames=",".join(metric_names),
        timespan=timespan,
        interval=interval,
        aggregation="Average,Maximum,Minimum,Total"
    )

    results = []
    for metric in metrics.value:
        for timeseries in metric.timeseries:
            for data in timeseries.data:
                results.append({
                    "metric": metric.name.value,
                    "timestamp": data.time_stamp,
                    "average": data.average,
                    "maximum": data.maximum,
                    "minimum": data.minimum,
                    "total": data.total
                })

    return pd.DataFrame(results)

# Get VM metrics
vm_resource_id = f"/subscriptions/{subscription_id}/resourceGroups/rg-compute/providers/Microsoft.Compute/virtualMachines/vm-web-01"
vm_metrics = get_resource_metrics(
    vm_resource_id,
    ["Percentage CPU", "Network In Total", "Network Out Total", "Disk Read Bytes", "Disk Write Bytes"],
    timespan_hours=24,
    interval="PT5M"
)

print(vm_metrics.head())

# Calculate statistics
cpu_stats = vm_metrics[vm_metrics["metric"] == "Percentage CPU"]["average"].describe()
print(f"\nCPU Statistics:\n{cpu_stats}")
```

## Multi-Resource Metric Queries

Query metrics across multiple resources:

```python
def get_metrics_for_resource_type(resource_group, resource_type, metric_name):
    """Get a specific metric for all resources of a type."""

    from azure.mgmt.resource import ResourceManagementClient

    resource_client = ResourceManagementClient(credential, subscription_id)

    # List all resources of the specified type
    resources = resource_client.resources.list_by_resource_group(
        resource_group,
        filter=f"resourceType eq '{resource_type}'"
    )

    all_metrics = []

    for resource in resources:
        try:
            metrics_df = get_resource_metrics(
                resource.id,
                [metric_name],
                timespan_hours=1,
                interval="PT5M"
            )
            metrics_df["resource_name"] = resource.name
            all_metrics.append(metrics_df)
        except Exception as e:
            print(f"Error getting metrics for {resource.name}: {e}")

    if all_metrics:
        return pd.concat(all_metrics, ignore_index=True)
    return pd.DataFrame()

# Get CPU metrics for all VMs in a resource group
vm_cpu_metrics = get_metrics_for_resource_type(
    "rg-compute",
    "Microsoft.Compute/virtualMachines",
    "Percentage CPU"
)

# Find VMs with high CPU
high_cpu_vms = vm_cpu_metrics.groupby("resource_name")["average"].max()
print("VMs with highest CPU:")
print(high_cpu_vms.sort_values(ascending=False).head(10))
```

## Metric Dimensions

Work with dimensional metrics for detailed analysis:

```python
def get_metrics_with_dimensions(resource_id, metric_name, dimension_name):
    """Get metrics split by a specific dimension."""

    end_time = datetime.utcnow()
    start_time = end_time - timedelta(hours=24)

    metrics = monitor_client.metrics.list(
        resource_uri=resource_id,
        metricnames=metric_name,
        timespan=f"{start_time.isoformat()}Z/{end_time.isoformat()}Z",
        interval="PT1H",
        aggregation="Average",
        filter=f"{dimension_name} eq '*'"  # Get all dimension values
    )

    results = []
    for metric in metrics.value:
        for timeseries in metric.timeseries:
            # Get dimension value from metadata
            dimension_value = None
            if timeseries.metadatavalues:
                for md in timeseries.metadatavalues:
                    if md.name.value == dimension_name:
                        dimension_value = md.value

            for data in timeseries.data:
                results.append({
                    "timestamp": data.time_stamp,
                    "dimension": dimension_value,
                    "value": data.average
                })

    return pd.DataFrame(results)

# Example: Storage transactions by API name
storage_id = f"/subscriptions/{subscription_id}/resourceGroups/rg-storage/providers/Microsoft.Storage/storageAccounts/mystorageaccount/blobServices/default"
transactions = get_metrics_with_dimensions(storage_id, "Transactions", "ApiName")

# Pivot to see transactions by API
pivot_table = transactions.pivot_table(
    values="value",
    index="timestamp",
    columns="dimension",
    aggfunc="sum"
)
print(pivot_table.tail())
```

## Creating Metric Alerts

Set up alerts based on metric thresholds:

```python
from azure.mgmt.monitor.models import (
    MetricAlertResource,
    MetricAlertSingleResourceMultipleMetricCriteria,
    MetricCriteria,
    MetricAlertAction
)

def create_metric_alert(name, resource_id, metric_name, operator, threshold, severity=2):
    """Create a metric alert rule."""

    alert = monitor_client.metric_alerts.create_or_update(
        resource_group_name="rg-monitoring",
        rule_name=name,
        parameters={
            "location": "global",
            "description": f"Alert when {metric_name} {operator} {threshold}",
            "severity": severity,
            "enabled": True,
            "scopes": [resource_id],
            "evaluation_frequency": "PT5M",
            "window_size": "PT15M",
            "criteria": {
                "odata.type": "Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria",
                "allOf": [{
                    "name": "criterion1",
                    "metricName": metric_name,
                    "operator": operator,
                    "threshold": threshold,
                    "timeAggregation": "Average"
                }]
            },
            "actions": [{
                "actionGroupId": f"/subscriptions/{subscription_id}/resourceGroups/rg-monitoring/providers/Microsoft.Insights/actionGroups/ops-team"
            }]
        }
    )

    return alert

# Create CPU alert
create_metric_alert(
    name="vm-high-cpu-alert",
    resource_id=vm_resource_id,
    metric_name="Percentage CPU",
    operator="GreaterThan",
    threshold=80,
    severity=2
)

# Create memory alert (requires VM extension)
create_metric_alert(
    name="vm-low-memory-alert",
    resource_id=vm_resource_id,
    metric_name="Available Memory Bytes",
    operator="LessThan",
    threshold=1073741824,  # 1 GB
    severity=1
)

print("Alerts created successfully")
```

## Dynamic Thresholds

Use machine learning-based dynamic thresholds:

```python
def create_dynamic_threshold_alert(name, resource_id, metric_name, sensitivity="Medium"):
    """Create an alert with dynamic thresholds."""

    alert = monitor_client.metric_alerts.create_or_update(
        resource_group_name="rg-monitoring",
        rule_name=name,
        parameters={
            "location": "global",
            "description": f"Dynamic threshold alert for {metric_name}",
            "severity": 2,
            "enabled": True,
            "scopes": [resource_id],
            "evaluation_frequency": "PT5M",
            "window_size": "PT15M",
            "criteria": {
                "odata.type": "Microsoft.Azure.Monitor.MultipleResourceMultipleMetricCriteria",
                "allOf": [{
                    "criterionType": "DynamicThresholdCriterion",
                    "name": "dynamic_criterion",
                    "metricName": metric_name,
                    "operator": "GreaterOrLessThan",
                    "alertSensitivity": sensitivity,  # Low, Medium, High
                    "failingPeriods": {
                        "numberOfEvaluationPeriods": 4,
                        "minFailingPeriodsToAlert": 3
                    },
                    "timeAggregation": "Average"
                }]
            },
            "actions": [{
                "actionGroupId": f"/subscriptions/{subscription_id}/resourceGroups/rg-monitoring/providers/Microsoft.Insights/actionGroups/ops-team"
            }]
        }
    )

    return alert

# Create dynamic threshold alert for response time
create_dynamic_threshold_alert(
    name="api-response-time-anomaly",
    resource_id=f"/subscriptions/{subscription_id}/resourceGroups/rg-app/providers/Microsoft.Web/sites/myapi",
    metric_name="HttpResponseTime",
    sensitivity="Medium"
)
```

## Exporting Metrics to Storage

Export metrics for long-term retention:

```python
def export_metrics_to_blob(resource_id, metric_names, start_time, end_time, container_name="metrics"):
    """Export metrics to blob storage for long-term retention."""

    from azure.storage.blob import BlobServiceClient
    import json

    # Get metrics
    metrics_df = get_resource_metrics(
        resource_id,
        metric_names,
        timespan_hours=int((end_time - start_time).total_seconds() / 3600),
        interval="PT1H"
    )

    # Convert to JSON
    metrics_json = metrics_df.to_json(orient="records", date_format="iso")

    # Upload to blob storage
    blob_service = BlobServiceClient.from_connection_string(storage_connection_string)
    container_client = blob_service.get_container_client(container_name)

    resource_name = resource_id.split("/")[-1]
    blob_name = f"{resource_name}/{start_time.strftime('%Y/%m/%d')}/metrics.json"

    container_client.upload_blob(
        name=blob_name,
        data=metrics_json,
        overwrite=True
    )

    print(f"Exported metrics to {blob_name}")

# Export last 7 days of metrics
export_metrics_to_blob(
    vm_resource_id,
    ["Percentage CPU", "Network In Total", "Network Out Total"],
    datetime.utcnow() - timedelta(days=7),
    datetime.utcnow()
)
```

## Metrics Dashboard

Create a comprehensive metrics dashboard:

```json
{
    "lenses": {
        "0": {
            "order": 0,
            "parts": {
                "0": {
                    "position": {"x": 0, "y": 0, "colSpan": 6, "rowSpan": 4},
                    "metadata": {
                        "type": "Extension/HubsExtension/PartType/MonitorChartPart",
                        "settings": {
                            "content": {
                                "options": {
                                    "chart": {
                                        "metrics": [{
                                            "resourceMetadata": {"id": "${vm_resource_id}"},
                                            "name": "Percentage CPU",
                                            "aggregationType": 4,
                                            "namespace": "microsoft.compute/virtualmachines"
                                        }],
                                        "title": "VM CPU Usage",
                                        "visualization": {"chartType": 2}
                                    }
                                }
                            }
                        }
                    }
                },
                "1": {
                    "position": {"x": 6, "y": 0, "colSpan": 6, "rowSpan": 4},
                    "metadata": {
                        "type": "Extension/HubsExtension/PartType/MonitorChartPart",
                        "settings": {
                            "content": {
                                "options": {
                                    "chart": {
                                        "metrics": [{
                                            "resourceMetadata": {"id": "${sql_resource_id}"},
                                            "name": "dtu_consumption_percent",
                                            "aggregationType": 4
                                        }],
                                        "title": "SQL DTU Usage",
                                        "visualization": {"chartType": 2}
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
```

## Conclusion

Azure Monitor Metrics provides comprehensive observability for your Azure resources. From automatic platform metrics to custom application metrics, you have the tools needed to understand system behavior and detect issues before they impact users.

Key practices include using dimensional queries for detailed analysis, setting up both static and dynamic threshold alerts, and exporting metrics for long-term trend analysis. Combined with Log Analytics and Application Insights, metrics form the foundation of a complete monitoring strategy.
