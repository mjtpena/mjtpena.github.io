---
title: "Azure SQL Elastic Pools: Cost-Effective Multi-Tenancy"
description: "Elastic pools are ideal for SaaS multi-tenancy where tenant databases have varied, unpredictable loads."
author: Michael John Peña
draft: false
date: 2020-09-21
tags:
  - Azure
  - SQL Database
  - Multi-Tenancy
  - Cost Optimization
---

## The Problem

10 databases, each needing 10 DTUs occasionally but averaging 2 DTUs:
- Individual: 10 × S1 (20 DTUs each) = 10 × $15/month = $150/month
- Elastic Pool: 1 × Standard 50 eDTUs = $74/month

## Creating an Elastic Pool

```bash
az sql elastic-pool create \
    --name myElasticPool \
    --resource-group myResourceGroup \
    --server myserver \
    --edition Standard \
    --capacity 50 \
    --db-min-capacity 0 \
    --db-max-capacity 50
```

## Adding Databases

```bash
# Create database in pool
az sql db create \
    --name tenant1-db \
    --resource-group myResourceGroup \
    --server myserver \
    --elastic-pool myElasticPool

# Move existing database to pool
az sql db update \
    --name existing-db \
    --resource-group myResourceGroup \
    --server myserver \
    --elastic-pool myElasticPool
```

## Monitoring Pool Utilization

```sql
-- Pool resource consumption
SELECT
    elastic_pool_name,
    avg_cpu_percent,
    avg_data_io_percent,
    avg_log_write_percent,
    max_worker_percent,
    max_session_percent
FROM sys.elastic_pool_resource_stats
WHERE elastic_pool_name = 'myElasticPool'
ORDER BY end_time DESC;

-- Per-database consumption
SELECT
    database_name,
    AVG(avg_cpu_percent) as avg_cpu,
    MAX(avg_cpu_percent) as peak_cpu
FROM sys.dm_db_resource_stats
GROUP BY database_name
ORDER BY peak_cpu DESC;
```

## Sizing Guidelines

- **Aggregate DTU/vCore requirement** < Pool size
- **Peak concurrent databases** shouldn't all peak together
- **Individual database max** = Pool size (burst capability)

## When Not to Use Pools

- Single large database (dedicated resources better)
- All databases peak together (no sharing benefit)
- Databases with widely different performance needs

Elastic pools are ideal for SaaS multi-tenancy where tenant databases have varied, unpredictable loads.
