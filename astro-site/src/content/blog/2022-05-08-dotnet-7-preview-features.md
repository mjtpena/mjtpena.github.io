---
title: ".NET 7 Preview: Performance and Cloud-Native Features"
author: Michael John Peña
draft: false
date: 2022-05-08
tags:
  - dotnet
  - csharp
  - azure
  - performance

---

I wrote ".NET 7 Preview: Performance and Cloud-Native Features" to share practical, production-minded guidance on this topic.

## Key Features Overview

- Generic math interfaces
- Required members
- Improved minimal APIs
- Native AOT compilation
- Enhanced performance

## Generic Math

One of the most anticipated features is generic math support:

```csharp
using System.Numerics;

public class MathOperations
{
    // Generic method that works with any numeric type
    public static T Sum<T>(IEnumerable<T> values) where T : INumber<T>
    {
        T sum = T.Zero;
        foreach (var value in values)
        {
            sum += value;
        }
        return sum;
    }

    public static T Average<T>(IEnumerable<T> values) where T : INumber<T>
    {
        var count = values.Count();
        if (count == 0) return T.Zero;

        var sum = Sum(values);
        return sum / T.CreateChecked(count);
    }

    public static T Clamp<T>(T value, T min, T max) where T : INumber<T>
    {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }
}

// Usage
var integers = new[] { 1, 2, 3, 4, 5 };
var intSum = MathOperations.Sum(integers); // 15

var doubles = new[] { 1.5, 2.5, 3.5 };
var doubleAvg = MathOperations.Average(doubles); // 2.5

var decimals = new[] { 100.0m, 200.0m, 300.0m };
var decimalSum = MathOperations.Sum(decimals); // 600.0m
```

## Required Members

Ensure object initialization completeness:

```csharp
public class Person
{
    public required string FirstName { get; init; }
    public required string LastName { get; init; }
    public required string Email { get; init; }
    public DateOnly? DateOfBirth { get; init; }

    // Computed property
    public string FullName => $"{FirstName} {LastName}";
}

public class Order
{
    public required Guid Id { get; init; }
    public required string CustomerId { get; init; }
    public required List<OrderItem> Items { get; init; }
    public required decimal TotalAmount { get; init; }
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
    public OrderStatus Status { get; set; } = OrderStatus.Pending;
}

public record OrderItem
{
    public required string ProductId { get; init; }
    public required int Quantity { get; init; }
    public required decimal UnitPrice { get; init; }
}

public enum OrderStatus { Pending, Processing, Shipped, Delivered, Cancelled }

// Usage - compiler ensures required members are set
var person = new Person
{
    FirstName = "John",
    LastName = "Doe",
    Email = "john@example.com"
};

var order = new Order
{
    Id = Guid.NewGuid(),
    CustomerId = "CUST-001",
    Items = new List<OrderItem>
    {
        new OrderItem { ProductId = "PROD-001", Quantity = 2, UnitPrice = 29.99m }
    },
    TotalAmount = 59.98m
};
```

## Enhanced Minimal APIs

Improved minimal API features for cleaner code:

```csharp
using Microsoft.AspNetCore.Http.HttpResults;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddScoped<IProductService, ProductService>();

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

// Typed results for better OpenAPI documentation
app.MapGet("/products", async (IProductService service) =>
{
    var products = await service.GetAllAsync();
    return TypedResults.Ok(products);
})
.WithName("GetProducts")
.WithOpenApi();

app.MapGet("/products/{id}", async Task<Results<Ok<Product>, NotFound>> (
    int id,
    IProductService service) =>
{
    var product = await service.GetByIdAsync(id);
    return product is not null
        ? TypedResults.Ok(product)
        : TypedResults.NotFound();
})
.WithName("GetProduct")
.WithOpenApi();

app.MapPost("/products", async Task<Results<Created<Product>, ValidationProblem>> (
    Product product,
    IProductService service) =>
{
    var validationResult = await service.ValidateAsync(product);
    if (!validationResult.IsValid)
    {
        return TypedResults.ValidationProblem(validationResult.Errors);
    }

    var created = await service.CreateAsync(product);
    return TypedResults.Created($"/products/{created.Id}", created);
})
.WithName("CreateProduct")
.WithOpenApi();

// Route groups for organization
var ordersGroup = app.MapGroup("/orders").WithTags("Orders");

ordersGroup.MapGet("/", async (IOrderService service) =>
    TypedResults.Ok(await service.GetAllAsync()));

ordersGroup.MapGet("/{id}", async Task<Results<Ok<Order>, NotFound>> (
    Guid id,
    IOrderService service) =>
{
    var order = await service.GetByIdAsync(id);
    return order is not null
        ? TypedResults.Ok(order)
        : TypedResults.NotFound();
});

ordersGroup.MapPost("/", async (CreateOrderRequest request, IOrderService service) =>
{
    var order = await service.CreateAsync(request);
    return TypedResults.Created($"/orders/{order.Id}", order);
});

app.Run();

public record Product(int Id, string Name, decimal Price, string Category);
public record CreateOrderRequest(string CustomerId, List<OrderItemRequest> Items);
public record OrderItemRequest(int ProductId, int Quantity);
```

## Native AOT Compilation

Ahead-of-time compilation for faster startup:

```xml
<!-- Project file configuration -->
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net7.0</TargetFramework>
    <PublishAot>true</PublishAot>
    <InvariantGlobalization>true</InvariantGlobalization>
    <StripSymbols>true</StripSymbols>
  </PropertyGroup>
</Project>
```

AOT-compatible code:

```csharp
using System.Text.Json;
using System.Text.Json.Serialization;

// Use source generators for JSON serialization (AOT compatible)
[JsonSerializable(typeof(WeatherForecast))]
[JsonSerializable(typeof(List<WeatherForecast>))]
public partial class AppJsonContext : JsonSerializerContext { }

public class WeatherForecast
{
    public DateOnly Date { get; set; }
    public int TemperatureC { get; set; }
    public string? Summary { get; set; }
}

// AOT-compatible API
var builder = WebApplication.CreateSlimBuilder(args);
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.TypeInfoResolver = AppJsonContext.Default;
});

var app = builder.Build();

app.MapGet("/weather", () =>
{
    var forecasts = Enumerable.Range(1, 5).Select(index =>
        new WeatherForecast
        {
            Date = DateOnly.FromDateTime(DateTime.Now.AddDays(index)),
            TemperatureC = Random.Shared.Next(-20, 55),
            Summary = "Sunny"
        })
        .ToList();

    return forecasts;
});

app.Run();
```

Publish with AOT:

```bash
dotnet publish -c Release -r linux-x64 --self-contained
```

## Performance Improvements

On-stack replacement for better JIT optimization:

```csharp
public class PerformanceDemo
{
    // This method benefits from OSR (On-Stack Replacement)
    public long SumWithOSR(int iterations)
    {
        long sum = 0;
        for (int i = 0; i < iterations; i++)
        {
            sum += ProcessItem(i);
        }
        return sum;
    }

    private long ProcessItem(int value)
    {
        // Complex computation that benefits from JIT optimization
        return (long)(Math.Sin(value) * Math.Cos(value) * 1000);
    }
}

// Improved Regex source generators
public partial class Validators
{
    [GeneratedRegex(@"^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$", RegexOptions.IgnoreCase)]
    private static partial Regex EmailRegex();

    [GeneratedRegex(@"^\+?[1-9]\d{1,14}$")]
    private static partial Regex PhoneRegex();

    public static bool IsValidEmail(string email) =>
        EmailRegex().IsMatch(email);

    public static bool IsValidPhone(string phone) =>
        PhoneRegex().IsMatch(phone);
}
```

## Improved LINQ

New LINQ methods and performance:

```csharp
public class LinqImprovements
{
    public void DemoNewMethods()
    {
        var numbers = Enumerable.Range(1, 100);

        // Order - simpler than OrderBy for simple cases
        var ordered = numbers.Order();
        var descendingOrdered = numbers.OrderDescending();

        // Index operator
        var items = new[] { "a", "b", "c", "d", "e" };
        var lastTwo = items.Take(^2..); // ["d", "e"]
        var middle = items.Take(1..^1); // ["b", "c", "d"]

        // Chunk - split into batches
        var chunks = numbers.Chunk(10); // 10 chunks of 10 items each

        foreach (var chunk in chunks)
        {
            ProcessBatch(chunk);
        }
    }

    private void ProcessBatch(int[] batch)
    {
        Console.WriteLine($"Processing batch of {batch.Length} items");
    }
}
```

## Rate Limiting Middleware

Built-in rate limiting:

```csharp
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRateLimiter(options =>
{
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.User.Identity?.Name ?? context.Request.Headers.Host.ToString(),
            factory: partition => new FixedWindowRateLimiterOptions
            {
                AutoReplenishment = true,
                PermitLimit = 100,
                Window = TimeSpan.FromMinutes(1)
            }));

    options.AddPolicy("api", context =>
        RateLimitPartition.GetSlidingWindowLimiter(
            partitionKey: context.User.Identity?.Name ?? "anonymous",
            factory: partition => new SlidingWindowRateLimiterOptions
            {
                AutoReplenishment = true,
                PermitLimit = 10,
                Window = TimeSpan.FromSeconds(10),
                SegmentsPerWindow = 2
            }));

    options.OnRejected = async (context, token) =>
    {
        context.HttpContext.Response.StatusCode = 429;
        await context.HttpContext.Response.WriteAsync(
            "Too many requests. Please try again later.", token);
    };
});

var app = builder.Build();

app.UseRateLimiter();

app.MapGet("/", () => "Hello!").RequireRateLimiting("api");

app.Run();
```

## Summary

.NET 7 preview brings:

- Generic math for flexible numeric operations
- Required members for better object initialization
- Enhanced minimal APIs with typed results
- Native AOT for faster cold start
- Built-in rate limiting middleware
- Performance improvements across the board

These features make .NET 7 excellent for cloud-native and high-performance applications.


