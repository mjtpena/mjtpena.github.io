---
title: "Azure Data Factory Lookup Activity: Retrieving Metadata for Dynamic Pipelines"
author: "Michael John Peña"
draft: false
date: 2021-08-27
tags: ["Azure", "Data Factory", "Lookup", "ETL", "Metadata"]

---

I wrote "Azure Data Factory Lookup Activity: Retrieving Metadata for Dynamic Pipelines" to share practical, production-minded guidance on this topic.

## Basic Lookup Activity

```json
{
    "name": "LookupTableList",
    "type": "Lookup",
    "policy": {
        "timeout": "7.00:00:00",
        "retry": 3,
        "retryIntervalInSeconds": 30
    },
    "typeProperties": {
        "source": {
            "type": "AzureSqlSource",
            "sqlReaderQuery": "SELECT TableName, SchemaName, LoadType FROM ETL.TableConfig WHERE IsEnabled = 1"
        },
        "dataset": {
            "referenceName": "ConfigDataset",
            "type": "DatasetReference"
        },
        "firstRowOnly": false
    }
}
```

## Lookup from Different Sources

### SQL Database Lookup

```json
{
    "name": "LookupFromSQL",
    "type": "Lookup",
    "typeProperties": {
        "source": {
            "type": "AzureSqlSource",
            "sqlReaderQuery": {
                "value": "@concat('SELECT MAX(ModifiedDate) as Watermark FROM ', pipeline().parameters.tableName)",
                "type": "Expression"
            },
            "queryTimeout": "00:30:00"
        },
        "dataset": {
            "referenceName": "SqlDataset",
            "type": "DatasetReference"
        },
        "firstRowOnly": true
    }
}
```

### Blob Storage Lookup (JSON)

```json
{
    "name": "LookupFromBlob",
    "type": "Lookup",
    "typeProperties": {
        "source": {
            "type": "JsonSource",
            "storeSettings": {
                "type": "AzureBlobStorageReadSettings",
                "recursive": false
            },
            "formatSettings": {
                "type": "JsonReadSettings"
            }
        },
        "dataset": {
            "referenceName": "ConfigJsonDataset",
            "type": "DatasetReference",
            "parameters": {
                "fileName": "pipeline-config.json"
            }
        },
        "firstRowOnly": false
    }
}
```

### Cosmos DB Lookup

```json
{
    "name": "LookupFromCosmos",
    "type": "Lookup",
    "typeProperties": {
        "source": {
            "type": "CosmosDbSqlApiSource",
            "query": "SELECT c.id, c.config, c.lastUpdated FROM c WHERE c.type = 'etl-config' AND c.isActive = true",
            "preferredRegions": ["East US", "West US"]
        },
        "dataset": {
            "referenceName": "CosmosConfigDataset",
            "type": "DatasetReference"
        },
        "firstRowOnly": false
    }
}
```

## Using Lookup Output

```json
{
    "name": "ProcessLookupResults",
    "properties": {
        "activities": [
            {
                "name": "GetTableConfig",
                "type": "Lookup",
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": "SELECT * FROM ETL.TableConfig WHERE IsEnabled = 1"
                    },
                    "dataset": {
                        "referenceName": "ConfigDataset",
                        "type": "DatasetReference"
                    },
                    "firstRowOnly": false
                }
            },
            {
                "name": "ForEachTable",
                "type": "ForEach",
                "dependsOn": [
                    {
                        "activity": "GetTableConfig",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "items": {
                        "value": "@activity('GetTableConfig').output.value",
                        "type": "Expression"
                    },
                    "activities": [
                        {
                            "name": "CopyTable",
                            "type": "Copy",
                            "typeProperties": {
                                "source": {
                                    "type": "AzureSqlSource",
                                    "sqlReaderQuery": {
                                        "value": "@concat('SELECT * FROM ', item().SchemaName, '.', item().TableName)",
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
        ]
    }
}
```

## First Row Only vs Multiple Rows

```json
{
    "name": "SingleRowLookup",
    "properties": {
        "activities": [
            {
                "name": "GetSingleValue",
                "type": "Lookup",
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": "SELECT MAX(LoadDate) as LastLoadDate FROM ETL.LoadHistory WHERE TableName = 'Orders'"
                    },
                    "dataset": {
                        "referenceName": "SqlDataset",
                        "type": "DatasetReference"
                    },
                    "firstRowOnly": true
                }
            },
            {
                "name": "UseValue",
                "type": "Copy",
                "dependsOn": [
                    {
                        "activity": "GetSingleValue",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": {
                            "value": "@concat('SELECT * FROM Orders WHERE LoadDate > ''', activity('GetSingleValue').output.firstRow.LastLoadDate, '''')",
                            "type": "Expression"
                        }
                    }
                }
            }
        ]
    }
}
```

## Lookup for Watermark Tracking

```json
{
    "name": "WatermarkPipeline",
    "properties": {
        "parameters": {
            "tableName": { "type": "String" }
        },
        "activities": [
            {
                "name": "GetOldWatermark",
                "type": "Lookup",
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": {
                            "value": "@concat('SELECT WatermarkValue FROM ETL.Watermarks WHERE TableName = ''', pipeline().parameters.tableName, '''')",
                            "type": "Expression"
                        }
                    },
                    "dataset": { "referenceName": "WatermarkDataset", "type": "DatasetReference" },
                    "firstRowOnly": true
                }
            },
            {
                "name": "GetNewWatermark",
                "type": "Lookup",
                "dependsOn": [
                    {
                        "activity": "GetOldWatermark",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": {
                            "value": "@concat('SELECT MAX(ModifiedDate) as NewWatermark FROM ', pipeline().parameters.tableName)",
                            "type": "Expression"
                        }
                    },
                    "dataset": { "referenceName": "SourceDataset", "type": "DatasetReference" },
                    "firstRowOnly": true
                }
            },
            {
                "name": "IncrementalCopy",
                "type": "Copy",
                "dependsOn": [
                    {
                        "activity": "GetNewWatermark",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": {
                            "value": "@concat('SELECT * FROM ', pipeline().parameters.tableName, ' WHERE ModifiedDate > ''', activity('GetOldWatermark').output.firstRow.WatermarkValue, ''' AND ModifiedDate <= ''', activity('GetNewWatermark').output.firstRow.NewWatermark, '''')",
                            "type": "Expression"
                        }
                    },
                    "sink": { "type": "ParquetSink" }
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
                        "TableName": {
                            "value": { "value": "@pipeline().parameters.tableName", "type": "Expression" },
                            "type": "String"
                        },
                        "WatermarkValue": {
                            "value": { "value": "@activity('GetNewWatermark').output.firstRow.NewWatermark", "type": "Expression" },
                            "type": "DateTime"
                        }
                    }
                }
            }
        ]
    }
}
```

## Error Handling with Lookup

```json
{
    "name": "SafeLookup",
    "properties": {
        "activities": [
            {
                "name": "TryLookup",
                "type": "Lookup",
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": "SELECT TOP 1 * FROM ETL.Config"
                    },
                    "dataset": { "referenceName": "ConfigDataset", "type": "DatasetReference" },
                    "firstRowOnly": true
                }
            },
            {
                "name": "OnSuccess",
                "type": "SetVariable",
                "dependsOn": [
                    {
                        "activity": "TryLookup",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "variableName": "lookupResult",
                    "value": {
                        "value": "@string(activity('TryLookup').output.firstRow)",
                        "type": "Expression"
                    }
                }
            },
            {
                "name": "OnFailure",
                "type": "SetVariable",
                "dependsOn": [
                    {
                        "activity": "TryLookup",
                        "dependencyConditions": ["Failed"]
                    }
                ],
                "typeProperties": {
                    "variableName": "lookupResult",
                    "value": {
                        "value": "@string(json('{\"error\": true, \"message\": \"Lookup failed\"}'))",
                        "type": "Expression"
                    }
                }
            }
        ]
    }
}
```

## Python Helper for Lookup Results

```python
# Python - Process lookup results
def process_lookup_output(lookup_output, first_row_only=False):
    """
    Process ADF Lookup activity output

    Args:
        lookup_output: The output from lookup activity
        first_row_only: Whether lookup was configured for first row only

    Returns:
        Processed data structure
    """
    if first_row_only:
        # Output structure: {"firstRow": {...}, "count": 1}
        return lookup_output.get('firstRow', {})
    else:
        # Output structure: {"value": [...], "count": n}
        return lookup_output.get('value', [])

def validate_lookup_result(lookup_output, required_fields):
    """Validate lookup result has required fields"""
    if 'firstRow' in lookup_output:
        row = lookup_output['firstRow']
        missing = [f for f in required_fields if f not in row]
        if missing:
            raise ValueError(f"Missing required fields: {missing}")
        return True
    elif 'value' in lookup_output:
        for row in lookup_output['value']:
            missing = [f for f in required_fields if f not in row]
            if missing:
                raise ValueError(f"Missing required fields in row: {missing}")
        return True
    return False
```

## Best Practices

1. **Use firstRowOnly appropriately**: True for single values, False for arrays
2. **Handle empty results**: Check count before using output
3. **Set query timeouts**: Prevent long-running queries
4. **Cache when possible**: Avoid repeated lookups for static data
5. **Use stored procedures**: For complex lookup logic

The Lookup Activity is the foundation for building intelligent, data-driven pipelines that adapt their behavior based on configuration and runtime data.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
