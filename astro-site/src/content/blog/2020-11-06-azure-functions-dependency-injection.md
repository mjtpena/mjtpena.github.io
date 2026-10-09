---
title: "Azure Functions Dependency Injection: Clean Architecture"
description: "The first Azure Function project I shipped used static everything. Static config, static SQL helpers, static logger. It worked—until I tried to write a unit…"
author: Michael John Peña
draft: false
date: 2020-11-06
tags:
  - Azure
  - Functions
  - Serverless
  - Architecture
---

The first Azure Function project I shipped used `static` everything. Static config, static SQL helpers, static logger. It worked—until I tried to write a unit test and realised I'd built a concrete pyramid. DI in Functions (introduced via `Startup.cs` and `IFunctionsHostBuilder`) is the cure. Register services once in `ConfigureServices`, inject them through constructors, and your Functions become testable like any other .NET app.

## Setting Up DI

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
            // Register services
            builder.Services.AddScoped<IOrderService, OrderService>();
            builder.Services.AddSingleton<IProductRepository, ProductRepository>();
            builder.Services.AddHttpClient<IExternalApiClient, ExternalApiClient>();

            // Register configuration
            builder.Services.AddOptions<AppSettings>()
                .Configure<IConfiguration>((settings, config) =>
                {
                    config.GetSection("AppSettings").Bind(settings);
                });
        }
    }
}
```

## Using Injected Services

```csharp
public class OrderFunctions
{
    private readonly IOrderService _orderService;
    private readonly ILogger<OrderFunctions> _logger;

    public OrderFunctions(
        IOrderService orderService,
        ILogger<OrderFunctions> logger)
    {
        _orderService = orderService;
        _logger = logger;
    }

    [FunctionName("CreateOrder")]
    public async Task<IActionResult> CreateOrder(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequest req)
    {
        var order = await req.ReadFromJsonAsync<Order>();

        _logger.LogInformation("Creating order for customer {CustomerId}", order.CustomerId);

        var result = await _orderService.CreateOrderAsync(order);

        return new OkObjectResult(result);
    }
}
```

## Service Implementation

```csharp
public interface IOrderService
{
    Task<Order> CreateOrderAsync(Order order);
    Task<Order> GetOrderAsync(string orderId);
}

public class OrderService : IOrderService
{
    private readonly IProductRepository _productRepository;
    private readonly IExternalApiClient _apiClient;
    private readonly IOptions<AppSettings> _settings;

    public OrderService(
        IProductRepository productRepository,
        IExternalApiClient apiClient,
        IOptions<AppSettings> settings)
    {
        _productRepository = productRepository;
        _apiClient = apiClient;
        _settings = settings;
    }

    public async Task<Order> CreateOrderAsync(Order order)
    {
        // Validate products
        foreach (var item in order.Items)
        {
            var product = await _productRepository.GetAsync(item.ProductId);
            item.UnitPrice = product.Price;
        }

        // Calculate total
        order.Total = order.Items.Sum(i => i.Quantity * i.UnitPrice);

        // Process payment via external API
        await _apiClient.ProcessPaymentAsync(order);

        return order;
    }
}
```

## Registering HTTP Clients

```csharp
public override void Configure(IFunctionsHostBuilder builder)
{
    // Named HTTP client
    builder.Services.AddHttpClient("PaymentApi", client =>
    {
        client.BaseAddress = new Uri("https://api.payment.com/");
        client.DefaultRequestHeaders.Add("Accept", "application/json");
    });

    // Typed HTTP client
    builder.Services.AddHttpClient<IPaymentClient, PaymentClient>(client =>
    {
        client.BaseAddress = new Uri("https://api.payment.com/");
    })
    .AddTransientHttpErrorPolicy(policy =>
        policy.WaitAndRetryAsync(3, _ => TimeSpan.FromSeconds(2)));
}
```

## Database Context

```csharp
public override void Configure(IFunctionsHostBuilder builder)
{
    var connectionString = Environment.GetEnvironmentVariable("SqlConnection");

    builder.Services.AddDbContext<AppDbContext>(options =>
        options.UseSqlServer(connectionString));
}
```

## Configuration Binding

```csharp
// AppSettings.cs
public class AppSettings
{
    public string ApiEndpoint { get; set; }
    public int CacheTimeoutMinutes { get; set; }
    public bool EnableFeatureX { get; set; }
}

// local.settings.json
{
    "Values": {
        "AppSettings:ApiEndpoint": "https://api.example.com",
        "AppSettings:CacheTimeoutMinutes": "30",
        "AppSettings:EnableFeatureX": "true"
    }
}
```

## Testing with DI

```csharp
[TestClass]
public class OrderFunctionsTests
{
    [TestMethod]
    public async Task CreateOrder_ValidOrder_ReturnsOk()
    {
        // Arrange
        var mockOrderService = new Mock<IOrderService>();
        mockOrderService
            .Setup(s => s.CreateOrderAsync(It.IsAny<Order>()))
            .ReturnsAsync(new Order { Id = "123" });

        var mockLogger = new Mock<ILogger<OrderFunctions>>();

        var functions = new OrderFunctions(mockOrderService.Object, mockLogger.Object);

        // Act
        var result = await functions.CreateOrder(CreateMockRequest(new Order()));

        // Assert
        Assert.IsInstanceOfType(result, typeof(OkObjectResult));
    }
}
```

DI makes Azure Functions enterprise-ready.
