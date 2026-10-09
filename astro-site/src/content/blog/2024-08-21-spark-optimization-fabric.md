---
title: "Spark Optimization in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-08-21
tags:
  - Microsoft Fabric
  - Apache Spark
  - Performance
  - Optimization
  - Data Engineering
---

## Spark Architecture in Fabric

```
┌─────────────────────────────────────────────────────────────┐
│                   Fabric Spark Pool                          │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                    Driver                            │    │
│  │   ┌─────────┐ ┌─────────┐ ┌─────────────────────┐   │    │
│  │   │ SparkUI │ │ Context │ │ Catalyst Optimizer  │   │    │
│  │   └─────────┘ └─────────┘ └─────────────────────┘   │    │
│  └─────────────────────────────────────────────────────┘    │
│                            │                                 │
│       ┌────────────────────┼────────────────────┐           │
│       │                    │                    │           │
│  ┌────▼────┐          ┌────▼────┐          ┌────▼────┐     │
│  │Executor │          │Executor │          │Executor │     │
│  │  ┌───┐  │          │  ┌───┐  │          │  ┌───┐  │     │
│  │  │ T │  │          │  │ T │  │          │  │ T │  │     │
│  │  └───┘  │          │  └───┘  │          │  └───┘  │     │
│  │  ┌───┐  │          │  ┌───┐  │          │  ┌───┐  │     │
│  │  │ T │  │          │  │ T │  │          │  │ T │  │     │
│  │  └───┘  │          │  └───┘  │          │  └───┘  │     │
│  └─────────┘          └─────────┘          └─────────┘     │
│                                                             │
│                       OneLake Storage                       │
└─────────────────────────────────────────────────────────────┘
```

## Memory and Executor Configuration

### Optimizing Memory Allocation

```python
class SparkMemoryOptimizer:
    """Optimize Spark memory configuration."""

    def __init__(self, spark):
        self.spark = spark

    def configure_memory(
        self,
        executor_memory_gb: int = 8,
        memory_fraction: float = 0.6,
        storage_fraction: float = 0.5
    ):
        """Configure memory settings."""

        configs = {
            # Executor memory
            "spark.executor.memory": f"{executor_memory_gb}g",

            # Memory fraction for execution and storage
            "spark.memory.fraction": str(memory_fraction),

            # Within memory fraction, how much for storage
            "spark.memory.storageFraction": str(storage_fraction),

            # Off-heap memory
            "spark.memory.offHeap.enabled": "true",
            "spark.memory.offHeap.size": f"{executor_memory_gb // 2}g"
        }

        for key, value in configs.items():
            self.spark.conf.set(key, value)

        return configs

    def get_memory_recommendations(self, workload_type: str) -> dict:
        """Get memory recommendations based on workload."""

        recommendations = {
            "etl_heavy": {
                "executor_memory_gb": 16,
                "memory_fraction": 0.6,
                "storage_fraction": 0.3,
                "reason": "More memory for shuffles, less for caching"
            },
            "ml_training": {
                "executor_memory_gb": 32,
                "memory_fraction": 0.7,
                "storage_fraction": 0.5,
                "reason": "Large memory for model training and feature caching"
            },
            "streaming": {
                "executor_memory_gb": 8,
                "memory_fraction": 0.5,
                "storage_fraction": 0.4,
                "reason": "Balanced for continuous processing"
            },
            "interactive": {
                "executor_memory_gb": 8,
                "memory_fraction": 0.6,
                "storage_fraction": 0.5,
                "reason": "Default balanced configuration"
            }
        }

        return recommendations.get(workload_type, recommendations["interactive"])

# Usage
optimizer = SparkMemoryOptimizer(spark)

# Get recommendations
rec = optimizer.get_memory_recommendations("etl_heavy")
print(f"Recommended config: {rec}")

# Apply configuration
optimizer.configure_memory(
    executor_memory_gb=rec["executor_memory_gb"],
    memory_fraction=rec["memory_fraction"],
    storage_fraction=rec["storage_fraction"]
)
```

### Parallelism Configuration

```python
class ParallelismOptimizer:
    """Optimize parallelism settings."""

    def __init__(self, spark):
        self.spark = spark

    def configure_parallelism(
        self,
        default_parallelism: int = None,
        shuffle_partitions: int = None,
        max_partition_bytes: str = "128MB"
    ):
        """Set parallelism configuration."""

        if default_parallelism:
            self.spark.conf.set(
                "spark.default.parallelism",
                str(default_parallelism)
            )

        if shuffle_partitions:
            self.spark.conf.set(
                "spark.sql.shuffle.partitions",
                str(shuffle_partitions)
            )

        self.spark.conf.set(
            "spark.sql.files.maxPartitionBytes",
            max_partition_bytes
        )

    def auto_configure(self, data_size_gb: float, num_cores: int):
        """Automatically configure based on data and resources."""

        # Rule of thumb: 2-4 tasks per core
        recommended_parallelism = num_cores * 3

        # For shuffle: balance between parallelism and overhead
        # ~128MB per partition is a good target
        estimated_partitions = int(data_size_gb * 1024 / 128)
        shuffle_partitions = max(recommended_parallelism, estimated_partitions)

        self.configure_parallelism(
            default_parallelism=recommended_parallelism,
            shuffle_partitions=shuffle_partitions
        )

        return {
            "default_parallelism": recommended_parallelism,
            "shuffle_partitions": shuffle_partitions,
            "reasoning": f"Based on {num_cores} cores and {data_size_gb}GB data"
        }

# Usage
parallel = ParallelismOptimizer(spark)

# Auto-configure based on workload
config = parallel.auto_configure(data_size_gb=100, num_cores=32)
print(f"Configured: {config}")
```

## Shuffle Optimization

### Reducing Shuffle Overhead

```python
from pyspark.sql.functions import col, broadcast

class ShuffleOptimizer:
    """Optimize shuffle operations."""

    def __init__(self, spark):
        self.spark = spark

    def configure_shuffle(self):
        """Configure shuffle-related settings."""

        configs = {
            # Compression
            "spark.shuffle.compress": "true",
            "spark.shuffle.spill.compress": "true",

            # File consolidation
            "spark.shuffle.consolidateFiles": "true",

            # Shuffle service
            "spark.shuffle.service.enabled": "true",

            # Buffer sizes
            "spark.reducer.maxSizeInFlight": "96m",
            "spark.shuffle.file.buffer": "64k"
        }

        for key, value in configs.items():
            self.spark.conf.set(key, value)

    def avoid_shuffle_with_broadcast(self, large_df, small_df, join_key: str):
        """Use broadcast to avoid shuffle join."""

        return large_df.join(broadcast(small_df), join_key)

    def repartition_before_join(
        self,
        df1,
        df2,
        join_key: str,
        num_partitions: int = 200
    ):
        """Repartition both sides before join."""

        df1_partitioned = df1.repartition(num_partitions, col(join_key))
        df2_partitioned = df2.repartition(num_partitions, col(join_key))

        return df1_partitioned.join(df2_partitioned, join_key)

    def coalesce_after_filter(self, df, target_partitions: int = None):
        """Reduce partitions after filtering reduces data."""

        if target_partitions is None:
            # Estimate based on remaining data
            count = df.count()
            target_partitions = max(1, count // 1000000)  # ~1M rows per partition

        return df.coalesce(target_partitions)

# Usage
shuffle_opt = ShuffleOptimizer(spark)
shuffle_opt.configure_shuffle()

# Broadcast small table
orders = spark.read.format("delta").load("Tables/orders")
products = spark.read.format("delta").load("Tables/products")  # Small dimension

joined = shuffle_opt.avoid_shuffle_with_broadcast(orders, products, "product_id")
```

### Handling Skewed Data

```python
class SkewHandler:
    """Handle data skew in Spark operations."""

    def __init__(self, spark):
        self.spark = spark

    def enable_adaptive_skew_handling(self):
        """Enable AQE skew handling."""

        configs = {
            "spark.sql.adaptive.enabled": "true",
            "spark.sql.adaptive.skewJoin.enabled": "true",
            "spark.sql.adaptive.skewJoin.skewedPartitionFactor": "5",
            "spark.sql.adaptive.skewJoin.skewedPartitionThresholdInBytes": "256MB"
        }

        for key, value in configs.items():
            self.spark.conf.set(key, value)

    def detect_skew(self, df, column: str) -> dict:
        """Detect skew in a column."""

        from pyspark.sql.functions import count, col

        distribution = df.groupBy(column) \
            .agg(count("*").alias("cnt")) \
            .orderBy(col("cnt").desc()) \
            .limit(20)

        rows = distribution.collect()

        total = sum(row.cnt for row in rows)
        max_count = rows[0].cnt if rows else 0

        skew_ratio = max_count / (total / len(rows)) if rows else 0

        return {
            "column": column,
            "top_value": rows[0][column] if rows else None,
            "max_count": max_count,
            "skew_ratio": skew_ratio,
            "is_skewed": skew_ratio > 5,
            "distribution": [(row[column], row.cnt) for row in rows[:5]]
        }

    def salted_join(
        self,
        skewed_df,
        normal_df,
        join_key: str,
        skewed_key_value,
        num_salts: int = 10
    ):
        """Handle skew with salting technique."""

        from pyspark.sql.functions import when, floor, rand, concat, lit, explode, array

        # Add salt to skewed key
        skewed_salted = skewed_df.withColumn(
            "salt",
            when(
                col(join_key) == skewed_key_value,
                floor(rand() * num_salts)
            ).otherwise(lit(0))
        ).withColumn(
            "salted_key",
            concat(col(join_key), lit("_"), col("salt"))
        )

        # Explode normal table for skewed key
        normal_exploded = normal_df.withColumn(
            "salts",
            when(
                col(join_key) == skewed_key_value,
                array([lit(i) for i in range(num_salts)])
            ).otherwise(array(lit(0)))
        ).withColumn(
            "salt",
            explode(col("salts"))
        ).withColumn(
            "salted_key",
            concat(col(join_key), lit("_"), col("salt"))
        ).drop("salts")

        # Join on salted key
        result = skewed_salted.join(
            normal_exploded,
            "salted_key"
        ).drop("salted_key", "salt")

        return result

# Usage
skew_handler = SkewHandler(spark)
skew_handler.enable_adaptive_skew_handling()

# Detect skew
skew_analysis = skew_handler.detect_skew(orders, "customer_id")
print(f"Skew detected: {skew_analysis['is_skewed']}")
print(f"Top value: {skew_analysis['top_value']} ({skew_analysis['max_count']} rows)")
```

## Caching Strategies

### Effective Caching

```python
class CacheManager:
    """Manage Spark caching effectively."""

    def __init__(self, spark):
        self.spark = spark
        self.cached_dfs = {}

    def smart_cache(self, df, name: str, storage_level: str = "MEMORY_AND_DISK"):
        """Cache with appropriate storage level."""

        from pyspark import StorageLevel

        levels = {
            "MEMORY_ONLY": StorageLevel.MEMORY_ONLY,
            "MEMORY_AND_DISK": StorageLevel.MEMORY_AND_DISK,
            "DISK_ONLY": StorageLevel.DISK_ONLY,
            "MEMORY_ONLY_SER": StorageLevel.MEMORY_ONLY_SER,
            "MEMORY_AND_DISK_SER": StorageLevel.MEMORY_AND_DISK_SER
        }

        cached_df = df.persist(levels.get(storage_level, StorageLevel.MEMORY_AND_DISK))
        self.cached_dfs[name] = cached_df

        return cached_df

    def should_cache(self, df, reuse_count: int) -> bool:
        """Determine if caching is beneficial."""

        # Cache if reused multiple times
        # Cache overhead must be worth it
        return reuse_count >= 2

    def cache_dimension_tables(self, dimension_tables: dict):
        """Cache dimension tables for star schema queries."""

        for name, path in dimension_tables.items():
            df = self.spark.read.format("delta").load(path)
            self.smart_cache(df, name, "MEMORY_ONLY")
            print(f"Cached {name}")

    def clear_cache(self, name: str = None):
        """Clear specific or all caches."""

        if name:
            if name in self.cached_dfs:
                self.cached_dfs[name].unpersist()
                del self.cached_dfs[name]
        else:
            for cached_name, df in self.cached_dfs.items():
                df.unpersist()
            self.cached_dfs.clear()
            self.spark.catalog.clearCache()

    def get_cache_status(self) -> dict:
        """Get status of cached DataFrames."""

        return {
            name: {
                "is_cached": df.is_cached,
                "storage_level": str(df.storageLevel)
            }
            for name, df in self.cached_dfs.items()
        }

# Usage
cache_mgr = CacheManager(spark)

# Cache dimension tables
cache_mgr.cache_dimension_tables({
    "products": "Tables/dim_products",
    "customers": "Tables/dim_customers",
    "dates": "Tables/dim_dates"
})

# Use cached tables in queries
products_cached = cache_mgr.cached_dfs["products"]
customers_cached = cache_mgr.cached_dfs["customers"]

# Clear when done
cache_mgr.clear_cache()
```

## I/O Optimization

### File Reading Optimization

```python
class IOOptimizer:
    """Optimize Spark I/O operations."""

    def __init__(self, spark):
        self.spark = spark

    def configure_io(self):
        """Configure I/O settings."""

        configs = {
            # Parquet optimizations
            "spark.sql.parquet.filterPushdown": "true",
            "spark.sql.parquet.enableVectorizedReader": "true",

            # Delta optimizations
            "spark.databricks.delta.optimizeWrite.enabled": "true",

            # File handling
            "spark.sql.files.openCostInBytes": "4194304",  # 4MB
            "spark.sql.files.maxPartitionBytes": "134217728"  # 128MB
        }

        for key, value in configs.items():
            self.spark.conf.set(key, value)

    def read_with_schema(self, path: str, schema):
        """Read with explicit schema for faster parsing."""

        return self.spark.read.format("delta") \
            .schema(schema) \
            .load(path)

    def read_with_column_pruning(self, path: str, columns: list):
        """Read only necessary columns."""

        return self.spark.read.format("delta") \
            .load(path) \
            .select(*columns)

    def optimized_write(
        self,
        df,
        path: str,
        mode: str = "overwrite",
        partition_by: list = None,
        coalesce_to: int = None
    ):
        """Write with optimizations."""

        writer = df

        if coalesce_to:
            writer = writer.coalesce(coalesce_to)

        write_builder = writer.write.format("delta") \
            .mode(mode) \
            .option("optimizeWrite", "true")

        if partition_by:
            write_builder = write_builder.partitionBy(*partition_by)

        write_builder.save(path)

# Usage
io_opt = IOOptimizer(spark)
io_opt.configure_io()

# Read only needed columns
sales = io_opt.read_with_column_pruning(
    "Tables/sales",
    ["order_id", "order_date", "amount", "region"]
)

# Write with optimization
io_opt.optimized_write(
    df=processed_sales,
    path="Tables/sales_processed",
    partition_by=["order_date"],
    coalesce_to=10
)
```

## Monitoring and Debugging

### Performance Metrics

```python
class SparkMonitor:
    """Monitor Spark job performance."""

    def __init__(self, spark):
        self.spark = spark

    def get_job_metrics(self) -> dict:
        """Get metrics from Spark UI programmatically."""

        # Access Spark listener for metrics
        sc = self.spark.sparkContext

        return {
            "application_id": sc.applicationId,
            "executor_memory": sc.getConf().get("spark.executor.memory"),
            "executor_cores": sc.getConf().get("spark.executor.cores"),
            "default_parallelism": sc.defaultParallelism
        }

    def explain_job(self, df):
        """Get detailed execution plan."""

        plans = {
            "parsed": df._jdf.queryExecution().logical().toString(),
            "analyzed": df._jdf.queryExecution().analyzed().toString(),
            "optimized": df._jdf.queryExecution().optimizedPlan().toString(),
            "physical": df._jdf.queryExecution().sparkPlan().toString()
        }

        return plans

    def analyze_stage_metrics(self):
        """Analyze metrics from completed stages."""

        # This would typically come from Spark History Server
        # Or Spark UI REST API

        return {
            "recommendation": "Check Spark UI for detailed stage metrics",
            "url": f"Check the Spark UI in your Fabric workspace"
        }

# Usage
monitor = SparkMonitor(spark)

metrics = monitor.get_job_metrics()
print(f"Executor Memory: {metrics['executor_memory']}")
print(f"Default Parallelism: {metrics['default_parallelism']}")
```

## Best Practices Summary

1. **Enable AQE**: Adaptive Query Execution handles many optimizations automatically
2. **Right-size partitions**: Target 128MB partitions
3. **Broadcast small tables**: Avoid shuffles when possible
4. **Handle skew**: Use salting or AQE skew handling
5. **Cache wisely**: Only cache when data is reused
6. **Prune columns early**: Select only needed columns

## Conclusion

Spark optimization in Microsoft Fabric combines proper configuration, smart data handling, and understanding of distributed computing principles. Start with AQE enabled, then tune based on your specific workload characteristics.

Regular monitoring and iterative tuning ensure your Spark jobs remain efficient as data volumes and requirements evolve.
