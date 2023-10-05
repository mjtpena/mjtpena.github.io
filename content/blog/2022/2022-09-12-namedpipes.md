---
title: "Using named pipes for interprocess communication in C#"
author: Michael John Peña
draft: false
date: 2022-09-12
image: /2022/09/namedpipes-featured.png
url: /blog/namedpipes/
tags:
  - csharp
  - dotnet
  - pipe
  - messaging
---

There are multiple ways applications can communicate to each other. You can use HTTP, gRPC, gRPC, web sockets, shared databases, message brokers (and buses), and the list goes on. One of the overlooked fundamentals is the use of Pipes and Streams.

**Pipes** - a communication channel between two processes.

**Streams** - a data collection that moves from a source to a destination.

Just think of the actual 'pipe' where water flows. The actual pipe is the infrastructure to hold the water stream. The stream is what moves the water from point A to point B via gravity and force. In some regards, they are also considered 'queues' as it serves as a messaging layer between a publisher and a subscriber. They are not mutually exclusive, as streams can exist without pipes.

Dotnet supports [pipe operations](https://docs.microsoft.com/en-us/dotnet/standard/io/pipe-operations) out of the box. It supports both anonymous and named pipes. An anonymous pipe can be used if you want to just communicate within the local computer and the interaction is one-way. While named pipes can be used to communicate between a _pipe server_ and multiple _pipe clients_. Named pipes support in-out flow, meaning a client can also push a message back to the server.

## Why use Named Pipes?

- If you want a simple way of sending messages from processes A to process B either within the same host or network.
- Processes where the server and clients are known.
- Supports for both asynchronous and synchronous operations.

## When not to use Named Pipes?

- A mobile client communicating to the backend.
- If you need to persist or store data / messages.
- If you have a complex network infrastructure.

## Example

This code is in [GitHub](https://github.com/mjtpena/NamedPipeSample).

I created two dotnet worker projects. The first one will serve as a server, then the other will serve as a client.

### Named Pipe Server

First is to create the NamedPipeServerStream.

```csharp
await using var pipeServer = new NamedPipeServerStream("testpipe", PipeDirection.Out);
```

Notes:

- testpipe is the named pipe name. This is the identifier for your pipe.
- PipeDirection.Out means that it only sends out messages and not receiving.

Second is to wait for a client to connect in order to establish a pipe.

```csharp
await pipeServer.WaitForConnectionAsync();
```

Then use stream writer to publish messages to the pipe. It's also optional if you want to set autoflush (meaning remove the data stream) when a new data comes in.

```csharp
await using var sw = new StreamWriter(pipeServer);
sw.AutoFlush = true;
```

Lastly, pass the data that you want to publish to the pipe. In this case it's reading an input from the console. But in your scenario, it could probably be a variable that you want to pass in.

```csharp
sw.WriteLine(Console.ReadLine());
```

Full code can be [found here](https://github.com/mjtpena/NamedPipeSample/blob/main/NamedPipeServerService/Worker.cs).

### Named Pipe Client

Next is to have a client to consume the pipe. First is to create an instance of a pipe client.

```csharp
await using var pipeClient = new NamedPipeClientStream(".", "testpipe", PipeDirection.In);
```

Notes:

- "." is the _server_ name. A dot means it's within the same host.
- _testpipe_ is the named pipe (same as what you used in the server).
- _PipeDirection.In_ means that it's only accepting messages and not sending back to the server.

Then connect to the pipe server. Note that the server can't start pushing messages if there is no client connected to the pipe yet. A pipe requires to have an in and out.

```csharp
pipeClient.Connect();
```

Display the messages from the pipe server using a stream reader.

```csharp
using var sr = new StreamReader(pipeClient);
string? temp;
while ((temp = sr.ReadLine()) != null)
{
	_logger.LogInformation("Received from server: {0}", temp);
}
```

The full source can be [found here](https://github.com/mjtpena/NamedPipeSample/blob/main/NamedPipeClientService/Worker.cs#L20).

Run them side by side by using `dotnet run` or in Visual Studio / VS Code.

![img](/2022/09/dotnet-namedpipe.png)

As you can see on the left (server) you can type in a message and the right (client) receives the message and displays it.

## Summary

- Named Pipes is a simple way to communicate across processes.
- It's not designed to store data. Use a messaging queue like Kafka or RabbitMQ.
- If you have mobile clients such as mobile and websites, use HTTP, gRPC, and web sockets instead.

---

References:

- [NamedPipeServerStream Class (System.IO.Pipes) | Microsoft Docs](https://docs.microsoft.com/en-us/dotnet/api/system.io.pipes.namedpipeserverstream?view=net-6.0)
- [NamedPipeClientStream Class (System.IO.Pipes) | Microsoft Docs](https://docs.microsoft.com/en-us/dotnet/api/system.io.pipes.namedpipeclientstream?view=net-6.0)
