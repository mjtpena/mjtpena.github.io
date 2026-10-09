---
title: "Azure Database for PostgreSQL Flexible Server Deep Dive"
description: "Flexible Server gives you the power of managed PostgreSQL with the flexibility to tune it for your specific needs."
author: "Michael John Peña"
draft: false
date: 2022-07-13
tags: ["Azure", "PostgreSQL", "Flexible Server", "Database", "Cloud"]
---

## Creating a Flexible Server

```bash
# Create with all options
az postgres flexible-server create \
    --resource-group myResourceGroup \
    --name mypostgresserver \
    --location eastus \
    --admin-user myadmin \
    --admin-password 'SecurePassword123!' \
    --sku-name Standard_D2ds_v4 \
    --tier GeneralPurpose \
    --storage-size 128 \
    --version 14 \
    --high-availability ZoneRedundant \
    --zone 1 \
    --standby-zone 2 \
    --backup-retention 14 \
    --geo-redundant-backup Enabled
```

## Configuring PostgreSQL Parameters

```bash
# View current parameters
az postgres flexible-server parameter list \
    --resource-group myResourceGroup \
    --server-name mypostgresserver \
    --output table

# Optimize for performance
az postgres flexible-server parameter set \
    --resource-group myResourceGroup \
    --server-name mypostgresserver \
    --name shared_buffers \
    --value "1GB"

az postgres flexible-server parameter set \
    --resource-group myResourceGroup \
    --server-name mypostgresserver \
    --name effective_cache_size \
    --value "3GB"

az postgres flexible-server parameter set \
    --resource-group myResourceGroup \
    --server-name mypostgresserver \
    --name work_mem \
    --value "64MB"
```

## Connecting with Python

```python
import psycopg2
from psycopg2 import pool

# Create a connection pool
connection_pool = psycopg2.pool.ThreadedConnectionPool(
    minconn=1,
    maxconn=20,
    host="mypostgresserver.postgres.database.azure.com",
    database="postgres",
    user="myadmin",
    password="SecurePassword123!",
    sslmode="require"
)

def execute_query(query, params=None):
    """Execute a query using pooled connection"""
    conn = connection_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(query, params)
            if cur.description:
                return cur.fetchall()
            conn.commit()
    finally:
        connection_pool.putconn(conn)

# Example usage
results = execute_query("""
    SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = 'public'
""")
```

## Extensions Management

```sql
-- List available extensions
SELECT * FROM pg_available_extensions ORDER BY name;

-- Enable commonly used extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Verify enabled extensions
SELECT extname, extversion FROM pg_extension;
```

## Monitoring and Diagnostics

```bash
# Enable Query Store for query performance insights
az postgres flexible-server parameter set \
    --resource-group myResourceGroup \
    --server-name mypostgresserver \
    --name pg_qs.query_capture_mode \
    --value ALL

# Enable wait statistics
az postgres flexible-server parameter set \
    --resource-group myResourceGroup \
    --server-name mypostgresserver \
    --name pgms_wait_sampling.query_capture_mode \
    --value ALL
```

```sql
-- Query performance insights
SELECT
    query,
    calls,
    total_time,
    mean_time,
    rows
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 10;

-- Check for blocking queries
SELECT
    blocked_locks.pid AS blocked_pid,
    blocked_activity.usename AS blocked_user,
    blocking_locks.pid AS blocking_pid,
    blocking_activity.usename AS blocking_user,
    blocked_activity.query AS blocked_statement
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

## Private Network Access

```bash
# Create with VNet integration
az postgres flexible-server create \
    --resource-group myResourceGroup \
    --name mypostgresserver-private \
    --location eastus \
    --admin-user myadmin \
    --admin-password 'SecurePassword123!' \
    --vnet myVNet \
    --subnet mySubnet \
    --private-dns-zone mypostgres.private.postgres.database.azure.com
```

## Maintenance Windows

```bash
# Set custom maintenance window
az postgres flexible-server update \
    --resource-group myResourceGroup \
    --name mypostgresserver \
    --maintenance-window "Sun:02:00"
```

Flexible Server gives you the power of managed PostgreSQL with the flexibility to tune it for your specific needs.
