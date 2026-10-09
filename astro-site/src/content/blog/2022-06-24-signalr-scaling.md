---
title: "SignalR Scaling: Building Scalable Real-Time Applications"
author: Michael John Peña
draft: false
date: 2022-06-24
tags:
  - SignalR
  - Azure
  - Real-Time
  - Scaling
---

## Azure SignalR Service Setup

```bash
az signalr create \
    --resource-group myResourceGroup \
    --name mySignalR \
    --sku Standard_S1 \
    --unit-count 1 \
    --service-mode Default
```

## Hub Implementation

```csharp
public class ChatHub : Hub
{
    public async Task SendMessage(string user, string message)
    {
        await Clients.All.SendAsync("ReceiveMessage", user, message);
    }

    public async Task JoinGroup(string groupName)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, groupName);
        await Clients.Group(groupName).SendAsync("UserJoined", Context.User?.Identity?.Name);
    }

    public async Task SendToGroup(string groupName, string message)
    {
        await Clients.Group(groupName).SendAsync("ReceiveMessage", message);
    }

    public override async Task OnConnectedAsync()
    {
        await base.OnConnectedAsync();
        await Clients.All.SendAsync("UserConnected", Context.ConnectionId);
    }
}
```

## Configuration

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR()
    .AddAzureSignalR(options =>
    {
        options.ConnectionString = builder.Configuration["Azure:SignalR:ConnectionString"];
    });

var app = builder.Build();

app.MapHub<ChatHub>("/chatHub");
```

## Client Connection

```typescript
import * as signalR from '@microsoft/signalr';

const connection = new signalR.HubConnectionBuilder()
    .withUrl('/chatHub')
    .withAutomaticReconnect()
    .build();

connection.on('ReceiveMessage', (user, message) => {
    console.log(`${user}: ${message}`);
});

await connection.start();
await connection.invoke('SendMessage', 'User1', 'Hello!');
```

## Summary

Azure SignalR Service scales real-time applications effortlessly, handling millions of connections with automatic load balancing.
