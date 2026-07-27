---
title: "Parameterized Pipelines in Azure Data Factory: Building Reusable Data Workflows"
author: "Michael John Peña"
draft: false
date: 2021-08-25
tags: ["Azure", "Data Factory", "Parameters", "ETL", "Reusability"]

---

I wrote "Parameterized Pipelines in Azure Data Factory: Building Reusable Data Workflows" to share practical, production-minded guidance on this topic.

## Defining Pipeline Parameters

```json
{
    "name": "ParameterizedCopyPipeline",
    "properties": {
        "parameters": {
            "sourceContainer": {
                "type": "String",
                "defaultValue": "rawdata"
            },
            "sourceFolder": {
                "type": "String"
            },
            "sourceFileName": {
                "type": "String",
                "defaultValue": "*.csv"
            },
            "sinkSchema": {
                "type": "String",
                "defaultValue": "staging"
            },
            "sinkTable": {
                "type": "String"
            },
            "loadDate": {
                "type": "String",
                "defaultValue": "@utcnow('yyyy-MM-dd')"
            },
            "isFullLoad": {
                "type": "Bool",
                "defaultValue": false
            }
        },
        "activities": [
            {
                "name": "CopyData",
                "type": "Copy",
                "typeProperties": {
                    "source": {
                        "type": "DelimitedTextSource",
                        "storeSettings": {
                            "type": "AzureBlobStorageReadSettings",
                            "recursive": true,
                            "wildcardFolderPath": {
                                "value": "@pipeline().parameters.sourceFolder",
                                "type": "Expression"
                            },
                            "wildcardFileName": {
                                "value": "@pipeline().parameters.sourceFileName",
                                "type": "Expression"
                            }
                        }
                    },
                    "sink": {
                        "type": "AzureSqlSink",
                        "preCopyScript": {
                            "value": "@if(pipeline().parameters.isFullLoad, concat('TRUNCATE TABLE ', pipeline().parameters.sinkSchema, '.', pipeline().parameters.sinkTable), '')",
                            "type": "Expression"
                        }
                    }
                }
            }
        ]
    }
}
```

## Parameterized Datasets

```json
{
    "name": "GenericBlobDataset",
    "properties": {
        "linkedServiceName": {
            "referenceName": "AzureBlobStorage",
            "type": "LinkedServiceReference"
        },
        "parameters": {
            "containerName": { "type": "String" },
            "folderPath": { "type": "String" },
            "fileName": { "type": "String" }
        },
        "type": "DelimitedText",
        "typeProperties": {
            "location": {
                "type": "AzureBlobStorageLocation",
                "container": {
                    "value": "@dataset().containerName",
                    "type": "Expression"
                },
                "folderPath": {
                    "value": "@dataset().folderPath",
                    "type": "Expression"
                },
                "fileName": {
                    "value": "@dataset().fileName",
                    "type": "Expression"
                }
            },
            "columnDelimiter": ",",
            "firstRowAsHeader": true
        }
    }
}
```

```json
{
    "name": "GenericSqlTableDataset",
    "properties": {
        "linkedServiceName": {
            "referenceName": "AzureSqlDatabase",
            "type": "LinkedServiceReference"
        },
        "parameters": {
            "schemaName": { "type": "String" },
            "tableName": { "type": "String" }
        },
        "type": "AzureSqlTable",
        "typeProperties": {
            "schema": {
                "value": "@dataset().schemaName",
                "type": "Expression"
            },
            "table": {
                "value": "@dataset().tableName",
                "type": "Expression"
            }
        }
    }
}
```

## Using Parameters in Copy Activity

```json
{
    "name": "CopyWithParameterizedDatasets",
    "type": "Copy",
    "inputs": [
        {
            "referenceName": "GenericBlobDataset",
            "type": "DatasetReference",
            "parameters": {
                "containerName": {
                    "value": "@pipeline().parameters.sourceContainer",
                    "type": "Expression"
                },
                "folderPath": {
                    "value": "@pipeline().parameters.sourceFolder",
                    "type": "Expression"
                },
                "fileName": {
                    "value": "@pipeline().parameters.sourceFileName",
                    "type": "Expression"
                }
            }
        }
    ],
    "outputs": [
        {
            "referenceName": "GenericSqlTableDataset",
            "type": "DatasetReference",
            "parameters": {
                "schemaName": {
                    "value": "@pipeline().parameters.sinkSchema",
                    "type": "Expression"
                },
                "tableName": {
                    "value": "@pipeline().parameters.sinkTable",
                    "type": "Expression"
                }
            }
        }
    ]
}
```

## Metadata-Driven Pipeline

```json
{
    "name": "MetadataDrivenPipeline",
    "properties": {
        "parameters": {
            "configTableName": {
                "type": "String",
                "defaultValue": "ETL.PipelineConfig"
            }
        },
        "activities": [
            {
                "name": "GetPipelineConfig",
                "type": "Lookup",
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": {
                            "value": "SELECT * FROM @{pipeline().parameters.configTableName} WHERE IsEnabled = 1",
                            "type": "Expression"
                        }
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
                        "activity": "GetPipelineConfig",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "items": {
                        "value": "@activity('GetPipelineConfig').output.value",
                        "type": "Expression"
                    },
                    "isSequential": false,
                    "batchCount": 10,
                    "activities": [
                        {
                            "name": "ExecuteCopyPipeline",
                            "type": "ExecutePipeline",
                            "typeProperties": {
                                "pipeline": {
                                    "referenceName": "ParameterizedCopyPipeline",
                                    "type": "PipelineReference"
                                },
                                "parameters": {
                                    "sourceContainer": {
                                        "value": "@item().SourceContainer",
                                        "type": "Expression"
                                    },
                                    "sourceFolder": {
                                        "value": "@item().SourceFolder",
                                        "type": "Expression"
                                    },
                                    "sinkSchema": {
                                        "value": "@item().SinkSchema",
                                        "type": "Expression"
                                    },
                                    "sinkTable": {
                                        "value": "@item().SinkTable",
                                        "type": "Expression"
                                    }
                                },
                                "waitOnCompletion": true
                            }
                        }
                    ]
                }
            }
        ]
    }
}
```

## Configuration Table Schema

```sql
-- SQL Server configuration table
CREATE TABLE ETL.PipelineConfig (
    ConfigID INT IDENTITY(1,1) PRIMARY KEY,
    PipelineName NVARCHAR(100) NOT NULL,
    SourceSystem NVARCHAR(50) NOT NULL,
    SourceContainer NVARCHAR(100) NOT NULL,
    SourceFolder NVARCHAR(500) NOT NULL,
    SourceFilePattern NVARCHAR(100) DEFAULT '*.csv',
    SinkSchema NVARCHAR(50) NOT NULL,
    SinkTable NVARCHAR(100) NOT NULL,
    LoadType NVARCHAR(20) DEFAULT 'Incremental', -- Full, Incremental
    WatermarkColumn NVARCHAR(100) NULL,
    IsEnabled BIT DEFAULT 1,
    LastLoadDate DATETIME NULL,
    CreatedDate DATETIME DEFAULT GETUTCDATE(),
    ModifiedDate DATETIME DEFAULT GETUTCDATE()
);

-- Sample configuration data
INSERT INTO ETL.PipelineConfig
(PipelineName, SourceSystem, SourceContainer, SourceFolder, SinkSchema, SinkTable, LoadType, WatermarkColumn)
VALUES
('LoadCustomers', 'CRM', 'crm-exports', 'customers/daily', 'staging', 'Customers', 'Incremental', 'ModifiedDate'),
('LoadOrders', 'ERP', 'erp-data', 'orders/2021', 'staging', 'Orders', 'Incremental', 'OrderDate'),
('LoadProducts', 'MDM', 'master-data', 'products', 'staging', 'Products', 'Full', NULL);
```

## Parameterized Linked Services

```json
{
    "name": "ParameterizedSqlLinkedService",
    "properties": {
        "type": "AzureSqlDatabase",
        "parameters": {
            "serverName": { "type": "String" },
            "databaseName": { "type": "String" }
        },
        "typeProperties": {
            "connectionString": {
                "value": "Server=tcp:@{linkedService().serverName}.database.windows.net,1433;Database=@{linkedService().databaseName};Authentication=Active Directory Managed Identity;",
                "type": "Expression"
            }
        }
    }
}
```

## Triggering Parameterized Pipelines

```python
# Python - Trigger parameterized pipeline
from azure.identity import DefaultAzureCredential
from azure.mgmt.datafactory import DataFactoryManagementClient
import uuid

class ADFPipelineTrigger:
    def __init__(self, subscription_id, resource_group, factory_name):
        self.credential = DefaultAzureCredential()
        self.client = DataFactoryManagementClient(
            self.credential, subscription_id
        )
        self.resource_group = resource_group
        self.factory_name = factory_name

    def trigger_with_parameters(self, pipeline_name, parameters):
        """Trigger pipeline with specific parameters"""
        run_id = str(uuid.uuid4())

        run_response = self.client.pipelines.create_run(
            self.resource_group,
            self.factory_name,
            pipeline_name,
            parameters=parameters
        )

        return run_response.run_id

    def trigger_multiple_loads(self, pipeline_name, configs):
        """Trigger multiple pipeline runs"""
        run_ids = []

        for config in configs:
            parameters = {
                'sourceContainer': config['source_container'],
                'sourceFolder': config['source_folder'],
                'sinkSchema': config['sink_schema'],
                'sinkTable': config['sink_table'],
                'isFullLoad': config.get('is_full_load', False)
            }

            run_id = self.trigger_with_parameters(pipeline_name, parameters)
            run_ids.append({
                'config': config,
                'run_id': run_id
            })

        return run_ids

# Usage
trigger = ADFPipelineTrigger(subscription_id, resource_group, factory_name)

configs = [
    {
        'source_container': 'sales',
        'source_folder': 'orders/2021/08',
        'sink_schema': 'staging',
        'sink_table': 'Orders',
        'is_full_load': False
    },
    {
        'source_container': 'crm',
        'source_folder': 'customers',
        'sink_schema': 'staging',
        'sink_table': 'Customers',
        'is_full_load': True
    }
]

runs = trigger.trigger_multiple_loads('ParameterizedCopyPipeline', configs)
```

## Best Practices

1. **Use defaults wisely**: Provide sensible defaults for optional parameters
2. **Validate parameters**: Add validation activities where needed
3. **Document parameters**: Use descriptions for clarity
4. **Keep datasets generic**: Parameterize at the dataset level
5. **Use metadata tables**: Store configuration externally

Parameterized pipelines dramatically reduce maintenance overhead and enable rapid deployment of new data integration scenarios without code changes.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
