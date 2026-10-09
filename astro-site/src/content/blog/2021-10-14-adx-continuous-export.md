---
title: "ADX Continuous Export for Data Archival and Compliance"
description: "ADX Continuous Export is the managed pipeline that continuously moves data from ADX tables to Azure Blob Storage or ADLS Gen2—useful for archiving cold data…"
author: "Michael John Peña"
draft: false
date: 2021-10-14
tags: ["Azure", "Azure Data Explorer", "ADX", "Data Archival", "Compliance"]
---

ADX Continuous Export is the managed pipeline that continuously moves data from ADX tables to Azure Blob Storage or ADLS Gen2—useful for archiving cold data beyond the ADX cluster's hot cache window, feeding a data lake with ADX-processed telemetry, or exporting data for compliance record-keeping without running scheduled export jobs manually. The continuous export job queries the ADX table on a schedule, writing incremental results to external storage in Parquet, CSV, or JSON format. The `over()` cursor tracks which data has been exported, preventing duplicates without requiring watermark logic in the export query. For monitoring pipelines that need to archive raw telemetry beyond ADX's cost-effective retention window while keeping recent data in ADX for fast queries, continuous export is the bridge between hot analytics and cold archival storage.

## Understanding Continuous Export

Continuous export:
- Runs periodically on newly ingested data
- Exports to Azure Blob Storage or Azure Data Lake
- Supports various formats (Parquet, CSV, JSON)
- Enables cost-effective cold storage

## Setting Up External Storage

### Create Storage Account

```bash
# Create storage account for exports
az storage account create \
    --name adxarchive \
    --resource-group adx-rg \
    --location eastus \
    --sku Standard_LRS \
    --kind StorageV2 \
    --enable-hierarchical-namespace true

# Create container for exports
az storage container create \
    --name monitoring-archive \
    --account-name adxarchive
```

### Grant ADX Access

```bash
# Get ADX cluster principal ID
ADX_PRINCIPAL=$(az kusto cluster show \
    --name myadxcluster \
    --resource-group adx-rg \
    --query identity.principalId -o tsv)

# Grant Storage Blob Data Contributor role
az role assignment create \
    --role "Storage Blob Data Contributor" \
    --assignee $ADX_PRINCIPAL \
    --scope /subscriptions/{sub}/resourceGroups/adx-rg/providers/Microsoft.Storage/storageAccounts/adxarchive
```

## Creating External Tables

```kusto
// Create external table pointing to storage
.create external table ArchivedContainerLogs (
    TimeGenerated: datetime,
    Computer: string,
    ContainerID: string,
    LogEntry: string,
    LogEntrySource: string,
    Namespace: string,
    PodName: string
)
kind=storage
partition by (Year: datetime = bin(TimeGenerated, 365d))
pathformat = ("year=" Year)
dataformat=parquet
(
    h@'https://adxarchive.blob.core.windows.net/monitoring-archive;impersonate'
)
```

## Configuring Continuous Export

### Basic Export Configuration

```kusto
// Create continuous export job
.create-or-alter continuous-export ContainerLogsExport
over (ContainerLogs)
to table ArchivedContainerLogs
with (
    intervalBetweenRuns=1h,
    forcedLatency=10m,
    sizeLimit=104857600  // 100MB per file
)
<|
ContainerLogs
| project TimeGenerated, Computer, ContainerID, LogEntry, LogEntrySource, Namespace, PodName
```

### Export with Aggregation

```kusto
// Export aggregated data for efficient storage
.create-or-alter continuous-export HourlyMetricsExport
over (PerfMetrics)
to table ArchivedMetrics
with (
    intervalBetweenRuns=1h,
    forcedLatency=5m
)
<|
PerfMetrics
| summarize
    AvgValue = avg(CounterValue),
    MinValue = min(CounterValue),
    MaxValue = max(CounterValue),
    SampleCount = count()
    by bin(TimeGenerated, 1h), Computer, ObjectName, CounterName, InstanceName
```

## Managing Exports

### Check Export Status

```kusto
// View all continuous exports
.show continuous-exports

// Show specific export details
.show continuous-export ContainerLogsExport

// View export failures
.show continuous-export ContainerLogsExport failures
```

### Monitor Export Progress

```kusto
// Check export cursor
.show continuous-export ContainerLogsExport exported-artifacts
| top 10 by Timestamp desc
```

### Pause and Resume

```kusto
// Disable export
.disable continuous-export ContainerLogsExport

// Enable export
.enable continuous-export ContainerLogsExport
```

## Querying Archived Data

### Direct External Table Query

```kusto
// Query archived data
external_table('ArchivedContainerLogs')
| where TimeGenerated between (datetime(2021-01-01) .. datetime(2021-06-30))
| where LogEntry contains "error"
| summarize count() by bin(TimeGenerated, 1d), Namespace
```

### Union Hot and Cold Data

```kusto
// Combine current and archived data
let hotData = ContainerLogs | where TimeGenerated > ago(30d);
let coldData = external_table('ArchivedContainerLogs') | where TimeGenerated <= ago(30d);

union hotData, coldData
| where LogEntry contains "critical"
| summarize count() by bin(TimeGenerated, 1d)
| render timechart
```

## Compliance Scenarios

### Retention Automation

```kusto
// Policy: Delete hot data older than 30 days
.alter table ContainerLogs policy retention ```
{
  "SoftDeletePeriod": "30.00:00:00",
  "Recoverability": "Disabled"
}```

// Archived data lives in storage with its own retention policy
```

### Audit Trail Export

```kusto
// Export audit-relevant events
.create-or-alter continuous-export AuditExport
over (ContainerLogs)
to table ArchivedAuditLogs
with (intervalBetweenRuns=15m)
<|
ContainerLogs
| where LogEntry contains "login" or LogEntry contains "access" or LogEntry contains "permission"
| project TimeGenerated, Computer, ContainerID, LogEntry, Namespace, PodName
```

## Cost Optimization

### Storage Tiering

```bash
# Set lifecycle policy for automatic tiering
az storage account management-policy create \
    --account-name adxarchive \
    --resource-group adx-rg \
    --policy '{
        "rules": [
            {
                "name": "archiveOldData",
                "type": "Lifecycle",
                "definition": {
                    "filters": {
                        "prefixMatch": ["monitoring-archive/"],
                        "blobTypes": ["blockBlob"]
                    },
                    "actions": {
                        "baseBlob": {
                            "tierToCool": {"daysAfterModificationGreaterThan": 30},
                            "tierToArchive": {"daysAfterModificationGreaterThan": 90},
                            "delete": {"daysAfterModificationGreaterThan": 365}
                        }
                    }
                }
            }
        ]
    }'
```

### Parquet Format Benefits

```kusto
// Parquet provides excellent compression
// Configure export to use Parquet
.create-or-alter continuous-export CompressedExport
over (ContainerLogs)
to table ArchivedContainerLogs
with (
    intervalBetweenRuns=1h,
    sizeLimit=524288000  // 500MB per file for better compression
)
<|
ContainerLogs
```

## Terraform Configuration

```hcl
resource "azurerm_storage_account" "archive" {
  name                     = "adxarchive"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  is_hns_enabled           = true

  blob_properties {
    delete_retention_policy {
      days = 365
    }
  }
}

resource "azurerm_storage_container" "monitoring" {
  name                  = "monitoring-archive"
  storage_account_name  = azurerm_storage_account.archive.name
  container_access_type = "private"
}

resource "azurerm_role_assignment" "adx_storage" {
  scope                = azurerm_storage_account.archive.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_kusto_cluster.adx.identity[0].principal_id
}
```

## Best Practices

1. **Choose appropriate intervals** - Balance freshness vs. efficiency
2. **Use Parquet format** - Best compression and query performance
3. **Partition by time** - Enables efficient range queries
4. **Set size limits** - Prevent too many small files
5. **Monitor export health** - Alert on failures
6. **Implement storage lifecycle** - Automate tiering and deletion

## Conclusion

Continuous export enables cost-effective long-term data retention while maintaining query capability. By combining hot ADX storage with cold blob storage, you can meet compliance requirements without breaking the budget.

Tomorrow, we'll explore Kusto functions for reusable query patterns and automation.
