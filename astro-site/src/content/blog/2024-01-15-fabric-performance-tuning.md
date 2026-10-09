---
title: "Microsoft Fabric Performance Tuning: From Notebooks to Reports"
description: "When diagnosing Fabric performance, I've found the root cause can be anywhere from Spark configs to report visuals. This guide consolidates tuning…"
author: Michael John Peña
draft: false
date: 2024-01-15
tags:
  - Microsoft Fabric
  - Performance
  - Spark
  - Power BI
  - Optimization
---

When diagnosing Fabric performance, I've found the root cause can be anywhere from Spark configs to report visuals. This guide consolidates tuning techniques I've used to improve end-to-end latency.

## Spark Notebook Performance

### 1. Optimize Spark Configuration

```python
# Set optimal Spark configurations for Fabric
spark.conf.set("spark.sql.shuffle.partitions", "200")  # Adjust based on data size
spark.conf.set("spark.sql.adaptive.enabled", "true")
spark.conf.set("spark.sql.adaptive.coalescePartitions.enabled", "true")
spark.conf.set("spark.sql.adaptive.skewJoin.enabled", "true")
spark.conf.set("spark.databricks.delta.optimizeWrite.enabled", "true")
spark.conf.set("spark.databricks.delta.autoCompact.enabled", "true")

# For large data operations
spark.conf.set("spark.sql.files.maxPartitionBytes", "128mb")
spark.conf.set("spark.sql.autoBroadcastJoinThreshold", "100mb")
```

### 2. Data Reading Optimization

```python
from pyspark.sql.functions import *

# BAD: Reading entire table then filtering
df_bad = spark.read.table("large_table")
result = df_bad.filter(col("date") >= "2024-01-01")

# GOOD: Push down filters
df_good = spark.read.table("large_table").filter(col("date") >= "2024-01-01")

# BEST: Use partition pruning with Delta
df_best = spark.sql("""
    SELECT * FROM large_table
    WHERE date >= '2024-01-01'
    AND region = 'NORTH'
""")

# Column pruning - only read needed columns
df_pruned = spark.read.table("wide_table").select("col1", "col2", "col3")
```

### 3. Join Optimization

```python
from pyspark.sql.functions import broadcast

# Profile your tables first
def profile_table(table_name: str):
    df = spark.read.table(table_name)
    return {
        "rows": df.count(),
        "columns": len(df.columns),
        "size_estimate_mb": df.rdd.map(lambda x: len(str(x))).sum() / 1024 / 1024
    }

# Small table: Use broadcast
small_df = spark.read.table("dim_product")  # 10K rows
large_df = spark.read.table("fact_sales")   # 100M rows

# Broadcast join (small table sent to all workers)
result = large_df.join(broadcast(small_df), "product_id")

# For skewed joins, salt the keys
def salted_join(large_df, small_df, key_col, num_salts=10):
    """Join with key salting to handle skew."""
    from pyspark.sql.functions import concat, lit, floor, rand

    # Add salt to large dataframe
    large_salted = large_df.withColumn(
        "salt",
        floor(rand() * num_salts).cast("int")
    ).withColumn(
        "salted_key",
        concat(col(key_col), lit("_"), col("salt"))
    )

    # Explode small dataframe with all salts
    salt_df = spark.range(num_salts).withColumnRenamed("id", "salt")
    small_exploded = small_df.crossJoin(salt_df).withColumn(
        "salted_key",
        concat(col(key_col), lit("_"), col("salt"))
    )

    # Join on salted key
    result = large_salted.join(small_exploded, "salted_key")

    return result.drop("salt", "salted_key")
```

### 4. Aggregation Optimization

```python
# BAD: Multiple passes over data
count = df.count()
avg_val = df.agg({"value": "avg"}).collect()[0][0]
max_val = df.agg({"value": "max"}).collect()[0][0]

# GOOD: Single pass
from pyspark.sql.functions import count, avg, max, min, sum

stats = df.agg(
    count("*").alias("count"),
    avg("value").alias("avg_value"),
    max("value").alias("max_value"),
    min("value").alias("min_value"),
    sum("value").alias("total_value")
).collect()[0]

# For distinct counts, use approx when exact isn't needed
approx_distinct = df.agg(approx_count_distinct("customer_id")).collect()[0][0]
```

## Delta Table Optimization

### 1. File Size Management

```python
from delta.tables import DeltaTable

def optimize_delta_table(table_name: str, z_order_cols: list = None):
    """Comprehensive Delta table optimization."""

    delta_table = DeltaTable.forName(spark, table_name)

    # Compact small files
    if z_order_cols:
        delta_table.optimize().executeZOrderBy(z_order_cols)
    else:
        delta_table.optimize().executeCompaction()

    # Vacuum old files
    delta_table.vacuum(168)  # 7 days

    # Update statistics
    spark.sql(f"ANALYZE TABLE {table_name} COMPUTE STATISTICS FOR ALL COLUMNS")

    print(f"Optimization complete for {table_name}")

# Check file sizes
def check_delta_files(table_path: str):
    """Analyze Delta table file distribution."""

    files = spark.read.format("delta").load(table_path).inputFiles()
    file_sizes = []

    for f in files[:100]:  # Sample first 100
        # Get file size from storage
        # This is simplified - actual implementation would use storage APIs
        pass

    return {
        "total_files": len(files),
        "avg_file_size_mb": sum(file_sizes) / len(file_sizes) if file_sizes else 0
    }
```

### 2. Partitioning Strategy

```python
# Good partitioning for time-series data
df.write \
    .format("delta") \
    .partitionBy("year", "month") \
    .mode("overwrite") \
    .saveAsTable("partitioned_sales")

# Check partition pruning is working
spark.sql("EXPLAIN SELECT * FROM partitioned_sales WHERE year = 2024 AND month = 1")

# Avoid over-partitioning (rule of thumb: partitions should be > 1GB)
def recommend_partitioning(df, potential_columns: list):
    """Recommend partitioning strategy based on data distribution."""

    recommendations = []

    for col in potential_columns:
        distinct_values = df.select(col).distinct().count()
        total_rows = df.count()
        avg_rows_per_partition = total_rows / distinct_values

        if distinct_values > 10000:
            recommendations.append({
                "column": col,
                "verdict": "Too many partitions",
                "distinct_values": distinct_values
            })
        elif avg_rows_per_partition < 1000000:
            recommendations.append({
                "column": col,
                "verdict": "Partitions too small",
                "avg_rows": avg_rows_per_partition
            })
        else:
            recommendations.append({
                "column": col,
                "verdict": "Good candidate",
                "distinct_values": distinct_values,
                "avg_rows": avg_rows_per_partition
            })

    return recommendations
```

## Power BI / Semantic Model Performance

### 1. DAX Query Optimization

```dax
// BAD: Row-by-row calculation
Bad Measure =
SUMX(
    Sales,
    Sales[Quantity] * RELATED(Products[Price])
)

// GOOD: Pre-calculated in model or using efficient pattern
Good Measure =
SUMX(
    VALUES(Products[ProductID]),
    CALCULATE(SUM(Sales[Quantity])) * MAX(Products[Price])
)

// Avoid FILTER with large tables
// BAD
Bad Filter =
CALCULATE(
    [Total Sales],
    FILTER(ALL(Sales), Sales[Date] >= DATE(2024,1,1))
)

// GOOD
Good Filter =
CALCULATE(
    [Total Sales],
    Sales[Date] >= DATE(2024,1,1)
)

// Use variables for repeated calculations
Efficient Measure =
VAR TotalSales = SUM(Sales[Amount])
VAR TotalCost = SUM(Sales[Cost])
RETURN
    DIVIDE(TotalSales - TotalCost, TotalCost)
```

### 2. Model Design

```python
# Python script to analyze semantic model
def analyze_model_performance(workspace_id: str, dataset_id: str):
    """Analyze semantic model for performance issues."""

    issues = []

    # Check for too many columns (aim for < 500)
    column_count = get_column_count(workspace_id, dataset_id)
    if column_count > 500:
        issues.append(f"High column count: {column_count}")

    # Check for high cardinality columns
    high_cardinality = get_high_cardinality_columns(workspace_id, dataset_id)
    for col in high_cardinality:
        if col["cardinality"] > 1000000:
            issues.append(f"High cardinality: {col['table']}.{col['column']} ({col['cardinality']:,})")

    # Check for calculated columns (prefer measures)
    calc_columns = get_calculated_columns(workspace_id, dataset_id)
    if len(calc_columns) > 20:
        issues.append(f"Many calculated columns: {len(calc_columns)} (consider measures)")

    # Check relationships
    relationships = get_relationships(workspace_id, dataset_id)
    for rel in relationships:
        if rel["cross_filter_direction"] == "Both":
            issues.append(f"Bi-directional filter: {rel['from_table']} <-> {rel['to_table']}")

    return issues
```

### 3. Report-Level Optimization

```javascript
// Power BI report optimization checklist

// 1. Limit visuals per page (aim for < 10)
// 2. Use bookmarks instead of multiple similar pages
// 3. Disable interactions where not needed

// In report settings:
{
  "filterPaneBehavior": "collapsed",
  "visualInteractions": "limited",
  "drillthrough": "enabled",
  "persistentFilters": true
}
```

## End-to-End Performance Testing

```python
import time
from dataclasses import dataclass

@dataclass
class PerformanceResult:
    operation: str
    duration_seconds: float
    rows_processed: int
    success: bool
    error: str = None

class FabricPerformanceTester:
    def __init__(self):
        self.results = []

    def test_notebook_execution(self, notebook_path: str) -> PerformanceResult:
        """Test notebook execution time."""
        start = time.time()
        try:
            # Execute notebook
            result = mssparkutils.notebook.run(notebook_path)
            duration = time.time() - start

            return PerformanceResult(
                operation=f"notebook:{notebook_path}",
                duration_seconds=duration,
                rows_processed=result.get("rows", 0),
                success=True
            )
        except Exception as e:
            return PerformanceResult(
                operation=f"notebook:{notebook_path}",
                duration_seconds=time.time() - start,
                rows_processed=0,
                success=False,
                error=str(e)
            )

    def test_query_performance(self, query: str, name: str) -> PerformanceResult:
        """Test Spark SQL query performance."""
        start = time.time()

        try:
            df = spark.sql(query)
            count = df.count()  # Force execution
            duration = time.time() - start

            return PerformanceResult(
                operation=f"query:{name}",
                duration_seconds=duration,
                rows_processed=count,
                success=True
            )
        except Exception as e:
            return PerformanceResult(
                operation=f"query:{name}",
                duration_seconds=time.time() - start,
                rows_processed=0,
                success=False,
                error=str(e)
            )

    def generate_report(self) -> str:
        """Generate performance test report."""
        report = ["# Performance Test Results\n"]

        for result in self.results:
            status = "PASS" if result.success else "FAIL"
            report.append(f"## {result.operation}")
            report.append(f"- Status: {status}")
            report.append(f"- Duration: {result.duration_seconds:.2f}s")
            report.append(f"- Rows: {result.rows_processed:,}")
            if result.error:
                report.append(f"- Error: {result.error}")
            report.append("")

        return "\n".join(report)

# Usage
tester = FabricPerformanceTester()
tester.results.append(tester.test_query_performance(
    "SELECT * FROM sales WHERE date >= '2024-01-01'",
    "filtered_sales"
))
print(tester.generate_report())
```

## Conclusion

Fabric performance tuning requires attention to:

1. **Spark configuration** - Right-size shuffle partitions and enable adaptive features
2. **Data reading** - Push down filters, prune columns
3. **Joins** - Broadcast small tables, salt skewed keys
4. **Delta tables** - Optimize file sizes, partition wisely
5. **DAX** - Use efficient patterns, avoid row-by-row
6. **Models** - Minimize cardinality, prefer measures

Start with profiling to identify bottlenecks, then apply targeted optimizations. Measure before and after to validate improvements.
