---
title: "Fabric Performance Tuning: Optimizing Your Data Platform"
author: "Michael John Peña"
draft: false
date: 2023-12-20
tags: ["Microsoft Fabric", "Performance", "Optimization", "Tuning", "Best Practices"]

---

I wrote "Fabric Performance Tuning: Optimizing Your Data Platform" to share practical, production-minded guidance on this topic.

Performance tuning in Fabric blends write-time optimisations (v-ordering, partitioning) with query-time strategies (predicate pushdown, materialised views). I'll share practical tuning steps I apply when customers complain that reports or queries are slow.

## Lakehouse Performance

## Lakehouse Performance

```python
from dataclasses import dataclass
from typing import List, Dict

@dataclass
class OptimizationTechnique:
    name: str
    description: str
    when_to_use: str
    implementation: str
    expected_impact: str

lakehouse_optimizations = {
    "v_order": OptimizationTechnique(
        name="V-Order Optimization",
        description="Write-time optimization for faster reads",
        when_to_use="Tables frequently queried by Power BI Direct Lake",
        implementation="""
# Enable at session level
spark.conf.set("spark.sql.parquet.vorder.enabled", "true")

# Or enable at write time
df.write.format("delta") \\
    .option("spark.sql.parquet.vorder.enabled", "true") \\
    .mode("overwrite") \\
    .saveAsTable("optimized_table")
""",
        expected_impact="2-4x faster read performance"
    ),
    "optimize_write": OptimizationTechnique(
        name="Optimize Write",
        description="Automatic file coalescing during writes",
        when_to_use="Streaming writes, small batch appends",
        implementation="""
spark.conf.set("spark.microsoft.delta.optimizeWrite.enabled", "true")
spark.conf.set("spark.microsoft.delta.optimizeWrite.binSize", "512") # MB
""",
        expected_impact="Fewer small files, better read performance"
    ),
    "z_order": OptimizationTechnique(
        name="Z-Ordering",
        description="Co-locate related data for faster filtering",
        when_to_use="Tables with common filter columns",
        implementation="""
-- Optimize with Z-Order
OPTIMIZE sales_facts ZORDER BY (customer_id, product_id)

-- Or for time-series data
OPTIMIZE events ZORDER BY (event_date, event_type)
""",
        expected_impact="10-100x faster queries on Z-ordered columns"
    ),
    "partitioning": OptimizationTechnique(
        name="Partitioning",
        description="Divide data into separate folders",
        when_to_use="Large tables with date or category filters",
        implementation="""
df.write.format("delta") \\
    .partitionBy("year", "month") \\
    .mode("overwrite") \\
    .saveAsTable("partitioned_table")

# Query with partition pruning
spark.sql("SELECT * FROM partitioned_table WHERE year = 2023 AND month = 12")
""",
        expected_impact="Prune 90%+ of data when filtering by partition"
    ),
    "caching": OptimizationTechnique(
        name="Table Caching",
        description="Cache frequently accessed data in memory",
        when_to_use="Small lookup tables, repeated queries",
        implementation="""
# Cache a table
spark.table("dim_product").cache()

# Or cache a DataFrame
df = spark.table("dim_product")
df.cache()
df.count()  # Materialize cache
""",
        expected_impact="10-100x faster for cached data"
    )
}

def analyze_table_for_optimization(table_stats: Dict) -> List[str]:
    """Recommend optimizations based on table statistics."""
    recommendations = []

    # Check file count
    if table_stats.get("file_count", 0) > 1000:
        recommendations.append("Run OPTIMIZE to compact small files")

    # Check average file size
    avg_file_mb = table_stats.get("total_size_mb", 0) / max(table_stats.get("file_count", 1), 1)
    if avg_file_mb < 32:
        recommendations.append("Enable optimizeWrite to reduce small files")
    elif avg_file_mb > 1024:
        recommendations.append("Consider partitioning to create smaller files")

    # Check if V-Order enabled
    if not table_stats.get("v_order_enabled", False):
        recommendations.append("Enable V-Order for Power BI performance")

    # Check partition strategy
    row_count = table_stats.get("row_count", 0)
    partition_count = table_stats.get("partition_count", 1)
    rows_per_partition = row_count / partition_count
    if rows_per_partition < 1_000_000 and partition_count > 100:
        recommendations.append("Over-partitioned: Consider fewer partitions")
    elif rows_per_partition > 100_000_000:
        recommendations.append("Under-partitioned: Consider adding partitions")

    return recommendations
```

## Warehouse Performance

```python
warehouse_optimizations = {
    "statistics": OptimizationTechnique(
        name="Update Statistics",
        description="Ensure query optimizer has accurate data",
        when_to_use="After large data loads",
        implementation="""
-- Update statistics for a table
UPDATE STATISTICS dbo.fact_sales;

-- Update all statistics in schema
EXEC sp_updatestats;
""",
        expected_impact="Better query plans, faster execution"
    ),
    "indexing": OptimizationTechnique(
        name="Columnstore Indexes",
        description="Fabric Warehouse uses columnstore by default",
        when_to_use="Analytics queries (already default)",
        implementation="""
-- Columnstore is default in Fabric Warehouse
-- For specific optimization, consider column order
CREATE TABLE fact_sales (
    -- Put frequently filtered columns first
    sale_date DATE,
    product_id INT,
    customer_id INT,
    -- Measure columns
    quantity INT,
    amount DECIMAL(18,2)
);
""",
        expected_impact="10-100x compression, fast aggregations"
    ),
    "materialized_views": OptimizationTechnique(
        name="Materialized Views",
        description="Pre-compute common aggregations",
        when_to_use="Repeated expensive aggregations",
        implementation="""
-- Create materialized view
CREATE MATERIALIZED VIEW mv_daily_sales AS
SELECT
    sale_date,
    product_id,
    SUM(amount) as total_amount,
    COUNT(*) as transaction_count
FROM fact_sales
GROUP BY sale_date, product_id;

-- Query uses materialized view automatically
SELECT * FROM mv_daily_sales WHERE sale_date = '2023-12-01';
""",
        expected_impact="Instant aggregations for pre-computed data"
    ),
    "query_hints": OptimizationTechnique(
        name="Query Hints",
        description="Guide the query optimizer",
        when_to_use="When optimizer makes suboptimal choices",
        implementation="""
-- Force a specific join type
SELECT *
FROM orders o
INNER HASH JOIN customers c ON o.customer_id = c.id;

-- Force parallel execution
SELECT *
FROM large_table
OPTION (MAXDOP 8);
""",
        expected_impact="Variable - use only when needed"
    )
}

def generate_warehouse_tuning_checklist() -> str:
    """Generate warehouse performance tuning checklist."""
    return """
# Warehouse Performance Tuning Checklist

## Query Analysis
- [ ] Review query execution plans for expensive operations
- [ ] Identify queries with high CPU or I/O
- [ ] Check for missing statistics warnings

## Table Design
- [ ] Verify appropriate data types (smallest possible)
- [ ] Check for unnecessary nullable columns
- [ ] Review column order (frequently filtered first)

## Statistics
- [ ] Statistics are up to date
- [ ] Auto-create statistics enabled
- [ ] Histograms exist for skewed columns

## Monitoring
- [ ] Query Store enabled and reviewing insights
- [ ] Long-running queries identified
- [ ] Resource utilization tracked

## Common Fixes
- [ ] OPTIMIZE after large loads
- [ ] Avoid SELECT * in production
- [ ] Use WHERE clauses to filter early
- [ ] Consider materialized views for repeated aggregations
"""
```

## Power BI Performance

```python
powerbi_optimizations = {
    "direct_lake": OptimizationTechnique(
        name="Direct Lake Mode",
        description="Query Lakehouse directly without import",
        when_to_use="Large datasets (10GB+), frequent refresh needed",
        implementation="""
1. Create Semantic Model from Lakehouse
2. Select "Direct Lake" storage mode
3. Ensure tables have V-Order optimization
4. Configure appropriate framing policy
""",
        expected_impact="No import needed, near real-time data, fast queries"
    ),
    "aggregations": OptimizationTechnique(
        name="User-defined Aggregations",
        description="Pre-aggregate data for faster queries",
        when_to_use="Large fact tables with predictable query patterns",
        implementation="""
-- Create aggregation table in Lakehouse
CREATE TABLE sales_daily_agg AS
SELECT
    sale_date,
    product_category,
    SUM(amount) as total_amount,
    COUNT(*) as transaction_count
FROM sales_fact
GROUP BY sale_date, product_category;

-- In Power BI, set up aggregation relationship
""",
        expected_impact="10-100x faster for aggregated queries"
    ),
    "incremental_refresh": OptimizationTechnique(
        name="Incremental Refresh",
        description="Only refresh new/changed data",
        when_to_use="Large tables with date-based partitions",
        implementation="""
1. Define RangeStart and RangeEnd parameters
2. Configure incremental refresh policy
3. Set archive period (e.g., 5 years)
4. Set incremental period (e.g., 10 days)
""",
        expected_impact="90%+ reduction in refresh time"
    ),
    "dax_optimization": OptimizationTechnique(
        name="DAX Optimization",
        description="Write efficient DAX measures",
        when_to_use="Always",
        implementation="""
-- AVOID: Row-by-row iteration
Bad_Measure =
SUMX(Sales, Sales[Quantity] * RELATED(Products[Price]))

-- BETTER: Calculated column or optimized formula
Good_Measure =
SUMX(
    VALUES(Products[Price]),
    [Quantity Sum] * Products[Price]
)

-- Use CALCULATE efficiently
Total_Sales =
CALCULATE(
    SUM(Sales[Amount]),
    USERELATIONSHIP(Sales[OrderDate], Calendar[Date])
)
""",
        expected_impact="2-10x faster measure evaluation"
    )
}
```

## Performance Monitoring

```python
class PerformanceMonitor:
    """Monitor Fabric performance metrics."""

    def __init__(self):
        self.metrics = []

    def capture_spark_metrics(self, spark_session) -> Dict:
        """Capture Spark job metrics."""
        # Would use Spark UI API in production
        return {
            "total_tasks": 1000,
            "completed_tasks": 1000,
            "failed_tasks": 0,
            "total_time_ms": 45000,
            "shuffle_read_gb": 2.5,
            "shuffle_write_gb": 1.2,
            "peak_memory_gb": 16
        }

    def analyze_query_performance(self, query_stats: Dict) -> Dict:
        """Analyze query performance and provide recommendations."""
        recommendations = []

        # Check execution time
        if query_stats.get("duration_ms", 0) > 30000:
            recommendations.append("Query running > 30s - consider optimization")

        # Check shuffle
        if query_stats.get("shuffle_read_gb", 0) > 10:
            recommendations.append("High shuffle - consider partitioning or broadcast joins")

        # Check spill
        if query_stats.get("spill_gb", 0) > 0:
            recommendations.append("Memory spill detected - increase executor memory or reduce data")

        # Check skew
        if query_stats.get("max_task_time_ms", 0) > query_stats.get("avg_task_time_ms", 1) * 10:
            recommendations.append("Data skew detected - consider salting or repartitioning")

        return {
            "stats": query_stats,
            "recommendations": recommendations,
            "health": "good" if len(recommendations) == 0 else "needs_attention"
        }

    def generate_performance_report(self) -> str:
        """Generate performance summary report."""
        return """
# Fabric Performance Report

## Summary
- Total Jobs Analyzed: {total}
- Average Duration: {avg_duration}s
- P95 Duration: {p95_duration}s
- Failed Jobs: {failed}

## Top Recommendations
1. Enable V-Order on frequently queried tables
2. Implement incremental refresh for large datasets
3. Review and optimize slow DAX measures
4. Consider aggregation tables for common patterns

## Action Items
- [ ] OPTIMIZE tables with >1000 files
- [ ] Update statistics on warehouse tables
- [ ] Review queries running >30s
- [ ] Enable auto-optimize on streaming tables
"""
```

Tomorrow, we'll dive into Direct Lake optimization!

