---
title: "Real-Time Data Streaming with Microsoft Fabric Eventstreams"
description: "Batch processing introduces latency between data generation and insight availability. For fraud detection, operational monitoring, and customer engagement…"
author: Michael John Peña
draft: false
date: 2025-11-11
tags:
  - Microsoft Fabric
  - Event Streaming
  - Real-Time Analytics
  - Data Engineering
  - Kafka
---

## Why Real-Time Matters

Batch processing introduces latency between data generation and insight availability. For fraud detection, operational monitoring, and customer engagement, this delay can mean missed opportunities or increased risk.

## Setting Up Eventstreams

Create a streaming pipeline that processes events as they arrive:

```python
from azure.eventhub import EventHubProducerClient, EventData
from azure.identity import DefaultAzureCredential
import json
from datetime import datetime

class EventstreamProducer:
    def __init__(self, eventhub_name: str, namespace: str):
        self.producer = EventHubProducerClient(
            fully_qualified_namespace=f"{namespace}.servicebus.windows.net",
            eventhub_name=eventhub_name,
            credential=DefaultAzureCredential()
        )

    async def send_events(self, events: list[dict]):
        """Send a batch of events to Eventstream."""
        async with self.producer:
            event_batch = await self.producer.create_batch()

            for event in events:
                event_data = EventData(json.dumps({
                    **event,
                    "timestamp": datetime.utcnow().isoformat(),
                    "source": "order-service"
                }))

                # Add properties for routing
                event_data.properties = {
                    "event_type": event.get("type", "unknown"),
                    "priority": event.get("priority", "normal")
                }

                try:
                    event_batch.add(event_data)
                except ValueError:
                    # Batch full, send and create new batch
                    await self.producer.send_batch(event_batch)
                    event_batch = await self.producer.create_batch()
                    event_batch.add(event_data)

            await self.producer.send_batch(event_batch)

# Usage
producer = EventstreamProducer("orders-stream", "fabric-namespace")
await producer.send_events([
    {"type": "order_placed", "order_id": "12345", "amount": 99.99},
    {"type": "order_shipped", "order_id": "12344", "carrier": "FedEx"}
])
```

## Processing with KQL

Fabric's Real-Time Analytics uses Kusto Query Language for stream processing:

```kusto
// Create a materialized view for real-time aggregations
.create materialized-view OrderMetrics on table OrderEvents
{
    OrderEvents
    | summarize
        TotalOrders = count(),
        TotalRevenue = sum(Amount),
        AvgOrderValue = avg(Amount)
    by bin(Timestamp, 1h), Region
}

// Detect anomalies in real-time
OrderEvents
| where Timestamp > ago(5m)
| summarize OrderCount = count() by bin(Timestamp, 1m)
| extend ExpectedCount = 100  // baseline
| extend Anomaly = OrderCount > ExpectedCount * 2
                   or OrderCount < ExpectedCount * 0.5
| where Anomaly == true

// Join streams for enrichment
OrderEvents
| join kind=inner (CustomerDimension) on CustomerId
| project
    OrderId,
    CustomerName,
    CustomerSegment,
    Amount,
    Timestamp
```

## Connecting to Lakehouses

Route processed events to Delta tables for persistence:

```python
# Fabric notebook for stream-to-lakehouse ingestion
from pyspark.sql.functions import from_json, col
from pyspark.sql.types import StructType, StringType, DoubleType, TimestampType

schema = StructType() \
    .add("order_id", StringType()) \
    .add("amount", DoubleType()) \
    .add("timestamp", TimestampType())

# Read from Eventstream
stream_df = spark.readStream \
    .format("kafka") \
    .option("subscribe", "orders-stream") \
    .load()

# Parse and write to lakehouse
parsed_df = stream_df \
    .select(from_json(col("value").cast("string"), schema).alias("data")) \
    .select("data.*")

parsed_df.writeStream \
    .format("delta") \
    .outputMode("append") \
    .option("checkpointLocation", "/checkpoints/orders") \
    .toTable("lakehouse.orders")
```

Real-time streaming with Fabric Eventstreams enables organizations to act on data immediately while maintaining the analytical capabilities of the broader lakehouse platform.
