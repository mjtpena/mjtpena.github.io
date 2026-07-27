---
title: "Change Data Capture in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-08-08
tags:
  - Microsoft Fabric
  - CDC
  - Data Integration
  - ETL
  - Real-Time

---

I wrote "Change Data Capture in Microsoft Fabric" to share practical, production-minded guidance on this topic.

## CDC Fundamentals

CDC captures row-level changes (inserts, updates, deletes) from source systems:

```
Source Database
      │
      ├── INSERT → CDC Log → Fabric
      ├── UPDATE → CDC Log → Fabric
      └── DELETE → CDC Log → Fabric
```

## CDC Options in Fabric

### 1. Database Mirroring (Built-in CDC)

The simplest option for supported sources:

```python
# Mirroring handles CDC automatically
# Just enable change tracking on source

# Azure SQL
"""
ALTER DATABASE [YourDB] SET CHANGE_TRACKING = ON;
ALTER TABLE [dbo].[Orders] ENABLE CHANGE_TRACKING;
"""

# The mirroring service polls for changes and applies them
```

### 2. Data Factory CDC Connector

For more control over the CDC process:

```python
def create_cdc_copy_activity():
    """Create CDC-aware copy activity in Data Factory."""

    activity = {
        "name": "IncrementalCopy",
        "type": "Copy",
        "inputs": [{
            "referenceName": "SqlChangeTrackingSource",
            "type": "DatasetReference"
        }],
        "outputs": [{
            "referenceName": "LakehouseDelta",
            "type": "DatasetReference"
        }],
        "typeProperties": {
            "source": {
                "type": "SqlServerSource",
                "sqlReaderQuery": """
                    DECLARE @from_lsn binary(10), @to_lsn binary(10);
                    SET @from_lsn = @LastLSN;
                    SET @to_lsn = sys.fn_cdc_get_max_lsn();

                    SELECT
                        CT.__$operation,
                        CT.__$start_lsn,
                        T.*
                    FROM cdc.fn_cdc_get_all_changes_dbo_Orders(
                        @from_lsn, @to_lsn, 'all'
                    ) CT
                    JOIN dbo.Orders T ON CT.OrderID = T.OrderID
                """
            },
            "sink": {
                "type": "DeltaLakeSink",
                "writeBehavior": "upsert",
                "updateCondition": "__$operation IN (2, 4)",  # Update operations
                "deleteCondition": "__$operation = 1"         # Delete operations
            }
        }
    }

    return activity
```

### 3. Eventstream with CDC Sources

For streaming CDC:

```python
class EventstreamCDC:
    def create_debezium_source(self):
        """Configure Debezium CDC source for Eventstream."""

        # Debezium connector configuration
        connector_config = {
            "name": "sql-server-connector",
            "connector.class": "io.debezium.connector.sqlserver.SqlServerConnector",
            "database.hostname": "sqlserver.database.windows.net",
            "database.port": "1433",
            "database.user": "cdc_user",
            "database.password": "${secrets:sql-password}",
            "database.dbname": "SalesDB",
            "database.server.name": "salesdb",
            "table.include.list": "dbo.Orders,dbo.Customers",
            "database.history.kafka.bootstrap.servers": "eventhub.servicebus.windows.net:9093",
            "database.history.kafka.topic": "schema-changes"
        }

        return connector_config

    def process_cdc_events(self):
        """Eventstream processing for CDC events."""

        eventstream_config = {
            "name": "CDC-Orders-Stream",
            "source": {
                "type": "Kafka",  # Debezium outputs to Kafka-compatible endpoint
                "topic": "salesdb.dbo.Orders"
            },
            "transformations": [
                {
                    "name": "parse_debezium",
                    "type": "ParseJson",
                    "extract_fields": ["before", "after", "op", "ts_ms"]
                },
                {
                    "name": "transform_changes",
                    "type": "Expression",
                    "expressions": [
                        "CASE op WHEN 'c' THEN 'INSERT' WHEN 'u' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' END AS operation",
                        "COALESCE(after.OrderID, before.OrderID) AS OrderID",
                        "after.* AS current_values"
                    ]
                }
            ],
            "destinations": [
                {
                    "type": "Lakehouse",
                    "table": "orders_cdc_raw",
                    "mode": "append"
                }
            ]
        }

        return eventstream_config
```

## Implementing CDC Processing

### Delta Lake Merge Pattern

```python
from delta.tables import DeltaTable
from pyspark.sql.functions import *

class CDCProcessor:
    def __init__(self, spark, target_path: str):
        self.spark = spark
        self.target_path = target_path

    def apply_changes(self, changes_df, key_columns: list[str]):
        """Apply CDC changes to Delta table."""

        # Check if target exists
        if DeltaTable.isDeltaTable(self.spark, self.target_path):
            target = DeltaTable.forPath(self.spark, self.target_path)

            # Build merge condition
            merge_condition = " AND ".join(
                f"target.{col} = changes.{col}"
                for col in key_columns
            )

            # Apply changes based on operation type
            target.alias("target").merge(
                changes_df.alias("changes"),
                merge_condition
            ).whenMatchedUpdate(
                condition="changes.__$operation = 4",  # Update
                set=self._build_update_set(changes_df.columns, key_columns)
            ).whenMatchedDelete(
                condition="changes.__$operation = 1"   # Delete
            ).whenNotMatchedInsert(
                condition="changes.__$operation IN (2, 4)",  # Insert or Update (new row)
                values=self._build_insert_values(changes_df.columns)
            ).execute()

        else:
            # Initial load
            initial_data = changes_df.filter(
                col("__$operation").isin([2, 4])  # Inserts and Updates
            ).drop("__$operation", "__$start_lsn")

            initial_data.write.format("delta").save(self.target_path)

    def _build_update_set(self, columns: list, key_columns: list) -> dict:
        """Build update set excluding keys and CDC columns."""
        update_cols = [
            c for c in columns
            if c not in key_columns and not c.startswith("__$")
        ]
        return {col: f"changes.{col}" for col in update_cols}

    def _build_insert_values(self, columns: list) -> dict:
        """Build insert values excluding CDC columns."""
        insert_cols = [c for c in columns if not c.startswith("__$")]
        return {col: f"changes.{col}" for col in insert_cols}

# Usage
processor = CDCProcessor(spark, "Tables/orders")

# Read CDC changes
changes = spark.read.format("delta").load("Tables/orders_cdc_raw") \
    .filter(col("processed") == False)

# Apply changes
processor.apply_changes(changes, key_columns=["OrderID"])
```

### Handling Late-Arriving Data

```python
def handle_late_arrivals(self, changes_df, watermark_column: str, max_delay_hours: int = 24):
    """Handle out-of-order CDC events."""

    # Add processing timestamp
    changes_with_ts = changes_df.withColumn(
        "processing_time",
        current_timestamp()
    )

    # Filter out events that are too old
    valid_changes = changes_with_ts.filter(
        col(watermark_column) >= (
            current_timestamp() - expr(f"INTERVAL {max_delay_hours} HOURS")
        )
    )

    # Log dropped events
    dropped = changes_with_ts.exceptAll(valid_changes)
    if dropped.count() > 0:
        dropped.write.format("delta").mode("append").save("Tables/cdc_dropped_events")
        print(f"Dropped {dropped.count()} late events")

    return valid_changes
```

## CDC State Management

```python
class CDCStateManager:
    """Track CDC processing state for incremental loads."""

    def __init__(self, state_path: str):
        self.state_path = state_path

    def get_last_lsn(self, table_name: str) -> bytes:
        """Get last processed LSN for a table."""
        try:
            state = spark.read.format("delta").load(self.state_path) \
                .filter(col("table_name") == table_name) \
                .orderBy(col("updated_at").desc()) \
                .first()

            return state["last_lsn"] if state else None
        except:
            return None

    def update_lsn(self, table_name: str, lsn: bytes, rows_processed: int):
        """Update last processed LSN."""
        from pyspark.sql import Row

        state_row = Row(
            table_name=table_name,
            last_lsn=lsn,
            rows_processed=rows_processed,
            updated_at=datetime.utcnow()
        )

        spark.createDataFrame([state_row]).write \
            .format("delta") \
            .mode("append") \
            .save(self.state_path)

    def get_processing_stats(self, table_name: str, days: int = 7) -> dict:
        """Get CDC processing statistics."""
        stats = spark.read.format("delta").load(self.state_path) \
            .filter(col("table_name") == table_name) \
            .filter(col("updated_at") >= date_sub(current_date(), days)) \
            .agg(
                sum("rows_processed").alias("total_rows"),
                count("*").alias("sync_count"),
                min("updated_at").alias("first_sync"),
                max("updated_at").alias("last_sync")
            ).first()

        return stats.asDict() if stats else {}
```

## Best Practices

1. **Enable CDC early**: Easier to set up before data volume grows
2. **Monitor LSN/watermarks**: Track your position in the change stream
3. **Handle deletes carefully**: Soft deletes often preferred for analytics
4. **Test recovery scenarios**: Know how to replay from a specific point
5. **Consider retention**: CDC logs can grow large

## Conclusion

CDC in Fabric enables efficient incremental data processing. Whether through built-in mirroring, Data Factory, or custom implementations, understanding CDC patterns is essential for modern data platforms.

Choose the approach that matches your latency requirements and operational capabilities.

