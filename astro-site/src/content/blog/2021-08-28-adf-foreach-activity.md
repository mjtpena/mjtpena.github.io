---
title: "Azure Data Factory ForEach Activity: Parallel Processing Patterns"
author: "Michael John Peña"
draft: false
date: 2021-08-28
tags: ["Azure", "Data Factory", "ForEach", "Parallel Processing", "ETL"]

---

I wrote "Azure Data Factory ForEach Activity: Parallel Processing Patterns" to share practical, production-minded guidance on this topic.

## Basic ForEach Structure

```json
{
    "name": "ForEachTable",
    "type": "ForEach",
    "typeProperties": {
        "items": {
            "value": "@pipeline().parameters.tableList",
            "type": "Expression"
        },
        "isSequential": false,
        "batchCount": 20,
        "activities": [
            {
                "name": "CopyTable",
                "type": "Copy",
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": {
                            "value": "@concat('SELECT * FROM ', item().schemaName, '.', item().tableName)",
                            "type": "Expression"
                        }
                    },
                    "sink": {
                        "type": "ParquetSink"
                    }
                }
            }
        ]
    }
}
```

## Parallel vs Sequential Processing

```json
{
    "name": "ParallelProcessing",
    "properties": {
        "activities": [
            {
                "name": "ParallelForEach",
                "type": "ForEach",
                "typeProperties": {
                    "items": {
                        "value": "@activity('GetTables').output.value",
                        "type": "Expression"
                    },
                    "isSequential": false,
                    "batchCount": 50,
                    "activities": [
                        {
                            "name": "ProcessInParallel",
                            "type": "ExecutePipeline",
                            "typeProperties": {
                                "pipeline": {
                                    "referenceName": "CopyTablePipeline",
                                    "type": "PipelineReference"
                                },
                                "parameters": {
                                    "tableName": "@item().tableName"
                                }
                            }
                        }
                    ]
                }
            },
            {
                "name": "SequentialForEach",
                "type": "ForEach",
                "dependsOn": [
                    {
                        "activity": "ParallelForEach",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "items": {
                        "value": "@activity('GetDependentTables').output.value",
                        "type": "Expression"
                    },
                    "isSequential": true,
                    "activities": [
                        {
                            "name": "ProcessSequentially",
                            "type": "ExecutePipeline",
                            "typeProperties": {
                                "pipeline": {
                                    "referenceName": "ProcessDependentTable",
                                    "type": "PipelineReference"
                                }
                            }
                        }
                    ]
                }
            }
        ]
    }
}
```

## ForEach with Lookup

```json
{
    "name": "DynamicForEachPipeline",
    "properties": {
        "activities": [
            {
                "name": "GetSourceTables",
                "type": "Lookup",
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": "SELECT SchemaName, TableName, WatermarkColumn, TargetFolder FROM ETL.SourceConfig WHERE IsEnabled = 1"
                    },
                    "dataset": {
                        "referenceName": "ConfigDataset",
                        "type": "DatasetReference"
                    },
                    "firstRowOnly": false
                }
            },
            {
                "name": "ProcessEachTable",
                "type": "ForEach",
                "dependsOn": [
                    {
                        "activity": "GetSourceTables",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "items": {
                        "value": "@activity('GetSourceTables').output.value",
                        "type": "Expression"
                    },
                    "isSequential": false,
                    "batchCount": 10,
                    "activities": [
                        {
                            "name": "CopyToDataLake",
                            "type": "Copy",
                            "inputs": [
                                {
                                    "referenceName": "SourceSqlDataset",
                                    "type": "DatasetReference",
                                    "parameters": {
                                        "schemaName": "@item().SchemaName",
                                        "tableName": "@item().TableName"
                                    }
                                }
                            ],
                            "outputs": [
                                {
                                    "referenceName": "DataLakeParquetDataset",
                                    "type": "DatasetReference",
                                    "parameters": {
                                        "folderPath": {
                                            "value": "@concat(item().TargetFolder, '/', formatDateTime(utcnow(), 'yyyy/MM/dd'))",
                                            "type": "Expression"
                                        }
                                    }
                                }
                            ],
                            "typeProperties": {
                                "source": {
                                    "type": "AzureSqlSource"
                                },
                                "sink": {
                                    "type": "ParquetSink"
                                }
                            }
                        }
                    ]
                }
            }
        ]
    }
}
```

## Nested ForEach Loops

```json
{
    "name": "NestedForEachPipeline",
    "properties": {
        "activities": [
            {
                "name": "GetDatabases",
                "type": "Lookup",
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": "SELECT DatabaseName, ServerName FROM ETL.Databases WHERE IsEnabled = 1"
                    },
                    "firstRowOnly": false
                }
            },
            {
                "name": "ForEachDatabase",
                "type": "ForEach",
                "dependsOn": [
                    {
                        "activity": "GetDatabases",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "items": "@activity('GetDatabases').output.value",
                    "isSequential": false,
                    "batchCount": 5,
                    "activities": [
                        {
                            "name": "GetTablesForDatabase",
                            "type": "Lookup",
                            "typeProperties": {
                                "source": {
                                    "type": "AzureSqlSource",
                                    "sqlReaderQuery": {
                                        "value": "@concat('SELECT TableName FROM ETL.Tables WHERE DatabaseName = ''', item().DatabaseName, '''')",
                                        "type": "Expression"
                                    }
                                },
                                "firstRowOnly": false
                            }
                        },
                        {
                            "name": "ForEachTable",
                            "type": "ForEach",
                            "dependsOn": [
                                {
                                    "activity": "GetTablesForDatabase",
                                    "dependencyConditions": ["Succeeded"]
                                }
                            ],
                            "typeProperties": {
                                "items": "@activity('GetTablesForDatabase').output.value",
                                "isSequential": false,
                                "batchCount": 10,
                                "activities": [
                                    {
                                        "name": "ProcessTable",
                                        "type": "ExecutePipeline",
                                        "typeProperties": {
                                            "pipeline": {
                                                "referenceName": "CopyTablePipeline",
                                                "type": "PipelineReference"
                                            },
                                            "parameters": {
                                                "serverName": {
                                                    "value": "@pipeline().parameters.currentDatabase.ServerName",
                                                    "type": "Expression"
                                                },
                                                "databaseName": {
                                                    "value": "@pipeline().parameters.currentDatabase.DatabaseName",
                                                    "type": "Expression"
                                                },
                                                "tableName": "@item().TableName"
                                            }
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                }
            }
        ]
    }
}
```

## Error Handling in ForEach

```json
{
    "name": "ForEachWithErrorHandling",
    "type": "ForEach",
    "typeProperties": {
        "items": "@activity('GetItems').output.value",
        "isSequential": false,
        "batchCount": 10,
        "activities": [
            {
                "name": "TryCopy",
                "type": "Copy",
                "typeProperties": {
                    "source": { "type": "AzureSqlSource" },
                    "sink": { "type": "ParquetSink" }
                }
            },
            {
                "name": "LogSuccess",
                "type": "SqlServerStoredProcedure",
                "dependsOn": [
                    {
                        "activity": "TryCopy",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "storedProcedureName": "sp_LogCopyResult",
                    "storedProcedureParameters": {
                        "TableName": { "value": "@item().TableName" },
                        "Status": { "value": "Success" },
                        "RowsCopied": { "value": "@activity('TryCopy').output.rowsCopied" }
                    }
                }
            },
            {
                "name": "LogFailure",
                "type": "SqlServerStoredProcedure",
                "dependsOn": [
                    {
                        "activity": "TryCopy",
                        "dependencyConditions": ["Failed"]
                    }
                ],
                "typeProperties": {
                    "storedProcedureName": "sp_LogCopyResult",
                    "storedProcedureParameters": {
                        "TableName": { "value": "@item().TableName" },
                        "Status": { "value": "Failed" },
                        "ErrorMessage": {
                            "value": "@activity('TryCopy').error.message"
                        }
                    }
                }
            }
        ]
    }
}
```

## Batching Large Collections

```json
{
    "name": "BatchProcessingPipeline",
    "properties": {
        "parameters": {
            "batchSize": { "type": "Int", "defaultValue": 100 }
        },
        "variables": {
            "batchNumber": { "type": "Int" }
        },
        "activities": [
            {
                "name": "GetTotalCount",
                "type": "Lookup",
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": "SELECT COUNT(*) as TotalCount FROM ETL.ItemsToProcess"
                    },
                    "firstRowOnly": true
                }
            },
            {
                "name": "CalculateBatches",
                "type": "SetVariable",
                "dependsOn": [
                    {
                        "activity": "GetTotalCount",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "variableName": "batchNumber",
                    "value": {
                        "value": "@div(add(activity('GetTotalCount').output.firstRow.TotalCount, pipeline().parameters.batchSize), pipeline().parameters.batchSize)",
                        "type": "Expression"
                    }
                }
            },
            {
                "name": "ForEachBatch",
                "type": "ForEach",
                "dependsOn": [
                    {
                        "activity": "CalculateBatches",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "items": {
                        "value": "@range(0, int(variables('batchNumber')))",
                        "type": "Expression"
                    },
                    "isSequential": false,
                    "batchCount": 5,
                    "activities": [
                        {
                            "name": "ProcessBatch",
                            "type": "Copy",
                            "typeProperties": {
                                "source": {
                                    "type": "AzureSqlSource",
                                    "sqlReaderQuery": {
                                        "value": "@concat('SELECT * FROM ETL.ItemsToProcess ORDER BY Id OFFSET ', mul(item(), pipeline().parameters.batchSize), ' ROWS FETCH NEXT ', pipeline().parameters.batchSize, ' ROWS ONLY')",
                                        "type": "Expression"
                                    }
                                },
                                "sink": { "type": "ParquetSink" }
                            }
                        }
                    ]
                }
            }
        ]
    }
}
```

## Collecting ForEach Results

```python
# Python - Process ForEach activity outputs
def collect_foreach_results(pipeline_run_client, run_id, foreach_activity_name):
    """
    Collect results from all ForEach iterations

    Note: ForEach doesn't directly expose iteration outputs.
    You need to log results to a table/blob during execution.
    """

    activity_runs = pipeline_run_client.query_activity_runs(
        resource_group,
        factory_name,
        run_id,
        {
            'lastUpdatedAfter': datetime.utcnow() - timedelta(days=1),
            'lastUpdatedBefore': datetime.utcnow()
        }
    )

    results = []
    for activity in activity_runs.value:
        if activity.activity_name.startswith(foreach_activity_name):
            results.append({
                'iteration': activity.activity_name,
                'status': activity.status,
                'duration': activity.duration_in_ms,
                'output': activity.output
            })

    return results
```

## Best Practices

1. **Set appropriate batchCount**: Balance parallelism with resource limits
2. **Use sequential for dependencies**: When order matters
3. **Implement error handling**: Log failures within the loop
4. **Avoid deeply nested loops**: Use child pipelines instead
5. **Monitor iteration performance**: Identify slow items

The ForEach Activity is the key to building scalable, efficient data pipelines that can process thousands of items in parallel while maintaining control and visibility over each iteration.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
