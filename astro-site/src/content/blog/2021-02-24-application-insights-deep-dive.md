---
title: Deep Dive into Application Insights
description: "Application Insights is the monitoring tool that pays you back in proportion to how much you invest in it. Out of the box you get…"
author: Michael John Peña
draft: false
date: 2021-02-24
url: /blog/application-insights-deep-dive/
tags:
  - Azure
  - Application Insights
  - Monitoring
  - APM
  - Observability
---

Application Insights is the monitoring tool that pays you back in proportion to how much you invest in it. Out of the box you get request/dependency/exception tracking and a basic application map. A few hours of instrumentation later—custom events, custom metrics, the right sampling rate, a sensible naming convention on telemetry—and you have a production observability story that can answer "which version of the checkout flow has the higher cart abandonment?" not just "was the server up?" Today's post is the deep dive: sampling strategies, custom telemetry patterns, the queries I keep in my back pocket, and the dashboard setup that makes an on-call rotation survivable.

## Setting Up Application Insights

### Create with Azure CLI

```bash
# Create Application Insights resource
az monitor app-insights component create \
    --app myapp-insights \
    --resource-group rg-monitoring \
    --location eastus \
    --kind web \
    --application-type web \
    --retention-time 90

# Get instrumentation key
az monitor app-insights component show \
    --app myapp-insights \
    --resource-group rg-monitoring \
    --query instrumentationKey
```

### SDK Integration (.NET)

```csharp
// Program.cs (.NET 6+)
using Microsoft.ApplicationInsights.AspNetCore.Extensions;

var builder = WebApplication.CreateBuilder(args);

// Add Application Insights
builder.Services.AddApplicationInsightsTelemetry(new ApplicationInsightsServiceOptions
{
    ConnectionString = builder.Configuration["ApplicationInsights:ConnectionString"],
    EnableAdaptiveSampling = true,
    EnableQuickPulseMetricStream = true,
    EnableHeartbeat = true
});

// Configure telemetry initializers
builder.Services.AddSingleton<ITelemetryInitializer, CustomTelemetryInitializer>();

var app = builder.Build();
```

Custom Telemetry Initializer:

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
            propTelemetry.Properties["Version"] = Assembly.GetExecutingAssembly().GetName().Version?.ToString();

            // Add user info if authenticated
            if (context.User.Identity?.IsAuthenticated == true)
            {
                telemetry.Context.User.AuthenticatedUserId = context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            }

            // Add correlation ID
            if (context.Request.Headers.TryGetValue("X-Correlation-ID", out var correlationId))
            {
                propTelemetry.Properties["CorrelationId"] = correlationId;
            }
        }
    }
}
```

### SDK Integration (Python)

```python
from opencensus.ext.azure import metrics_exporter
from opencensus.ext.azure.trace_exporter import AzureExporter
from opencensus.ext.flask.flask_middleware import FlaskMiddleware
from opencensus.trace.samplers import ProbabilitySampler
from opencensus.trace import config_integration
from applicationinsights import TelemetryClient
import os

# Configuration
connection_string = os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING")

# Initialize Flask with Application Insights
from flask import Flask, request

app = Flask(__name__)

# Add middleware for automatic request tracking
FlaskMiddleware(
    app,
    exporter=AzureExporter(connection_string=connection_string),
    sampler=ProbabilitySampler(rate=1.0)
)

# Manual telemetry client for custom events
tc = TelemetryClient(connection_string.split("InstrumentationKey=")[1].split(";")[0])

@app.route('/api/process')
def process():
    # Track custom event
    tc.track_event('ProcessStarted', {
        'user_id': request.args.get('user_id'),
        'operation': 'data_processing'
    })

    # Track custom metric
    tc.track_metric('ProcessingTime', 150, properties={'operation': 'data_processing'})

    # Track dependency
    with tc.track_dependency('CustomService', 'HTTP', 'api.example.com', '/data'):
        # Call external service
        result = call_external_service()

    tc.flush()
    return result

# Exception tracking
@app.errorhandler(Exception)
def handle_exception(e):
    tc.track_exception()
    tc.flush()
    raise e
```

## Custom Events and Metrics

### .NET Custom Telemetry

```csharp
public class TelemetryService
{
    private readonly TelemetryClient _telemetryClient;
    private readonly ILogger<TelemetryService> _logger;

    public TelemetryService(TelemetryClient telemetryClient, ILogger<TelemetryService> logger)
    {
        _telemetryClient = telemetryClient;
        _logger = logger;
    }

    public void TrackBusinessEvent(string eventName, Dictionary<string, string> properties = null, Dictionary<string, double> metrics = null)
    {
        _telemetryClient.TrackEvent(eventName, properties, metrics);
    }

    public void TrackOrderPlaced(Order order)
    {
        var properties = new Dictionary<string, string>
        {
            ["OrderId"] = order.Id.ToString(),
            ["CustomerId"] = order.CustomerId,
            ["PaymentMethod"] = order.PaymentMethod,
            ["Region"] = order.ShippingAddress.Country
        };

        var metrics = new Dictionary<string, double>
        {
            ["OrderTotal"] = (double)order.Total,
            ["ItemCount"] = order.Items.Count,
            ["DiscountAmount"] = (double)order.Discount
        };

        _telemetryClient.TrackEvent("OrderPlaced", properties, metrics);

        // Track as metric for aggregation
        _telemetryClient.GetMetric("OrderValue", "Region", "PaymentMethod")
            .TrackValue((double)order.Total, order.ShippingAddress.Country, order.PaymentMethod);
    }

    public IDisposable TrackOperation(string operationName)
    {
        var operation = _telemetryClient.StartOperation<RequestTelemetry>(operationName);
        return new OperationScope(operation, _telemetryClient);
    }

    private class OperationScope : IDisposable
    {
        private readonly IOperationHolder<RequestTelemetry> _operation;
        private readonly TelemetryClient _client;
        private readonly Stopwatch _stopwatch;

        public OperationScope(IOperationHolder<RequestTelemetry> operation, TelemetryClient client)
        {
            _operation = operation;
            _client = client;
            _stopwatch = Stopwatch.StartNew();
        }

        public void Dispose()
        {
            _stopwatch.Stop();
            _operation.Telemetry.Duration = _stopwatch.Elapsed;
            _client.StopOperation(_operation);
        }
    }
}
```

### JavaScript SDK

```javascript
// Initialize Application Insights
import { ApplicationInsights } from '@microsoft/applicationinsights-web';

const appInsights = new ApplicationInsights({
    config: {
        connectionString: 'InstrumentationKey=xxx;IngestionEndpoint=xxx',
        enableAutoRouteTracking: true,
        enableCorsCorrelation: true,
        enableRequestHeaderTracking: true,
        enableResponseHeaderTracking: true
    }
});

appInsights.loadAppInsights();

// Track page views automatically
appInsights.trackPageView();

// Custom event tracking
function trackUserAction(action, properties) {
    appInsights.trackEvent({
        name: action,
        properties: properties
    });
}

// Track e-commerce events
function trackPurchase(order) {
    appInsights.trackEvent({
        name: 'Purchase',
        properties: {
            orderId: order.id,
            productCount: order.items.length.toString()
        }
    });

    appInsights.trackMetric({
        name: 'PurchaseValue',
        average: order.total,
        sampleCount: 1
    });
}

// Track errors
window.onerror = function(message, source, lineno, colno, error) {
    appInsights.trackException({
        exception: error,
        properties: {
            source: source,
            line: lineno,
            column: colno
        }
    });
};

// Track user context
function setUserContext(userId, accountId) {
    appInsights.setAuthenticatedUserContext(userId, accountId, true);
}

// Track dependencies
async function callApi(endpoint) {
    const startTime = Date.now();
    let success = true;
    let resultCode = '200';

    try {
        const response = await fetch(endpoint);
        resultCode = response.status.toString();
        success = response.ok;
        return await response.json();
    } catch (error) {
        success = false;
        resultCode = '500';
        throw error;
    } finally {
        appInsights.trackDependencyData({
            id: crypto.randomUUID(),
            name: 'API Call',
            duration: Date.now() - startTime,
            success: success,
            resultCode: resultCode,
            type: 'HTTP',
            target: endpoint
        });
    }
}
```

## Distributed Tracing

```csharp
// Ensure correlation across services
public class OrderService
{
    private readonly HttpClient _httpClient;
    private readonly TelemetryClient _telemetryClient;

    public async Task<Order> CreateOrderAsync(OrderRequest request)
    {
        // Start operation for correlation
        using var operation = _telemetryClient.StartOperation<RequestTelemetry>("CreateOrder");

        try
        {
            // This call will automatically include correlation headers
            var inventory = await _httpClient.GetAsync($"https://inventory-service/check/{request.ProductId}");

            // Process order...
            var order = ProcessOrder(request);

            // Track custom event with operation context
            _telemetryClient.TrackEvent("OrderCreated", new Dictionary<string, string>
            {
                ["OrderId"] = order.Id.ToString()
            });

            operation.Telemetry.Success = true;
            return order;
        }
        catch (Exception ex)
        {
            operation.Telemetry.Success = false;
            _telemetryClient.TrackException(ex);
            throw;
        }
    }
}
```

## Availability Tests

```bash
# Create URL ping test
az monitor app-insights web-test create \
    --resource-group rg-monitoring \
    --app-insights myapp-insights \
    --name "Homepage Availability" \
    --web-test-kind ping \
    --locations "us-ca-sjc-azr" "us-fl-mia-edge" "emea-gb-db3-azr" \
    --frequency 300 \
    --timeout 120 \
    --enabled true \
    --web-test "<WebTest Name='Homepage' Url='https://myapp.azurewebsites.net/' />"
```

Multi-step availability test (Standard test):

```xml
<WebTest Name="CheckoutFlow" Id="xxx" Enabled="True" Timeout="120" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
    <Items>
        <Request Method="GET" Url="https://myapp.com/products" ExpectedHttpStatusCode="200" />
        <Request Method="POST" Url="https://myapp.com/cart/add" ExpectedHttpStatusCode="200">
            <Body ContentType="application/json">{"productId": "123", "quantity": 1}</Body>
        </Request>
        <Request Method="GET" Url="https://myapp.com/checkout" ExpectedHttpStatusCode="200" />
    </Items>
</WebTest>
```

## Querying Application Insights Data

```kusto
// User session analysis
pageViews
| where timestamp > ago(7d)
| summarize PageViews = count(), AvgDuration = avg(duration) by user_Id
| summarize
    TotalUsers = dcount(user_Id),
    AvgPagesPerUser = avg(PageViews),
    AvgSessionDuration = avg(AvgDuration)

// Conversion funnel
let step1 = pageViews | where name == "HomePage" | project session_Id;
let step2 = pageViews | where name == "ProductPage" | project session_Id;
let step3 = customEvents | where name == "AddToCart" | project session_Id;
let step4 = customEvents | where name == "Purchase" | project session_Id;

print
    Step1_Home = toscalar(step1 | count),
    Step2_Product = toscalar(step1 | join kind=inner step2 on session_Id | count),
    Step3_Cart = toscalar(step1 | join kind=inner step2 on session_Id | join kind=inner step3 on session_Id | count),
    Step4_Purchase = toscalar(step1 | join kind=inner step2 on session_Id | join kind=inner step3 on session_Id | join kind=inner step4 on session_Id | count)

// Performance by browser
browserTimings
| where timestamp > ago(24h)
| summarize
    PageLoads = count(),
    AvgNetworkDuration = avg(networkDuration),
    AvgProcessingDuration = avg(processingDuration),
    AvgTotalDuration = avg(totalDuration)
    by client_Browser
| order by PageLoads desc
```

## Best Practices

1. **Use connection strings** instead of instrumentation keys
2. **Enable sampling** to control costs for high-volume applications
3. **Add custom dimensions** for business context
4. **Set up availability tests** for critical endpoints
5. **Configure alerts** on key metrics
6. **Use Live Metrics** for real-time debugging
7. **Implement proper exception handling** with context

## Conclusion

Application Insights provides comprehensive monitoring for modern applications. By combining automatic telemetry collection with custom events and metrics, you can gain deep insights into both technical performance and business outcomes.

Start with automatic instrumentation, then add custom telemetry for business-specific events and metrics.
