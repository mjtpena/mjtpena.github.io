---
title: "Application Performance Monitoring with Azure Application Insights"
description: "First thing I do on any new Azure-hosted application I'm asked to look at: open Application Insights and see what's actually happening. Half the time, \"the…"
author: Michael John Peña
draft: false
date: 2020-08-11
tags:
  - Azure
  - Monitoring
  - Application Insights
  - DevOps
---

First thing I do on any new Azure-hosted application I'm asked to look at: open Application Insights and see what's actually happening. Half the time, "the app is slow" turns out to be a single SQL query running 800ms because of a missing index. Without instrumentation you're guessing. The setup is cheap, and once you've lived through one production incident *with* App Insights data versus one *without*, you stop arguing about whether to enable it.

## Setting Up Application Insights

```bash
# Create Application Insights resource
az monitor app-insights component create \
    --app myapp-insights \
    --location australiaeast \
    --resource-group rg-monitoring \
    --kind web

# Get the instrumentation key
az monitor app-insights component show \
    --app myapp-insights \
    --resource-group rg-monitoring \
    --query instrumentationKey
```

## .NET Core Integration

Add the NuGet package:

```bash
dotnet add package Microsoft.ApplicationInsights.AspNetCore
```

Configure in `Startup.cs`:

```csharp
public class Startup
{
    public void ConfigureServices(IServiceCollection services)
    {
        services.AddApplicationInsightsTelemetry();

        // Or with configuration options
        services.AddApplicationInsightsTelemetry(options =>
        {
            options.EnableAdaptiveSampling = true;
            options.EnableQuickPulseMetricStream = true;
            options.EnableDebugLogger = false;
        });
    }
}
```

In `appsettings.json`:

```json
{
  "ApplicationInsights": {
    "InstrumentationKey": "your-instrumentation-key"
  }
}
```

## Custom Telemetry

Track custom events and metrics:

```csharp
public class OrderService
{
    private readonly TelemetryClient _telemetry;

    public OrderService(TelemetryClient telemetry)
    {
        _telemetry = telemetry;
    }

    public async Task<Order> CreateOrderAsync(OrderRequest request)
    {
        var stopwatch = Stopwatch.StartNew();

        try
        {
            var order = await ProcessOrderAsync(request);

            // Track custom event
            _telemetry.TrackEvent("OrderCreated", new Dictionary<string, string>
            {
                { "OrderId", order.Id.ToString() },
                { "CustomerId", request.CustomerId },
                { "ProductCount", request.Items.Count.ToString() }
            });

            // Track custom metric
            _telemetry.TrackMetric("OrderValue", order.TotalAmount);

            return order;
        }
        catch (Exception ex)
        {
            _telemetry.TrackException(ex, new Dictionary<string, string>
            {
                { "Operation", "CreateOrder" },
                { "CustomerId", request.CustomerId }
            });
            throw;
        }
        finally
        {
            stopwatch.Stop();
            _telemetry.TrackMetric("OrderProcessingTime", stopwatch.ElapsedMilliseconds);
        }
    }
}
```

## Dependency Tracking

Track external service calls:

```csharp
public class ExternalApiService
{
    private readonly HttpClient _httpClient;
    private readonly TelemetryClient _telemetry;

    public async Task<ApiResponse> CallExternalApiAsync(string endpoint)
    {
        using var operation = _telemetry.StartOperation<DependencyTelemetry>("ExternalAPI");
        operation.Telemetry.Type = "HTTP";
        operation.Telemetry.Target = endpoint;

        try
        {
            var response = await _httpClient.GetAsync(endpoint);
            operation.Telemetry.Success = response.IsSuccessStatusCode;
            operation.Telemetry.ResultCode = ((int)response.StatusCode).ToString();

            return await response.Content.ReadAsAsync<ApiResponse>();
        }
        catch (Exception ex)
        {
            operation.Telemetry.Success = false;
            _telemetry.TrackException(ex);
            throw;
        }
    }
}
```

## Custom Telemetry Initializer

Add custom properties to all telemetry:

```csharp
public class CustomTelemetryInitializer : ITelemetryInitializer
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public CustomTelemetryInitializer(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    public void Initialize(ITelemetry telemetry)
    {
        var context = _httpContextAccessor.HttpContext;
        if (context == null) return;

        // Add custom properties
        if (telemetry is ISupportProperties propTelemetry)
        {
            propTelemetry.Properties["Environment"] = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");

            if (context.User.Identity?.IsAuthenticated == true)
            {
                propTelemetry.Properties["UserId"] = context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            }
        }

        // Set cloud role for better filtering
        telemetry.Context.Cloud.RoleName = "MyApp-API";
    }
}

// Register in Startup.cs
services.AddSingleton<ITelemetryInitializer, CustomTelemetryInitializer>();
```

## Availability Tests

Create availability tests via Azure CLI:

```bash
az monitor app-insights web-test create \
    --resource-group rg-monitoring \
    --app-insights myapp-insights \
    --web-test-name "Homepage-Ping" \
    --web-test-kind "ping" \
    --location "Australia East" \
    --url "https://myapp.azurewebsites.net" \
    --frequency 300 \
    --timeout 30
```

## KQL Queries for Insights

Query your telemetry data:

```kusto
// Failed requests by endpoint
requests
| where success == false
| summarize count() by name, resultCode
| order by count_ desc

// Slow dependencies
dependencies
| where duration > 1000
| summarize avg(duration), count() by target, name
| order by avg_duration desc

// Exception trends
exceptions
| summarize count() by type, bin(timestamp, 1h)
| render timechart

// User sessions by country
requests
| summarize sessions = dcount(session_Id) by client_CountryOrRegion
| order by sessions desc
```

## Alerts Configuration

```bash
# Create an alert for high failure rate
az monitor metrics alert create \
    --name "High-Failure-Rate" \
    --resource-group rg-monitoring \
    --scopes "/subscriptions/{sub}/resourceGroups/rg-monitoring/providers/microsoft.insights/components/myapp-insights" \
    --condition "avg requests/failed > 10" \
    --window-size 5m \
    --evaluation-frequency 1m \
    --action-group "/subscriptions/{sub}/resourceGroups/rg-monitoring/providers/microsoft.insights/actionGroups/ops-team"
```

## Sampling Configuration

For high-volume applications:

```csharp
services.AddApplicationInsightsTelemetry(options =>
{
    options.EnableAdaptiveSampling = true;
});

// Or configure fixed-rate sampling
services.Configure<TelemetryConfiguration>(config =>
{
    var builder = config.DefaultTelemetrySink.TelemetryProcessorChainBuilder;
    builder.UseSampling(10); // 10% of telemetry
    builder.Build();
});
```

Application Insights provides the visibility needed to maintain application health and quickly diagnose issues, essential for teams operating remotely.

A pricing word of warning: at scale, ingestion is the cost. A chatty service that logs every cache hit can quietly run up a bill that exceeds the compute it monitors. Keep adaptive sampling on by default, and audit any custom telemetry with the same care you'd audit a database write — it's all going to a billed log store.
