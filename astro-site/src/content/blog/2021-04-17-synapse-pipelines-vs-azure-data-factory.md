---
title: Synapse Pipelines vs Azure Data Factory - Making the Right Choice
description: "The Synapse Pipelines vs. ADF question comes up in almost every Synapse project I start. The honest answer depends on where the rest of your data platform…"
author: Michael John Peña
draft: false
date: 2021-04-17
url: /blog/synapse-pipelines-vs-azure-data-factory/
tags:
  - Azure
  - Synapse Analytics
  - Data Factory
  - ETL
  - Data Engineering
---

The Synapse Pipelines vs. ADF question comes up in almost every Synapse project I start. The honest answer depends on where the rest of your data platform lives. If you're building a complete Synapse workspace—Dedicated SQL pools, Spark pools, Serverless SQL, all in one workspace—then Synapse Pipelines is the natural orchestration layer because you call Spark notebooks and SQL scripts without leaving the workspace. If you have an existing ADF instance orchestrating a broader set of resources (non-Synapse databases, SAP, Salesforce, on-premises systems), keeping ADF as the orchestration hub and adding Synapse as a compute target is often cleaner. The pipeline functionality is almost identical; the data factory JSON definitions are interchangeable in many cases.

## Feature Comparison

### Core Capabilities

```yaml
Azure Data Factory:
  - Standalone ETL/ELT service
  - 90+ connectors
  - Data flows for transformations
  - CI/CD with Azure DevOps/GitHub
  - SSIS package execution
  - Self-hosted integration runtime
  - Pricing: Pay per activity run

Synapse Pipelines:
  - Integrated with Synapse workspace
  - Same 90+ connectors (shared codebase)
  - Data flows for transformations
  - CI/CD via Synapse Git integration
  - Spark notebook orchestration
  - SQL script orchestration
  - Pricing: Included with Synapse (with limits)
```

### Key Differences

| Feature | ADF | Synapse Pipelines |
|---------|-----|-------------------|
| Standalone service | Yes | No (part of Synapse) |
| Spark notebooks | Via Databricks | Native integration |
| SQL pools | External connection | Native integration |
| Workspace isolation | Per factory | Per workspace |
| Data Explorer | Via connection | Native integration |
| Power BI | Via connection | Native integration |
| Managed VNet | Available | Available |
| Private endpoints | Configurable | Workspace-wide |

## When to Use Azure Data Factory

### Scenario 1: Multi-Cloud/Hybrid Integration

```json
{
  "name": "MultiCloudPipeline",
  "activities": [
    {
      "name": "CopyFromAWS",
      "type": "Copy",
      "inputs": [{"referenceName": "S3Source"}],
      "outputs": [{"referenceName": "ADLSSink"}]
    },
    {
      "name": "CopyFromGCP",
      "type": "Copy",
      "inputs": [{"referenceName": "GCSSource"}],
      "outputs": [{"referenceName": "ADLSSink"}]
    },
    {
      "name": "CopyToSnowflake",
      "type": "Copy",
      "inputs": [{"referenceName": "ADLSSource"}],
      "outputs": [{"referenceName": "SnowflakeSink"}]
    }
  ]
}
```

### Scenario 2: Centralized Integration Hub

When you need to feed data to multiple analytics platforms:

```
                    ┌─────────────────┐
     Sources        │  Azure Data     │        Destinations
    ────────────>   │    Factory      │   ─────────────────>
                    │  (Central Hub)  │
    - On-premises   │                 │   - Synapse
    - SaaS apps     │                 │   - Databricks
    - Cloud DBs     │                 │   - Power BI
    - APIs          │                 │   - ML workspaces
                    └─────────────────┘
```

### Scenario 3: SSIS Migration

```json
{
  "name": "SSISPackageExecution",
  "type": "ExecuteSSISPackage",
  "typeProperties": {
    "packageLocation": {
      "type": "SSISDB",
      "packagePath": "MyFolder/MyProject/MyPackage.dtsx"
    },
    "connectVia": {
      "referenceName": "AzureSSISIR",
      "type": "IntegrationRuntimeReference"
    }
  }
}
```

## When to Use Synapse Pipelines

### Scenario 1: Unified Analytics Workspace

```json
{
  "name": "UnifiedAnalyticsPipeline",
  "activities": [
    {
      "name": "IngestRawData",
      "type": "Copy",
      "typeProperties": {
        "source": {"type": "SqlServerSource"},
        "sink": {"type": "ParquetSink"}
      }
    },
    {
      "name": "TransformWithSpark",
      "type": "SynapseNotebook",
      "typeProperties": {
        "notebook": {
          "referenceName": "TransformData",
          "type": "NotebookReference"
        },
        "parameters": {
          "inputPath": {"value": "@activity('IngestRawData').output.dataWritten"}
        }
      },
      "dependsOn": [{"activity": "IngestRawData"}]
    },
    {
      "name": "LoadToDWH",
      "type": "SqlPoolStoredProcedure",
      "typeProperties": {
        "storedProcedureName": "sp_LoadStagingToFact",
        "storedProcedureParameters": {
          "BatchId": {"value": "@pipeline().RunId"}
        }
      },
      "dependsOn": [{"activity": "TransformWithSpark"}]
    }
  ]
}
```

### Scenario 2: Spark-Heavy Workloads

```python
# Notebook activity in Synapse Pipeline
# This notebook is natively orchestrated

from pyspark.sql import SparkSession

# Parameters passed from pipeline
batch_date = spark.conf.get("spark.synapse.pipeline.batchDate")
input_path = spark.conf.get("spark.synapse.pipeline.inputPath")

# Read data from data lake
df = spark.read.parquet(f"abfss://raw@datalake.dfs.core.windows.net/{input_path}")

# Complex transformations
result = df.transform(clean_data) \
    .transform(enrich_data) \
    .transform(aggregate_data)

# Write to dedicated SQL pool
result.write \
    .synapsesql("dwh.fact_sales", Constants.INTERNAL) \
    .mode("append") \
    .save()

# Return metrics to pipeline
mssparkutils.notebook.exit({
    "recordsProcessed": result.count(),
    "batchDate": batch_date
})
```

### Scenario 3: Real-Time + Batch in One Workspace

```json
{
  "name": "HybridDataPipeline",
  "activities": [
    {
      "name": "BatchIngestion",
      "type": "Copy",
      "typeProperties": {
        "source": {"type": "AzureSqlSource"},
        "sink": {"type": "ParquetSink"}
      }
    },
    {
      "name": "StreamingJob",
      "type": "SynapseSparkJob",
      "typeProperties": {
        "sparkJob": {
          "referenceName": "StreamProcessor",
          "type": "SparkJobDefinitionReference"
        }
      }
    },
    {
      "name": "RefreshDataExplorer",
      "type": "AzureDataExplorerCommand",
      "typeProperties": {
        "command": ".set-or-append async StreamingData <| externaldata(col1:string) [@'https://...']"
      }
    }
  ]
}
```

## Migration Considerations

### From ADF to Synapse

```powershell
# Export ADF pipelines
$pipelines = Get-AzDataFactoryV2Pipeline `
    -ResourceGroupName "myRG" `
    -DataFactoryName "myADF"

foreach ($pipeline in $pipelines) {
    $json = $pipeline | ConvertTo-Json -Depth 10
    $json | Out-File "pipelines/$($pipeline.Name).json"
}

# Note: Manual review needed for:
# - Linked service connections
# - Integration runtime references
# - SSIS packages (not supported in Synapse)
# - Wrangling data flows (different in Synapse)
```

### Coexistence Pattern

```yaml
Architecture:
  ADF (Central Integration):
    - External source ingestion
    - Multi-destination routing
    - On-premises connectivity
    - SSIS workloads

  Synapse Pipelines (Analytics Processing):
    - Spark transformations
    - SQL pool operations
    - Analytics-specific ETL
    - Data science workflows

  Integration:
    - ADF triggers Synapse pipelines via REST
    - Shared ADLS Gen2 for data exchange
    - Unified monitoring via Azure Monitor
```

## Cost Comparison

### ADF Pricing

```yaml
Pricing Components:
  - Data movement: $0.25 per DIU-hour
  - Pipeline activities: $1.00 per 1000 runs
  - Data flows: $0.274 per vCore-hour

Example (100 GB daily):
  - Copy activities: ~$5/day
  - Pipeline orchestration: ~$1/day
  - Data flows (4 vCore, 2 hrs): ~$2.19/day
  Total: ~$250/month
```

### Synapse Pricing

```yaml
Pricing Components:
  - Pipeline activities: Included (first 500K/month free)
  - Data movement: $0.25 per DIU-hour (same as ADF)
  - Spark pools: $0.40 per vCore-hour (separate)
  - Dedicated SQL pools: Per DWU-hour

Example (100 GB daily):
  - Copy activities: ~$5/day
  - Pipeline runs: Often free (within limits)
  - Spark processing: Separate pool cost
  Total: Varies based on overall Synapse usage
```

## Decision Framework

```
Use Azure Data Factory when:
├── You need a standalone integration service
├── You're doing multi-cloud integration
├── You have significant SSIS workloads
├── You're feeding multiple analytics platforms
├── You need separate billing/governance
└── You don't need Synapse-specific features

Use Synapse Pipelines when:
├── You're already using Synapse Analytics
├── You have heavy Spark workloads
├── You want unified workspace experience
├── You need tight SQL pool integration
├── You want simplified networking/security
└── You're building a modern data warehouse
```

## Best Practices for Both

### Modular Pipeline Design

```json
{
  "name": "MasterPipeline",
  "activities": [
    {
      "name": "ExecuteIngestion",
      "type": "ExecutePipeline",
      "typeProperties": {
        "pipeline": {"referenceName": "IngestionPipeline"},
        "parameters": {"date": "@pipeline().parameters.processDate"}
      }
    },
    {
      "name": "ExecuteTransformation",
      "type": "ExecutePipeline",
      "typeProperties": {
        "pipeline": {"referenceName": "TransformationPipeline"}
      },
      "dependsOn": [{"activity": "ExecuteIngestion", "dependencyConditions": ["Succeeded"]}]
    }
  ]
}
```

### Parameterization

```json
{
  "name": "ParameterizedPipeline",
  "parameters": {
    "sourceSchema": {"type": "string", "defaultValue": "dbo"},
    "sourceTable": {"type": "string"},
    "sinkContainer": {"type": "string", "defaultValue": "raw"},
    "processDate": {"type": "string"}
  },
  "activities": [
    {
      "name": "DynamicCopy",
      "type": "Copy",
      "typeProperties": {
        "source": {
          "type": "AzureSqlSource",
          "sqlReaderQuery": "SELECT * FROM @{pipeline().parameters.sourceSchema}.@{pipeline().parameters.sourceTable}"
        }
      }
    }
  ]
}
```

## Conclusion

Both Azure Data Factory and Synapse Pipelines are powerful orchestration tools built on the same underlying technology. The choice depends on your overall architecture: use ADF for standalone integration needs and multi-platform scenarios, and use Synapse Pipelines when you want a unified analytics experience with tight integration to Spark and SQL pools. Many organizations successfully use both in a complementary pattern.
