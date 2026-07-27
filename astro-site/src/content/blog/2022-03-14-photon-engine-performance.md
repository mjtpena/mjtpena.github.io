---
title: "Photon Engine: Accelerating Spark Workloads on Databricks"
author: Michael John Peña
draft: false
date: 2022-03-14
tags:
  - Azure
  - Databricks
  - Photon
  - Performance
  - Spark
---

Photon is Databricks' native vectorised query execution engine written in C++—a replacement for the JVM-based Apache Spark execution engine for SQL and DataFrame operations that processes data in batches using CPU SIMD instructions rather than one row at a time. The performance gains are most pronounced for aggregation-heavy SQL queries (GROUP BY, window functions, sort-heavy operations) and I/O-bound operations on columnar Parquet and Delta Lake files where vectorised reads provide significant throughput improvements. The practical benchmarks Databricks cited: 2-8x faster query execution for representative analytical workloads compared to non-Photon Spark SQL; TPC-DS benchmark scores substantially higher than competing Spark-on-cloud offerings. Photon is transparent to the developer—the same SQL query or DataFrame code runs on Photon without modification; the engine substitutes Photon operators where they're available and falls back to Spark operators for operations not yet ported to Photon. Available for SQL warehouses and job clusters on Databricks Runtime 9.1+.

## What is Photon?

Photon is a native execution engine that:
- Replaces Spark's JVM-based execution for supported operations
- Uses vectorized processing (SIMD) for CPU efficiency
- Operates directly on columnar data in memory
- Provides 2-8x performance improvements for typical workloads

## How Photon Works

```
Traditional Spark:
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Catalyst   │ -> │  Tungsten   │ -> │    JVM      │
│  Optimizer  │    │  Codegen    │    │  Execution  │
└─────────────┘    └─────────────┘    └─────────────┘

With Photon:
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Catalyst   │ -> │   Photon    │ -> │   Native    │
│  Optimizer  │    │   Codegen   │    │  C++ Engine │
└─────────────┘    └─────────────┘    └─────────────┘
```

## Enabling Photon

### Cluster Configuration

```python
# Create Photon-enabled cluster via API
cluster_config = {
    "cluster_name": "photon-analytics",
    "spark_version": "11.3.x-photon-scala2.12",  # Photon runtime
    "node_type_id": "Standard_D4ds_v5",
    "num_workers": 4,
    "runtime_engine": "PHOTON",
    "spark_conf": {
        "spark.databricks.photon.enabled": "true",
        "spark.databricks.photon.parquetWriter.enabled": "true"
    }
}

response = requests.post(
    f"{workspace_url}/api/2.0/clusters/create",
    headers=headers,
    json=cluster_config
)
```

### SQL Warehouse

```python
# Photon is automatically enabled for Pro and Serverless warehouses
warehouse_config = {
    "name": "photon-warehouse",
    "enable_photon": True,
    "warehouse_type": "PRO"
}
```

## Photon-Optimized Operations

### Supported Operations

Photon excels at:

```sql
-- Aggregations
SELECT region, SUM(sales), AVG(price), COUNT(DISTINCT customer_id)
FROM transactions
GROUP BY region;

-- Joins
SELECT t.*, c.customer_name
FROM transactions t
JOIN customers c ON t.customer_id = c.customer_id;

-- Filters and projections
SELECT product_id, quantity, price * quantity as total
FROM order_items
WHERE quantity > 0 AND price < 1000;

-- Window functions
SELECT
    customer_id,
    order_date,
    amount,
    SUM(amount) OVER (PARTITION BY customer_id ORDER BY order_date) as running_total
FROM orders;

-- Sorting
SELECT * FROM large_table ORDER BY timestamp DESC;
```

### Performance Comparison

```python
# Benchmark Photon vs traditional Spark

def benchmark_query(spark, query, num_runs=5):
    """Run query multiple times and return statistics"""
    import time

    times = []
    for _ in range(num_runs):
        start = time.time()
        spark.sql(query).collect()
        elapsed = time.time() - start
        times.append(elapsed)

    return {
        "min": min(times),
        "max": max(times),
        "avg": sum(times) / len(times)
    }

# Complex aggregation benchmark
aggregation_query = """
SELECT
    region,
    product_category,
    YEAR(transaction_date) as year,
    MONTH(transaction_date) as month,
    COUNT(*) as transaction_count,
    SUM(amount) as total_revenue,
    AVG(amount) as avg_transaction,
    PERCENTILE(amount, 0.5) as median_amount
FROM production.sales.transactions
WHERE transaction_date >= '2021-01-01'
GROUP BY region, product_category, YEAR(transaction_date), MONTH(transaction_date)
"""

# Results typically show 2-5x improvement with Photon
result = benchmark_query(spark, aggregation_query)
print(f"Average query time: {result['avg']:.2f}s")
```

## Monitoring Photon Execution

### Query Plans

```python
# Check if Photon is being used
df = spark.sql("""
    SELECT region, SUM(amount) FROM transactions GROUP BY region
""")

# Explain the query plan
df.explain(mode="extended")

# Look for "PhotonGroupingAgg", "PhotonScan", etc. in the plan
```

### Spark UI Metrics

```python
# Access Photon-specific metrics
def get_photon_metrics(spark_session):
    """Get Photon execution metrics from Spark UI"""
    sc = spark_session.sparkContext
    status_tracker = sc.statusTracker()

    # Get active jobs
    job_ids = status_tracker.getActiveJobIds()

    metrics = []
    for job_id in job_ids:
        job_info = status_tracker.getJobInfo(job_id)
        if job_info:
            metrics.append({
                "job_id": job_id,
                "status": str(job_info.status),
                "stage_ids": job_info.stageIds
            })

    return metrics

# In Spark UI, look for:
# - "Photon" operators in the query plan
# - "photon" metrics in stage details
# - CPU time vs elapsed time (Photon has better CPU utilization)
```

## Optimizing for Photon

### Data Format Optimization

```python
# Photon works best with Delta Lake and Parquet
# Optimize column encoding

# Write optimized Delta table
df.write \
    .format("delta") \
    .option("optimizeWrite", "true") \
    .option("autoCompact", "true") \
    .saveAsTable("optimized_table")

# Use appropriate data types
# - Use INT instead of STRING for numeric data
# - Use DATE instead of STRING for dates
# - Avoid deeply nested structures
```

### Query Optimization for Photon

```sql
-- Photon handles predicate pushdown well
-- Place filters early
SELECT * FROM transactions
WHERE transaction_date = '2022-03-01'  -- Pushed to scan
AND amount > 100;

-- Use column pruning
SELECT id, name, amount  -- Only needed columns
FROM transactions
WHERE region = 'US';

-- Leverage Delta Lake statistics
OPTIMIZE transactions
ZORDER BY (region, transaction_date);

-- This allows Photon to skip files efficiently
```

### Memory Configuration

```python
# Photon uses off-heap memory
spark_conf = {
    # Photon memory settings
    "spark.databricks.photon.memoryPressure.enabled": "true",
    "spark.databricks.photon.spillToDisk.enabled": "true",

    # General memory settings that affect Photon
    "spark.memory.offHeap.enabled": "true",
    "spark.memory.offHeap.size": "4g"
}
```

## When Photon Falls Back

Photon falls back to Spark for unsupported operations:

```sql
-- Operations that may not use Photon:
-- 1. Complex UDFs
SELECT my_python_udf(column) FROM table;  -- Falls back

-- 2. Certain data types
SELECT parse_complex_json(json_column) FROM table;  -- May fall back

-- 3. Unsupported functions
-- Check documentation for specific function support

-- Check if Photon was used
EXPLAIN SELECT * FROM table WHERE condition;
-- Look for "Photon" in the plan output
```

## Photon for ETL Workloads

```python
# Photon accelerates ETL operations

# Large-scale transformation
transformed_df = (
    spark.read.table("raw.events")
    .filter(col("event_date") >= "2022-01-01")
    .groupBy("user_id", "event_type")
    .agg(
        count("*").alias("event_count"),
        sum("value").alias("total_value"),
        first("device_type").alias("primary_device")
    )
    .withColumn("processed_date", current_date())
)

# Write back - Photon accelerates the read and transform
# Write uses Photon parquet writer when enabled
transformed_df.write \
    .format("delta") \
    .mode("overwrite") \
    .saveAsTable("analytics.user_events_summary")
```

## Cost-Performance Analysis

```python
def analyze_photon_roi(cluster_id, time_range_days=30):
    """Analyze Photon ROI based on query performance"""

    # Get query history
    queries = get_query_history(time_range_days)

    photon_queries = [q for q in queries if q.get('used_photon', False)]
    non_photon_queries = [q for q in queries if not q.get('used_photon', False)]

    if not photon_queries or not non_photon_queries:
        return None

    # Calculate average speedup
    photon_avg_time = sum(q['duration_ms'] for q in photon_queries) / len(photon_queries)
    spark_avg_time = sum(q['duration_ms'] for q in non_photon_queries) / len(non_photon_queries)

    speedup = spark_avg_time / photon_avg_time if photon_avg_time > 0 else 0

    # Calculate DBU savings
    # Photon uses same DBU rate but finishes faster
    total_dbus = sum(q['dbus'] for q in photon_queries)
    estimated_non_photon_dbus = total_dbus * speedup

    return {
        "queries_analyzed": len(photon_queries) + len(non_photon_queries),
        "average_speedup": speedup,
        "photon_avg_duration_ms": photon_avg_time,
        "spark_avg_duration_ms": spark_avg_time,
        "estimated_dbu_savings": estimated_non_photon_dbus - total_dbus
    }
```

## Best Practices

### Cluster Sizing with Photon

```python
# Photon is more CPU-efficient, so consider:
# - Use compute-optimized instances (D-series on Azure)
# - May need less total nodes due to efficiency gains
# - Monitor memory usage - Photon has different memory patterns

recommended_configs = {
    "small_workload": {
        "node_type": "Standard_D4ds_v5",
        "workers": 2,
        "with_photon": True
    },
    "medium_workload": {
        "node_type": "Standard_D8ds_v5",
        "workers": 4,
        "with_photon": True
    },
    "large_workload": {
        "node_type": "Standard_D16ds_v5",
        "workers": 8,
        "with_photon": True
    }
}
```

### Query Patterns

```sql
-- DO: Use Photon-friendly patterns
-- Simple aggregations
SELECT category, SUM(sales) FROM products GROUP BY category;

-- Standard joins
SELECT * FROM orders o JOIN customers c ON o.cust_id = c.id;

-- DON'T: Avoid patterns that force fallback
-- Complex Python UDFs
-- Heavily nested structures
-- Unsupported data types
```

## Conclusion

Photon represents a significant advancement in query execution for Databricks. By leveraging native code execution and vectorized processing, it delivers substantial performance improvements without requiring query changes.

Key takeaways:
- Enable Photon on all production workloads (default for Pro/Serverless)
- Use Delta Lake for optimal Photon performance
- Monitor query plans to ensure Photon is being utilized
- Optimize table layout with ZORDER for best file pruning
- Consider Photon's efficiency when sizing clusters

The performance gains often translate directly to cost savings, making Photon a clear win for most Spark workloads.

## Resources

- [Photon Runtime Documentation](https://docs.databricks.com/runtime/photon.html)
- [Photon Supported Operations](https://docs.databricks.com/runtime/photon.html#supported-operators-and-functions)
- [Performance Tuning Guide](https://docs.databricks.com/delta/optimizations/index.html)
