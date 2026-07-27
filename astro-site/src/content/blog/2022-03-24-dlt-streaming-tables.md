---
title: "Streaming Tables in Delta Live Tables"
author: Michael John Peña
draft: false
date: 2022-03-24
tags:
  - Azure
  - Databricks
  - Delta Live Tables
  - Streaming
  - Real-time

---

I wrote "Streaming Tables in Delta Live Tables" to share practical, production-minded guidance on this topic.

## Streaming vs Materialized Tables

```python
import dlt

# Streaming table: Processes incrementally, append-only
@dlt.table
def streaming_events():
    return dlt.read_stream("source")  # Uses read_stream

# Materialized table: Recomputes on each refresh
@dlt.table
def materialized_summary():
    return dlt.read("source")  # Uses read (batch)
```

## Creating Streaming Tables

### From Cloud Files (Auto Loader)

```python
@dlt.table(
    comment="Real-time events from blob storage"
)
def streaming_from_files():
    return (
        spark.readStream
        .format("cloudFiles")
        .option("cloudFiles.format", "json")
        .option("cloudFiles.schemaLocation", "/schema/events")
        .option("cloudFiles.inferColumnTypes", "true")
        .option("cloudFiles.schemaEvolutionMode", "addNewColumns")
        .load("/data/incoming/events/")
    )
```

### From Kafka

```python
@dlt.table
def streaming_from_kafka():
    return (
        spark.readStream
        .format("kafka")
        .option("kafka.bootstrap.servers", "broker:9092")
        .option("subscribe", "events")
        .option("startingOffsets", "earliest")
        .load()
        .select(
            col("key").cast("string"),
            from_json(col("value").cast("string"), schema).alias("data"),
            col("timestamp")
        )
        .select("key", "data.*", "timestamp")
    )
```

### From Event Hubs

```python
@dlt.table
def streaming_from_eventhubs():
    connection_string = dbutils.secrets.get("keyvault", "eventhubs-connection")

    return (
        spark.readStream
        .format("eventhubs")
        .option("eventhubs.connectionString",
                sc._jvm.org.apache.spark.eventhubs.EventHubsUtils.encrypt(connection_string))
        .option("eventhubs.consumerGroup", "$Default")
        .option("eventhubs.startingPosition",
                json.dumps({"offset": "-1", "seqNo": -1, "enqueuedTime": None, "isInclusive": True}))
        .load()
        .select(
            col("enqueuedTime").alias("event_time"),
            from_json(col("body").cast("string"), schema).alias("data")
        )
        .select("event_time", "data.*")
    )
```

### From Delta Table

```python
@dlt.table
def streaming_from_delta():
    return dlt.read_stream("bronze_events")  # Reads incrementally from Delta table
```

## Streaming Transformations

### Stateless Operations

```python
@dlt.table
def filtered_events():
    return (
        dlt.read_stream("raw_events")
        .filter("event_type = 'purchase'")
        .select("user_id", "product_id", "amount", "timestamp")
    )

@dlt.table
def enriched_events():
    events = dlt.read_stream("filtered_events")
    products = spark.table("dim_products")  # Static dimension

    return events.join(products, "product_id", "left")
```

### Stateful Operations (Windowed Aggregations)

```python
from pyspark.sql.functions import window

@dlt.table
def events_per_minute():
    return (
        dlt.read_stream("raw_events")
        .withWatermark("event_time", "5 minutes")
        .groupBy(
            window("event_time", "1 minute"),
            "region"
        )
        .agg(
            count("*").alias("event_count"),
            sum("amount").alias("total_amount")
        )
        .select(
            col("window.start").alias("window_start"),
            col("window.end").alias("window_end"),
            "region",
            "event_count",
            "total_amount"
        )
    )
```

### Sessionization

```python
@dlt.table
def user_sessions():
    return (
        dlt.read_stream("click_events")
        .withWatermark("event_time", "30 minutes")
        .groupBy(
            session_window("event_time", "30 minutes"),  # Gap-based session
            "user_id"
        )
        .agg(
            count("*").alias("clicks"),
            first("event_time").alias("session_start"),
            last("event_time").alias("session_end"),
            collect_list("page_url").alias("pages_visited")
        )
    )
```

## Watermarks and Late Data

```python
@dlt.table
def windowed_with_watermark():
    return (
        dlt.read_stream("events")
        # Allow events up to 10 minutes late
        .withWatermark("event_timestamp", "10 minutes")
        .groupBy(
            window("event_timestamp", "5 minutes"),
            "category"
        )
        .agg(count("*").alias("count"))
    )

# Events arriving after watermark are dropped
# Watermark = max(event_timestamp) - threshold
```

## Output Modes

DLT streaming tables use append mode by default. For aggregations:

```python
# Append mode (default): Only new rows
@dlt.table
def append_table():
    return dlt.read_stream("source")

# For windowed aggregations, results are appended
# when the watermark passes the window end
@dlt.table
def windowed_append():
    return (
        dlt.read_stream("source")
        .withWatermark("ts", "10 minutes")
        .groupBy(window("ts", "5 minutes"))
        .count()
    )
```

## Streaming Joins

### Stream-Static Join

```python
@dlt.table
def enriched_transactions():
    transactions = dlt.read_stream("raw_transactions")
    customers = spark.table("dim_customers")  # Static table

    return transactions.join(
        F.broadcast(customers),  # Broadcast small dimension
        "customer_id",
        "left"
    )
```

### Stream-Stream Join

```python
@dlt.table
def orders_with_payments():
    orders = (
        dlt.read_stream("orders")
        .withWatermark("order_time", "1 hour")
    )

    payments = (
        dlt.read_stream("payments")
        .withWatermark("payment_time", "1 hour")
    )

    return orders.join(
        payments,
        expr("""
            orders.order_id = payments.order_id AND
            payment_time BETWEEN order_time AND order_time + INTERVAL 1 HOUR
        """),
        "leftOuter"
    )
```

## Deduplication

```python
@dlt.table
def deduplicated_events():
    return (
        dlt.read_stream("raw_events")
        .withWatermark("event_time", "1 hour")
        .dropDuplicatesWithinWatermark(["event_id"])
    )

# Alternative: Use dropDuplicates with watermark
@dlt.table
def deduplicated_v2():
    return (
        dlt.read_stream("raw_events")
        .withWatermark("event_time", "1 hour")
        .dropDuplicates(["event_id", "event_time"])
    )
```

## Continuous vs Triggered Pipelines

### Continuous Pipeline

```python
# Pipeline runs continuously, processing data as it arrives
# Configure in pipeline settings:
# "continuous": true

# Low latency, always running
# Higher cost, but minimal delay
```

### Triggered Pipeline

```python
# Pipeline runs on schedule or manual trigger
# Configure in pipeline settings:
# "continuous": false,
# "trigger": {"interval": "5 minutes"}

# Batch-like processing with micro-batches
# Lower cost, some delay acceptable
```

## Checkpointing and Recovery

DLT handles checkpointing automatically:

```python
# Checkpoints are managed per streaming table
# On failure, processing resumes from last checkpoint
# No duplicate processing (exactly-once semantics)

# Reset checkpoints only with full refresh
# Configure: "pipelines.reset.allowed": "false" to prevent accidental resets
```

## Performance Optimization

### Partition Management

```python
@dlt.table(
    table_properties={
        "pipelines.autoOptimize.zOrderCols": "user_id,event_time"
    }
)
def optimized_streaming():
    return dlt.read_stream("source")
```

### Cluster Sizing

```python
# For streaming pipelines, use enhanced autoscaling
cluster_config = {
    "autoscale": {
        "mode": "ENHANCED",
        "min_workers": 2,
        "max_workers": 10
    }
}
```

### Batch Size

```python
# Control micro-batch size for throughput vs latency
@dlt.table
def tuned_streaming():
    return (
        spark.readStream
        .format("cloudFiles")
        .option("cloudFiles.format", "json")
        .option("maxFilesPerTrigger", 1000)  # Files per batch
        .option("maxBytesPerTrigger", "1g")   # Size per batch
        .load("/data/incoming/")
    )
```

## Monitoring Streaming Tables

```python
# Query streaming metrics
metrics = spark.sql("""
    SELECT
        flow_name,
        timestamp,
        metrics.numOutputRows as output_rows,
        metrics.inputRowsPerSecond as input_rate,
        metrics.processedRowsPerSecond as process_rate
    FROM system.live_tables.flow_progress_log
    WHERE pipeline_id = 'your-pipeline-id'
    AND flow_type = 'STREAMING'
    ORDER BY timestamp DESC
""")
```

## Complete Streaming Pipeline

```python
import dlt
from pyspark.sql.functions import *

# Bronze: Raw ingestion
@dlt.table(comment="Raw events from IoT devices")
def bronze_iot_events():
    return (
        spark.readStream
        .format("cloudFiles")
        .option("cloudFiles.format", "json")
        .option("cloudFiles.schemaLocation", "/schema/iot")
        .load("/data/iot/events/")
    )

# Silver: Deduplicated and validated
@dlt.table
@dlt.expect_or_drop("valid_device", "device_id IS NOT NULL")
@dlt.expect_or_drop("valid_reading", "value BETWEEN -1000 AND 1000")
def silver_iot_events():
    return (
        dlt.read_stream("bronze_iot_events")
        .withWatermark("event_time", "10 minutes")
        .dropDuplicatesWithinWatermark(["device_id", "event_time"])
    )

# Gold: Real-time aggregations
@dlt.table
def gold_device_metrics_5min():
    return (
        dlt.read_stream("silver_iot_events")
        .withWatermark("event_time", "15 minutes")
        .groupBy(
            window("event_time", "5 minutes"),
            "device_id",
            "metric_type"
        )
        .agg(
            avg("value").alias("avg_value"),
            min("value").alias("min_value"),
            max("value").alias("max_value"),
            count("*").alias("reading_count")
        )
    )

# Gold: Anomaly detection
@dlt.table
def gold_device_anomalies():
    return (
        dlt.read_stream("silver_iot_events")
        .withWatermark("event_time", "1 hour")
        .groupBy(
            window("event_time", "1 hour", "5 minutes"),  # Sliding window
            "device_id"
        )
        .agg(
            avg("value").alias("avg_value"),
            stddev("value").alias("stddev_value")
        )
        .filter("stddev_value > 10")  # Flag high variance devices
    )
```

## Conclusion

Streaming tables in Delta Live Tables provide:
- Declarative streaming with automatic checkpointing
- Built-in exactly-once processing guarantees
- Seamless integration with batch tables
- Simplified windowing and watermark management

Whether processing IoT data, clickstreams, or CDC feeds, DLT streaming tables make real-time pipelines accessible and maintainable.

## Resources

- [Streaming Tables Documentation](https://docs.databricks.com/delta-live-tables/transform.html)
- [Watermarks and Late Data](https://docs.databricks.com/structured-streaming/watermarks.html)
- [Auto Loader](https://docs.databricks.com/ingestion/auto-loader/index.html)

