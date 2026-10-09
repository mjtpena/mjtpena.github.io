---
title: "Native Execution Engine in Microsoft Fabric"
description: "Native execution bypasses traditional JVM-based Spark execution to run queries using native code optimized for modern CPUs."
author: Michael John Peña
draft: false
date: 2024-08-22
tags:
  - Microsoft Fabric
  - Native Execution
  - Performance
  - Spark
  - Query Engine
---

## What is Native Execution?

Native execution bypasses traditional JVM-based Spark execution to run queries using native code optimized for modern CPUs.

```
Traditional Spark Execution:
┌─────────────────────────────────────────────────────────────┐
│  Query → Catalyst Optimizer → JVM Bytecode → Execution      │
│                                                              │
│  ┌─────────┐    ┌───────────┐    ┌─────────────────────┐   │
│  │ DataFrame│ → │ Optimized │ → │ JVM Interpreted/JIT │   │
│  │   API   │    │   Plan    │    │     Execution       │   │
│  └─────────┘    └───────────┘    └─────────────────────┘   │
│                                         ↓                   │
│                                   CPU Execution             │
│                                  (with JVM overhead)        │
└─────────────────────────────────────────────────────────────┘

Native Execution:
┌─────────────────────────────────────────────────────────────┐
│  Query → Catalyst → Native Code Generation → Direct CPU     │
│                                                              │
│  ┌─────────┐    ┌───────────┐    ┌─────────────────────┐   │
│  │ DataFrame│ → │ Optimized │ → │  Native Vectorized  │   │
│  │   API   │    │   Plan    │    │      Engine         │   │
│  └─────────┘    └───────────┘    └─────────────────────┘   │
│                                         ↓                   │
│                                   CPU Execution             │
│                              (SIMD, cache-optimized)        │
└─────────────────────────────────────────────────────────────┘
```

## Enabling Native Execution

### In Fabric Spark Notebooks

```python
# Native execution is enabled by default in Fabric
# To explicitly configure:

# Enable native execution engine
spark.conf.set("spark.native.enabled", "true")

# Configure native execution settings
spark.conf.set("spark.native.vectorized.enabled", "true")
spark.conf.set("spark.native.codegen.enabled", "true")
```

### Checking Native Execution Status

```python
def check_native_execution_status():
    """Check if native execution is enabled and available."""

    status = {
        "native_enabled": spark.conf.get("spark.native.enabled", "false"),
        "vectorized_enabled": spark.conf.get("spark.native.vectorized.enabled", "false"),
        "codegen_enabled": spark.conf.get("spark.native.codegen.enabled", "false")
    }

    # Check if query uses native execution
    def is_using_native(df):
        plan = df._jdf.queryExecution().executedPlan().toString()
        return "Native" in plan or "Vectorized" in plan

    return status

# Check status
status = check_native_execution_status()
print(f"Native Execution Status: {status}")
```

## Performance Benefits

### Vectorized Processing

```python
# Native execution uses SIMD (Single Instruction, Multiple Data)
# Processing multiple values in a single CPU instruction

# Example: Aggregation query
# Standard: Process row by row
# Native: Process 1024+ rows in parallel per CPU instruction

# This query benefits significantly from vectorization
vectorized_agg = spark.sql("""
    SELECT
        region,
        product_category,
        SUM(amount) as total_sales,
        AVG(quantity) as avg_quantity,
        COUNT(*) as order_count
    FROM sales
    WHERE order_date >= '2024-01-01'
    GROUP BY region, product_category
""")

# Operations that benefit most from vectorization:
# - Aggregations (SUM, AVG, COUNT, MIN, MAX)
# - Filters
# - Projections
# - Simple joins
```

### Benchmarking Native vs Standard

```python
import time

class NativeExecutionBenchmark:
    """Benchmark native vs standard execution."""

    def __init__(self, spark):
        self.spark = spark

    def benchmark_query(
        self,
        query: str,
        native_enabled: bool,
        iterations: int = 5
    ) -> dict:
        """Benchmark query with native execution on/off."""

        # Set native execution
        self.spark.conf.set("spark.native.enabled", str(native_enabled).lower())

        times = []
        for i in range(iterations):
            self.spark.catalog.clearCache()

            start = time.time()
            result = self.spark.sql(query)
            _ = result.collect()
            elapsed = time.time() - start

            if i > 0:  # Skip cold run
                times.append(elapsed)

        return {
            "native_enabled": native_enabled,
            "avg_time": sum(times) / len(times),
            "min_time": min(times),
            "max_time": max(times)
        }

    def compare_performance(self, query: str) -> dict:
        """Compare native vs standard performance."""

        standard = self.benchmark_query(query, native_enabled=False)
        native = self.benchmark_query(query, native_enabled=True)

        speedup = standard["avg_time"] / native["avg_time"] if native["avg_time"] > 0 else 0

        return {
            "standard_execution": standard,
            "native_execution": native,
            "speedup": f"{speedup:.2f}x",
            "time_saved_percent": (1 - native["avg_time"]/standard["avg_time"]) * 100
        }

# Usage
benchmark = NativeExecutionBenchmark(spark)

# Benchmark aggregation query
results = benchmark.compare_performance("""
    SELECT
        region,
        DATE_TRUNC('month', order_date) as month,
        SUM(amount) as revenue,
        COUNT(DISTINCT customer_id) as customers
    FROM sales
    GROUP BY region, DATE_TRUNC('month', order_date)
""")

print(f"Speedup: {results['speedup']}")
print(f"Time saved: {results['time_saved_percent']:.1f}%")
```

## Supported Operations

### Operations with Native Support

```python
native_supported_operations = {
    "aggregations": {
        "functions": ["SUM", "AVG", "COUNT", "MIN", "MAX", "STDDEV", "VARIANCE"],
        "performance_gain": "2-10x typical",
        "notes": "Best gains on large aggregations"
    },
    "filters": {
        "functions": ["WHERE", "HAVING", "comparison operators"],
        "performance_gain": "2-5x typical",
        "notes": "Vectorized predicate evaluation"
    },
    "projections": {
        "functions": ["SELECT columns", "column expressions"],
        "performance_gain": "1.5-3x typical",
        "notes": "Efficient column extraction"
    },
    "joins": {
        "functions": ["INNER JOIN", "LEFT JOIN", "broadcast joins"],
        "performance_gain": "2-4x for supported types",
        "notes": "Hash joins work best"
    },
    "window_functions": {
        "functions": ["ROW_NUMBER", "RANK", "LAG", "LEAD", "running aggregates"],
        "performance_gain": "2-5x typical",
        "notes": "Vectorized window computations"
    }
}

# Check operation support
def is_operation_native_optimized(operation: str) -> dict:
    for category, details in native_supported_operations.items():
        if operation.upper() in [f.upper() for f in details["functions"]]:
            return {
                "supported": True,
                "category": category,
                "expected_gain": details["performance_gain"],
                "notes": details["notes"]
            }

    return {"supported": False, "notes": "May fall back to standard execution"}

# Example
print(is_operation_native_optimized("SUM"))
print(is_operation_native_optimized("COMPLEX_UDF"))
```

### Operations that Fall Back to Standard Execution

```python
# Some operations don't have native support yet
# They fall back to standard JVM-based execution

fallback_operations = [
    "Complex UDFs (User Defined Functions)",
    "Certain string operations",
    "Some date/time functions",
    "Complex nested data types",
    "Some window function edge cases"
]

# To maximize native execution benefits:
# 1. Avoid UDFs where possible
# 2. Use built-in SQL functions
# 3. Flatten complex nested structures
```

## Optimizing for Native Execution

### Query Patterns that Benefit

```python
# GOOD: Simple aggregations - highly optimized
good_pattern_1 = """
SELECT
    region,
    SUM(amount) as total,
    COUNT(*) as cnt
FROM sales
GROUP BY region
"""

# GOOD: Filtered aggregations
good_pattern_2 = """
SELECT
    product_id,
    AVG(price) as avg_price
FROM products
WHERE category = 'Electronics'
GROUP BY product_id
"""

# GOOD: Window functions
good_pattern_3 = """
SELECT
    order_id,
    customer_id,
    amount,
    SUM(amount) OVER (PARTITION BY customer_id ORDER BY order_date) as running_total
FROM orders
"""

# LESS OPTIMAL: Complex UDFs
# This forces fallback to standard execution
from pyspark.sql.functions import udf

@udf("string")
def custom_transform(value):
    # Complex logic
    return value.upper() + "_transformed"

# Using UDF reduces native execution benefits
less_optimal = df.withColumn("transformed", custom_transform(col("name")))

# BETTER: Use built-in functions
from pyspark.sql.functions import upper, concat, lit

better = df.withColumn("transformed", concat(upper(col("name")), lit("_transformed")))
```

### Data Layout Optimization

```python
class NativeExecutionOptimizer:
    """Optimize data layout for native execution."""

    def __init__(self, spark):
        self.spark = spark

    def optimize_table_for_native(self, table_path: str):
        """Optimize table for native execution performance."""

        # 1. Ensure V-Order (helps with vectorized reads)
        self.spark.sql(f"""
            ALTER TABLE delta.`{table_path}`
            SET TBLPROPERTIES ('delta.parquet.vorder.enabled' = 'true')
        """)

        # 2. Optimize file sizes for vectorized processing
        # Target 128-256MB files
        delta_table = DeltaTable.forPath(self.spark, table_path)
        delta_table.optimize().executeCompaction()

        # 3. Compute statistics for optimizer
        self.spark.sql(f"ANALYZE TABLE delta.`{table_path}` COMPUTE STATISTICS")

    def configure_for_native(self):
        """Configure Spark for optimal native execution."""

        configs = {
            "spark.native.enabled": "true",
            "spark.native.vectorized.enabled": "true",
            "spark.sql.parquet.enableVectorizedReader": "true",
            "spark.sql.codegen.wholeStage": "true"
        }

        for key, value in configs.items():
            self.spark.conf.set(key, value)

# Usage
optimizer = NativeExecutionOptimizer(spark)
optimizer.configure_for_native()
optimizer.optimize_table_for_native("Tables/fact_sales")
```

## Monitoring Native Execution

### Execution Plan Analysis

```python
def analyze_native_execution(df) -> dict:
    """Analyze if query uses native execution."""

    # Get physical plan
    plan_string = df._jdf.queryExecution().executedPlan().toString()

    analysis = {
        "uses_native": "Native" in plan_string or "Columnar" in plan_string,
        "vectorized": "Vectorized" in plan_string,
        "codegen": "WholeStageCodegen" in plan_string,
        "plan_snippet": plan_string[:500]
    }

    # Check for fallback indicators
    if "BatchScan" in plan_string:
        analysis["scan_type"] = "Native Batch Scan"
    elif "FileScan" in plan_string:
        analysis["scan_type"] = "Standard File Scan"

    return analysis

# Usage
query = spark.sql("""
    SELECT region, SUM(amount) as total
    FROM sales
    GROUP BY region
""")

analysis = analyze_native_execution(query)
print(f"Uses Native Execution: {analysis['uses_native']}")
print(f"Vectorized: {analysis['vectorized']}")
```

### Performance Metrics

```python
class NativeExecutionMetrics:
    """Track native execution performance metrics."""

    def __init__(self, spark):
        self.spark = spark
        self.metrics = []

    def track_query(self, query: str, name: str):
        """Track query execution metrics."""

        import time

        start = time.time()
        result = self.spark.sql(query)
        count = result.count()
        elapsed = time.time() - start

        # Analyze execution
        analysis = analyze_native_execution(result)

        metric = {
            "name": name,
            "query": query[:100],
            "execution_time": elapsed,
            "row_count": count,
            "native_execution": analysis["uses_native"],
            "vectorized": analysis["vectorized"]
        }

        self.metrics.append(metric)
        return metric

    def get_summary(self) -> dict:
        """Get summary of tracked queries."""

        if not self.metrics:
            return {}

        native_queries = [m for m in self.metrics if m["native_execution"]]
        standard_queries = [m for m in self.metrics if not m["native_execution"]]

        return {
            "total_queries": len(self.metrics),
            "native_queries": len(native_queries),
            "standard_queries": len(standard_queries),
            "avg_native_time": sum(m["execution_time"] for m in native_queries) / len(native_queries) if native_queries else 0,
            "avg_standard_time": sum(m["execution_time"] for m in standard_queries) / len(standard_queries) if standard_queries else 0
        }

# Usage
metrics = NativeExecutionMetrics(spark)

metrics.track_query("SELECT SUM(amount) FROM sales", "total_sales")
metrics.track_query("SELECT region, COUNT(*) FROM sales GROUP BY region", "sales_by_region")

summary = metrics.get_summary()
print(f"Native queries: {summary['native_queries']}/{summary['total_queries']}")
```

## Best Practices

1. **Keep native enabled**: Default on in Fabric for good reason
2. **Avoid UDFs**: Use built-in functions when possible
3. **Optimize data layout**: V-Order and proper file sizes help
4. **Use columnar operations**: Aggregations, filters, projections
5. **Monitor execution plans**: Verify native path is used

## Conclusion

Native execution in Microsoft Fabric provides significant performance improvements for analytical queries. Most workloads benefit automatically, but understanding which operations are optimized helps you write queries that fully leverage the native engine.

Focus on using built-in functions, proper data layout, and monitoring to ensure you're getting the maximum performance benefit from native execution.
