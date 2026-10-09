---
title: "Copy Activity in Fabric: Data Movement Patterns"
description: "The Copy Activity in Fabric Data Factory is the same copy engine as Azure Data Factory — the underlying data movement service optimised for throughput with…"
author: Michael John Peña
draft: false
date: 2023-07-12
tags:
  - Microsoft Fabric
  - Data Factory
  - Copy Activity
  - ETL
---

The Copy Activity in Fabric Data Factory is the same copy engine as Azure Data Factory — the underlying data movement service optimised for throughput with configurable parallel copy and staging through an intermediate Blob or ADLS Gen2 location. For large data movements (tens of GB or more), the staging option is worth enabling: it writes data to a staging location first and then completes the sink write as a single operation, which is more efficient than a direct copy for many sink types. The performance tuning knobs are the same as ADF: degree of copy parallelism, data integration unit (DIU) count, and partition options for relational sources. Where I see engineers make mistakes is treating the Copy Activity as the only data movement option — for transformations happening during movement, Dataflow Gen2 or a notebook pipeline step is often more maintainable.

## Copy Activity Basics

```python
# Copy Activity structure
copy_activity = {
    "name": "CopyData",
    "type": "Copy",
    "source": {
        "type": "SourceType",
        "settings": {}
    },
    "sink": {
        "type": "SinkType",
        "settings": {}
    },
    "mapping": {
        "columns": []
    },
    "settings": {
        "parallelCopies": "auto",
        "dataIntegrationUnits": "auto"
    }
}
```

## Pattern 1: SQL to Lakehouse

```json
{
    "name": "SQLToLakehouse",
    "type": "Copy",
    "source": {
        "type": "AzureSqlSource",
        "sqlReaderQuery": "SELECT * FROM Sales.Orders WHERE OrderDate >= '@{pipeline().parameters.startDate}'",
        "queryTimeout": "00:30:00",
        "isolationLevel": "ReadCommitted"
    },
    "sink": {
        "type": "LakehouseSink",
        "tableActionOption": "Append",
        "tableOption": "Tables/orders"
    },
    "translator": {
        "type": "TabularTranslator",
        "columnMappings": [
            {"source": "OrderID", "sink": "order_id"},
            {"source": "CustomerID", "sink": "customer_id"},
            {"source": "OrderDate", "sink": "order_date"},
            {"source": "TotalAmount", "sink": "total_amount"}
        ]
    }
}
```

## Pattern 2: File to Lakehouse

```json
{
    "name": "FileToLakehouse",
    "type": "Copy",
    "source": {
        "type": "DelimitedTextSource",
        "storeSettings": {
            "type": "AzureBlobFSReadSettings",
            "recursive": true,
            "wildcardFileName": "*.csv"
        },
        "formatSettings": {
            "type": "DelimitedTextReadSettings",
            "skipLineCount": 0,
            "firstRowAsHeader": true
        }
    },
    "sink": {
        "type": "LakehouseSink",
        "tableActionOption": "Overwrite",
        "tableOption": "Tables/imported_data"
    }
}
```

## Pattern 3: Incremental Copy with Watermark

```python
# Incremental copy pattern using watermark
# Step 1: Get last watermark
watermark_lookup = {
    "name": "GetLastWatermark",
    "type": "Lookup",
    "source": {
        "query": "SELECT MAX(modified_date) as last_watermark FROM control.watermarks WHERE table_name = 'orders'"
    }
}

# Step 2: Get current max from source
current_max = {
    "name": "GetCurrentMax",
    "type": "Lookup",
    "source": {
        "query": "SELECT MAX(ModifiedDate) as current_max FROM Sales.Orders"
    }
}

# Step 3: Copy new/changed records
incremental_copy = {
    "name": "IncrementalCopy",
    "type": "Copy",
    "source": {
        "query": """
            SELECT * FROM Sales.Orders
            WHERE ModifiedDate > '@{activity('GetLastWatermark').output.firstRow.last_watermark}'
            AND ModifiedDate <= '@{activity('GetCurrentMax').output.firstRow.current_max}'
        """
    },
    "sink": {
        "type": "LakehouseSink",
        "tableActionOption": "Append"
    }
}

# Step 4: Update watermark
update_watermark = {
    "name": "UpdateWatermark",
    "type": "StoredProcedure",
    "storedProcedure": "control.usp_UpdateWatermark",
    "parameters": {
        "table_name": "orders",
        "watermark_value": "@{activity('GetCurrentMax').output.firstRow.current_max}"
    }
}
```

## Pattern 4: Full Load with Merge

```python
# Full load to staging, then merge to target
full_load_merge = [
    {
        "name": "LoadToStaging",
        "type": "Copy",
        "source": {
            "type": "AzureSqlSource",
            "sqlReaderQuery": "SELECT * FROM Sales.Orders"
        },
        "sink": {
            "type": "LakehouseSink",
            "tableActionOption": "Overwrite",
            "tableOption": "Tables/orders_staging"
        }
    },
    {
        "name": "MergeToTarget",
        "type": "TridentNotebook",
        "dependsOn": ["LoadToStaging"],
        "notebook": "merge_orders",
        "parameters": {
            "staging_table": "orders_staging",
            "target_table": "orders"
        }
    }
]

# Merge notebook code:
"""
from delta.tables import DeltaTable

staging = spark.read.table("orders_staging")
target = DeltaTable.forName(spark, "orders")

target.alias("t").merge(
    staging.alias("s"),
    "t.order_id = s.order_id"
).whenMatchedUpdateAll() \
 .whenNotMatchedInsertAll() \
 .execute()
"""
```

## Pattern 5: Multi-Table Copy with ForEach

```python
# Copy multiple tables dynamically
tables_config = [
    {"source": "Sales.Orders", "target": "orders", "mode": "Incremental"},
    {"source": "Sales.Customers", "target": "customers", "mode": "Full"},
    {"source": "Sales.Products", "target": "products", "mode": "Full"},
]

# Pipeline with ForEach
foreach_copy = {
    "name": "CopyAllTables",
    "type": "ForEach",
    "items": "@pipeline().parameters.tables",
    "isSequential": False,
    "batchCount": 4,
    "activities": [
        {
            "name": "CopyTable",
            "type": "Copy",
            "source": {
                "type": "AzureSqlSource",
                "sqlReaderQuery": "@{if(equals(item().mode, 'Incremental'), concat('SELECT * FROM ', item().source, ' WHERE ModifiedDate > ''', variables('lastRun'), ''''), concat('SELECT * FROM ', item().source))}"
            },
            "sink": {
                "type": "LakehouseSink",
                "tableActionOption": "@{if(equals(item().mode, 'Full'), 'Overwrite', 'Append')}",
                "tableOption": "@{concat('Tables/', item().target)}"
            }
        }
    ]
}
```

## Pattern 6: Handling Schema Changes

```python
# Auto-mapping for dynamic schemas
auto_schema_copy = {
    "name": "CopyWithAutoSchema",
    "type": "Copy",
    "source": {
        "type": "AzureSqlSource",
        "sqlReaderQuery": "SELECT * FROM Sales.Orders"
    },
    "sink": {
        "type": "LakehouseSink",
        "tableActionOption": "Append"
    },
    "enableSkipIncompatibleRow": True,
    "logSettings": {
        "enableCopyActivityLog": True,
        "copyActivityLogSettings": {
            "logLevel": "Warning",
            "enableReliableLogging": True
        }
    }
}
```

## Performance Optimization

```python
# Performance settings
performance_config = {
    "parallel_copies": {
        "description": "Number of concurrent copy threads",
        "default": "Auto (based on source/sink)",
        "max": 50,
        "recommended": "Auto for most cases"
    },
    "data_integration_units": {
        "description": "Compute power for copy",
        "default": "Auto",
        "min": 2,
        "max": 256,
        "cost": "Higher DIU = faster but more expensive"
    },
    "staging": {
        "description": "Use staging for certain scenarios",
        "when": "Source/sink require format conversion",
        "location": "Lakehouse Files folder"
    }
}

# Optimized copy for large tables
large_table_copy = {
    "name": "CopyLargeTable",
    "type": "Copy",
    "parallelCopies": 16,
    "dataIntegrationUnits": 32,
    "source": {
        "type": "AzureSqlSource",
        "partitionOption": "DynamicRange",
        "partitionSettings": {
            "partitionColumnName": "OrderID",
            "partitionUpperBound": "@{activity('GetMaxID').output.firstRow.max_id}",
            "partitionLowerBound": "@{activity('GetMinID').output.firstRow.min_id}"
        }
    }
}
```

## Error Handling

```python
# Fault tolerance settings
fault_tolerance = {
    "enableSkipIncompatibleRow": True,
    "writeBatchSize": 10000,
    "writeBatchTimeout": "00:10:00",
    "maxConcurrentConnections": 10,
    "retryPolicy": {
        "count": 3,
        "intervalInSeconds": 30
    }
}

# Log skipped rows
logging_config = {
    "logSettings": {
        "enableCopyActivityLog": True,
        "copyActivityLogSettings": {
            "logLevel": "Info",  # or Warning, Error
            "enableReliableLogging": True
        },
        "logLocationSettings": {
            "linkedServiceName": "LakehouseLinkedService",
            "path": "Files/copy_logs"
        }
    }
}
```

## Monitoring Copy Activity

```python
# Key metrics to monitor
copy_metrics = {
    "rows_read": "Number of rows from source",
    "rows_written": "Number of rows to sink",
    "rows_skipped": "Rows skipped due to errors",
    "throughput": "MB/s or rows/s",
    "duration": "Total copy time",
    "queue_time": "Time waiting for resources",
    "transfer_time": "Actual data movement time"
}

# Access via activity output
# @{activity('CopyData').output.rowsRead}
# @{activity('CopyData').output.rowsCopied}
# @{activity('CopyData').output.throughput}
```

Tomorrow we'll explore Dataflow Gen2 and Power Query-based transformations.

## Resources

- [Copy Activity Documentation](https://learn.microsoft.com/en-us/fabric/data-factory/copy-data-activity)
- [Copy Activity Performance](https://learn.microsoft.com/en-us/azure/data-factory/copy-activity-performance)
- [Incremental Load Patterns](https://learn.microsoft.com/en-us/azure/data-factory/tutorial-incremental-copy-overview)
