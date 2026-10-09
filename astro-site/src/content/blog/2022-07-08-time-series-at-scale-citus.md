---
title: "Time-Series Data at Scale with Citus and TimescaleDB"
description: "This architecture handles billions of time-series data points while maintaining query performance for both real-time and historical analysis."
author: "Michael John Peña"
draft: false
date: 2022-07-08
tags: ["Azure", "Citus", "PostgreSQL", "Time-Series", "TimescaleDB", "IoT"]
---

## Designing Time-Series Tables

```sql
-- Sensor readings table with proper partitioning
CREATE TABLE sensor_readings (
    sensor_id int NOT NULL,
    reading_time timestamptz NOT NULL,
    temperature double precision,
    humidity double precision,
    pressure double precision,
    metadata jsonb
) PARTITION BY RANGE (reading_time);

-- Create monthly partitions
CREATE TABLE sensor_readings_2022_07
    PARTITION OF sensor_readings
    FOR VALUES FROM ('2022-07-01') TO ('2022-08-01');

CREATE TABLE sensor_readings_2022_08
    PARTITION OF sensor_readings
    FOR VALUES FROM ('2022-08-01') TO ('2022-09-01');

-- Distribute by sensor_id for parallel queries
SELECT create_distributed_table('sensor_readings', 'sensor_id');

-- Create time-based index on each partition
CREATE INDEX idx_readings_time ON sensor_readings (sensor_id, reading_time DESC);
```

## High-Speed Data Ingestion

```python
import asyncio
import asyncpg
from datetime import datetime

async def batch_insert_readings(readings: list):
    """Insert readings in batches for optimal performance"""
    conn = await asyncpg.connect(connection_string)

    # Use COPY for maximum throughput
    await conn.copy_records_to_table(
        'sensor_readings',
        records=readings,
        columns=['sensor_id', 'reading_time', 'temperature', 'humidity', 'pressure', 'metadata']
    )

    await conn.close()

async def ingest_loop():
    """Process readings in micro-batches"""
    buffer = []
    buffer_size = 1000

    async for reading in reading_stream():
        buffer.append(reading)

        if len(buffer) >= buffer_size:
            await batch_insert_readings(buffer)
            buffer = []
```

## Efficient Time-Series Queries

```sql
-- Latest reading per sensor
SELECT DISTINCT ON (sensor_id)
    sensor_id,
    reading_time,
    temperature,
    humidity
FROM sensor_readings
WHERE reading_time >= NOW() - INTERVAL '1 hour'
ORDER BY sensor_id, reading_time DESC;

-- Time-bucketed aggregations
SELECT
    sensor_id,
    date_trunc('hour', reading_time) as hour,
    AVG(temperature) as avg_temp,
    MIN(temperature) as min_temp,
    MAX(temperature) as max_temp,
    COUNT(*) as reading_count
FROM sensor_readings
WHERE sensor_id IN (1, 2, 3, 4, 5)
  AND reading_time >= '2022-07-01'
  AND reading_time < '2022-07-08'
GROUP BY sensor_id, date_trunc('hour', reading_time)
ORDER BY sensor_id, hour;
```

## Continuous Aggregates

```sql
-- Pre-computed hourly aggregates
CREATE TABLE sensor_hourly_stats (
    sensor_id int,
    hour timestamptz,
    avg_temperature double precision,
    avg_humidity double precision,
    avg_pressure double precision,
    min_temperature double precision,
    max_temperature double precision,
    reading_count bigint,
    PRIMARY KEY (sensor_id, hour)
);

SELECT create_distributed_table('sensor_hourly_stats', 'sensor_id');

-- Materialization job
CREATE OR REPLACE PROCEDURE materialize_hourly_stats(
    start_hour timestamptz,
    end_hour timestamptz
)
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO sensor_hourly_stats
    SELECT
        sensor_id,
        date_trunc('hour', reading_time) as hour,
        AVG(temperature),
        AVG(humidity),
        AVG(pressure),
        MIN(temperature),
        MAX(temperature),
        COUNT(*)
    FROM sensor_readings
    WHERE reading_time >= start_hour
      AND reading_time < end_hour
    GROUP BY sensor_id, date_trunc('hour', reading_time)
    ON CONFLICT (sensor_id, hour) DO UPDATE SET
        avg_temperature = EXCLUDED.avg_temperature,
        avg_humidity = EXCLUDED.avg_humidity,
        avg_pressure = EXCLUDED.avg_pressure,
        min_temperature = EXCLUDED.min_temperature,
        max_temperature = EXCLUDED.max_temperature,
        reading_count = EXCLUDED.reading_count;
END;
$$;
```

## Data Retention and Cleanup

```sql
-- Drop old partitions efficiently
DROP TABLE sensor_readings_2022_01;

-- Or use pg_cron for automated cleanup
SELECT cron.schedule('cleanup-old-data', '0 2 * * *', $$
    DROP TABLE IF EXISTS sensor_readings_old;
    ALTER TABLE sensor_readings_2022_01 RENAME TO sensor_readings_old;
$$);
```

## Downsampling Strategies

```sql
-- Create downsampled table for long-term storage
CREATE TABLE sensor_readings_daily (
    sensor_id int,
    day date,
    avg_temperature double precision,
    avg_humidity double precision,
    percentile_95_temp double precision,
    PRIMARY KEY (sensor_id, day)
);

-- Downsample and archive
INSERT INTO sensor_readings_daily
SELECT
    sensor_id,
    reading_time::date as day,
    AVG(temperature),
    AVG(humidity),
    percentile_cont(0.95) WITHIN GROUP (ORDER BY temperature)
FROM sensor_readings
WHERE reading_time >= '2022-06-01'
  AND reading_time < '2022-07-01'
GROUP BY sensor_id, reading_time::date;
```

This architecture handles billions of time-series data points while maintaining query performance for both real-time and historical analysis.
