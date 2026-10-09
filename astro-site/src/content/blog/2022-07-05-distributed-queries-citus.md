---
title: "Mastering Distributed Queries in Citus"
description: "Understanding these query patterns helps you leverage Citus effectively for high-performance distributed PostgreSQL applications."
author: "Michael John Peña"
draft: false
date: 2022-07-05
tags: ["Azure", "Citus", "PostgreSQL", "Distributed Queries", "Performance"]
---

## Types of Distributed Queries

### 1. Router Queries (Single-Shard)

Queries that target a specific shard based on the distribution column:

```sql
-- This query routes to a single shard
SELECT * FROM orders WHERE tenant_id = 42;

-- Explain shows it's a router query
EXPLAIN SELECT * FROM orders WHERE tenant_id = 42;
-- Task Count: 1 (single shard)
```

### 2. Scatter-Gather Queries

Queries that run on all shards and aggregate results:

```sql
-- Runs on all shards in parallel
SELECT
    DATE_TRUNC('day', created_at) as day,
    COUNT(*) as order_count,
    SUM(amount) as total_amount
FROM orders
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY day;
```

### 3. Co-located Joins

Joins between tables with the same distribution column:

```sql
-- Orders and order_items distributed by tenant_id
-- This join happens locally on each shard
SELECT
    o.id,
    o.created_at,
    SUM(oi.quantity * oi.unit_price) as total
FROM orders o
JOIN order_items oi ON o.tenant_id = oi.tenant_id
    AND o.id = oi.order_id
WHERE o.tenant_id = 42
GROUP BY o.id, o.created_at;
```

## Analyzing Query Performance

```sql
-- Enable timing and analyze
\timing on

EXPLAIN (ANALYZE, VERBOSE, BUFFERS)
SELECT
    tenant_id,
    COUNT(*) as order_count
FROM orders
WHERE created_at >= '2022-07-01'
GROUP BY tenant_id;
```

## Optimizing Distributed Queries

### Push Down Filters

```sql
-- Good: Filter pushes down to workers
SELECT * FROM orders
WHERE tenant_id = 42
  AND created_at >= '2022-07-01';

-- Avoid: Functions on distribution column prevent routing
SELECT * FROM orders
WHERE tenant_id::text = '42';  -- Bad!
```

### Use CTEs Wisely

```sql
-- CTEs can be optimized in Citus 11+
WITH recent_orders AS (
    SELECT * FROM orders
    WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
)
SELECT tenant_id, COUNT(*)
FROM recent_orders
GROUP BY tenant_id;
```

### Parallel DML

```sql
-- Insert from SELECT runs in parallel
INSERT INTO order_archive (tenant_id, order_id, data)
SELECT
    tenant_id,
    id,
    row_to_json(orders.*)::jsonb
FROM orders
WHERE created_at < '2022-01-01';
```

## Monitoring Distributed Queries

```sql
-- View active distributed queries
SELECT * FROM citus_stat_activity
WHERE query NOT LIKE '%citus_stat_activity%';

-- Check query statistics
SELECT
    queryid,
    query,
    calls,
    mean_time,
    total_time
FROM citus_stat_statements
ORDER BY total_time DESC
LIMIT 10;
```

Understanding these query patterns helps you leverage Citus effectively for high-performance distributed PostgreSQL applications.
