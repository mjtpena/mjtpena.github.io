---
title: "Creating Your First Fabric Lakehouse: Step-by-Step Guide"
author: Michael John Peña
draft: false
date: 2023-07-06
tags:
  - Microsoft Fabric
  - Lakehouse
  - Data Engineering
  - Delta Lake

---

I wrote "Creating Your First Fabric Lakehouse: Step-by-Step Guide" to share practical, production-minded guidance on this topic.

## What is a Fabric Lakehouse?

A Lakehouse combines the best of data lakes and data warehouses:

```python
lakehouse_characteristics = {
    "storage": {
        "format": "Delta Lake (Parquet + transaction log)",
        "location": "OneLake",
        "structure": "Files (unstructured) + Tables (structured)"
    },
    "compute": {
        "spark": "For data engineering",
        "sql": "Via SQL endpoint (auto-generated)"
    },
    "integration": {
        "power_bi": "DirectLake mode",
        "dataflows": "Direct output target",
        "pipelines": "Native activities"
    }
}
```

## Creating a Lakehouse

### Step 1: Navigate to Your Workspace

```
1. Go to app.fabric.microsoft.com
2. Select your Fabric-enabled workspace
3. Click "+ New"
4. Select "Lakehouse"
```

### Step 2: Configure the Lakehouse

```python
# Lakehouse settings
lakehouse_config = {
    "name": "sales_lakehouse",  # Use lowercase, underscores
    "description": "Sales data for analytics team"
}

# Naming conventions I recommend:
# - {domain}_lakehouse (e.g., sales_lakehouse)
# - {domain}_{layer}_lh (e.g., sales_bronze_lh)
# - Keep names short but descriptive
```

### Step 3: Understand the Structure

Once created, your Lakehouse has two main sections:

```
sales_lakehouse/
├── Files/          # Unstructured storage
│   ├── raw/        # Landing zone for raw files
│   ├── processed/  # Processed files
│   └── archive/    # Historical files
│
└── Tables/         # Managed Delta tables
    ├── customers/  # Delta table
    ├── orders/     # Delta table
    └── products/   # Delta table
```

## Loading Data into Your Lakehouse

### Method 1: Direct Upload

```python
# For small files (< 100MB)
# 1. Click "..." on Files folder
# 2. Select "Upload" > "Upload files"
# 3. Select files from your computer

# Good for:
# - Quick prototyping
# - Sample data
# - Configuration files
```

### Method 2: Notebook Ingestion

```python
# Create a notebook attached to your Lakehouse
# This gives you full Spark capabilities

# Read from external source
import requests
import json

# Example: Load from API
url = "https://api.example.com/data"
response = requests.get(url)
data = response.json()

# Convert to DataFrame
df = spark.createDataFrame(data)

# Save to Files (as raw JSON)
df.write.mode("overwrite").json("Files/raw/api_data")

# Or save directly to Tables (as Delta)
df.write.format("delta").mode("overwrite").saveAsTable("api_data")
```

### Method 3: Data Pipeline

```python
# Use Copy Activity for bulk data movement
# 1. Create a new Data Pipeline
# 2. Add Copy Data activity
# 3. Configure source (e.g., Azure SQL)
# 4. Configure destination (your Lakehouse)

# Pipeline configuration example:
copy_activity_config = {
    "source": {
        "type": "AzureSqlDatabase",
        "query": "SELECT * FROM Sales.Orders WHERE ModifiedDate > @{pipeline().parameters.watermark}"
    },
    "sink": {
        "type": "Lakehouse",
        "tableOption": "Tables/orders",
        "format": "Delta"
    }
}
```

## Working with the Files Section

The Files section is for unstructured or semi-structured data:

```python
# Create folder structure
dbutils.fs.mkdirs("Files/raw/sales/2023/07")
dbutils.fs.mkdirs("Files/raw/inventory")
dbutils.fs.mkdirs("Files/processed")
dbutils.fs.mkdirs("Files/archive")

# Upload files from notebook
# Copy local file to Lakehouse
dbutils.fs.cp("file:/tmp/data.csv", "Files/raw/sales/data.csv")

# List files
files = dbutils.fs.ls("Files/raw/sales/")
for f in files:
    print(f"{f.name}: {f.size} bytes")
```

## Working with the Tables Section

Tables are managed Delta Lake tables:

```python
# Method 1: Create table from DataFrame
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, DoubleType

schema = StructType([
    StructField("customer_id", IntegerType(), False),
    StructField("name", StringType(), True),
    StructField("email", StringType(), True),
    StructField("segment", StringType(), True)
])

data = [
    (1, "Alice Smith", "alice@example.com", "Enterprise"),
    (2, "Bob Jones", "bob@example.com", "SMB"),
    (3, "Carol White", "carol@example.com", "Enterprise")
]

df = spark.createDataFrame(data, schema)
df.write.format("delta").mode("overwrite").saveAsTable("customers")

# Method 2: Create table with SQL
spark.sql("""
    CREATE TABLE IF NOT EXISTS orders (
        order_id INT,
        customer_id INT,
        order_date DATE,
        total_amount DOUBLE
    )
    USING DELTA
""")

# Method 3: Load from Files to Tables
raw_df = spark.read.format("csv") \
    .option("header", "true") \
    .option("inferSchema", "true") \
    .load("Files/raw/sales/*.csv")

raw_df.write.format("delta").mode("overwrite").saveAsTable("sales_raw")
```

## The SQL Endpoint

Every Lakehouse automatically gets a SQL endpoint:

```sql
-- Access via the SQL endpoint view
-- Tables appear as database objects

-- Query your Delta tables
SELECT
    c.name,
    c.segment,
    COUNT(o.order_id) as order_count,
    SUM(o.total_amount) as total_spend
FROM customers c
LEFT JOIN orders o ON c.customer_id = o.customer_id
GROUP BY c.name, c.segment
ORDER BY total_spend DESC;

-- Create views
CREATE VIEW vw_customer_summary AS
SELECT
    customer_id,
    name,
    segment,
    created_date
FROM customers
WHERE segment = 'Enterprise';
```

## Lakehouse Best Practices

```python
# 1. Organize Files with purpose
recommended_structure = """
Files/
├── landing/       # Raw data arrives here
├── raw/           # Preserved raw data
├── staging/       # Intermediate processing
├── processed/     # Final file outputs
├── archive/       # Historical data
└── reference/     # Reference/lookup files
"""

# 2. Use consistent table naming
table_naming = {
    "raw_*": "Raw ingested data",
    "stg_*": "Staging/intermediate tables",
    "dim_*": "Dimension tables",
    "fact_*": "Fact tables",
    "rpt_*": "Reporting/aggregated tables"
}

# 3. Partition large tables
df.write \
    .format("delta") \
    .mode("overwrite") \
    .partitionBy("year", "month") \
    .saveAsTable("sales_partitioned")

# 4. Optimize table storage
spark.sql("OPTIMIZE sales_partitioned")
spark.sql("VACUUM sales_partitioned RETAIN 168 HOURS")
```

## Connecting Power BI

```python
# Power BI connects via DirectLake for best performance
# 1. In Power BI Desktop or Service
# 2. Get Data > Fabric Lakehouse
# 3. Select your workspace and Lakehouse
# 4. Choose tables to load

# DirectLake benefits:
# - No data import (reads directly from Delta)
# - Near real-time refresh
# - Reduced storage costs
```

## Monitoring Your Lakehouse

```python
# Check table details
spark.sql("DESCRIBE DETAIL customers").show()

# View table history
spark.sql("DESCRIBE HISTORY customers").show()

# Check storage usage
files_info = dbutils.fs.ls("Tables/customers/")
total_size = sum(f.size for f in files_info if not f.name.startswith("_"))
print(f"Table size: {total_size / 1024 / 1024:.2f} MB")
```

Tomorrow we'll dive deeper into Delta tables in Fabric and explore their unique capabilities.

## Resources

- [Lakehouse Overview](https://learn.microsoft.com/en-us/fabric/data-engineering/lakehouse-overview)
- [Lakehouse Tutorial](https://learn.microsoft.com/en-us/fabric/data-engineering/tutorial-lakehouse-get-started)
- [Delta Lake in Fabric](https://learn.microsoft.com/en-us/fabric/data-engineering/delta-lake)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
