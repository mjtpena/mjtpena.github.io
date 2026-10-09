---
title: "Materialized Views in Delta Live Tables"
author: Michael John Peña
draft: false
date: 2022-03-25
tags:
  - Azure
  - Databricks
  - Delta Live Tables
  - Materialized Views
  - Data Engineering
---

## Understanding Materialized Views

```python
import dlt

# Materialized view: Query results stored as Delta table
# Refreshes when pipeline runs
@dlt.table
def mv_daily_sales():
    return (
        dlt.read("silver_sales")  # batch read
        .groupBy("sale_date", "region")
        .agg(
            F.sum("amount").alias("total_revenue"),
            F.count("*").alias("transaction_count")
        )
    )

# View (not materialized): Computed on-demand
@dlt.view
def v_daily_sales():
    return (
        dlt.read("silver_sales")
        .groupBy("sale_date", "region")
        .agg(...)
    )
```

## Creating Materialized Views

### Basic Aggregations

```python
@dlt.table(
    comment="Daily revenue by product category",
    table_properties={"quality": "gold"}
)
def mv_revenue_by_category():
    return (
        dlt.read("silver_orders")
        .groupBy("order_date", "category")
        .agg(
            F.sum("total_amount").alias("revenue"),
            F.count("*").alias("order_count"),
            F.countDistinct("customer_id").alias("unique_customers")
        )
    )
```

### Complex Joins and Calculations

```python
@dlt.table
def mv_customer_360():
    orders = dlt.read("silver_orders")
    customers = dlt.read("silver_customers")
    support = dlt.read("silver_support_tickets")

    return (
        customers
        .join(
            orders.groupBy("customer_id").agg(
                F.count("*").alias("order_count"),
                F.sum("total_amount").alias("lifetime_value"),
                F.avg("total_amount").alias("avg_order_value"),
                F.max("order_date").alias("last_order_date")
            ),
            "customer_id",
            "left"
        )
        .join(
            support.groupBy("customer_id").agg(
                F.count("*").alias("ticket_count"),
                F.avg("resolution_time_hours").alias("avg_resolution_time")
            ),
            "customer_id",
            "left"
        )
        .withColumn("customer_segment",
            F.when(col("lifetime_value") > 10000, "platinum")
            .when(col("lifetime_value") > 5000, "gold")
            .when(col("lifetime_value") > 1000, "silver")
            .otherwise("bronze")
        )
    )
```

### Running Totals and Window Functions

```python
@dlt.table
def mv_running_sales():
    return (
        dlt.read("silver_sales")
        .groupBy("sale_date", "product_id")
        .agg(F.sum("amount").alias("daily_revenue"))
        .withColumn("running_total",
            F.sum("daily_revenue").over(
                Window.partitionBy("product_id")
                .orderBy("sale_date")
                .rowsBetween(Window.unboundedPreceding, Window.currentRow)
            )
        )
        .withColumn("7day_avg",
            F.avg("daily_revenue").over(
                Window.partitionBy("product_id")
                .orderBy("sale_date")
                .rowsBetween(-6, 0)
            )
        )
    )
```

## Incremental Materialized Views

For large datasets, use streaming to incrementally update:

```python
# Incremental update via streaming
@dlt.table
def mv_hourly_metrics_incremental():
    return (
        dlt.read_stream("silver_events")  # Streaming source
        .withWatermark("event_time", "1 hour")
        .groupBy(
            window("event_time", "1 hour"),
            "event_type"
        )
        .agg(
            F.count("*").alias("event_count"),
            F.approx_count_distinct("user_id").alias("approx_users")
        )
    )

# Full recompute (use read, not read_stream)
@dlt.table
def mv_monthly_summary():
    return (
        dlt.read("silver_events")  # Full read
        .groupBy(F.date_trunc("month", "event_time").alias("month"))
        .agg(F.count("*").alias("total_events"))
    )
```

## Performance Optimization

### Partitioning

```python
@dlt.table(
    partition_cols=["year", "month"],
    table_properties={
        "delta.autoOptimize.optimizeWrite": "true",
        "delta.autoOptimize.autoCompact": "true"
    }
)
def mv_partitioned_metrics():
    return (
        dlt.read("silver_data")
        .withColumn("year", F.year("event_date"))
        .withColumn("month", F.month("event_date"))
        .groupBy("year", "month", "category")
        .agg(F.sum("value").alias("total"))
    )
```

### Z-Ordering

```python
@dlt.table(
    table_properties={
        "pipelines.autoOptimize.zOrderCols": "customer_id,product_id"
    }
)
def mv_optimized_for_lookup():
    return (
        dlt.read("silver_transactions")
        .groupBy("customer_id", "product_id")
        .agg(
            F.count("*").alias("purchase_count"),
            F.sum("amount").alias("total_spent")
        )
    )
```

### Caching Frequently Used Views

```python
@dlt.table(
    table_properties={
        "delta.dataSkippingNumIndexedCols": "32"  # Index more columns
    }
)
def mv_frequently_queried():
    return (
        dlt.read("silver_data")
        .groupBy("dim1", "dim2", "dim3")
        .agg(...)
    )
```

## Views vs Materialized Views

```python
# View: Not persisted, computed on read
# Use when: Data is small, freshness is critical, transformation is simple
@dlt.view
def v_current_inventory():
    return (
        dlt.read("silver_inventory")
        .filter("quantity > 0")
    )

# Materialized View: Persisted, computed on write
# Use when: Query is expensive, data is large, some latency is acceptable
@dlt.table
def mv_inventory_summary():
    return (
        dlt.read("silver_inventory")
        .groupBy("warehouse", "category")
        .agg(
            F.sum("quantity").alias("total_quantity"),
            F.sum(F.expr("quantity * unit_cost")).alias("total_value")
        )
    )
```

## Refresh Strategies

### Full Refresh

```python
# Entire materialized view is recomputed
# Use for: Complex transformations, smaller datasets

@dlt.table
def mv_full_refresh():
    return dlt.read("source").groupBy(...).agg(...)

# Triggered by pipeline update or schedule
```

### Incremental Refresh

```python
# Only new data is processed
# Use for: Large datasets, append-only sources

@dlt.table
def mv_incremental():
    return dlt.read_stream("source").groupBy(...).agg(...)
```

### Conditional Refresh

```python
# Refresh only if conditions are met
@dlt.table
def mv_conditional():
    # Check if refresh is needed
    last_refresh = spark.sql("SELECT MAX(refresh_time) FROM meta.refresh_log")

    source = dlt.read("silver_data")

    # Only include data since last refresh
    if last_refresh:
        source = source.filter(f"updated_at > '{last_refresh}'")

    return source.groupBy(...).agg(...)
```

## Layered Materialized Views

```python
# First level: Detailed aggregation
@dlt.table
def mv_hourly_metrics():
    return (
        dlt.read_stream("silver_events")
        .withWatermark("event_time", "2 hours")
        .groupBy(
            window("event_time", "1 hour"),
            "category",
            "region"
        )
        .agg(
            F.count("*").alias("event_count"),
            F.sum("value").alias("total_value")
        )
    )

# Second level: Rollup from first level
@dlt.table
def mv_daily_metrics():
    return (
        dlt.read("mv_hourly_metrics")
        .groupBy(
            F.date("window.start").alias("date"),
            "category",
            "region"
        )
        .agg(
            F.sum("event_count").alias("daily_events"),
            F.sum("total_value").alias("daily_value")
        )
    )

# Third level: Summary from second level
@dlt.table
def mv_monthly_metrics():
    return (
        dlt.read("mv_daily_metrics")
        .groupBy(
            F.date_trunc("month", "date").alias("month"),
            "category"
        )
        .agg(
            F.sum("daily_events").alias("monthly_events"),
            F.sum("daily_value").alias("monthly_value")
        )
    )
```

## Common Patterns

### KPI Dashboard View

```python
@dlt.table
def mv_executive_dashboard():
    sales = dlt.read("silver_sales")
    costs = dlt.read("silver_costs")
    customers = dlt.read("silver_customers")

    return (
        sales
        .groupBy(F.date_trunc("month", "sale_date").alias("month"))
        .agg(
            F.sum("revenue").alias("total_revenue"),
            F.count("*").alias("transaction_count")
        )
        .join(
            costs.groupBy(F.date_trunc("month", "cost_date").alias("month"))
            .agg(F.sum("amount").alias("total_costs")),
            "month"
        )
        .join(
            customers.groupBy(F.date_trunc("month", "signup_date").alias("month"))
            .agg(F.count("*").alias("new_customers")),
            "month",
            "left"
        )
        .withColumn("gross_margin",
            (col("total_revenue") - col("total_costs")) / col("total_revenue")
        )
    )
```

### Denormalized Fact Table

```python
@dlt.table
def mv_denormalized_orders():
    orders = dlt.read("silver_orders")
    customers = dlt.read("dim_customers")
    products = dlt.read("dim_products")
    stores = dlt.read("dim_stores")

    return (
        orders
        .join(customers, "customer_id")
        .join(products, "product_id")
        .join(stores, "store_id")
        .select(
            # Order facts
            "order_id", "order_date", "quantity", "amount",
            # Customer dimensions
            "customer_name", "customer_segment", "customer_region",
            # Product dimensions
            "product_name", "product_category", "brand",
            # Store dimensions
            "store_name", "store_city", "store_state"
        )
    )
```

## Conclusion

Materialized views in Delta Live Tables provide:
- Precomputed results for fast query performance
- Automatic refresh when source data changes
- Flexible refresh strategies (full or incremental)
- Integration with the Delta Lake ecosystem

They're essential for building performant analytics layers on top of your lakehouse data.

## Resources

- [DLT Tables and Views](https://docs.databricks.com/delta-live-tables/transform.html)
- [Performance Optimization](https://docs.databricks.com/delta-live-tables/performance.html)
- [Delta Lake Optimization](https://docs.databricks.com/delta/optimizations/index.html)
