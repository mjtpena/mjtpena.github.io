---
title: "PostgreSQL Hyperscale (Citus) on Azure: Distributed Database Patterns"
author: Michael John Peña
draft: false
date: 2021-05-11
tags:
  - Azure
  - PostgreSQL
  - Database
  - Distributed Systems
  - Citus

---

I wrote "PostgreSQL Hyperscale (Citus) on Azure: Distributed Database Patterns" to share practical, production-minded guidance on this topic.

## Understanding Hyperscale Architecture

Hyperscale uses the Citus extension to create a distributed database:

```
                  Coordinator Node
                  (Metadata + Routing)
                         |
         +---------------+---------------+
         |               |               |
    Worker Node 1   Worker Node 2   Worker Node 3
    (Data Shard 1)  (Data Shard 2)  (Data Shard 3)
```

- **Coordinator**: Routes queries, stores metadata
- **Workers**: Store data shards, execute queries

## Creating a Hyperscale Server Group

```bash
# Create Hyperscale (Citus) server group
az postgres server-group create \
    --name my-hyperscale \
    --resource-group my-rg \
    --location eastus \
    --admin-user citus \
    --admin-password '<strong-password>' \
    --coordinator-vcores 4 \
    --coordinator-storage-size 512 \
    --node-count 3 \
    --node-vcores 4 \
    --node-storage-size 512 \
    --postgresql-version 13
```

## Table Distribution Strategies

The key to Hyperscale performance is choosing the right distribution strategy:

### Distributed Tables
For large tables that need to scale horizontally:

```sql
-- Create a distributed table
CREATE TABLE events (
    tenant_id INT,
    event_id BIGSERIAL,
    event_type VARCHAR(50),
    event_data JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (tenant_id, event_id)
);

-- Distribute by tenant_id (co-location key)
SELECT create_distributed_table('events', 'tenant_id');

-- Data is automatically sharded across workers
INSERT INTO events (tenant_id, event_type, event_data)
VALUES (1, 'click', '{"page": "/home"}');
```

### Reference Tables
For small lookup tables needed on every node:

```sql
-- Create reference table (replicated to all nodes)
CREATE TABLE countries (
    code VARCHAR(2) PRIMARY KEY,
    name VARCHAR(100)
);

SELECT create_reference_table('countries');

-- Now JOINs with distributed tables are efficient
SELECT e.*, c.name as country_name
FROM events e
JOIN countries c ON e.event_data->>'country_code' = c.code
WHERE e.tenant_id = 1;
```

### Local Tables
For coordinator-only data:

```sql
-- Regular PostgreSQL table on coordinator only
CREATE TABLE system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT
);
-- No distribution function called - stays local
```

## Co-location for Efficient Joins

Tables distributed by the same column are co-located:

```sql
-- All tenant data co-located for efficient JOINs
CREATE TABLE tenants (
    tenant_id INT PRIMARY KEY,
    name VARCHAR(100),
    plan VARCHAR(20)
);
SELECT create_distributed_table('tenants', 'tenant_id');

CREATE TABLE users (
    user_id SERIAL,
    tenant_id INT,
    email VARCHAR(255),
    PRIMARY KEY (tenant_id, user_id)
);
SELECT create_distributed_table('users', 'tenant_id');

CREATE TABLE orders (
    order_id SERIAL,
    tenant_id INT,
    user_id INT,
    total DECIMAL(10,2),
    PRIMARY KEY (tenant_id, order_id)
);
SELECT create_distributed_table('orders', 'tenant_id');

-- This JOIN executes entirely on each worker (no network shuffle)
SELECT t.name, COUNT(o.order_id) as order_count, SUM(o.total) as revenue
FROM tenants t
JOIN orders o ON t.tenant_id = o.tenant_id
WHERE t.tenant_id = 1
GROUP BY t.name;
```

## Query Patterns

### Single-Tenant Queries (Fast)
Queries filtering by distribution column hit one shard:

```sql
-- Routes to single worker
SELECT * FROM events
WHERE tenant_id = 1
AND created_at > NOW() - INTERVAL '1 day'
ORDER BY created_at DESC
LIMIT 100;
```

### Cross-Tenant Aggregations
Queries across all shards run in parallel:

```sql
-- Runs on all workers in parallel, aggregates on coordinator
SELECT
    DATE_TRUNC('day', created_at) as day,
    COUNT(*) as event_count
FROM events
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY day;
```

### Real-Time Analytics
Hyperscale excels at real-time rollups:

```sql
-- Create rollup table
CREATE TABLE events_daily (
    tenant_id INT,
    day DATE,
    event_type VARCHAR(50),
    event_count BIGINT,
    PRIMARY KEY (tenant_id, day, event_type)
);
SELECT create_distributed_table('events_daily', 'tenant_id');

-- Incremental rollup (can run every minute)
INSERT INTO events_daily (tenant_id, day, event_type, event_count)
SELECT
    tenant_id,
    DATE_TRUNC('day', created_at)::DATE as day,
    event_type,
    COUNT(*) as event_count
FROM events
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY tenant_id, DATE_TRUNC('day', created_at), event_type
ON CONFLICT (tenant_id, day, event_type)
DO UPDATE SET event_count = events_daily.event_count + EXCLUDED.event_count;
```

## Python Application Example

```python
import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from contextlib import contextmanager

# Connection pool to coordinator
pool = ThreadedConnectionPool(
    minconn=5,
    maxconn=20,
    host="my-hyperscale-c.postgres.database.azure.com",
    port=5432,
    database="citus",
    user="citus",
    password="<password>",
    sslmode="require"
)

@contextmanager
def get_connection():
    conn = pool.getconn()
    try:
        yield conn
    finally:
        pool.putconn(conn)

def get_tenant_events(tenant_id: int, limit: int = 100):
    """Fetch events for a single tenant - hits one shard"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT event_id, event_type, event_data, created_at
                FROM events
                WHERE tenant_id = %s
                ORDER BY created_at DESC
                LIMIT %s
            """, (tenant_id, limit))
            return cur.fetchall()

def get_global_stats():
    """Aggregate across all tenants - parallel execution"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    event_type,
                    COUNT(*) as count,
                    COUNT(DISTINCT tenant_id) as tenants
                FROM events
                WHERE created_at > NOW() - INTERVAL '1 day'
                GROUP BY event_type
                ORDER BY count DESC
            """)
            return cur.fetchall()

def insert_event(tenant_id: int, event_type: str, event_data: dict):
    """Insert event - routes to appropriate shard"""
    import json
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO events (tenant_id, event_type, event_data)
                VALUES (%s, %s, %s)
                RETURNING event_id
            """, (tenant_id, event_type, json.dumps(event_data)))
            conn.commit()
            return cur.fetchone()[0]
```

## Scaling Operations

### Adding Workers
Scale out by adding more workers:

```bash
# Add workers to existing server group
az postgres server-group update \
    --name my-hyperscale \
    --resource-group my-rg \
    --node-count 5

# Rebalance shards across new workers
SELECT rebalance_table_shards();
```

### Monitoring Shard Distribution

```sql
-- Check shard distribution
SELECT
    nodename,
    count(*) as shard_count,
    pg_size_pretty(sum(shard_size)) as total_size
FROM citus_shards
GROUP BY nodename;

-- Check for skewed shards
SELECT
    table_name,
    shardid,
    shard_size,
    nodename
FROM citus_shards
WHERE table_name = 'events'
ORDER BY shard_size DESC
LIMIT 10;
```

## High Availability

Hyperscale supports HA for coordinator and workers:

```bash
# Enable HA (Preview)
az postgres server-group update \
    --name my-hyperscale \
    --resource-group my-rg \
    --coordinator-enable-public-ip-access false \
    --enable-ha true
```

## Performance Tuning

Key parameters to tune:

```sql
-- On coordinator
ALTER SYSTEM SET citus.max_adaptive_executor_pool_size = 16;
ALTER SYSTEM SET citus.executor_slow_start_interval = 10;

-- Parallel query settings
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;
ALTER SYSTEM SET parallel_tuple_cost = 0.001;

-- Memory settings (per node)
ALTER SYSTEM SET shared_buffers = '4GB';
ALTER SYSTEM SET work_mem = '256MB';

SELECT pg_reload_conf();
```

## Use Cases

**Multi-Tenant SaaS**
- Each tenant's data on same shard
- Tenant isolation with distribution key
- Easy per-tenant queries

**Real-Time Analytics**
- High-throughput event ingestion
- Parallel aggregation queries
- Time-series data with rollups

**High-Volume OLTP**
- Distribute load across workers
- Scale reads and writes independently
- Handle millions of operations/second

## Resources

- [Hyperscale (Citus) Documentation](https://docs.microsoft.com/en-us/azure/postgresql/hyperscale/)
- [Citus Data Modeling](https://docs.citusdata.com/en/stable/develop/migration.html)
- [Performance Tuning](https://docs.microsoft.com/en-us/azure/postgresql/hyperscale/howto-performance-tuning)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
