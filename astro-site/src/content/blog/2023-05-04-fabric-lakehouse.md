---
title: "Building with Fabric Lakehouse: The Best of Data Lakes and Warehouses"
author: Michael John Peña
draft: false
date: 2023-05-04
tags:
  - Microsoft Fabric
  - Lakehouse
  - Delta Lake
  - Data Engineering
  - Azure

---

I wrote "Building with Fabric Lakehouse: The Best of Data Lakes and Warehouses" to share practical, production-minded guidance on this topic.

## What is a Lakehouse?

A Lakehouse in Fabric is a unified storage artifact that provides:
- File storage for raw data (any format)
- Managed Delta tables for structured data
- Automatic SQL endpoint for T-SQL queries
- Direct integration with Spark, Power BI, and other Fabric workloads

```
┌─────────────────────────────────────────────────────┐
│                    Lakehouse                         │
├─────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐        │
│  │     Tables/      │  │     Files/       │        │
│  │  (Delta Lake)    │  │  (Any Format)    │        │
│  ├──────────────────┤  ├──────────────────┤        │
│  │ - customers      │  │ - raw/           │        │
│  │ - orders         │  │ - staging/       │        │
│  │ - products       │  │ - archive/       │        │
│  └──────────────────┘  └──────────────────┘        │
├─────────────────────────────────────────────────────┤
│              SQL Analytics Endpoint                  │
│           (Automatic T-SQL Access)                  │
└─────────────────────────────────────────────────────┘
```

## Creating a Lakehouse

```python
# Lakehouses are created in the Fabric portal
# Once created, you can access them from notebooks

# List available Lakehouses in your workspace
display(spark.catalog.listDatabases())

# The default database is your attached Lakehouse
spark.catalog.currentDatabase()
```

## Working with Tables

### Creating Tables from DataFrames

```python
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, DateType, DoubleType

# Define schema
schema = StructType([
    StructField("customer_id", StringType(), False),
    StructField("name", StringType(), True),
    StructField("email", StringType(), True),
    StructField("country", StringType(), True),
    StructField("created_date", DateType(), True)
])

# Create sample data
data = [
    ("C001", "Alice Johnson", "alice@example.com", "USA", "2023-01-15"),
    ("C002", "Bob Smith", "bob@example.com", "UK", "2023-02-20"),
    ("C003", "Carol White", "carol@example.com", "Australia", "2023-03-10")
]

df = spark.createDataFrame(data, schema)

# Write to Lakehouse Tables folder
df.write \
    .format("delta") \
    .mode("overwrite") \
    .saveAsTable("customers")

print("Table created successfully!")
```

### Reading and Querying Tables

```python
# Read using Spark SQL
customers_df = spark.sql("SELECT * FROM customers WHERE country = 'USA'")
display(customers_df)

# Read using DataFrame API
customers_df = spark.read.format("delta").table("customers")
customers_df.filter("country = 'USA'").show()
```

### Updating Data with MERGE

```python
from delta.tables import DeltaTable

# Source data with updates
updates_data = [
    ("C001", "Alice Johnson-Smith", "alice.new@example.com", "USA", "2023-01-15"),
    ("C004", "David Brown", "david@example.com", "Canada", "2023-05-01")
]
updates_df = spark.createDataFrame(updates_data, schema)

# Get reference to Delta table
customers_table = DeltaTable.forName(spark, "customers")

# Perform MERGE (upsert)
customers_table.alias("target") \
    .merge(updates_df.alias("source"), "target.customer_id = source.customer_id") \
    .whenMatchedUpdateAll() \
    .whenNotMatchedInsertAll() \
    .execute()

print("Merge completed!")
```

## Working with Files

### Loading Raw Files

```python
# Upload files to the Files/ folder via the Lakehouse UI
# Then read them in notebooks

# Read CSV from Files folder
raw_df = spark.read \
    .option("header", "true") \
    .option("inferSchema", "true") \
    .csv("Files/raw/sales_data.csv")

# Read JSON
json_df = spark.read.json("Files/raw/events/")

# Read Parquet
parquet_df = spark.read.parquet("Files/staging/processed/")
```

### Processing Pipeline

```python
from pyspark.sql.functions import col, to_date, year, month, sum as spark_sum

# 1. Read raw data
raw_sales = spark.read \
    .option("header", "true") \
    .csv("Files/raw/sales_2023.csv")

# 2. Clean and transform
cleaned_sales = raw_sales \
    .withColumn("sale_date", to_date(col("date"), "yyyy-MM-dd")) \
    .withColumn("amount", col("amount").cast("double")) \
    .withColumn("year", year(col("sale_date"))) \
    .withColumn("month", month(col("sale_date"))) \
    .filter(col("amount") > 0)

# 3. Write to Tables as Delta
cleaned_sales.write \
    .format("delta") \
    .mode("append") \
    .partitionBy("year", "month") \
    .saveAsTable("sales_facts")

# 4. Create aggregation
monthly_sales = cleaned_sales \
    .groupBy("year", "month") \
    .agg(spark_sum("amount").alias("total_sales"))

monthly_sales.write \
    .format("delta") \
    .mode("overwrite") \
    .saveAsTable("monthly_sales_summary")
```

## SQL Analytics Endpoint

Every Lakehouse automatically gets a SQL endpoint for T-SQL access:

```sql
-- Query Lakehouse tables using T-SQL
SELECT
    year,
    month,
    total_sales,
    LAG(total_sales) OVER (ORDER BY year, month) as prev_month_sales,
    total_sales - LAG(total_sales) OVER (ORDER BY year, month) as month_over_month
FROM monthly_sales_summary
ORDER BY year, month;

-- Create views for reporting
CREATE VIEW vw_sales_with_customers AS
SELECT
    s.*,
    c.name as customer_name,
    c.country
FROM sales_facts s
JOIN customers c ON s.customer_id = c.customer_id;
```

## Time Travel

Delta Lake supports time travel for auditing and recovery:

```python
# View table history
from delta.tables import DeltaTable

dt = DeltaTable.forName(spark, "customers")
display(dt.history())

# Read data as of a specific version
df_v1 = spark.read.format("delta") \
    .option("versionAsOf", 1) \
    .table("customers")

# Read data as of a specific timestamp
df_yesterday = spark.read.format("delta") \
    .option("timestampAsOf", "2023-05-03 10:00:00") \
    .table("customers")

# Restore to previous version
dt.restoreToVersion(1)
```

## Best Practices

### 1. Organize Your Lakehouse

```
lakehouse/
├── Tables/
│   ├── bronze/          # Raw data, minimal transformation
│   │   └── raw_sales
│   ├── silver/          # Cleaned, conformed data
│   │   └── sales_cleaned
│   └── gold/            # Business-level aggregations
│       └── sales_summary
└── Files/
    ├── landing/         # Initial file drops
    ├── staging/         # Temporary processing
    └── archive/         # Historical raw files
```

### 2. Use Appropriate Table Types

```python
# Managed Tables - Fabric manages the files
df.write.format("delta").saveAsTable("managed_table")

# External Tables - You control the location
df.write.format("delta").save("Files/custom_location/my_table")
spark.sql("CREATE TABLE external_table USING DELTA LOCATION 'Files/custom_location/my_table'")
```

### 3. Optimize for Performance

```python
# Partition large tables
df.write \
    .format("delta") \
    .partitionBy("year", "region") \
    .saveAsTable("large_sales")

# Optimize after bulk loads
spark.sql("OPTIMIZE large_sales")

# Z-order for common filter columns
spark.sql("OPTIMIZE large_sales ZORDER BY (customer_id)")
```

The Lakehouse is where most of your Fabric data engineering work will happen. Tomorrow, I will cover Data Factory in Fabric for orchestrating data movement and transformations.

## Resources

- [Lakehouse Tutorial](https://learn.microsoft.com/en-us/fabric/data-engineering/tutorial-lakehouse-introduction)
- [Delta Lake in Fabric](https://learn.microsoft.com/en-us/fabric/data-engineering/lakehouse-and-delta-tables)
- [SQL Analytics Endpoint](https://learn.microsoft.com/en-us/fabric/data-engineering/lakehouse-sql-analytics-endpoint)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
