---
title: "Azure Data Factory: Designing a First Pipeline You Can Safely Rerun"
description: "How I build a first Azure Data Factory pipeline: parameterised by date, idempotent staging loads, no secrets in JSON, and UTC-only schedule triggers."
author: Michael John Peña
draft: false
date: 2020-08-15
tags:
  - Azure
  - Data Factory
  - ETL
  - Data Engineering
---

Most "modernise my reporting" projects start the same way: data scattered across an on-prem SQL Server, a SaaS CRM, three Excel exports, and a CSV someone emails monthly. The first job is always to land that data somewhere queryable and keep it fresh, and Azure Data Factory is the orchestrator I reach for: managed, serverless, and with connectors for the messy sources you actually have. What decides whether a pipeline survives its first year isn't the connector list, though. It's whether you can rerun any day's load without making a mess.

## The shape of the pipeline

The example is deliberately boring: CSV files land in a Blob Storage container under a `yyyy/MM/dd` folder, and each day's files need to end up in an Azure SQL Database table. The pipeline has two activities:

1. A **Copy** activity that truncates a staging table and bulk-loads one day's files into it.
2. A **Stored Procedure** activity that merges staging into the real table.

That's the whole thing, and every design choice below exists to make it rerunnable. If Tuesday's load fails, or someone drops a corrected file into Tuesday's folder on Thursday, I want to run the pipeline for Tuesday again and get the right answer, with no duplicates and no manual clean-up.

Data Factory's building blocks map onto that neatly. [Pipelines and activities](https://learn.microsoft.com/azure/data-factory/concepts-pipelines-activities) do the work. Datasets describe the shape and location of the data. Linked services hold the connection details, and triggers decide when a pipeline runs.

## Connections without secrets in JSON

Every Data Factory object is a JSON document, and once you turn on Git integration those documents live in a repository. That's exactly where you don't want a connection string. Data Factory gets a system-assigned managed identity when you create it, so I use that wherever the target supports it, and Key Vault references for the systems that don't.

For Azure SQL Database, managed identity works well. Connected as the server's Azure Active Directory admin, you create a contained database user for the factory (`CREATE USER [<your-factory-name>] FROM EXTERNAL PROVIDER;`), grant it what the load needs, and the linked service carries no password at all:

```json
{
    "name": "ls_sql_reporting",
    "properties": {
        "type": "AzureSqlDatabase",
        "typeProperties": {
            "connectionString": "Data Source=tcp:<your-server-name>.database.windows.net,1433;Initial Catalog=<your-database-name>;Connect Timeout=30"
        }
    }
}
```

With no user name, password or service principal in the connection string, the [Azure SQL Database connector](https://learn.microsoft.com/azure/data-factory/connector-azure-sql-database) authenticates as the factory's managed identity. The Blob Storage linked service follows the same idea: a `serviceEndpoint` plus a **Storage Blob Data Reader** role assignment for the factory, rather than an account key.

When a source can only take a password (a SaaS API, an on-prem SQL Server login reached through a self-hosted integration runtime), I put the secret in Key Vault and have the linked service reference it. Either way, the JSON in the repository is safe to read.

## Parameterise the dataset, not the pipeline logic

The mistake I see most often is a dataset with a hard-coded folder path, or one that tries to read pipeline parameters directly. Datasets can't see pipeline parameters. They have their own parameters, and the pipeline passes values in. That separation is what lets one dataset serve every day's folder:

```json
{
    "name": "ds_raw_sales_csv",
    "properties": {
        "type": "DelimitedText",
        "linkedServiceName": {
            "referenceName": "ls_blob_raw",
            "type": "LinkedServiceReference"
        },
        "parameters": {
            "folderDate": { "type": "string" }
        },
        "typeProperties": {
            "location": {
                "type": "AzureBlobStorageLocation",
                "container": "raw",
                "folderPath": {
                    "value": "@concat('sales/', formatDateTime(dataset().folderDate, 'yyyy/MM/dd'))",
                    "type": "Expression"
                }
            },
            "columnDelimiter": ",",
            "firstRowAsHeader": true
        },
        "schema": []
    }
}
```

The sink dataset is an `AzureSqlTable` pointing at `staging.Sales`, using the `schema` and `table` properties (the older single `tableName` property still works for backward compatibility):

```json
{
    "name": "ds_sql_staging_sales",
    "properties": {
        "type": "AzureSqlTable",
        "linkedServiceName": {
            "referenceName": "ls_sql_reporting",
            "type": "LinkedServiceReference"
        },
        "typeProperties": {
            "schema": "staging",
            "table": "Sales"
        }
    }
}
```

The `ls_blob_raw` linked service is omitted for brevity; it's the `serviceEndpoint` plus managed identity setup described above.

## The pipeline: truncate, load, merge

```json
{
    "name": "pl_load_sales_daily",
    "properties": {
        "parameters": {
            "processDate": { "type": "string" }
        },
        "concurrency": 1,
        "activities": [
            {
                "name": "Copy sales to staging",
                "type": "Copy",
                "policy": { "timeout": "0.02:00:00", "retry": 2, "retryIntervalInSeconds": 120 },
                "inputs": [
                    {
                        "referenceName": "ds_raw_sales_csv",
                        "type": "DatasetReference",
                        "parameters": { "folderDate": "@pipeline().parameters.processDate" }
                    }
                ],
                "outputs": [
                    { "referenceName": "ds_sql_staging_sales", "type": "DatasetReference" }
                ],
                "typeProperties": {
                    "source": {
                        "type": "DelimitedTextSource",
                        "storeSettings": {
                            "type": "AzureBlobStorageReadSettings",
                            "recursive": false,
                            "wildcardFileName": "*.csv"
                        },
                        "formatSettings": { "type": "DelimitedTextReadSettings" }
                    },
                    "sink": {
                        "type": "AzureSqlSink",
                        "preCopyScript": "TRUNCATE TABLE staging.Sales"
                    }
                }
            },
            {
                "name": "Merge staging into dbo",
                "type": "SqlServerStoredProcedure",
                "dependsOn": [
                    { "activity": "Copy sales to staging", "dependencyConditions": [ "Succeeded" ] }
                ],
                "linkedServiceName": { "referenceName": "ls_sql_reporting", "type": "LinkedServiceReference" },
                "typeProperties": {
                    "storedProcedureName": "dbo.usp_MergeSales",
                    "storedProcedureParameters": {
                        "LoadDate": { "value": "@pipeline().parameters.processDate", "type": "DateTime" }
                    }
                }
            }
        ]
    }
}
```

A few choices in there are deliberate:

- **`preCopyScript` truncates staging.** It runs [once per copy run](https://learn.microsoft.com/azure/data-factory/connector-azure-sql-database#azure-sql-database-as-the-sink), so a retry or a rerun always starts from an empty staging table. The copy is never asked to be clever. It just loads.
- **The merge lives in T-SQL.** `dbo.usp_MergeSales` (below) deletes and reinserts the rows for `@LoadDate` inside a transaction. Keeping that logic in the database means it's testable, versioned with the schema, and readable by whoever inherits it.
- **`concurrency: 1`.** One staging table means two overlapping runs would trample each other. Limiting the pipeline to one run at a time queues the second instead.
- **Retries on the copy, not the merge.** Transient storage or network blips are worth retrying automatically. A failed merge usually means bad data, and retrying it twice just delays the alert.

The tables and procedure the pipeline depends on are small. The staging table mirrors the CSV columns, and the procedure replaces one day's rows in a single transaction. Swap in your own columns; the shape is what matters:

```sql
CREATE SCHEMA staging;
GO

CREATE TABLE staging.Sales (
    SaleId     int            NOT NULL,
    SaleDate   date           NOT NULL,
    CustomerId int            NOT NULL,
    Amount     decimal(18, 2) NOT NULL
);
GO

CREATE TABLE dbo.Sales (
    SaleId     int            NOT NULL PRIMARY KEY,
    SaleDate   date           NOT NULL,
    CustomerId int            NOT NULL,
    Amount     decimal(18, 2) NOT NULL
);
GO

CREATE PROCEDURE dbo.usp_MergeSales
    @LoadDate date
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;

    DELETE FROM dbo.Sales
    WHERE SaleDate = @LoadDate;

    INSERT INTO dbo.Sales (SaleId, SaleDate, CustomerId, Amount)
    SELECT SaleId, SaleDate, CustomerId, Amount
    FROM staging.Sales
    WHERE SaleDate = @LoadDate;

    COMMIT TRANSACTION;
END;
GO
```

`SET XACT_ABORT ON` means any error rolls the whole transaction back, so a failed merge leaves that day's existing rows exactly as they were. If rows for one business key can move between days, use a `MERGE` on `SaleId` instead of delete-and-insert by date. Grant the factory's database user `EXECUTE` on the procedure plus rights on the staging table (the truncate needs `ALTER` on `staging.Sales`).

### When not to do it this way

This truncate-and-merge pattern assumes a day's data fits comfortably in a staging table and that the files for a day arrive complete. If you're loading hundreds of millions of rows a day, the destination should probably be Azure Synapse Analytics (formerly SQL Data Warehouse) rather than Azure SQL Database. There I'd switch the Copy activity's sink from the default bulk insert to PolyBase or the `COPY` statement (currently in preview) and load straight into a staging table in the warehouse. If the transformation is heavier than a merge (joins across sources, derived columns, deduplication rules), a [mapping data flow](https://learn.microsoft.com/azure/data-factory/concepts-data-flow-overview) does that work on managed Spark. But data flows spin up a Spark cluster, which takes several minutes unless you pay to keep it warm with an Azure IR time-to-live, and are billed per vCore-hour, so I don't use them for a straight load like this one.

The arrival assumption matters just as much. If files land late or at irregular times, a fixed daily schedule will happily load half a day. A tumbling window trigger with a `delay` holds each window's run back until the stragglers have had time to arrive. A storage event trigger, which fires on `BlobCreated` and has been available since 2018, reacts to arrival directly. The trade-off is that it fires once per file, so with several files a day you'd load a partial day on the first one. I'd have the upstream system write a completion marker (an empty `_SUCCESS` file, say) and point the event trigger's filter at that file only.

## Schedule triggers run on UTC

To run it daily, attach a schedule trigger and pass the date in:

```json
{
    "name": "tr_daily_0600_aest",
    "properties": {
        "type": "ScheduleTrigger",
        "typeProperties": {
            "recurrence": {
                "frequency": "Day",
                "interval": 1,
                "startTime": "2020-08-16T20:00:00Z",
                "timeZone": "UTC"
            }
        },
        "pipelines": [
            {
                "pipelineReference": { "referenceName": "pl_load_sales_daily", "type": "PipelineReference" },
                "parameters": {
                    "processDate": "@formatDateTime(trigger().scheduledTime, 'yyyy-MM-dd')"
                }
            }
        ]
    }
}
```

The catch for anyone outside the UTC+0 world: [schedule triggers](https://learn.microsoft.com/azure/data-factory/how-to-create-schedule-trigger) are defined in UTC. 20:00 UTC is 6:00 am in Sydney right now, and the UTC date of that run is Sydney's "yesterday", which is why `processDate` comes straight from `scheduledTime`. When daylight saving starts on 4 October, the same trigger fires at 7:00 am local time. If the business cares about the exact hour, put a calendar reminder in for each clock change: stop the trigger (a started trigger can't be edited), move the run hour (`startTime`, or `schedule.hours`, from 20:00 to 19:00 UTC), and start it again. If the local hour has to be exact without that ritual, a Logic Apps Recurrence trigger does take a time zone and can call the pipeline through the Data Factory connector. Both are more work than a time zone setting would be, but either beats discovering the shift from a report that's an hour late.

The trigger also isn't the only way in. Because the date is a parameter, I can backfill a missed day with one manual run:

```powershell
Invoke-AzDataFactoryV2Pipeline `
    -ResourceGroupName "<your-resource-group>" `
    -DataFactoryName "<your-factory-name>" `
    -PipelineName "pl_load_sales_daily" `
    -Parameter @{ processDate = "2020-08-11" }
```

If backfilling ranges of days is a regular need, a tumbling window trigger is the better fit: it creates one run per window, including past windows, and you can rerun a specific window from the monitoring view.

## Source control from day one

I turn on [Git integration](https://learn.microsoft.com/azure/data-factory/source-control) (Azure Repos or GitHub) before building anything. You get branches, pull requests, and history for every pipeline. When you publish from the collaboration branch, Data Factory generates ARM templates in the `adf_publish` branch, and those are what you deploy to test and production. Building straight in "live mode" works for a demo, but then nothing records who changed a pipeline, or why. Parameterise linked services that differ per environment, such as the server name, so the same template deploys everywhere.

## Know when it failed

Data Factory only keeps pipeline run history for 45 days, and nobody checks the monitoring view at 6 am. At a minimum, I alert on the factory's `PipelineFailedRuns` metric:

```bash
az monitor metrics alert create \
    --name "adf-pipeline-failed" \
    --resource-group "<your-resource-group>" \
    --scopes "/subscriptions/<your-subscription-id>/resourceGroups/<your-resource-group>/providers/Microsoft.DataFactory/factories/<your-factory-name>" \
    --condition "total PipelineFailedRuns > 0" \
    --window-size 5m \
    --evaluation-frequency 5m \
    --action "<your-action-group-name>"
```

For anything longer-lived, send the factory's diagnostic logs to a Log Analytics workspace so run history survives the 45 days and you can query failure trends across pipelines.

## What I'd hold the line on

Data Factory makes the first pipeline easy to build, which is also why so many of them can't be rerun safely. If you keep only a few rules from this post, keep these: pass the date in as a parameter, make the load idempotent with truncate-and-merge, keep secrets out of the JSON with managed identity or Key Vault, and remember that schedule triggers run on UTC. Get those right and the next twenty pipelines are copies of this one with different names. If the raw landing zone keeps growing, pair it with a [Blob lifecycle policy](/blog/2020-08-08-azure-blob-storage-lifecycle/) so last year's CSVs stop costing Hot-tier rates.
