---
title: Azure Durable Entities - Stateful Actors in Serverless
author: Michael John Peña
draft: false
date: 2021-04-02
url: /blog/azure-durable-entities-stateful-actors/
tags:
  - Azure
  - Azure Functions
  - Durable Entities
  - Actor Model
  - Serverless

---

I wrote "2021-04-02-azure-durable-entities-stateful-actors" to share practical, production-minded guidance on this topic.

## What Are Durable Entities?

Durable Entities are addressable units of state that process operations one at a time. Think of them as lightweight actors - each entity has a unique identity, maintains its own state, and processes messages sequentially. The runtime handles concurrency, persistence, and distribution automatically.

## Defining an Entity - Class-Based Syntax

The cleanest way to define entities is using the class-based syntax:

```csharp
public interface ICounter
{
    void Add(int amount);
    void Reset();
    int Get();
}

[JsonObject(MemberSerialization.OptIn)]
public class Counter : ICounter
{
    [JsonProperty("value")]
    public int CurrentValue { get; set; }

    public void Add(int amount)
    {
        CurrentValue += amount;
    }

    public void Reset()
    {
        CurrentValue = 0;
    }

    public int Get() => CurrentValue;

    [FunctionName(nameof(Counter))]
    public static Task Run([EntityTrigger] IDurableEntityContext ctx)
        => ctx.DispatchAsync<Counter>();
}
```

## Function-Based Syntax

For simpler scenarios or when you prefer more explicit control:

```csharp
[FunctionName("Counter")]
public static void Counter([EntityTrigger] IDurableEntityContext ctx)
{
    int currentValue = ctx.GetState<int>();

    switch (ctx.OperationName.ToLowerInvariant())
    {
        case "add":
            int amount = ctx.GetInput<int>();
            ctx.SetState(currentValue + amount);
            break;
        case "reset":
            ctx.SetState(0);
            break;
        case "get":
            ctx.Return(currentValue);
            break;
    }
}
```

## Calling Entities from Orchestrations

Orchestrators can interact with entities using typed proxies:

```csharp
[FunctionName("CounterOrchestrator")]
public static async Task<int> RunOrchestrator(
    [OrchestrationTrigger] IDurableOrchestrationContext context)
{
    var entityId = new EntityId(nameof(Counter), "myCounter");
    var proxy = context.CreateEntityProxy<ICounter>(entityId);

    // One-way signal (fire and forget)
    proxy.Add(5);

    // Two-way call (waits for result)
    int currentValue = await proxy.Get();

    return currentValue;
}
```

## Direct Entity Access from Clients

You can also interact with entities directly from HTTP triggers:

```csharp
[FunctionName("AddToCounter")]
public static async Task<IActionResult> AddToCounter(
    [HttpTrigger(AuthorizationLevel.Function, "post", Route = "counter/{counterId}/add")] HttpRequest req,
    [DurableClient] IDurableEntityClient client,
    string counterId)
{
    int amount = int.Parse(await new StreamReader(req.Body).ReadToEndAsync());

    var entityId = new EntityId(nameof(Counter), counterId);

    // Signal the entity (non-blocking)
    await client.SignalEntityAsync(entityId, "add", amount);

    return new AcceptedResult();
}

[FunctionName("GetCounter")]
public static async Task<IActionResult> GetCounter(
    [HttpTrigger(AuthorizationLevel.Function, "get", Route = "counter/{counterId}")] HttpRequest req,
    [DurableClient] IDurableEntityClient client,
    string counterId)
{
    var entityId = new EntityId(nameof(Counter), counterId);

    // Read state directly
    EntityStateResponse<Counter> state = await client.ReadEntityStateAsync<Counter>(entityId);

    if (!state.EntityExists)
    {
        return new NotFoundResult();
    }

    return new OkObjectResult(state.EntityState.CurrentValue);
}
```

## Real-World Example: Shopping Cart

Here's a practical shopping cart implementation:

```csharp
public interface IShoppingCart
{
    void AddItem(CartItem item);
    void RemoveItem(string productId);
    void UpdateQuantity(QuantityUpdate update);
    void Clear();
    CartState GetState();
}

[JsonObject(MemberSerialization.OptIn)]
public class ShoppingCart : IShoppingCart
{
    [JsonProperty("items")]
    public Dictionary<string, CartItem> Items { get; set; } = new();

    [JsonProperty("lastUpdated")]
    public DateTime LastUpdated { get; set; }

    public void AddItem(CartItem item)
    {
        if (Items.ContainsKey(item.ProductId))
        {
            Items[item.ProductId].Quantity += item.Quantity;
        }
        else
        {
            Items[item.ProductId] = item;
        }
        LastUpdated = DateTime.UtcNow;
    }

    public void RemoveItem(string productId)
    {
        Items.Remove(productId);
        LastUpdated = DateTime.UtcNow;
    }

    public void UpdateQuantity(QuantityUpdate update)
    {
        if (Items.TryGetValue(update.ProductId, out var item))
        {
            item.Quantity = update.NewQuantity;
            if (item.Quantity <= 0)
            {
                Items.Remove(update.ProductId);
            }
            LastUpdated = DateTime.UtcNow;
        }
    }

    public void Clear()
    {
        Items.Clear();
        LastUpdated = DateTime.UtcNow;
    }

    public CartState GetState() => new CartState
    {
        Items = Items.Values.ToList(),
        TotalItems = Items.Values.Sum(i => i.Quantity),
        TotalPrice = Items.Values.Sum(i => i.Quantity * i.Price),
        LastUpdated = LastUpdated
    };

    [FunctionName(nameof(ShoppingCart))]
    public static Task Run([EntityTrigger] IDurableEntityContext ctx)
        => ctx.DispatchAsync<ShoppingCart>();
}

public class CartItem
{
    public string ProductId { get; set; }
    public string Name { get; set; }
    public decimal Price { get; set; }
    public int Quantity { get; set; }
}

public class QuantityUpdate
{
    public string ProductId { get; set; }
    public int NewQuantity { get; set; }
}

public class CartState
{
    public List<CartItem> Items { get; set; }
    public int TotalItems { get; set; }
    public decimal TotalPrice { get; set; }
    public DateTime LastUpdated { get; set; }
}
```

## Entity Coordination with Critical Sections

When you need atomic operations across multiple entities:

```csharp
[FunctionName("TransferOrchestrator")]
public static async Task TransferFunds(
    [OrchestrationTrigger] IDurableOrchestrationContext context)
{
    var transfer = context.GetInput<TransferRequest>();

    var sourceId = new EntityId("Account", transfer.SourceAccountId);
    var targetId = new EntityId("Account", transfer.TargetAccountId);

    // Lock both accounts to ensure atomic transfer
    using (await context.LockAsync(sourceId, targetId))
    {
        var sourceProxy = context.CreateEntityProxy<IAccount>(sourceId);
        var targetProxy = context.CreateEntityProxy<IAccount>(targetId);

        decimal sourceBalance = await sourceProxy.GetBalance();

        if (sourceBalance >= transfer.Amount)
        {
            sourceProxy.Withdraw(transfer.Amount);
            targetProxy.Deposit(transfer.Amount);
        }
        else
        {
            throw new InsufficientFundsException();
        }
    }
}
```

## Entity Cleanup and Management

Entities can be deleted when no longer needed:

```csharp
[FunctionName("CleanupOrchestrator")]
public static async Task CleanupOldCarts(
    [OrchestrationTrigger] IDurableOrchestrationContext context)
{
    // Query for all shopping cart entities
    EntityQueryResult result = await context.CallActivityAsync<EntityQueryResult>(
        "QueryStaleEntities", null);

    foreach (var entityId in result.EntityIds)
    {
        // Delete stale entity
        await context.CallActivityAsync("DeleteEntity", entityId);
    }
}

[FunctionName("DeleteEntity")]
public static async Task DeleteEntity(
    [ActivityTrigger] EntityId entityId,
    [DurableClient] IDurableEntityClient client)
{
    await client.SignalEntityAsync(entityId, "delete");
}
```

## Best Practices

1. **Keep entity state small** - Large state impacts performance
2. **Use signals for fire-and-forget** - Calls are more expensive
3. **Design for idempotency** - Operations may be replayed
4. **Consider entity partitioning** - Distribute load across entities
5. **Monitor entity counts** - Too many entities can impact storage costs

## When to Use Durable Entities

- **Shopping carts** - Per-user state management
- **IoT device twins** - Track device state
- **Game state** - Player inventories, leaderboards
- **Aggregations** - Real-time counters and metrics
- **Distributed locks** - Coordination primitives

## Conclusion

Durable Entities provide a powerful abstraction for managing distributed state in serverless applications. By combining the actor model with Azure Functions' serverless benefits, you get the best of both worlds: fine-grained state management without the operational overhead of managing stateful infrastructure.

The automatic serialization, persistence, and concurrency control mean you can focus on your domain logic rather than distributed systems complexities.

