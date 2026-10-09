---
title: "Fabric SDK: Python Development for Microsoft Fabric"
description: "The Microsoft Fabric SDK provides a Pythonic interface for working with Fabric services. This guide covers installation, configuration, and common…"
author: "Michael John Peña"
draft: false
date: 2024-04-09
tags: ["Microsoft Fabric", "Python", "SDK", "Data Engineering", "Development"]
---

The Microsoft Fabric SDK provides a Pythonic interface for working with Fabric services. This guide covers installation, configuration, and common development patterns.

## Getting Started

```bash
# Install the Fabric SDK
pip install semantic-link-sempy
pip install azure-identity
```

```python
# Basic setup
import sempy.fabric as fabric
from azure.identity import DefaultAzureCredential

# The SDK uses the current Fabric session when running in notebooks
# For external scripts, use service principal or interactive auth

# List workspaces
workspaces = fabric.list_workspaces()
print(workspaces)
```

## Working with Semantic Models

```python
import sempy.fabric as fabric
from sempy.fabric import FabricDataFrame

# List semantic models in workspace
models = fabric.list_datasets()
print(models)

# Read data from a semantic model using DAX
df = fabric.read_table(
    dataset="Sales Analysis",
    table="Sales"
)
print(df.head())

# Execute a DAX query
dax_query = """
EVALUATE
    SUMMARIZECOLUMNS(
        'Product'[Category],
        "Total Sales", SUM('Sales'[Amount]),
        "Order Count", COUNTROWS('Sales')
    )
"""

result = fabric.evaluate_dax(
    dataset="Sales Analysis",
    dax_string=dax_query
)
print(result)
```

## Lakehouse Operations

```python
from pyspark.sql import SparkSession
import sempy.fabric as fabric

# Get Spark session (in Fabric notebooks, this is preconfigured)
spark = SparkSession.builder.getOrCreate()

# List lakehouses
lakehouses = fabric.list_lakehouses()
print(lakehouses)

# Read from lakehouse table
df = spark.read.format("delta").load("Tables/sales_data")

# Write to lakehouse
df.write.format("delta").mode("overwrite").save("Tables/processed_sales")

# SQL access to lakehouse
spark.sql("SELECT * FROM lakehouse_name.sales_data LIMIT 10").show()
```

## Data Pipeline SDK

```python
import sempy.fabric as fabric

class PipelineRunner:
    """Helper class for running pipelines"""

    def __init__(self, workspace_name: str = None):
        self.workspace = workspace_name

    def list_pipelines(self):
        """List available pipelines"""
        return fabric.list_items(type="DataPipeline")

    def run_pipeline(
        self,
        pipeline_name: str,
        parameters: dict = None,
        wait: bool = True
    ):
        """Run a pipeline and optionally wait for completion"""

        # Use Fabric REST API for pipeline execution
        import requests
        from azure.identity import DefaultAzureCredential

        credential = DefaultAzureCredential()
        token = credential.get_token("https://api.fabric.microsoft.com/.default")

        headers = {
            "Authorization": f"Bearer {token.token}",
            "Content-Type": "application/json"
        }

        # Get workspace ID from current context or configuration
        workspace_id = fabric.get_workspace_id()

        url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items/{pipeline_name}/jobs/instances?jobType=Pipeline"

        response = requests.post(
            url,
            headers=headers,
            json={"executionData": {"parameters": parameters or {}}}
        )

        run_id = response.json().get("id")

        if wait:
            return self._wait_for_completion(pipeline_name, run_id)

        return run_id

    def _wait_for_completion(self, pipeline_name: str, run_id: str):
        """Wait for pipeline to complete"""
        import time

        while True:
            status = self._get_run_status(run_id)
            if status in ["Succeeded", "Failed", "Cancelled"]:
                return status
            time.sleep(30)

# Usage
runner = PipelineRunner()
pipelines = runner.list_pipelines()
```

## Semantic Link Integration

```python
import sempy.fabric as fabric
from sempy.fabric import FabricDataFrame
import pandas as pd

# Semantic Link enables bidirectional data flow
# between Python and semantic models

# Read from semantic model
sales_df = fabric.read_table("Sales Model", "FactSales")

# Perform Python analysis
sales_df['profit_margin'] = (
    (sales_df['revenue'] - sales_df['cost']) / sales_df['revenue']
)

# Calculate aggregations
summary = sales_df.groupby('product_category').agg({
    'revenue': 'sum',
    'cost': 'sum',
    'profit_margin': 'mean'
}).reset_index()

# Write back to semantic model (if configured)
# This enables scenarios where Python augments Power BI

# Create measures programmatically
measure_definition = {
    "name": "Profit Margin %",
    "expression": "DIVIDE(SUM(FactSales[Revenue]) - SUM(FactSales[Cost]), SUM(FactSales[Revenue]))",
    "formatString": "0.00%"
}
```

## Notebook Utilities

```python
# Fabric notebooks provide built-in utilities

# In Fabric Notebook environment
from notebookutils import mssparkutils

# File system operations
files = mssparkutils.fs.ls("Files/raw_data/")
for file in files:
    print(f"{file.name}: {file.size} bytes")

# Copy files
mssparkutils.fs.cp(
    "Files/source/data.parquet",
    "Files/destination/data.parquet"
)

# Credentials and secrets
secret = mssparkutils.credentials.getSecret(
    "https://keyvault-name.vault.azure.net/",
    "secret-name"
)

# Notebook orchestration
mssparkutils.notebook.run(
    "transform_data",
    timeout_seconds=300,
    arguments={"date": "2024-04-09"}
)

# Exit with value (for pipeline integration)
mssparkutils.notebook.exit("Success")
```

## Building a Data Processing Framework

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Optional
from pyspark.sql import DataFrame, SparkSession
import sempy.fabric as fabric

@dataclass
class ProcessingConfig:
    input_path: str
    output_table: str
    lakehouse: str
    transformations: List[str]

class DataProcessor(ABC):
    """Base class for data processors"""

    def __init__(self, spark: SparkSession):
        self.spark = spark

    @abstractmethod
    def transform(self, df: DataFrame) -> DataFrame:
        pass

    def process(self, config: ProcessingConfig):
        # Read input
        df = self.spark.read.format("delta").load(config.input_path)

        # Transform
        df = self.transform(df)

        # Write output
        df.write.format("delta").mode("overwrite").saveAsTable(
            f"{config.lakehouse}.{config.output_table}"
        )

        return df

class SalesProcessor(DataProcessor):
    """Process sales data"""

    def transform(self, df: DataFrame) -> DataFrame:
        from pyspark.sql.functions import col, sum, avg, when

        # Clean nulls
        df = df.na.fill({
            "quantity": 0,
            "discount": 0.0
        })

        # Calculate derived columns
        df = df.withColumn(
            "net_amount",
            col("amount") * (1 - col("discount"))
        )

        # Add quality flags
        df = df.withColumn(
            "is_valid",
            when(col("amount") > 0, True).otherwise(False)
        )

        return df

# Usage
spark = SparkSession.builder.getOrCreate()
processor = SalesProcessor(spark)

config = ProcessingConfig(
    input_path="Files/raw/sales/",
    output_table="clean_sales",
    lakehouse="analytics_lakehouse",
    transformations=["clean", "derive", "validate"]
)

result = processor.process(config)
print(f"Processed {result.count()} records")
```

## Error Handling and Logging

```python
import logging
from functools import wraps
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def log_execution(func):
    """Decorator to log function execution"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        start = datetime.now()
        logger.info(f"Starting {func.__name__}")

        try:
            result = func(*args, **kwargs)
            duration = (datetime.now() - start).total_seconds()
            logger.info(f"Completed {func.__name__} in {duration:.2f}s")
            return result
        except Exception as e:
            logger.error(f"Error in {func.__name__}: {str(e)}")
            raise

    return wrapper

@log_execution
def process_daily_data(date: str):
    """Example function with logging"""
    spark = SparkSession.builder.getOrCreate()

    # Read data
    df = spark.read.format("delta").load(f"Files/raw/sales/{date}/")

    # Process
    processed = df.filter(df.amount > 0)

    # Write
    processed.write.format("delta").mode("append").save("Tables/sales")

    return processed.count()
```

## Conclusion

The Fabric SDK provides a powerful Python interface for data engineering and analysis in Microsoft Fabric. Combine it with PySpark, Semantic Link, and notebook utilities for comprehensive analytics workflows.
