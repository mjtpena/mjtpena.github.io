---
title: "Eventstreams in Fabric: Streaming Data Ingestion"
author: Michael John Peña
draft: false
date: 2023-07-21
tags:
  - Microsoft Fabric
  - Eventstreams
  - Streaming
  - Real-Time
---

## What are Eventstreams?

```python
# Eventstreams provide:
eventstream_features = {
    "sources": [
        "Azure Event Hubs",
        "Azure IoT Hub",
        "Custom App (endpoint)",
        "Sample data (testing)"
    ],
    "transformations": [
        "Filter",
        "Aggregate",
        "Group by",
        "Union"
    ],
    "destinations": [
        "KQL Database",
        "Lakehouse",
        "Custom App"
    ]
}

# Use cases:
use_cases = [
    "IoT sensor data",
    "Application logs",
    "Clickstream data",
    "Financial transactions",
    "Social media feeds"
]
```

## Creating an Eventstream

```
1. In your workspace, click "+ New" > "Eventstream"
2. Name your eventstream (e.g., "sensor_data_stream")
3. Click "Create"
4. You enter the Eventstream editor
```

## Configuring Sources

### Event Hubs Source

```python
# Event Hubs configuration
event_hubs_config = {
    "connection_string": "Endpoint=sb://namespace.servicebus.windows.net/...",
    "event_hub_name": "telemetry-hub",
    "consumer_group": "$Default",
    "data_format": "JSON",
    "compression": "None"  # or Gzip
}

# Create Event Hub source:
# 1. In Eventstream, click "+ Add source"
# 2. Select "Event Hub"
# 3. Create new connection or use existing
# 4. Configure settings
# 5. Click "Add"
```

### Custom App Source

```python
# Custom App provides an endpoint for direct streaming
# After adding Custom App source:

endpoint_info = {
    "endpoint_url": "https://eventstream-endpoint.fabric.microsoft.com/...",
    "event_hub_name": "auto-generated",
    "sas_key": "provided in connection string",
    "sample_code": "See below"
}

# Python code to send events
import asyncio
from azure.eventhub.aio import EventHubProducerClient
from azure.eventhub import EventData
import json

async def send_events():
    connection_string = "Endpoint=sb://..."  # From Custom App
    producer = EventHubProducerClient.from_connection_string(connection_string)

    async with producer:
        batch = await producer.create_batch()

        event_data = {
            "device_id": "sensor001",
            "temperature": 25.5,
            "humidity": 60.0,
            "timestamp": "2023-07-21T10:30:00Z"
        }

        batch.add(EventData(json.dumps(event_data)))
        await producer.send_batch(batch)

asyncio.run(send_events())
```

### Sample Data Source (for Testing)

```python
# Built-in sample data for testing
sample_data_options = {
    "bicycles": "Rental bicycle events",
    "stock": "Stock market quotes",
    "refinery": "Industrial sensor data"
}

# 1. Click "+ Add source"
# 2. Select "Sample data"
# 3. Choose a sample dataset
# 4. Configure refresh rate
```

## Transformations

### Filter Transformation

```
# Add filter in Eventstream:
# 1. Click "+ Add transformation" > "Filter"
# 2. Connect to source
# 3. Define filter condition

# Example: Filter for high temperature
# Field: temperature
# Operator: Greater than
# Value: 30
```

### Aggregate Transformation

```
# Rolling aggregations:
# 1. Add "Aggregate" transformation
# 2. Configure:

aggregate_config = {
    "group_by": ["device_id"],
    "window_type": "Tumbling",  # or Sliding, Session
    "window_duration": "5 minutes",
    "aggregations": [
        {"field": "temperature", "function": "Avg", "alias": "avg_temp"},
        {"field": "temperature", "function": "Max", "alias": "max_temp"},
        {"field": "*", "function": "Count", "alias": "reading_count"}
    ]
}
```

### Group By Transformation

```
# Grouping without aggregation:
# Useful for partitioning stream

group_by_config = {
    "group_by_fields": ["device_type", "location"],
    "output": "Grouped events for downstream processing"
}
```

## Configuring Destinations

### KQL Database Destination

```python
# Stream to KQL for real-time analytics
kql_destination = {
    "database": "telemetry_db",
    "table": "sensor_readings",
    "ingestion_mapping": "json_mapping",
    "format": "JSON"
}

# Steps:
# 1. Add destination > KQL Database
# 2. Select workspace and database
# 3. Create or select table
# 4. Configure column mapping
# 5. Connect transformation output to destination
```

### Lakehouse Destination

```python
# Stream to Lakehouse for batch processing
lakehouse_destination = {
    "lakehouse": "analytics_lakehouse",
    "table": "streaming_sensor_data",
    "format": "Delta",
    "write_mode": "Append"
}

# Good for:
# - Historical analysis
# - Combining with batch data
# - Power BI reporting
```

## Complete Eventstream Example

```python
# End-to-end streaming pipeline:

pipeline = {
    "source": {
        "type": "Event Hub",
        "name": "iot_events",
        "format": "JSON"
    },
    "transformations": [
        {
            "type": "Filter",
            "condition": "event_type == 'sensor_reading'"
        },
        {
            "type": "Aggregate",
            "window": "5 minutes tumbling",
            "group_by": "device_id",
            "aggregations": ["avg(value)", "max(value)", "count()"]
        }
    ],
    "destinations": [
        {
            "type": "KQL Database",
            "purpose": "Real-time dashboards"
        },
        {
            "type": "Lakehouse",
            "purpose": "Historical analysis"
        }
    ]
}
```

## Monitoring Eventstreams

```python
# Monitor stream health in Eventstream editor:
monitoring_metrics = {
    "events_in": "Events received from source",
    "events_out": "Events sent to destination",
    "latency": "Processing delay",
    "errors": "Failed events",
    "backlog": "Events pending processing"
}

# Set up alerts:
# 1. View metrics in Eventstream
# 2. Configure thresholds
# 3. Set up notifications via Power Automate
```

## Error Handling

```python
# Handle streaming errors:

error_handling = {
    "dead_letter": {
        "description": "Failed events stored separately",
        "configuration": "Enable in destination settings"
    },
    "retry_policy": {
        "max_retries": 3,
        "retry_interval": "30 seconds"
    },
    "schema_errors": {
        "handling": "Skip or fail",
        "logging": "Errors logged to monitor"
    }
}

# Best practices:
# 1. Always configure dead-letter queue
# 2. Monitor error rates
# 3. Handle schema evolution gracefully
# 4. Test with sample data first
```

## Best Practices

```python
best_practices = {
    "schema": {
        "tip": "Define schema explicitly",
        "reason": "Prevents runtime errors"
    },
    "partitioning": {
        "tip": "Partition by high-cardinality key",
        "reason": "Better parallel processing"
    },
    "windowing": {
        "tip": "Choose appropriate window size",
        "reason": "Balance latency vs accuracy"
    },
    "checkpointing": {
        "tip": "Enable checkpointing",
        "reason": "Enables recovery from failures"
    },
    "testing": {
        "tip": "Test with sample data first",
        "reason": "Validate transformations before production"
    }
}
```

Tomorrow we'll explore Real-Time Dashboards for visualizing streaming data.

## Resources

- [Eventstream Documentation](https://learn.microsoft.com/en-us/fabric/real-time-analytics/event-streams/overview)
- [Event Hub Integration](https://learn.microsoft.com/en-us/fabric/real-time-analytics/event-streams/add-source-azure-event-hubs)
- [Streaming Best Practices](https://learn.microsoft.com/en-us/fabric/real-time-analytics/event-streams/best-practices)
