---
title: Real-Time Data Processing with Spark Structured Streaming
author: Michael John Pena
draft: false
date: 2021-03-16
url: /blog/spark-structured-streaming/
tags:
  - Azure
  - Spark
  - Streaming
  - Databricks
  - Real-Time Analytics
---

The appeal of Spark Structured Streaming is that you write it almost identically to a batch Spark job. Same DataFrame API, same transformations, same Spark SQL. The engine handles the continuous triggering, checkpointing, and fault recovery. In practice the shift from batch to streaming adds a small set of new concepts—watermarking for late-arriving events, output modes (append, complete, update), trigger intervals—but none of them require a completely different mental model. This is deliberate Spark design and it's the reason I recommend Structured Streaming over standalone Kafka Streams or Flink to teams that already know Spark.

## Structured Streaming Basics

The key concept is treating a live data stream as an unbounded table that is continuously appended. You can then run SQL-like queries against this table.

```python
from pyspark.sql import SparkSession
from pyspark.sql.functions import *
from pyspark.sql.types import *

spark = SparkSession.builder \
    .appName("StructuredStreamingDemo") \
    .getOrCreate()

# Define schema for incoming data
schema = StructType([
    StructField("event_id", StringType(), True),
    StructField("event_type", StringType(), True),
    StructField("user_id", StringType(), True),
    StructField("timestamp", TimestampType(), True),
    StructField("properties", MapType(StringType(), StringType()), True)
])

# Read from Kafka
kafka_df = spark.readStream \
    .format("kafka") \
    .option("kafka.bootstrap.servers", "kafka:9092") \
    .option("subscribe", "events") \
    .option("startingOffsets", "latest") \
    .load()

# Parse JSON value
events_df = kafka_df \
    .selectExpr("CAST(value AS STRING) as json_str") \
    .select(from_json(col("json_str"), schema).alias("data")) \
    .select("data.*")
```

## Reading from Event Hubs

```python
# Azure Event Hubs configuration
eh_connection_string = "Endpoint=sb://myhub.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=xxx"
eh_conf = {
    'eventhubs.connectionString': sc._jvm.org.apache.spark.eventhubs.EventHubsUtils.encrypt(eh_connection_string)
}

# Read stream from Event Hubs
eh_df = spark.readStream \
    .format("eventhubs") \
    .options(**eh_conf) \
    .load()

# Parse Event Hubs body
events = eh_df \
    .withColumn("body", col("body").cast("string")) \
    .select(
        from_json(col("body"), schema).alias("event"),
        col("enqueuedTime").alias("event_time"),
        col("offset"),
        col("sequenceNumber")
    ) \
    .select("event.*", "event_time")
```

## Windowed Aggregations

```python
# Tumbling window - fixed-size, non-overlapping
tumbling_counts = events_df \
    .withWatermark("timestamp", "10 minutes") \
    .groupBy(
        window(col("timestamp"), "5 minutes"),
        col("event_type")
    ) \
    .agg(
        count("*").alias("event_count"),
        countDistinct("user_id").alias("unique_users")
    )

# Sliding window - overlapping windows
sliding_avg = events_df \
    .withWatermark("timestamp", "10 minutes") \
    .groupBy(
        window(col("timestamp"), "10 minutes", "5 minutes"),  # 10 min window, 5 min slide
        col("event_type")
    ) \
    .agg(
        avg("properties.duration").alias("avg_duration"),
        count("*").alias("count")
    )

# Session window - gap-based windows
session_events = events_df \
    .withWatermark("timestamp", "30 minutes") \
    .groupBy(
        session_window(col("timestamp"), "10 minutes"),
        col("user_id")
    ) \
    .agg(
        count("*").alias("events_in_session"),
        first("event_type").alias("first_event"),
        last("event_type").alias("last_event"),
        min("timestamp").alias("session_start"),
        max("timestamp").alias("session_end")
    )
```

## Stream-Stream Joins

```python
# Define impressions stream
impressions_schema = StructType([
    StructField("impression_id", StringType()),
    StructField("ad_id", StringType()),
    StructField("user_id", StringType()),
    StructField("timestamp", TimestampType())
])

impressions = spark.readStream \
    .format("kafka") \
    .option("kafka.bootstrap.servers", "kafka:9092") \
    .option("subscribe", "impressions") \
    .load() \
    .select(from_json(col("value").cast("string"), impressions_schema).alias("data")) \
    .select("data.*") \
    .withWatermark("timestamp", "10 minutes")

# Define clicks stream
clicks_schema = StructType([
    StructField("click_id", StringType()),
    StructField("impression_id", StringType()),
    StructField("timestamp", TimestampType())
])

clicks = spark.readStream \
    .format("kafka") \
    .option("kafka.bootstrap.servers", "kafka:9092") \
    .option("subscribe", "clicks") \
    .load() \
    .select(from_json(col("value").cast("string"), clicks_schema).alias("data")) \
    .select("data.*") \
    .withWatermark("timestamp", "10 minutes")

# Join impressions with clicks (with time constraint)
impression_clicks = impressions.alias("i").join(
    clicks.alias("c"),
    expr("""
        i.impression_id = c.impression_id AND
        c.timestamp >= i.timestamp AND
        c.timestamp <= i.timestamp + INTERVAL 30 MINUTES
    """),
    "leftOuter"
).select(
    col("i.impression_id"),
    col("i.ad_id"),
    col("i.user_id"),
    col("i.timestamp").alias("impression_time"),
    col("c.click_id"),
    col("c.timestamp").alias("click_time"),
    (col("c.click_id").isNotNull()).alias("was_clicked")
)
```

## Stream-Static Joins

```python
# Load static dimension data
user_dim = spark.read.format("delta").load("/delta/user_dimension")

# Enrich stream with static data
enriched_events = events_df.join(
    user_dim,
    events_df.user_id == user_dim.user_id,
    "left"
).select(
    events_df["*"],
    user_dim["user_name"],
    user_dim["user_segment"],
    user_dim["registration_date"]
)
```

## Stateful Processing with mapGroupsWithState

```python
from pyspark.sql.streaming import GroupState

# Define state schema
class UserState:
    def __init__(self, total_events=0, last_event_time=None, session_id=None):
        self.total_events = total_events
        self.last_event_time = last_event_time
        self.session_id = session_id

def update_user_state(user_id, events, state: GroupState):
    """Custom stateful processing for user sessions."""

    # Get or initialize state
    if state.exists:
        current_state = state.get
    else:
        current_state = UserState()

    # Process events
    event_list = list(events)
    new_event_count = len(event_list)

    if new_event_count > 0:
        latest_event = max(event_list, key=lambda x: x.timestamp)

        # Check for session timeout (30 minutes)
        if current_state.last_event_time:
            time_gap = (latest_event.timestamp - current_state.last_event_time).total_seconds()
            if time_gap > 1800:  # New session
                current_state.session_id = str(uuid.uuid4())
                current_state.total_events = new_event_count
            else:
                current_state.total_events += new_event_count
        else:
            current_state.session_id = str(uuid.uuid4())
            current_state.total_events = new_event_count

        current_state.last_event_time = latest_event.timestamp

    # Update state
    state.update(current_state)

    # Set timeout for state expiration
    state.setTimeoutDuration("1 hour")

    # Return output
    return (user_id, current_state.session_id, current_state.total_events)

# Apply stateful processing
user_sessions = events_df \
    .groupByKey(lambda x: x.user_id) \
    .mapGroupsWithState(
        update_user_state,
        outputMode="update",
        timeoutConf=GroupStateTimeout.ProcessingTimeTimeout
    )
```

## Writing to Delta Lake

```python
# Write aggregations to Delta with merge
def write_to_delta_with_merge(batch_df, batch_id):
    """Merge micro-batch into Delta table."""
    from delta.tables import DeltaTable

    if batch_df.count() == 0:
        return

    delta_table = DeltaTable.forPath(spark, "/delta/event_counts")

    delta_table.alias("target").merge(
        batch_df.alias("source"),
        "target.window_start = source.window.start AND target.event_type = source.event_type"
    ).whenMatchedUpdate(set={
        "event_count": "source.event_count",
        "unique_users": "source.unique_users",
        "updated_at": "current_timestamp()"
    }).whenNotMatchedInsert(values={
        "window_start": "source.window.start",
        "window_end": "source.window.end",
        "event_type": "source.event_type",
        "event_count": "source.event_count",
        "unique_users": "source.unique_users",
        "updated_at": "current_timestamp()"
    }).execute()

# Use foreachBatch for custom logic
query = tumbling_counts \
    .writeStream \
    .foreachBatch(write_to_delta_with_merge) \
    .outputMode("update") \
    .option("checkpointLocation", "/checkpoints/event_counts") \
    .trigger(processingTime="1 minute") \
    .start()

# Simple append to Delta
append_query = events_df \
    .writeStream \
    .format("delta") \
    .outputMode("append") \
    .option("checkpointLocation", "/checkpoints/raw_events") \
    .option("path", "/delta/raw_events") \
    .partitionBy("event_type") \
    .trigger(processingTime="30 seconds") \
    .start()
```

## Monitoring Streaming Queries

```python
# Get query progress
query = events_df.writeStream \
    .format("console") \
    .start()

# Check status
print(query.status)
print(query.lastProgress)
print(query.recentProgress)

# Custom listener for monitoring
class StreamingQueryListener:
    def onQueryStarted(self, event):
        print(f"Query started: {event.id}")

    def onQueryProgress(self, event):
        print(f"Progress: {event.progress.numInputRows} rows")

    def onQueryTerminated(self, event):
        print(f"Query terminated: {event.id}")

spark.streams.addListener(StreamingQueryListener())

# Stop query gracefully
query.stop()
```

## Error Handling and Recovery

```python
# Configure checkpointing for recovery
query = events_df \
    .writeStream \
    .format("delta") \
    .option("checkpointLocation", "/checkpoints/my_stream") \
    .option("path", "/delta/output") \
    .start()

# Handle bad records
events_with_error_handling = kafka_df \
    .select(
        from_json(
            col("value").cast("string"),
            schema,
            {"mode": "PERMISSIVE", "columnNameOfCorruptRecord": "_corrupt_record"}
        ).alias("data")
    ) \
    .select("data.*") \
    .filter(col("_corrupt_record").isNull())  # Filter out bad records

# Write bad records to dead letter queue
bad_records = kafka_df \
    .select(
        from_json(col("value").cast("string"), schema).alias("data"),
        col("value").cast("string").alias("raw_value")
    ) \
    .filter(col("data").isNull()) \
    .select("raw_value", current_timestamp().alias("error_time"))

bad_records.writeStream \
    .format("delta") \
    .option("path", "/delta/dead_letter_queue") \
    .option("checkpointLocation", "/checkpoints/dlq") \
    .start()
```

## Conclusion

Spark Structured Streaming provides a powerful unified model for batch and stream processing. Key advantages:

- **Unified API**: Same code works for batch and streaming
- **Exactly-once semantics**: With checkpointing and idempotent sinks
- **Late data handling**: Watermarks handle out-of-order events
- **Fault tolerance**: Automatic recovery from failures

Combined with Delta Lake and Azure services like Event Hubs, it forms the backbone of modern real-time data architectures.
