---
title: "Databricks Structured Streaming: Real-Time Data Processing"
author: Michael John Peña
draft: false
date: 2020-10-18
tags:
  - Databricks
  - Spark
  - Streaming
  - Data Engineering

---

I wrote "Databricks Structured Streaming: Real-Time Data Processing" to share practical, production-minded guidance on this topic.

## Basic Stream

```python
# Read from Kafka
df = (spark
    .readStream
    .format("kafka")
    .option("kafka.bootstrap.servers", "broker:9092")
    .option("subscribe", "events")
    .load()
)

# Parse JSON messages
from pyspark.sql.functions import from_json, col
from pyspark.sql.types import StructType, StringType, TimestampType, DoubleType

schema = StructType() \
    .add("event_id", StringType()) \
    .add("event_time", TimestampType()) \
    .add("user_id", StringType()) \
    .add("amount", DoubleType())

events = df.select(
    from_json(col("value").cast("string"), schema).alias("data")
).select("data.*")

# Write to Delta Lake
query = (events
    .writeStream
    .format("delta")
    .outputMode("append")
    .option("checkpointLocation", "/checkpoints/events")
    .table("events_bronze")
)
```

## Event Time Processing

```python
from pyspark.sql.functions import window, sum, count

# Aggregate by time window
windowed = (events
    .withWatermark("event_time", "10 minutes")
    .groupBy(
        window("event_time", "5 minutes"),
        "user_id"
    )
    .agg(
        count("*").alias("event_count"),
        sum("amount").alias("total_amount")
    )
)
```

## Stream-Static Joins

```python
# Static dimension table
users = spark.table("users")

# Join streaming events with static users
enriched = events.join(
    users,
    events.user_id == users.id,
    "left"
)
```

## Stream-Stream Joins

```python
# Two streams
orders = spark.readStream.format("delta").table("orders")
payments = spark.readStream.format("delta").table("payments")

# Join with time constraint
joined = orders.join(
    payments,
    expr("""
        orders.order_id = payments.order_id AND
        payments.payment_time BETWEEN orders.order_time AND orders.order_time + INTERVAL 1 HOUR
    """),
    "leftOuter"
)
```

## Auto Loader (Databricks)

Incrementally process files as they arrive.

```python
df = (spark
    .readStream
    .format("cloudFiles")
    .option("cloudFiles.format", "json")
    .option("cloudFiles.schemaLocation", "/schema/events")
    .load("/data/landing/events/")
)
```

## Trigger Modes

```python
# Process as fast as possible (default)
.trigger(processingTime="0 seconds")

# Micro-batch every 10 seconds
.trigger(processingTime="10 seconds")

# Process all available data once
.trigger(availableNow=True)

# Continuous processing (experimental)
.trigger(continuous="1 second")
```

## Checkpointing and Recovery

```python
# Checkpoint stores offset and state
query = (df
    .writeStream
    .format("delta")
    .option("checkpointLocation", "/checkpoints/my-stream")
    .start()
)

# Stream recovers from checkpoint on restart
```

## Monitoring Streams

```python
# Get stream status
query.status

# Get recent progress
query.recentProgress

# Wait for termination
query.awaitTermination()

# Stop stream
query.stop()
```

## Production Patterns

### Multiple Outputs

```python
def foreach_batch_function(df, epoch_id):
    # Write to Delta
    df.write.format("delta").mode("append").save("/data/silver")
    # Write to SQL
    df.write.jdbc(url, "events", mode="append", properties=props)

query = (df
    .writeStream
    .foreachBatch(foreach_batch_function)
    .start()
)
```

Structured Streaming makes real-time processing accessible with familiar DataFrame semantics.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
