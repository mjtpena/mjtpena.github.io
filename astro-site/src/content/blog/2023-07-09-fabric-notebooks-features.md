---
title: "Fabric Notebooks: Features and Productivity Tips"
description: "Fabric Notebooks have some features I didn't notice until I'd been using them for a few weeks and wish someone had pointed out earlier. Inline data…"
author: Michael John Peña
draft: false
date: 2023-07-09
tags:
  - Microsoft Fabric
  - Notebooks
  - Data Engineering
  - Productivity
---

Fabric Notebooks have some features I didn't notice until I'd been using them for a few weeks and wish someone had pointed out earlier. Inline data visualisation — `display(df)` — renders a chart-capable table widget that lets you switch between table, bar chart, line chart, and scatter plot views without writing matplotlib code. The notebook scheduler lets you run a notebook on a recurring schedule (like a lightweight alternative to a pipeline for simple transformation jobs). Parameterised notebooks work similarly to ADF/Synapse parameterised notebooks: you mark a cell as the "parameters" cell and inject values at runtime from a calling pipeline or scheduled trigger. And the Git integration means your notebook file (.ipynb) can be committed to Azure DevOps alongside your other Fabric item definitions — version history, pull request review, the full engineering workflow.

## Notebook Basics

```python
# Fabric notebooks support multiple languages
# Default: PySpark

# Switch language per cell:
# %%sql    - SparkSQL
# %%scala  - Scala
# %%r      - R (SparkR)
# %%md     - Markdown
```

## Multi-Language Support

### PySpark (Default)

```python
# PySpark cell (default)
from pyspark.sql.functions import *

df = spark.read.table("sales")
result = df.groupBy("category").agg(sum("amount").alias("total"))
result.show()
```

### SQL Magic

```python
%%sql
-- SQL cell
SELECT
    category,
    SUM(amount) as total,
    COUNT(*) as count
FROM sales
GROUP BY category
ORDER BY total DESC
```

### Scala

```python
%%scala
// Scala cell
val df = spark.read.table("sales")
val result = df.groupBy("category")
    .agg(sum("amount").alias("total"))
result.show()
```

### R

```python
%%r
# R cell
library(SparkR)

df <- sql("SELECT * FROM sales")
summary <- summarize(groupBy(df, "category"),
                     total = sum(df$amount))
head(summary)
```

## Lakehouse Integration

```python
# When attached to a Lakehouse, you get direct access:

# Access Tables
df = spark.read.table("customers")

# Access Files
df = spark.read.csv("Files/raw/data.csv", header=True)

# Write to Tables
df.write.format("delta").saveAsTable("processed_customers")

# Write to Files
df.write.parquet("Files/output/data.parquet")

# The Lakehouse appears in the left panel for easy browsing
```

## Built-in Visualizations

```python
# Fabric notebooks include built-in visualizations
# After displaying a DataFrame, click the chart icon

df = spark.sql("""
    SELECT
        DATE_TRUNC('month', order_date) as month,
        SUM(amount) as total
    FROM sales
    GROUP BY DATE_TRUNC('month', order_date)
    ORDER BY month
""")

# Display with visualization options
display(df)

# Or use displayHTML for custom visualizations
displayHTML("""
<div style="font-size: 24px; color: green;">
    Custom HTML content here
</div>
""")
```

## Parameterization

```python
# Create parameters for notebook orchestration
# Parameters cell should be tagged with "parameters"

# Define default parameter values
start_date = "2023-01-01"
end_date = "2023-12-31"
input_table = "sales"
output_table = "sales_processed"

# Use parameters in your code
df = spark.sql(f"""
    SELECT * FROM {input_table}
    WHERE order_date BETWEEN '{start_date}' AND '{end_date}'
""")

df.write.format("delta").mode("overwrite").saveAsTable(output_table)

# When calling from a pipeline, parameters are passed:
# Notebook activity > Base parameters > Add parameters
```

## Notebook Scheduling

```python
# Schedule notebooks directly from the UI
# 1. Click "Schedule" in the toolbar
# 2. Configure schedule:

schedule_config = {
    "enabled": True,
    "frequency": "Daily",  # or Hourly, Weekly, etc.
    "time": "06:00",
    "timezone": "UTC",
    "start_date": "2023-07-01",
    "end_date": None,  # None for no end
    "retry": {
        "count": 3,
        "interval_minutes": 5
    }
}

# 3. Monitor runs in the "Run history" tab
```

## Running Child Notebooks

```python
# Call another notebook
result = dbutils.notebook.run(
    path="./child_notebook",
    timeout_seconds=300,
    arguments={"param1": "value1", "param2": "value2"}
)

print(f"Child notebook returned: {result}")

# In the child notebook, retrieve parameters:
param1 = dbutils.widgets.get("param1")
param2 = dbutils.widgets.get("param2")

# Return a value from child notebook
dbutils.notebook.exit("Success: processed 1000 rows")
```

## Notebook Utilities

```python
# MSSparkUtils - Fabric's utility library

# File system operations
mssparkutils.fs.ls("Files/")
mssparkutils.fs.cp("source", "destination")
mssparkutils.fs.rm("path", recurse=True)

# Credentials
token = mssparkutils.credentials.getToken("https://storage.azure.com/")

# Environment info
mssparkutils.env.getWorkspaceName()
mssparkutils.env.getLakehouseId()

# Notebook utilities
mssparkutils.notebook.run("./other_notebook", 300)
mssparkutils.notebook.exit("value")
```

## Session Management

```python
# Session configuration
# Fabric uses starter pools for fast startup

# View session info
print(f"Spark Version: {spark.version}")
print(f"Application ID: {spark.sparkContext.applicationId}")

# Session variables persist across cells
my_global_var = "This persists across cells"

# Stop session explicitly (if needed)
# spark.stop()  # Use carefully!
```

## Collaboration Features

```python
# 1. Comments
# Add comments to cells using the comment icon
# Team members can reply and resolve

# 2. Version history
# View all changes: File > Version history
# Restore previous versions if needed

# 3. Export options
# Export as: .ipynb, .py, HTML

# 4. Git integration
# Connect workspace to Git repo
# Sync notebooks with source control
```

## Performance Optimization

```python
# 1. Use display() for large DataFrames
# It automatically limits output

display(large_df)  # Shows 1000 rows max

# 2. Avoid collecting large DataFrames to driver
# Bad:
# data = df.collect()  # Brings all data to driver

# Good:
# df.limit(100).collect()  # Collect small samples

# 3. Cache intermediate results
df = spark.read.table("large_table")
df.cache()
df.count()  # Triggers caching

# Use cached DataFrame multiple times
summary1 = df.groupBy("col1").count()
summary2 = df.groupBy("col2").count()

df.unpersist()  # Release cache when done

# 4. Monitor execution
# Click on the Spark jobs link to see execution details
```

## Error Handling Patterns

```python
# Wrap cells in try-except for production notebooks
from pyspark.sql.utils import AnalysisException

try:
    # Main processing logic
    df = spark.read.table("input_table")
    processed = df.transform(my_transform_function)
    processed.write.saveAsTable("output_table")

    dbutils.notebook.exit("SUCCESS")

except AnalysisException as e:
    print(f"Data error: {e}")
    dbutils.notebook.exit(f"FAILED: {str(e)}")

except Exception as e:
    print(f"Unexpected error: {e}")
    raise  # Re-raise for pipeline to catch
```

## Notebook Best Practices

```python
# 1. Structure your notebook
"""
# Notebook Template

## 1. Configuration (tagged as "parameters")
## 2. Imports and Setup
## 3. Data Loading
## 4. Transformations
## 5. Validation
## 6. Output
## 7. Cleanup
"""

# 2. Document with markdown cells
"""
## Data Loading

This section loads data from the bronze layer
and applies initial filtering.

**Input**: bronze_sales table
**Output**: Filtered DataFrame with valid records
"""

# 3. Modular code with functions
def clean_data(df):
    """Remove nulls and duplicates"""
    return df.dropna().dropDuplicates()

def enrich_data(df):
    """Add computed columns"""
    return df.withColumn("processed_at", current_timestamp())

# 4. Use assertions for data quality
assert df.count() > 0, "Input DataFrame is empty"
assert "required_column" in df.columns, "Missing required column"
```

Tomorrow we'll explore data wrangling techniques in Fabric notebooks.

## Resources

- [Fabric Notebooks Documentation](https://learn.microsoft.com/en-us/fabric/data-engineering/notebook-overview)
- [MSSparkUtils](https://learn.microsoft.com/en-us/fabric/data-engineering/microsoft-spark-utilities)
- [Notebook Best Practices](https://learn.microsoft.com/en-us/fabric/data-engineering/notebook-best-practices)
