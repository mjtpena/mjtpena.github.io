---
title: "Building Data Pipelines with Azure Data Factory"
author: Michael John Peña
draft: false
date: 2020-08-15
tags:
  - Azure
  - Data Factory
  - ETL
  - Data Engineering

---


A surprising number of "modernise my reporting" engagements I see start the same way: data scattered across an on-prem SQL Server, a SaaS CRM, three Excel exports, and a CSV someone emails monthly. The first job is always to land that data somewhere queryable and keep it fresh. Data Factory is the orchestrator I reach for — managed, serverless, with connectors for the messy real-world sources you actually have. A working pipeline, plus the design choices I keep making the same way.

## Creating a Data Factory

```bash
# Create a Data Factory
az datafactory create \
    --resource-group rg-data \
    --factory-name adf-mycompany-2020 \
    --location australiaeast

# Enable Git integration (optional but recommended)
az datafactory configure-factory-repo \
    --resource-group rg-data \
    --factory-name adf-mycompany-2020 \
    --repository-name "data-factory-repo" \
    --account-name "your-azure-devops-org" \
    --project-name "DataPlatform" \
    --collaboration-branch "main" \
    --root-folder "/adf"
```

## Understanding Key Concepts

- **Pipeline**: A logical grouping of activities
- **Activity**: A task to perform (copy, transform, etc.)
- **Dataset**: A reference to data
- **Linked Service**: Connection to a data store
- **Trigger**: Defines when a pipeline runs

## Creating Linked Services

### Azure SQL Database

```json
{
    "name": "AzureSqlDatabase",
    "type": "Microsoft.DataFactory/factories/linkedservices",
    "properties": {
        "type": "AzureSqlDatabase",
        "typeProperties": {
            "connectionString": {
                "type": "AzureKeyVaultSecret",
                "store": {
                    "referenceName": "AzureKeyVault",
                    "type": "LinkedServiceReference"
                },
                "secretName": "SqlConnectionString"
            }
        }
    }
}
```

### Azure Blob Storage

```json
{
    "name": "AzureBlobStorage",
    "type": "Microsoft.DataFactory/factories/linkedservices",
    "properties": {
        "type": "AzureBlobStorage",
        "typeProperties": {
            "connectionString": {
                "type": "AzureKeyVaultSecret",
                "store": {
                    "referenceName": "AzureKeyVault",
                    "type": "LinkedServiceReference"
                },
                "secretName": "BlobStorageConnectionString"
            }
        }
    }
}
```

## Defining Datasets

### Source CSV Dataset

```json
{
    "name": "SourceCsvDataset",
    "properties": {
        "type": "DelimitedText",
        "linkedServiceName": {
            "referenceName": "AzureBlobStorage",
            "type": "LinkedServiceReference"
        },
        "typeProperties": {
            "location": {
                "type": "AzureBlobStorageLocation",
                "container": "raw-data",
                "folderPath": {
                    "value": "@formatDateTime(pipeline().parameters.processDate, 'yyyy/MM/dd')",
                    "type": "Expression"
                },
                "fileName": "*.csv"
            },
            "columnDelimiter": ",",
            "firstRowAsHeader": true
        },
        "schema": []
    }
}
```

### Sink SQL Table Dataset

```json
{
    "name": "SinkSqlDataset",
    "properties": {
        "type": "AzureSqlTable",
        "linkedServiceName": {
            "referenceName": "AzureSqlDatabase",
            "type": "LinkedServiceReference"
        },
        "typeProperties": {
            "schema": "staging",
            "table": "RawData"
        }
    }
}
```

## Building a Pipeline

### Copy Data Pipeline

```json
{
    "name": "CopyRawDataPipeline",
    "properties": {
        "activities": [
            {
                "name": "CopyFromBlobToSql",
                "type": "Copy",
                "inputs": [
                    {
                        "referenceName": "SourceCsvDataset",
                        "type": "DatasetReference"
                    }
                ],
                "outputs": [
                    {
                        "referenceName": "SinkSqlDataset",
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
                        }
                    },
                    "sink": {
                        "type": "AzureSqlSink",
                        "preCopyScript": "TRUNCATE TABLE staging.RawData",
                        "writeBehavior": "insert"
                    },
                    "enableStaging": false
                }
            }
        ],
        "parameters": {
            "processDate": {
                "type": "string"
            }
        }
    }
}
```

## Data Flow for Transformations

Create a mapping data flow for complex transformations:

```
Source (CSV)
    -> Derived Column (add calculated fields)
    -> Filter (remove invalid records)
    -> Aggregate (summarize by category)
    -> Sink (SQL table)
```

### Data Flow Script

```
source(output(
    OrderId as string,
    CustomerId as string,
    Amount as decimal(10,2),
    OrderDate as date
),
    allowSchemaDrift: true) ~> SourceData

SourceData derive(
    ProcessedDate = currentDate(),
    AmountWithTax = Amount * 1.1
) ~> DerivedColumns

DerivedColumns filter(Amount > 0 && !isNull(CustomerId)) ~> FilterInvalid

FilterInvalid aggregate(groupBy(CustomerId),
    TotalAmount = sum(AmountWithTax),
    OrderCount = count()
) ~> AggregateByCustomer

AggregateByCustomer sink(
    input(
        CustomerId as string,
        TotalAmount as decimal,
        OrderCount as integer
    )
) ~> SinkToSql
```

## Triggers

### Schedule Trigger

```json
{
    "name": "DailyTrigger",
    "properties": {
        "type": "ScheduleTrigger",
        "typeProperties": {
            "recurrence": {
                "frequency": "Day",
                "interval": 1,
                "startTime": "2020-08-01T06:00:00Z",
                "timeZone": "AUS Eastern Standard Time"
            }
        },
        "pipelines": [
            {
                "pipelineReference": {
                    "referenceName": "CopyRawDataPipeline",
                    "type": "PipelineReference"
                },
                "parameters": {
                    "processDate": "@trigger().scheduledTime"
                }
            }
        ]
    }
}
```

### Event Trigger (Blob Created)

```json
{
    "name": "BlobCreatedTrigger",
    "properties": {
        "type": "BlobEventsTrigger",
        "typeProperties": {
            "blobPathBeginsWith": "/raw-data/blobs/",
            "blobPathEndsWith": ".csv",
            "events": ["Microsoft.Storage.BlobCreated"]
        }
    }
}
```

## Monitoring and Alerts

```bash
# Create an alert for pipeline failures
az monitor metrics alert create \
    --name "ADF-Pipeline-Failure" \
    --resource-group rg-data \
    --scopes "/subscriptions/{sub}/resourceGroups/rg-data/providers/Microsoft.DataFactory/factories/adf-mycompany-2020" \
    --condition "count PipelineFailedRuns > 0" \
    --window-size 5m \
    --action-group ops-alerts
```

Azure Data Factory provides a scalable, serverless platform for building enterprise data pipelines without managing infrastructure.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n

