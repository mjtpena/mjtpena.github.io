---
title: "Database Patterns for IoT Applications"
author: "Michael John Peña"
draft: false
date: 2022-07-20
tags: ["IoT", "Database", "Azure", "Architecture", "Time-Series"]

---

I wrote "Database Patterns for IoT Applications" to share practical, production-minded guidance on this topic.

## Pattern 1: Time-Series Data Model

```sql
-- Partitioned time-series table for IoT data
CREATE TABLE device_telemetry (
    device_id VARCHAR(50) NOT NULL,
    timestamp DATETIME2(3) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_value FLOAT NOT NULL,
    tags NVARCHAR(MAX),  -- JSON for flexible attributes
    CONSTRAINT PK_Telemetry PRIMARY KEY CLUSTERED (device_id, timestamp, metric_name)
) ON ps_monthly(timestamp);  -- Partition by month

-- Create partition function and scheme
CREATE PARTITION FUNCTION pf_monthly (DATETIME2(3))
AS RANGE RIGHT FOR VALUES (
    '2022-01-01', '2022-02-01', '2022-03-01',
    '2022-04-01', '2022-05-01', '2022-06-01',
    '2022-07-01', '2022-08-01', '2022-09-01',
    '2022-10-01', '2022-11-01', '2022-12-01'
);

CREATE PARTITION SCHEME ps_monthly
AS PARTITION pf_monthly ALL TO ([PRIMARY]);
```

## Pattern 2: Wide Table Design

```sql
-- Wide table for devices with many metrics
CREATE TABLE device_readings_wide (
    device_id VARCHAR(50) NOT NULL,
    timestamp DATETIME2(3) NOT NULL,
    temperature FLOAT,
    humidity FLOAT,
    pressure FLOAT,
    voltage FLOAT,
    current FLOAT,
    power FLOAT,
    vibration_x FLOAT,
    vibration_y FLOAT,
    vibration_z FLOAT,
    CONSTRAINT PK_Wide PRIMARY KEY CLUSTERED (device_id, timestamp)
);

-- Efficient for queries that need multiple metrics
SELECT
    device_id,
    Date_Bucket(minute, 15, timestamp) AS time_bucket,
    AVG(temperature) AS avg_temp,
    AVG(humidity) AS avg_humidity,
    AVG(power) AS avg_power
FROM device_readings_wide
WHERE timestamp >= DATEADD(day, -1, GETUTCDATE())
GROUP BY device_id, Date_Bucket(minute, 15, timestamp);
```

## Pattern 3: Hot/Warm/Cold Storage

```python
from datetime import datetime, timedelta
import pyodbc

class TieredStorageManager:
    def __init__(self, hot_conn, warm_conn, cold_conn):
        self.hot_conn = hot_conn    # In-memory or SSD
        self.warm_conn = warm_conn  # Standard storage
        self.cold_conn = cold_conn  # Archive storage

    def query(self, device_id, start_time, end_time):
        """Query across storage tiers"""
        now = datetime.utcnow()
        hot_boundary = now - timedelta(days=1)
        warm_boundary = now - timedelta(days=30)

        results = []

        # Query hot storage for recent data
        if end_time > hot_boundary:
            results.extend(self._query_tier(
                self.hot_conn, device_id,
                max(start_time, hot_boundary), end_time
            ))

        # Query warm storage
        if start_time < hot_boundary and end_time > warm_boundary:
            results.extend(self._query_tier(
                self.warm_conn, device_id,
                max(start_time, warm_boundary),
                min(end_time, hot_boundary)
            ))

        # Query cold storage for historical data
        if start_time < warm_boundary:
            results.extend(self._query_tier(
                self.cold_conn, device_id,
                start_time, min(end_time, warm_boundary)
            ))

        return sorted(results, key=lambda x: x['timestamp'])

    def _query_tier(self, conn_str, device_id, start, end):
        with pyodbc.connect(conn_str) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT device_id, timestamp, metric_value
                FROM device_telemetry
                WHERE device_id = ?
                AND timestamp BETWEEN ? AND ?
            """, device_id, start, end)
            return [dict(zip(['device_id', 'timestamp', 'metric_value'], row))
                    for row in cursor.fetchall()]
```

## Pattern 4: Aggregation Pipeline

```sql
-- Raw data table (short retention)
CREATE TABLE telemetry_raw (
    device_id VARCHAR(50),
    timestamp DATETIME2(3),
    value FLOAT
);

-- Minute aggregates
CREATE TABLE telemetry_1min (
    device_id VARCHAR(50),
    timestamp DATETIME2(0),  -- Minute precision
    avg_value FLOAT,
    min_value FLOAT,
    max_value FLOAT,
    count_value INT,
    PRIMARY KEY (device_id, timestamp)
);

-- Hourly aggregates
CREATE TABLE telemetry_1hour (
    device_id VARCHAR(50),
    timestamp DATETIME2(0),
    avg_value FLOAT,
    min_value FLOAT,
    max_value FLOAT,
    count_value INT,
    PRIMARY KEY (device_id, timestamp)
);

-- Aggregation procedure
CREATE PROCEDURE sp_aggregate_telemetry
    @start_time DATETIME2,
    @end_time DATETIME2
AS
BEGIN
    -- Aggregate to minute level
    INSERT INTO telemetry_1min
    SELECT
        device_id,
        DATEADD(MINUTE, DATEDIFF(MINUTE, 0, timestamp), 0),
        AVG(value), MIN(value), MAX(value), COUNT(*)
    FROM telemetry_raw
    WHERE timestamp >= @start_time AND timestamp < @end_time
    GROUP BY device_id, DATEADD(MINUTE, DATEDIFF(MINUTE, 0, timestamp), 0);

    -- Aggregate to hour level
    INSERT INTO telemetry_1hour
    SELECT
        device_id,
        DATEADD(HOUR, DATEDIFF(HOUR, 0, timestamp), 0),
        AVG(avg_value), MIN(min_value), MAX(max_value), SUM(count_value)
    FROM telemetry_1min
    WHERE timestamp >= @start_time AND timestamp < @end_time
    GROUP BY device_id, DATEADD(HOUR, DATEDIFF(HOUR, 0, timestamp), 0);
END;
```

## Pattern 5: Device State Management

```sql
-- Current device state (always latest)
CREATE TABLE device_state (
    device_id VARCHAR(50) PRIMARY KEY,
    last_seen DATETIME2(3),
    status VARCHAR(20),
    firmware_version VARCHAR(20),
    ip_address VARCHAR(45),
    current_config NVARCHAR(MAX),  -- JSON
    last_telemetry NVARCHAR(MAX)   -- JSON
);

-- Upsert pattern for state updates
CREATE PROCEDURE sp_update_device_state
    @device_id VARCHAR(50),
    @status VARCHAR(20),
    @telemetry NVARCHAR(MAX)
AS
BEGIN
    MERGE device_state AS target
    USING (SELECT @device_id, @status, @telemetry) AS source (device_id, status, telemetry)
    ON target.device_id = source.device_id
    WHEN MATCHED THEN
        UPDATE SET
            last_seen = GETUTCDATE(),
            status = source.status,
            last_telemetry = source.telemetry
    WHEN NOT MATCHED THEN
        INSERT (device_id, last_seen, status, last_telemetry)
        VALUES (source.device_id, GETUTCDATE(), source.status, source.telemetry);
END;
```

## Pattern 6: Batch Ingestion

```python
import pyodbc
from io import StringIO

def batch_insert_telemetry(records):
    """Efficient batch insert using table-valued parameters"""
    conn_str = "Driver={ODBC Driver 18 for SQL Server};Server=...;"

    with pyodbc.connect(conn_str) as conn:
        cursor = conn.cursor()

        # Use executemany for batch operations
        cursor.fast_executemany = True
        cursor.executemany("""
            INSERT INTO telemetry_raw (device_id, timestamp, value)
            VALUES (?, ?, ?)
        """, records)

        conn.commit()

# Process data in batches
def process_stream(stream, batch_size=10000):
    batch = []
    for record in stream:
        batch.append((record['device_id'], record['timestamp'], record['value']))
        if len(batch) >= batch_size:
            batch_insert_telemetry(batch)
            batch = []

    if batch:
        batch_insert_telemetry(batch)
```

These patterns form the foundation for building scalable, performant IoT database solutions.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
