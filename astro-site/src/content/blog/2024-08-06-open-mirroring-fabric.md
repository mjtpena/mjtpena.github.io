---
title: "Open Mirroring in Fabric: Build Custom Data Sources"
author: Michael John Peña
draft: false
date: 2024-08-06
tags:
  - Microsoft Fabric
  - Mirroring
  - Open Mirroring
  - Custom Integration
  - Delta Lake

---

I wrote "Open Mirroring in Fabric: Build Custom Data Sources" to share practical, production-minded guidance on this topic.

## What is Open Mirroring?

Open Mirroring provides a standardized way to:
- Write Delta Lake tables directly to a mirrored database location
- Maintain the mirrored database experience (SQL endpoint, Direct Lake)
- Support custom or unsupported data sources

```
Custom Data Source
       │
       │ Your Code
       ▼
 Delta Lake Writer
       │
       │ Direct Write
       ▼
OneLake (Mirrored DB location)
       │
       ├── SQL Endpoint (automatic)
       └── Direct Lake (automatic)
```

## When to Use Open Mirroring

**Use Open Mirroring for:**
- Databases without native mirroring support
- Custom SaaS applications
- Legacy systems
- Complex transformation requirements
- Multi-source consolidation

**Use Native Mirroring for:**
- Supported sources (Azure SQL, Cosmos DB)
- Simpler setup and maintenance
- Automatic schema handling

## Setting Up Open Mirroring

### Step 1: Create Mirrored Database Structure

```python
import requests
from azure.identity import DefaultAzureCredential

class OpenMirrorManager:
    def __init__(self, workspace_id: str):
        self.workspace_id = workspace_id
        self.base_url = "https://api.fabric.microsoft.com/v1"

    def _get_headers(self):
        credential = DefaultAzureCredential()
        token = credential.get_token("https://api.fabric.microsoft.com/.default")
        return {
            "Authorization": f"Bearer {token.token}",
            "Content-Type": "application/json"
        }

    def create_open_mirror(
        self,
        display_name: str,
        description: str = ""
    ) -> dict:
        """Create an open mirrored database."""

        payload = {
            "displayName": display_name,
            "description": description,
            "type": "MirroredDatabase",
            "definition": {
                "parts": [{
                    "path": "definition.json",
                    "payloadType": "InlineBase64",
                    "payload": self._encode({
                        "sourceType": "Open",
                        "settings": {
                            "allowDirectWrite": True
                        }
                    })
                }]
            }
        }

        response = requests.post(
            f"{self.base_url}/workspaces/{self.workspace_id}/items",
            headers=self._get_headers(),
            json=payload
        )

        response.raise_for_status()
        return response.json()

    def get_mirror_location(self, mirror_id: str) -> str:
        """Get the OneLake path for writing data."""

        response = requests.get(
            f"{self.base_url}/workspaces/{self.workspace_id}/mirroredDatabases/{mirror_id}",
            headers=self._get_headers()
        )

        data = response.json()
        # Returns path like: abfss://workspace@onelake.dfs.fabric.microsoft.com/mirrordb.MirroredDatabase/Tables
        return data.get("oneLakePath")

    def _encode(self, data: dict) -> str:
        import base64
        import json
        return base64.b64encode(json.dumps(data).encode()).decode()

# Usage
manager = OpenMirrorManager("workspace-id")
mirror = manager.create_open_mirror(
    display_name="Custom-Source-Mirror",
    description="Open mirror for custom data source"
)

location = manager.get_mirror_location(mirror["id"])
print(f"Write Delta tables to: {location}")
```

### Step 2: Write Delta Tables

```python
from pyspark.sql import SparkSession
from delta import DeltaTable
import os

class OpenMirrorWriter:
    def __init__(self, mirror_location: str):
        self.base_path = mirror_location
        self.spark = SparkSession.builder \
            .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension") \
            .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog") \
            .getOrCreate()

    def write_table(
        self,
        df,
        table_name: str,
        mode: str = "overwrite",
        partition_by: list[str] = None
    ):
        """Write DataFrame as Delta table to mirror location."""

        table_path = f"{self.base_path}/{table_name}"

        writer = df.write.format("delta").mode(mode)

        if partition_by:
            writer = writer.partitionBy(*partition_by)

        writer.save(table_path)

        print(f"Written {df.count()} rows to {table_name}")

    def merge_table(
        self,
        df,
        table_name: str,
        merge_keys: list[str],
        update_columns: list[str] = None
    ):
        """Merge (upsert) data into existing Delta table."""

        table_path = f"{self.base_path}/{table_name}"

        # Check if table exists
        if DeltaTable.isDeltaTable(self.spark, table_path):
            delta_table = DeltaTable.forPath(self.spark, table_path)

            # Build merge condition
            merge_condition = " AND ".join(
                f"target.{key} = source.{key}" for key in merge_keys
            )

            # Build update set
            if update_columns:
                update_set = {col: f"source.{col}" for col in update_columns}
            else:
                # Update all columns except keys
                all_cols = [c for c in df.columns if c not in merge_keys]
                update_set = {col: f"source.{col}" for col in all_cols}

            # Execute merge
            delta_table.alias("target").merge(
                df.alias("source"),
                merge_condition
            ).whenMatchedUpdate(
                set=update_set
            ).whenNotMatchedInsertAll().execute()

            print(f"Merged data into {table_name}")

        else:
            # Table doesn't exist, create it
            self.write_table(df, table_name)

    def delete_records(
        self,
        table_name: str,
        condition: str
    ):
        """Delete records from Delta table."""

        table_path = f"{self.base_path}/{table_name}"
        delta_table = DeltaTable.forPath(self.spark, table_path)

        delta_table.delete(condition)
        print(f"Deleted records where {condition}")
```

### Step 3: Implement Custom Source Sync

```python
import pyodbc
from datetime import datetime, timedelta

class CustomSourceMirror:
    def __init__(
        self,
        source_connection_string: str,
        mirror_writer: OpenMirrorWriter
    ):
        self.source_conn_str = source_connection_string
        self.writer = mirror_writer
        self.sync_state = {}

    def full_sync_table(self, table_name: str, query: str = None):
        """Full sync a table from source."""

        if query is None:
            query = f"SELECT * FROM {table_name}"

        # Read from source
        conn = pyodbc.connect(self.source_conn_str)
        df = self.writer.spark.read.format("jdbc").options(
            url=self.source_conn_str,
            query=query
        ).load()

        # Write to mirror
        self.writer.write_table(df, table_name, mode="overwrite")

        self.sync_state[table_name] = {
            "last_full_sync": datetime.utcnow().isoformat(),
            "row_count": df.count()
        }

    def incremental_sync_table(
        self,
        table_name: str,
        timestamp_column: str,
        primary_keys: list[str],
        since: datetime = None
    ):
        """Incremental sync based on timestamp."""

        if since is None:
            # Use last sync time or default to 24 hours ago
            since = datetime.utcnow() - timedelta(hours=24)

        query = f"""
        SELECT * FROM {table_name}
        WHERE {timestamp_column} >= '{since.isoformat()}'
        """

        # Read changes from source
        df = self.writer.spark.read.format("jdbc").options(
            url=self.source_conn_str,
            query=query
        ).load()

        if df.count() > 0:
            # Merge changes
            self.writer.merge_table(df, table_name, primary_keys)

        self.sync_state[table_name] = {
            "last_incremental_sync": datetime.utcnow().isoformat(),
            "rows_synced": df.count()
        }

    def sync_deleted_records(
        self,
        table_name: str,
        primary_keys: list[str],
        delete_tracking_table: str = None
    ):
        """Handle deleted records (requires delete tracking in source)."""

        if delete_tracking_table:
            # Read deleted record IDs from tracking table
            query = f"SELECT {', '.join(primary_keys)} FROM {delete_tracking_table}"
            deleted_df = self.writer.spark.read.format("jdbc").options(
                url=self.source_conn_str,
                query=query
            ).load()

            # Build delete condition
            for row in deleted_df.collect():
                conditions = [f"{k} = '{row[k]}'" for k in primary_keys]
                self.writer.delete_records(table_name, " AND ".join(conditions))

# Usage
mirror_location = manager.get_mirror_location(mirror["id"])
writer = OpenMirrorWriter(mirror_location)

source_mirror = CustomSourceMirror(
    source_connection_string="your-source-connection",
    mirror_writer=writer
)

# Full sync
source_mirror.full_sync_table("customers")

# Incremental sync
source_mirror.incremental_sync_table(
    table_name="orders",
    timestamp_column="modified_date",
    primary_keys=["order_id"]
)
```

## Scheduling and Orchestration

```python
from azure.storage.queue import QueueClient
import json

class MirrorOrchestrator:
    def __init__(self, mirror: CustomSourceMirror):
        self.mirror = mirror
        self.tables_config = []

    def add_table(
        self,
        table_name: str,
        sync_type: str,  # "full" or "incremental"
        schedule_minutes: int,
        **kwargs
    ):
        """Add table to sync schedule."""
        self.tables_config.append({
            "table_name": table_name,
            "sync_type": sync_type,
            "schedule_minutes": schedule_minutes,
            **kwargs
        })

    def run_sync_cycle(self):
        """Run one sync cycle for all tables."""
        for config in self.tables_config:
            try:
                if config["sync_type"] == "full":
                    self.mirror.full_sync_table(config["table_name"])
                else:
                    self.mirror.incremental_sync_table(
                        table_name=config["table_name"],
                        timestamp_column=config.get("timestamp_column", "modified_date"),
                        primary_keys=config.get("primary_keys", ["id"])
                    )
                print(f"Synced {config['table_name']}")
            except Exception as e:
                print(f"Error syncing {config['table_name']}: {e}")

# Configure orchestrator
orchestrator = MirrorOrchestrator(source_mirror)

orchestrator.add_table(
    table_name="customers",
    sync_type="incremental",
    schedule_minutes=15,
    timestamp_column="updated_at",
    primary_keys=["customer_id"]
)

orchestrator.add_table(
    table_name="reference_data",
    sync_type="full",
    schedule_minutes=60
)

# Run via scheduler (Azure Functions, Data Factory, etc.)
orchestrator.run_sync_cycle()
```

## Best Practices

1. **Use Delta merge**: More efficient than overwrite for incremental
2. **Partition wisely**: Partition large tables by date or category
3. **Track sync state**: Know when and what was synced
4. **Handle deletes**: Design a strategy for deleted records
5. **Monitor and alert**: Track sync failures and latency

## Limitations

- Manual schema management
- No automatic conflict resolution
- Requires custom orchestration
- SQL endpoint may have slight delay after writes

## Conclusion

Open Mirroring provides flexibility when native connectors don't exist. It requires more work but gives you complete control over the data flow.

Use it for custom sources, complex transformations, or when you need to consolidate multiple sources into a single mirrored database experience.

