---
title: Building Real-Time Applications with Azure SignalR Service
author: Michael John Pena
draft: false
date: 2021-03-06
url: /blog/azure-signalr-realtime/
tags:
  - Azure
  - SignalR
  - Real-Time
  - WebSockets
  - Messaging
---

Azure Web PubSub is the lower-level real-time service that sits alongside SignalR. Where SignalR abstracts the transport and provides a hub model for your server code, Web PubSub is a pure WebSocket broker—you publish to groups, clients subscribe, the service fans out. Simpler contract, more flexibility in the client. I've used it where the client is not a .NET app and the SignalR client library is an awkward fit: Python microservices, IoT devices with custom clients, and real-time dashboards built on plain JavaScript WebSocket APIs without the SignalR SDK overhead.

## Why Azure SignalR Service?

Building real-time applications involves challenges:
- Managing thousands of WebSocket connections
- Scaling horizontally across servers
- Handling connection state and reconnection
- Load balancing persistent connections

Azure SignalR Service handles all of this, letting you focus on your application logic.

## SignalR Service Modes

Azure SignalR Service supports two modes:

### Default Mode
Your application server handles hub logic; SignalR Service manages connections:

```
Client <-> SignalR Service <-> Your Server (Hub Logic)
```

### Serverless Mode
Use Azure Functions to respond to messages; no persistent server needed:

```
Client <-> SignalR Service <-> Azure Functions (Event Handlers)
```

## Setting Up SignalR Service

```bash
# Create SignalR Service
az signalr create \
    --name mySignalR \
    --resource-group myResourceGroup \
    --location eastus \
    --sku Standard_S1 \
    --unit-count 1 \
    --service-mode Default

# Get connection string
az signalr key list \
    --name mySignalR \
    --resource-group myResourceGroup \
    --query primaryConnectionString \
    --output tsv
```

## Server-Side Implementation (ASP.NET Core)

### Configure Services

```csharp
// Program.cs or Startup.cs
public void ConfigureServices(IServiceCollection services)
{
    services.AddSignalR()
        .AddAzureSignalR(Configuration["Azure:SignalR:ConnectionString"]);

    services.AddCors(options =>
    {
        options.AddPolicy("CorsPolicy", builder =>
            builder.AllowAnyOrigin()
                   .AllowAnyMethod()
                   .AllowAnyHeader());
    });
}

public void Configure(IApplicationBuilder app)
{
    app.UseCors("CorsPolicy");
    app.UseRouting();

    app.UseEndpoints(endpoints =>
    {
        endpoints.MapHub<ChatHub>("/chat");
        endpoints.MapHub<NotificationHub>("/notifications");
    });
}
```

### Create a Hub

```csharp
using Microsoft.AspNetCore.SignalR;

public class ChatHub : Hub
{
    private readonly ILogger<ChatHub> _logger;

    public ChatHub(ILogger<ChatHub> logger)
    {
        _logger = logger;
    }

    public override async Task OnConnectedAsync()
    {
        _logger.LogInformation($"Client connected: {Context.ConnectionId}");
        await Clients.All.SendAsync("UserConnected", Context.ConnectionId);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception exception)
    {
        _logger.LogInformation($"Client disconnected: {Context.ConnectionId}");
        await Clients.All.SendAsync("UserDisconnected", Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    public async Task SendMessage(string user, string message)
    {
        _logger.LogInformation($"Message from {user}: {message}");
        await Clients.All.SendAsync("ReceiveMessage", user, message);
    }

    public async Task JoinGroup(string groupName)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, groupName);
        await Clients.Group(groupName).SendAsync("UserJoinedGroup", Context.ConnectionId, groupName);
    }

    public async Task LeaveGroup(string groupName)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, groupName);
        await Clients.Group(groupName).SendAsync("UserLeftGroup", Context.ConnectionId, groupName);
    }

    public async Task SendToGroup(string groupName, string user, string message)
    {
        await Clients.Group(groupName).SendAsync("ReceiveGroupMessage", user, message, groupName);
    }
}
```

### Sending Messages from Controllers

```csharp
[ApiController]
[Route("api/[controller]")]
public class NotificationsController : ControllerBase
{
    private readonly IHubContext<NotificationHub> _hubContext;

    public NotificationsController(IHubContext<NotificationHub> hubContext)
    {
        _hubContext = hubContext;
    }

    [HttpPost("broadcast")]
    public async Task<IActionResult> Broadcast([FromBody] NotificationMessage message)
    {
        await _hubContext.Clients.All.SendAsync("ReceiveNotification", message);
        return Ok();
    }

    [HttpPost("user/{userId}")]
    public async Task<IActionResult> SendToUser(string userId, [FromBody] NotificationMessage message)
    {
        await _hubContext.Clients.User(userId).SendAsync("ReceiveNotification", message);
        return Ok();
    }

    [HttpPost("group/{groupName}")]
    public async Task<IActionResult> SendToGroup(string groupName, [FromBody] NotificationMessage message)
    {
        await _hubContext.Clients.Group(groupName).SendAsync("ReceiveNotification", message);
        return Ok();
    }
}

public record NotificationMessage(string Title, string Body, string Type);
```

## Client-Side Implementation (JavaScript)

```javascript
// signalr-client.js
import * as signalR from "@microsoft/signalr";

class SignalRClient {
    constructor(hubUrl) {
        this.connection = new signalR.HubConnectionBuilder()
            .withUrl(hubUrl)
            .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
            .configureLogging(signalR.LogLevel.Information)
            .build();

        this.setupConnectionEvents();
    }

    setupConnectionEvents() {
        this.connection.onreconnecting(error => {
            console.log('Reconnecting...', error);
            this.onReconnecting?.(error);
        });

        this.connection.onreconnected(connectionId => {
            console.log('Reconnected:', connectionId);
            this.onReconnected?.(connectionId);
        });

        this.connection.onclose(error => {
            console.log('Connection closed:', error);
            this.onClosed?.(error);
        });
    }

    async start() {
        try {
            await this.connection.start();
            console.log('SignalR Connected');
            return true;
        } catch (err) {
            console.error('SignalR Connection Error:', err);
            // Retry after delay
            setTimeout(() => this.start(), 5000);
            return false;
        }
    }

    on(methodName, callback) {
        this.connection.on(methodName, callback);
    }

    off(methodName, callback) {
        this.connection.off(methodName, callback);
    }

    async invoke(methodName, ...args) {
        try {
            return await this.connection.invoke(methodName, ...args);
        } catch (err) {
            console.error(`Error invoking ${methodName}:`, err);
            throw err;
        }
    }

    async stop() {
        await this.connection.stop();
    }
}

// Usage
const chat = new SignalRClient('/chat');

chat.on('ReceiveMessage', (user, message) => {
    console.log(`${user}: ${message}`);
    // Update UI
});

chat.on('UserConnected', (connectionId) => {
    console.log(`User connected: ${connectionId}`);
});

await chat.start();
await chat.invoke('JoinGroup', 'general');
await chat.invoke('SendMessage', 'Alice', 'Hello everyone!');
```

## Serverless Mode with Azure Functions

Use SignalR Service with Azure Functions for event-driven real-time apps:

```csharp
// Negotiate function - returns connection info to clients
[FunctionName("negotiate")]
public static SignalRConnectionInfo Negotiate(
    [HttpTrigger(AuthorizationLevel.Anonymous, "post")] HttpRequest req,
    [SignalRConnectionInfo(HubName = "chat", UserId = "{headers.x-ms-client-principal-id}")]
    SignalRConnectionInfo connectionInfo)
{
    return connectionInfo;
}

// Send message function
[FunctionName("SendMessage")]
public static Task SendMessage(
    [HttpTrigger(AuthorizationLevel.Anonymous, "post")] HttpRequest req,
    [SignalR(HubName = "chat")] IAsyncCollector<SignalRMessage> signalRMessages)
{
    var message = await req.ReadFromJsonAsync<ChatMessage>();

    return signalRMessages.AddAsync(
        new SignalRMessage
        {
            Target = "ReceiveMessage",
            Arguments = new[] { message.User, message.Text }
        });
}

// Handle client messages
[FunctionName("OnMessage")]
public static void OnMessage(
    [SignalRTrigger("chat", "messages", "sendMessage")]
    InvocationContext invocationContext,
    string user,
    string message,
    ILogger logger)
{
    logger.LogInformation($"Message from {user}: {message}");
}
```

## Real-Time Dashboard Example

```csharp
// StockHub.cs
public class StockHub : Hub
{
    public async Task SubscribeToStock(string symbol)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, $"stock-{symbol}");
    }

    public async Task UnsubscribeFromStock(string symbol)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"stock-{symbol}");
    }
}

// StockPriceService.cs - Background service pushing updates
public class StockPriceService : BackgroundService
{
    private readonly IHubContext<StockHub> _hubContext;

    public StockPriceService(IHubContext<StockHub> hubContext)
    {
        _hubContext = hubContext;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var stocks = await GetLatestPricesAsync();

            foreach (var stock in stocks)
            {
                await _hubContext.Clients
                    .Group($"stock-{stock.Symbol}")
                    .SendAsync("StockUpdate", stock, stoppingToken);
            }

            await Task.Delay(1000, stoppingToken);
        }
    }
}
```

```javascript
// Dashboard client
const stockHub = new SignalRClient('/stocks');

stockHub.on('StockUpdate', (stock) => {
    updateStockDisplay(stock.symbol, stock.price, stock.change);
});

await stockHub.start();
await stockHub.invoke('SubscribeToStock', 'MSFT');
await stockHub.invoke('SubscribeToStock', 'AAPL');
```

## Scaling Considerations

Azure SignalR Service handles scaling automatically:

| Tier | Connections | Messages/day | Units |
|------|-------------|--------------|-------|
| Free | 20 | 20,000 | 1 |
| Standard | 1,000/unit | 1M/unit | 1-100 |

```bash
# Scale up units
az signalr update \
    --name mySignalR \
    --resource-group myResourceGroup \
    --unit-count 5
```

## Best Practices

1. **Use groups wisely** - Group related connections to reduce message fan-out
2. **Implement reconnection logic** - Use automatic reconnect in clients
3. **Handle connection lifecycle** - Clean up resources on disconnect
4. **Monitor with Azure Monitor** - Track connection counts and message rates
5. **Use authentication** - Secure your hubs with Azure AD or custom auth

## Conclusion

Azure SignalR Service removes the complexity of managing real-time infrastructure while providing enterprise-grade reliability and scale. Whether you're building chat applications, live dashboards, or collaborative tools, SignalR Service provides the foundation for real-time experiences.

## Resources

- [Azure SignalR Service Documentation](https://docs.microsoft.com/en-us/azure/azure-signalr/)
- [ASP.NET Core SignalR Documentation](https://docs.microsoft.com/en-us/aspnet/core/signalr/)
- [SignalR JavaScript Client](https://docs.microsoft.com/en-us/aspnet/core/signalr/javascript-client)
