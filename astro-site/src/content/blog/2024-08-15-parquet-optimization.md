---
title: "Parquet File Optimization for Analytics"
author: Michael John Peña
draft: false
date: 2024-08-15
tags:
  - Parquet
  - Data Engineering
  - Performance
  - Microsoft Fabric
  - Delta Lake
---

## Parquet Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Parquet File                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   Row Group 1                        │    │
│  │  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐           │    │
│  │  │Col A  │ │Col B  │ │Col C  │ │Col D  │           │    │
│  │  │Chunk  │ │Chunk  │ │Chunk  │ │Chunk  │           │    │
│  │  └───────┘ └───────┘ └───────┘ └───────┘           │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   Row Group 2                        │    │
│  │  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐           │    │
│  │  │Col A  │ │Col B  │ │Col C  │ │Col D  │           │    │
│  │  │Chunk  │ │Chunk  │ │Chunk  │ │Chunk  │           │    │
│  │  └───────┘ └───────┘ └───────┘ └───────┘           │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                     Footer                           │    │
│  │   Schema │ Row Group Metadata │ Column Statistics   │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Key Optimization Parameters

### Row Group Size

```python
from pyspark.sql import SparkSession

# Configure row group size
spark.conf.set("spark.sql.parquet.rowGroupSize", "134217728")  # 128MB

# Write with optimized row group size
df.write.format("parquet") \
    .option("parquet.block.size", 134217728) \
    .mode("overwrite") \
    .save("path/to/output")

# For Delta tables
df.write.format("delta") \
    .option("delta.checkpoint.writeStatsAsStruct", "true") \
    .option("delta.checkpoint.writeStatsAsJson", "false") \
    .save("Tables/optimized_table")
```

### Compression Codecs

```python
class ParquetCompressionOptimizer:
    """Optimize compression for different use cases."""

    def __init__(self, spark):
        self.spark = spark
        self.compression_options = {
            "snappy": {
                "ratio": "medium",
                "speed": "fast",
                "use_case": "General purpose, balanced"
            },
            "gzip": {
                "ratio": "high",
                "speed": "slow",
                "use_case": "Archive, storage cost priority"
            },
            "zstd": {
                "ratio": "high",
                "speed": "medium",
                "use_case": "Best balance of compression and speed"
            },
            "lz4": {
                "ratio": "low",
                "speed": "fastest",
                "use_case": "Speed priority, real-time"
            },
            "uncompressed": {
                "ratio": "none",
                "speed": "fastest",
                "use_case": "When storage is cheap, CPU expensive"
            }
        }

    def recommend_compression(self, workload_type: str) -> str:
        """Recommend compression based on workload."""

        recommendations = {
            "interactive_query": "snappy",
            "batch_processing": "zstd",
            "archive": "gzip",
            "streaming": "lz4",
            "ml_training": "snappy"
        }

        return recommendations.get(workload_type, "snappy")

    def write_with_compression(
        self,
        df,
        output_path: str,
        compression: str = "snappy"
    ):
        """Write DataFrame with specified compression."""

        self.spark.conf.set("spark.sql.parquet.compression.codec", compression)

        df.write.format("parquet") \
            .option("compression", compression) \
            .mode("overwrite") \
            .save(output_path)

    def compare_compression(self, df, output_base_path: str) -> dict:
        """Compare different compression codecs."""

        import os
        import time

        results = {}

        for codec in ["snappy", "gzip", "zstd", "lz4"]:
            output_path = f"{output_base_path}/{codec}"

            # Measure write time
            start = time.time()
            self.write_with_compression(df, output_path, codec)
            write_time = time.time() - start

            # Measure read time
            start = time.time()
            _ = self.spark.read.parquet(output_path).count()
            read_time = time.time() - start

            # Get file size (simplified)
            results[codec] = {
                "write_time_seconds": write_time,
                "read_time_seconds": read_time,
                "path": output_path
            }

        return results

# Usage
optimizer = ParquetCompressionOptimizer(spark)

# Get recommendation
recommended = optimizer.recommend_compression("interactive_query")
print(f"Recommended compression: {recommended}")

# Compare compression codecs
comparison = optimizer.compare_compression(df, "Files/compression_test")
for codec, metrics in comparison.items():
    print(f"{codec}: Write {metrics['write_time_seconds']:.2f}s, Read {metrics['read_time_seconds']:.2f}s")
```

## Column Statistics

### Leveraging Min/Max Statistics

```python
# Parquet stores min/max statistics per row group
# These enable predicate pushdown

class StatisticsAnalyzer:
    """Analyze Parquet statistics for optimization."""

    def __init__(self, spark):
        self.spark = spark

    def check_predicate_pushdown(self, table_path: str, filter_column: str):
        """Verify predicate pushdown is working."""

        # Enable pushdown
        self.spark.conf.set("spark.sql.parquet.filterPushdown", "true")

        # Explain plan to see pushdown
        df = self.spark.read.format("delta").load(table_path) \
            .filter(f"{filter_column} = 'specific_value'")

        return df.explain(True)

    def optimize_for_filters(
        self,
        df,
        output_path: str,
        sort_columns: list[str]
    ):
        """Sort data to improve filter efficiency."""

        # Sorting improves min/max statistics effectiveness
        sorted_df = df.sort(*sort_columns)

        sorted_df.write.format("delta") \
            .mode("overwrite") \
            .save(output_path)

    def analyze_column_statistics(self, table_path: str):
        """Analyze column statistics from Delta log."""

        # Read Delta log to get statistics
        stats = self.spark.sql(f"""
            DESCRIBE DETAIL delta.`{table_path}`
        """)

        return stats

# Example: Optimize for date-based filters
analyzer = StatisticsAnalyzer(spark)

# Sort by date for efficient date filtering
analyzer.optimize_for_filters(
    df=sales_df,
    output_path="Tables/sales_optimized",
    sort_columns=["order_date", "region"]
)
```

### Dictionary Encoding

```python
# Dictionary encoding is automatic for low-cardinality columns
# But we can optimize for it

def optimize_for_dictionary_encoding(df, output_path: str):
    """Optimize data layout for dictionary encoding."""

    # Dictionary encoding works best when:
    # 1. Column has limited unique values
    # 2. Values repeat within row groups

    # Check cardinality
    for col in df.columns:
        distinct_count = df.select(col).distinct().count()
        total_count = df.count()
        ratio = distinct_count / total_count

        if ratio < 0.1:  # Low cardinality
            print(f"{col}: Good for dictionary encoding (cardinality ratio: {ratio:.4f})")
        else:
            print(f"{col}: Consider other encoding (cardinality ratio: {ratio:.4f})")

    # Write with optimized settings
    df.write.format("parquet") \
        .option("parquet.enable.dictionary", "true") \
        .option("parquet.dictionary.page.size", "1048576") \
        .mode("overwrite") \
        .save(output_path)
```

## File Size Optimization

### Target File Size

```python
class FileSizeOptimizer:
    """Optimize Parquet file sizes for query engines."""

    def __init__(self, spark):
        self.spark = spark

    def get_optimal_file_size(self, query_pattern: str) -> int:
        """Recommend optimal file size based on query pattern."""

        recommendations = {
            "point_lookup": 32 * 1024 * 1024,      # 32MB
            "range_scan": 128 * 1024 * 1024,       # 128MB
            "full_table_scan": 256 * 1024 * 1024,  # 256MB
            "direct_lake": 256 * 1024 * 1024,      # 256MB for Power BI
            "streaming": 64 * 1024 * 1024          # 64MB
        }

        return recommendations.get(query_pattern, 128 * 1024 * 1024)

    def repartition_for_size(
        self,
        df,
        target_size_mb: int,
        output_path: str
    ):
        """Repartition DataFrame to achieve target file size."""

        # Estimate row size
        sample = df.limit(1000)
        sample_bytes = len(sample.toPandas().to_parquet())
        rows_per_file = (target_size_mb * 1024 * 1024 * 1000) // sample_bytes

        total_rows = df.count()
        num_partitions = max(1, total_rows // rows_per_file)

        df.repartition(num_partitions) \
            .write.format("delta") \
            .mode("overwrite") \
            .save(output_path)

        print(f"Written {num_partitions} files targeting {target_size_mb}MB each")

    def coalesce_small_files(
        self,
        input_path: str,
        output_path: str,
        target_file_count: int
    ):
        """Consolidate many small files into fewer larger files."""

        df = self.spark.read.format("delta").load(input_path)

        df.coalesce(target_file_count) \
            .write.format("delta") \
            .mode("overwrite") \
            .save(output_path)

# Usage
optimizer = FileSizeOptimizer(spark)

# Get recommendation
optimal_size = optimizer.get_optimal_file_size("direct_lake")
print(f"Optimal file size: {optimal_size // (1024*1024)}MB")

# Repartition for target size
optimizer.repartition_for_size(
    df=large_df,
    target_size_mb=128,
    output_path="Tables/optimized_sales"
)
```

## Page-Level Optimization

### Page Size Configuration

```python
# Page size affects read granularity and compression efficiency

page_config = {
    # Data page size
    "parquet.page.size": "1048576",  # 1MB default

    # Dictionary page size
    "parquet.dictionary.page.size": "1048576",  # 1MB

    # Enable page-level statistics
    "parquet.page.write-checksum.enabled": "true",

    # Enable page index (column index)
    "parquet.page.index.enabled": "true"
}

# Apply configuration
for key, value in page_config.items():
    spark.conf.set(f"spark.sql.{key}", value)

# Write with optimized pages
df.write.format("parquet") \
    .options(**page_config) \
    .mode("overwrite") \
    .save("path/to/output")
```

## Column Ordering

### Optimize Column Order

```python
def optimize_column_order(df, frequently_filtered_columns: list[str]):
    """Reorder columns for better predicate pushdown."""

    # Put frequently filtered columns first
    # This can improve file skipping

    all_columns = df.columns
    other_columns = [c for c in all_columns if c not in frequently_filtered_columns]

    optimized_order = frequently_filtered_columns + other_columns

    return df.select(*optimized_order)

# Usage
optimized_df = optimize_column_order(
    df=sales_df,
    frequently_filtered_columns=["order_date", "region", "customer_id"]
)

optimized_df.write.format("delta").save("Tables/column_optimized")
```

## Nested Data Optimization

### Flattening vs. Keeping Nested

```python
class NestedDataOptimizer:
    """Optimize nested Parquet structures."""

    def __init__(self, spark):
        self.spark = spark

    def should_flatten(self, df, column_name: str) -> dict:
        """Analyze if nested column should be flattened."""

        # Check if column is struct/array
        schema = df.schema[column_name].dataType

        # Count how often nested fields are accessed
        # (This would require query log analysis in practice)

        return {
            "column": column_name,
            "type": str(schema),
            "recommendation": "Keep nested for rare access, flatten for frequent access",
            "considerations": [
                "Nested: Better storage, projection pushdown",
                "Flattened: Better filter pushdown, simpler queries"
            ]
        }

    def flatten_struct(self, df, struct_column: str, prefix: str = ""):
        """Flatten nested struct column."""

        from pyspark.sql.functions import col

        if prefix:
            prefix = f"{prefix}_"

        # Get struct fields
        struct_fields = df.schema[struct_column].dataType.fields

        # Expand each field
        expanded_cols = [
            col(f"{struct_column}.{field.name}").alias(f"{prefix}{field.name}")
            for field in struct_fields
        ]

        # Select original columns (except struct) plus expanded
        other_cols = [col(c) for c in df.columns if c != struct_column]

        return df.select(*other_cols, *expanded_cols)

    def create_optimized_view(
        self,
        df,
        nested_columns: dict
    ):
        """Create view with selectively flattened columns."""

        result_df = df

        for col_name, should_flatten in nested_columns.items():
            if should_flatten:
                result_df = self.flatten_struct(result_df, col_name)

        return result_df

# Usage
optimizer = NestedDataOptimizer(spark)

# Analyze nested column
analysis = optimizer.should_flatten(events_df, "user_profile")
print(analysis)

# Flatten if needed
flattened = optimizer.flatten_struct(events_df, "user_profile", prefix="user")
flattened.write.format("delta").save("Tables/flattened_events")
```

## Monitoring and Analysis

### File Quality Metrics

```python
class ParquetQualityAnalyzer:
    """Analyze Parquet file quality and optimization opportunities."""

    def __init__(self, spark):
        self.spark = spark

    def analyze_table_files(self, table_path: str) -> dict:
        """Analyze file distribution and quality."""

        # Get file list from Delta log
        detail = self.spark.sql(f"DESCRIBE DETAIL delta.`{table_path}`").first()

        files = self.spark.sql(f"""
            SELECT
                size,
                modificationTime,
                stats
            FROM delta.`{table_path}`
        """)

        # Calculate statistics
        file_stats = files.agg({
            "size": "avg",
            "size": "min",
            "size": "max",
            "size": "count"
        }).first()

        return {
            "table_path": table_path,
            "total_files": detail.numFiles,
            "total_size_gb": detail.sizeInBytes / (1024**3),
            "avg_file_size_mb": file_stats["avg(size)"] / (1024**2) if file_stats["avg(size)"] else 0,
            "min_file_size_mb": file_stats["min(size)"] / (1024**2) if file_stats["min(size)"] else 0,
            "max_file_size_mb": file_stats["max(size)"] / (1024**2) if file_stats["max(size)"] else 0
        }

    def get_optimization_recommendations(self, analysis: dict) -> list[str]:
        """Generate recommendations based on analysis."""

        recommendations = []

        avg_size = analysis.get("avg_file_size_mb", 0)
        min_size = analysis.get("min_file_size_mb", 0)
        max_size = analysis.get("max_file_size_mb", 0)

        if avg_size < 64:
            recommendations.append(
                f"Files too small (avg {avg_size:.1f}MB). Run OPTIMIZE to compact."
            )

        if avg_size > 512:
            recommendations.append(
                f"Files too large (avg {avg_size:.1f}MB). Consider smaller target size."
            )

        if max_size > 4 * avg_size:
            recommendations.append(
                "File sizes vary significantly. Consider repartitioning."
            )

        if not recommendations:
            recommendations.append("File sizes are well optimized.")

        return recommendations

# Usage
analyzer = ParquetQualityAnalyzer(spark)

analysis = analyzer.analyze_table_files("Tables/sales")
print(f"Total files: {analysis['total_files']}")
print(f"Average size: {analysis['avg_file_size_mb']:.1f}MB")

recommendations = analyzer.get_optimization_recommendations(analysis)
for rec in recommendations:
    print(f"- {rec}")
```

## Best Practices

1. **Target 128-256MB files**: Optimal for most query engines
2. **Use Snappy or ZSTD**: Best compression/speed balance
3. **Sort by filter columns**: Improves predicate pushdown
4. **Enable column statistics**: Helps query optimization
5. **Monitor file sizes**: Regular maintenance prevents degradation

## Conclusion

Parquet optimization is crucial for analytics performance. Focus on file sizes, compression, and column statistics to maximize query efficiency. In Microsoft Fabric, these optimizations work alongside Delta Lake features for the best results.

Regular monitoring and maintenance ensure your Parquet files remain optimized as data grows and access patterns evolve.
