---
title: "Azure Cache for Redis: Caching Patterns"
description: "Redis caching transforms application performance at scale."
author: Michael John Peña
draft: false
date: 2020-10-24
tags:
  - Azure
  - Redis
  - Caching
  - Performance
---

## Creating Redis Cache

```bash
az redis create \
    --name myrediscache \
    --resource-group myRG \
    --location eastus \
    --sku Standard \
    --vm-size C1
```

## Basic Operations (.NET)

```csharp
using StackExchange.Redis;

// Connection
var redis = ConnectionMultiplexer.Connect("myrediscache.redis.cache.windows.net:6380,password=xxx,ssl=True");
var db = redis.GetDatabase();

// Set value
await db.StringSetAsync("user:123", JsonSerializer.Serialize(user));

// Get value
var json = await db.StringGetAsync("user:123");
var user = JsonSerializer.Deserialize<User>(json);

// Set with expiration
await db.StringSetAsync("session:abc", "data", TimeSpan.FromMinutes(30));

// Delete
await db.KeyDeleteAsync("user:123");
```

## Cache-Aside Pattern

```csharp
public async Task<User> GetUserAsync(string userId)
{
    var cacheKey = $"user:{userId}";

    // Try cache first
    var cached = await _redis.StringGetAsync(cacheKey);
    if (cached.HasValue)
    {
        return JsonSerializer.Deserialize<User>(cached);
    }

    // Cache miss - get from database
    var user = await _dbContext.Users.FindAsync(userId);

    if (user != null)
    {
        // Store in cache
        await _redis.StringSetAsync(
            cacheKey,
            JsonSerializer.Serialize(user),
            TimeSpan.FromMinutes(15)
        );
    }

    return user;
}

public async Task UpdateUserAsync(User user)
{
    // Update database
    _dbContext.Users.Update(user);
    await _dbContext.SaveChangesAsync();

    // Invalidate cache
    await _redis.KeyDeleteAsync($"user:{user.Id}");
}
```

## Write-Through Pattern

```csharp
public async Task SaveOrderAsync(Order order)
{
    // Write to cache AND database atomically
    var tasks = new List<Task>
    {
        _redis.StringSetAsync($"order:{order.Id}", JsonSerializer.Serialize(order)),
        _orderRepository.SaveAsync(order)
    };

    await Task.WhenAll(tasks);
}
```

## Distributed Locking

```csharp
public async Task<bool> TryAcquireLockAsync(string resource, TimeSpan expiry)
{
    var lockKey = $"lock:{resource}";
    var lockValue = Guid.NewGuid().ToString();

    // SET NX (only if not exists)
    var acquired = await _redis.StringSetAsync(
        lockKey,
        lockValue,
        expiry,
        When.NotExists
    );

    return acquired;
}

public async Task ReleaseLockAsync(string resource, string lockValue)
{
    var lockKey = $"lock:{resource}";

    // Only delete if we own the lock (Lua script for atomicity)
    var script = @"
        if redis.call('get', KEYS[1]) == ARGV[1] then
            return redis.call('del', KEYS[1])
        else
            return 0
        end";

    await _redis.ScriptEvaluateAsync(script,
        new RedisKey[] { lockKey },
        new RedisValue[] { lockValue }
    );
}
```

## Pub/Sub Messaging

```csharp
// Publisher
var pub = redis.GetSubscriber();
await pub.PublishAsync("notifications", JsonSerializer.Serialize(notification));

// Subscriber
var sub = redis.GetSubscriber();
await sub.SubscribeAsync("notifications", (channel, message) =>
{
    var notification = JsonSerializer.Deserialize<Notification>(message);
    ProcessNotification(notification);
});
```

## Hash Data Structures

```csharp
// Store object as hash
await db.HashSetAsync("user:123", new HashEntry[]
{
    new HashEntry("name", "John"),
    new HashEntry("email", "john@example.com"),
    new HashEntry("loginCount", 42)
});

// Get single field
var name = await db.HashGetAsync("user:123", "name");

// Increment field
await db.HashIncrementAsync("user:123", "loginCount");

// Get all fields
var entries = await db.HashGetAllAsync("user:123");
```

## Sorted Sets for Leaderboards

```csharp
// Add score
await db.SortedSetAddAsync("leaderboard", "player1", 1500);
await db.SortedSetAddAsync("leaderboard", "player2", 2200);

// Get top 10
var topPlayers = await db.SortedSetRangeByRankWithScoresAsync(
    "leaderboard",
    0, 9,
    Order.Descending
);

// Get player rank
var rank = await db.SortedSetRankAsync("leaderboard", "player1", Order.Descending);
```

Redis caching transforms application performance at scale.
