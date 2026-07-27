---
title: "Building Real-Time Dashboards with Citus"
author: "Michael John Peña"
draft: false
date: 2022-07-07
tags: ["Azure", "Citus", "PostgreSQL", "Real-Time", "Dashboards", "Analytics"]

---

I wrote "Building Real-Time Dashboards with Citus" to share practical, production-minded guidance on this topic.

## Architecture for Real-Time Analytics

```sql
-- Events table for raw data ingestion
CREATE TABLE events (
    id bigserial,
    tenant_id int,
    event_type text,
    event_data jsonb,
    occurred_at timestamptz DEFAULT now(),
    PRIMARY KEY (tenant_id, id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- Create partitions for recent data
CREATE TABLE events_2022_07 PARTITION OF events
    FOR VALUES FROM ('2022-07-01') TO ('2022-08-01');

SELECT create_distributed_table('events', 'tenant_id');
```

## Rollup Tables for Fast Queries

```sql
-- Hourly aggregates for dashboard queries
CREATE TABLE events_hourly (
    tenant_id int,
    event_type text,
    hour timestamptz,
    event_count bigint,
    unique_users bigint,
    PRIMARY KEY (tenant_id, event_type, hour)
);

SELECT create_distributed_table('events_hourly', 'tenant_id');

-- Materialized rollup function
CREATE OR REPLACE FUNCTION rollup_events_hourly(start_time timestamptz, end_time timestamptz)
RETURNS void AS $$
BEGIN
    INSERT INTO events_hourly (tenant_id, event_type, hour, event_count, unique_users)
    SELECT
        tenant_id,
        event_type,
        date_trunc('hour', occurred_at) as hour,
        COUNT(*) as event_count,
        COUNT(DISTINCT (event_data->>'user_id')) as unique_users
    FROM events
    WHERE occurred_at >= start_time AND occurred_at < end_time
    GROUP BY tenant_id, event_type, date_trunc('hour', occurred_at)
    ON CONFLICT (tenant_id, event_type, hour)
    DO UPDATE SET
        event_count = EXCLUDED.event_count,
        unique_users = EXCLUDED.unique_users;
END;
$$ LANGUAGE plpgsql;
```

## Dashboard Query Examples

```sql
-- Real-time event counts (last 5 minutes from raw data)
SELECT
    event_type,
    COUNT(*) as count
FROM events
WHERE tenant_id = 42
  AND occurred_at >= NOW() - INTERVAL '5 minutes'
GROUP BY event_type;

-- Historical trends (from rollup table)
SELECT
    hour,
    SUM(event_count) as total_events,
    SUM(unique_users) as total_users
FROM events_hourly
WHERE tenant_id = 42
  AND hour >= NOW() - INTERVAL '7 days'
GROUP BY hour
ORDER BY hour;
```

## Approximate Distinct Counts with HyperLogLog

```sql
-- Enable the HLL extension
CREATE EXTENSION hll;

-- Aggregated table with HLL for unique counts
CREATE TABLE events_daily_hll (
    tenant_id int,
    event_type text,
    day date,
    event_count bigint,
    users_hll hll,
    PRIMARY KEY (tenant_id, event_type, day)
);

SELECT create_distributed_table('events_daily_hll', 'tenant_id');

-- Query unique users across multiple days
SELECT
    #hll_union_agg(users_hll) as unique_users_estimate
FROM events_daily_hll
WHERE tenant_id = 42
  AND day >= CURRENT_DATE - INTERVAL '30 days';
```

## Real-Time Streaming with COPY

```python
import psycopg2
from io import StringIO

def stream_events(events):
    """Efficiently stream events using COPY"""
    conn = psycopg2.connect(connection_string)

    # Prepare CSV data
    buffer = StringIO()
    for event in events:
        buffer.write(f"{event['tenant_id']},{event['type']},{event['data']},{event['timestamp']}\n")

    buffer.seek(0)

    with conn.cursor() as cur:
        cur.copy_expert(
            "COPY events (tenant_id, event_type, event_data, occurred_at) FROM STDIN WITH CSV",
            buffer
        )

    conn.commit()
```

## Caching Layer Integration

```python
import redis
import json

redis_client = redis.Redis(host='localhost', port=6379)

def get_dashboard_data(tenant_id):
    cache_key = f"dashboard:{tenant_id}"

    cached = redis_client.get(cache_key)
    if cached:
        return json.loads(cached)

    # Query Citus
    data = fetch_from_citus(tenant_id)

    # Cache for 30 seconds
    redis_client.setex(cache_key, 30, json.dumps(data))

    return data
```

Combining Citus's distributed query power with rollup tables and caching enables dashboards that handle millions of events per second.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
