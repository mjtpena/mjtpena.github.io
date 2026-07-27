---
title: "GraphQL Subscriptions: Real-Time Data with Azure"
author: Michael John Peña
draft: false
date: 2022-06-20
tags:
  - graphql
  - subscriptions
  - real-time
  - azure

---

I wrote "GraphQL Subscriptions: Real-Time Data with Azure" to share practical, production-minded guidance on this topic.

## Schema Definition

```graphql
type Subscription {
  orderUpdated(customerId: ID!): Order!
  inventoryChanged(productId: ID!): InventoryUpdate!
  priceAlert(threshold: Float!): PriceAlert!
}

type Order {
  id: ID!
  status: OrderStatus!
  items: [OrderItem!]!
}

enum OrderStatus {
  PENDING
  PROCESSING
  SHIPPED
  DELIVERED
}
```

## Implementation with Hot Chocolate

```csharp
public class Subscription
{
    [Subscribe]
    [Topic("OrderUpdated_{customerId}")]
    public Order OrderUpdated(
        [EventMessage] Order order,
        string customerId) => order;

    [Subscribe]
    public IAsyncEnumerable<InventoryUpdate> InventoryChanged(
        string productId,
        [Service] IInventoryService service)
    {
        return service.WatchInventory(productId);
    }
}

// Publishing events
public class OrderService
{
    private readonly ITopicEventSender _eventSender;

    public async Task UpdateOrderAsync(Order order)
    {
        await _repository.UpdateAsync(order);
        await _eventSender.SendAsync(
            $"OrderUpdated_{order.CustomerId}",
            order);
    }
}
```

## Client Subscription

```typescript
import { createClient } from 'graphql-ws';

const client = createClient({
  url: 'wss://api.example.com/graphql',
});

client.subscribe(
  {
    query: `subscription ($customerId: ID!) {
      orderUpdated(customerId: $customerId) {
        id
        status
        items { productId quantity }
      }
    }`,
    variables: { customerId: 'customer-123' },
  },
  {
    next: (data) => console.log('Order update:', data),
    error: (error) => console.error('Subscription error:', error),
    complete: () => console.log('Subscription complete'),
  }
);
```

## Summary

GraphQL subscriptions provide elegant real-time communication, ideal for dashboards, notifications, and live updates.


