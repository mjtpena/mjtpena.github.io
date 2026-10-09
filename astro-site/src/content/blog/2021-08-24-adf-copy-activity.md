---
title: "Azure Data Factory Copy Activity: Moving Data at Scale"
description: "The Copy Activity in Azure Data Factory is the activity I configure more than any other—it's the data movement primitive that connects over 90 source and…"
author: "Michael John Peña"
draft: false
date: 2021-08-24
tags: ["Azure", "Data Factory", "ETL", "Data Integration", "Copy Activity"]
---

The Copy Activity in Azure Data Factory is the activity I configure more than any other—it's the data movement primitive that connects over 90 source and sink connectors, handles parallelism, and manages schema mapping. The surface area is large, and the performance knobs are where most teams leave time on the table. Parallel copy degree controls how many threads copy data in parallel; for large dataset copies, the default is often too conservative. Staging through Azure Blob Storage (PolyBase copy path for Synapse Dedicated Pools) is dramatically faster than direct insert for large loads. Fault tolerance settings (skip incompatible rows, continue on error) control what happens when source data doesn't match the expected schema—important for copying data from sources with mixed data quality. The activity log captures copy statistics (bytes read, rows written, duration) that are essential for pipeline performance analysis.

## Basic Copy Activity Setup

```json
{
    "name": "CopyFromBlobToSQL",
    "type": "Copy",
    "inputs": [
        {
            "referenceName": "BlobSourceDataset",
            "type": "DatasetReference"
        }
    ],
    "outputs": [
        {
            "referenceName": "SqlSinkDataset",
            "type": "DatasetReference"
        }
    ],
    "typeProperties": {
        "source": {
            "type": "DelimitedTextSource",
            "storeSettings": {
                "type": "AzureBlobStorageReadSettings",
                "recursive": true,
                "wildcardFileName": "*.csv"
            },
            "formatSettings": {
                "type": "DelimitedTextReadSettings"
            }
        },
        "sink": {
            "type": "AzureSqlSink",
            "writeBehavior": "insert",
            "sqlWriterUseTableLock": true,
            "tableOption": "autoCreate"
        },
        "enableStaging": false
    }
}
```

## Creating Datasets

```json
// Source Dataset - Delimited Text in Blob Storage
{
    "name": "BlobSourceDataset",
    "type": "Microsoft.DataFactory/factories/datasets",
    "properties": {
        "linkedServiceName": {
            "referenceName": "AzureBlobStorage",
            "type": "LinkedServiceReference"
        },
        "type": "DelimitedText",
        "typeProperties": {
            "location": {
                "type": "AzureBlobStorageLocation",
                "container": "rawdata",
                "folderPath": "sales"
            },
            "columnDelimiter": ",",
            "firstRowAsHeader": true,
            "quoteChar": "\""
        },
        "schema": [
            { "name": "OrderID", "type": "String" },
            { "name": "CustomerID", "type": "String" },
            { "name": "OrderDate", "type": "String" },
            { "name": "Amount", "type": "Decimal" }
        ]
    }
}

// Sink Dataset - Azure SQL Database
{
    "name": "SqlSinkDataset",
    "type": "Microsoft.DataFactory/factories/datasets",
    "properties": {
        "linkedServiceName": {
            "referenceName": "AzureSqlDatabase",
            "type": "LinkedServiceReference"
        },
        "type": "AzureSqlTable",
        "typeProperties": {
            "schema": "dbo",
            "table": "Orders"
        }
    }
}
```

## Schema Mapping

```json
{
    "name": "CopyWithMapping",
    "type": "Copy",
    "typeProperties": {
        "source": {
            "type": "DelimitedTextSource"
        },
        "sink": {
            "type": "AzureSqlSink"
        },
        "translator": {
            "type": "TabularTranslator",
            "mappings": [
                {
                    "source": { "name": "order_id" },
                    "sink": { "name": "OrderID", "type": "Int32" }
                },
                {
                    "source": { "name": "cust_id" },
                    "sink": { "name": "CustomerID", "type": "String" }
                },
                {
                    "source": { "name": "order_dt" },
                    "sink": { "name": "OrderDate", "type": "DateTime" }
                },
                {
                    "source": { "name": "total_amt" },
                    "sink": { "name": "Amount", "type": "Decimal" }
                }
            ],
            "typeConversion": true,
            "typeConversionSettings": {
                "allowDataTruncation": false,
                "treatBooleanAsNumber": false,
                "dateTimeFormat": "yyyy-MM-dd"
            }
        }
    }
}
```

## Incremental Copy with Watermarks

```json
{
    "name": "IncrementalCopyPipeline",
    "properties": {
        "activities": [
            {
                "name": "GetLastWatermark",
                "type": "Lookup",
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": "SELECT MAX(ModifiedDate) as LastWatermark FROM Watermarks WHERE TableName = 'Orders'"
                    },
                    "dataset": {
                        "referenceName": "WatermarkDataset",
                        "type": "DatasetReference"
                    }
                }
            },
            {
                "name": "GetCurrentWatermark",
                "type": "Lookup",
                "dependsOn": [
                    {
                        "activity": "GetLastWatermark",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": "SELECT MAX(ModifiedDate) as CurrentWatermark FROM SourceOrders"
                    },
                    "dataset": {
                        "referenceName": "SourceDataset",
                        "type": "DatasetReference"
                    }
                }
            },
            {
                "name": "IncrementalCopy",
                "type": "Copy",
                "dependsOn": [
                    {
                        "activity": "GetCurrentWatermark",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": {
                            "value": "SELECT * FROM SourceOrders WHERE ModifiedDate > '@{activity('GetLastWatermark').output.firstRow.LastWatermark}' AND ModifiedDate <= '@{activity('GetCurrentWatermark').output.firstRow.CurrentWatermark}'",
                            "type": "Expression"
                        }
                    },
                    "sink": {
                        "type": "AzureSqlSink",
                        "writeBehavior": "upsert",
                        "upsertSettings": {
                            "useTempDB": true,
                            "keys": ["OrderID"]
                        }
                    }
                }
            },
            {
                "name": "UpdateWatermark",
                "type": "SqlServerStoredProcedure",
                "dependsOn": [
                    {
                        "activity": "IncrementalCopy",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "storedProcedureName": "sp_UpdateWatermark",
                    "storedProcedureParameters": {
                        "TableName": { "value": "Orders", "type": "String" },
                        "WatermarkValue": {
                            "value": "@{activity('GetCurrentWatermark').output.firstRow.CurrentWatermark}",
                            "type": "DateTime"
                        }
                    }
                }
            }
        ]
    }
}
```

## Performance Optimization

```json
{
    "name": "OptimizedCopyActivity",
    "type": "Copy",
    "typeProperties": {
        "source": {
            "type": "AzureBlobSource",
            "recursive": true
        },
        "sink": {
            "type": "AzureSqlSink",
            "writeBatchSize": 100000,
            "writeBatchTimeout": "00:30:00",
            "preCopyScript": "TRUNCATE TABLE staging.Orders",
            "sqlWriterUseTableLock": true,
            "disableMetricsCollection": false
        },
        "enableStaging": true,
        "stagingSettings": {
            "linkedServiceName": {
                "referenceName": "StagingBlobStorage",
                "type": "LinkedServiceReference"
            },
            "path": "staging",
            "enableCompression": true
        },
        "parallelCopies": 32,
        "dataIntegrationUnits": 256,
        "enableSkipIncompatibleRow": true,
        "redirectIncompatibleRowSettings": {
            "linkedServiceName": {
                "referenceName": "ErrorBlobStorage",
                "type": "LinkedServiceReference"
            },
            "path": "errors/incompatible"
        }
    }
}
```

## Copy Activity with Managed Identity

```python
# Python - Creating Copy Activity programmatically
from azure.identity import DefaultAzureCredential
from azure.mgmt.datafactory import DataFactoryManagementClient
from azure.mgmt.datafactory.models import *

class ADFCopyBuilder:
    def __init__(self, subscription_id, resource_group, factory_name):
        self.credential = DefaultAzureCredential()
        self.client = DataFactoryManagementClient(
            self.credential, subscription_id
        )
        self.resource_group = resource_group
        self.factory_name = factory_name

    def create_copy_pipeline(self, pipeline_name, source_config, sink_config):
        """Create a copy pipeline"""

        copy_activity = CopyActivity(
            name="CopyData",
            inputs=[DatasetReference(reference_name=source_config['dataset'])],
            outputs=[DatasetReference(reference_name=sink_config['dataset'])],
            source=self._create_source(source_config),
            sink=self._create_sink(sink_config),
            enable_staging=True,
            parallel_copies=16,
            data_integration_units=64
        )

        pipeline = PipelineResource(
            activities=[copy_activity],
            parameters={
                "sourceFolder": ParameterSpecification(type="String"),
                "sinkTable": ParameterSpecification(type="String")
            }
        )

        return self.client.pipelines.create_or_update(
            self.resource_group,
            self.factory_name,
            pipeline_name,
            pipeline
        )

    def _create_source(self, config):
        if config['type'] == 'blob':
            return BlobSource(recursive=True)
        elif config['type'] == 'sql':
            return AzureSqlSource(
                sql_reader_query=config.get('query')
            )
        elif config['type'] == 'parquet':
            return ParquetSource(
                store_settings=AzureBlobStorageReadSettings(
                    recursive=True,
                    wildcard_file_name="*.parquet"
                )
            )

    def _create_sink(self, config):
        if config['type'] == 'sql':
            return AzureSqlSink(
                write_behavior="upsert",
                sql_writer_use_table_lock=True
            )
        elif config['type'] == 'parquet':
            return ParquetSink(
                store_settings=AzureBlobStorageWriteSettings()
            )
        elif config['type'] == 'datalake':
            return AzureDatalakeStoreSink()
```

## Monitoring Copy Performance

```python
# Python - Monitor copy activity runs
def analyze_copy_performance(client, resource_group, factory_name,
                             pipeline_name, run_id):
    """Analyze copy activity performance metrics"""

    activity_runs = client.activity_runs.query_by_pipeline_run(
        resource_group,
        factory_name,
        run_id,
        FilterActivityRunsQuery(
            last_updated_after=datetime.utcnow() - timedelta(days=1),
            last_updated_before=datetime.utcnow()
        )
    )

    for activity in activity_runs.value:
        if activity.activity_type == "Copy":
            output = activity.output

            metrics = {
                'rows_read': output.get('rowsRead', 0),
                'rows_copied': output.get('rowsCopied', 0),
                'rows_skipped': output.get('rowsSkipped', 0),
                'data_read_mb': output.get('dataRead', 0) / (1024*1024),
                'data_written_mb': output.get('dataWritten', 0) / (1024*1024),
                'throughput_mbps': output.get('throughput', 0),
                'duration_seconds': output.get('copyDuration', 0),
                'used_diu': output.get('usedDataIntegrationUnits', 0),
                'used_parallel_copies': output.get('usedParallelCopies', 0)
            }

            print(f"Copy Activity Metrics:")
            for key, value in metrics.items():
                print(f"  {key}: {value}")

            return metrics

    return None
```

## Best Practices

1. **Use appropriate DIUs**: Scale based on data volume
2. **Enable staging**: For cross-region or large copies
3. **Configure parallel copies**: Match to source/sink capacity
4. **Handle errors gracefully**: Use skip incompatible rows
5. **Monitor throughput**: Optimize based on metrics

The Copy Activity is the foundation of data movement in Azure Data Factory, providing enterprise-grade data integration with extensive connector support and performance optimization capabilities.
