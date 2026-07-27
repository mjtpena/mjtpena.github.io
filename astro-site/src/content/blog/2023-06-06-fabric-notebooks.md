---
title: "Fabric Notebooks: Interactive Data Engineering and Science"
author: Michael John Peña
draft: false
date: 2023-06-06
tags:
  - Microsoft Fabric
  - Notebooks
  - PySpark
  - Data Engineering
  - Jupyter

---

I wrote "Fabric Notebooks: Interactive Data Engineering and Science" to share practical, production-minded guidance on this topic.

## Notebook Fundamentals

Fabric notebooks support multiple languages and seamlessly integrate with Lakehouses:

```python
# Available languages in Fabric notebooks:
# - PySpark (default)
# - Spark SQL
# - Scala
# - R

# Magic commands for switching languages
# %%pyspark - PySpark (default)
# %%sql - Spark SQL
# %%scala - Scala
# %%r - R

# Notebook context
print(f"Spark version: {spark.version}")
print(f"Python version: {sys.version}")
print(f"Current user: {mssparkutils.credentials.getCurrentUser()}")
```

## Working with Lakehouses

```python
# Attach Lakehouse to notebook
# Done in Fabric UI: Add Lakehouse > Select Lakehouse

# Access default Lakehouse
# Tables appear in spark.catalog
spark.catalog.listTables()

# Read from attached Lakehouse
df = spark.read.format("delta").table("my_table")

# Write to attached Lakehouse
df.write.format("delta").mode("overwrite").saveAsTable("output_table")

# Access Files folder
files_df = spark.read.csv("Files/raw/data.csv", header=True)

# Access another Lakehouse with absolute path
other_df = spark.read.format("delta").load(
    "abfss://workspace@onelake.dfs.fabric.microsoft.com/OtherLakehouse.Lakehouse/Tables/table_name"
)
```

## Parameterized Notebooks

```python
# Cell 1: Define parameters (tagged as "parameters")
# Tag the cell in Fabric UI: View > Cell tags > parameters

# Parameters with defaults
input_table = "raw_sales"
output_table = "processed_sales"
process_date = "2023-06-06"
batch_size = 10000

# Cell 2: Use parameters
print(f"Processing {input_table} for date {process_date}")
print(f"Output to {output_table}")
print(f"Batch size: {batch_size}")
```

### Running Parameterized Notebooks from Pipeline

```json
{
  "name": "RunNotebookActivity",
  "type": "NotebookActivity",
  "typeProperties": {
    "notebook": {
      "referenceName": "ProcessSalesNotebook",
      "type": "NotebookReference"
    },
    "parameters": {
      "input_table": {
        "value": "raw_sales",
        "type": "String"
      },
      "output_table": {
        "value": "processed_sales",
        "type": "String"
      },
      "process_date": {
        "value": "@formatDateTime(utcNow(), 'yyyy-MM-dd')",
        "type": "Expression"
      }
    }
  }
}
```

## MSSparkUtils

```python
# Notebook utilities
from notebookutils import mssparkutils

# File system operations
mssparkutils.fs.ls("Files/")
mssparkutils.fs.mkdirs("Files/output/")
mssparkutils.fs.cp("Files/source.csv", "Files/backup/source.csv")
mssparkutils.fs.rm("Files/temp/", recurse=True)

# Read file content
content = mssparkutils.fs.head("Files/config.json", 1000)
print(content)

# Mount external storage (ADLS Gen2)
mssparkutils.fs.mount(
    "abfss://container@storage.dfs.core.windows.net/",
    "/mnt/external",
    {"linkedService": "ExternalStorageLinkedService"}
)

# Access mounted data
df = spark.read.csv("/mnt/external/data.csv")

# Unmount
mssparkutils.fs.unmount("/mnt/external")

# Credentials
token = mssparkutils.credentials.getToken("https://storage.azure.com/")
connection_string = mssparkutils.credentials.getConnectionStringOrCreds("KeyVaultLinkedService")

# Notebook orchestration
result = mssparkutils.notebook.run("./ChildNotebook", 600, {"param1": "value1"})
print(f"Child notebook result: {result}")

# Run multiple notebooks in parallel
mssparkutils.notebook.runMultiple([
    {"path": "./Notebook1", "params": {"p1": "v1"}},
    {"path": "./Notebook2", "params": {"p2": "v2"}}
])
```

## Data Visualization

```python
# Built-in visualization
df = spark.read.format("delta").table("sales_summary")
display(df)  # Interactive table with chart options

# Matplotlib
import matplotlib.pyplot as plt

pdf = df.toPandas()
plt.figure(figsize=(12, 6))
plt.bar(pdf['category'], pdf['total_sales'])
plt.xlabel('Category')
plt.ylabel('Sales')
plt.title('Sales by Category')
plt.xticks(rotation=45)
plt.tight_layout()
plt.show()

# Seaborn
import seaborn as sns

plt.figure(figsize=(10, 8))
sns.heatmap(
    pdf.pivot_table(values='sales', index='month', columns='category'),
    annot=True,
    fmt='.0f',
    cmap='YlOrRd'
)
plt.title('Sales Heatmap')
plt.show()

# Plotly (interactive)
import plotly.express as px

fig = px.line(pdf, x='date', y='sales', color='category', title='Sales Trend')
fig.show()
```

## Error Handling and Logging

```python
import logging
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def process_with_logging(df, process_name):
    """Process data with comprehensive logging"""
    start_time = datetime.now()
    logger.info(f"Starting {process_name}")
    logger.info(f"Input row count: {df.count()}")

    try:
        # Your processing logic
        result_df = df.transform(your_transformation)

        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()

        logger.info(f"Output row count: {result_df.count()}")
        logger.info(f"{process_name} completed in {duration:.2f} seconds")

        return result_df

    except Exception as e:
        logger.error(f"Error in {process_name}: {str(e)}")
        raise

# Usage
try:
    df = spark.read.format("delta").table("source_table")
    result = process_with_logging(df, "Sales Processing")
    result.write.format("delta").mode("overwrite").saveAsTable("output_table")
except Exception as e:
    logger.error(f"Pipeline failed: {e}")
    # Send alert, update status, etc.
    raise
```

## Testing in Notebooks

```python
# Unit testing patterns in notebooks

def test_transformation():
    """Test data transformation logic"""
    # Create test data
    test_data = [
        ("A", 100, "2023-01-01"),
        ("B", 200, "2023-01-02"),
        ("C", -50, "2023-01-03"),  # Invalid: negative amount
    ]
    test_df = spark.createDataFrame(test_data, ["product", "amount", "date"])

    # Apply transformation
    result_df = clean_sales_data(test_df)

    # Assertions
    assert result_df.count() == 2, "Should filter out negative amounts"
    assert "amount_cleaned" in result_df.columns, "Should have cleaned amount column"

    # Check specific values
    row = result_df.filter("product = 'A'").first()
    assert row["amount"] == 100, "Amount should be preserved"

    print("All tests passed!")

def test_aggregation():
    """Test aggregation logic"""
    test_data = [
        ("Electronics", 100),
        ("Electronics", 200),
        ("Clothing", 150),
    ]
    test_df = spark.createDataFrame(test_data, ["category", "amount"])

    result_df = aggregate_by_category(test_df)

    electronics_total = result_df.filter("category = 'Electronics'").first()["total"]
    assert electronics_total == 300, f"Expected 300, got {electronics_total}"

    print("Aggregation tests passed!")

# Run tests
test_transformation()
test_aggregation()
```

## Notebook Best Practices

```python
best_practices = {
    "organization": [
        "Use clear cell descriptions/markdown",
        "Group related code into sections",
        "Keep notebooks focused on one task",
        "Use meaningful variable names"
    ],
    "performance": [
        "Cache DataFrames used multiple times",
        "Use appropriate number of partitions",
        "Avoid collect() on large datasets",
        "Use broadcast for small lookup tables"
    ],
    "maintainability": [
        "Use parameterized notebooks",
        "Extract reusable functions to libraries",
        "Version control notebooks via Git integration",
        "Document assumptions and dependencies"
    ],
    "debugging": [
        "Use display() for intermediate results",
        "Check row counts at each step",
        "Use explain() to understand query plans",
        "Log key metrics and timings"
    ]
}

# Example: Caching
frequently_used_df = spark.read.format("delta").table("large_dimension")
frequently_used_df.cache()
# Use it multiple times...
frequently_used_df.unpersist()  # Clean up when done

# Example: Broadcast
from pyspark.sql.functions import broadcast

small_df = spark.read.format("delta").table("small_lookup")  # < 10MB
large_df = spark.read.format("delta").table("large_fact")

result = large_df.join(broadcast(small_df), "key_column")
```

Notebooks are the primary development environment in Fabric. Tomorrow, I will cover Fabric Pipelines for orchestration.

## Resources

- [Fabric Notebooks](https://learn.microsoft.com/en-us/fabric/data-engineering/how-to-use-notebook)
- [MSSparkUtils](https://learn.microsoft.com/en-us/fabric/data-engineering/microsoft-spark-utilities)
- [Notebook Visualization](https://learn.microsoft.com/en-us/fabric/data-engineering/notebook-visualization)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
