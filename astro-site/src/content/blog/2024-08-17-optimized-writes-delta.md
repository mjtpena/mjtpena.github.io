---
title: "Optimized Writes in Delta Lake"
author: Michael John Peña
draft: false
date: 2024-08-17
tags:
  - Delta Lake
  - Microsoft Fabric
  - Optimized Write
  - Performance
  - Data Engineering

---

I wrote "Optimized Writes in Delta Lake" to share practical, production-minded guidance on this topic.

## What is Optimized Write?

```
Standard Write:
┌────────────────────────────────────────────────────────────┐
│  Spark Partitions → Direct Write → Many Small Files        │
│                                                            │
│  Partition 1 ──► 5MB file                                  │
│  Partition 2 ──► 3MB file                                  │
│  Partition 3 ──► 8MB file                                  │
│  Partition 4 ──► 2MB file                                  │
│  ...                                                       │
│  Result: 100+ small files (avg 5MB)                        │
└────────────────────────────────────────────────────────────┘

Optimized Write:
┌────────────────────────────────────────────────────────────┐
│  Spark Partitions → Bin Packing → Optimal Files            │
│                                                            │
│  Partitions ──► Shuffle/Bin ──► 128MB file                 │
│              ──► Shuffle/Bin ──► 128MB file                │
│              ──► Shuffle/Bin ──► 45MB file (remainder)     │
│                                                            │
│  Result: 3 well-sized files (avg 100MB)                    │
└────────────────────────────────────────────────────────────┘
```

## Enabling Optimized Write

### Session Level

```python
# Enable for entire Spark session
spark.conf.set("spark.databricks.delta.optimizeWrite.enabled", "true")
spark.conf.set("spark.databricks.delta.optimizeWrite.binSize", "134217728")  # 128MB

# For Fabric Spark
spark.conf.set("spark.microsoft.delta.optimizeWrite.enabled", "true")
spark.conf.set("spark.microsoft.delta.optimizeWrite.binSize", "268435456")  # 256MB for Direct Lake
```

### Table Level

```python
# Enable on specific table
spark.sql("""
    ALTER TABLE sales
    SET TBLPROPERTIES ('delta.autoOptimize.optimizeWrite' = 'true')
""")

# Create table with optimized write enabled
spark.sql("""
    CREATE TABLE optimized_sales (
        order_id BIGINT,
        order_date DATE,
        customer_id BIGINT,
        amount DECIMAL(10,2)
    )
    USING DELTA
    TBLPROPERTIES ('delta.autoOptimize.optimizeWrite' = 'true')
""")

# Or via DataFrame API
df.write.format("delta") \
    .option("delta.autoOptimize.optimizeWrite", "true") \
    .saveAsTable("sales_optimized")
```

### Write-Level

```python
# Enable per write operation
df.write.format("delta") \
    .option("optimizeWrite", "true") \
    .mode("append") \
    .save("Tables/sales")

# With specific bin size
df.write.format("delta") \
    .option("optimizeWrite", "true") \
    .option("optimizeWrite.binSize", "268435456") \
    .mode("append") \
    .save("Tables/sales")
```

## Bin Size Configuration

### Choosing the Right Bin Size

```python
class OptimizedWriteConfig:
    """Configure optimized write settings for different scenarios."""

    def __init__(self, spark):
        self.spark = spark

    def configure_for_workload(self, workload_type: str):
        """Configure optimized write based on workload."""

        configs = {
            "direct_lake": {
                "bin_size": 268435456,  # 256MB for Power BI Direct Lake
                "description": "Optimized for Power BI Direct Lake queries"
            },
            "interactive_query": {
                "bin_size": 134217728,  # 128MB
                "description": "Balanced for interactive SQL queries"
            },
            "batch_analytics": {
                "bin_size": 268435456,  # 256MB
                "description": "Larger files for sequential scans"
            },
            "streaming": {
                "bin_size": 67108864,   # 64MB
                "description": "Smaller files for lower latency"
            },
            "high_concurrency": {
                "bin_size": 134217728,  # 128MB
                "description": "Medium files for concurrent access"
            }
        }

        config = configs.get(workload_type, configs["interactive_query"])

        self.spark.conf.set(
            "spark.databricks.delta.optimizeWrite.enabled",
            "true"
        )
        self.spark.conf.set(
            "spark.databricks.delta.optimizeWrite.binSize",
            str(config["bin_size"])
        )

        return config

    def get_recommended_bin_size(
        self,
        avg_row_size_bytes: int,
        typical_query_rows: int
    ) -> int:
        """Calculate recommended bin size based on data characteristics."""

        # Target: Read 1-4 files per query
        estimated_query_data = avg_row_size_bytes * typical_query_rows

        if estimated_query_data < 128 * 1024 * 1024:
            return 64 * 1024 * 1024   # 64MB
        elif estimated_query_data < 512 * 1024 * 1024:
            return 128 * 1024 * 1024  # 128MB
        else:
            return 256 * 1024 * 1024  # 256MB

# Usage
config = OptimizedWriteConfig(spark)

# Configure for Direct Lake workload
settings = config.configure_for_workload("direct_lake")
print(f"Configured: {settings['description']}")

# Calculate based on data
recommended = config.get_recommended_bin_size(
    avg_row_size_bytes=500,
    typical_query_rows=1_000_000
)
print(f"Recommended bin size: {recommended / (1024*1024):.0f}MB")
```

## Optimized Write with Partitioning

### Handling Partitioned Tables

```python
class PartitionedOptimizedWrite:
    """Handle optimized writes for partitioned tables."""

    def __init__(self, spark):
        self.spark = spark
        self._configure_optimized_write()

    def _configure_optimized_write(self):
        """Enable optimized write with partition handling."""

        self.spark.conf.set(
            "spark.databricks.delta.optimizeWrite.enabled",
            "true"
        )
        self.spark.conf.set(
            "spark.databricks.delta.optimizeWrite.numShuffleBlocks",
            "200"
        )

    def write_with_partition_optimization(
        self,
        df,
        table_path: str,
        partition_columns: list[str],
        target_files_per_partition: int = 1
    ):
        """Write with optimal files per partition."""

        # Calculate repartitioning
        partitions = df.select(partition_columns).distinct().count()
        total_target_files = partitions * target_files_per_partition

        # Repartition to target
        df_repartitioned = df.repartition(total_target_files, *partition_columns)

        # Write with optimized settings
        df_repartitioned.write.format("delta") \
            .option("optimizeWrite", "true") \
            .partitionBy(*partition_columns) \
            .mode("overwrite") \
            .save(table_path)

    def append_to_partitioned_table(
        self,
        df,
        table_path: str,
        partition_columns: list[str]
    ):
        """Append data with partition-aware optimization."""

        # For appends, let optimized write handle binning
        df.write.format("delta") \
            .option("optimizeWrite", "true") \
            .partitionBy(*partition_columns) \
            .mode("append") \
            .save(table_path)

# Usage
writer = PartitionedOptimizedWrite(spark)

# Write partitioned table
writer.write_with_partition_optimization(
    df=sales_df,
    table_path="Tables/sales_partitioned",
    partition_columns=["order_date"],
    target_files_per_partition=2
)
```

### Avoiding Over-Partitioning

```python
def analyze_partition_impact(
    df,
    partition_columns: list[str],
    target_file_size_mb: int = 128
) -> dict:
    """Analyze if partitioning will create small files."""

    total_size = df.count() * df.schema.fields.__len__() * 100  # Rough estimate
    partition_count = df.select(partition_columns).distinct().count()

    avg_partition_size = total_size / partition_count

    return {
        "partition_count": partition_count,
        "estimated_avg_partition_mb": avg_partition_size / (1024 * 1024),
        "target_file_size_mb": target_file_size_mb,
        "recommendation": (
            "GOOD" if avg_partition_size > target_file_size_mb * 1024 * 1024
            else "WARNING: Partitions may create small files"
        ),
        "suggestion": (
            None if avg_partition_size > target_file_size_mb * 1024 * 1024
            else "Consider coarser partition granularity (e.g., month instead of day)"
        )
    }

# Example
analysis = analyze_partition_impact(
    df=small_table,
    partition_columns=["event_date"],
    target_file_size_mb=128
)

print(f"Partitions: {analysis['partition_count']}")
print(f"Recommendation: {analysis['recommendation']}")
if analysis['suggestion']:
    print(f"Suggestion: {analysis['suggestion']}")
```

## Streaming with Optimized Write

### Trigger-Based Optimization

```python
class StreamingOptimizedWrite:
    """Optimized writes for streaming workloads."""

    def __init__(self, spark):
        self.spark = spark

    def configure_streaming_optimization(self):
        """Configure for streaming with optimized write."""

        configs = {
            # Optimized write for streaming
            "spark.databricks.delta.optimizeWrite.enabled": "true",
            "spark.databricks.delta.optimizeWrite.binSize": "67108864",  # 64MB for lower latency

            # Trigger-based compaction
            "spark.databricks.delta.autoCompact.enabled": "true",
            "spark.databricks.delta.autoCompact.minNumFiles": "50"
        }

        for key, value in configs.items():
            self.spark.conf.set(key, value)

    def create_optimized_stream(
        self,
        source_stream,
        target_table: str,
        checkpoint_path: str,
        trigger_interval: str = "1 minute"
    ):
        """Create streaming write with optimization."""

        return source_stream \
            .writeStream \
            .format("delta") \
            .option("checkpointLocation", checkpoint_path) \
            .option("optimizeWrite", "true") \
            .trigger(processingTime=trigger_interval) \
            .toTable(target_table)

    def micro_batch_with_compaction(
        self,
        source_stream,
        target_path: str,
        checkpoint_path: str
    ):
        """Micro-batch processing with periodic compaction."""

        def process_batch(batch_df, batch_id):
            # Write batch with optimized write
            batch_df.write.format("delta") \
                .option("optimizeWrite", "true") \
                .mode("append") \
                .save(target_path)

            # Compact every 100 batches
            if batch_id % 100 == 0 and batch_id > 0:
                delta_table = DeltaTable.forPath(self.spark, target_path)
                delta_table.optimize().executeCompaction()

        return source_stream \
            .writeStream \
            .foreachBatch(process_batch) \
            .option("checkpointLocation", checkpoint_path) \
            .start()

# Usage
streaming = StreamingOptimizedWrite(spark)
streaming.configure_streaming_optimization()

# Create optimized stream
query = streaming.create_optimized_stream(
    source_stream=kafka_stream,
    target_table="events_stream",
    checkpoint_path="/checkpoints/events",
    trigger_interval="30 seconds"
)
```

## Auto-Compaction Integration

### Combined Strategy

```python
# Enable both optimized write AND auto-compact for best results

def configure_full_optimization(table_path: str):
    """Configure both optimized write and auto-compact."""

    spark.sql(f"""
        ALTER TABLE delta.`{table_path}`
        SET TBLPROPERTIES (
            'delta.autoOptimize.optimizeWrite' = 'true',
            'delta.autoOptimize.autoCompact' = 'true',
            'delta.targetFileSize' = '134217728'
        )
    """)

# The combination ensures:
# 1. New writes create reasonably-sized files (optimized write)
# 2. Any remaining small files get compacted (auto-compact)
```

### Monitoring Optimization Effectiveness

```python
class OptimizationMonitor:
    """Monitor effectiveness of optimized write settings."""

    def __init__(self, spark):
        self.spark = spark

    def analyze_write_patterns(self, table_path: str) -> dict:
        """Analyze file sizes from recent writes."""

        history = self.spark.sql(f"DESCRIBE HISTORY delta.`{table_path}` LIMIT 20")

        writes = history.filter("operation IN ('WRITE', 'MERGE', 'STREAMING UPDATE')")

        return {
            "recent_writes": writes.count(),
            "write_operations": writes.select("operation", "operationMetrics").collect()
        }

    def calculate_optimization_score(self, table_path: str) -> dict:
        """Calculate how well-optimized the table is."""

        detail = self.spark.sql(f"DESCRIBE DETAIL delta.`{table_path}`").first()

        if detail.numFiles == 0:
            return {"score": "N/A", "reason": "Empty table"}

        avg_file_size = detail.sizeInBytes / detail.numFiles
        optimal_size = 128 * 1024 * 1024  # 128MB

        # Score from 0-100
        if avg_file_size >= optimal_size * 0.8:
            score = 100
        elif avg_file_size >= optimal_size * 0.5:
            score = 75
        elif avg_file_size >= optimal_size * 0.25:
            score = 50
        else:
            score = 25

        return {
            "score": score,
            "avg_file_size_mb": avg_file_size / (1024 * 1024),
            "target_size_mb": optimal_size / (1024 * 1024),
            "file_count": detail.numFiles,
            "recommendation": (
                "Well optimized" if score >= 75
                else "Consider enabling optimized write" if score >= 50
                else "Needs compaction or optimized write"
            )
        }

# Usage
monitor = OptimizationMonitor(spark)

score = monitor.calculate_optimization_score("Tables/sales")
print(f"Optimization Score: {score['score']}")
print(f"Average File Size: {score['avg_file_size_mb']:.1f}MB")
print(f"Recommendation: {score['recommendation']}")
```

## Performance Considerations

### CPU vs I/O Trade-off

```python
# Optimized write adds CPU overhead for binning
# Trade-off analysis

tradeoffs = {
    "optimized_write_enabled": {
        "write_time": "Slower (10-30% overhead)",
        "read_time": "Much faster (fewer files to scan)",
        "storage": "More efficient (less metadata)",
        "best_for": "Read-heavy workloads"
    },
    "optimized_write_disabled": {
        "write_time": "Faster",
        "read_time": "Slower (many small files)",
        "storage": "Less efficient",
        "best_for": "Write-heavy, rarely queried tables"
    }
}

# Decision framework
def should_enable_optimized_write(
    reads_per_day: int,
    writes_per_day: int,
    query_latency_sla_ms: int
) -> bool:
    """Decide whether to enable optimized write."""

    read_write_ratio = reads_per_day / max(writes_per_day, 1)

    # Enable if reads >> writes or tight query SLA
    return read_write_ratio > 5 or query_latency_sla_ms < 5000
```

## Best Practices

1. **Enable by default**: For most analytical workloads
2. **Choose appropriate bin size**: 128MB general, 256MB for Direct Lake
3. **Combine with auto-compact**: For comprehensive optimization
4. **Monitor file sizes**: Validate optimization is working
5. **Consider streaming separately**: Lower bin sizes for latency

## Conclusion

Optimized writes are essential for maintaining healthy Delta tables without constant compaction overhead. Enable them for all analytical tables in Microsoft Fabric, and combine with auto-compact for streaming workloads.

The small upfront cost in write time pays dividends in faster queries and reduced maintenance overhead.

