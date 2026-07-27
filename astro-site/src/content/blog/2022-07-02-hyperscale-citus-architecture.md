---
title: "Understanding Hyperscale Citus Architecture"
author: "Michael John Peña"
draft: false
date: 2022-07-02
tags: ["Azure", "Citus", "PostgreSQL", "Architecture", "Distributed Systems"]

---

I wrote "Understanding Hyperscale Citus Architecture" to share practical, production-minded guidance on this topic.

## The Coordinator-Worker Model

In a Citus cluster, there are two types of nodes:

1. **Coordinator Node**: The entry point for all queries. It stores metadata about data distribution and routes queries to workers.
2. **Worker Nodes**: Store actual data shards and execute distributed query fragments.

## How Data is Distributed

```sql
-- Create a distributed table
CREATE TABLE events (
    event_id bigserial,
    tenant_id int,
    event_type text,
    event_data jsonb,
    created_at timestamptz DEFAULT now()
);

-- Distribute the table by tenant_id
SELECT create_distributed_table('events', 'tenant_id');
```

When you distribute a table, Citus:
1. Creates 32 shards by default
2. Assigns each shard to a worker node
3. Routes queries based on the distribution column

## Query Flow

```sql
-- This query is routed to a single shard
SELECT * FROM events WHERE tenant_id = 42;

-- This query runs on all shards in parallel
SELECT event_type, COUNT(*)
FROM events
GROUP BY event_type;
```

## Viewing Cluster Metadata

```sql
-- See all distributed tables
SELECT * FROM citus_tables;

-- View shard placements
SELECT
    shardid,
    nodename,
    nodeport
FROM pg_dist_shard_placement
WHERE shardid IN (
    SELECT shardid FROM pg_dist_shard
    WHERE logicalrelid = 'events'::regclass
);
```

## Scaling the Cluster

```bash
# Add more worker nodes to your cluster
az cosmosdb postgres cluster update \
    --name mypostgrescluster \
    --resource-group myResourceGroup \
    --node-count 4
```

After adding nodes, rebalance your shards:

```sql
SELECT rebalance_table_shards();
```

Understanding this architecture helps you make informed decisions about data modeling and query optimization in your distributed PostgreSQL deployments.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
