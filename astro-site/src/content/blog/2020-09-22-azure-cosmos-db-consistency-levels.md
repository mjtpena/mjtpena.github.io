---
title: "Azure Cosmos DB Consistency Levels Explained"
description: "Strong and Bounded Staleness cost double because reads wait for quorum. Start with Session - it provides intuitive consistency for users while maintaining…"
author: Michael John Peña
draft: false
date: 2020-09-22
tags:
  - Azure
  - Cosmos DB
  - Distributed Systems
  - Database
---

## The Five Levels

### 1. Strong
- Reads always return most recently committed write
- Global ordering of operations
- Highest latency, lowest throughput
- Use when: Financial transactions, inventory systems

### 2. Bounded Staleness
- Reads lag behind writes by at most K versions or T time
- Global ordering guarantee
- Use when: Gaming leaderboards, stock quotes

### 3. Session (Default)
- Strong consistency within a session
- Monotonic reads, writes, and read-your-writes
- Best balance for most applications
- Use when: User profiles, shopping carts

### 4. Consistent Prefix
- Reads never see out-of-order writes
- No gaps in sequence
- Use when: Analytics, social feeds

### 5. Eventual
- No ordering guarantees
- Lowest latency, highest throughput
- Use when: Likes/retweets, non-critical counters

## Setting Consistency

```python
from azure.cosmos import CosmosClient, PartitionKey

# Account-level default
client = CosmosClient(url, credential, consistency_level='Session')

# Per-request override (weaker only)
container.read_item(
    item='123',
    partition_key='partition1',
    consistency_level='Eventual'
)
```

## Cost Impact

| Level | RU Cost | Latency |
|-------|---------|---------|
| Strong | 2x | Highest |
| Bounded Staleness | 2x | High |
| Session | 1x | Medium |
| Consistent Prefix | 1x | Low |
| Eventual | 1x | Lowest |

Strong and Bounded Staleness cost double because reads wait for quorum.

## Practical Guidance

Start with Session - it provides intuitive consistency for users while maintaining good performance. Only go stronger when you have proven requirements.
