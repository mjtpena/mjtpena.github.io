---
title: "Redis Clustering in Azure: Scaling for High-Throughput Workloads"
author: "Michael John Peña"
draft: false
date: 2021-08-14
tags: ["Azure", "Redis", "Clustering", "Scalability", "High Availability"]

---

I wrote "Redis Clustering in Azure: Scaling for High-Throughput Workloads" to share practical, production-minded guidance on this topic.

## Creating a Clustered Redis Instance

```bash
# Create Premium tier Redis with clustering
az redis create \
    --resource-group myResourceGroup \
    --name myrediscluster \
    --location eastus \
    --sku Premium \
    --vm-size P1 \
    --shard-count 3 \
    --enable-non-ssl-port false \
    --minimum-tls-version 1.2 \
    --replicas-per-master 1

# Scale out by adding shards
az redis update \
    --resource-group myResourceGroup \
    --name myrediscluster \
    --shard-count 5
```

## Understanding Redis Cluster Architecture

Redis Cluster uses hash slots (16384 total) distributed across shards:

```csharp
// C# - Understanding hash slot distribution
public class RedisClusterInfo
{
    private readonly IConnectionMultiplexer _connection;

    public async Task<ClusterConfiguration> GetClusterConfigAsync()
    {
        var config = _connection.GetServer(_connection.GetEndPoints()[0])
            .ClusterConfiguration;

        var slots = new Dictionary<int, string>();

        foreach (var node in config.Nodes)
        {
            foreach (var slot in node.Slots)
            {
                slots[slot.From] = $"{node.EndPoint} (slots {slot.From}-{slot.To})";
            }
        }

        return new ClusterConfiguration
        {
            Nodes = config.Nodes.Select(n => new NodeInfo
            {
                EndPoint = n.EndPoint.ToString(),
                IsMaster = n.IsMaster,
                Slots = n.Slots.Select(s => $"{s.From}-{s.To}").ToList()
            }).ToList()
        };
    }

    // Calculate which slot a key will be assigned to
    public int GetHashSlot(string key)
    {
        // Check for hash tags {key}
        var start = key.IndexOf('{');
        var end = key.IndexOf('}');

        if (start != -1 && end > start + 1)
        {
            key = key.Substring(start + 1, end - start - 1);
        }

        return Crc16.Hash(Encoding.UTF8.GetBytes(key)) % 16384;
    }
}
```

## Working with Hash Tags for Co-location

```python
# Python - Using hash tags to ensure related keys are on same shard
import redis

class ClusterAwareCache:
    def __init__(self, host, port=6380, password=None):
        self.redis = redis.RedisCluster(
            host=host,
            port=port,
            password=password,
            ssl=True,
            decode_responses=True
        )

    def store_user_data(self, user_id, profile, settings, sessions):
        """
        Use hash tags to ensure all user data is on the same shard.
        Keys like {user:123}:profile and {user:123}:settings
        will hash based on 'user:123' only.
        """
        base_key = f"{{user:{user_id}}}"

        pipe = self.redis.pipeline()
        pipe.hset(f"{base_key}:profile", mapping=profile)
        pipe.hset(f"{base_key}:settings", mapping=settings)

        for session in sessions:
            pipe.sadd(f"{base_key}:sessions", session)

        pipe.execute()

    def get_user_data(self, user_id):
        """All operations hit the same shard due to hash tags"""
        base_key = f"{{user:{user_id}}}"

        pipe = self.redis.pipeline()
        pipe.hgetall(f"{base_key}:profile")
        pipe.hgetall(f"{base_key}:settings")
        pipe.smembers(f"{base_key}:sessions")

        profile, settings, sessions = pipe.execute()

        return {
            'profile': profile,
            'settings': settings,
            'sessions': list(sessions)
        }

    def multi_key_operation_same_shard(self, user_id):
        """
        MGET/MSET work when all keys are on the same shard
        """
        keys = [
            f"{{user:{user_id}}}:name",
            f"{{user:{user_id}}}:email",
            f"{{user:{user_id}}}:last_login"
        ]

        # This works because all keys hash to the same slot
        return self.redis.mget(keys)
```

## Handling Cross-Shard Operations

```csharp
// C# - Handling operations that span multiple shards
public class CrossShardOperations
{
    private readonly IDatabase _database;

    public async Task<Dictionary<string, string>> GetMultipleKeysAsync(
        IEnumerable<string> keys)
    {
        // MGET doesn't work across shards, so we batch by slot
        var keysBySlot = keys.GroupBy(k => GetHashSlot(k));
        var results = new Dictionary<string, string>();

        foreach (var slotGroup in keysBySlot)
        {
            var slotKeys = slotGroup.Select(k => (RedisKey)k).ToArray();
            var values = await _database.StringGetAsync(slotKeys);

            for (int i = 0; i < slotKeys.Length; i++)
            {
                results[slotKeys[i]] = values[i];
            }
        }

        return results;
    }

    public async Task<long> CountAcrossShards(string pattern)
    {
        // SCAN works per-shard, need to aggregate
        var server = _connection.GetServer(_connection.GetEndPoints()[0]);
        long totalCount = 0;

        await foreach (var key in server.KeysAsync(pattern: pattern))
        {
            totalCount++;
        }

        return totalCount;
    }

    // Distributed lock across cluster
    public async Task<bool> AcquireDistributedLockAsync(
        string lockName,
        string lockValue,
        TimeSpan expiry)
    {
        // Lock key should be on single shard for atomicity
        var lockKey = $"{{locks}}:{lockName}";

        return await _database.StringSetAsync(
            lockKey,
            lockValue,
            expiry,
            When.NotExists
        );
    }
}
```

## Cluster-Aware Pub/Sub

```javascript
// Node.js - Pub/Sub in clustered Redis
const Redis = require('ioredis');

class ClusterPubSub {
    constructor(config) {
        // Create cluster connection for pub/sub
        this.cluster = new Redis.Cluster([
            { host: config.host, port: 6380 }
        ], {
            redisOptions: {
                password: config.password,
                tls: { servername: config.host }
            },
            scaleReads: 'slave'
        });

        this.subscribers = new Map();
    }

    async publish(channel, message) {
        // PUBLISH works from any node
        const data = typeof message === 'object'
            ? JSON.stringify(message)
            : message;

        return await this.cluster.publish(channel, data);
    }

    async subscribe(channel, callback) {
        // Each subscriber needs its own connection
        const subscriber = this.cluster.duplicate();

        subscriber.on('message', (ch, message) => {
            if (ch === channel) {
                try {
                    callback(JSON.parse(message));
                } catch {
                    callback(message);
                }
            }
        });

        await subscriber.subscribe(channel);
        this.subscribers.set(channel, subscriber);
    }

    async unsubscribe(channel) {
        const subscriber = this.subscribers.get(channel);
        if (subscriber) {
            await subscriber.unsubscribe(channel);
            subscriber.disconnect();
            this.subscribers.delete(channel);
        }
    }

    // Pattern subscribe
    async psubscribe(pattern, callback) {
        const subscriber = this.cluster.duplicate();

        subscriber.on('pmessage', (pat, channel, message) => {
            if (pat === pattern) {
                callback(channel, JSON.parse(message));
            }
        });

        await subscriber.psubscribe(pattern);
        this.subscribers.set(pattern, subscriber);
    }
}

// Usage
const pubsub = new ClusterPubSub(config);

// Subscribe to user events
await pubsub.subscribe('user:events', (event) => {
    console.log('User event:', event);
});

// Publish from anywhere
await pubsub.publish('user:events', {
    type: 'login',
    userId: '123',
    timestamp: Date.now()
});
```

## Monitoring Cluster Health

```bash
# Check cluster info
redis-cli -h myrediscluster.redis.cache.windows.net -p 6380 -a <password> --tls CLUSTER INFO

# Check slot distribution
redis-cli -h myrediscluster.redis.cache.windows.net -p 6380 -a <password> --tls CLUSTER SLOTS

# Monitor node health
redis-cli -h myrediscluster.redis.cache.windows.net -p 6380 -a <password> --tls CLUSTER NODES
```

```csharp
// C# - Programmatic cluster monitoring
public class ClusterHealthMonitor
{
    public async Task<ClusterHealth> CheckHealthAsync()
    {
        var endpoints = _connection.GetEndPoints();
        var health = new ClusterHealth();

        foreach (var endpoint in endpoints)
        {
            var server = _connection.GetServer(endpoint);

            try
            {
                var info = await server.InfoAsync();
                var clusterInfo = info.FirstOrDefault(g => g.Key == "Cluster");

                health.Nodes.Add(new NodeHealth
                {
                    Endpoint = endpoint.ToString(),
                    IsConnected = server.IsConnected,
                    ClusterState = clusterInfo?
                        .FirstOrDefault(kv => kv.Key == "cluster_state").Value
                });
            }
            catch (Exception ex)
            {
                health.Nodes.Add(new NodeHealth
                {
                    Endpoint = endpoint.ToString(),
                    IsConnected = false,
                    Error = ex.Message
                });
            }
        }

        health.IsHealthy = health.Nodes.All(n => n.IsConnected);
        return health;
    }
}
```

## Best Practices

1. **Use hash tags strategically**: Co-locate related data
2. **Avoid cross-shard operations**: Design for single-shard access
3. **Plan shard count carefully**: Resharding requires downtime
4. **Monitor slot distribution**: Watch for hot spots
5. **Test failover scenarios**: Ensure client handles redirects

Redis clustering provides the horizontal scalability needed for demanding workloads while maintaining Redis's sub-millisecond performance characteristics.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
