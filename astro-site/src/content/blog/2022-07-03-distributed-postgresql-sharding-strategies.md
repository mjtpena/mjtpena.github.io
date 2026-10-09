---
title: "Sharding Strategies for Distributed PostgreSQL"
description: "The distribution column (also called the shard key) determines how data is partitioned across nodes. Citus uses consistent hashing on this column to assign…"
author: "Michael John Peña"
draft: false
date: 2022-07-03
tags: ["Azure", "PostgreSQL", "Sharding", "Distributed Databases", "Data Modeling"]
---

## Understanding Distribution Columns

The distribution column (also called the shard key) determines how data is partitioned across nodes. Citus uses consistent hashing on this column to assign rows to shards.

## Strategy 1: Tenant-Based Sharding (Multi-Tenant)

Ideal for SaaS applications where data naturally partitions by customer:

```sql
-- Create tables for a multi-tenant application
CREATE TABLE companies (
    id bigserial PRIMARY KEY,
    name text,
    plan text
);

CREATE TABLE users (
    id bigserial,
    company_id bigint,
    email text,
    name text,
    PRIMARY KEY (company_id, id)
);

CREATE TABLE orders (
    id bigserial,
    company_id bigint,
    user_id bigint,
    total decimal,
    created_at timestamptz,
    PRIMARY KEY (company_id, id)
);

-- Distribute all tables by company_id
SELECT create_distributed_table('companies', 'id');
SELECT create_distributed_table('users', 'company_id');
SELECT create_distributed_table('orders', 'company_id');
```

## Strategy 2: Time-Based Sharding

For time-series data, consider combining distribution with partitioning:

```sql
CREATE TABLE sensor_readings (
    sensor_id int,
    reading_time timestamptz,
    value double precision,
    PRIMARY KEY (sensor_id, reading_time)
) PARTITION BY RANGE (reading_time);

-- Create monthly partitions
CREATE TABLE sensor_readings_2022_07
    PARTITION OF sensor_readings
    FOR VALUES FROM ('2022-07-01') TO ('2022-08-01');

-- Distribute by sensor_id
SELECT create_distributed_table('sensor_readings', 'sensor_id');
```

## Strategy 3: Hash-Based Distribution

For high-cardinality columns without natural tenancy:

```sql
CREATE TABLE page_views (
    view_id uuid DEFAULT gen_random_uuid(),
    url text,
    visitor_ip inet,
    viewed_at timestamptz
);

-- Distribute by view_id for even distribution
SELECT create_distributed_table('page_views', 'view_id');
```

## Evaluating Your Distribution Column

Ask these questions:
1. Do most queries filter by this column?
2. Does the column have high cardinality?
3. Is the data evenly distributed across values?
4. Do JOINs use this column?

```sql
-- Check data distribution across shards
SELECT
    shardid,
    result as row_count
FROM run_command_on_shards(
    'events',
    $$ SELECT COUNT(*) FROM %s $$
);
```

Choosing the right sharding strategy upfront saves significant refactoring effort later.
