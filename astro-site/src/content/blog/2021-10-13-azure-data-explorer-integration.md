---
title: "Azure Data Explorer Integration for Advanced Analytics"
author: "Michael John Peña"
draft: false
date: 2021-10-13
tags: ["Azure", "Azure Data Explorer", "ADX", "Analytics", "Big Data"]

---

I wrote "Azure Data Explorer Integration for Advanced Analytics" to share practical, production-minded guidance on this topic.

Azure Data Explorer is the analytics service that addresses a specific limitation of Log Analytics: KQL query performance on large historical datasets degrades when Log Analytics tables accumulate months or years of high-cardinality telemetry. ADX is purpose-built for time-series analytics on large, append-heavy datasets—the columnar storage and query engine handle billions of rows efficiently. For AKS monitoring, the pattern is exporting Log Analytics data to ADX for long-term retention and complex analytics: trend analysis over 12 months of cluster metrics, anomaly detection on multi-dimensional time series, and joining cluster telemetry with business metrics. ADX clusters are priced on cluster compute rather than ingestion volume, which changes the economics at scale—a cluster handling 50GB/day of telemetry can be more cost-effective in ADX than Log Analytics at high retention settings.

## Why Azure Data Explorer?

ADX excels at:
- **Time-series data** - Optimized for logs and telemetry
- **High-volume ingestion** - Millions of events per second
- **Fast queries** - Sub-second responses on petabytes
- **Long-term retention** - Cost-effective storage for years of data
- **Advanced analytics** - ML, anomaly detection, forecasting

## Creating an ADX Cluster

```bash
# Create resource group
az group create --name adx-rg --location eastus

# Create ADX cluster
az kusto cluster create \
    --name myadxcluster \
    --resource-group adx-rg \
    --location eastus \
    --sku name="Standard_D13_v2" tier="Standard" \
    --capacity 2

# Create database
az kusto database create \
    --cluster-name myadxcluster \
    --resource-group adx-rg \
    --database-name monitoring \
    --read-write-database soft-delete-period=P365D hot-cache-period=P31D
```

## Ingesting Data from Log Analytics

### Using Data Export

```bash
# Create data export rule from Log Analytics to Event Hub
az monitor log-analytics workspace data-export create \
    --resource-group monitoring-rg \
    --workspace-name aks-logs \
    --name export-to-eventhub \
    --destination /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.EventHub/namespaces/{ns}/eventhubs/{hub} \
    --tables ContainerLog Perf KubePodInventory
```

### Creating ADX Tables

```kusto
// Create table for container logs
.create table ContainerLogs (
    TimeGenerated: datetime,
    Computer: string,
    ContainerID: string,
    LogEntry: string,
    LogEntrySource: string,
    Namespace: string,
    PodName: string
)

// Create table for performance metrics
.create table PerfMetrics (
    TimeGenerated: datetime,
    Computer: string,
    ObjectName: string,
    CounterName: string,
    InstanceName: string,
    CounterValue: real
)
```

### Setting Up Event Hub Ingestion

```kusto
// Create ingestion mapping
.create table ContainerLogs ingestion json mapping 'ContainerLogsMapping'
'[{"column":"TimeGenerated","path":"$.TimeGenerated"},{"column":"Computer","path":"$.Computer"},{"column":"ContainerID","path":"$.ContainerID"},{"column":"LogEntry","path":"$.LogEntry"},{"column":"LogEntrySource","path":"$.LogEntrySource"},{"column":"Namespace","path":"$.Namespace"},{"column":"PodName","path":"$.PodName"}]'

// Create data connection
.add database monitoring dataconnection EventHub (
    "eventHubResourceId": "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.EventHub/namespaces/{ns}/eventhubs/{hub}",
    "consumerGroup": "$Default",
    "tableName": "ContainerLogs",
    "mappingRuleName": "ContainerLogsMapping",
    "dataFormat": "json"
)
```

## Querying ADX from Log Analytics

Query ADX directly from Log Analytics workspace:

```kusto
// Use adx() function to query ADX
let adxData = adx("https://myadxcluster.eastus.kusto.windows.net/monitoring").ContainerLogs
| where TimeGenerated > ago(7d)
| summarize count() by bin(TimeGenerated, 1h);

// Combine with Log Analytics data
let laData = ContainerLog
| where TimeGenerated > ago(1d)
| summarize count() by bin(TimeGenerated, 1h);

union adxData, laData
| render timechart
```

## Advanced ADX Analytics

### Time Series Analysis

```kusto
// Detect anomalies in container CPU usage
PerfMetrics
| where CounterName == "cpuUsageNanoCores"
| summarize AvgCPU = avg(CounterValue) by bin(TimeGenerated, 5m), InstanceName
| make-series CPUSeries = avg(AvgCPU) on TimeGenerated from ago(7d) to now() step 5m by InstanceName
| extend anomalies = series_decompose_anomalies(CPUSeries)
| mv-expand TimeGenerated, CPUSeries, anomalies
| where anomalies == 1
```

### Forecasting

```kusto
// Forecast CPU usage
PerfMetrics
| where CounterName == "cpuUsageNanoCores"
| summarize AvgCPU = avg(CounterValue) by bin(TimeGenerated, 1h)
| make-series CPUSeries = avg(AvgCPU) on TimeGenerated from ago(30d) to now() step 1h
| extend forecast = series_decompose_forecast(CPUSeries, 24)  // Forecast 24 hours ahead
| render timechart
```

### Pattern Detection

```kusto
// Find common error patterns
ContainerLogs
| where LogEntry contains "error"
| extend ErrorType = extract("([A-Z][a-z]+Error|[A-Z][a-z]+Exception)", 1, LogEntry)
| summarize Count = count() by ErrorType
| top 10 by Count
```

## Optimizing ADX Performance

### Partitioning

```kusto
// Create table with partitioning
.alter table ContainerLogs policy partitioning ```
{
  "PartitionKeys": [
    {
      "ColumnName": "TimeGenerated",
      "Kind": "UniformRange",
      "Properties": {
        "Reference": "1970-01-01T00:00:00",
        "RangeSize": "1.00:00:00"
      }
    }
  ]
}```
```

### Caching Policy

```kusto
// Set hot cache period
.alter table ContainerLogs policy caching hot = 31d

// Set per-table retention
.alter table ContainerLogs policy retention ```
{
  "SoftDeletePeriod": "365.00:00:00",
  "Recoverability": "Enabled"
}```
```

### Indexing

```kusto
// Create materialized view for common queries
.create materialized-view ErrorSummary on table ContainerLogs
{
    ContainerLogs
    | where LogEntry contains "error"
    | summarize ErrorCount = count() by bin(TimeGenerated, 1h), Namespace, PodName
}
```

## Terraform Configuration

```hcl
resource "azurerm_kusto_cluster" "adx" {
  name                = "myadxcluster"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  sku {
    name     = "Standard_D13_v2"
    capacity = 2
  }

  tags = {
    Environment = "Production"
  }
}

resource "azurerm_kusto_database" "monitoring" {
  name                = "monitoring"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  cluster_name        = azurerm_kusto_cluster.adx.name

  hot_cache_period   = "P31D"
  soft_delete_period = "P365D"
}

resource "azurerm_kusto_eventhub_data_connection" "logs" {
  name                = "log-ingestion"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  cluster_name        = azurerm_kusto_cluster.adx.name
  database_name       = azurerm_kusto_database.monitoring.name

  eventhub_id    = azurerm_eventhub.logs.id
  consumer_group = azurerm_eventhub_consumer_group.adx.name

  table_name        = "ContainerLogs"
  mapping_rule_name = "ContainerLogsMapping"
  data_format       = "JSON"
}
```

## Use Cases

1. **Long-term trend analysis** - Analyze months of data efficiently
2. **Capacity planning** - Forecast resource needs
3. **Incident investigation** - Fast queries during outages
4. **Compliance reporting** - Retain data for audit requirements
5. **ML model training** - Use historical data for predictions

## Conclusion

Azure Data Explorer extends your monitoring capabilities with powerful analytics on large datasets. By integrating ADX with your Kubernetes monitoring, you unlock long-term analysis and advanced insights.

Tomorrow, we'll dive into ADX continuous export for data archival and compliance.

