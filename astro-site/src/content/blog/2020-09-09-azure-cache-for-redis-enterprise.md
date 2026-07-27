---
title: "Azure Cache for Redis Enterprise: High Performance Caching"
author: Michael John Peña
draft: false
date: 2020-09-09
tags:
  - Azure
  - Redis
  - Caching
  - Enterprise

---

I wrote "Azure Cache for Redis Enterprise: High Performance Caching" to share practical, production-minded guidance on this topic.

## Enterprise Tiers

| Tier | Features | Use Case |
|------|----------|----------|
| Basic/Standard | Standard Redis | Development, small apps |
| Premium | Clustering, persistence | Production |
| Enterprise | Modules, geo-replication | Mission-critical |
| Enterprise Flash | NVMe storage | Large datasets |

## Creating Enterprise Cache

```bash
az redisenterprise create \
    --name my-redis-enterprise \
    --resource-group myRG \
    --location eastus \
    --sku Enterprise_E10 \
    --zones 1 2 3

# Create database
az redisenterprise database create \
    --cluster-name my-redis-enterprise \
    --resource-group myRG \
    --client-protocol Encrypted \
    --clustering-policy EnterpriseCluster \
    --modules '[{"name":"RedisSearch"},{"name":"RedisJSON"}]'
```

## Active Geo-Replication

```bash
# Link two Enterprise caches
az redisenterprise database create \
    --cluster-name redis-westus \
    --resource-group myRG \
    --geo-replication '[{
        "linkedDatabase": "/subscriptions/.../redis-eastus/databases/default"
    }]'
```

## RediSearch Module

```python
import redis
from redis.commands.search.field import TextField, NumericField
from redis.commands.search.indexDefinition import IndexDefinition, IndexType

r = redis.Redis(host='myredis.redis.cache.windows.net', port=6380, ssl=True, password='key')

# Create search index
r.ft('products').create_index([
    TextField('name', weight=5.0),
    TextField('description'),
    NumericField('price'),
    TextField('category')
], definition=IndexDefinition(prefix=['product:'], index_type=IndexType.HASH))

# Add data
r.hset('product:1', mapping={
    'name': 'Azure Virtual Machine',
    'description': 'Scalable compute in the cloud',
    'price': 100,
    'category': 'Compute'
})

# Search
results = r.ft('products').search('cloud compute')
for doc in results.docs:
    print(f"{doc.name}: {doc.description}")
```

## RedisJSON Module

```python
from redis.commands.json.path import Path

# Store JSON
r.json().set('user:1', Path.root_path(), {
    'name': 'John',
    'email': 'john@example.com',
    'orders': [
        {'id': 1, 'total': 99.99},
        {'id': 2, 'total': 149.99}
    ]
})

# Query JSON
name = r.json().get('user:1', Path('.name'))
orders = r.json().get('user:1', Path('.orders'))

# Update nested value
r.json().numincrby('user:1', Path('.orders[0].total'), 10)
```

## RedisTimeSeries Module

```python
# Create time series
r.ts().create('temperature:sensor1', labels={'location': 'office', 'sensor': '1'})

# Add data points
r.ts().add('temperature:sensor1', '*', 22.5)
r.ts().add('temperature:sensor1', '*', 23.0)

# Query range
data = r.ts().range('temperature:sensor1', '-', '+')

# Aggregation
avg = r.ts().range('temperature:sensor1', '-', '+',
    aggregation_type='avg',
    bucket_size_msec=3600000  # 1 hour
)
```

## RedisBloom Module

```python
# Bloom filter (probabilistic set membership)
r.bf().create('users_seen', 0.01, 1000000)  # 1% error rate, 1M capacity

# Add items
r.bf().add('users_seen', 'user123')
r.bf().madd('users_seen', 'user456', 'user789')

# Check membership
exists = r.bf().exists('users_seen', 'user123')  # True (definitely or probably)
not_exists = r.bf().exists('users_seen', 'unknown')  # False (definitely not)
```

## Clustering

```python
# Enterprise cluster automatically shards
# Connect as single endpoint
r = redis.Redis(
    host='myredis.redis.cache.windows.net',
    port=6380,
    ssl=True,
    password='key'
)

# Cluster handles routing internally
r.set('key1', 'value1')  # Routed to appropriate shard
r.set('key2', 'value2')  # May be different shard
```

## Monitoring

```bash
# Get metrics
az monitor metrics list \
    --resource /subscriptions/.../redisenterprise/myredis \
    --metric "cacheRead" "cacheWrite" "connectedclients" "usedmemory"
```

Redis Enterprise: when standard caching isn't enough.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
