---
title: "Azure SQL Hyperscale: Massive Scale SQL"
description: "There's a moment in any growing SaaS where someone runs spspaceused and the room goes quiet—the database is approaching the 4 TB ceiling and the migration…"
author: Michael John Peña
draft: false
date: 2020-11-21
tags:
  - Azure
  - SQL
  - Database
  - Hyperscale
---

There's a moment in any growing SaaS where someone runs `sp_spaceused` and the room goes quiet—the database is approaching the 4 TB ceiling and the migration plan is "shard it." Hyperscale is the alternative I now reach for. Separated compute and storage, scale to 100 TB, near-instant backups regardless of size, and read replicas that come up in seconds. It's not free, but neither is hand-rolling sharding.

## Hyperscale Architecture

```
┌─────────────────────────────────────────┐
│           Compute Tier                   │
│  Primary ←→ Secondary (0-4 replicas)    │
└────────────────┬────────────────────────┘
                 │
┌────────────────┴────────────────────────┐
│           Page Servers                   │
│  (Distributed storage nodes)            │
└────────────────┬────────────────────────┘
                 │
┌────────────────┴────────────────────────┐
│         Azure Storage                    │
│  (Data files, transaction log)          │
└─────────────────────────────────────────┘
```

## Creating Hyperscale Database

```bash
az sql db create \
    --resource-group myRG \
    --server myserver \
    --name hyperdb \
    --edition Hyperscale \
    --compute-model Serverless \
    --family Gen5 \
    --min-capacity 0.5 \
    --max-capacity 8 \
    --auto-pause-delay 60 \
    --storage-size 100GB
```

## Read Scale-Out

```bash
# Add read replicas
az sql db update \
    --resource-group myRG \
    --server myserver \
    --name hyperdb \
    --read-replicas 4
```

```csharp
// Connect to read replica
var connectionString =
    "Server=myserver.database.windows.net;Database=hyperdb;" +
    "ApplicationIntent=ReadOnly;";
```

## Named Replicas

```bash
# Create named replica for specific workload
az sql db replica create \
    --name hyperdb \
    --resource-group myRG \
    --server myserver \
    --partner-server myserver \
    --partner-database hyperdb-analytics \
    --secondary-type Named \
    --capacity 8
```

## Fast Restore

```bash
# Point-in-time restore (near-instant)
az sql db restore \
    --dest-name hyperdb-restored \
    --edition Hyperscale \
    --resource-group myRG \
    --server myserver \
    --name hyperdb \
    --time "2020-11-21T10:00:00Z"
```

## Geo-Replication

```bash
# Add geo-secondary
az sql db replica create \
    --name hyperdb \
    --resource-group myRG \
    --server myserver \
    --partner-server myserver-westus \
    --partner-resource-group myRG-westus \
    --secondary-type Geo
```

## Performance Tiers

| vCores | Memory | IOPS |
|--------|--------|------|
| 2 | 10.2 GB | 10,000 |
| 4 | 20.4 GB | 20,000 |
| 8 | 40.8 GB | 40,000 |
| 16 | 81.6 GB | 80,000 |
| 24 | 122.4 GB | 120,000 |
| 32 | 163.2 GB | 160,000 |
| 80 | 408 GB | 320,000 |

## Serverless Configuration

```bash
# Auto-pause and auto-scale
az sql db update \
    --resource-group myRG \
    --server myserver \
    --name hyperdb \
    --compute-model Serverless \
    --min-capacity 0.5 \
    --max-capacity 16 \
    --auto-pause-delay 60  # minutes
```

## Monitoring

```sql
-- Check page server status
SELECT * FROM sys.dm_db_page_server_stats;

-- View replica lag
SELECT
    database_id,
    sync_state_desc,
    synchronization_health_desc,
    last_hardened_lsn,
    last_commit_time
FROM sys.dm_hadr_database_replica_states;
```

## Key Benefits

| Feature | Hyperscale | Other Tiers |
|---------|------------|-------------|
| Max size | 100 TB | 4 TB |
| Backup speed | Near-instant | Hours |
| Restore speed | Minutes | Hours |
| Read replicas | Up to 4 | 0 |
| Scale compute | Seconds | Minutes |

## Migration to Hyperscale

```bash
# Migrate existing database
az sql db update \
    --resource-group myRG \
    --server myserver \
    --name existingdb \
    --edition Hyperscale
```

Note: Migration to Hyperscale is one-way.

Hyperscale: SQL Server at cloud scale.
