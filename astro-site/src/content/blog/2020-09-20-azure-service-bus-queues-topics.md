---
title: "Azure Service Bus: Queues and Topics Patterns"
description: "Service Bus is the backbone of reliable, decoupled architectures on Azure."
author: Michael John Peña
draft: false
date: 2020-09-20
tags:
  - Azure
  - Service Bus
  - Messaging
  - Integration
---

## Queue: Point-to-Point

```python
from azure.servicebus import ServiceBusClient, ServiceBusMessage

connection_str = "Endpoint=sb://mynamespace.servicebus.windows.net/..."
queue_name = "orders"

# Send message
with ServiceBusClient.from_connection_string(connection_str) as client:
    with client.get_queue_sender(queue_name) as sender:
        message = ServiceBusMessage(
            json.dumps({"order_id": "123", "amount": 99.99}),
            content_type="application/json",
            subject="new-order"
        )
        sender.send_messages(message)

# Receive message
with ServiceBusClient.from_connection_string(connection_str) as client:
    with client.get_queue_receiver(queue_name) as receiver:
        for msg in receiver.receive_messages(max_message_count=10, max_wait_time=5):
            print(json.loads(str(msg)))
            receiver.complete_message(msg)
```

## Topic: Publish-Subscribe

```python
topic_name = "order-events"
subscription_name = "inventory-service"

# Publish to topic
with client.get_topic_sender(topic_name) as sender:
    sender.send_messages(ServiceBusMessage(json.dumps(order)))

# Subscribe
with client.get_subscription_receiver(topic_name, subscription_name) as receiver:
    for msg in receiver:
        process_message(msg)
        receiver.complete_message(msg)
```

## Subscription Filters

```sql
-- SQL Filter: Only high-value orders
Amount > 1000

-- Correlation Filter: By order type
sys.Subject = 'priority-order'
```

## Dead Letter Queue

```python
# Receive from dead letter queue
dlq_receiver = client.get_queue_receiver(
    queue_name,
    sub_queue=ServiceBusSubQueue.DEAD_LETTER
)

for msg in dlq_receiver:
    print(f"Dead letter reason: {msg.dead_letter_reason}")
    print(f"Error: {msg.dead_letter_error_description}")
```

## Session-Based Processing

For ordered, grouped message processing:

```python
# Send with session
message = ServiceBusMessage(data, session_id="customer-123")
sender.send_messages(message)

# Receive by session
session_receiver = client.get_queue_receiver(queue_name, session_id="customer-123")
```

Service Bus is the backbone of reliable, decoupled architectures on Azure.
