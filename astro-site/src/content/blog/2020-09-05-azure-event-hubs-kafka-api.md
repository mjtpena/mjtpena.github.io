---
title: "Azure Event Hubs with Kafka API"
author: Michael John Peña
draft: false
date: 2020-09-05
tags:
  - Azure
  - Event Hubs
  - Kafka
  - Streaming

---

I wrote "Azure Event Hubs with Kafka API" to share practical, production-minded guidance on this topic.

## Configuration

```python
from kafka import KafkaProducer, KafkaConsumer

# Event Hubs connection as Kafka
bootstrap_servers = "mynamespace.servicebus.windows.net:9093"
sasl_username = "$ConnectionString"
sasl_password = "Endpoint=sb://mynamespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=..."

producer = KafkaProducer(
    bootstrap_servers=bootstrap_servers,
    security_protocol="SASL_SSL",
    sasl_mechanism="PLAIN",
    sasl_plain_username=sasl_username,
    sasl_plain_password=sasl_password,
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)

# Send message
producer.send('my-topic', {'event': 'order_created', 'order_id': '12345'})
producer.flush()
```

## Consumer Example

```python
consumer = KafkaConsumer(
    'my-topic',
    bootstrap_servers=bootstrap_servers,
    security_protocol="SASL_SSL",
    sasl_mechanism="PLAIN",
    sasl_plain_username=sasl_username,
    sasl_plain_password=sasl_password,
    group_id='my-consumer-group',
    auto_offset_reset='earliest'
)

for message in consumer:
    print(f"Received: {message.value}")
```

## Why Use This?

- Migrate Kafka workloads to Azure without code changes
- Use existing Kafka tooling and libraries
- Get Event Hubs benefits: scaling, retention, capture to blob

The Kafka API compatibility makes Event Hubs a drop-in replacement for many streaming scenarios.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
