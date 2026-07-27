---
title: "Azure Web PubSub: Native WebSocket at Scale"
author: Michael John Peña
draft: false
date: 2022-06-25
tags:
  - azure
  - pubsub
  - websocket
  - real-time

---

I wrote "Azure Web PubSub: Native WebSocket at Scale" to share practical, production-minded guidance on this topic.

## Service Creation

```bash
az webpubsub create \
    --resource-group myResourceGroup \
    --name myWebPubSub \
    --location eastus \
    --sku Standard_S1
```

## Server-Side Messaging

```csharp
using Azure.Messaging.WebPubSub;

var serviceClient = new WebPubSubServiceClient(connectionString, "notifications");

// Broadcast to all
await serviceClient.SendToAllAsync("System maintenance in 5 minutes");

// Send to user
await serviceClient.SendToUserAsync("user123", JsonSerializer.Serialize(new
{
    type = "notification",
    message = "You have a new message"
}));

// Send to group
await serviceClient.AddUserToGroupAsync("group1", "user123");
await serviceClient.SendToGroupAsync("group1", "Group update");
```

## Event Handler

```csharp
[Function("webpubsub")]
public async Task<WebPubSubEventResponse> Run(
    [WebPubSubTrigger("notifications", WebPubSubEventType.User, "message")]
    UserEventRequest request)
{
    // Process incoming message
    var message = request.DataType == WebPubSubDataType.Text
        ? request.Data.ToString()
        : Convert.ToBase64String(request.Data.ToArray());

    // Echo back
    return request.CreateResponse(
        $"Received: {message}",
        WebPubSubDataType.Text);
}
```

## Client Connection

```typescript
const ws = new WebSocket(clientAccessUrl);

ws.onopen = () => {
    console.log('Connected to Web PubSub');
    ws.send(JSON.stringify({
        type: 'joinGroup',
        group: 'notifications'
    }));
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Message:', data);
};
```

## Summary

Azure Web PubSub offers native WebSocket support with powerful server-side messaging APIs, ideal for IoT, gaming, and collaboration apps.


