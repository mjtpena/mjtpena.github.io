---
title: "Fabric Eventstream Enhancements: Real-Time Data at Scale"
author: Michael John Peña
draft: false
date: 2024-11-23
tags:
  - Azure
  - Microsoft Fabric
  - Eventstream
  - Real-Time
  - Streaming

---

I wrote "Fabric Eventstream Enhancements: Real-Time Data at Scale" to share practical, production-minded guidance on this topic.

## New Eventstream Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Enhanced Eventstream                      │
├─────────────────────────────────────────────────────────────┤
│  Sources          │  Processing         │  Destinations     │
│  ─────────        │  ──────────         │  ────────────     │
│  • Event Hubs     │  • Transformations  │  • Lakehouse      │
│  • Kafka          │  • AI Enrichment    │  • KQL Database   │
│  • IoT Hub        │  • Aggregations     │  • Warehouse      │
│  • Custom Apps    │  • Joins            │  • Reflex         │
│  • CDC Sources    │  • Windowing        │  • Custom         │
│                   │  • ML Scoring       │                   │
└───────────────────┴─────────────────────┴───────────────────┘
```

## Creating Advanced Eventstreams

### Multi-Source Ingestion

```python
# Eventstreams are created via Fabric REST API or portal
# Example using REST API to create an eventstream
from azure.identity import DefaultAzureCredential
import requests
import os

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

workspace_id = os.environ["FABRIC_WORKSPACE_ID"]
base_url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}"

# Create an eventstream item
eventstream_payload = {
    "displayName": "UnifiedAnalytics",
    "type": "Eventstream",
    "description": "Multi-source unified analytics stream"
}

response = requests.post(f"{base_url}/items", headers=headers, json=eventstream_payload)
eventstream = response.json()
print(f"Created Eventstream: {eventstream.get('id')}")

# Note: Source configuration (IoT Hub, Kafka, CDC) is done via the Fabric portal
# The portal provides visual designers for:
# - Adding Azure IoT Hub as a source with consumer groups
# - Adding Kafka sources with SASL_SSL authentication
# - Adding Azure SQL CDC sources with table selection
# - Configuring transformations and multiple destinations
```

### Complex Transformations

```python
# For complex transformations, use Spark Structured Streaming in Fabric notebooks
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.window import Window

spark = SparkSession.builder.getOrCreate()

# Read from Event Hub using Spark Structured Streaming
eh_conf = {
    "eventhubs.connectionString": sc._jvm.org.apache.spark.eventhubs.EventHubsUtils.encrypt("<connection-string>")
}

raw_stream = spark.readStream \
    .format("eventhubs") \
    .options(**eh_conf) \
    .load()

# Parse and enrich IoT data
parsed_stream = raw_stream \
    .select(
        F.from_json(F.col("body").cast("string"), iot_schema).alias("data"),
        F.col("enqueuedTime").alias("event_time")
    ) \
    .select("data.*", "event_time") \
    .withColumn("temp_fahrenheit", (F.col("temperature") * 9/5) + 32) \
    .filter(F.col("temperature").between(-50, 150))

# Aggregate sensor readings with tumbling window
aggregated = parsed_stream \
    .withWatermark("event_time", "10 minutes") \
    .groupBy(
        F.window("event_time", "1 minute"),
        "device_id"
    ) \
    .agg(
        F.avg("temperature").alias("avg_temp"),
        F.min("temperature").alias("min_temp"),
        F.max("temperature").alias("max_temp"),
        F.avg("humidity").alias("avg_humidity"),
        F.count("*").alias("reading_count")
    )

# Write to Delta table
query = aggregated.writeStream \
    .format("delta") \
    .outputMode("append") \
    .option("checkpointLocation", "Files/checkpoints/sensor_agg") \
    .toTable("sensor_aggregates")
```

### AI-Powered Processing

```python
# For AI-powered streaming, use Azure AI services with Spark Structured Streaming
from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StringType, FloatType
from synapse.ml.cognitive import TextSentiment
from openai import AzureOpenAI

# Option 1: SynapseML for sentiment analysis (batch UDF approach)
sentiment_model = TextSentiment() \
    .setSubscriptionKey("<cognitive-services-key>") \
    .setLocation("eastus") \
    .setTextCol("feedback_text") \
    .setOutputCol("sentiment_result")

# Apply to streaming dataframe in micro-batches
def process_batch_with_sentiment(batch_df, batch_id):
    if batch_df.count() > 0:
        enriched = sentiment_model.transform(batch_df)
        enriched.write.mode("append").saveAsTable("enriched_feedback")

stream.writeStream \
    .foreachBatch(process_batch_with_sentiment) \
    .start()

# Option 2: Custom anomaly detection using statistics
from pyspark.ml.feature import StandardScaler

def detect_anomalies(df, metrics_cols, threshold=3.0):
    """Z-score based anomaly detection"""
    for col in metrics_cols:
        stats = df.agg(F.avg(col).alias("mean"), F.stddev(col).alias("std")).collect()[0]
        df = df.withColumn(
            f"{col}_zscore",
            F.abs((F.col(col) - stats["mean"]) / stats["std"])
        )
        df = df.withColumn(
            f"{col}_anomaly",
            F.col(f"{col}_zscore") > threshold
        )
    return df

# Option 3: MLflow model scoring
import mlflow

logged_model = "runs:/<run-id>/model"
model_udf = mlflow.pyfunc.spark_udf(spark, model_uri=logged_model)

scored_stream = stream_df.withColumn(
    "fraud_probability",
    model_udf(F.struct("amount", "customer_tenure", "product_category"))
)
```

## Destinations Configuration

```python
# Multi-destination streaming writes with Spark Structured Streaming
from pyspark.sql import SparkSession

spark = SparkSession.builder.getOrCreate()

# Destination 1: Write to Lakehouse Delta table
raw_query = parsed_stream \
    .withColumn("date_partition", F.to_date("timestamp")) \
    .writeStream \
    .format("delta") \
    .outputMode("append") \
    .partitionBy("date_partition", "device_id") \
    .option("checkpointLocation", "Files/checkpoints/raw_readings") \
    .toTable("raw_readings")

# Destination 2: Write aggregates to another table
agg_query = aggregated_stream \
    .writeStream \
    .format("delta") \
    .outputMode("append") \
    .option("checkpointLocation", "Files/checkpoints/sensor_agg") \
    .toTable("sensor_aggregates")

# Destination 3: Send alerts to Event Hub for downstream processing
from pyspark.sql.functions import to_json, struct

alert_stream = scored_stream \
    .filter(F.col("is_anomaly") == True) \
    .select(to_json(struct("*")).alias("body"))

# Configure Event Hub as sink
eh_write_conf = {
    "eventhubs.connectionString": sc._jvm.org.apache.spark.eventhubs.EventHubsUtils.encrypt("<alert-hub-connection>")
}

alert_query = alert_stream \
    .writeStream \
    .format("eventhubs") \
    .options(**eh_write_conf) \
    .option("checkpointLocation", "Files/checkpoints/alerts") \
    .start()

# Note: Destinations to KQL Database and Reflex are configured in Eventstream UI
# The portal provides visual routing based on filter conditions
```

## Monitoring and Management

```python
# Monitor streaming queries using Spark Structured Streaming APIs
from pyspark.sql import SparkSession

spark = SparkSession.builder.getOrCreate()

# Get all active streaming queries
for query in spark.streams.active:
    print(f"Query: {query.name}")
    print(f"  ID: {query.id}")
    print(f"  Status: {query.status}")
    print(f"  Is Active: {query.isActive}")

    # Get progress metrics
    progress = query.lastProgress
    if progress:
        print(f"  Input Rows/sec: {progress.get('inputRowsPerSecond', 0)}")
        print(f"  Processed Rows/sec: {progress.get('processedRowsPerSecond', 0)}")
        print(f"  Batch Duration: {progress.get('batchDuration', 0)}ms")

        # Source-specific metrics
        sources = progress.get('sources', [])
        for source in sources:
            print(f"  Source: {source.get('description', 'unknown')}")
            print(f"    Start Offset: {source.get('startOffset')}")
            print(f"    End Offset: {source.get('endOffset')}")

# Monitor via Fabric REST API
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token
headers = {"Authorization": f"Bearer {token}"}

# Get eventstream metrics
workspace_id = "your-workspace-id"
eventstream_id = "your-eventstream-id"
metrics_url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/eventstreams/{eventstream_id}/metrics"
response = requests.get(metrics_url, headers=headers)
print(response.json())
```

### Scaling Configuration

```python
# Scaling in Fabric is managed at the capacity level
# Eventstreams run within your Fabric capacity and scale based on capacity size

from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

# For Spark Structured Streaming, configure parallelism
spark.conf.set("spark.sql.shuffle.partitions", "32")
spark.conf.set("spark.streaming.backpressure.enabled", "true")
spark.conf.set("spark.streaming.kafka.maxRatePerPartition", "1000")

# Monitor capacity usage via Admin API
admin_url = "https://api.fabric.microsoft.com/v1/admin"
capacity_id = "your-capacity-id"

# Get capacity metrics
metrics_response = requests.get(
    f"{admin_url}/capacities/{capacity_id}/metrics",
    headers=headers,
    params={"startTime": "2024-01-01T00:00:00Z", "endTime": "2024-01-02T00:00:00Z"}
)

# For scheduled scaling, use Azure Automation or Logic Apps to resize capacity
# Example capacity resize via REST API:
resize_payload = {"sku": "F64"}  # Resize to F64
resize_response = requests.patch(
    f"{admin_url}/capacities/{capacity_id}",
    headers=headers,
    json=resize_payload
)
```

## Error Handling

```python
# Error handling in Spark Structured Streaming
from pyspark.sql import SparkSession
from pyspark.sql import functions as F

spark = SparkSession.builder.getOrCreate()

# Option 1: Use foreachBatch with try-except for error handling
def process_with_error_handling(batch_df, batch_id):
    try:
        # Process the batch
        processed = batch_df.transform(my_transformation)
        processed.write.mode("append").saveAsTable("processed_events")
    except Exception as e:
        # Write failed records to dead letter table
        error_df = batch_df.withColumn("error_message", F.lit(str(e))) \
                          .withColumn("batch_id", F.lit(batch_id)) \
                          .withColumn("error_time", F.current_timestamp())
        error_df.write.mode("append").saveAsTable("failed_events")
        print(f"Batch {batch_id} failed: {e}")

query = stream_df.writeStream \
    .foreachBatch(process_with_error_handling) \
    .option("checkpointLocation", "Files/checkpoints/stream") \
    .start()

# Option 2: Schema evolution with mergeSchema
stream_df.writeStream \
    .format("delta") \
    .option("mergeSchema", "true") \
    .option("checkpointLocation", "Files/checkpoints/evolving") \
    .toTable("evolving_schema_table")

# Option 3: Permissive mode for malformed records
from pyspark.sql.types import StructType

schema = StructType([...])
parsed = spark.readStream \
    .schema(schema) \
    .option("mode", "PERMISSIVE") \
    .option("columnNameOfCorruptRecord", "_corrupt_record") \
    .json("Files/input/")

# Filter and route corrupt records
corrupt = parsed.filter(F.col("_corrupt_record").isNotNull())
valid = parsed.filter(F.col("_corrupt_record").isNull())
```

Eventstream enhancements make real-time analytics more powerful and accessible. Start with simple streaming scenarios and progressively add complexity.

## Resources

- [Eventstream Documentation](https://learn.microsoft.com/en-us/fabric/real-time-analytics/eventstream)
- [Streaming Best Practices](https://learn.microsoft.com/en-us/fabric/real-time-analytics/best-practices)
- [KQL Database Integration](https://learn.microsoft.com/en-us/fabric/real-time-analytics/kql-database)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
