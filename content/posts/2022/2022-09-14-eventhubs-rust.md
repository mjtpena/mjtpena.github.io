---
title: "Publishing and Consuming Azure Event Hubs with AMQP and Rust"
author: MJ Peña
draft: false
date: 2022-09-14
image: /2022/09/eventhubs-rust.png
url: /blog/eventhubs-rust/
tags:
  - rust
  - eventhubs
  - azure
  - amqp
---

Rust has been gaining a lot of traction lately. Being in the Blockchain space, a lot of chains such as Solana uses Rust to develop smart contracts. There's also an increase adoption of it in regards to high performance, memory safety, and concurrency benefits to name a few. In my opinion, it's still a niche market (in terms of size) from both Companies' adoption and the availability of talent out there. But I'm lucky enough to work on a low-level programming project.

In one of the small projects I'm working on Rust, I actually need to send huge amount of messages on to the cloud and Azure Event Hubs is my preferred choice for this solution. This is because I've used Kafka in the past, and the managed aspect of partitioning and scalability of it, is something I really like about Event Hubs. Not to mention, once it's in Event Hubs; I can pretty much fan-out the messages to other Azure services.

## Kafka Client

I know that under the hood, Azure Event Hubs is actually a managed Kafka service, and so I tried to look at various Kafka clients for Rust:

[**kafka-rust**](https://github.com/kafka-rust/kafka-rust)

The problem I faced is that, it doesn't support Kerberos and SASL authentication yet, and so that means I can't use it to consume Azure Event Hubs topic.

[**rust-rdkafka**](https://github.com/fede1024/rust-rdkafka)

I followed [Adrian's Blog](https://www.adrians-blog.com/articles/software/2021/12/08/azure-eventhubs-in-rust/#:~:text=Azure%20EventHubs%20is%20built%20upon%20the%20AMQP%201.0,one%20naturally%20googles%20AMQP%201.0%20implementations%20for%20Rust.) and I actually made it work. After further tinkering, I found out that rust-rdkafka is just a wrapper of the C based library [librdkafka](https://github.com/edenhill/librdkafka). So in some ways, it defeats the purpose of using pure Rust as it brings a management overhead in the long run.

## AMQP 1.0

Then I realized that Kafka itself uses [AMQP 1.0](https://www.oasis-open.org/news/pr/iso-and-iec-approve-oasis-amqp-advanced-message-queuing-protocol/)! AMQP is a protocol that is used by other popular messaging platforms as well such as [Microsoft Azure Service Bus](https://azure.microsoft.com/en-au/services/service-bus/#overview) and [RabbitMQ](https://www.rabbitmq.com/). So this ultimately means that publishing and consuming messages from Azure Event Hubs using AMQP will work.

There are a lot of libraries in Rust to explore:

- [**rust-amqp**](https://github.com/Antti/rust-amqp) (not maintained)
- [**dove**](https://github.com/lulf/dove) (lacks SASL)
- [**lapin**](https://github.com/amqp-rs/lapin) (close but I have to create the Event Hubs decorator)

The least option that I want to do is to actually implement a barebones AMQP from [**Tokio**](https://github.com/tokio-rs/tokio). Tokio is a way to use Asynchronous [TCP and UDP](https://docs.rs/tokio/latest/tokio/net/index.html) sockets for I/O. A lot of these pub/sub or messaging rust libraries are using Tokio.

Until I found this gem: [**fe2o3-amqp**](https://github.com/minghuaw/fe2o3-amqp/tree/main/fe2o3-amqp "fe2o3-amqp"). This library is A rust implementation of AMQP 1.0 protocol based on serde and tokio.

## It's Rustin' Time!

Clone the repository and go to this [example](https://github.com/minghuaw/fe2o3-amqp/tree/main/examples/event_hubs).

On the same folder, create a **.env** file like this:

```env
HOST_NAME=mjp-eh-namespace.servicebus.windows.net
SHARED_ACCESS_KEY_NAME=RootManageSharedAccessKey
SHARED_ACCESS_KEY_VALUE=1C42sN4Z9Mgvl151EpKRcN9KLpFTdXKDX0YD8XbJ/IA=
EVENT_HUB_NAME=ehtopic
```

Note: It turns out, you don't need to put the port 9093 in the host name.

![](/2022/09/eventhubs-rust-env.png)

Run the following commands:

`cargo run --bin simple_sender`

`cargo run --bin simple_receiver`

![](/2022/09/eventhubs-rust-bin.png)

🙌 Congratulations! You were able to send and receive Event Hubs messages using Rust.

### 👀 Looking at the code

Some important bits to investigate (and manipulate) on the code.

The connection is actually secured using the SASL profile that you have in the environment file. It also uses TcpStreams from Tokio to establish secured connection in transit.

```rust
    let mut connection = Connection::builder()
        .container_id("rust-connection-1")
        .hostname(&hostname[..])
        .sasl_profile(SaslProfile::Plain {
            username: sa_key_name,
            password: sa_key_value,
        })
        .open_with_stream(tls_stream)
        .await
        .unwrap();
```

You then establish the session and sender (or receiver) object.

```rust
    let mut session = Session::begin(&mut connection).await.unwrap();
    let mut sender = Sender::attach(&mut session, "rust-simple-sender", event_hub_name)
        .await
        .unwrap();
```

You can edit these part of the code to send different messages. Notice that messages are parsed in to bytes before sending it to the Event Hubs.

```rust
    // Message will be randomly distributed to different partitions
    for i in 0..3 {
        // All of the Microsoft AMQP clients represent the event body as an uninterpreted bag of bytes.
        let data = format!("Message {}", i).into_bytes();
        let message = Message::builder()
            .properties(
                Properties::builder()
                    .group_id(String::from("send_to_event_hub"))
                    .build(),
            )
            .data(Binary::from(data))
            .build();

        let outcome = sender.send(message).await.unwrap();
        outcome.accepted_or_else(|outcome| outcome).unwrap();
    }
```

The sender (or receiver) object is flushed, as well as the session and connection.

```rust
    sender.close().await.unwrap();
    session.end().await.unwrap();
    connection.close().await.unwrap();
```

Note that in some scenarios you may not need to open/close the connections as you might want to keep the connection open as the publisher keeps on sending messages.

### Bonus

As I was exploring this space, I also noticed that there's an [unofficial Azure SDK for Rust](https://github.com/Azure/azure-sdk-for-rust)! Maybe in the future Microsoft will support more Rust SDKs specially on the messaging side.

## Summary

- Azure Event Hubs is a managed Kafka and uses AMQP 1.0 under the hood. Any AMQP 1.0 library in any language, should allow you to send and receive messages.
- [fe2o3-amqp](https://github.com/minghuaw/fe2o3-amqp/tree/main/fe2o3-amqp "fe2o3-amqp") is a Rust library to consume and produce events from Azure Event Hubs.

---

References:

- [Overview of features - Azure Event Hubs - Azure Event Hubs | Microsoft Docs](https://docs.microsoft.com/en-us/azure/event-hubs/event-hubs-features)
- [Home | AMQP](https://www.amqp.org/)
- [fe2o3-amqp/fe2o3-amqp at main · minghuaw/fe2o3-amqp (github.com)](https://github.com/minghuaw/fe2o3-amqp/tree/main/fe2o3-amqp)
