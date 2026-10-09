---
title: "Building Data Pipelines with Microsoft Fabric Data Factory"
description: "Data Factory pipelines use a visual designer with activities that can be chained together."
author: Michael John Peña
draft: false
date: 2025-08-27
tags:
  - Microsoft Fabric
  - Data Factory
  - ETL
  - Data Pipelines
  - Data Engineering
---

## Creating a Basic Pipeline

Data Factory pipelines use a visual designer with activities that can be chained together.

```python
# Using the Fabric REST API to create a pipeline programmatically
import requests

pipeline_definition = {
    "name": "daily-sales-ingestion",
    "properties": {
        "activities": [
            {
                "name": "Copy Sales Data",
                "type": "Copy",
                "inputs": [
                    {
                        "referenceName": "AzureSqlSource",
                        "type": "DatasetReference"
                    }
                ],
                "outputs": [
                    {
                        "referenceName": "LakehouseDestination",
                        "type": "DatasetReference"
                    }
                ],
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": "SELECT * FROM sales WHERE date = '@{formatDateTime(pipeline().TriggerTime, 'yyyy-MM-dd')}'"
                    },
                    "sink": {
                        "type": "LakehouseSink",
                        "tableOption": "autoCreate"
                    }
                }
            },
            {
                "name": "Run Transformation Notebook",
                "type": "SparkNotebook",
                "dependsOn": [
                    {
                        "activity": "Copy Sales Data",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "notebook": {
                        "referenceName": "transform_sales",
                        "type": "NotebookReference"
                    },
                    "parameters": {
                        "process_date": {
                            "value": "@formatDateTime(pipeline().TriggerTime, 'yyyy-MM-dd')",
                            "type": "string"
                        }
                    }
                }
            }
        ]
    }
}
```

## Pipeline Parameters and Variables

Use parameters for configuration that changes between runs, and variables for values computed during execution.

```python
# In a Spark notebook triggered by the pipeline
process_date = notebookutils.notebook.getParameter("process_date")

df = spark.table("bronze.raw_sales") \
    .filter(f"date = '{process_date}'")

# Process the data
df_transformed = transform_sales(df)
df_transformed.write.format("delta").mode("append").saveAsTable("silver.sales")
```

## Scheduling and Triggers

Configure time-based triggers for regular execution or event-based triggers that respond to data arrival. Monitor pipeline runs through the Fabric monitoring hub for visibility into execution history and failures.
