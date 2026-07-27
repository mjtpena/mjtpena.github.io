---
title: "Application Insights: Full-Stack Application Monitoring"
author: Michael John Peña
draft: false
date: 2020-10-22
tags:
  - Azure
  - Monitoring
  - Application Insights
  - DevOps

---

I wrote "Application Insights: Full-Stack Application Monitoring" to share practical, production-minded guidance on this topic.

## SDK Setup (.NET)

```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);

// Add Application Insights
builder.Services.AddApplicationInsightsTelemetry();

var app = builder.Build();
```

```json
// appsettings.json
{
  "ApplicationInsights": {
    "ConnectionString": "InstrumentationKey=xxx;IngestionEndpoint=https://eastus-1.in.applicationinsights.azure.com/"
  }
}
```

## Custom Telemetry

```csharp
public class OrderService
{
    private readonly TelemetryClient _telemetry;

    public OrderService(TelemetryClient telemetry)
    {
        _telemetry = telemetry;
    }

    public async Task ProcessOrder(Order order)
    {
        // Track custom event
        _telemetry.TrackEvent("OrderProcessed", new Dictionary<string, string>
        {
            { "OrderId", order.Id },
            { "CustomerId", order.CustomerId }
        }, new Dictionary<string, double>
        {
            { "Amount", order.Total }
        });

        // Track custom metric
        _telemetry.GetMetric("OrdersPerMinute").TrackValue(1);

        // Track dependency manually
        using var operation = _telemetry.StartOperation<DependencyTelemetry>("PaymentGateway");
        try
        {
            await ProcessPayment(order);
            operation.Telemetry.Success = true;
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

## JavaScript SDK

```html
<script type="text/javascript">
!function(T,l,y){/* Application Insights snippet */}(window,document,{
    src: "https://js.monitor.azure.com/scripts/b/ai.2.min.js",
    cfg: {
        connectionString: "InstrumentationKey=xxx"
    }
});
</script>
```

```javascript
// Track custom events
appInsights.trackEvent({ name: "ButtonClicked" });

// Track page views
appInsights.trackPageView({ name: "ProductPage" });

// Track exceptions
appInsights.trackException({ exception: new Error("Something went wrong") });
```

## KQL Queries

```kusto
// Request duration percentiles
requests
| where timestamp > ago(1h)
| summarize percentiles(duration, 50, 95, 99) by bin(timestamp, 5m)
| render timechart

// Failed requests by endpoint
requests
| where success == false
| summarize count() by name, resultCode
| order by count_ desc

// Slow dependencies
dependencies
| where duration > 1000
| summarize count(), avg(duration) by target, name
| order by count_ desc

// Exception trends
exceptions
| summarize count() by type, bin(timestamp, 1h)
| render timechart

// User sessions
customEvents
| where name == "OrderCompleted"
| summarize Orders = count(), Revenue = sum(todouble(customDimensions.Amount))
    by bin(timestamp, 1d)
```

## Availability Tests

```bash
# Create availability test
az monitor app-insights web-test create \
    --resource-group myRG \
    --app myAppInsights \
    --web-test-name "Homepage Check" \
    --location "East US" \
    --frequency 300 \
    --timeout 120 \
    --web-test-kind "ping" \
    --synthetic-monitor-id "homepage-check" \
    --request-url "https://myapp.com" \
    --expected-http-status-code 200
```

## Smart Detection

Automatic anomaly detection for:
- Failure rate spikes
- Performance degradation
- Memory leaks
- Dependency failures

## Application Map

Visual representation of:
- Components and their dependencies
- Health status per component
- Failure rates
- Performance metrics

## Live Metrics Stream

Real-time telemetry:
- Incoming requests
- Dependency calls
- Exceptions
- Performance counters

Application Insights is essential for production observability.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
