---
title: PySpark Best Practices for Production Workloads
author: Michael John Peña
draft: false
date: 2021-04-19
url: /blog/pyspark-best-practices-production/
tags:
  - Apache Spark
  - PySpark
  - Big Data
  - Data Engineering
  - Python

---

I wrote "2021-04-19-pyspark-best-practices-production" to share practical, production-minded guidance on this topic.

## Project Structure

### Recommended Layout

```
my_spark_project/
├── src/
│   ├── __init__.py
│   ├── main.py
│   ├── transformations/
│   │   ├── __init__.py
│   │   ├── cleaning.py
│   │   └── aggregations.py
│   ├── utils/
│   │   ├── __init__.py
│   │   ├── spark_utils.py
│   │   └── config.py
│   └── schemas/
│       ├── __init__.py
│       └── data_schemas.py
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── test_cleaning.py
│   └── test_aggregations.py
├── config/
│   ├── dev.yaml
│   ├── staging.yaml
│   └── prod.yaml
├── requirements.txt
└── setup.py
```

### Configuration Management

```python
# src/utils/config.py
from dataclasses import dataclass
from typing import Optional
import yaml

@dataclass
class SparkConfig:
    app_name: str
    master: str
    executor_memory: str
    executor_cores: int
    num_executors: int
    shuffle_partitions: int
    enable_adaptive: bool

@dataclass
class DataConfig:
    input_path: str
    output_path: str
    checkpoint_path: str
    format: str

@dataclass
class AppConfig:
    spark: SparkConfig
    data: DataConfig
    environment: str

    @classmethod
    def from_yaml(cls, config_path: str) -> 'AppConfig':
        with open(config_path) as f:
            config = yaml.safe_load(f)

        return cls(
            spark=SparkConfig(**config['spark']),
            data=DataConfig(**config['data']),
            environment=config['environment']
        )
```

### Spark Session Factory

```python
# src/utils/spark_utils.py
from pyspark.sql import SparkSession
from contextlib import contextmanager
from typing import Optional
import logging

logger = logging.getLogger(__name__)

def create_spark_session(config: SparkConfig) -> SparkSession:
    """Create a configured SparkSession."""
    builder = SparkSession.builder \
        .appName(config.app_name) \
        .config("spark.sql.shuffle.partitions", config.shuffle_partitions) \
        .config("spark.sql.adaptive.enabled", config.enable_adaptive) \
        .config("spark.sql.adaptive.coalescePartitions.enabled", True) \
        .config("spark.serializer", "org.apache.spark.serializer.KryoSerializer") \
        .config("spark.sql.parquet.compression.codec", "snappy")

    if config.master:
        builder = builder.master(config.master)

    if config.executor_memory:
        builder = builder.config("spark.executor.memory", config.executor_memory)
        builder = builder.config("spark.executor.cores", config.executor_cores)

    spark = builder.getOrCreate()
    spark.sparkContext.setLogLevel("WARN")

    logger.info(f"Created SparkSession: {config.app_name}")
    return spark

@contextmanager
def spark_session_context(config: SparkConfig):
    """Context manager for SparkSession lifecycle."""
    spark = create_spark_session(config)
    try:
        yield spark
    finally:
        spark.stop()
        logger.info("SparkSession stopped")
```

## Schema Definition

### Explicit Schemas

```python
# src/schemas/data_schemas.py
from pyspark.sql.types import (
    StructType, StructField, StringType, IntegerType,
    DoubleType, TimestampType, ArrayType, MapType, BooleanType
)

class Schemas:
    """Centralized schema definitions."""

    ORDERS = StructType([
        StructField("order_id", StringType(), nullable=False),
        StructField("customer_id", StringType(), nullable=False),
        StructField("order_date", TimestampType(), nullable=False),
        StructField("status", StringType(), nullable=True),
        StructField("total_amount", DoubleType(), nullable=True),
        StructField("items", ArrayType(
            StructType([
                StructField("product_id", StringType()),
                StructField("quantity", IntegerType()),
                StructField("price", DoubleType())
            ])
        ), nullable=True),
        StructField("metadata", MapType(StringType(), StringType()), nullable=True)
    ])

    CUSTOMERS = StructType([
        StructField("customer_id", StringType(), nullable=False),
        StructField("name", StringType(), nullable=True),
        StructField("email", StringType(), nullable=True),
        StructField("created_at", TimestampType(), nullable=True),
        StructField("is_active", BooleanType(), nullable=True)
    ])

    @classmethod
    def get_schema(cls, name: str) -> StructType:
        """Get schema by name."""
        schema = getattr(cls, name.upper(), None)
        if schema is None:
            raise ValueError(f"Schema '{name}' not found")
        return schema
```

## Transformation Functions

### Pure Transformation Functions

```python
# src/transformations/cleaning.py
from pyspark.sql import DataFrame
from pyspark.sql import functions as F
from typing import List, Optional

def remove_duplicates(
    df: DataFrame,
    subset: Optional[List[str]] = None,
    keep: str = "first"
) -> DataFrame:
    """Remove duplicate rows from DataFrame.

    Args:
        df: Input DataFrame
        subset: Columns to consider for duplicates
        keep: Which duplicate to keep ('first' or 'last')

    Returns:
        DataFrame with duplicates removed
    """
    if keep == "first":
        return df.dropDuplicates(subset)
    elif keep == "last":
        # For 'last', we need to use window function
        from pyspark.sql.window import Window

        if subset is None:
            subset = df.columns

        # Add row number, ordered by a monotonically increasing id
        df_with_row = df.withColumn("_row_num", F.monotonically_increasing_id())
        window = Window.partitionBy(subset).orderBy(F.desc("_row_num"))

        return df_with_row \
            .withColumn("_rank", F.row_number().over(window)) \
            .filter(F.col("_rank") == 1) \
            .drop("_row_num", "_rank")
    else:
        raise ValueError(f"keep must be 'first' or 'last', got '{keep}'")


def standardize_columns(df: DataFrame) -> DataFrame:
    """Standardize column names to snake_case."""
    import re

    def to_snake_case(name: str) -> str:
        name = re.sub(r'[\s\-]+', '_', name)
        name = re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', name)
        return name.lower()

    for old_name in df.columns:
        new_name = to_snake_case(old_name)
        if old_name != new_name:
            df = df.withColumnRenamed(old_name, new_name)

    return df


def fill_nulls(
    df: DataFrame,
    fill_map: dict,
    default_string: str = "",
    default_numeric: float = 0.0
) -> DataFrame:
    """Fill null values with specified defaults.

    Args:
        df: Input DataFrame
        fill_map: Dictionary of column -> fill value
        default_string: Default value for string columns
        default_numeric: Default value for numeric columns
    """
    from pyspark.sql.types import StringType, NumericType

    # Apply specific fill values
    df = df.fillna(fill_map)

    # Apply type-based defaults
    for field in df.schema.fields:
        col_name = field.name
        if col_name in fill_map:
            continue

        if isinstance(field.dataType, StringType):
            df = df.fillna({col_name: default_string})
        elif isinstance(field.dataType, NumericType):
            df = df.fillna({col_name: default_numeric})

    return df
```

### Chainable Transformations

```python
# src/transformations/aggregations.py
from pyspark.sql import DataFrame
from pyspark.sql import functions as F
from pyspark.sql.window import Window
from typing import List, Dict, Callable

def with_date_parts(date_column: str) -> Callable[[DataFrame], DataFrame]:
    """Add date part columns."""
    def transform(df: DataFrame) -> DataFrame:
        return df \
            .withColumn("year", F.year(date_column)) \
            .withColumn("month", F.month(date_column)) \
            .withColumn("day", F.dayofmonth(date_column)) \
            .withColumn("day_of_week", F.dayofweek(date_column)) \
            .withColumn("week_of_year", F.weekofyear(date_column))
    return transform


def with_running_totals(
    partition_cols: List[str],
    order_col: str,
    value_col: str
) -> Callable[[DataFrame], DataFrame]:
    """Add running total columns."""
    def transform(df: DataFrame) -> DataFrame:
        window = Window \
            .partitionBy(partition_cols) \
            .orderBy(order_col) \
            .rowsBetween(Window.unboundedPreceding, Window.currentRow)

        return df \
            .withColumn(f"{value_col}_running_total", F.sum(value_col).over(window)) \
            .withColumn(f"{value_col}_running_avg", F.avg(value_col).over(window)) \
            .withColumn(f"{value_col}_running_count", F.count(value_col).over(window))
    return transform


def aggregate_by(
    group_cols: List[str],
    agg_specs: Dict[str, List[str]]
) -> Callable[[DataFrame], DataFrame]:
    """Flexible aggregation function.

    Args:
        group_cols: Columns to group by
        agg_specs: Dict of {column: [agg_functions]}
            e.g., {"amount": ["sum", "avg", "max"]}
    """
    def transform(df: DataFrame) -> DataFrame:
        agg_exprs = []
        for col, funcs in agg_specs.items():
            for func in funcs:
                agg_func = getattr(F, func)
                agg_exprs.append(agg_func(col).alias(f"{col}_{func}"))

        return df.groupBy(group_cols).agg(*agg_exprs)
    return transform


# Usage with transform method
df_result = df \
    .transform(with_date_parts("order_date")) \
    .transform(with_running_totals(["customer_id"], "order_date", "amount")) \
    .transform(aggregate_by(
        ["customer_id", "year", "month"],
        {"amount": ["sum", "avg", "count"]}
    ))
```

## Avoiding Common Pitfalls

### UDF Performance

```python
# BAD: Using Python UDF
from pyspark.sql.functions import udf
from pyspark.sql.types import StringType

@udf(returnType=StringType())
def bad_upper(s):
    return s.upper() if s else None

df_bad = df.withColumn("upper_name", bad_upper("name"))

# GOOD: Using built-in functions
df_good = df.withColumn("upper_name", F.upper("name"))

# If UDF is unavoidable, use pandas_udf for better performance
from pyspark.sql.functions import pandas_udf
import pandas as pd

@pandas_udf(StringType())
def better_udf(s: pd.Series) -> pd.Series:
    return s.str.upper()

df_better = df.withColumn("upper_name", better_udf("name"))
```

### Collect and Driver Memory

```python
# BAD: Collecting large DataFrame
all_data = df.collect()  # Don't do this with large data!

# GOOD: Process in partitions or sample
sample_data = df.limit(1000).collect()

# GOOD: Use iterators for large results
for row in df.toLocalIterator():
    process_row(row)

# GOOD: Write to storage instead
df.write.parquet("output/data")
```

### Broadcast Joins

```python
from pyspark.sql.functions import broadcast

# For small tables (< 10MB by default), Spark auto-broadcasts
# But explicit is better for clarity and control

# BAD: Joining without broadcast hint
df_result = df_large.join(df_small, "key")

# GOOD: Explicit broadcast for small tables
df_result = df_large.join(broadcast(df_small), "key")

# Check if table is broadcast-eligible
def should_broadcast(df: DataFrame, max_size_mb: int = 10) -> bool:
    """Check if DataFrame should be broadcast."""
    # Note: This triggers an action
    try:
        size_bytes = df._jdf.queryExecution().optimizedPlan().stats().sizeInBytes()
        return size_bytes < max_size_mb * 1024 * 1024
    except:
        return False
```

### Partition Skew

```python
from pyspark.sql import functions as F

def handle_skewed_join(
    df_left: DataFrame,
    df_right: DataFrame,
    join_key: str,
    salt_buckets: int = 10
) -> DataFrame:
    """Handle skewed join by salting."""

    # Add salt to both DataFrames
    df_left_salted = df_left.withColumn(
        "salt",
        (F.rand() * salt_buckets).cast("int")
    )

    # Explode salt for right side
    df_right_salted = df_right.crossJoin(
        spark.range(salt_buckets).withColumnRenamed("id", "salt")
    )

    # Join on key + salt
    result = df_left_salted.join(
        df_right_salted,
        [join_key, "salt"],
        "inner"
    ).drop("salt")

    return result

# Or use Spark 3.0+ AQE for automatic skew handling
spark.conf.set("spark.sql.adaptive.enabled", "true")
spark.conf.set("spark.sql.adaptive.skewJoin.enabled", "true")
```

## Testing PySpark Code

### Test Fixtures

```python
# tests/conftest.py
import pytest
from pyspark.sql import SparkSession

@pytest.fixture(scope="session")
def spark():
    """Create a SparkSession for testing."""
    spark = SparkSession.builder \
        .master("local[2]") \
        .appName("pytest-pyspark") \
        .config("spark.sql.shuffle.partitions", "2") \
        .config("spark.default.parallelism", "2") \
        .config("spark.executor.memory", "512m") \
        .getOrCreate()

    yield spark
    spark.stop()


@pytest.fixture
def sample_orders(spark):
    """Create sample orders DataFrame."""
    data = [
        ("O001", "C001", "2021-04-01", 100.0),
        ("O002", "C001", "2021-04-02", 200.0),
        ("O003", "C002", "2021-04-01", 150.0),
    ]
    return spark.createDataFrame(
        data,
        ["order_id", "customer_id", "order_date", "amount"]
    )
```

### Unit Tests

```python
# tests/test_cleaning.py
import pytest
from pyspark.sql import functions as F
from src.transformations.cleaning import remove_duplicates, standardize_columns

def test_remove_duplicates(spark):
    # Arrange
    data = [("1", "a"), ("1", "a"), ("2", "b")]
    df = spark.createDataFrame(data, ["id", "value"])

    # Act
    result = remove_duplicates(df)

    # Assert
    assert result.count() == 2


def test_standardize_columns(spark):
    # Arrange
    data = [(1, 2)]
    df = spark.createDataFrame(data, ["CamelCase", "with-dash"])

    # Act
    result = standardize_columns(df)

    # Assert
    assert "camel_case" in result.columns
    assert "with_dash" in result.columns


def test_transformation_chain(spark, sample_orders):
    # Test complete transformation pipeline
    from src.transformations.aggregations import with_date_parts

    result = sample_orders.transform(with_date_parts("order_date"))

    assert "year" in result.columns
    assert "month" in result.columns
    assert result.filter(F.col("year") == 2021).count() == 3
```

## Logging and Monitoring

```python
# src/utils/logging_utils.py
import logging
import sys
from functools import wraps
from time import time

def setup_logging(level: str = "INFO"):
    """Configure logging for PySpark application."""
    logging.basicConfig(
        level=getattr(logging, level),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)]
    )

def log_dataframe_info(df, name: str, logger: logging.Logger):
    """Log DataFrame statistics."""
    count = df.count()
    partitions = df.rdd.getNumPartitions()
    logger.info(f"{name}: {count} rows, {partitions} partitions, {len(df.columns)} columns")

def timed_transformation(func):
    """Decorator to time transformation functions."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        logger = logging.getLogger(func.__module__)
        start = time()
        result = func(*args, **kwargs)
        duration = time() - start
        logger.info(f"{func.__name__} completed in {duration:.2f}s")
        return result
    return wrapper
```

## Best Practices Summary

1. **Define schemas explicitly** - Never rely on schema inference in production
2. **Use built-in functions** - Avoid UDFs when possible
3. **Write pure transformation functions** - Easy to test and compose
4. **Cache strategically** - Only cache DataFrames used multiple times
5. **Monitor partition sizes** - Aim for 128MB-256MB per partition
6. **Test with representative data** - Use fixtures that mimic production
7. **Log DataFrame statistics** - Track row counts and partitions
8. **Use type hints** - Improve code clarity and IDE support

## Conclusion

Writing production-quality PySpark code requires balancing Python best practices with Spark's distributed nature. By structuring your project properly, using explicit schemas, writing testable transformations, and avoiding common pitfalls, you can build reliable data pipelines that scale effectively.

