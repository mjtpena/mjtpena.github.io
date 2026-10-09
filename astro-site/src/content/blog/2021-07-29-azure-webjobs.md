---
title: Azure WebJobs for Background Processing
author: Michael John Peña
draft: false
date: 2021-07-29
url: /blog/azure-webjobs/
tags:
  - Azure
  - App Service
  - Background Processing
  - WebJobs
  - Cloud
---

## WebJobs vs Azure Functions

Understanding when to use each:

| Feature | WebJobs | Azure Functions |
|---------|---------|-----------------|
| Hosting | Part of App Service | Standalone or App Service |
| Scaling | With App Service plan | Independent scaling |
| Pricing | Included in App Service | Consumption or dedicated |
| Triggers | SDK-based | Native bindings |
| Continuous jobs | Supported | Not typical |
| Best for | Long-running, continuous | Event-driven, short tasks |

## Creating a WebJob

Build a .NET WebJob for background processing:

```csharp
// Program.cs
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Azure.WebJobs;

var builder = new HostBuilder();

builder.ConfigureWebJobs(b =>
{
    b.AddAzureStorageCoreServices();
    b.AddAzureStorage();
    b.AddServiceBus();
    b.AddTimers();
});

builder.ConfigureServices(services =>
{
    services.AddSingleton<IOrderProcessor, OrderProcessor>();
    services.AddSingleton<INotificationService, NotificationService>();

    services.AddHttpClient<IExternalApiClient, ExternalApiClient>(client =>
    {
        client.BaseAddress = new Uri("https://api.external.com");
        client.Timeout = TimeSpan.FromSeconds(30);
    });
});

builder.ConfigureLogging((context, logging) =>
{
    logging.AddConsole();
    logging.AddApplicationInsights();
});

var host = builder.Build();
await host.RunAsync();
```

```csharp
// Functions.cs
using Microsoft.Azure.WebJobs;
using Microsoft.Extensions.Logging;

public class Functions
{
    private readonly IOrderProcessor _orderProcessor;
    private readonly INotificationService _notificationService;

    public Functions(
        IOrderProcessor orderProcessor,
        INotificationService notificationService)
    {
        _orderProcessor = orderProcessor;
        _notificationService = notificationService;
    }

    // Queue-triggered function
    [FunctionName("ProcessOrder")]
    public async Task ProcessOrder(
        [QueueTrigger("orders", Connection = "StorageConnection")] OrderMessage message,
        ILogger log)
    {
        log.LogInformation("Processing order {OrderId}", message.OrderId);

        try
        {
            await _orderProcessor.ProcessAsync(message);
            log.LogInformation("Order {OrderId} processed successfully", message.OrderId);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Failed to process order {OrderId}", message.OrderId);
            throw; // Will retry based on queue settings
        }
    }

    // Timer-triggered function (runs every hour)
    [FunctionName("HourlyCleanup")]
    public async Task HourlyCleanup(
        [TimerTrigger("0 0 * * * *")] TimerInfo timer,
        ILogger log)
    {
        log.LogInformation("Running hourly cleanup at {Time}", DateTime.UtcNow);

        var deletedCount = await _orderProcessor.CleanupStaleOrdersAsync();
        log.LogInformation("Cleaned up {Count} stale orders", deletedCount);
    }

    // Service Bus triggered function
    [FunctionName("ProcessNotification")]
    public async Task ProcessNotification(
        [ServiceBusTrigger("notifications", Connection = "ServiceBusConnection")] NotificationMessage message,
        ILogger log)
    {
        log.LogInformation("Sending notification to {Recipient}", message.Recipient);

        await _notificationService.SendAsync(message);
    }

    // Blob-triggered function
    [FunctionName("ProcessUploadedFile")]
    public async Task ProcessUploadedFile(
        [BlobTrigger("uploads/{name}", Connection = "StorageConnection")] Stream blob,
        string name,
        [Blob("processed/{name}", FileAccess.Write, Connection = "StorageConnection")] Stream output,
        ILogger log)
    {
        log.LogInformation("Processing uploaded file: {Name}", name);

        // Process the blob
        await ProcessBlobAsync(blob, output);

        log.LogInformation("File processed: {Name}", name);
    }
}
```

## Continuous WebJob

Create a continuously running WebJob:

```csharp
// ContinuousJob.cs
using System.Threading;

public class ContinuousJob
{
    private readonly IMessageProcessor _processor;
    private readonly ILogger<ContinuousJob> _logger;

    public ContinuousJob(
        IMessageProcessor processor,
        ILogger<ContinuousJob> logger)
    {
        _processor = processor;
        _logger = logger;
    }

    [NoAutomaticTrigger]
    public async Task Run(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Continuous job started");

        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                // Poll for work
                var messages = await _processor.GetPendingMessagesAsync();

                foreach (var message in messages)
                {
                    if (cancellationToken.IsCancellationRequested)
                        break;

                    await _processor.ProcessAsync(message);
                }

                // Wait before next poll
                await Task.Delay(TimeSpan.FromSeconds(10), cancellationToken);
            }
            catch (OperationCanceledException)
            {
                _logger.LogInformation("Job cancellation requested");
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in continuous job");
                await Task.Delay(TimeSpan.FromSeconds(30), cancellationToken);
            }
        }

        _logger.LogInformation("Continuous job stopped");
    }
}
```

## Deploying WebJobs

Deploy WebJobs with your App Service:

```bash
# WebJob deployment structure
# wwwroot/
#   App_Data/
#     jobs/
#       continuous/
#         MyWebJob/
#           run.cmd
#           MyWebJob.exe
#       triggered/
#         ScheduledJob/
#           settings.job
#           run.cmd
#           ScheduledJob.exe

# Create deployment package
dotnet publish -c Release -o ./publish

# Create zip for WebJob
cd publish
zip -r ../webjob.zip .

# Deploy using Azure CLI
az webapp deployment source config-zip \
    --resource-group rg-app \
    --name mywebapp \
    --src webjob.zip
```

Settings file for triggered WebJob:

```json
// settings.job
{
    "schedule": "0 */5 * * * *",
    "is_singleton": true,
    "stopping_wait_time": 60
}
```

## Terraform Deployment

Deploy WebJobs with Terraform:

```hcl
# App Service with WebJobs
resource "azurerm_app_service" "main" {
  name                = "mywebapp"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  app_service_plan_id = azurerm_app_service_plan.main.id

  site_config {
    always_on                = true  # Required for continuous WebJobs
    dotnet_framework_version = "v6.0"
  }

  app_settings = {
    "WEBJOBS_IDLE_TIMEOUT"         = "3600"
    "WEBJOBS_HISTORY_SIZE"         = "50"
    "SCM_COMMAND_IDLE_TIMEOUT"     = "3600"
    "WEBJOBS_STOPPED"              = "0"
    "StorageConnection"            = azurerm_storage_account.main.primary_connection_string
    "ServiceBusConnection"         = azurerm_servicebus_namespace.main.default_primary_connection_string
    "APPINSIGHTS_INSTRUMENTATIONKEY" = azurerm_application_insights.main.instrumentation_key
  }

  connection_string {
    name  = "Database"
    type  = "SQLAzure"
    value = "Server=${azurerm_sql_server.main.fully_qualified_domain_name};Database=${azurerm_sql_database.main.name};User Id=${var.sql_admin_username};Password=${var.sql_admin_password};"
  }
}

# App Service Plan (must support Always On)
resource "azurerm_app_service_plan" "main" {
  name                = "asp-main"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  sku {
    tier = "Standard"  # Basic or higher required for continuous WebJobs
    size = "S1"
  }
}
```

## Error Handling and Retry

Implement robust error handling:

```csharp
public class Functions
{
    // Configure retry with exponential backoff
    [FunctionName("ProcessWithRetry")]
    [ExponentialBackoffRetry(5, "00:00:01", "00:01:00")]
    public async Task ProcessWithRetry(
        [QueueTrigger("work-items")] WorkItem item,
        int dequeueCount,
        ILogger log)
    {
        log.LogInformation("Processing item {Id}, attempt {Attempt}",
            item.Id, dequeueCount);

        try
        {
            await ProcessItemAsync(item);
        }
        catch (TransientException ex) when (dequeueCount < 5)
        {
            log.LogWarning(ex, "Transient error, will retry");
            throw; // Let the queue handle retry
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Failed to process item {Id}", item.Id);

            // Move to poison queue or dead letter
            await MoveToDeadLetterAsync(item, ex);
        }
    }

    // Handle poison messages
    [FunctionName("ProcessPoisonMessage")]
    public async Task ProcessPoisonMessage(
        [QueueTrigger("work-items-poison")] WorkItem item,
        ILogger log)
    {
        log.LogWarning("Processing poison message {Id}", item.Id);

        // Log for investigation
        await LogPoisonMessageAsync(item);

        // Notify operations team
        await NotifyOperationsAsync(item);
    }
}

// Custom retry attribute
public class ExponentialBackoffRetryAttribute : Attribute
{
    public int MaxRetries { get; }
    public TimeSpan MinBackoff { get; }
    public TimeSpan MaxBackoff { get; }

    public ExponentialBackoffRetryAttribute(
        int maxRetries,
        string minBackoff,
        string maxBackoff)
    {
        MaxRetries = maxRetries;
        MinBackoff = TimeSpan.Parse(minBackoff);
        MaxBackoff = TimeSpan.Parse(maxBackoff);
    }
}
```

## Monitoring WebJobs

Monitor WebJob health and performance:

```csharp
// Add health checks
public class WebJobHealthCheck
{
    private readonly ILogger<WebJobHealthCheck> _logger;
    private static DateTime _lastSuccessfulRun;
    private static int _processedCount;

    [FunctionName("RecordSuccess")]
    public void RecordSuccess(string jobName)
    {
        _lastSuccessfulRun = DateTime.UtcNow;
        Interlocked.Increment(ref _processedCount);
    }

    [FunctionName("HealthCheck")]
    public async Task<IActionResult> HealthCheck(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "health")] HttpRequest req)
    {
        var timeSinceLastRun = DateTime.UtcNow - _lastSuccessfulRun;

        var health = new
        {
            status = timeSinceLastRun < TimeSpan.FromMinutes(5) ? "healthy" : "unhealthy",
            lastSuccessfulRun = _lastSuccessfulRun,
            processedCount = _processedCount,
            uptime = DateTime.UtcNow - Process.GetCurrentProcess().StartTime
        };

        return new OkObjectResult(health);
    }
}
```

```python
# Query WebJob logs in Log Analytics
query = """
AppServiceConsoleLogs
| where TimeGenerated > ago(24h)
| where ResultDescription contains "WebJob"
| project TimeGenerated, ResultDescription, Level
| order by TimeGenerated desc
| take 100
"""

# Query WebJob execution metrics
metrics_query = """
customMetrics
| where TimeGenerated > ago(24h)
| where name startswith "WebJob"
| summarize avg(value), max(value), min(value) by name, bin(TimeGenerated, 1h)
| render timechart
"""
```

## Conclusion

Azure WebJobs remain a powerful option for background processing, especially when you want tight integration with your App Service application. They excel at continuous jobs, long-running processes, and scenarios where you need the simplicity of running alongside your web application.

Key considerations include ensuring your App Service plan supports Always On for continuous jobs, implementing proper error handling and retry logic, and monitoring job health. For event-driven, independently scalable workloads, consider Azure Functions instead.
