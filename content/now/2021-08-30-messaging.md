---
title: "Messaging"
date: 2021-08-30T03:56:25Z
draft: false
---

Messaging is probably one of the most interesting topic in software for me. This is a state when a “message” is being sent from an origin to a destination. Traditionally, a user interface can directly call a backend service, and then that backend service goes straight in to inserting a record to a database. But that was like decades ago. Since then, a lot of improvements already happened. Messaging came to the rescue in order to handle millions and billions of concurrent transactions happening around. Imagine if you have millions of users of your application and would push messages all over the place. Your database and backend processing services won’t be able to do it.

A lot of these are now managed via cloud natives services. There are so many variations now depending on which use case are you looking at. However, there are still a lot of use case for local or bare metal implementation of this. This is where Kafka and RabbitMQ shine. They do support various topologies or techniques, such as Pub/Sub, Fan-Out, Streaming, and a lot more. It’s a topic of interest to me, because those individual messages could mean something to different people, but seeing them on a high level is just so fun to watch. Seeing millions and billions of transactions every day, it’s like seeing land traffic that is so smooth and seamless. 