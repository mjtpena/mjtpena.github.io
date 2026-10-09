---
title: "Query Performance Tuning in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-08-20
tags:
  - Microsoft Fabric
  - Performance
  - Query Optimization
  - SQL
  - Spark
---

## Understanding Query Execution

```
Query Optimization Flow:
┌─────────────────────────────────────────────────────────────┐
│                      Query Submitted                         │
│                            │                                 │
│                      ┌─────▼─────┐                          │
│                      │  Parser   │                          │
│                      └─────┬─────┘                          │
│                            │                                 │
│                      ┌─────▼─────┐                          │
│                      │ Analyzer  │  ← Schema resolution     │
│                      └─────┬─────┘                          │
│                            │                                 │
│                      ┌─────▼─────┐                          │
│                      │ Optimizer │  ← Cost-based decisions  │
│                      └─────┬─────┘                          │
│                            │                                 │
│                      ┌─────▼─────┐                          │
│                      │ Planner   │  ← Physical plan         │
│                      └─────┬─────┘                          │
│                            │                                 │
│                      ┌─────▼─────┐                          │
│                      │ Executor  │  ← Data access           │
│                      └───────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

## SQL Endpoint Optimization

### Analyzing Query Plans

```sql
-- View query execution plan
SET STATISTICS PROFILE ON;

SELECT
    region,
    product_category,
    SUM(amount) as total_sales,
    COUNT(*) as order_count
FROM sales
WHERE order_date BETWEEN '2024-01-01' AND '2024-03-31'
GROUP BY region, product_category
ORDER BY total_sales DESC;

SET STATISTICS PROFILE OFF;

-- View estimated plan
SET SHOWPLAN_ALL ON;
GO

SELECT * FROM sales WHERE customer_id = 12345;
GO

SET SHOWPLAN_ALL OFF;
GO
```

### Common SQL Optimizations

```sql
-- 1. Use specific columns instead of SELECT *
-- Bad
SELECT * FROM orders WHERE order_date = '2024-01-15';

-- Good
SELECT order_id, customer_id, amount, status
FROM orders
WHERE order_date = '2024-01-15';

-- 2. Filter early, join late
-- Bad
SELECT o.*, c.customer_name
FROM orders o
JOIN customers c ON o.customer_id = c.customer_id
WHERE o.order_date >= '2024-01-01';

-- Good (filter before join in subquery or CTE)
WITH recent_orders AS (
    SELECT order_id, customer_id, amount
    FROM orders
    WHERE order_date >= '2024-01-01'
)
SELECT ro.*, c.customer_name
FROM recent_orders ro
JOIN customers c ON ro.customer_id = c.customer_id;

-- 3. Use EXISTS instead of IN for large subqueries
-- Less efficient
SELECT * FROM customers
WHERE customer_id IN (
    SELECT customer_id FROM orders
    WHERE order_date >= '2024-01-01'
);

-- More efficient
SELECT * FROM customers c
WHERE EXISTS (
    SELECT 1 FROM orders o
    WHERE o.customer_id = c.customer_id
    AND o.order_date >= '2024-01-01'
);

-- 4. Avoid functions on indexed columns
-- Bad (can't use statistics)
SELECT * FROM orders
WHERE YEAR(order_date) = 2024 AND MONTH(order_date) = 1;

-- Good
SELECT * FROM orders
WHERE order_date >= '2024-01-01' AND order_date < '2024-02-01';
```

## Spark Query Optimization

### Understanding Spark Plans

```python
# View execution plan
df = spark.read.format("delta").load("Tables/sales")

filtered = df.filter("order_date >= '2024-01-01'") \
    .groupBy("region") \
    .agg({"amount": "sum"})

# Explain plan
filtered.explain(True)

# Extended explain with statistics
filtered.explain("cost")

# Formatted explain (most readable)
filtered.explain("formatted")
```

### Spark Performance Configuration

```python
class SparkPerformanceConfig:
    """Configure Spark for optimal performance."""

    def __init__(self, spark):
        self.spark = spark

    def configure_adaptive_execution(self):
        """Enable adaptive query execution."""

        configs = {
            # Enable AQE
            "spark.sql.adaptive.enabled": "true",
            "spark.sql.adaptive.coalescePartitions.enabled": "true",
            "spark.sql.adaptive.skewJoin.enabled": "true",

            # Partition coalescing
            "spark.sql.adaptive.advisoryPartitionSizeInBytes": "128MB",
            "spark.sql.adaptive.coalescePartitions.minPartitionSize": "64MB",

            # Skew handling
            "spark.sql.adaptive.skewJoin.skewedPartitionFactor": "5",
            "spark.sql.adaptive.skewJoin.skewedPartitionThresholdInBytes": "256MB"
        }

        for key, value in configs.items():
            self.spark.conf.set(key, value)

    def configure_broadcast_join(self, threshold_mb: int = 100):
        """Configure broadcast join threshold."""

        self.spark.conf.set(
            "spark.sql.autoBroadcastJoinThreshold",
            str(threshold_mb * 1024 * 1024)
        )

    def configure_shuffle(self, partitions: int = 200):
        """Configure shuffle partitions."""

        self.spark.conf.set("spark.sql.shuffle.partitions", str(partitions))

    def configure_for_large_tables(self):
        """Configuration for large table processing."""

        configs = {
            "spark.sql.shuffle.partitions": "400",
            "spark.sql.adaptive.enabled": "true",
            "spark.sql.files.maxPartitionBytes": "256MB",
            "spark.sql.parquet.filterPushdown": "true",
            "spark.sql.parquet.enableVectorizedReader": "true"
        }

        for key, value in configs.items():
            self.spark.conf.set(key, value)

# Usage
config = SparkPerformanceConfig(spark)
config.configure_adaptive_execution()
config.configure_broadcast_join(threshold_mb=200)
```

### Predicate Pushdown

```python
# Enable predicate pushdown
spark.conf.set("spark.sql.parquet.filterPushdown", "true")

# Write query to leverage pushdown
# Good: Filter on partition column
df = spark.read.format("delta").load("Tables/sales") \
    .filter("order_date = '2024-01-15'")  # Pushed down

# Check if pushdown is working
df.explain(True)
# Look for "PushedFilters" in the plan

# Predicate pushdown works best with:
# 1. Partition columns
# 2. Columns with good statistics
# 3. Simple predicates (=, <, >, BETWEEN, IN)

# Predicates that may not push down:
# - LIKE with leading wildcard
# - Complex expressions
# - UDFs
```

### Join Optimization

```python
from pyspark.sql.functions import broadcast

class JoinOptimizer:
    """Optimize joins in Spark."""

    def __init__(self, spark):
        self.spark = spark

    def analyze_join(self, df1, df2, join_key: str) -> dict:
        """Analyze join and recommend strategy."""

        df1_count = df1.count()
        df2_count = df2.count()

        # Estimate sizes
        df1_size_mb = df1_count * len(df1.columns) * 100 / (1024 * 1024)
        df2_size_mb = df2_count * len(df2.columns) * 100 / (1024 * 1024)

        broadcast_threshold = self.spark.conf.get(
            "spark.sql.autoBroadcastJoinThreshold"
        )

        if df1_size_mb < 100 or df2_size_mb < 100:
            strategy = "BROADCAST"
            smaller = "df1" if df1_size_mb < df2_size_mb else "df2"
        elif df1_count > 1000 * df2_count or df2_count > 1000 * df1_count:
            strategy = "BROADCAST"
            smaller = "df1" if df1_count < df2_count else "df2"
        else:
            strategy = "SORT_MERGE"
            smaller = None

        return {
            "recommended_strategy": strategy,
            "broadcast_table": smaller,
            "df1_rows": df1_count,
            "df2_rows": df2_count,
            "df1_estimated_mb": df1_size_mb,
            "df2_estimated_mb": df2_size_mb
        }

    def optimized_join(self, large_df, small_df, join_key: str):
        """Perform optimized join."""

        analysis = self.analyze_join(large_df, small_df, join_key)

        if analysis["recommended_strategy"] == "BROADCAST":
            if analysis["broadcast_table"] == "df1":
                return large_df.join(broadcast(small_df), join_key)
            else:
                return broadcast(large_df).join(small_df, join_key)
        else:
            # Sort-merge join
            return large_df.join(small_df, join_key)

# Usage
optimizer = JoinOptimizer(spark)

orders = spark.read.format("delta").load("Tables/orders")
customers = spark.read.format("delta").load("Tables/customers")

# Analyze and optimize
analysis = optimizer.analyze_join(orders, customers, "customer_id")
print(f"Recommended: {analysis['recommended_strategy']}")

result = optimizer.optimized_join(orders, customers, "customer_id")
```

## Direct Lake Optimization

### Optimizing for Power BI

```python
class DirectLakeOptimizer:
    """Optimize tables for Direct Lake queries."""

    def __init__(self, spark):
        self.spark = spark

    def optimize_table_for_direct_lake(self, table_path: str):
        """Apply Direct Lake optimizations."""

        # 1. Enable V-Order
        self.spark.sql(f"""
            ALTER TABLE delta.`{table_path}`
            SET TBLPROPERTIES (
                'delta.parquet.vorder.enabled' = 'true'
            )
        """)

        # 2. Optimize file sizes (256MB recommended)
        self.spark.conf.set(
            "spark.databricks.delta.optimizeWrite.binSize",
            "268435456"
        )

        # 3. Rewrite with optimizations
        df = self.spark.read.format("delta").load(table_path)
        df.write.format("delta") \
            .mode("overwrite") \
            .option("parquet.vorder.enabled", "true") \
            .save(table_path)

    def check_direct_lake_readiness(self, table_path: str) -> dict:
        """Check if table is optimized for Direct Lake."""

        detail = self.spark.sql(f"DESCRIBE DETAIL delta.`{table_path}`").first()
        props = self.spark.sql(f"SHOW TBLPROPERTIES delta.`{table_path}`")

        prop_dict = {row.key: row.value for row in props.collect()}

        issues = []
        recommendations = []

        # Check file count
        if detail.numFiles > 1000:
            issues.append(f"Too many files ({detail.numFiles})")
            recommendations.append("Run OPTIMIZE to compact files")

        # Check file sizes
        if detail.numFiles > 0:
            avg_size = detail.sizeInBytes / detail.numFiles
            if avg_size < 64 * 1024 * 1024:
                issues.append(f"Files too small (avg {avg_size/(1024*1024):.0f}MB)")
                recommendations.append("Enable optimized write with larger bin size")

        # Check V-Order
        if prop_dict.get("delta.parquet.vorder.enabled") != "true":
            issues.append("V-Order not enabled")
            recommendations.append("Enable V-Order for better Direct Lake performance")

        return {
            "ready": len(issues) == 0,
            "issues": issues,
            "recommendations": recommendations,
            "file_count": detail.numFiles,
            "size_gb": detail.sizeInBytes / (1024**3)
        }

# Usage
optimizer = DirectLakeOptimizer(spark)

readiness = optimizer.check_direct_lake_readiness("Tables/fact_sales")

if not readiness["ready"]:
    print("Issues found:")
    for issue in readiness["issues"]:
        print(f"  - {issue}")
    print("\nRecommendations:")
    for rec in readiness["recommendations"]:
        print(f"  - {rec}")
```

## Query Monitoring

### Tracking Query Performance

```python
class QueryMonitor:
    """Monitor and analyze query performance."""

    def __init__(self, spark):
        self.spark = spark
        self.query_log = []

    def profile_query(self, query: str, description: str = "") -> dict:
        """Profile a query execution."""

        import time

        # Clear cache for accurate timing
        self.spark.catalog.clearCache()

        # Execute with timing
        start = time.time()
        result = self.spark.sql(query)
        row_count = result.count()
        elapsed = time.time() - start

        # Get execution metrics
        execution_info = {
            "query": query[:100] + "..." if len(query) > 100 else query,
            "description": description,
            "execution_time_seconds": elapsed,
            "row_count": row_count,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
        }

        self.query_log.append(execution_info)
        return execution_info

    def get_slow_queries(self, threshold_seconds: float = 5.0) -> list:
        """Get queries slower than threshold."""

        return [q for q in self.query_log
                if q["execution_time_seconds"] > threshold_seconds]

    def generate_report(self) -> str:
        """Generate performance report."""

        if not self.query_log:
            return "No queries logged"

        report = "# Query Performance Report\n\n"

        # Summary
        total_queries = len(self.query_log)
        avg_time = sum(q["execution_time_seconds"] for q in self.query_log) / total_queries
        max_time = max(q["execution_time_seconds"] for q in self.query_log)

        report += f"Total Queries: {total_queries}\n"
        report += f"Average Time: {avg_time:.2f}s\n"
        report += f"Max Time: {max_time:.2f}s\n\n"

        # Slow queries
        slow = self.get_slow_queries()
        if slow:
            report += f"## Slow Queries ({len(slow)})\n\n"
            for q in slow:
                report += f"- {q['description']}: {q['execution_time_seconds']:.2f}s\n"

        return report

# Usage
monitor = QueryMonitor(spark)

# Profile queries
monitor.profile_query(
    "SELECT region, SUM(amount) FROM sales GROUP BY region",
    "Sales by region aggregation"
)

monitor.profile_query(
    "SELECT * FROM sales WHERE order_date = '2024-01-15'",
    "Single day lookup"
)

# Get report
print(monitor.generate_report())
```

## Best Practices

1. **Filter early**: Push filters as close to data source as possible
2. **Use appropriate joins**: Broadcast small tables
3. **Enable AQE**: Adaptive Query Execution handles many issues automatically
4. **Monitor regularly**: Track query performance over time
5. **Optimize storage**: V-Order, proper file sizes, statistics

## Conclusion

Query performance optimization in Microsoft Fabric requires understanding both the data layout and query engine behavior. Combine storage optimizations (V-Order, file sizes) with query-level techniques (predicate pushdown, broadcast joins) for best results.

Regular monitoring helps identify performance regressions before they impact users.
