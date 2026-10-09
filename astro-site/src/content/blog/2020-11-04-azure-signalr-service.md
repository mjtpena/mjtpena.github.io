---
title: "Azure SignalR Service: Real-Time Web at Scale"
description: "SignalR Service: real-time made scalable."
author: Michael John Peña
draft: false
date: 2020-11-04
tags:
  - Azure
  - SignalR
  - Real-Time
  - WebSockets
---

## Creating SignalR Service

```bash
az signalr create \
    --name mysignalr \
    --resource-group myRG \
    --sku Standard_S1 \
    --unit-count 1 \
    --service-mode Default
```

## Server-Side Hub

```csharp
// Startup.cs
public void ConfigureServices(IServiceCollection services)
{
    services.AddSignalR()
            .AddAzureSignalR("Endpoint=https://mysignalr.service.signalr.net;AccessKey=xxx;Version=1.0;");
}

public void Configure(IApplicationBuilder app)
{
    app.UseRouting();
    app.UseEndpoints(endpoints =>
    {
        endpoints.MapHub<ChatHub>("/chat");
    });
}
```

```csharp
// ChatHub.cs
public class ChatHub : Hub
{
    public async Task SendMessage(string user, string message)
    {
        await Clients.All.SendAsync("ReceiveMessage", user, message);
    }

    public async Task JoinGroup(string groupName)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, groupName);
        await Clients.Group(groupName).SendAsync("UserJoined", Context.User.Identity.Name);
    }

    public async Task SendToGroup(string groupName, string message)
    {
        await Clients.Group(groupName).SendAsync("ReceiveMessage", Context.User.Identity.Name, message);
    }

    public override async Task OnConnectedAsync()
    {
        await Clients.All.SendAsync("UserConnected", Context.ConnectionId);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception exception)
    {
        await Clients.All.SendAsync("UserDisconnected", Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }
}
```

## JavaScript Client

```javascript
import * as signalR from "@microsoft/signalr";

const connection = new signalR.HubConnectionBuilder()
    .withUrl("/chat")
    .withAutomaticReconnect()
    .build();

connection.on("ReceiveMessage", (user, message) => {
    console.log(`${user}: ${message}`);
    displayMessage(user, message);
});

connection.on("UserJoined", (user) => {
    console.log(`${user} joined`);
});

async function start() {
    try {
        await connection.start();
        console.log("Connected");
    } catch (err) {
        console.error(err);
        setTimeout(start, 5000);
    }
}

connection.onclose(start);
start();

// Send message
async function sendMessage(message) {
    await connection.invoke("SendMessage", currentUser, message);
}
```

## Serverless Mode (Azure Functions)

```csharp
// Negotiate function
[FunctionName("negotiate")]
public static SignalRConnectionInfo Negotiate(
    [HttpTrigger(AuthorizationLevel.Anonymous, "post")] HttpRequest req,
    [SignalRConnectionInfo(HubName = "chat", UserId = "{headers.x-ms-client-principal-id}")] SignalRConnectionInfo connectionInfo)
{
    return connectionInfo;
}

// Broadcast function
[FunctionName("broadcast")]
public static async Task Broadcast(
    [HttpTrigger(AuthorizationLevel.Anonymous, "post")] object message,
    [SignalR(HubName = "chat")] IAsyncCollector<SignalRMessage> signalRMessages)
{
    await signalRMessages.AddAsync(new SignalRMessage
    {
        Target = "ReceiveMessage",
        Arguments = new[] { message }
    });
}

// Send to specific user
[FunctionName("sendToUser")]
public static async Task SendToUser(
    [HttpTrigger] dynamic data,
    [SignalR(HubName = "chat")] IAsyncCollector<SignalRMessage> signalRMessages)
{
    await signalRMessages.AddAsync(new SignalRMessage
    {
        UserId = data.userId,
        Target = "ReceiveMessage",
        Arguments = new[] { data.message }
    });
}
```

## Authentication

```csharp
// Add authentication to connection
services.AddSignalR()
    .AddAzureSignalR(options =>
    {
        options.ConnectionString = "...";
        options.ClaimsProvider = context => new[]
        {
            new Claim(ClaimTypes.NameIdentifier, context.Request.Query["userId"])
        };
    });
```

## Scaling

```bash
# Scale units
az signalr update \
    --name mysignalr \
    --resource-group myRG \
    --unit-count 5
```

| Units | Connections | Messages/sec |
|-------|-------------|--------------|
| 1 | 1,000 | 1M |
| 5 | 5,000 | 5M |
| 10 | 10,000 | 10M |
| 100 | 100,000 | 100M |

SignalR Service: real-time made scalable.
