---
title: Databricks Notebooks - Collaborative Data Science and Engineering
author: Michael John Peña
draft: false
date: 2021-04-20
url: /blog/databricks-notebooks-collaborative-data-science/
tags:
  - Databricks
  - Notebooks
  - Data Science
  - Collaboration
  - Apache Spark

---

I wrote "2021-04-20-databricks-notebooks-collaborative-data-science" to share practical, production-minded guidance on this topic.

## Understanding Databricks Notebooks

Notebooks support multiple languages in a single document:

- **Python** - PySpark and pandas
- **Scala** - Native Spark
- **SQL** - Spark SQL
- **R** - SparkR and local R
- **Markdown** - Documentation

## Getting Started

### Creating a Notebook

```python
# Default Python cell
from pyspark.sql import functions as F

# Read data
df = spark.read.parquet("/mnt/data/sales")
display(df)
```

### Magic Commands

```python
# %sql - Run SQL
# %sql SELECT * FROM sales LIMIT 10

# %scala - Run Scala
# %scala val df = spark.read.parquet("/mnt/data/sales")

# %r - Run R
# %r library(SparkR); df <- read.df("/mnt/data/sales", source="parquet")

# %md - Markdown documentation
# %md ## Section Title
# This is documentation for the notebook.

# %run - Execute another notebook
# %run ./utils/common_functions

# %fs - File system operations
# %fs ls /mnt/data/

# %sh - Shell commands
# %sh pip install numpy
```

## Notebook Organization

### Structure for Data Projects

```python
# %md
# # Sales Analysis Pipeline
#
# **Author**: Data Team
# **Last Updated**: 2021-04-20
#
# ## Overview
# This notebook processes daily sales data and generates aggregated metrics.
#
# ## Contents
# 1. Configuration
# 2. Data Loading
# 3. Transformations
# 4. Analysis
# 5. Output
```

### Configuration Cell

```python
# Cell 1: Configuration
# %md ### 1. Configuration

# Parameters (can be overridden by widgets or job parameters)
dbutils.widgets.text("date", "2021-04-20", "Process Date")
dbutils.widgets.dropdown("environment", "dev", ["dev", "staging", "prod"], "Environment")

process_date = dbutils.widgets.get("date")
environment = dbutils.widgets.get("environment")

# Paths
config = {
    "dev": {
        "input_path": "/mnt/dev/raw/sales",
        "output_path": "/mnt/dev/curated/sales",
        "database": "dev_analytics"
    },
    "staging": {
        "input_path": "/mnt/staging/raw/sales",
        "output_path": "/mnt/staging/curated/sales",
        "database": "staging_analytics"
    },
    "prod": {
        "input_path": "/mnt/prod/raw/sales",
        "output_path": "/mnt/prod/curated/sales",
        "database": "prod_analytics"
    }
}

paths = config[environment]
print(f"Processing for date: {process_date}")
print(f"Environment: {environment}")
print(f"Input: {paths['input_path']}")
```

### Modular Functions

```python
# Cell 2: Helper Functions
# %md ### 2. Helper Functions

def validate_schema(df, expected_columns):
    """Validate DataFrame has expected columns."""
    missing = set(expected_columns) - set(df.columns)
    if missing:
        raise ValueError(f"Missing columns: {missing}")
    return df

def add_metadata(df, process_date, source_system):
    """Add metadata columns to DataFrame."""
    return df \
        .withColumn("_process_date", F.lit(process_date)) \
        .withColumn("_source_system", F.lit(source_system)) \
        .withColumn("_load_timestamp", F.current_timestamp())

def calculate_metrics(df):
    """Calculate standard metrics."""
    return df.agg(
        F.count("*").alias("row_count"),
        F.sum("amount").alias("total_amount"),
        F.avg("amount").alias("avg_amount"),
        F.min("date").alias("min_date"),
        F.max("date").alias("max_date")
    )
```

## Interactive Data Exploration

### Built-in Visualizations

```python
# Load sample data
df_sales = spark.read.parquet(f"{paths['input_path']}/date={process_date}")

# Display with built-in visualization
display(df_sales)

# Aggregated data displays better charts
df_by_category = df_sales.groupBy("category").agg(
    F.sum("amount").alias("total_sales"),
    F.count("*").alias("transaction_count")
)

# Click the chart icon to create bar chart, pie chart, etc.
display(df_by_category)
```

### Custom Visualizations

```python
# Using matplotlib
import matplotlib.pyplot as plt
import pandas as pd

# Convert to pandas for visualization (small datasets only)
pdf = df_by_category.toPandas()

fig, ax = plt.subplots(figsize=(10, 6))
ax.bar(pdf['category'], pdf['total_sales'])
ax.set_xlabel('Category')
ax.set_ylabel('Total Sales')
ax.set_title('Sales by Category')
plt.xticks(rotation=45)
display(fig)
```

### Plotly Visualizations

```python
import plotly.express as px

# Time series visualization
df_daily = df_sales.groupBy("date").agg(
    F.sum("amount").alias("daily_sales")
).orderBy("date").toPandas()

fig = px.line(df_daily, x='date', y='daily_sales',
              title='Daily Sales Trend')
fig.show()
```

## SQL Integration

```sql
-- %sql
-- Create temporary view for SQL analysis
CREATE OR REPLACE TEMP VIEW sales_view AS
SELECT * FROM parquet.`/mnt/data/sales`;

-- Analyze with SQL
SELECT
    category,
    COUNT(*) as transactions,
    SUM(amount) as total_revenue,
    AVG(amount) as avg_transaction
FROM sales_view
WHERE date >= '2021-04-01'
GROUP BY category
ORDER BY total_revenue DESC
```

## Widgets for Parameterization

```python
# Create widgets
dbutils.widgets.dropdown("region", "US", ["US", "EU", "APAC"])
dbutils.widgets.multiselect("categories", "Electronics", ["Electronics", "Clothing", "Food", "Home"])
dbutils.widgets.text("min_amount", "0")
dbutils.widgets.combobox("output_format", "delta", ["delta", "parquet", "csv"])

# Use widget values
region = dbutils.widgets.get("region")
categories = dbutils.widgets.get("categories").split(",")
min_amount = float(dbutils.widgets.get("min_amount"))

# Filter data based on widgets
df_filtered = df_sales \
    .filter(F.col("region") == region) \
    .filter(F.col("category").isin(categories)) \
    .filter(F.col("amount") >= min_amount)

display(df_filtered)

# Remove widgets when done
# dbutils.widgets.removeAll()
```

## Running Other Notebooks

### %run for Module Imports

```python
# %run ./includes/common_functions

# The above imports functions from another notebook
# Now you can use: clean_data(), transform_data(), etc.

df_cleaned = clean_data(df_raw)
df_transformed = transform_data(df_cleaned)
```

### dbutils.notebook.run for Orchestration

```python
# Run notebook with parameters
result = dbutils.notebook.run(
    path="./process_sales",
    timeout_seconds=3600,
    arguments={
        "date": process_date,
        "region": "US"
    }
)

print(f"Notebook result: {result}")

# Parallel execution with ThreadPoolExecutor
from concurrent.futures import ThreadPoolExecutor

def run_regional_notebook(region):
    return dbutils.notebook.run(
        "./process_regional_sales",
        3600,
        {"region": region, "date": process_date}
    )

regions = ["US", "EU", "APAC"]
with ThreadPoolExecutor(max_workers=3) as executor:
    results = list(executor.map(run_regional_notebook, regions))

for region, result in zip(regions, results):
    print(f"{region}: {result}")
```

## Error Handling and Logging

```python
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sales_pipeline")

try:
    # Load data
    logger.info(f"Loading data for {process_date}")
    df_raw = spark.read.parquet(f"{paths['input_path']}/date={process_date}")

    # Validate
    logger.info("Validating schema")
    expected_cols = ["order_id", "customer_id", "amount", "category"]
    df_validated = validate_schema(df_raw, expected_cols)

    # Transform
    logger.info("Applying transformations")
    df_transformed = transform_data(df_validated)

    # Write
    logger.info(f"Writing output to {paths['output_path']}")
    df_transformed.write \
        .mode("overwrite") \
        .partitionBy("category") \
        .format("delta") \
        .save(f"{paths['output_path']}/date={process_date}")

    # Return success
    metrics = calculate_metrics(df_transformed).collect()[0]
    result = {
        "status": "success",
        "rows_processed": metrics["row_count"],
        "total_amount": metrics["total_amount"]
    }

except Exception as e:
    logger.error(f"Pipeline failed: {str(e)}")
    result = {"status": "failed", "error": str(e)}
    raise

# Exit with result (for orchestration)
import json
dbutils.notebook.exit(json.dumps(result))
```

## Version Control Integration

### Repos Integration

```python
# %md
# ## Using Databricks Repos
#
# 1. Link your Git repository to Databricks Repos
# 2. Clone the repo to your workspace
# 3. Create a branch for development
# 4. Commit and push changes
# 5. Create pull request for review

# Access files from repos
# %run /Repos/username/project-name/src/common_functions
```

### Best Practices for Git

```python
# Structure notebooks for Git compatibility
# - Keep notebooks focused (single responsibility)
# - Use %run for shared code
# - Store configuration separately
# - Use widgets for environment-specific values

# .gitignore for Databricks
# .databricks/
# *.pyc
# __pycache__/
```

## Production Deployment

### Job Configuration

```python
# Notebook designed for job execution

# Accept job parameters
dbutils.widgets.text("date", "", "Process Date")
dbutils.widgets.text("env", "prod", "Environment")

date_param = dbutils.widgets.get("date")
if not date_param:
    # Use yesterday if not provided
    from datetime import datetime, timedelta
    date_param = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

env = dbutils.widgets.get("env")

# Run processing
result = main_processing(date_param, env)

# Exit for job tracking
dbutils.notebook.exit(result)
```

### Job Orchestration Notebook

```python
# %md # Daily Data Pipeline Orchestration

from datetime import datetime

process_date = datetime.now().strftime("%Y-%m-%d")
results = {}

# Stage 1: Ingestion
print("Stage 1: Ingestion")
results["ingestion"] = dbutils.notebook.run(
    "./01_ingestion",
    timeout_seconds=7200,
    arguments={"date": process_date}
)

# Stage 2: Transformation
print("Stage 2: Transformation")
results["transformation"] = dbutils.notebook.run(
    "./02_transformation",
    timeout_seconds=7200,
    arguments={"date": process_date}
)

# Stage 3: Aggregation
print("Stage 3: Aggregation")
results["aggregation"] = dbutils.notebook.run(
    "./03_aggregation",
    timeout_seconds=7200,
    arguments={"date": process_date}
)

# Summary
print("\n=== Pipeline Summary ===")
for stage, result in results.items():
    print(f"{stage}: {result}")
```

## Best Practices

1. **Use markdown cells** for documentation
2. **Create modular notebooks** - one responsibility each
3. **Parameterize with widgets** - enable reuse
4. **Use %run for shared code** - avoid duplication
5. **Handle errors gracefully** - log and return status
6. **Test interactively first** - then deploy as jobs
7. **Version control** - use Repos integration
8. **Monitor with logging** - track pipeline progress

## Conclusion

Databricks notebooks provide a powerful environment for collaborative data work. By combining interactive development with production-ready features like parameterization, orchestration, and version control, you can build robust data pipelines that are both easy to develop and maintain. The key is structuring your notebooks for both exploration and automated execution.

