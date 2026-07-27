---
title: Real-Time Web Applications with Azure SignalR Service
author: Michael John Pena
draft: false
date: 2021-03-05
url: /blog/azure-signalr-service/
tags:
  - Azure
  - SignalR
  - Real-Time
  - WebSockets
  - .NET
---

I've tried to roll my own WebSocket fanout exactly once. It worked beautifully for 200 concurrent connections and melted at 2,000. Azure SignalR Service exists so I never have to think about that problem again. Connection management, automatic reconnect handling, scale-out across multiple server instances, and transport negotiation (WebSockets → SSE → long polling) all managed by the service. You write the hub logic; SignalR handles the distribution. For real-time features like dashboards, collaborative editing, and notifications at scale, it's the right abstraction.

## What is Azure SignalR Service?

Azure SignalR Service is a fully managed real-time messaging service that allows you to:
- Push content to connected clients instantly
- Handle millions of concurrent connections
- Scale automatically without managing infrastructure
- Support multiple transports (WebSockets, Server-Sent Events, Long Polling)

## Creating Azure SignalR Service

```bash
# Create SignalR Service
az signalr create \
    --name mysignalr \
    --resource-group myResourceGroup \
    --location eastus \
    --sku Standard_S1 \
    --unit-count 1 \
    --service-mode Default

# Get connection string
az signalr key list \
    --name mysignalr \
    --resource-group myResourceGroup \
    --query primaryConnectionString \
    --output tsv
```

## Building a Chat Application

### Server-Side (.NET)

Create a new ASP.NET Core application:

```bash
dotnet new web -n SignalRChat
cd SignalRChat
dotnet add package Microsoft.Azure.SignalR
```

Create the Hub:

```csharp
// Hubs/ChatHub.cs
using Microsoft.AspNetCore.SignalR;

public class ChatHub : Hub
{
    public async Task SendMessage(string user, string message)
    {
        await Clients.All.SendAsync("ReceiveMessage", user, message);
    }

    public async Task JoinGroup(string groupName)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, groupName);
        await Clients.Group(groupName).SendAsync("UserJoined",
            $"User {Context.ConnectionId} joined {groupName}");
    }

    public async Task SendToGroup(string groupName, string user, string message)
    {
        await Clients.Group(groupName).SendAsync("ReceiveMessage", user, message);
    }

    public async Task SendPrivateMessage(string connectionId, string message)
    {
        await Clients.Client(connectionId).SendAsync("ReceivePrivateMessage", message);
    }

    public override async Task OnConnectedAsync()
    {
        await Clients.All.SendAsync("UserConnected", Context.ConnectionId);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await Clients.All.SendAsync("UserDisconnected", Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }
}
```

Configure the application:

```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);

// Add Azure SignalR Service
builder.Services.AddSignalR()
    .AddAzureSignalR(builder.Configuration["Azure:SignalR:ConnectionString"]);

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:3000")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

var app = builder.Build();

app.UseCors();
app.MapHub<ChatHub>("/chatHub");

app.Run();
```

### Client-Side (JavaScript)

```html
<!-- index.html -->
<!DOCTYPE html>
<html>
<head>
    <title>SignalR Chat</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/microsoft-signalr/5.0.4/signalr.min.js"></script>
</head>
<body>
    <div id="chat">
        <input type="text" id="userInput" placeholder="Your name" />
        <input type="text" id="messageInput" placeholder="Message" />
        <button onclick="sendMessage()">Send</button>
        <ul id="messagesList"></ul>
    </div>

    <script>
        const connection = new signalR.HubConnectionBuilder()
            .withUrl("/chatHub")
            .withAutomaticReconnect()
            .configureLogging(signalR.LogLevel.Information)
            .build();

        connection.on("ReceiveMessage", (user, message) => {
            const li = document.createElement("li");
            li.textContent = `${user}: ${message}`;
            document.getElementById("messagesList").appendChild(li);
        });

        connection.on("UserConnected", (connectionId) => {
            console.log(`User connected: ${connectionId}`);
        });

        connection.on("UserDisconnected", (connectionId) => {
            console.log(`User disconnected: ${connectionId}`);
        });

        connection.onreconnecting(error => {
            console.log(`Connection lost. Reconnecting: ${error}`);
        });

        connection.onreconnected(connectionId => {
            console.log(`Reconnected with ID: ${connectionId}`);
        });

        async function start() {
            try {
                await connection.start();
                console.log("SignalR Connected.");
            } catch (err) {
                console.log(err);
                setTimeout(start, 5000);
            }
        }

        async function sendMessage() {
            const user = document.getElementById("userInput").value;
            const message = document.getElementById("messageInput").value;

            try {
                await connection.invoke("SendMessage", user, message);
                document.getElementById("messageInput").value = "";
            } catch (err) {
                console.error(err);
            }
        }

        start();
    </script>
</body>
</html>
```

## Serverless Mode with Azure Functions

For serverless scenarios, use SignalR Service in Serverless mode:

```bash
az signalr update \
    --name mysignalr \
    --resource-group myResourceGroup \
    --service-mode Serverless
```

Azure Function bindings:

```csharp
// NegotiateFunction.cs
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

public class NegotiateFunction
{
    [Function("negotiate")]
    public static SignalRConnectionInfo Negotiate(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post")] HttpRequestData req,
        [SignalRConnectionInfoInput(HubName = "chat")] SignalRConnectionInfo connectionInfo)
    {
        return connectionInfo;
    }
}

// BroadcastFunction.cs
public class BroadcastFunction
{
    [Function("broadcast")]
    [SignalROutput(HubName = "chat")]
    public static SignalRMessageAction Broadcast(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post")] HttpRequestData req,
        [FromBody] ChatMessage message)
    {
        return new SignalRMessageAction("ReceiveMessage")
        {
            Arguments = new object[] { message.User, message.Text }
        };
    }
}

// SendToUserFunction.cs
public class SendToUserFunction
{
    [Function("sendToUser")]
    [SignalROutput(HubName = "chat")]
    public static SignalRMessageAction SendToUser(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post")] HttpRequestData req,
        [FromBody] DirectMessage message)
    {
        return new SignalRMessageAction("ReceivePrivateMessage")
        {
            UserId = message.TargetUserId,
            Arguments = new object[] { message.Text }
        };
    }
}

public record ChatMessage(string User, string Text);
public record DirectMessage(string TargetUserId, string Text);
```

## Live Dashboard Example

Creating a real-time stock ticker:

```csharp
// Hubs/StockHub.cs
public class StockHub : Hub
{
    public async Task SubscribeToStock(string symbol)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, symbol);
    }

    public async Task UnsubscribeFromStock(string symbol)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, symbol);
    }
}

// Services/StockService.cs
public class StockService : BackgroundService
{
    private readonly IHubContext<StockHub> _hubContext;
    private readonly Random _random = new();

    public StockService(IHubContext<StockHub> hubContext)
    {
        _hubContext = hubContext;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var stocks = new Dictionary<string, decimal>
        {
            ["MSFT"] = 250.00m,
            ["AAPL"] = 150.00m,
            ["GOOGL"] = 2000.00m
        };

        while (!stoppingToken.IsCancellationRequested)
        {
            foreach (var stock in stocks.Keys.ToList())
            {
                var change = (decimal)(_random.NextDouble() - 0.5) * 2;
                stocks[stock] += change;

                await _hubContext.Clients.Group(stock).SendAsync(
                    "StockUpdate",
                    new
                    {
                        Symbol = stock,
                        Price = stocks[stock],
                        Change = change,
                        Timestamp = DateTime.UtcNow
                    },
                    stoppingToken);
            }

            await Task.Delay(1000, stoppingToken);
        }
    }
}
```

Client-side dashboard:

```javascript
// stock-dashboard.js
const connection = new signalR.HubConnectionBuilder()
    .withUrl("/stockHub")
    .withAutomaticReconnect()
    .build();

connection.on("StockUpdate", (data) => {
    updateStockDisplay(data);
});

async function subscribeToStock(symbol) {
    await connection.invoke("SubscribeToStock", symbol);
}

async function unsubscribeFromStock(symbol) {
    await connection.invoke("UnsubscribeFromStock", symbol);
}

function updateStockDisplay(data) {
    const element = document.getElementById(`stock-${data.symbol}`);
    if (element) {
        element.querySelector('.price').textContent = `$${data.price.toFixed(2)}`;
        const changeEl = element.querySelector('.change');
        changeEl.textContent = `${data.change >= 0 ? '+' : ''}${data.change.toFixed(2)}`;
        changeEl.className = `change ${data.change >= 0 ? 'positive' : 'negative'}`;
    }
}

connection.start().then(() => {
    subscribeToStock('MSFT');
    subscribeToStock('AAPL');
    subscribeToStock('GOOGL');
});
```

## Authentication Integration

```csharp
// Configure JWT authentication
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;

                if (!string.IsNullOrEmpty(accessToken) &&
                    path.StartsWithSegments("/chatHub"))
                {
                    context.Token = accessToken;
                }
                return Task.CompletedTask;
            }
        };
    });

// Use in Hub
[Authorize]
public class SecureChatHub : Hub
{
    public async Task SendMessage(string message)
    {
        var user = Context.User?.Identity?.Name ?? "Anonymous";
        await Clients.All.SendAsync("ReceiveMessage", user, message);
    }
}
```

## Conclusion

Azure SignalR Service removes the complexity of managing real-time connections at scale. Whether you're building chat applications, live dashboards, or collaborative tools, SignalR provides a robust foundation with:

- Automatic connection management
- Multiple transport fallbacks
- Built-in reconnection handling
- Easy integration with Azure Functions for serverless scenarios

The service handles millions of connections, letting you focus on building great real-time experiences.
