---
title: "Real-Time Analytics in Fabric: Architecture Patterns and Implementation"
description: "Real-time analytics in Fabric provides a powerful, integrated solution for streaming data. Start with simple patterns and evolve to more complex scenarios…"
author: Michael John Peña
draft: false
date: 2025-01-12
tags:
  - Microsoft Fabric
  - Real-Time Analytics
  - Streaming
  - KQL
  - Azure
---

## Real-Time Intelligence Components

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Sources   │────►│  Eventstream │────►│ KQL Database│
│ Event Hubs  │     │  Transform   │     │  Storage    │
│ Kafka       │     │  Route       │     │  Query      │
│ IoT Hub     │     │  Enrich      │     │  Analyze    │
└─────────────┘     └──────────────┘     └─────────────┘
                                                │
                    ┌──────────────────────────┴─────────┐
                    ▼                                    ▼
              ┌──────────┐                        ┌──────────┐
              │ Lakehouse│                        │Real-Time │
              │ Archive  │                        │Dashboard │
              └──────────┘                        └──────────┘
```

## Pattern 1: Simple Event Processing

For straightforward event ingestion and analysis:

```python
# Create eventstream via Fabric REST API
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

workspace_id = "your-workspace-id"
base_url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}"

# Create eventstream item
eventstream_payload = {
    "displayName": "iot_telemetry",
    "type": "Eventstream",
    "description": "IoT telemetry ingestion from Event Hub"
}

response = requests.post(f"{base_url}/items", headers=headers, json=eventstream_payload)
eventstream = response.json()
print(f"Created Eventstream: {eventstream.get('id')}")

# Note: Eventstream source (Event Hub) and destination (KQL Database) configuration
# is done through the Fabric portal visual designer:
# 1. Open the eventstream in Fabric
# 2. Add Azure Event Hub as source (configure namespace, event hub, consumer group)
# 3. Add KQL Database as destination (select database and table)
# 4. Configure field mapping in the visual editor
# 5. Publish the eventstream
```

Query the data in KQL:

```kusto
// Real-time device metrics
raw_telemetry
| where timestamp > ago(1h)
| summarize
    avg_temp = avg(temperature),
    max_temp = max(temperature),
    min_temp = min(temperature),
    reading_count = count()
    by device_id, bin(timestamp, 5m)
| order by timestamp desc

// Detect anomalies
raw_telemetry
| where timestamp > ago(24h)
| summarize avg_temp = avg(temperature), stdev_temp = stdev(temperature) by device_id
| join kind=inner (
    raw_telemetry
    | where timestamp > ago(1h)
) on device_id
| where abs(temperature - avg_temp) > 3 * stdev_temp
| project timestamp, device_id, temperature, avg_temp, stdev_temp
```

## Pattern 2: Stream Processing with Transformations

For scenarios requiring real-time transformations, use Spark Structured Streaming:

```python
# Stream processing with PySpark in Fabric notebooks
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StringType, DoubleType, TimestampType

spark = SparkSession.builder.getOrCreate()

# Define schema for POS events
pos_schema = StructType() \
    .add("store_id", StringType()) \
    .add("quantity", DoubleType()) \
    .add("unit_price", DoubleType()) \
    .add("event_time", TimestampType())

# Read from Kafka
kafka_df = spark.readStream \
    .format("kafka") \
    .option("kafka.bootstrap.servers", "kafka-cluster:9092") \
    .option("subscribe", "point-of-sale") \
    .load()

# Parse and transform
parsed_df = kafka_df \
    .select(F.from_json(F.col("value").cast("string"), pos_schema).alias("data")) \
    .select("data.*") \
    .withColumn("total_amount", F.col("quantity") * F.col("unit_price")) \
    .withColumn("tax_amount", F.col("total_amount") * 0.1) \
    .withColumn("processed_time", F.current_timestamp())

# Add region lookup (broadcast join with reference data)
store_regions = spark.read.table("store_regions")
enriched_df = parsed_df.join(F.broadcast(store_regions), "store_id", "left")

# Write all transactions to Delta table
all_sales_query = enriched_df.writeStream \
    .format("delta") \
    .outputMode("append") \
    .option("checkpointLocation", "Files/checkpoints/all_sales") \
    .toTable("all_transactions")

# Write high-value alerts to separate table
high_value_query = enriched_df \
    .filter(F.col("total_amount") > 1000) \
    .writeStream \
    .format("delta") \
    .outputMode("append") \
    .option("checkpointLocation", "Files/checkpoints/high_value") \
    .toTable("high_value_alerts")
```

## Pattern 3: Windowed Aggregations

For time-based aggregations using Spark Structured Streaming:

```python
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StringType, IntegerType, TimestampType

spark = SparkSession.builder.getOrCreate()

# Read clickstream data
clickstream_df = spark.readStream \
    .format("delta") \
    .table("raw_clickstream")

# Tumbling window aggregation (1-minute windows)
page_view_counts = clickstream_df \
    .withWatermark("event_time", "10 minutes") \
    .groupBy(
        F.window("event_time", "1 minute"),
        "page_url",
        "user_segment"
    ) \
    .agg(
        F.count("*").alias("view_count"),
        F.countDistinct("user_id").alias("unique_users"),
        F.avg("time_on_page").alias("avg_time_on_page")
    ) \
    .select(
        F.col("window.start").alias("window_start"),
        F.col("window.end").alias("window_end"),
        "page_url", "user_segment",
        "view_count", "unique_users", "avg_time_on_page"
    )

# Sliding window for trends (5-minute window, 1-minute slide)
rolling_metrics = clickstream_df \
    .withWatermark("event_time", "10 minutes") \
    .groupBy(
        F.window("event_time", "5 minutes", "1 minute"),
        "page_url"
    ) \
    .agg(
        F.count("*").alias("rolling_views"),
        F.countDistinct("user_id").alias("rolling_unique_users")
    )

# Write aggregations to Delta tables
page_views_query = page_view_counts.writeStream \
    .format("delta") \
    .outputMode("append") \
    .option("checkpointLocation", "Files/checkpoints/page_views") \
    .toTable("page_view_aggregates")
```

## Pattern 4: Real-Time Joins

Joining streaming data with reference data using Spark:

```python
from pyspark.sql import SparkSession
from pyspark.sql import functions as F

spark = SparkSession.builder.getOrCreate()

# Read streaming order events
order_events = spark.readStream \
    .format("delta") \
    .table("raw_order_events")

# Load reference data (static or periodically refreshed)
# Use broadcast for small dimension tables
customer_info = spark.read.table("customers")
product_info = spark.read.table("products")

# Stream-static join with broadcast for small tables
enriched_orders = order_events \
    .join(
        F.broadcast(customer_info),
        order_events.customer_id == customer_info.customer_id,
        "left"
    ) \
    .join(
        F.broadcast(product_info),
        order_events.product_id == product_info.product_id,
        "left"
    ) \
    .select(
        order_events.order_id,
        order_events.customer_id,
        customer_info.customer_name,
        customer_info.segment,
        order_events.product_id,
        product_info.product_name,
        product_info.category,
        order_events.quantity,
        order_events.amount,
        order_events.order_time
    )

# Write enriched stream
query = enriched_orders.writeStream \
    .format("delta") \
    .outputMode("append") \
    .option("checkpointLocation", "Files/checkpoints/enriched_orders") \
    .toTable("enriched_orders")

# For frequently changing reference data, use foreachBatch to refresh
def process_with_fresh_reference(batch_df, batch_id):
    # Reload reference data each batch
    customers = spark.read.table("customers")
    products = spark.read.table("products")

    enriched = batch_df \
        .join(F.broadcast(customers), "customer_id", "left") \
        .join(F.broadcast(products), "product_id", "left")

    enriched.write.mode("append").saveAsTable("enriched_orders")
```

## Pattern 5: Real-Time Alerting

Setting up automated alerts:

```kusto
// Create a function for anomaly detection
.create-or-alter function DetectAnomalies() {
    raw_telemetry
    | where timestamp > ago(5m)
    | summarize
        current_temp = avg(temperature),
        reading_count = count()
        by device_id
    | join kind=inner (
        raw_telemetry
        | where timestamp between (ago(24h) .. ago(5m))
        | summarize baseline_temp = avg(temperature), stdev_temp = stdev(temperature)
            by device_id
    ) on device_id
    | where abs(current_temp - baseline_temp) > 3 * stdev_temp
    | project
        device_id,
        current_temp,
        baseline_temp,
        deviation = abs(current_temp - baseline_temp) / stdev_temp,
        alert_time = now()
}

// Create continuous export for alerts
.create-or-alter continuous-export AlertExport
over (DetectAnomalies)
to table AlertHistory
with (intervalBetweenRuns = 1m)
```

Python integration for alerts using Azure Logic Apps:

```python
# Alerts in Fabric Real-Time Intelligence use Reflex (Data Activator)
# For custom alerting, use Logic Apps or Azure Functions

from azure.identity import DefaultAzureCredential
import requests
import json

# Option 1: Send alerts to Logic App
def send_alert_to_logic_app(alert_data: dict, logic_app_url: str):
    """Send alert to Azure Logic App for processing."""
    response = requests.post(
        logic_app_url,
        headers={"Content-Type": "application/json"},
        json=alert_data
    )
    return response.status_code == 200

# Option 2: Send to Teams webhook
def send_teams_alert(device_id: str, current_temp: float, teams_webhook_url: str):
    """Send alert to Microsoft Teams channel."""
    message = {
        "@type": "MessageCard",
        "summary": "Temperature Anomaly",
        "sections": [{
            "activityTitle": "Temperature Anomaly Detected",
            "facts": [
                {"name": "Device", "value": device_id},
                {"name": "Temperature", "value": f"{current_temp:.1f}C"}
            ],
            "markdown": True
        }]
    }
    requests.post(teams_webhook_url, json=message)

# Option 3: Use Fabric Reflex (Data Activator)
# In Fabric portal:
# 1. Create a Reflex item
# 2. Connect to your KQL database or eventstream
# 3. Define trigger conditions (e.g., deviation > 5)
# 4. Configure actions (email, Teams, Power Automate flow)

# Query KQL for anomalies and trigger alerts
credential = DefaultAzureCredential()
# Execute KQL query and process results for alerting
```

## Real-Time Dashboards

Create live dashboards using Real-Time Dashboards in Fabric:

```python
# Real-Time Dashboards are created in the Fabric portal
# They connect directly to KQL databases for live data

# Step 1: Create Real-Time Dashboard via REST API
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

workspace_id = "your-workspace-id"
base_url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}"

dashboard_payload = {
    "displayName": "Live Sales Dashboard",
    "type": "RTDashboard",
    "description": "Real-time sales metrics dashboard"
}

response = requests.post(f"{base_url}/items", headers=headers, json=dashboard_payload)
dashboard = response.json()

# Step 2: Configure tiles in the Fabric portal with KQL queries:
# Example KQL for dashboard tiles:

kql_queries = {
    "total_sales_card": """
        all_transactions
        | where timestamp > ago(1h)
        | summarize total_sales = sum(total_amount)
    """,
    "sales_by_region_chart": """
        all_transactions
        | where timestamp > ago(1h)
        | summarize total_sales = sum(total_amount), tx_count = count()
            by bin(timestamp, 1m), region
        | render timechart
    """,
    "transaction_count": """
        all_transactions
        | where timestamp > ago(1h)
        | count
    """
}

# Note: Real-Time Dashboards auto-refresh every 30 seconds by default
# Configure in portal: Dashboard settings > Auto refresh interval

# Alternative: Use Power BI with DirectQuery to KQL Database
# for more customization options
```

## Performance Optimization

```kusto
// Optimize table for time-series queries
.alter table raw_telemetry policy streamingingestion enable

// Set appropriate retention
.alter table raw_telemetry policy retention softdelete = 30d

// Create materialized view for common aggregations
.create materialized-view HourlyMetrics on table raw_telemetry {
    raw_telemetry
    | summarize
        avg_temp = avg(temperature),
        max_temp = max(temperature),
        min_temp = min(temperature),
        count = count()
        by device_id, bin(timestamp, 1h)
}

// Use materialized view in queries (faster)
HourlyMetrics
| where timestamp > ago(7d)
| summarize daily_avg = avg(avg_temp) by device_id, bin(timestamp, 1d)
```

Real-time analytics in Fabric provides a powerful, integrated solution for streaming data. Start with simple patterns and evolve to more complex scenarios as your needs grow.
