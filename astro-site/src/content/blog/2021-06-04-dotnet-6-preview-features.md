---
title: Exploring .NET 6 Preview Features for Azure Development
author: Michael John Peña
draft: false
date: 2021-06-04
url: /blog/dotnet-6-preview-features/
tags:
  - .NET
  - .NET 6
  - Azure
  - Preview
---

.NET 6 Preview 4 in June 2021 was the point where I started genuinely excited about the November GA. Minimal APIs, Blazor improvements, native AOT experimentation, and the Hot Reload developer experience that made the inner loop faster than anything I'd had with .NET Core. For Azure development specifically, the performance improvements in networking and serialisation (System.Text.Json continuing to narrow the gap with Newtonsoft.Json) and the improved container startup times matter directly. This post is what's in Preview 4 that's ready to experiment with, and what I'm watching for the LTS GA in November.

## Minimal APIs

One of the most talked-about features is the introduction of Minimal APIs, reducing boilerplate for simple services:

### Traditional Controller Approach

```csharp
// Controllers/WeatherController.cs
[ApiController]
[Route("[controller]")]
public class WeatherController : ControllerBase
{
    [HttpGet]
    public IEnumerable<WeatherForecast> Get()
    {
        return Enumerable.Range(1, 5).Select(index => new WeatherForecast
        {
            Date = DateTime.Now.AddDays(index),
            TemperatureC = Random.Shared.Next(-20, 55)
        });
    }
}
```

### Minimal API Approach

```csharp
// Program.cs - The entire application!
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/weather", () =>
    Enumerable.Range(1, 5).Select(index => new WeatherForecast
    {
        Date = DateTime.Now.AddDays(index),
        TemperatureC = Random.Shared.Next(-20, 55)
    }));

app.Run();

record WeatherForecast(DateTime Date, int TemperatureC);
```

### Minimal APIs with Dependency Injection

```csharp
var builder = WebApplication.CreateBuilder(args);

// Register services
builder.Services.AddSingleton<IWeatherService, WeatherService>();
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

var app = builder.Build();

// Inject services into endpoints
app.MapGet("/weather", async (IWeatherService weatherService) =>
    await weatherService.GetForecastAsync());

app.MapGet("/products/{id}", async (int id, AppDbContext db) =>
    await db.Products.FindAsync(id) is Product product
        ? Results.Ok(product)
        : Results.NotFound());

app.MapPost("/products", async (Product product, AppDbContext db) =>
{
    db.Products.Add(product);
    await db.SaveChangesAsync();
    return Results.Created($"/products/{product.Id}", product);
});

app.Run();
```

## File-Scoped Namespaces

Reduce indentation with file-scoped namespaces:

```csharp
// Before
namespace MyCompany.MyApp.Services
{
    public class WeatherService
    {
        // Implementation
    }
}

// After (.NET 6)
namespace MyCompany.MyApp.Services;

public class WeatherService
{
    // Implementation - one less level of indentation
}
```

## Global Using Directives

Eliminate repetitive using statements:

```csharp
// GlobalUsings.cs
global using System;
global using System.Collections.Generic;
global using System.Linq;
global using System.Threading.Tasks;
global using Microsoft.AspNetCore.Mvc;
global using Microsoft.EntityFrameworkCore;
global using Azure.Storage.Blobs;
global using Azure.Messaging.ServiceBus;
```

Or in your `.csproj`:

```xml
<ItemGroup>
  <Using Include="System" />
  <Using Include="System.Collections.Generic" />
  <Using Include="System.Linq" />
  <Using Include="Microsoft.AspNetCore.Mvc" />
</ItemGroup>
```

## Hot Reload

Hot Reload enables code changes without restarting your application:

```bash
# Run with Hot Reload enabled
dotnet watch run
```

Supported changes:
- Method body modifications
- Adding new methods and classes
- Lambda expression changes
- LINQ query modifications

### Hot Reload in Azure Functions

```csharp
// Changes to this function can be applied without restart
[Function("ProcessOrder")]
public async Task<HttpResponseData> ProcessOrder(
    [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestData req)
{
    var order = await req.ReadFromJsonAsync<Order>();

    // Modify this logic and see changes immediately
    var total = order.Items.Sum(i => i.Price * i.Quantity);

    var response = req.CreateResponse(HttpStatusCode.OK);
    await response.WriteAsJsonAsync(new { Total = total });
    return response;
}
```

## DateOnly and TimeOnly Types

New types for date-only and time-only scenarios:

```csharp
public class Appointment
{
    public DateOnly Date { get; set; }
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }
}

// Usage
var appointment = new Appointment
{
    Date = new DateOnly(2021, 6, 15),
    StartTime = new TimeOnly(9, 30),
    EndTime = new TimeOnly(10, 30)
};

// Parsing
var date = DateOnly.Parse("2021-06-15");
var time = TimeOnly.Parse("09:30");

// Entity Framework Core support coming
modelBuilder.Entity<Appointment>()
    .Property(a => a.Date)
    .HasConversion<DateOnlyConverter>();
```

## Improved LINQ

### Chunk Operator

```csharp
// Process items in batches
var items = Enumerable.Range(1, 100);
foreach (var chunk in items.Chunk(10))
{
    await ProcessBatchAsync(chunk);
}

// Useful for Azure Service Bus batch operations
var messages = await receiver.ReceiveMessagesAsync(maxMessages: 100);
foreach (var batch in messages.Chunk(10))
{
    await ProcessMessageBatchAsync(batch);
}
```

### MaxBy and MinBy

```csharp
// Find the most expensive product
var products = await dbContext.Products.ToListAsync();
var mostExpensive = products.MaxBy(p => p.Price);
var cheapest = products.MinBy(p => p.Price);

// Azure Cosmos DB query results
var orders = await container.GetItemQueryIterator<Order>(query).ReadNextAsync();
var largestOrder = orders.MaxBy(o => o.Total);
```

### DistinctBy

```csharp
// Get distinct customers by email
var customers = await dbContext.Customers.ToListAsync();
var uniqueByEmail = customers.DistinctBy(c => c.Email);
```

## Priority Queue

New efficient data structure for priority-based processing:

```csharp
public class MessageProcessor
{
    private readonly PriorityQueue<Message, int> _queue = new();

    public void EnqueueMessage(Message message, Priority priority)
    {
        // Lower number = higher priority
        _queue.Enqueue(message, (int)priority);
    }

    public async Task ProcessMessagesAsync()
    {
        while (_queue.TryDequeue(out var message, out var priority))
        {
            await ProcessAsync(message);
        }
    }
}

public enum Priority { Critical = 0, High = 1, Normal = 2, Low = 3 }
```

## HTTP/3 Support (Preview)

HTTP/3 with QUIC protocol support:

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.WebHost.ConfigureKestrel(options =>
{
    options.ListenAnyIP(5001, listenOptions =>
    {
        listenOptions.Protocols = HttpProtocols.Http1AndHttp2AndHttp3;
        listenOptions.UseHttps();
    });
});
```

## System.Text.Json Improvements

### IAsyncEnumerable Serialization

```csharp
app.MapGet("/products/stream", async (AppDbContext db) =>
{
    async IAsyncEnumerable<Product> GetProducts()
    {
        await foreach (var product in db.Products.AsAsyncEnumerable())
        {
            yield return product;
        }
    }

    return Results.Ok(GetProducts());
});
```

### Source Generators

```csharp
[JsonSerializable(typeof(WeatherForecast))]
[JsonSerializable(typeof(List<WeatherForecast>))]
public partial class AppJsonContext : JsonSerializerContext
{
}

// Usage with improved performance
var json = JsonSerializer.Serialize(forecast, AppJsonContext.Default.WeatherForecast);
var forecast = JsonSerializer.Deserialize(json, AppJsonContext.Default.WeatherForecast);
```

## Improved Nullable Reference Types

Better null-state analysis:

```csharp
public class CustomerService
{
    private readonly ILogger<CustomerService> _logger;

    public CustomerService(ILogger<CustomerService> logger)
    {
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<Customer?> GetCustomerAsync(string id)
    {
        ArgumentNullException.ThrowIfNull(id);

        var customer = await _repository.FindAsync(id);

        if (customer is not null)
        {
            _logger.LogInformation("Found customer {Id}", customer.Id);
        }

        return customer;
    }
}
```

## Azure SDK Integration

Simplified Azure SDK configuration:

```csharp
var builder = WebApplication.CreateBuilder(args);

// Azure clients are now easier to configure
builder.Services.AddAzureClients(clientBuilder =>
{
    clientBuilder.AddBlobServiceClient(builder.Configuration["Storage:ConnectionString"]);
    clientBuilder.AddServiceBusClient(builder.Configuration["ServiceBus:ConnectionString"]);

    // Use DefaultAzureCredential for managed identity
    clientBuilder.UseCredential(new DefaultAzureCredential());
});
```

## Performance Improvements

.NET 6 brings significant performance gains:

```csharp
// Benchmark results for common operations
// String operations: 30% faster
// LINQ: 20-40% faster
// JSON serialization: 40% faster with source generators
// Startup time: 25% reduction
```

## Conclusion

.NET 6 Preview brings substantial improvements for Azure development. Minimal APIs reduce boilerplate for microservices, new language features improve code readability, and performance enhancements benefit cloud applications where efficiency translates to cost savings. Start experimenting with these features today to prepare for the November 2021 release.

## References

- [.NET 6 Preview Announcements](https://devblogs.microsoft.com/dotnet/)
- [What's New in .NET 6](https://docs.microsoft.com/en-us/dotnet/core/whats-new/dotnet-6)
