---
title: "Cosmos DB Mirroring to Fabric: Analytical Queries at Scale"
author: Michael John Peña
draft: false
date: 2024-08-04
tags:
  - Microsoft Fabric
  - Cosmos DB
  - Mirroring
  - NoSQL
  - Analytics

---

I wrote "Cosmos DB Mirroring to Fabric: Analytical Queries at Scale" to share practical, production-minded guidance on this topic.

## How Cosmos DB Mirroring Works

Unlike SQL mirroring which uses change tracking, Cosmos DB mirroring leverages the built-in analytical store:

```
Cosmos DB Container (Transactional Store)
           │
           │ Auto-sync (TTL-based)
           ▼
  Analytical Store (Column-oriented)
           │
           │ Fabric Mirroring
           ▼
     OneLake (Delta Lake)
           │
           ├── Lakehouse queries
           ├── Spark analytics
           └── Power BI Direct Lake
```

## Prerequisites

```python
prerequisites = {
    "cosmos_db": {
        "api": "SQL API (NoSQL)",  # Required
        "analytical_store": True,   # Must be enabled
        "synapse_link": True,       # Required for mirroring
        "tier": "Any (provisioned or serverless)"
    },
    "fabric": {
        "capacity": "F2 or higher",
        "workspace": "Contributor access"
    }
}
```

## Step 1: Enable Analytical Store

### Via Azure Portal

1. Go to your Cosmos DB account
2. Navigate to Features > Azure Synapse Link
3. Enable Synapse Link (account-level setting)
4. Enable analytical store per container

### Via Azure CLI

```bash
# Enable Synapse Link on account
az cosmosdb update \
  --name mycosmosaccount \
  --resource-group myresourcegroup \
  --enable-analytical-storage true

# Enable analytical store on container
az cosmosdb sql container update \
  --account-name mycosmosaccount \
  --resource-group myresourcegroup \
  --database-name mydb \
  --name mycontainer \
  --analytical-storage-ttl -1  # -1 means infinite retention
```

### Via Python SDK

```python
from azure.cosmos import CosmosClient, PartitionKey
from azure.identity import DefaultAzureCredential

def enable_analytical_store(
    account_endpoint: str,
    database_name: str,
    container_name: str
):
    """Enable analytical store on existing container."""

    credential = DefaultAzureCredential()
    client = CosmosClient(account_endpoint, credential)

    database = client.get_database_client(database_name)

    # For new containers
    container = database.create_container_if_not_exists(
        id=container_name,
        partition_key=PartitionKey(path="/category"),
        analytical_storage_ttl=-1  # Enable with infinite retention
    )

    print(f"Analytical store enabled for {container_name}")
    return container

# For existing containers, use ARM or portal
# SDK doesn't support enabling on existing containers
```

## Step 2: Create Fabric Mirror

```python
from azure.identity import DefaultAzureCredential
import requests
import base64
import json

class CosmosDbMirrorManager:
    def __init__(self, workspace_id: str):
        self.workspace_id = workspace_id
        self.base_url = "https://api.fabric.microsoft.com/v1"
        self.credential = DefaultAzureCredential()

    def _get_token(self):
        return self.credential.get_token("https://api.fabric.microsoft.com/.default").token

    def create_cosmos_mirror(
        self,
        display_name: str,
        cosmos_endpoint: str,
        database_name: str,
        containers: list[str]
    ) -> dict:
        """Create Cosmos DB mirror in Fabric."""

        definition = {
            "source": {
                "type": "CosmosDb",
                "endpoint": cosmos_endpoint,
                "database": database_name,
                "authentication": {
                    "type": "ManagedIdentity"
                }
            },
            "containers": [
                {"name": container} for container in containers
            ],
            "settings": {
                "syncMode": "Continuous"
            }
        }

        payload = {
            "displayName": display_name,
            "definition": {
                "parts": [
                    {
                        "path": "definition.json",
                        "payloadType": "InlineBase64",
                        "payload": base64.b64encode(
                            json.dumps(definition).encode()
                        ).decode()
                    }
                ]
            }
        }

        response = requests.post(
            f"{self.base_url}/workspaces/{self.workspace_id}/mirroredDatabases",
            headers={
                "Authorization": f"Bearer {self._get_token()}",
                "Content-Type": "application/json"
            },
            json=payload
        )

        response.raise_for_status()
        return response.json()

# Usage
manager = CosmosDbMirrorManager("your-workspace-id")

mirror = manager.create_cosmos_mirror(
    display_name="IoT-Data-Mirror",
    cosmos_endpoint="https://myaccount.documents.azure.com",
    database_name="IoTDatabase",
    containers=["telemetry", "devices", "alerts"]
)
```

## Understanding the Data Flow

### Latency Characteristics

```python
latency_breakdown = {
    "transactional_to_analytical": "2-5 minutes",  # Cosmos DB internal
    "analytical_to_onelake": "Minutes",             # Fabric mirroring
    "total_end_to_end": "5-10 minutes typical"
}

# For IoT scenarios, this is often acceptable
# For real-time needs, consider Event Hubs + Eventstream
```

### Schema Handling

Cosmos DB is schema-less, but mirroring infers schema:

```python
# Document in Cosmos DB
document = {
    "id": "sensor-001",
    "deviceId": "device-123",
    "timestamp": "2024-08-04T10:30:00Z",
    "readings": {
        "temperature": 23.5,
        "humidity": 65.2
    },
    "tags": ["indoor", "office"]
}

# In Fabric Lakehouse, this becomes a flattened schema:
# - id: STRING
# - deviceId: STRING
# - timestamp: TIMESTAMP
# - readings_temperature: DOUBLE
# - readings_humidity: DOUBLE
# - tags: ARRAY<STRING>
```

## Querying Mirrored Cosmos Data

### Via SQL Endpoint

```sql
-- Query flattened Cosmos data
SELECT
    deviceId,
    DATE_TRUNC('hour', timestamp) as Hour,
    AVG(readings_temperature) as AvgTemperature,
    AVG(readings_humidity) as AvgHumidity,
    COUNT(*) as ReadingCount
FROM dbo.telemetry
WHERE timestamp >= DATEADD(day, -7, GETDATE())
GROUP BY deviceId, DATE_TRUNC('hour', timestamp)
ORDER BY Hour DESC;
```

### Via Spark

```python
# Spark notebook
from pyspark.sql.functions import *

# Read mirrored telemetry
telemetry = spark.read.format("delta").table("CosmosDB_Mirror.telemetry")

# Handle nested structures
analysis = telemetry.select(
    col("deviceId"),
    col("timestamp"),
    col("readings.temperature").alias("temperature"),
    col("readings.humidity").alias("humidity"),
    explode(col("tags")).alias("tag")
)

# Aggregate by device and hour
hourly_stats = analysis.groupBy(
    col("deviceId"),
    date_trunc("hour", col("timestamp")).alias("hour")
).agg(
    avg("temperature").alias("avg_temp"),
    avg("humidity").alias("avg_humidity"),
    count("*").alias("readings")
)

display(hourly_stats.orderBy(desc("hour")))
```

### Handling Schema Evolution

```python
# Cosmos DB documents can have evolving schemas
# Fabric handles this with schema inference

# Best practice: Define a canonical schema view
spark.sql("""
CREATE OR REPLACE VIEW canonical_telemetry AS
SELECT
    id,
    deviceId,
    CAST(timestamp AS TIMESTAMP) as timestamp,
    COALESCE(readings.temperature, readings.temp, NULL) as temperature,
    COALESCE(readings.humidity, readings.humid, NULL) as humidity,
    COALESCE(tags, ARRAY()) as tags
FROM CosmosDB_Mirror.telemetry
""")
```

## Performance Optimization

### Partitioning Alignment

```python
# Cosmos DB partition key should align with common query patterns
# This carries through to the mirrored data

# Example: Partition by deviceId
# Good for queries like:
# - Get all readings for a specific device
# - Aggregate by device

# Less optimal for:
# - Time-range queries across all devices
# - Consider materialized views for these patterns
```

### Materialized Views for Common Patterns

```python
# Create materialized aggregates for common queries
from delta.tables import DeltaTable

def create_hourly_aggregates():
    """Create hourly aggregate table for fast dashboard queries."""

    hourly = spark.sql("""
        SELECT
            deviceId,
            date_trunc('hour', timestamp) as hour,
            avg(readings.temperature) as avg_temp,
            min(readings.temperature) as min_temp,
            max(readings.temperature) as max_temp,
            avg(readings.humidity) as avg_humidity,
            count(*) as sample_count
        FROM CosmosDB_Mirror.telemetry
        WHERE timestamp >= current_date() - INTERVAL 30 DAYS
        GROUP BY deviceId, date_trunc('hour', timestamp)
    """)

    hourly.write.format("delta").mode("overwrite").saveAsTable("analytics.hourly_device_metrics")

# Schedule this to run periodically
```

## Monitoring

```python
def monitor_cosmos_mirror(manager, mirror_id: str):
    """Monitor Cosmos DB mirror health."""

    status = manager.get_mirror_status(mirror_id)

    print(f"Mirror Status: {status['status']}")

    for container in status.get('containers', []):
        print(f"\n{container['name']}:")
        print(f"  Documents synced: {container.get('documentCount', 0):,}")
        print(f"  Last sync: {container.get('lastSyncTime', 'N/A')}")
        print(f"  Estimated lag: {container.get('estimatedLagMinutes', 0)} minutes")

# Also check Cosmos DB analytical store metrics
def check_analytical_store_health(cosmos_client, database_name: str):
    """Check analytical store health via Azure Monitor."""
    # Query Azure Monitor metrics for:
    # - AnalyticalStorageSize
    # - AnalyticalTTLExpirations
    # - AnalyticalMigrationProgress
    pass
```

## Best Practices

1. **Enable analytical store early**: Can't be added to existing data retroactively
2. **Use appropriate TTL**: -1 for full history, or set based on retention needs
3. **Align partition keys**: Consider query patterns when designing
4. **Create views for schema stability**: Handle schema evolution gracefully
5. **Monitor sync lag**: Set up alerts for delays

## When to Use Cosmos DB Mirroring

**Good fit:**
- IoT telemetry analytics
- User behavior analysis
- Product catalog analytics
- Historical trend analysis

**Consider alternatives:**
- Real-time dashboards (< 1 minute): Use Change Feed + Event Hubs
- Heavy aggregations: Consider pre-aggregating in Cosmos DB
- Cross-region analytics: May need additional architecture

## Conclusion

Cosmos DB mirroring brings your NoSQL data into the Fabric analytics ecosystem without ETL complexity. The integration through analytical store and Synapse Link provides a well-tested path to analytical workloads.

Enable analytical store on your containers, create the mirror, and start querying your document data with SQL and Spark.

