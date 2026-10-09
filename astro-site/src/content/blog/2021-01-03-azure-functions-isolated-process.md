---
title: "Azure Functions with .NET 5: Modernizing Serverless Development"
description: ".NET 5 is out, and Functions has a new hosting model in flight: isolated process. Instead of running inside the Functions host, your function runs in its…"
author: Michael John Peña
draft: false
date: 2021-01-03
tags:
  - Azure
  - Functions
  - .NET
  - Serverless
---

.NET 5 is out, and Functions has a new hosting model in flight: isolated process. Instead of running inside the Functions host, your function runs in its own .NET process and talks to the host over gRPC. The benefit is decoupling—you pick the .NET version, you control DI and middleware, and the host doesn't dictate your dependency graph. The cost is a little extra plumbing. For long-lived services I now default to isolated; for quick utility Functions the in-process model still wins on simplicity.

## Current .NET Support in Azure Functions

As of January 2021, Azure Functions supports:
- **.NET Core 3.1** - In-process model (GA, recommended for production)
- **.NET 5** - Out-of-process model (preview)

The out-of-process model runs your function code in a separate worker process, giving you more control over dependencies and the .NET version.

## In-Process Model (.NET Core 3.1)

The traditional model where functions run in the same process as the host:

```csharp
// .csproj
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>netcoreapp3.1</TargetFramework>
    <AzureFunctionsVersion>v3</AzureFunctionsVersion>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Sdk.Functions" Version="3.0.11" />
  </ItemGroup>
</Project>
```

```csharp
// HttpExample.cs
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.Http;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

public static class HttpExample
{
    [FunctionName("GetItems")]
    public static async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Function, "get")] HttpRequest req,
        ILogger log)
    {
        log.LogInformation("Processing request");

        var items = await GetItemsAsync();

        return new OkObjectResult(items);
    }
}
```

## Dependency Injection in In-Process Model

```csharp
// Startup.cs
using Microsoft.Azure.Functions.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection;

[assembly: FunctionsStartup(typeof(MyFunctionApp.Startup))]

namespace MyFunctionApp
{
    public class Startup : FunctionsStartup
    {
        public override void Configure(IFunctionsHostBuilder builder)
        {
            builder.Services.AddHttpClient();
            builder.Services.AddSingleton<IMyService, MyService>();
            builder.Services.AddDbContext<AppDbContext>(options =>
                options.UseSqlServer(Environment.GetEnvironmentVariable("SqlConnection")));
        }
    }
}
```

```csharp
// Function with DI
public class HttpFunctions
{
    private readonly IMyService _service;
    private readonly ILogger<HttpFunctions> _logger;

    public HttpFunctions(IMyService service, ILogger<HttpFunctions> logger)
    {
        _service = service;
        _logger = logger;
    }

    [FunctionName("GetItems")]
    public async Task<IActionResult> GetItems(
        [HttpTrigger(AuthorizationLevel.Function, "get")] HttpRequest req)
    {
        _logger.LogInformation("Processing request");

        var items = await _service.GetItemsAsync();

        return new OkObjectResult(items);
    }
}
```

## .NET 5 Out-of-Process Model (Preview)

The new isolated worker model for .NET 5:

```csharp
// .csproj
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net5.0</TargetFramework>
    <OutputType>Exe</OutputType>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Azure.Functions.Worker" Version="1.0.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Sdk" Version="1.0.1" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.Http" Version="3.0.12" />
  </ItemGroup>
</Project>
```

```csharp
// Program.cs
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services =>
    {
        services.AddHttpClient();
        services.AddSingleton<IMyService, MyService>();
    })
    .Build();

host.Run();
```

## HTTP Functions in Isolated Model

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using System.Net;

public class HttpFunctions
{
    private readonly IMyService _service;
    private readonly ILogger<HttpFunctions> _logger;

    public HttpFunctions(IMyService service, ILogger<HttpFunctions> logger)
    {
        _service = service;
        _logger = logger;
    }

    [Function("GetItems")]
    public async Task<HttpResponseData> GetItems(
        [HttpTrigger(AuthorizationLevel.Function, "get")] HttpRequestData req)
    {
        _logger.LogInformation("Processing request");

        var items = await _service.GetItemsAsync();

        var response = req.CreateResponse(HttpStatusCode.OK);
        await response.WriteAsJsonAsync(items);
        return response;
    }

    [Function("CreateItem")]
    public async Task<HttpResponseData> CreateItem(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestData req)
    {
        var item = await req.ReadFromJsonAsync<Item>();
        var created = await _service.CreateAsync(item);

        var response = req.CreateResponse(HttpStatusCode.Created);
        await response.WriteAsJsonAsync(created);
        return response;
    }
}
```

## Queue Triggered Functions

```csharp
// In-process (.NET Core 3.1)
public class QueueFunctions
{
    [FunctionName("ProcessMessage")]
    public async Task ProcessMessage(
        [QueueTrigger("input-queue")] string message,
        [Queue("output-queue")] IAsyncCollector<string> outputQueue,
        ILogger log)
    {
        log.LogInformation($"Processing: {message}");

        var result = await ProcessAsync(message);

        await outputQueue.AddAsync(result);
    }
}

// Isolated (.NET 5 preview)
public class QueueFunctions
{
    [Function("ProcessMessage")]
    [QueueOutput("output-queue")]
    public string ProcessMessage(
        [QueueTrigger("input-queue")] string message,
        FunctionContext context)
    {
        var logger = context.GetLogger<QueueFunctions>();
        logger.LogInformation($"Processing: {message}");

        return $"Processed: {message}";
    }
}
```

## Timer Functions

```csharp
public class TimerFunctions
{
    private readonly IMyService _service;

    public TimerFunctions(IMyService service)
    {
        _service = service;
    }

    [FunctionName("DailyCleanup")]
    public async Task DailyCleanup(
        [TimerTrigger("0 0 2 * * *")] TimerInfo timer,
        ILogger log)
    {
        log.LogInformation($"Cleanup started at: {DateTime.UtcNow}");

        await _service.CleanupOldRecordsAsync();

        log.LogInformation("Cleanup completed");
    }
}
```

## Durable Functions

Durable Functions work with both models:

```csharp
public class DurableFunctions
{
    [FunctionName("OrderOrchestrator")]
    public async Task<OrderResult> RunOrchestrator(
        [OrchestrationTrigger] IDurableOrchestrationContext context)
    {
        var order = context.GetInput<Order>();

        // Sequential activities
        var validated = await context.CallActivityAsync<bool>("ValidateOrder", order);
        if (!validated)
            return new OrderResult { Success = false, Message = "Validation failed" };

        var reserved = await context.CallActivityAsync<bool>("ReserveInventory", order);
        var charged = await context.CallActivityAsync<bool>("ChargeCustomer", order);

        if (charged)
        {
            await context.CallActivityAsync("SendConfirmation", order);
        }

        return new OrderResult { Success = true, OrderId = order.Id };
    }

    [FunctionName("ValidateOrder")]
    public bool ValidateOrder([ActivityTrigger] Order order, ILogger log)
    {
        log.LogInformation($"Validating order {order.Id}");
        return order.Items.Any() && order.Total > 0;
    }

    [FunctionName("ReserveInventory")]
    public async Task<bool> ReserveInventory(
        [ActivityTrigger] Order order,
        ILogger log)
    {
        log.LogInformation($"Reserving inventory for order {order.Id}");
        // Reserve logic
        return true;
    }
}
```

## Configuration and Settings

```csharp
// Access configuration
public class ConfiguredFunction
{
    private readonly IConfiguration _configuration;

    public ConfiguredFunction(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    [FunctionName("ConfigExample")]
    public IActionResult Run(
        [HttpTrigger(AuthorizationLevel.Function, "get")] HttpRequest req)
    {
        var setting = _configuration["MySetting"];
        var connectionString = _configuration.GetConnectionString("DefaultConnection");

        return new OkObjectResult(new { Setting = setting });
    }
}
```

## Testing Functions

```csharp
[TestClass]
public class HttpFunctionsTests
{
    [TestMethod]
    public async Task GetItems_ReturnsItems()
    {
        // Arrange
        var mockService = new Mock<IMyService>();
        mockService.Setup(s => s.GetItemsAsync())
            .ReturnsAsync(new List<Item> { new Item { Id = 1 } });

        var mockLogger = Mock.Of<ILogger<HttpFunctions>>();
        var functions = new HttpFunctions(mockService.Object, mockLogger);

        var mockRequest = CreateMockRequest();

        // Act
        var response = await functions.GetItems(mockRequest);

        // Assert
        Assert.IsInstanceOfType(response, typeof(OkObjectResult));
    }

    private HttpRequest CreateMockRequest()
    {
        var context = new DefaultHttpContext();
        return context.Request;
    }
}
```

## Deployment

```bash
# Deploy using Azure CLI
az functionapp deployment source config-zip \
    --resource-group myResourceGroup \
    --name myFunctionApp \
    --src functionapp.zip

# Or using func CLI
func azure functionapp publish myFunctionApp
```

## Best Practices

1. **Use dependency injection** - Manage services properly
2. **Handle cold starts** - Use premium plan for low latency
3. **Configure retries** - For queue-triggered functions
4. **Monitor with Application Insights** - Enable for all functions
5. **Use managed identities** - Avoid storing secrets

## When to Use Each Model

| Scenario | Recommendation |
|----------|---------------|
| Production workloads | In-process (.NET Core 3.1) |
| Need .NET 5 features | Isolated (preview) |
| Durable Functions | In-process |
| Maximum performance | In-process |

The isolated process model is still in preview but shows promise for future .NET versions.
