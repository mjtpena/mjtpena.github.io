---
title: "Query Performance Optimization in Microsoft Fabric"
author: "Michael John Peña"
draft: false
date: 2023-12-23
tags: ["Microsoft Fabric", "Performance", "Query Optimization", "SQL", "Spark"]

---

I wrote "Query Performance Optimization in Microsoft Fabric" to share practical, production-minded guidance on this topic.

Query performance is where UX and cost meet. My practical approach is to measure user-facing latency, inspect query plans, and prioritise optimisations that reduce I/O and cost — broadcast joins, predicate pushdown and careful partitioning are usually first on my list.

## Spark Query Optimization

## Spark Query Optimization

```python
from dataclasses import dataclass
from typing import List

@dataclass
class SparkOptimization:
    technique: str
    problem_solved: str
    implementation: str
    impact: str

spark_optimizations = [
    SparkOptimization(
        technique="Broadcast Joins",
        problem_solved="Slow joins with small dimension tables",
        implementation="""
from pyspark.sql.functions import broadcast

# Broadcast small table to avoid shuffle
result = large_df.join(
    broadcast(small_df),
    "join_key"
)

# Or use hint
result = large_df.join(small_df.hint("broadcast"), "join_key")

# Configure broadcast threshold
spark.conf.set("spark.sql.autoBroadcastJoinThreshold", "100m")  # 100MB
""",
        impact="10-100x faster joins with small tables"
    ),
    SparkOptimization(
        technique="Predicate Pushdown",
        problem_solved="Reading unnecessary data",
        implementation="""
# GOOD: Filter pushed down to storage
df = spark.table("large_table").filter("date >= '2023-01-01'")

# BAD: Filter applied after full scan
df = spark.table("large_table")
df = df.filter("date >= '2023-01-01'")  # May not push down

# Verify pushdown in query plan
df.explain(True)

# For Delta, check pruning
spark.conf.set("spark.databricks.delta.stats.collect", "true")
""",
        impact="Up to 99% data reduction for selective queries"
    ),
    SparkOptimization(
        technique="Column Pruning",
        problem_solved="Reading unnecessary columns",
        implementation="""
# GOOD: Select only needed columns early
df = spark.table("wide_table").select("col1", "col2", "col3")

# BAD: Select all then filter
df = spark.table("wide_table")  # Reads all columns
result = df.select("col1", "col2", "col3")

# Tip: Use schema hints for complex tables
schema = "col1 STRING, col2 INT, col3 DOUBLE"
df = spark.read.schema(schema).table("wide_table")
""",
        impact="Significant I/O reduction for wide tables"
    ),
    SparkOptimization(
        technique="Partition Pruning",
        problem_solved="Scanning all partitions",
        implementation="""
# Ensure filter on partition column
df = spark.table("partitioned_table").filter("year = 2023 AND month = 12")

# Verify partition pruning
df.explain(True)  # Should show "PartitionFilters"

# Dynamic partition pruning for joins
spark.conf.set("spark.sql.optimizer.dynamicPartitionPruning.enabled", "true")
""",
        impact="Scan only relevant partitions"
    ),
    SparkOptimization(
        technique="Caching",
        problem_solved="Repeated computation",
        implementation="""
# Cache DataFrame used multiple times
df = spark.table("reference_data")
df.cache()
df.count()  # Materialize cache

# Use appropriate storage level
from pyspark import StorageLevel
df.persist(StorageLevel.MEMORY_AND_DISK)

# Unpersist when done
df.unpersist()
""",
        impact="Eliminate repeated computation"
    )
]

def analyze_spark_query_plan(query: str) -> dict:
    """Analyze Spark query plan for optimization opportunities."""
    # In production, would parse actual query plan
    analysis = {
        "query": query,
        "opportunities": [],
        "warnings": []
    }

    # Check for common issues
    if "SELECT *" in query.upper():
        analysis["opportunities"].append("Use explicit column list instead of SELECT *")

    if "CROSS JOIN" in query.upper():
        analysis["warnings"].append("CROSS JOIN detected - ensure this is intentional")

    if "DISTINCT" in query.upper():
        analysis["opportunities"].append("Consider if DISTINCT is necessary - expensive operation")

    return analysis
```

## SQL Query Optimization

```python
sql_optimizations = {
    "indexing_awareness": {
        "description": "Write queries that leverage columnstore indexes",
        "good_example": """
-- Good: Aggregate query (columnstore optimized)
SELECT
    customer_segment,
    SUM(revenue) as total_revenue,
    COUNT(*) as order_count
FROM fact_orders
GROUP BY customer_segment;
""",
        "bad_example": """
-- Bad: Point lookup (better for rowstore)
SELECT * FROM fact_orders WHERE order_id = 12345;
-- Consider: Create separate lookup table for OLTP patterns
"""
    },
    "sargable_predicates": {
        "description": "Write search-argument-able predicates",
        "good_example": """
-- Good: Index can be used
SELECT * FROM orders WHERE order_date >= '2023-01-01';

-- Good: Direct comparison
SELECT * FROM customers WHERE customer_id = 123;
""",
        "bad_example": """
-- Bad: Function on column prevents index use
SELECT * FROM orders WHERE YEAR(order_date) = 2023;

-- Bad: Leading wildcard
SELECT * FROM customers WHERE name LIKE '%Smith';

-- Bad: Implicit conversion
SELECT * FROM orders WHERE order_id = '123';  -- if order_id is INT
"""
    },
    "join_optimization": {
        "description": "Optimize join operations",
        "tips": [
            "Join on indexed columns",
            "Put smaller table first in older SQL dialects",
            "Use explicit JOIN syntax",
            "Avoid joining on expressions"
        ],
        "example": """
-- Good: Explicit JOIN with indexed columns
SELECT c.name, o.order_date, o.total
FROM customers c
INNER JOIN orders o ON c.customer_id = o.customer_id
WHERE c.segment = 'Enterprise';

-- Consider: CTEs for complex queries
WITH enterprise_customers AS (
    SELECT customer_id, name
    FROM customers
    WHERE segment = 'Enterprise'
)
SELECT ec.name, o.order_date
FROM enterprise_customers ec
INNER JOIN orders o ON ec.customer_id = o.customer_id;
"""
    },
    "aggregation_optimization": {
        "description": "Optimize aggregate queries",
        "tips": [
            "Filter before aggregating",
            "Use appropriate GROUP BY columns",
            "Consider pre-aggregated tables"
        ],
        "example": """
-- Good: Filter early
SELECT category, SUM(amount)
FROM sales
WHERE sale_date >= '2023-01-01'  -- Filter first
GROUP BY category;

-- Better: Use aggregation table for common patterns
-- Pre-computed in ETL:
SELECT category, SUM(daily_total)
FROM sales_daily_agg  -- Much smaller table
WHERE sale_date >= '2023-01-01'
GROUP BY category;
"""
    }
}
```

## Query Tuning Workflow

```python
class QueryTuner:
    """Systematic query tuning workflow."""

    def __init__(self):
        self.tuning_steps = [
            "Understand the query intent",
            "Check execution plan",
            "Identify bottlenecks",
            "Apply optimizations",
            "Verify improvement",
            "Document changes"
        ]

    def analyze_slow_query(self, query: str, execution_stats: dict) -> dict:
        """Analyze a slow query and provide recommendations."""
        recommendations = []

        # Check duration
        if execution_stats.get("duration_ms", 0) > 30000:
            recommendations.append("Query running > 30 seconds - needs optimization")

        # Check data scanned
        data_scanned_gb = execution_stats.get("data_scanned_gb", 0)
        if data_scanned_gb > 100:
            recommendations.append(f"Scanning {data_scanned_gb}GB - add filters or partitioning")

        # Check shuffle
        shuffle_gb = execution_stats.get("shuffle_gb", 0)
        if shuffle_gb > 10:
            recommendations.append("High shuffle - consider broadcast joins or repartitioning")

        # Check spill
        if execution_stats.get("spill_gb", 0) > 0:
            recommendations.append("Memory spill detected - reduce data volume or increase memory")

        return {
            "query_preview": query[:200],
            "stats": execution_stats,
            "recommendations": recommendations,
            "priority": "HIGH" if len(recommendations) >= 3 else "MEDIUM"
        }

    def generate_tuning_report(self, queries: list) -> str:
        """Generate query tuning report."""
        report = """
# Query Performance Tuning Report

## Summary
- Queries Analyzed: {count}
- High Priority: {high}
- Medium Priority: {medium}

## Detailed Analysis
""".format(
            count=len(queries),
            high=sum(1 for q in queries if q.get("priority") == "HIGH"),
            medium=sum(1 for q in queries if q.get("priority") == "MEDIUM")
        )

        for i, query in enumerate(queries[:10], 1):
            report += f"""
### Query {i} ({query.get('priority', 'N/A')} Priority)

**Preview:** `{query.get('query_preview', 'N/A')}`

**Recommendations:**
"""
            for rec in query.get("recommendations", []):
                report += f"- {rec}\n"

        return report
```

Tomorrow, we'll explore capacity management in Fabric!

