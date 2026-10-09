---
title: "Azure Cache for Redis: High-Performance Caching Strategies"
description: "Azure Cache for Redis is the caching layer I add to almost every production Azure application that has read-heavy patterns with data that doesn't change on…"
author: "Michael John Peña"
draft: false
date: 2021-08-13
tags: ["Azure", "Redis", "Caching", "Performance", "In-Memory"]
---

Azure Cache for Redis is the caching layer I add to almost every production Azure application that has read-heavy patterns with data that doesn't change on every request. The value proposition is straightforward: Redis serves reads from in-memory storage at microsecond latency, reducing load on the database and eliminating the round-trip to persistent storage for data that can tolerate being slightly stale. The patterns that benefit most: session state, user profile data, product catalogue reads, computed aggregates that take seconds to generate but can be served from cache for minutes. The tier selection matters: Basic is a single-node cache for development; Standard adds a replicated pair; Premium adds persistence, clustering, and VNet integration. For production, Standard minimum—Basic has no SLA.

## Creating an Azure Cache for Redis Instance

```bash
# Create a Premium tier Redis cache with clustering
az redis create \
    --resource-group myResourceGroup \
    --name myrediscache \
    --location eastus \
    --sku Premium \
    --vm-size P1 \
    --shard-count 2 \
    --enable-non-ssl-port false \
    --minimum-tls-version 1.2

# Get connection string
az redis list-keys \
    --resource-group myResourceGroup \
    --name myrediscache
```

Using Terraform:

```hcl
resource "azurerm_redis_cache" "main" {
  name                = "myrediscache"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  capacity            = 1
  family              = "P"
  sku_name            = "Premium"
  enable_non_ssl_port = false
  minimum_tls_version = "1.2"

  redis_configuration {
    maxmemory_reserved = 50
    maxmemory_policy   = "allkeys-lru"
  }

  patch_schedule {
    day_of_week    = "Sunday"
    start_hour_utc = 2
  }
}
```

## Basic Redis Operations with StackExchange.Redis

```csharp
// C# - Basic Redis operations
using StackExchange.Redis;

public class RedisCacheService
{
    private readonly IDatabase _database;
    private readonly IConnectionMultiplexer _connection;

    public RedisCacheService(string connectionString)
    {
        var options = ConfigurationOptions.Parse(connectionString);
        options.AbortOnConnectFail = false;
        options.ConnectRetry = 3;
        options.ConnectTimeout = 5000;
        options.SyncTimeout = 5000;

        _connection = ConnectionMultiplexer.Connect(options);
        _database = _connection.GetDatabase();
    }

    // String operations
    public async Task<bool> SetStringAsync(string key, string value, TimeSpan? expiry = null)
    {
        return await _database.StringSetAsync(key, value, expiry);
    }

    public async Task<string> GetStringAsync(string key)
    {
        return await _database.StringGetAsync(key);
    }

    // Object caching with JSON serialization
    public async Task<bool> SetObjectAsync<T>(string key, T obj, TimeSpan? expiry = null)
    {
        var json = JsonSerializer.Serialize(obj);
        return await _database.StringSetAsync(key, json, expiry);
    }

    public async Task<T> GetObjectAsync<T>(string key)
    {
        var json = await _database.StringGetAsync(key);
        if (json.IsNullOrEmpty) return default;
        return JsonSerializer.Deserialize<T>(json);
    }

    // Hash operations for structured data
    public async Task SetHashAsync(string key, Dictionary<string, string> fields)
    {
        var entries = fields.Select(f => new HashEntry(f.Key, f.Value)).ToArray();
        await _database.HashSetAsync(key, entries);
    }

    public async Task<Dictionary<string, string>> GetHashAsync(string key)
    {
        var entries = await _database.HashGetAllAsync(key);
        return entries.ToDictionary(
            e => e.Name.ToString(),
            e => e.Value.ToString()
        );
    }

    // Sorted sets for leaderboards
    public async Task AddToLeaderboardAsync(string leaderboard, string member, double score)
    {
        await _database.SortedSetAddAsync(leaderboard, member, score);
    }

    public async Task<IEnumerable<SortedSetEntry>> GetTopScoresAsync(string leaderboard, int count)
    {
        return await _database.SortedSetRangeByRankWithScoresAsync(
            leaderboard, 0, count - 1, Order.Descending);
    }
}
```

## Implementing Cache-Aside Pattern

```csharp
// C# - Cache-aside pattern implementation
public class CacheAsideRepository<T> where T : class
{
    private readonly RedisCacheService _cache;
    private readonly IRepository<T> _repository;
    private readonly TimeSpan _defaultExpiry = TimeSpan.FromMinutes(30);

    public CacheAsideRepository(RedisCacheService cache, IRepository<T> repository)
    {
        _cache = cache;
        _repository = repository;
    }

    public async Task<T> GetByIdAsync(string id)
    {
        var cacheKey = $"{typeof(T).Name}:{id}";

        // Try cache first
        var cached = await _cache.GetObjectAsync<T>(cacheKey);
        if (cached != null)
        {
            return cached;
        }

        // Cache miss - load from database
        var entity = await _repository.GetByIdAsync(id);

        if (entity != null)
        {
            // Populate cache
            await _cache.SetObjectAsync(cacheKey, entity, _defaultExpiry);
        }

        return entity;
    }

    public async Task<T> UpdateAsync(string id, T entity)
    {
        // Update database first
        var updated = await _repository.UpdateAsync(id, entity);

        // Invalidate cache
        var cacheKey = $"{typeof(T).Name}:{id}";
        await _cache.DeleteAsync(cacheKey);

        return updated;
    }

    public async Task DeleteAsync(string id)
    {
        // Delete from database
        await _repository.DeleteAsync(id);

        // Invalidate cache
        var cacheKey = $"{typeof(T).Name}:{id}";
        await _cache.DeleteAsync(cacheKey);
    }
}
```

## Session State Management

```python
# Python - Session management with Redis
import redis
import json
import uuid
from datetime import timedelta

class RedisSessionManager:
    def __init__(self, host, port=6380, password=None, ssl=True):
        self.redis = redis.StrictRedis(
            host=host,
            port=port,
            password=password,
            ssl=ssl,
            decode_responses=True
        )
        self.session_ttl = timedelta(hours=2)

    def create_session(self, user_id, data=None):
        """Create a new session"""
        session_id = str(uuid.uuid4())
        session_key = f"session:{session_id}"

        session_data = {
            'user_id': user_id,
            'created_at': datetime.utcnow().isoformat(),
            'data': data or {}
        }

        self.redis.setex(
            session_key,
            self.session_ttl,
            json.dumps(session_data)
        )

        # Add to user's session set
        self.redis.sadd(f"user_sessions:{user_id}", session_id)

        return session_id

    def get_session(self, session_id):
        """Retrieve session data"""
        session_key = f"session:{session_id}"
        data = self.redis.get(session_key)

        if data:
            # Refresh TTL on access
            self.redis.expire(session_key, self.session_ttl)
            return json.loads(data)

        return None

    def update_session(self, session_id, data):
        """Update session data"""
        session_key = f"session:{session_id}"
        existing = self.get_session(session_id)

        if existing:
            existing['data'].update(data)
            existing['updated_at'] = datetime.utcnow().isoformat()

            self.redis.setex(
                session_key,
                self.session_ttl,
                json.dumps(existing)
            )
            return True

        return False

    def destroy_session(self, session_id):
        """Destroy a session"""
        session = self.get_session(session_id)
        if session:
            self.redis.delete(f"session:{session_id}")
            self.redis.srem(f"user_sessions:{session['user_id']}", session_id)

    def destroy_all_user_sessions(self, user_id):
        """Logout user from all devices"""
        session_ids = self.redis.smembers(f"user_sessions:{user_id}")

        if session_ids:
            keys = [f"session:{sid}" for sid in session_ids]
            self.redis.delete(*keys)
            self.redis.delete(f"user_sessions:{user_id}")
```

## Rate Limiting with Redis

```javascript
// Node.js - Rate limiting implementation
const Redis = require('ioredis');

class RateLimiter {
    constructor(redisConfig) {
        this.redis = new Redis({
            host: redisConfig.host,
            port: 6380,
            password: redisConfig.password,
            tls: { servername: redisConfig.host }
        });
    }

    async isAllowed(clientId, limit = 100, windowSeconds = 60) {
        const key = `ratelimit:${clientId}`;
        const now = Date.now();
        const windowStart = now - (windowSeconds * 1000);

        // Use sorted set with timestamp as score
        const pipeline = this.redis.pipeline();

        // Remove old entries outside window
        pipeline.zremrangebyscore(key, 0, windowStart);

        // Count current requests in window
        pipeline.zcard(key);

        // Add current request
        pipeline.zadd(key, now, `${now}-${Math.random()}`);

        // Set expiry on the key
        pipeline.expire(key, windowSeconds);

        const results = await pipeline.exec();
        const currentCount = results[1][1];

        return {
            allowed: currentCount < limit,
            remaining: Math.max(0, limit - currentCount - 1),
            resetIn: windowSeconds
        };
    }

    // Sliding window rate limiter
    async slidingWindowLimit(clientId, limit, windowSeconds) {
        const key = `sliding:${clientId}`;
        const now = Math.floor(Date.now() / 1000);
        const currentWindow = Math.floor(now / windowSeconds);
        const previousWindow = currentWindow - 1;

        const currentKey = `${key}:${currentWindow}`;
        const previousKey = `${key}:${previousWindow}`;

        const [currentCount, previousCount] = await this.redis.mget(
            currentKey,
            previousKey
        );

        const windowPosition = (now % windowSeconds) / windowSeconds;
        const weightedCount =
            (parseInt(previousCount) || 0) * (1 - windowPosition) +
            (parseInt(currentCount) || 0);

        if (weightedCount >= limit) {
            return { allowed: false, retryAfter: windowSeconds - (now % windowSeconds) };
        }

        await this.redis.multi()
            .incr(currentKey)
            .expire(currentKey, windowSeconds * 2)
            .exec();

        return { allowed: true, remaining: limit - weightedCount - 1 };
    }
}
```

## Best Practices

1. **Use connection multiplexing**: Don't create connections per request
2. **Set appropriate TTLs**: Prevent unbounded memory growth
3. **Use pipelining**: Batch operations for better performance
4. **Monitor memory usage**: Configure eviction policies
5. **Enable TLS**: Always use encrypted connections

Azure Cache for Redis is a versatile tool for caching, session management, real-time messaging, and much more, providing the performance boost your applications need.
