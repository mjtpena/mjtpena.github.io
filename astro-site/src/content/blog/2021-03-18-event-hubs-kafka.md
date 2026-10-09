---
title: Using Azure Event Hubs with Kafka Protocol
author: Michael John Pena
draft: false
date: 2021-03-18
url: /blog/event-hubs-kafka/
tags:
  - Azure
  - Event Hubs
  - Kafka
  - Streaming
  - Messaging
---

## Why Event Hubs for Kafka?

Event Hubs with Kafka protocol offers:
- No Kafka cluster management
- Automatic scaling
- 99.99% SLA
- Native Azure integration
- Pay-per-throughput pricing

## Setting Up Event Hubs for Kafka

```bash
# Create Event Hubs namespace with Kafka enabled (Standard tier or above)
az eventhubs namespace create \
    --name myeventhubs \
    --resource-group myResourceGroup \
    --location eastus \
    --sku Standard \
    --enable-kafka true

# Create an Event Hub (Kafka topic)
az eventhubs eventhub create \
    --name my-kafka-topic \
    --namespace-name myeventhubs \
    --resource-group myResourceGroup \
    --partition-count 4 \
    --message-retention 7

# Get connection string
az eventhubs namespace authorization-rule keys list \
    --resource-group myResourceGroup \
    --namespace-name myeventhubs \
    --name RootManageSharedAccessKey \
    --query primaryConnectionString \
    --output tsv
```

## Kafka Producer Configuration

### Python Producer

```python
from confluent_kafka import Producer
import json
import ssl

# Event Hubs Kafka configuration
config = {
    'bootstrap.servers': 'myeventhubs.servicebus.windows.net:9093',
    'security.protocol': 'SASL_SSL',
    'sasl.mechanism': 'PLAIN',
    'sasl.username': '$ConnectionString',
    'sasl.password': 'Endpoint=sb://myeventhubs.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=xxxxx',
    'client.id': 'python-producer',
    'acks': 'all',
    'retries': 5,
    'retry.backoff.ms': 500,
    'linger.ms': 100,
    'batch.size': 16384
}

producer = Producer(config)

def delivery_callback(err, msg):
    if err:
        print(f'Message delivery failed: {err}')
    else:
        print(f'Message delivered to {msg.topic()} [{msg.partition()}] at offset {msg.offset()}')

# Produce messages
topic = 'my-kafka-topic'

for i in range(100):
    message = {
        'event_id': f'event-{i}',
        'timestamp': '2021-03-18T10:30:00Z',
        'value': i * 1.5,
        'sensor_id': f'sensor-{i % 10}'
    }

    # Use sensor_id as key for partitioning
    key = message['sensor_id'].encode('utf-8')
    value = json.dumps(message).encode('utf-8')

    producer.produce(
        topic,
        key=key,
        value=value,
        callback=delivery_callback
    )

    # Trigger delivery callbacks
    producer.poll(0)

# Wait for all messages to be delivered
producer.flush()
print('All messages delivered')
```

### Java Producer

```java
import org.apache.kafka.clients.producer.*;
import org.apache.kafka.common.serialization.StringSerializer;
import java.util.Properties;

public class EventHubsKafkaProducer {

    public static void main(String[] args) {
        Properties props = new Properties();

        // Event Hubs connection
        String connectionString = System.getenv("EVENTHUBS_CONNECTION_STRING");
        String bootstrapServers = "myeventhubs.servicebus.windows.net:9093";

        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put("security.protocol", "SASL_SSL");
        props.put("sasl.mechanism", "PLAIN");
        props.put("sasl.jaas.config",
            "org.apache.kafka.common.security.plain.PlainLoginModule required " +
            "username=\"$ConnectionString\" " +
            "password=\"" + connectionString + "\";");

        // Serialization
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());

        // Performance tuning
        props.put(ProducerConfig.ACKS_CONFIG, "all");
        props.put(ProducerConfig.RETRIES_CONFIG, 5);
        props.put(ProducerConfig.LINGER_MS_CONFIG, 100);
        props.put(ProducerConfig.BATCH_SIZE_CONFIG, 16384);

        try (KafkaProducer<String, String> producer = new KafkaProducer<>(props)) {
            String topic = "my-kafka-topic";

            for (int i = 0; i < 100; i++) {
                String key = "sensor-" + (i % 10);
                String value = String.format(
                    "{\"event_id\":\"event-%d\",\"value\":%.2f,\"timestamp\":\"%s\"}",
                    i, i * 1.5, java.time.Instant.now()
                );

                ProducerRecord<String, String> record = new ProducerRecord<>(topic, key, value);

                producer.send(record, (metadata, exception) -> {
                    if (exception != null) {
                        System.err.println("Error: " + exception.getMessage());
                    } else {
                        System.out.printf("Sent to partition %d, offset %d%n",
                            metadata.partition(), metadata.offset());
                    }
                });
            }

            producer.flush();
        }
    }
}
```

## Kafka Consumer Configuration

### Python Consumer

```python
from confluent_kafka import Consumer, KafkaError, KafkaException
import json

config = {
    'bootstrap.servers': 'myeventhubs.servicebus.windows.net:9093',
    'security.protocol': 'SASL_SSL',
    'sasl.mechanism': 'PLAIN',
    'sasl.username': '$ConnectionString',
    'sasl.password': 'Endpoint=sb://myeventhubs.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=xxxxx',
    'group.id': 'my-consumer-group',
    'auto.offset.reset': 'earliest',
    'enable.auto.commit': False,
    'max.poll.interval.ms': 300000,
    'session.timeout.ms': 30000
}

consumer = Consumer(config)

def process_message(msg):
    """Process a single message."""
    try:
        key = msg.key().decode('utf-8') if msg.key() else None
        value = json.loads(msg.value().decode('utf-8'))

        print(f"Partition: {msg.partition()}, Offset: {msg.offset()}")
        print(f"Key: {key}")
        print(f"Value: {value}")

        # Your business logic here
        return True
    except Exception as e:
        print(f"Error processing message: {e}")
        return False

def consume_messages():
    """Main consumer loop."""
    consumer.subscribe(['my-kafka-topic'])

    try:
        while True:
            msg = consumer.poll(timeout=1.0)

            if msg is None:
                continue

            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    print(f'Reached end of partition {msg.partition()}')
                else:
                    raise KafkaException(msg.error())
            else:
                if process_message(msg):
                    # Commit offset after successful processing
                    consumer.commit(msg)

    except KeyboardInterrupt:
        print('Shutting down...')
    finally:
        consumer.close()

if __name__ == '__main__':
    consume_messages()
```

### Consumer Group with Multiple Partitions

```python
from confluent_kafka import Consumer, TopicPartition
import threading
import json

class PartitionConsumer(threading.Thread):
    def __init__(self, config, topic, partition):
        super().__init__()
        self.config = config.copy()
        self.config['group.id'] = f'consumer-group-p{partition}'
        self.topic = topic
        self.partition = partition
        self.running = True

    def run(self):
        consumer = Consumer(self.config)
        tp = TopicPartition(self.topic, self.partition)
        consumer.assign([tp])

        while self.running:
            msg = consumer.poll(timeout=1.0)
            if msg is None:
                continue
            if msg.error():
                print(f"Error in partition {self.partition}: {msg.error()}")
                continue

            value = json.loads(msg.value().decode('utf-8'))
            print(f"P{self.partition}: {value}")

        consumer.close()

    def stop(self):
        self.running = False

# Start consumers for each partition
base_config = {
    'bootstrap.servers': 'myeventhubs.servicebus.windows.net:9093',
    'security.protocol': 'SASL_SSL',
    'sasl.mechanism': 'PLAIN',
    'sasl.username': '$ConnectionString',
    'sasl.password': 'your-connection-string',
    'auto.offset.reset': 'earliest'
}

consumers = []
for partition in range(4):
    c = PartitionConsumer(base_config, 'my-kafka-topic', partition)
    c.start()
    consumers.append(c)

# Wait and stop
import time
time.sleep(60)
for c in consumers:
    c.stop()
    c.join()
```

## Spring Boot Integration

```yaml
# application.yml
spring:
  kafka:
    bootstrap-servers: myeventhubs.servicebus.windows.net:9093
    properties:
      security.protocol: SASL_SSL
      sasl.mechanism: PLAIN
      sasl.jaas.config: >
        org.apache.kafka.common.security.plain.PlainLoginModule required
        username="$ConnectionString"
        password="${EVENTHUBS_CONNECTION_STRING}";
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
      acks: all
    consumer:
      group-id: spring-consumer-group
      auto-offset-reset: earliest
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.springframework.kafka.support.serializer.JsonDeserializer
      properties:
        spring.json.trusted.packages: "*"
```

```java
// Producer Service
@Service
public class EventProducer {

    private final KafkaTemplate<String, Event> kafkaTemplate;

    @Autowired
    public EventProducer(KafkaTemplate<String, Event> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    public void sendEvent(Event event) {
        kafkaTemplate.send("my-kafka-topic", event.getSensorId(), event)
            .addCallback(
                result -> System.out.println("Sent: " + event.getEventId()),
                ex -> System.err.println("Failed: " + ex.getMessage())
            );
    }
}

// Consumer Service
@Service
public class EventConsumer {

    @KafkaListener(topics = "my-kafka-topic", groupId = "spring-consumer-group")
    public void consume(Event event, @Header(KafkaHeaders.RECEIVED_PARTITION_ID) int partition) {
        System.out.printf("Received from partition %d: %s%n", partition, event);
        // Process event
    }
}
```

## Schema Registry Integration

```python
from confluent_kafka.schema_registry import SchemaRegistryClient
from confluent_kafka.schema_registry.avro import AvroSerializer, AvroDeserializer
from confluent_kafka import Producer, Consumer

# Schema Registry configuration (use Azure Schema Registry or Confluent Cloud)
schema_registry_conf = {
    'url': 'https://your-schema-registry.azure.net',
    'basic.auth.user.info': 'client-id:client-secret'
}

schema_registry_client = SchemaRegistryClient(schema_registry_conf)

# Avro schema
event_schema = """
{
  "type": "record",
  "name": "Event",
  "namespace": "com.example",
  "fields": [
    {"name": "event_id", "type": "string"},
    {"name": "timestamp", "type": "string"},
    {"name": "sensor_id", "type": "string"},
    {"name": "value", "type": "double"}
  ]
}
"""

# Create serializer/deserializer
avro_serializer = AvroSerializer(schema_registry_client, event_schema)
avro_deserializer = AvroDeserializer(schema_registry_client, event_schema)

# Producer with Avro
producer_conf = {
    'bootstrap.servers': 'myeventhubs.servicebus.windows.net:9093',
    'security.protocol': 'SASL_SSL',
    'sasl.mechanism': 'PLAIN',
    'sasl.username': '$ConnectionString',
    'sasl.password': 'your-connection-string'
}

producer = Producer(producer_conf)

event = {
    'event_id': 'evt-001',
    'timestamp': '2021-03-18T10:00:00Z',
    'sensor_id': 'sensor-1',
    'value': 23.5
}

producer.produce(
    'my-kafka-topic',
    key='sensor-1'.encode('utf-8'),
    value=avro_serializer(event, None)
)
producer.flush()
```

## Monitoring and Metrics

```bash
# Consumer group lag monitoring
from confluent_kafka.admin import AdminClient, ConsumerGroupTopicPartitions

admin = AdminClient({
    'bootstrap.servers': 'myeventhubs.servicebus.windows.net:9093',
    'security.protocol': 'SASL_SSL',
    'sasl.mechanism': 'PLAIN',
    'sasl.username': '$ConnectionString',
    'sasl.password': 'your-connection-string'
})

# List consumer groups
groups = admin.list_consumer_groups()
print(f"Consumer groups: {groups}")

# Get consumer group offsets
offsets = admin.list_consumer_group_offsets([
    ConsumerGroupTopicPartitions('my-consumer-group')
])
```

## Conclusion

Event Hubs with Kafka protocol provides:
- **Zero operational overhead**: No ZooKeeper, no broker management
- **Seamless migration**: Minimal code changes from existing Kafka apps
- **Enterprise security**: Azure AD integration and network isolation
- **Cost efficiency**: Pay only for what you use

For teams with Kafka expertise wanting to reduce operational burden, Event Hubs Kafka endpoint is an excellent choice.
