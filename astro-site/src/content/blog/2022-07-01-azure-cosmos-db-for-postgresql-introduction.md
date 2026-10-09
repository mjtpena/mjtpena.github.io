---
title: "Getting Started with Azure Cosmos DB for PostgreSQL"
description: "Azure Cosmos DB for PostgreSQL is a managed database service that extends PostgreSQL with distributed capabilities. It uses the Citus extension to transform…"
author: "Michael John Peña"
draft: false
date: 2022-07-01
tags: ["Azure", "Cosmos DB", "PostgreSQL", "Distributed Databases"]
---

## What is Azure Cosmos DB for PostgreSQL?

Azure Cosmos DB for PostgreSQL is a managed database service that extends PostgreSQL with distributed capabilities. It uses the Citus extension to transform PostgreSQL into a distributed database capable of handling massive workloads.

## Key Features

- **Horizontal scaling**: Distribute data across multiple nodes
- **High performance**: Parallel query execution across shards
- **PostgreSQL compatibility**: Use your existing PostgreSQL skills and tools
- **Managed service**: Azure handles maintenance, backups, and updates

## Creating Your First Cluster

```bash
# Using Azure CLI to create a Cosmos DB for PostgreSQL cluster
az cosmosdb postgres cluster create \
    --name mypostgrescluster \
    --resource-group myResourceGroup \
    --location eastus \
    --coordinator-vcores 4 \
    --coordinator-storage-size 512 \
    --node-count 2 \
    --node-vcores 4 \
    --node-storage-size 512
```

## Connecting to Your Cluster

Once your cluster is provisioned, you can connect using any PostgreSQL client:

```python
import psycopg2

connection = psycopg2.connect(
    host="c-mypostgrescluster.postgres.cosmos.azure.com",
    database="citus",
    user="citus",
    password="your_password",
    port=5432,
    sslmode="require"
)

cursor = connection.cursor()
cursor.execute("SELECT version();")
print(cursor.fetchone())
```

## When to Use Cosmos DB for PostgreSQL

Consider this service when:
- Your single-node PostgreSQL is reaching its limits
- You need to handle millions of requests per second
- Your dataset is growing beyond what a single server can handle
- You want the familiarity of PostgreSQL with distributed capabilities

In upcoming posts, we'll dive deeper into sharding strategies, distributed queries, and performance optimization techniques.
