---
title: "Real-Time Sync Patterns in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-08-07
tags:
  - Microsoft Fabric
  - Real-Time
  - Event Streaming
  - CDC
  - Architecture
---

## The Real-Time Spectrum

```
Latency Requirement          Pattern                    Fabric Feature
─────────────────────────────────────────────────────────────────────────
  Seconds          ──►   Event Streaming      ──►   Eventstream + KQL DB
                                                    Real-Time Intelligence

  Minutes          ──►   CDC/Mirroring        ──►   Database Mirroring
                                                    Data Factory CDC

  Hours            ──►   Batch ETL            ──►   Data Factory Pipelines
                                                    Dataflows Gen2
```

## Pattern 1: True Streaming with Eventstream

For sub-second latency:

```python
# Eventstream configuration for IoT data
# Use Fabric REST APIs for Eventstream management
import requests
from azure.identity import DefaultAzureCredential

class StreamingPipeline:
    def __init__(self, workspace_id: str):
        self.workspace_id = workspace_id
        self.credential = DefaultAzureCredential()
        self.base_url = "https://api.fabric.microsoft.com/v1"

    def _get_headers(self):
        token = self.credential.get_token("https://api.fabric.microsoft.com/.default")
        return {"Authorization": f"Bearer {token.token}", "Content-Type": "application/json"}

    def create_iot_stream(self):
        """Create streaming pipeline for IoT data via REST API."""

        # Create Eventstream via Fabric REST API
        eventstream_payload = {
            "displayName": "IoT-Telemetry-Stream",
            "description": "Streaming pipeline for IoT telemetry"
        }

        response = requests.post(
            f"{self.base_url}/workspaces/{self.workspace_id}/eventstreams",
            headers=self._get_headers(),
            json=eventstream_payload
        )

        eventstream_id = response.json().get("id")

        # Configure source and destinations in Fabric portal
        # or use additional REST API calls for sources/destinations
        # Note: Full programmatic Eventstream configuration may require
        # the Fabric portal or ARM templates for complex scenarios

        return {
            "eventstream_id": eventstream_id,
            "status": "created",
            "next_steps": [
                "Configure Event Hubs source in portal",
                "Add KQL Database destination",
                "Add Lakehouse destination"
            ]
        }

# The data flow:
# Event Hubs → Eventstream → KQL DB (real-time queries)
#                          → Lakehouse (historical analysis)
```

### Querying Real-Time Data

```kql
// KQL query for real-time dashboard
Telemetry
| where timestamp > ago(5m)
| summarize
    avg_temp = avg(temperature),
    max_temp = max(temperature),
    reading_count = count()
    by deviceId, bin(timestamp, 1m)
| order by timestamp desc
```

## Pattern 2: CDC with Data Factory

For minute-level latency with relational sources:

```python
# Data Factory CDC pipeline
class CDCPipeline:
    def __init__(self, workspace_id: str):
        self.workspace_id = workspace_id

    def create_cdc_pipeline(
        self,
        source_connection: str,
        source_tables: list[str],
        target_lakehouse: str
    ):
        """Create CDC-based near real-time sync."""

        pipeline = {
            "name": "CDC-Sales-Pipeline",
            "properties": {
                "activities": [
                    {
                        "name": "CDC_Capture",
                        "type": "Copy",
                        "inputs": [{
                            "referenceName": "SqlCDCSource",
                            "type": "DatasetReference",
                            "parameters": {
                                "tableName": {"type": "Expression", "value": "@item()"}
                            }
                        }],
                        "outputs": [{
                            "referenceName": "LakehouseDelta",
                            "type": "DatasetReference",
                            "parameters": {
                                "tableName": {"type": "Expression", "value": "@item()"}
                            }
                        }],
                        "typeProperties": {
                            "source": {
                                "type": "SqlSource",
                                "sqlReaderQuery": {
                                    "type": "Expression",
                                    "value": "@concat('SELECT * FROM cdc.fn_cdc_get_all_changes_dbo_', item(), '(@{pipeline().parameters.LastLSN}, @{activity(''GetCurrentLSN'').output.firstRow.CurrentLSN}, ''all'')')"
                                }
                            },
                            "sink": {
                                "type": "DeltaSink",
                                "writeBehavior": "merge",
                                "mergeSchema": True
                            },
                            "enableStaging": False
                        }
                    }
                ],
                "parameters": {
                    "LastLSN": {"type": "string"},
                    "Tables": {"type": "array", "defaultValue": source_tables}
                }
            }
        }

        return pipeline
```

### Setting Up CDC in SQL Server

```sql
-- Enable CDC on database
EXEC sys.sp_cdc_enable_db;

-- Enable CDC on tables
EXEC sys.sp_cdc_enable_table
    @source_schema = N'dbo',
    @source_name = N'Orders',
    @role_name = NULL,
    @supports_net_changes = 1;

EXEC sys.sp_cdc_enable_table
    @source_schema = N'dbo',
    @source_name = N'Customers',
    @role_name = NULL,
    @supports_net_changes = 1;

-- Verify CDC is enabled
SELECT name, is_cdc_enabled
FROM sys.databases
WHERE name = DB_NAME();

SELECT *
FROM sys.tables
WHERE is_tracked_by_cdc = 1;
```

## Pattern 3: Hybrid Approach

Combine streaming and batch for different data types:

```python
class HybridSyncArchitecture:
    """
    Architecture:
    - Streaming: Event-driven data (clicks, IoT, transactions)
    - Mirroring: Slowly changing dimensions (customers, products)
    - Batch: Large historical loads, complex transformations
    """

    def __init__(self, workspace_id: str):
        self.workspace_id = workspace_id

    def configure_streaming_tier(self):
        """Configure real-time streaming for hot data."""
        return {
            "name": "Streaming_Tier",
            "sources": ["Event Hubs", "Kafka"],
            "processing": "Eventstream",
            "destinations": ["KQL Database", "Lakehouse (append)"],
            "latency": "seconds",
            "use_cases": ["Real-time dashboards", "Alerting", "Live metrics"]
        }

    def configure_mirror_tier(self):
        """Configure mirroring for warm data."""
        return {
            "name": "Mirror_Tier",
            "sources": ["Azure SQL", "Cosmos DB"],
            "processing": "Database Mirroring",
            "destinations": ["Mirrored Database (OneLake)"],
            "latency": "minutes",
            "use_cases": ["Operational reporting", "Customer 360", "Inventory"]
        }

    def configure_batch_tier(self):
        """Configure batch for cold data."""
        return {
            "name": "Batch_Tier",
            "sources": ["Data Lake", "External APIs", "Files"],
            "processing": "Data Factory Pipelines",
            "destinations": ["Lakehouse"],
            "latency": "hours",
            "use_cases": ["Historical analysis", "ML training", "Compliance"]
        }

    def get_recommended_tier(self, data_characteristics: dict) -> str:
        """Recommend sync tier based on data characteristics."""

        latency_needed = data_characteristics.get("latency_seconds", 3600)
        volume_per_second = data_characteristics.get("events_per_second", 0)
        change_frequency = data_characteristics.get("change_frequency", "low")

        if latency_needed < 60 or volume_per_second > 100:
            return "Streaming_Tier"
        elif change_frequency in ["high", "medium"] and latency_needed < 600:
            return "Mirror_Tier"
        else:
            return "Batch_Tier"
```

## Pattern 4: Fan-Out Architecture

Distribute data to multiple destinations:

```python
class FanOutSync:
    """
    Single source, multiple destinations with different latency requirements.
    """

    def create_fan_out_pipeline(self):
        """
        Source: Order Events from Event Hubs

        Destinations:
        1. KQL DB - Real-time fraud detection (seconds)
        2. Lakehouse - Analytics (minutes)
        3. Cosmos DB - Order tracking API (seconds)
        4. Power BI - Dashboard refresh (minutes)
        """

        pipeline_config = {
            "source": {
                "type": "EventHubs",
                "topic": "orders"
            },
            "eventstream": {
                "name": "Orders-FanOut",
                "transformations": [
                    {"name": "parse", "type": "ParseJson"},
                    {"name": "enrich", "type": "Lookup", "reference": "Customers"}
                ]
            },
            "destinations": [
                {
                    "name": "fraud_detection",
                    "type": "KQLDatabase",
                    "table": "OrdersRealtime",
                    "purpose": "Real-time fraud rules"
                },
                {
                    "name": "analytics",
                    "type": "Lakehouse",
                    "table": "orders",
                    "purpose": "Historical analysis",
                    "batch_interval": "1 minute"
                },
                {
                    "name": "api_store",
                    "type": "CosmosDB",
                    "container": "orders",
                    "purpose": "Order tracking API"
                },
                {
                    "name": "reporting",
                    "type": "DirectLake",
                    "semantic_model": "Sales",
                    "purpose": "Executive dashboard"
                }
            ]
        }

        return pipeline_config
```

## Monitoring Real-Time Pipelines

```python
class RealtimeMonitor:
    def __init__(self):
        self.metrics = {
            "throughput": [],
            "latency": [],
            "errors": []
        }

    def monitor_eventstream(self, eventstream_id: str):
        """Monitor Eventstream health."""

        # Get metrics from Fabric API
        metrics = self.get_eventstream_metrics(eventstream_id)

        alerts = []

        # Check throughput
        if metrics["events_per_second"] < metrics["expected_eps"] * 0.5:
            alerts.append({
                "severity": "warning",
                "message": f"Throughput below 50% of expected",
                "current": metrics["events_per_second"],
                "expected": metrics["expected_eps"]
            })

        # Check latency
        if metrics["processing_latency_ms"] > 5000:
            alerts.append({
                "severity": "critical",
                "message": f"Processing latency > 5 seconds",
                "current_ms": metrics["processing_latency_ms"]
            })

        # Check error rate
        error_rate = metrics["errors"] / max(metrics["events_processed"], 1)
        if error_rate > 0.01:
            alerts.append({
                "severity": "critical",
                "message": f"Error rate > 1%",
                "rate": error_rate
            })

        return alerts

    def get_eventstream_metrics(self, eventstream_id: str) -> dict:
        # Placeholder for actual API call
        return {
            "events_per_second": 1000,
            "expected_eps": 1200,
            "processing_latency_ms": 250,
            "events_processed": 100000,
            "errors": 5
        }
```

## Choosing the Right Pattern

| Requirement | Pattern | Fabric Feature |
|-------------|---------|----------------|
| < 1 second latency | Streaming | Eventstream + KQL DB |
| 1-5 minutes | CDC/Mirroring | Database Mirroring |
| Change tracking | CDC | Data Factory CDC |
| Schema evolution | Mirroring | Built-in handling |
| High volume events | Streaming | Eventstream |
| Complex transforms | Batch/Streaming | Dataflows/Spark |

## Conclusion

Real-time sync in Fabric isn't one-size-fits-all. Choose streaming for true real-time needs, mirroring for operational data, and batch for historical loads.

The key is understanding your latency requirements and matching them to the appropriate pattern. Often, a hybrid approach serves organizations best.
