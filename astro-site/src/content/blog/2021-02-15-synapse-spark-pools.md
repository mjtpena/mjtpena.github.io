---
title: Big Data Processing with Azure Synapse Spark Pools
description: "Synapse Spark pools are the feature that stops the \"should I use Databricks or Synapse?\" question from being purely a product choice and makes it an…"
author: Michael John Peña
draft: false
date: 2021-02-15
url: /blog/synapse-spark-pools/
tags:
  - Azure
  - Synapse
  - Spark
  - Big Data
  - Data Engineering
---

Synapse Spark pools are the feature that stops the "should I use Databricks or Synapse?" question from being purely a product choice and makes it an architecture one. If your team is already in the Synapse workspace for SQL and Pipelines, adding a Spark pool brings PySpark and Scala to the same workspace, the same linked service connections, and the same ADLS Gen2 storage hierarchy. The nodes spin up and down automatically, you can pause pools when idle, and the notebook experience is close enough to Databricks for most data engineering work. Not identical—if you need the full Databricks ecosystem (Delta Live Tables, ML, Unity Catalog) you're in the wrong tool—but for integrated analytics it earns its place.

## Why Synapse Spark Pools?

Synapse Spark pools offer:

- **Serverless experience** - Auto-scale and auto-pause capabilities
- **Unified workspace** - Integration with SQL pools, pipelines, and Power BI
- **Fast startup** - Optimized cluster provisioning
- **Built-in connectors** - Native integration with Azure data services
- **Multiple language support** - Python, Scala, SQL, R, and .NET

## Creating a Spark Pool

```bash
# Create Synapse workspace first
az synapse workspace create \
    --name synapse-demo \
    --resource-group rg-synapse \
    --storage-account stsynapsedemo \
    --file-system synapse \
    --sql-admin-login sqladmin \
    --sql-admin-login-password "YourPassword123!" \
    --location eastus

# Create Spark pool
az synapse spark pool create \
    --name sparkpool \
    --workspace-name synapse-demo \
    --resource-group rg-synapse \
    --spark-version 3.1 \
    --node-count 3 \
    --node-size Medium \
    --min-node-count 3 \
    --max-node-count 10 \
    --enable-auto-scale true \
    --enable-auto-pause true \
    --delay 15
```

## Working with Data in Spark

### Reading from Azure Data Lake

```python
# Spark notebook in Synapse

# Read Parquet files from Data Lake
df = spark.read.parquet("abfss://raw@stsynapsedemo.dfs.core.windows.net/sales/")

# Read CSV with schema inference
df_csv = spark.read \
    .option("header", "true") \
    .option("inferSchema", "true") \
    .csv("abfss://raw@stsynapsedemo.dfs.core.windows.net/customers/")

# Read JSON with explicit schema
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, TimestampType

schema = StructType([
    StructField("event_id", StringType(), True),
    StructField("user_id", IntegerType(), True),
    StructField("event_type", StringType(), True),
    StructField("timestamp", TimestampType(), True),
    StructField("properties", StringType(), True)
])

df_json = spark.read \
    .schema(schema) \
    .json("abfss://raw@stsynapsedemo.dfs.core.windows.net/events/")

# Display data
display(df.limit(10))
```

### Integrating with SQL Pool

```python
# Read from dedicated SQL pool
df_sql = spark.read \
    .synapsesql("sqlpool.dbo.Products") \
    .option("Constants.SERVER", "synapse-demo.sql.azuresynapse.net")

# Write to SQL pool
df_transformed.write \
    .synapsesql(
        "sqlpool.dbo.ProductsStaging",
        Constants.INTERNAL,
        Constants.APPEND
    )
```

### Reading from Cosmos DB

```python
# Configure Cosmos DB connection
cosmosConfig = {
    "spark.synapse.linkedService": "CosmosDbLinkedService",
    "spark.cosmos.container": "orders",
    "spark.cosmos.read.inferSchema.enabled": "true"
}

df_cosmos = spark.read \
    .format("cosmos.olap") \
    .options(**cosmosConfig) \
    .load()
```

## Data Transformation Patterns

### Complex Aggregations

```python
from pyspark.sql import functions as F
from pyspark.sql.window import Window

# Load sales data
sales_df = spark.read.parquet("abfss://curated@stsynapsedemo.dfs.core.windows.net/sales/")

# Define windows
customer_window = Window.partitionBy("customer_id").orderBy("order_date")
monthly_window = Window.partitionBy("customer_id", F.year("order_date"), F.month("order_date"))

# Calculate metrics
enriched_df = sales_df \
    .withColumn("cumulative_spend", F.sum("total_amount").over(customer_window)) \
    .withColumn("order_sequence", F.row_number().over(customer_window)) \
    .withColumn("days_since_prev_order",
        F.datediff("order_date", F.lag("order_date").over(customer_window))) \
    .withColumn("monthly_order_count", F.count("*").over(monthly_window)) \
    .withColumn("monthly_total", F.sum("total_amount").over(monthly_window))

# Customer lifetime metrics
customer_metrics = sales_df.groupBy("customer_id").agg(
    F.count("*").alias("total_orders"),
    F.sum("total_amount").alias("lifetime_value"),
    F.avg("total_amount").alias("avg_order_value"),
    F.min("order_date").alias("first_order_date"),
    F.max("order_date").alias("last_order_date"),
    F.countDistinct(F.year("order_date"), F.month("order_date")).alias("active_months")
)

# Calculate recency
customer_metrics = customer_metrics.withColumn(
    "days_since_last_order",
    F.datediff(F.current_date(), "last_order_date")
)
```

### Data Quality Checks

```python
from pyspark.sql import DataFrame

def run_data_quality_checks(df: DataFrame, rules: dict) -> dict:
    """
    Run data quality checks on a DataFrame.

    Args:
        df: Input DataFrame
        rules: Dictionary of column rules

    Returns:
        Dictionary of check results
    """
    results = {"total_rows": df.count(), "checks": []}

    for column, checks in rules.items():
        for check_type, params in checks.items():
            if check_type == "not_null":
                null_count = df.filter(F.col(column).isNull()).count()
                passed = null_count == 0
                results["checks"].append({
                    "column": column,
                    "check": "not_null",
                    "passed": passed,
                    "details": f"{null_count} null values found"
                })

            elif check_type == "unique":
                total = df.count()
                distinct = df.select(column).distinct().count()
                passed = total == distinct
                results["checks"].append({
                    "column": column,
                    "check": "unique",
                    "passed": passed,
                    "details": f"{total - distinct} duplicate values found"
                })

            elif check_type == "range":
                min_val, max_val = params
                out_of_range = df.filter(
                    (F.col(column) < min_val) | (F.col(column) > max_val)
                ).count()
                passed = out_of_range == 0
                results["checks"].append({
                    "column": column,
                    "check": "range",
                    "passed": passed,
                    "details": f"{out_of_range} values outside [{min_val}, {max_val}]"
                })

            elif check_type == "pattern":
                non_matching = df.filter(~F.col(column).rlike(params)).count()
                passed = non_matching == 0
                results["checks"].append({
                    "column": column,
                    "check": "pattern",
                    "passed": passed,
                    "details": f"{non_matching} values don't match pattern"
                })

    return results

# Define quality rules
quality_rules = {
    "customer_id": {"not_null": True, "unique": True},
    "email": {"not_null": True, "pattern": r"^[\w\.-]+@[\w\.-]+\.\w+$"},
    "order_total": {"not_null": True, "range": (0, 1000000)}
}

# Run checks
results = run_data_quality_checks(customer_df, quality_rules)
print(results)
```

### Delta Lake Integration

```python
# Write to Delta format
enriched_df.write \
    .format("delta") \
    .mode("overwrite") \
    .partitionBy("year", "month") \
    .save("abfss://curated@stsynapsedemo.dfs.core.windows.net/sales_enriched/")

# Read Delta table
delta_df = spark.read.format("delta").load(
    "abfss://curated@stsynapsedemo.dfs.core.windows.net/sales_enriched/"
)

# Time travel - read historical version
historical_df = spark.read \
    .format("delta") \
    .option("versionAsOf", 5) \
    .load("abfss://curated@stsynapsedemo.dfs.core.windows.net/sales_enriched/")

# Time travel - read at specific timestamp
snapshot_df = spark.read \
    .format("delta") \
    .option("timestampAsOf", "2021-02-01") \
    .load("abfss://curated@stsynapsedemo.dfs.core.windows.net/sales_enriched/")

# Merge (upsert) operation
from delta.tables import DeltaTable

delta_table = DeltaTable.forPath(
    spark,
    "abfss://curated@stsynapsedemo.dfs.core.windows.net/sales_enriched/"
)

delta_table.alias("target") \
    .merge(
        updates_df.alias("source"),
        "target.order_id = source.order_id"
    ) \
    .whenMatchedUpdate(set={
        "total_amount": "source.total_amount",
        "status": "source.status",
        "updated_at": "current_timestamp()"
    }) \
    .whenNotMatchedInsertAll() \
    .execute()
```

## Machine Learning with Spark

```python
from pyspark.ml import Pipeline
from pyspark.ml.feature import VectorAssembler, StandardScaler, StringIndexer
from pyspark.ml.classification import RandomForestClassifier
from pyspark.ml.evaluation import MulticlassClassificationEvaluator
from pyspark.ml.tuning import ParamGridBuilder, CrossValidator

# Prepare features
indexer = StringIndexer(inputCol="category", outputCol="category_index")
assembler = VectorAssembler(
    inputCols=["feature1", "feature2", "feature3", "category_index"],
    outputCol="features_raw"
)
scaler = StandardScaler(inputCol="features_raw", outputCol="features")
classifier = RandomForestClassifier(
    featuresCol="features",
    labelCol="label",
    numTrees=100
)

# Create pipeline
pipeline = Pipeline(stages=[indexer, assembler, scaler, classifier])

# Cross-validation
paramGrid = ParamGridBuilder() \
    .addGrid(classifier.numTrees, [50, 100, 200]) \
    .addGrid(classifier.maxDepth, [5, 10, 15]) \
    .build()

evaluator = MulticlassClassificationEvaluator(
    labelCol="label",
    predictionCol="prediction",
    metricName="accuracy"
)

cv = CrossValidator(
    estimator=pipeline,
    estimatorParamMaps=paramGrid,
    evaluator=evaluator,
    numFolds=5
)

# Train model
train_df, test_df = data_df.randomSplit([0.8, 0.2], seed=42)
cv_model = cv.fit(train_df)

# Evaluate
predictions = cv_model.transform(test_df)
accuracy = evaluator.evaluate(predictions)
print(f"Test Accuracy: {accuracy:.4f}")

# Save model
cv_model.bestModel.save(
    "abfss://models@stsynapsedemo.dfs.core.windows.net/churn_model/"
)
```

## Performance Tuning

```python
# Configure Spark session
spark.conf.set("spark.sql.adaptive.enabled", "true")
spark.conf.set("spark.sql.adaptive.coalescePartitions.enabled", "true")
spark.conf.set("spark.sql.adaptive.skewJoin.enabled", "true")
spark.conf.set("spark.sql.shuffle.partitions", "200")

# Cache frequently used DataFrames
customer_df.cache()
customer_df.count()  # Trigger cache

# Repartition for optimal parallelism
df_repartitioned = df.repartition(100, "customer_id")

# Coalesce for writing fewer files
df_output = df_processed.coalesce(10)

# Broadcast small tables for joins
from pyspark.sql.functions import broadcast

result_df = large_df.join(
    broadcast(small_lookup_df),
    "key_column"
)

# Check execution plan
df.explain(extended=True)
```

## Monitoring and Logging

```python
# Custom logging in notebooks
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("spark_etl")

def log_metrics(df: DataFrame, stage: str):
    """Log DataFrame metrics."""
    count = df.count()
    partitions = df.rdd.getNumPartitions()
    logger.info(f"Stage: {stage}, Rows: {count}, Partitions: {partitions}")

# Use Spark metrics
from pyspark import SparkContext

sc = spark.sparkContext
print(f"Application ID: {sc.applicationId}")
print(f"Spark Version: {sc.version}")

# Access Spark UI metrics programmatically
# (Available at https://<workspace>.dev.azuresynapse.net/sparkui/<app-id>)
```

## Best Practices

1. **Right-size your pool** - Start small and scale based on workload
2. **Use auto-scale and auto-pause** for cost optimization
3. **Partition data appropriately** for efficient parallel processing
4. **Leverage Delta Lake** for ACID transactions and time travel
5. **Cache strategically** - Only cache DataFrames used multiple times
6. **Monitor Spark UI** for performance bottlenecks

## Conclusion

Azure Synapse Spark pools provide a powerful, fully managed environment for big data processing and machine learning. The tight integration with other Synapse components enables seamless workflows from data ingestion to insights.

Start with small pools for development and scale up for production workloads, leveraging auto-scale capabilities to optimize costs.
