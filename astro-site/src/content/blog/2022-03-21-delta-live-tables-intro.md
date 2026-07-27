---
title: "Delta Live Tables: Declarative Data Pipelines on Databricks"
author: Michael John Peña
draft: false
date: 2022-03-21
tags:
  - Azure
  - Databricks
  - Delta Live Tables
  - ETL
  - Data Engineering

---

I wrote "Delta Live Tables: Declarative Data Pipelines on Databricks" to share practical, production-minded guidance on this topic.

## The DLT Approach

Traditional ETL:
```python
# You manage: scheduling, dependencies, retries, state, incremental logic
df = spark.read.parquet("/source")
df_transformed = df.filter(...).groupBy(...).agg(...)
df_transformed.write.mode("append").saveAsTable("target")
```

Delta Live Tables:
```python
# You declare: what the output should be
@dlt.table
def target():
    return spark.read.parquet("/source").filter(...).groupBy(...).agg(...)
# DLT manages: everything else
```

## Creating Your First Pipeline

### Define Tables in a Notebook

```python
import dlt
from pyspark.sql.functions import col, current_timestamp

# Bronze layer: Raw ingestion
@dlt.table(
    comment="Raw sales data from source system",
    table_properties={"quality": "bronze"}
)
def raw_sales():
    return (
        spark.readStream
        .format("cloudFiles")
        .option("cloudFiles.format", "json")
        .option("cloudFiles.schemaLocation", "/schema/raw_sales")
        .load("/data/incoming/sales/")
    )

# Silver layer: Cleaned and standardized
@dlt.table(
    comment="Cleaned sales data with valid records only",
    table_properties={"quality": "silver"}
)
@dlt.expect_or_drop("valid_amount", "amount > 0")
@dlt.expect_or_drop("valid_date", "sale_date IS NOT NULL")
def cleaned_sales():
    return (
        dlt.read_stream("raw_sales")
        .select(
            col("transaction_id"),
            col("customer_id"),
            col("product_id"),
            col("amount").cast("decimal(10,2)"),
            col("sale_date").cast("date"),
            col("region")
        )
        .withColumn("processed_at", current_timestamp())
    )

# Gold layer: Business aggregates
@dlt.table(
    comment="Daily sales summary by region",
    table_properties={"quality": "gold"}
)
def daily_sales_summary():
    return (
        dlt.read("cleaned_sales")
        .groupBy("sale_date", "region")
        .agg(
            F.count("*").alias("transaction_count"),
            F.sum("amount").alias("total_revenue"),
            F.countDistinct("customer_id").alias("unique_customers")
        )
    )
```

### Create the Pipeline

```python
# Via API
pipeline_config = {
    "name": "sales-data-pipeline",
    "storage": "abfss://dlt@storage.dfs.core.windows.net/sales",
    "target": "production.sales",
    "libraries": [
        {"notebook": {"path": "/Production/DLT/sales_pipeline"}}
    ],
    "clusters": [
        {
            "label": "default",
            "autoscale": {
                "min_workers": 1,
                "max_workers": 5,
                "mode": "ENHANCED"
            }
        }
    ],
    "continuous": False,  # True for streaming
    "development": False,  # True for dev mode (no data persistence)
    "photon": True
}

response = requests.post(
    f"{workspace_url}/api/2.0/pipelines",
    headers=headers,
    json=pipeline_config
)

pipeline_id = response.json()["pipeline_id"]
```

## Data Quality Expectations

DLT provides built-in data quality enforcement:

```python
# Expect and warn (log violations but keep records)
@dlt.table
@dlt.expect("valid_email", "email RLIKE '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'")
def customers_with_warnings():
    return dlt.read_stream("raw_customers")

# Expect or drop (remove violating records)
@dlt.table
@dlt.expect_or_drop("positive_quantity", "quantity > 0")
@dlt.expect_or_drop("valid_product", "product_id IS NOT NULL")
def orders_clean():
    return dlt.read_stream("raw_orders")

# Expect or fail (stop pipeline on violation)
@dlt.table
@dlt.expect_or_fail("has_required_fields", "id IS NOT NULL AND timestamp IS NOT NULL")
def critical_data():
    return dlt.read_stream("raw_critical")

# Multiple expectations
@dlt.table
@dlt.expect_all({
    "valid_amount": "amount > 0 AND amount < 1000000",
    "valid_date": "transaction_date <= current_date()",
    "valid_customer": "customer_id IS NOT NULL"
})
def transactions_validated():
    return dlt.read_stream("raw_transactions")

# Expect all or drop
@dlt.table
@dlt.expect_all_or_drop({
    "rule1": "condition1",
    "rule2": "condition2"
})
def strict_table():
    return dlt.read_stream("source")
```

## Views vs Tables

```python
# Table: Materialized, persisted to storage
@dlt.table
def sales():
    return spark.read.table("raw_sales")

# View: Computed on-demand, not persisted
@dlt.view
def sales_view():
    return spark.read.table("raw_sales")

# Use views for:
# - Intermediate transformations
# - Shared logic between tables
# - Data that doesn't need to be persisted
```

## Streaming vs Batch

```python
# Streaming table (processes incrementally)
@dlt.table
def streaming_sales():
    return dlt.read_stream("raw_sales")  # read_stream

# Batch table (processes all data each run)
@dlt.table
def batch_summary():
    return dlt.read("cleaned_sales")  # read (not read_stream)

# Mixed: Stream from bronze, aggregate to gold
@dlt.table
def streaming_silver():
    return dlt.read_stream("bronze")  # Streaming

@dlt.table
def batch_gold():
    return (
        dlt.read("streaming_silver")  # Batch read of streaming table
        .groupBy("date")
        .agg(...)
    )
```

## Change Data Capture (CDC)

Handle CDC feeds with APPLY CHANGES:

```python
# Define target table
dlt.create_streaming_table("customers")

# Apply changes from CDC feed
dlt.apply_changes(
    target="customers",
    source="raw_cdc_customers",
    keys=["customer_id"],
    sequence_by="operation_timestamp",
    apply_as_deletes=expr("operation = 'DELETE'"),
    apply_as_truncates=expr("operation = 'TRUNCATE'"),
    except_column_list=["operation", "operation_timestamp"],
    stored_as_scd_type=2  # or 1 for overwrite
)

# The raw CDC table
@dlt.table
def raw_cdc_customers():
    return (
        spark.readStream
        .format("cloudFiles")
        .option("cloudFiles.format", "json")
        .load("/data/cdc/customers/")
    )
```

## Pipeline Monitoring

```python
# Get pipeline status
def get_pipeline_status(pipeline_id):
    response = requests.get(
        f"{workspace_url}/api/2.0/pipelines/{pipeline_id}",
        headers=headers
    )
    return response.json()

# List pipeline updates (runs)
def list_updates(pipeline_id):
    response = requests.get(
        f"{workspace_url}/api/2.0/pipelines/{pipeline_id}/updates",
        headers=headers
    )
    return response.json()

# Get update details
def get_update_details(pipeline_id, update_id):
    response = requests.get(
        f"{workspace_url}/api/2.0/pipelines/{pipeline_id}/updates/{update_id}",
        headers=headers
    )
    return response.json()

# Check data quality metrics
def get_quality_metrics(pipeline_id):
    # Query the system tables
    return spark.sql(f"""
        SELECT
            table_name,
            expectation_name,
            passed_records,
            failed_records,
            failed_records / (passed_records + failed_records) as failure_rate
        FROM system.live_tables.data_quality_log
        WHERE pipeline_id = '{pipeline_id}'
        ORDER BY timestamp DESC
    """)
```

## Error Handling

```python
# Graceful error handling in transformations
@dlt.table
def robust_processing():
    return (
        dlt.read_stream("source")
        .withColumn("parsed_json",
            F.when(
                F.json_tuple(col("raw_json"), "id").isNotNull(),
                F.from_json(col("raw_json"), schema)
            ).otherwise(F.lit(None))
        )
        .withColumn("has_error", col("parsed_json").isNull())
    )

# Quarantine pattern
@dlt.table
@dlt.expect_all_or_drop({"valid": "NOT has_error"})
def valid_records():
    return dlt.read_stream("robust_processing")

@dlt.table
def quarantine_records():
    return (
        dlt.read_stream("robust_processing")
        .filter("has_error")
    )
```

## Performance Optimization

```python
# Optimize table layout
@dlt.table(
    partition_cols=["date"],  # Partition by date
    table_properties={
        "delta.autoOptimize.optimizeWrite": "true",
        "delta.autoOptimize.autoCompact": "true",
        "pipelines.autoOptimize.zOrderCols": "customer_id"
    }
)
def optimized_sales():
    return dlt.read_stream("raw_sales")

# Use appropriate cluster sizing
cluster_config = {
    "autoscale": {
        "min_workers": 2,
        "max_workers": 10,
        "mode": "ENHANCED"  # Better auto-scaling for streaming
    }
}
```

## Development Workflow

```python
# Development mode: Test without persisting data
pipeline_config = {
    "name": "dev-pipeline",
    "development": True,  # Dev mode
    ...
}

# Validate pipeline without running
response = requests.post(
    f"{workspace_url}/api/2.0/pipelines/{pipeline_id}/updates",
    headers=headers,
    json={
        "full_refresh": False,
        "validate_only": True  # Just validate
    }
)

# Run with full refresh (reprocess all data)
response = requests.post(
    f"{workspace_url}/api/2.0/pipelines/{pipeline_id}/updates",
    headers=headers,
    json={"full_refresh": True}
)
```

## Connecting to Workflows

```python
# Trigger DLT from a workflow
workflow_task = {
    "task_key": "run_dlt_pipeline",
    "pipeline_task": {
        "pipeline_id": pipeline_id,
        "full_refresh": False
    }
}

# Wait for completion and check status
# DLT tasks automatically fail the workflow if the pipeline fails
```

## Best Practices

### Organize by Medallion Architecture

```
/DLT/
├── bronze/
│   ├── ingest_sales.py
│   ├── ingest_customers.py
│   └── ingest_products.py
├── silver/
│   ├── clean_sales.py
│   └── clean_customers.py
└── gold/
    ├── sales_summary.py
    └── customer_metrics.py
```

### Naming Conventions

```python
# Clear, consistent naming
@dlt.table(name="bronze_sales_raw")
def bronze_sales():
    ...

@dlt.table(name="silver_sales_cleaned")
def silver_sales():
    ...

@dlt.table(name="gold_daily_revenue")
def gold_revenue():
    ...
```

## Conclusion

Delta Live Tables transforms data engineering:
- Declarative syntax reduces boilerplate code
- Built-in data quality enforcement
- Automatic dependency management
- Simplified streaming and CDC
- Production-ready monitoring

DLT is particularly powerful for teams that want reliability without the complexity of managing traditional Spark streaming jobs.

## Resources

- [DLT Documentation](https://docs.databricks.com/delta-live-tables/index.html)
- [DLT Python Reference](https://docs.databricks.com/delta-live-tables/python-ref.html)
- [Data Quality with Expectations](https://docs.databricks.com/delta-live-tables/expectations.html)

