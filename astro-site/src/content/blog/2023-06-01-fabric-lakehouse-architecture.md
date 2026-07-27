---
title: "Microsoft Fabric Lakehouse Architecture: Deep Dive"
author: Michael John Peña
draft: false
date: 2023-06-01
tags:
  - Microsoft Fabric
  - Lakehouse
  - Data Architecture
  - Delta Lake
  - Azure
---

A week after Build 2023, I'm still unpacking what Microsoft Fabric actually means for how we design data platforms. The Lakehouse is the centrepiece — but it's not a lakehouse in the generic Databricks sense. In Fabric, a Lakehouse is a specific item with an opinionated structure: a Files section for raw and semi-structured data managed through OneLake, a Tables section that auto-registers Delta tables and exposes them via an auto-provisioned SQL analytics endpoint, and a Direct Lake connector that Power BI can use to query those Delta files at near-Import speed without copying data. Getting this architecture right matters enormously — confuse which tier data belongs in and you'll end up with performance surprises and governance gaps.

## Lakehouse Architecture Overview

The Fabric Lakehouse combines the flexibility of data lakes with the structure of data warehouses:

```
┌─────────────────────────────────────────────────────┐
│                 Fabric Lakehouse                     │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │           SQL Analytics Endpoint                ││
│  │  (Auto-generated T-SQL interface)              ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────┴───────────────────────────┐│
│  │              Apache Spark                        ││
│  │   (Notebooks, Jobs, Data Engineering)           ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────┴───────────────────────────┐│
│  │                Tables (Delta)                    ││
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐          ││
│  │  │ Table A │ │ Table B │ │ Table C │          ││
│  │  └─────────┘ └─────────┘ └─────────┘          ││
│  ├─────────────────────────────────────────────────┤│
│  │                Files (Any Format)               ││
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐          ││
│  │  │  CSV    │ │  JSON   │ │ Parquet │          ││
│  │  └─────────┘ └─────────┘ └─────────┘          ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────┴───────────────────────────┐│
│  │                   OneLake                        ││
│  │          (ADLS Gen2 Compatible)                 ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Medallion Architecture in Fabric

The medallion architecture (Bronze, Silver, Gold) is the recommended pattern:

```python
# Medallion architecture implementation
medallion_layers = {
    "bronze": {
        "purpose": "Raw data landing zone",
        "characteristics": [
            "Data as-is from source",
            "Append-only ingestion",
            "Schema-on-read",
            "Full history preservation"
        ],
        "tables": ["raw_sales", "raw_customers", "raw_products"]
    },
    "silver": {
        "purpose": "Cleansed and conformed data",
        "characteristics": [
            "Data quality applied",
            "Standardized schemas",
            "Deduplication",
            "Business keys established"
        ],
        "tables": ["clean_sales", "clean_customers", "clean_products"]
    },
    "gold": {
        "purpose": "Business-ready aggregations",
        "characteristics": [
            "Star schema design",
            "Pre-computed aggregations",
            "Optimized for BI",
            "Semantic layer ready"
        ],
        "tables": ["dim_customer", "dim_product", "fact_sales", "agg_daily_sales"]
    }
}
```

## Implementing Medallion Architecture

### Bronze Layer

```python
# Bronze layer: Raw data ingestion
from pyspark.sql.functions import current_timestamp, input_file_name, lit

def ingest_to_bronze(source_path: str, table_name: str, source_system: str):
    """Ingest raw data to bronze layer with metadata"""

    # Read raw data
    raw_df = spark.read \
        .option("header", "true") \
        .option("inferSchema", "true") \
        .csv(source_path)

    # Add metadata columns
    bronze_df = raw_df \
        .withColumn("_ingestion_timestamp", current_timestamp()) \
        .withColumn("_source_file", input_file_name()) \
        .withColumn("_source_system", lit(source_system))

    # Write to bronze table (append mode)
    bronze_df.write \
        .format("delta") \
        .mode("append") \
        .option("mergeSchema", "true") \
        .saveAsTable(f"bronze_{table_name}")

    return bronze_df.count()

# Ingest sales data
count = ingest_to_bronze(
    source_path="Files/landing/sales/*.csv",
    table_name="sales",
    source_system="pos_system"
)
print(f"Ingested {count} rows to bronze_sales")
```

### Silver Layer

```python
# Silver layer: Data cleansing and transformation
from pyspark.sql.functions import (
    col, when, trim, lower, upper,
    to_date, to_timestamp, regexp_replace,
    row_number, md5, concat_ws
)
from pyspark.sql.window import Window

def transform_to_silver(bronze_table: str, silver_table: str, business_key_cols: list):
    """Transform bronze data to silver with data quality"""

    # Read bronze data
    bronze_df = spark.read.format("delta").table(bronze_table)

    # Data quality transformations
    cleaned_df = bronze_df \
        .withColumn("customer_name", trim(col("customer_name"))) \
        .withColumn("email", lower(trim(col("email")))) \
        .withColumn("phone", regexp_replace(col("phone"), "[^0-9]", "")) \
        .withColumn("sale_date", to_date(col("sale_date"), "yyyy-MM-dd")) \
        .withColumn("amount", col("amount").cast("decimal(18,2)")) \
        .filter(col("amount").isNotNull()) \
        .filter(col("amount") > 0)

    # Generate business key
    cleaned_df = cleaned_df.withColumn(
        "_business_key",
        md5(concat_ws("||", *[col(c) for c in business_key_cols]))
    )

    # Deduplication (keep latest by ingestion timestamp)
    window = Window.partitionBy("_business_key").orderBy(col("_ingestion_timestamp").desc())
    deduped_df = cleaned_df \
        .withColumn("_row_num", row_number().over(window)) \
        .filter(col("_row_num") == 1) \
        .drop("_row_num")

    # Add silver metadata
    silver_df = deduped_df \
        .withColumn("_silver_timestamp", current_timestamp())

    # Write to silver (merge for updates)
    if spark.catalog.tableExists(silver_table):
        from delta.tables import DeltaTable

        delta_table = DeltaTable.forName(spark, silver_table)
        delta_table.alias("target") \
            .merge(silver_df.alias("source"), "target._business_key = source._business_key") \
            .whenMatchedUpdateAll() \
            .whenNotMatchedInsertAll() \
            .execute()
    else:
        silver_df.write \
            .format("delta") \
            .mode("overwrite") \
            .saveAsTable(silver_table)

    return silver_df.count()

# Transform sales
count = transform_to_silver(
    bronze_table="bronze_sales",
    silver_table="silver_sales",
    business_key_cols=["order_id", "product_id"]
)
print(f"Transformed {count} rows to silver_sales")
```

### Gold Layer

```python
# Gold layer: Business aggregations and dimensional modeling
from pyspark.sql.functions import sum as spark_sum, count, avg, min, max

def build_gold_layer():
    """Build gold layer with star schema"""

    # Dimension: Customer
    silver_customers = spark.read.format("delta").table("silver_customers")

    dim_customer = silver_customers.select(
        col("customer_id"),
        col("customer_name"),
        col("email"),
        col("phone"),
        col("address"),
        col("city"),
        col("state"),
        col("country"),
        col("segment"),
        col("_silver_timestamp").alias("last_updated")
    )

    dim_customer.write \
        .format("delta") \
        .mode("overwrite") \
        .saveAsTable("gold_dim_customer")

    # Dimension: Product
    silver_products = spark.read.format("delta").table("silver_products")

    dim_product = silver_products.select(
        col("product_id"),
        col("product_name"),
        col("category"),
        col("subcategory"),
        col("brand"),
        col("unit_price"),
        col("cost"),
        col("_silver_timestamp").alias("last_updated")
    )

    dim_product.write \
        .format("delta") \
        .mode("overwrite") \
        .saveAsTable("gold_dim_product")

    # Fact: Sales
    silver_sales = spark.read.format("delta").table("silver_sales")

    fact_sales = silver_sales.select(
        col("order_id"),
        col("order_line_id"),
        col("customer_id"),
        col("product_id"),
        col("sale_date"),
        col("quantity"),
        col("unit_price"),
        col("discount"),
        (col("quantity") * col("unit_price") * (1 - col("discount"))).alias("net_amount"),
        col("_silver_timestamp").alias("last_updated")
    )

    fact_sales.write \
        .format("delta") \
        .mode("overwrite") \
        .partitionBy("sale_date") \
        .saveAsTable("gold_fact_sales")

    # Aggregation: Daily Sales Summary
    daily_summary = silver_sales \
        .groupBy("sale_date", "product_id") \
        .agg(
            spark_sum((col("quantity") * col("unit_price") * (1 - col("discount")))).alias("total_sales"),
            spark_sum("quantity").alias("total_quantity"),
            count("order_id").alias("order_count"),
            avg("unit_price").alias("avg_price")
        )

    daily_summary.write \
        .format("delta") \
        .mode("overwrite") \
        .saveAsTable("gold_agg_daily_sales")

    print("Gold layer built successfully")

build_gold_layer()
```

## SQL Endpoint Access

```sql
-- The SQL endpoint automatically exposes gold tables
-- Query fact and dimension tables

SELECT
    d.sale_date,
    c.customer_name,
    c.segment,
    p.product_name,
    p.category,
    f.quantity,
    f.net_amount
FROM gold_fact_sales f
JOIN gold_dim_customer c ON f.customer_id = c.customer_id
JOIN gold_dim_product p ON f.product_id = p.product_id
WHERE f.sale_date >= '2023-01-01'
ORDER BY f.net_amount DESC
LIMIT 100;

-- Create views for common queries
CREATE VIEW vw_sales_by_segment AS
SELECT
    c.segment,
    YEAR(f.sale_date) as year,
    MONTH(f.sale_date) as month,
    SUM(f.net_amount) as total_sales,
    COUNT(DISTINCT f.order_id) as order_count,
    COUNT(DISTINCT f.customer_id) as customer_count
FROM gold_fact_sales f
JOIN gold_dim_customer c ON f.customer_id = c.customer_id
GROUP BY c.segment, YEAR(f.sale_date), MONTH(f.sale_date);
```

## Performance Optimization

```python
# Optimize Delta tables
def optimize_gold_tables():
    """Optimize gold layer tables for query performance"""

    gold_tables = ["gold_fact_sales", "gold_dim_customer", "gold_dim_product"]

    for table in gold_tables:
        # Compact small files
        spark.sql(f"OPTIMIZE {table}")

        # Z-order for common filter columns
        if table == "gold_fact_sales":
            spark.sql(f"OPTIMIZE {table} ZORDER BY (customer_id, product_id)")

        # Analyze table statistics
        spark.sql(f"ANALYZE TABLE {table} COMPUTE STATISTICS FOR ALL COLUMNS")

    # Vacuum old files (retain 7 days)
    for table in gold_tables:
        spark.sql(f"VACUUM {table} RETAIN 168 HOURS")

optimize_gold_tables()
```

The Lakehouse architecture provides the foundation for modern analytics in Fabric. Tomorrow, I will cover Delta Lake features in more depth.

## Resources

- [Lakehouse Tutorial](https://learn.microsoft.com/en-us/fabric/data-engineering/tutorial-lakehouse-introduction)
- [Medallion Architecture](https://learn.microsoft.com/en-us/fabric/onelake/onelake-medallion-lakehouse-architecture)
- [Delta Lake in Fabric](https://learn.microsoft.com/en-us/fabric/data-engineering/lakehouse-and-delta-tables)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
