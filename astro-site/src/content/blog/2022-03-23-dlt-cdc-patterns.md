---
title: "Change Data Capture with Delta Live Tables"
author: Michael John Peña
draft: false
date: 2022-03-23
tags:
  - Azure
  - Databricks
  - Delta Live Tables
  - CDC
  - Data Engineering

---

I wrote "Change Data Capture with Delta Live Tables" to share practical, production-minded guidance on this topic.

## Understanding CDC in DLT

CDC feeds typically contain:
- Operation type (insert, update, delete)
- Timestamp of the change
- Complete or partial row data

DLT's `apply_changes` function processes these into clean, current-state tables.

## Basic CDC Implementation

```python
import dlt
from pyspark.sql.functions import col, expr

# Ingest raw CDC data
@dlt.table(
    comment="Raw CDC events from source database"
)
def raw_customers_cdc():
    return (
        spark.readStream
        .format("cloudFiles")
        .option("cloudFiles.format", "json")
        .option("cloudFiles.schemaLocation", "/schema/customers_cdc")
        .load("/data/cdc/customers/")
    )

# Define target table (created by apply_changes)
dlt.create_streaming_table("customers")

# Apply changes
dlt.apply_changes(
    target="customers",
    source="raw_customers_cdc",
    keys=["customer_id"],
    sequence_by=col("operation_timestamp"),
    apply_as_deletes=expr("operation = 'DELETE'"),
    except_column_list=["operation", "operation_timestamp", "_rescued_data"]
)
```

## CDC Schema Patterns

### Operation in Separate Column

```python
# CDC format: {customer_id, name, email, operation, op_timestamp}
dlt.apply_changes(
    target="customers",
    source="cdc_customers",
    keys=["customer_id"],
    sequence_by="op_timestamp",
    apply_as_deletes=expr("operation = 'DELETE'"),
    except_column_list=["operation", "op_timestamp"]
)
```

### Debezium Format

```python
# Debezium CDC format with before/after
@dlt.table
def debezium_customers_parsed():
    return (
        dlt.read_stream("raw_debezium_events")
        .select(
            col("after.customer_id").alias("customer_id"),
            col("after.name").alias("name"),
            col("after.email").alias("email"),
            col("op").alias("operation"),
            col("ts_ms").alias("operation_timestamp")
        )
    )

dlt.create_streaming_table("customers")

dlt.apply_changes(
    target="customers",
    source="debezium_customers_parsed",
    keys=["customer_id"],
    sequence_by="operation_timestamp",
    apply_as_deletes=expr("operation = 'd'"),
    except_column_list=["operation", "operation_timestamp"]
)
```

### AWS DMS Format

```python
# AWS DMS format with Op column
@dlt.table
def dms_orders_parsed():
    return (
        dlt.read_stream("raw_dms_events")
        .withColumn("operation_type",
            F.when(col("Op") == "I", "INSERT")
            .when(col("Op") == "U", "UPDATE")
            .when(col("Op") == "D", "DELETE")
        )
    )

dlt.create_streaming_table("orders")

dlt.apply_changes(
    target="orders",
    source="dms_orders_parsed",
    keys=["order_id"],
    sequence_by="timestamp",
    apply_as_deletes=expr("operation_type = 'DELETE'"),
    except_column_list=["Op", "operation_type", "timestamp"]
)
```

## SCD Type 2 (History Tracking)

```python
# Create streaming table with SCD Type 2
dlt.create_streaming_table(
    "customers_history",
    table_properties={
        "pipelines.reset.allowed": "false"  # Preserve history on full refresh
    }
)

# Apply changes with SCD Type 2
dlt.apply_changes(
    target="customers_history",
    source="raw_customers_cdc",
    keys=["customer_id"],
    sequence_by="operation_timestamp",
    apply_as_deletes=expr("operation = 'DELETE'"),
    except_column_list=["operation", "operation_timestamp"],
    stored_as_scd_type=2  # Enable history tracking
)

# DLT automatically adds:
# - __START_AT: When this version became active
# - __END_AT: When this version was superseded (null for current)
```

### Querying SCD Type 2

```python
# Current records
@dlt.table
def customers_current():
    return (
        dlt.read("customers_history")
        .filter("__END_AT IS NULL")
    )

# Point-in-time query
@dlt.table
def customers_as_of_date():
    as_of_date = "2022-03-01"
    return (
        dlt.read("customers_history")
        .filter(f"__START_AT <= '{as_of_date}' AND (__END_AT > '{as_of_date}' OR __END_AT IS NULL)")
    )
```

## Handling Truncates

```python
# Handle TRUNCATE operations
dlt.apply_changes(
    target="products",
    source="products_cdc",
    keys=["product_id"],
    sequence_by="change_timestamp",
    apply_as_deletes=expr("operation = 'DELETE'"),
    apply_as_truncates=expr("operation = 'TRUNCATE'"),
    except_column_list=["operation", "change_timestamp"]
)
```

## Composite Keys

```python
# Multiple columns as primary key
dlt.apply_changes(
    target="order_items",
    source="order_items_cdc",
    keys=["order_id", "line_number"],  # Composite key
    sequence_by="change_timestamp",
    apply_as_deletes=expr("operation = 'DELETE'"),
    except_column_list=["operation", "change_timestamp"]
)
```

## CDC from Multiple Sources

```python
# Merge CDC from multiple databases
@dlt.table
def unified_customers_cdc():
    east = (
        dlt.read_stream("cdc_customers_east")
        .withColumn("source_region", F.lit("EAST"))
    )

    west = (
        dlt.read_stream("cdc_customers_west")
        .withColumn("source_region", F.lit("WEST"))
    )

    return east.union(west)

dlt.create_streaming_table("customers_unified")

dlt.apply_changes(
    target="customers_unified",
    source="unified_customers_cdc",
    keys=["customer_id", "source_region"],  # Include region in key
    sequence_by="operation_timestamp",
    apply_as_deletes=expr("operation = 'DELETE'"),
    except_column_list=["operation", "operation_timestamp"]
)
```

## Error Handling in CDC

```python
# Validate CDC data before applying
@dlt.table
@dlt.expect_or_drop("valid_operation", "operation IN ('INSERT', 'UPDATE', 'DELETE')")
@dlt.expect_or_drop("has_timestamp", "operation_timestamp IS NOT NULL")
@dlt.expect_or_drop("has_key", "customer_id IS NOT NULL")
def validated_customers_cdc():
    return dlt.read_stream("raw_customers_cdc")

# Apply changes to validated data
dlt.create_streaming_table("customers")

dlt.apply_changes(
    target="customers",
    source="validated_customers_cdc",
    keys=["customer_id"],
    sequence_by="operation_timestamp",
    apply_as_deletes=expr("operation = 'DELETE'"),
    except_column_list=["operation", "operation_timestamp"]
)
```

## Handling Late-Arriving Data

```python
# CDC events may arrive out of order
# sequence_by ensures correct ordering

dlt.apply_changes(
    target="orders",
    source="orders_cdc",
    keys=["order_id"],
    sequence_by="change_sequence_number",  # Use monotonic sequence
    # If an older change arrives after a newer one, it's ignored
    apply_as_deletes=expr("operation = 'DELETE'"),
    except_column_list=["operation", "change_sequence_number"]
)

# For timestamp-based ordering, ensure timestamps are precise
dlt.apply_changes(
    target="events",
    source="events_cdc",
    keys=["event_id"],
    sequence_by="event_timestamp_microseconds",  # High precision
    ...
)
```

## Monitoring CDC Processing

```python
# Create monitoring table
@dlt.table
def cdc_processing_stats():
    return spark.sql("""
        SELECT
            date(timestamp) as processing_date,
            flow_name,
            count(*) as update_count,
            sum(rows_affected) as total_rows_processed
        FROM system.live_tables.flow_progress_log
        WHERE pipeline_id = 'your-pipeline-id'
        AND flow_type = 'CDC'
        GROUP BY date(timestamp), flow_name
    """)
```

## Complete CDC Pipeline Example

```python
import dlt
from pyspark.sql.functions import col, expr, current_timestamp
import pyspark.sql.functions as F

# Bronze: Raw CDC ingestion
@dlt.table(
    comment="Raw CDC events from ERP system"
)
def bronze_erp_orders_cdc():
    return (
        spark.readStream
        .format("cloudFiles")
        .option("cloudFiles.format", "json")
        .option("cloudFiles.schemaLocation", "/schema/erp_orders")
        .load("/data/cdc/erp/orders/")
        .withColumn("ingestion_timestamp", current_timestamp())
    )

# Silver: Validated CDC
@dlt.table
@dlt.expect_or_drop("valid_order_id", "order_id IS NOT NULL")
@dlt.expect_or_drop("valid_timestamp", "change_timestamp IS NOT NULL")
@dlt.expect_or_drop("valid_operation", "operation IN ('I', 'U', 'D')")
def silver_orders_cdc():
    return (
        dlt.read_stream("bronze_erp_orders_cdc")
        .withColumn("operation_type",
            F.when(col("operation") == "I", "INSERT")
            .when(col("operation") == "U", "UPDATE")
            .when(col("operation") == "D", "DELETE")
        )
    )

# Silver: Current state table
dlt.create_streaming_table(
    "silver_orders_current",
    comment="Current state of orders from ERP"
)

dlt.apply_changes(
    target="silver_orders_current",
    source="silver_orders_cdc",
    keys=["order_id"],
    sequence_by="change_timestamp",
    apply_as_deletes=expr("operation_type = 'DELETE'"),
    except_column_list=["operation", "operation_type", "change_timestamp", "ingestion_timestamp"]
)

# Silver: History table (SCD Type 2)
dlt.create_streaming_table(
    "silver_orders_history",
    comment="Historical versions of orders"
)

dlt.apply_changes(
    target="silver_orders_history",
    source="silver_orders_cdc",
    keys=["order_id"],
    sequence_by="change_timestamp",
    apply_as_deletes=expr("operation_type = 'DELETE'"),
    stored_as_scd_type=2,
    except_column_list=["operation", "operation_type", "change_timestamp", "ingestion_timestamp"]
)

# Gold: Aggregated view
@dlt.table
def gold_daily_order_stats():
    return (
        dlt.read("silver_orders_current")
        .groupBy("order_date", "region")
        .agg(
            F.count("*").alias("order_count"),
            F.sum("total_amount").alias("total_revenue"),
            F.avg("total_amount").alias("avg_order_value")
        )
    )
```

## Best Practices

1. **Use monotonic sequences**: Prefer database sequence numbers over timestamps when available
2. **Validate before applying**: Use expectations to catch corrupt CDC data
3. **Handle deletes explicitly**: Always specify `apply_as_deletes`
4. **Consider SCD Type 2**: Use for audit requirements or point-in-time queries
5. **Monitor lag**: Track processing latency to ensure CDC is keeping up

## Conclusion

Delta Live Tables transforms CDC processing from complex merge logic into simple declarative statements. The `apply_changes` API handles:
- Insert/update/delete merging
- Out-of-order event handling
- SCD Type 2 history tracking
- Efficient incremental processing

This enables reliable, scalable CDC pipelines with minimal code.

## Resources

- [APPLY CHANGES API](https://docs.databricks.com/delta-live-tables/cdc.html)
- [CDC with Debezium](https://docs.databricks.com/structured-streaming/delta-lake.html)
- [SCD Type 2 in DLT](https://docs.databricks.com/delta-live-tables/scd-type-2.html)

