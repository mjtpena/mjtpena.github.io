---
title: "Azure Functions with .NET 7: Isolated Worker Process Model"
author: Michael John Peña
draft: false
date: 2022-11-03
tags:
  - Azure Functions
  - .NET
  - Serverless
  - Azure
---

## Why Isolated Process?

The isolated worker process model separates your function code from the Azure Functions host:

- **Version independence**: Use any .NET version, including .NET 7
- **Full control over dependencies**: No conflicts with host dependencies
- **Middleware support**: Add custom middleware to your function pipeline
- **Native AOT support**: Potential for faster cold starts

## Getting Started

Create a new isolated Azure Functions project:

```bash
dotnet new func --name MyFunctionApp --worker-runtime dotnet-isolated --target-framework net7.0
cd MyFunctionApp
```

The project file should look like this:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net7.0</TargetFramework>
    <AzureFunctionsVersion>v4</AzureFunctionsVersion>
    <OutputType>Exe</OutputType>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Azure.Functions.Worker" Version="1.10.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Sdk" Version="1.7.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.Http" Version="3.0.13" />
  </ItemGroup>
</Project>
```

## Program.cs Configuration

The isolated model uses a standard .NET host:

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults(worker =>
    {
        worker.UseMiddleware<ExceptionHandlingMiddleware>();
        worker.UseMiddleware<AuthenticationMiddleware>();
    })
    .ConfigureServices(services =>
    {
        services.AddApplicationInsightsTelemetryWorkerService();
        services.ConfigureFunctionsApplicationInsights();

        // Add your services
        services.AddSingleton<ICosmosDbService, CosmosDbService>();
        services.AddHttpClient<IExternalApiClient, ExternalApiClient>();
    })
    .Build();

host.Run();
```

## HTTP Trigger Function

```csharp
using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

public class HttpFunctions
{
    private readonly ILogger<HttpFunctions> _logger;
    private readonly ICosmosDbService _cosmosDb;

    public HttpFunctions(ILogger<HttpFunctions> logger, ICosmosDbService cosmosDb)
    {
        _logger = logger;
        _cosmosDb = cosmosDb;
    }

    [Function("GetProducts")]
    public async Task<HttpResponseData> GetProducts(
        [HttpTrigger(AuthorizationLevel.Function, "get", Route = "products")]
        HttpRequestData req)
    {
        _logger.LogInformation("Getting all products");

        var products = await _cosmosDb.GetProductsAsync();

        var response = req.CreateResponse(HttpStatusCode.OK);
        await response.WriteAsJsonAsync(products);
        return response;
    }

    [Function("GetProduct")]
    public async Task<HttpResponseData> GetProduct(
        [HttpTrigger(AuthorizationLevel.Function, "get", Route = "products/{id}")]
        HttpRequestData req,
        string id)
    {
        _logger.LogInformation("Getting product {ProductId}", id);

        var product = await _cosmosDb.GetProductAsync(id);

        if (product is null)
        {
            return req.CreateResponse(HttpStatusCode.NotFound);
        }

        var response = req.CreateResponse(HttpStatusCode.OK);
        await response.WriteAsJsonAsync(product);
        return response;
    }

    [Function("CreateProduct")]
    public async Task<HttpResponseData> CreateProduct(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = "products")]
        HttpRequestData req)
    {
        var product = await req.ReadFromJsonAsync<Product>();

        if (product is null)
        {
            var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
            await badRequest.WriteAsJsonAsync(new { error = "Invalid product data" });
            return badRequest;
        }

        var created = await _cosmosDb.CreateProductAsync(product);

        var response = req.CreateResponse(HttpStatusCode.Created);
        await response.WriteAsJsonAsync(created);
        return response;
    }
}

public record Product(string Id, string Name, decimal Price, string Category);
```

## Custom Middleware

One of the best features of isolated functions - middleware:

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;

public class ExceptionHandlingMiddleware : IFunctionsWorkerMiddleware
{
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;

    public ExceptionHandlingMiddleware(ILogger<ExceptionHandlingMiddleware> logger)
    {
        _logger = logger;
    }

    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        try
        {
            await next(context);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled exception in function {FunctionName}",
                context.FunctionDefinition.Name);

            var httpContext = await context.GetHttpRequestDataAsync();
            if (httpContext is not null)
            {
                var response = httpContext.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new
                {
                    error = "An internal error occurred",
                    traceId = context.InvocationId
                });

                context.GetInvocationResult().Value = response;
            }
        }
    }
}

public class AuthenticationMiddleware : IFunctionsWorkerMiddleware
{
    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        var httpContext = await context.GetHttpRequestDataAsync();

        if (httpContext is not null)
        {
            // Extract and validate JWT token
            if (httpContext.Headers.TryGetValues("Authorization", out var values))
            {
                var token = values.FirstOrDefault()?.Replace("Bearer ", "");
                // Validate token and set user context
                context.Items["UserId"] = ValidateToken(token);
            }
        }

        await next(context);
    }

    private string? ValidateToken(string? token)
    {
        // Token validation logic
        return token is not null ? "user-123" : null;
    }
}
```

## Queue Trigger with Output Binding

```csharp
public class QueueFunctions
{
    private readonly ILogger<QueueFunctions> _logger;

    public QueueFunctions(ILogger<QueueFunctions> logger)
    {
        _logger = logger;
    }

    [Function("ProcessOrder")]
    [BlobOutput("processed-orders/{rand-guid}.json")]
    public async Task<string> ProcessOrder(
        [QueueTrigger("orders")] OrderMessage order)
    {
        _logger.LogInformation("Processing order {OrderId}", order.OrderId);

        // Process the order
        var result = new ProcessedOrder
        {
            OrderId = order.OrderId,
            ProcessedAt = DateTime.UtcNow,
            Status = "Completed",
            Total = order.Items.Sum(i => i.Price * i.Quantity)
        };

        // Return value goes to blob output
        return JsonSerializer.Serialize(result);
    }
}

public record OrderMessage(string OrderId, List<OrderItem> Items);
public record OrderItem(string ProductId, int Quantity, decimal Price);
public record ProcessedOrder
{
    public string OrderId { get; init; } = "";
    public DateTime ProcessedAt { get; init; }
    public string Status { get; init; } = "";
    public decimal Total { get; init; }
}
```

## Timer Trigger with Cosmos DB

```csharp
public class TimerFunctions
{
    private readonly ICosmosDbService _cosmosDb;
    private readonly ILogger<TimerFunctions> _logger;

    public TimerFunctions(ICosmosDbService cosmosDb, ILogger<TimerFunctions> logger)
    {
        _cosmosDb = cosmosDb;
        _logger = logger;
    }

    [Function("DailyReport")]
    public async Task DailyReport(
        [TimerTrigger("0 0 8 * * *")] TimerInfo timer)
    {
        _logger.LogInformation("Generating daily report at {Time}", DateTime.UtcNow);

        var yesterday = DateTime.UtcNow.Date.AddDays(-1);
        var orders = await _cosmosDb.GetOrdersByDateAsync(yesterday);

        var report = new DailyReport
        {
            Date = yesterday,
            TotalOrders = orders.Count,
            TotalRevenue = orders.Sum(o => o.Total),
            AverageOrderValue = orders.Count > 0 ? orders.Average(o => o.Total) : 0
        };

        await _cosmosDb.SaveReportAsync(report);

        _logger.LogInformation("Daily report saved: {TotalOrders} orders, {Revenue:C} revenue",
            report.TotalOrders, report.TotalRevenue);
    }
}
```

## Dependency Injection Best Practices

```csharp
// Services registration
public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddApplicationServices(this IServiceCollection services)
    {
        // Configuration
        services.AddOptions<CosmosDbOptions>()
            .Configure<IConfiguration>((options, config) =>
            {
                config.GetSection("CosmosDb").Bind(options);
            });

        // Services with different lifetimes
        services.AddSingleton<ICosmosDbService, CosmosDbService>();
        services.AddScoped<IOrderService, OrderService>();
        services.AddTransient<IEmailService, EmailService>();

        // HttpClient with Polly resilience
        services.AddHttpClient<IPaymentService, PaymentService>()
            .AddTransientHttpErrorPolicy(p =>
                p.WaitAndRetryAsync(3, _ => TimeSpan.FromMilliseconds(300)));

        return services;
    }
}

// Program.cs
var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services =>
    {
        services.AddApplicationServices();
    })
    .Build();
```

## Testing Isolated Functions

```csharp
using Microsoft.Azure.Functions.Worker.Http;
using Moq;
using Xunit;

public class HttpFunctionsTests
{
    [Fact]
    public async Task GetProduct_ReturnsProduct_WhenExists()
    {
        // Arrange
        var mockLogger = new Mock<ILogger<HttpFunctions>>();
        var mockCosmosDb = new Mock<ICosmosDbService>();

        var expectedProduct = new Product("1", "Test Product", 19.99m, "Test");
        mockCosmosDb.Setup(x => x.GetProductAsync("1"))
            .ReturnsAsync(expectedProduct);

        var function = new HttpFunctions(mockLogger.Object, mockCosmosDb.Object);
        var request = CreateMockRequest();

        // Act
        var response = await function.GetProduct(request, "1");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private HttpRequestData CreateMockRequest()
    {
        var context = new Mock<FunctionContext>();
        var request = new Mock<HttpRequestData>(context.Object);
        // Setup request mock...
        return request.Object;
    }
}
```

## Conclusion

The isolated worker process model is the future of .NET Azure Functions. With .NET 7 support, middleware capabilities, and full dependency injection, it provides a modern, testable, and flexible platform for building serverless applications. If you're starting a new Azure Functions project, the isolated model should be your default choice.

## Resources

- [.NET Isolated Process Guide](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide)
- [Azure Functions .NET Worker](https://github.com/Azure/azure-functions-dotnet-worker)
- [Middleware in Isolated Functions](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide#middleware)
