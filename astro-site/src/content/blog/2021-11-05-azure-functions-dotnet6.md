---
title: "Azure Functions with .NET 6: In-Process and Isolated Worker Models"
author: Michael John Pena
draft: false
date: 2021-11-05
tags:
  - Azure
  - Azure Functions
  - .NET
  - Serverless
  - Cloud

---

I wrote "Azure Functions with .NET 6: In-Process and Isolated Worker Models" to share practical, production-minded guidance on this topic.

## In-Process vs Isolated Worker

With .NET 6, you have two hosting models:

**In-Process**: Functions run in the same process as the Functions host
- Tighter integration with bindings
- Better cold start performance
- Limited to Functions-supported .NET versions

**Isolated Worker**: Functions run in a separate worker process
- Full control over dependencies
- Use any .NET version
- Slightly higher latency

## Creating an In-Process Function

```bash
# Create in-process function project
func init InProcessFunctions --worker-runtime dotnet
cd InProcessFunctions

# Add an HTTP trigger
func new --name Hello --template "HTTP trigger"
```

The project file:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net6.0</TargetFramework>
    <AzureFunctionsVersion>v4</AzureFunctionsVersion>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Sdk.Functions" Version="4.0.1" />
  </ItemGroup>
</Project>
```

A basic HTTP function:

```csharp
using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace InProcessFunctions;

public static class Hello
{
    [FunctionName("Hello")]
    public static async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Function, "get", "post")] HttpRequest req,
        ILogger log)
    {
        log.LogInformation("C# HTTP trigger function processed a request.");

        string name = req.Query["name"];

        string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
        dynamic data = JsonConvert.DeserializeObject(requestBody);
        name = name ?? data?.name;

        return name != null
            ? new OkObjectResult($"Hello, {name}. Welcome to Azure Functions on .NET 6!")
            : new BadRequestObjectResult("Please pass a name on the query string or in the request body");
    }
}
```

## Creating an Isolated Worker Function

```bash
# Create isolated worker project
func init IsolatedFunctions --worker-runtime dotnet-isolated
cd IsolatedFunctions

# Add an HTTP trigger
func new --name Hello --template "HTTP trigger"
```

The project file for isolated worker:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net6.0</TargetFramework>
    <AzureFunctionsVersion>v4</AzureFunctionsVersion>
    <OutputType>Exe</OutputType>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Azure.Functions.Worker" Version="1.6.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Sdk" Version="1.3.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.Http" Version="3.0.13" />
  </ItemGroup>
</Project>
```

Program.cs with dependency injection:

```csharp
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Azure.Functions.Worker.Configuration;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults(builder =>
    {
        // Add middleware
        builder.UseMiddleware<ExceptionHandlingMiddleware>();
    })
    .ConfigureServices(services =>
    {
        // Register services
        services.AddSingleton<IWeatherService, WeatherService>();
        services.AddHttpClient();

        // Add Application Insights
        services.AddApplicationInsightsTelemetryWorkerService();
    })
    .Build();

host.Run();
```

HTTP function in isolated model:

```csharp
using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace IsolatedFunctions;

public class Hello
{
    private readonly ILogger _logger;
    private readonly IWeatherService _weatherService;

    public Hello(ILoggerFactory loggerFactory, IWeatherService weatherService)
    {
        _logger = loggerFactory.CreateLogger<Hello>();
        _weatherService = weatherService;
    }

    [Function("Hello")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Function, "get", "post")] HttpRequestData req)
    {
        _logger.LogInformation("C# HTTP trigger function processed a request.");

        var queryParams = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
        string name = queryParams["name"] ?? "World";

        var weather = await _weatherService.GetCurrentWeather();

        var response = req.CreateResponse(HttpStatusCode.OK);
        await response.WriteAsJsonAsync(new
        {
            Message = $"Hello, {name}!",
            Weather = weather,
            Runtime = ".NET 6 Isolated Worker"
        });

        return response;
    }
}

public interface IWeatherService
{
    Task<WeatherInfo> GetCurrentWeather();
}

public class WeatherService : IWeatherService
{
    private readonly HttpClient _httpClient;

    public WeatherService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<WeatherInfo> GetCurrentWeather()
    {
        // Implementation
        return new WeatherInfo { Temperature = 22, Condition = "Sunny" };
    }
}

public record WeatherInfo
{
    public int Temperature { get; init; }
    public string Condition { get; init; } = "";
}
```

## Custom Middleware

Isolated worker functions support middleware:

```csharp
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
            _logger.LogInformation("Function {Name} starting", context.FunctionDefinition.Name);

            await next(context);

            _logger.LogInformation("Function {Name} completed", context.FunctionDefinition.Name);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error in function {Name}", context.FunctionDefinition.Name);

            // Handle HTTP responses
            var httpReqData = await context.GetHttpRequestDataAsync();
            if (httpReqData != null)
            {
                var response = httpReqData.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "An error occurred" });

                var invocationResult = context.GetInvocationResult();
                invocationResult.Value = response;
            }
            else
            {
                throw;
            }
        }
    }
}
```

## Timer Trigger with .NET 6 Features

```csharp
public class ScheduledTasks
{
    private readonly ILogger _logger;
    private readonly HttpClient _httpClient;

    public ScheduledTasks(ILoggerFactory loggerFactory, IHttpClientFactory httpClientFactory)
    {
        _logger = loggerFactory.CreateLogger<ScheduledTasks>();
        _httpClient = httpClientFactory.CreateClient();
    }

    [Function("DailyReport")]
    public async Task RunDailyReport(
        [TimerTrigger("0 0 8 * * *")] TimerInfo timer)
    {
        _logger.LogInformation("Daily report started at: {time}", DateTime.Now);

        // Using C# 10 file-scoped namespaces and records
        var report = await GenerateReport();

        // Using .NET 6 DateOnly
        var reportDate = DateOnly.FromDateTime(DateTime.Today);

        _logger.LogInformation("Report for {date}: {count} items processed",
            reportDate, report.ItemCount);

        if (timer.ScheduleStatus is not null)
        {
            _logger.LogInformation("Next occurrence: {next}",
                timer.ScheduleStatus.Next);
        }
    }

    private async Task<ReportData> GenerateReport()
    {
        // Generate report logic
        await Task.Delay(100);
        return new ReportData(ItemCount: 42, GeneratedAt: DateTime.UtcNow);
    }
}

public record ReportData(int ItemCount, DateTime GeneratedAt);
```

## Queue Trigger with Output Bindings

```csharp
public class QueueProcessor
{
    private readonly ILogger _logger;

    public QueueProcessor(ILoggerFactory loggerFactory)
    {
        _logger = loggerFactory.CreateLogger<QueueProcessor>();
    }

    [Function("ProcessOrder")]
    [QueueOutput("processed-orders")]
    public async Task<ProcessedOrder?> Run(
        [QueueTrigger("incoming-orders")] Order order)
    {
        _logger.LogInformation("Processing order {OrderId}", order.Id);

        // Validate order using pattern matching
        if (order is not { Id: > 0, Items.Count: > 0 })
        {
            _logger.LogWarning("Invalid order received");
            return null;
        }

        // Process the order
        var total = order.Items.Sum(item => item.Price * item.Quantity);

        var processed = new ProcessedOrder
        {
            OrderId = order.Id,
            Total = total,
            ProcessedAt = DateTime.UtcNow,
            Status = total > 1000 ? "HighValue" : "Standard"
        };

        _logger.LogInformation("Order {OrderId} processed. Total: {Total}",
            order.Id, total);

        return processed;
    }
}

public record Order
{
    public int Id { get; init; }
    public List<OrderItem> Items { get; init; } = new();
}

public record OrderItem
{
    public string ProductName { get; init; } = "";
    public decimal Price { get; init; }
    public int Quantity { get; init; }
}

public record ProcessedOrder
{
    public int OrderId { get; init; }
    public decimal Total { get; init; }
    public DateTime ProcessedAt { get; init; }
    public string Status { get; init; } = "";
}
```

## Durable Functions on .NET 6

```csharp
public class OrderOrchestration
{
    [Function("OrderOrchestration")]
    public static async Task<OrderResult> RunOrchestrator(
        [OrchestrationTrigger] TaskOrchestrationContext context)
    {
        var order = context.GetInput<Order>()!;

        // Fan-out/fan-in pattern
        var validationResult = await context.CallActivityAsync<bool>(
            "ValidateOrder", order);

        if (!validationResult)
        {
            return new OrderResult(false, "Validation failed");
        }

        // Process items in parallel
        var processingTasks = order.Items
            .Select(item => context.CallActivityAsync<ItemResult>("ProcessItem", item))
            .ToList();

        var results = await Task.WhenAll(processingTasks);

        // Final step
        var finalResult = await context.CallActivityAsync<OrderResult>(
            "FinalizeOrder",
            new FinalizeRequest(order.Id, results));

        return finalResult;
    }

    [Function("ValidateOrder")]
    public static bool ValidateOrder([ActivityTrigger] Order order, FunctionContext context)
    {
        var logger = context.GetLogger("ValidateOrder");
        logger.LogInformation("Validating order {OrderId}", order.Id);

        return order.Items.Count > 0 && order.Items.All(i => i.Quantity > 0);
    }

    [Function("ProcessItem")]
    public static ItemResult ProcessItem([ActivityTrigger] OrderItem item, FunctionContext context)
    {
        var logger = context.GetLogger("ProcessItem");
        logger.LogInformation("Processing item {ProductName}", item.ProductName);

        return new ItemResult(item.ProductName, item.Price * item.Quantity);
    }

    [Function("FinalizeOrder")]
    public static OrderResult FinalizeOrder(
        [ActivityTrigger] FinalizeRequest request,
        FunctionContext context)
    {
        var logger = context.GetLogger("FinalizeOrder");
        var total = request.Results.Sum(r => r.Total);
        logger.LogInformation("Order {OrderId} finalized. Total: {Total}",
            request.OrderId, total);

        return new OrderResult(true, $"Order completed. Total: {total:C}");
    }
}

public record ItemResult(string ProductName, decimal Total);
public record FinalizeRequest(int OrderId, ItemResult[] Results);
public record OrderResult(bool Success, string Message);
```

## Local Development

Configure local settings:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated",
    "APPLICATIONINSIGHTS_CONNECTION_STRING": "InstrumentationKey=..."
  }
}
```

Run locally:

```bash
# Start Azurite for local storage emulation
azurite --silent --location ./azurite --debug ./azurite/debug.log &

# Start the function app
func start
```

.NET 6 brings modern C# features and improved performance to Azure Functions. Whether you choose in-process for tighter integration or isolated worker for maximum flexibility, you'll benefit from the improvements in .NET 6.

## Resources

- [Azure Functions .NET 6 Guide](https://docs.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide)
- [In-Process vs Isolated Comparison](https://docs.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-in-process-differences)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
