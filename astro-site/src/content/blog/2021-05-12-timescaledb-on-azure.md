---
title: "TimescaleDB on Azure: Time-Series Data at Scale"
author: Michael John Peña
draft: false
date: 2021-05-12
tags:
  - Azure
  - TimescaleDB
  - Time Series
  - PostgreSQL
  - Data
---

TimescaleDB is the time-series database I recommend to teams that are already comfortable with PostgreSQL and don't want to learn a new query language or operational model. It's a PostgreSQL extension—so it runs on Azure Database for PostgreSQL, uses SQL, and integrates with the PostgreSQL ecosystem (pgAdmin, JDBC/ODBC, Grafana's PostgreSQL plugin). The `hypertable` abstraction handles automatic time-based partitioning; the `time_bucket` function gives you the tumbling window aggregations that IoT and metrics use cases need. For write throughput in the millions of inserts per second or storage in petabytes, a purpose-built TSDB like InfluxDB or Azure Data Explorer is more appropriate. For the "moderate time-series volume, we already know PostgreSQL" case, TimescaleDB is the right call.

## Why TimescaleDB?

Traditional databases struggle with time-series patterns:
- High insert rates
- Large data volumes
- Time-range queries
- Downsampling and retention

TimescaleDB addresses these with:
- Automatic time-based partitioning (chunks)
- Optimized compression
- Continuous aggregates
- Native PostgreSQL compatibility

## Setting Up TimescaleDB on Azure

TimescaleDB is available as an extension on Azure Database for PostgreSQL:

```bash
# Create PostgreSQL Flexible Server
az postgres flexible-server create \
    --name my-timescale-server \
    --resource-group my-rg \
    --location eastus \
    --admin-user tsadmin \
    --admin-password '<strong-password>' \
    --sku-name Standard_D4s_v3 \
    --storage-size 256 \
    --version 13

# Enable TimescaleDB extension
az postgres flexible-server parameter set \
    --name shared_preload_libraries \
    --resource-group my-rg \
    --server-name my-timescale-server \
    --value timescaledb

# Restart server to load extension
az postgres flexible-server restart \
    --name my-timescale-server \
    --resource-group my-rg
```

Connect and create the extension:

```sql
-- Connect to your database
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Verify installation
SELECT extversion FROM pg_extension WHERE extname = 'timescaledb';
```

## Creating Hypertables

Hypertables are the core concept - they look like regular tables but partition automatically:

```sql
-- Create a regular table
CREATE TABLE sensor_data (
    time TIMESTAMPTZ NOT NULL,
    sensor_id INTEGER NOT NULL,
    location VARCHAR(50),
    temperature DOUBLE PRECISION,
    humidity DOUBLE PRECISION,
    pressure DOUBLE PRECISION
);

-- Convert to hypertable (partitions by time automatically)
SELECT create_hypertable('sensor_data', 'time');

-- Check hypertable info
SELECT * FROM timescaledb_information.hypertables;
```

For high-cardinality data, add space partitioning:

```sql
-- Partition by both time and sensor_id
SELECT create_hypertable(
    'sensor_data',
    'time',
    partitioning_column => 'sensor_id',
    number_partitions => 4
);
```

## Ingesting Data

High-throughput inserts are TimescaleDB's strength:

```python
import psycopg2
from psycopg2.extras import execute_values
from datetime import datetime, timedelta
import random

conn = psycopg2.connect(
    host="my-timescale-server.postgres.database.azure.com",
    database="postgres",
    user="tsadmin",
    password="<password>",
    sslmode="require"
)

def generate_sensor_data(num_points, num_sensors):
    """Generate sample sensor data"""
    base_time = datetime.utcnow()
    data = []
    for i in range(num_points):
        time = base_time - timedelta(seconds=i)
        for sensor_id in range(1, num_sensors + 1):
            data.append((
                time,
                sensor_id,
                f"location_{sensor_id % 10}",
                20 + random.uniform(-5, 15),  # temperature
                40 + random.uniform(-10, 30),  # humidity
                1013 + random.uniform(-20, 20)  # pressure
            ))
    return data

def batch_insert(data, batch_size=1000):
    """Insert data in batches for optimal performance"""
    with conn.cursor() as cur:
        for i in range(0, len(data), batch_size):
            batch = data[i:i + batch_size]
            execute_values(
                cur,
                """
                INSERT INTO sensor_data (time, sensor_id, location, temperature, humidity, pressure)
                VALUES %s
                """,
                batch
            )
        conn.commit()

# Generate and insert 100K points from 50 sensors
data = generate_sensor_data(2000, 50)
batch_insert(data)
print(f"Inserted {len(data)} records")
```

## Time-Series Queries

TimescaleDB optimizes common time-series query patterns:

```sql
-- Last value per sensor
SELECT DISTINCT ON (sensor_id)
    sensor_id,
    time,
    temperature,
    humidity
FROM sensor_data
ORDER BY sensor_id, time DESC;

-- Time-bucket aggregations
SELECT
    time_bucket('1 hour', time) AS bucket,
    sensor_id,
    AVG(temperature) as avg_temp,
    MIN(temperature) as min_temp,
    MAX(temperature) as max_temp,
    COUNT(*) as readings
FROM sensor_data
WHERE time > NOW() - INTERVAL '24 hours'
GROUP BY bucket, sensor_id
ORDER BY bucket, sensor_id;

-- Gap filling for missing data
SELECT
    time_bucket_gapfill('1 hour', time) AS bucket,
    sensor_id,
    AVG(temperature) as avg_temp,
    locf(AVG(temperature)) as avg_temp_filled  -- Last observation carried forward
FROM sensor_data
WHERE time > NOW() - INTERVAL '24 hours'
    AND sensor_id = 1
GROUP BY bucket, sensor_id
ORDER BY bucket;
```

## Continuous Aggregates

Pre-compute aggregations that update automatically:

```sql
-- Create continuous aggregate for hourly stats
CREATE MATERIALIZED VIEW sensor_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    sensor_id,
    location,
    AVG(temperature) as avg_temp,
    MIN(temperature) as min_temp,
    MAX(temperature) as max_temp,
    AVG(humidity) as avg_humidity,
    COUNT(*) as reading_count
FROM sensor_data
GROUP BY bucket, sensor_id, location;

-- Add refresh policy (refresh every hour, covering last 3 hours)
SELECT add_continuous_aggregate_policy('sensor_hourly',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour'
);

-- Query the continuous aggregate (much faster than raw data)
SELECT * FROM sensor_hourly
WHERE bucket > NOW() - INTERVAL '7 days'
    AND sensor_id = 1
ORDER BY bucket;
```

## Compression

Enable compression for older data:

```sql
-- Enable compression on hypertable
ALTER TABLE sensor_data SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id',
    timescaledb.compress_orderby = 'time DESC'
);

-- Add compression policy (compress data older than 7 days)
SELECT add_compression_policy('sensor_data', INTERVAL '7 days');

-- Check compression stats
SELECT
    chunk_name,
    before_compression_total_bytes,
    after_compression_total_bytes,
    compression_ratio
FROM chunk_compression_stats('sensor_data')
ORDER BY chunk_name;

-- Manual compression for specific time range
SELECT compress_chunk(c.chunk_name)
FROM show_chunks('sensor_data', older_than => INTERVAL '7 days') c;
```

## Data Retention

Automatically drop old data:

```sql
-- Add retention policy (keep 90 days of data)
SELECT add_retention_policy('sensor_data', INTERVAL '90 days');

-- Check retention policy
SELECT * FROM timescaledb_information.job_stats
WHERE proc_name = 'policy_retention';

-- Manual chunk removal
SELECT drop_chunks('sensor_data', older_than => INTERVAL '90 days');
```

## Python Analytics Example

```python
import pandas as pd
import psycopg2
from datetime import datetime, timedelta

def get_sensor_analytics(conn, sensor_id: int, hours: int = 24):
    """Get analytics for a specific sensor"""
    query = """
    SELECT
        time_bucket('5 minutes', time) as bucket,
        AVG(temperature) as avg_temp,
        AVG(humidity) as avg_humidity,
        AVG(pressure) as avg_pressure,
        COUNT(*) as readings
    FROM sensor_data
    WHERE sensor_id = %s
        AND time > NOW() - INTERVAL '%s hours'
    GROUP BY bucket
    ORDER BY bucket
    """

    df = pd.read_sql_query(query, conn, params=(sensor_id, hours))
    df['bucket'] = pd.to_datetime(df['bucket'])

    return df

def detect_anomalies(conn, sensor_id: int, threshold: float = 3.0):
    """Detect temperature anomalies using z-score"""
    query = """
    WITH stats AS (
        SELECT
            AVG(temperature) as mean_temp,
            STDDEV(temperature) as std_temp
        FROM sensor_data
        WHERE sensor_id = %s
            AND time > NOW() - INTERVAL '7 days'
    )
    SELECT
        time,
        temperature,
        (temperature - stats.mean_temp) / NULLIF(stats.std_temp, 0) as z_score
    FROM sensor_data, stats
    WHERE sensor_id = %s
        AND time > NOW() - INTERVAL '24 hours'
        AND ABS((temperature - stats.mean_temp) / NULLIF(stats.std_temp, 0)) > %s
    ORDER BY time
    """

    df = pd.read_sql_query(query, conn, params=(sensor_id, sensor_id, threshold))
    return df

# Usage
conn = psycopg2.connect(...)
analytics = get_sensor_analytics(conn, sensor_id=1, hours=24)
anomalies = detect_anomalies(conn, sensor_id=1, threshold=3.0)

print(f"Analytics shape: {analytics.shape}")
print(f"Anomalies found: {len(anomalies)}")
```

## Performance Tips

1. **Chunk size**: Default is 7 days. Adjust based on query patterns:
```sql
SELECT set_chunk_time_interval('sensor_data', INTERVAL '1 day');
```

2. **Indexes**: Create indexes for common query patterns:
```sql
CREATE INDEX ON sensor_data (sensor_id, time DESC);
CREATE INDEX ON sensor_data (location, time DESC);
```

3. **Parallel queries**: Enable for better aggregation performance:
```sql
SET max_parallel_workers_per_gather = 4;
```

## Resources

- [TimescaleDB Documentation](https://docs.timescale.com/)
- [Azure PostgreSQL Extensions](https://docs.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-extensions)
- [TimescaleDB Best Practices](https://docs.timescale.com/timescaledb/latest/how-to-guides/write-data/best-practices/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
