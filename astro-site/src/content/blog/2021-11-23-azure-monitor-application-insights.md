---
title: "Azure Monitor Application Insights: Deep Observability for Applications"
author: Michael John Pena
draft: false
date: 2021-11-23
tags:
  - Azure
  - Monitoring
  - Application Insights
  - Observability
  - DevOps

---

I wrote "Azure Monitor Application Insights: Deep Observability for Applications" to share practical, production-minded guidance on this topic.

## What is Application Insights?

Application Insights provides:

- **Automatic instrumentation**: Minimal code changes
- **Distributed tracing**: End-to-end request tracking
- **Live metrics**: Real-time performance data
- **Smart detection**: AI-powered anomaly detection
- **Application Map**: Visualize dependencies

## Setting Up Application Insights

### .NET 6 Integration

```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);

// Add Application Insights
builder.Services.AddApplicationInsightsTelemetry(options =>
{
    options.ConnectionString = builder.Configuration["ApplicationInsights:ConnectionString"];
    options.EnableAdaptiveSampling = true;
    options.EnableQuickPulseMetricStream = true;
});

// Configure telemetry
builder.Services.ConfigureTelemetryModule<DependencyTrackingTelemetryModule>((module, options) =>
{
    module.EnableSqlCommandTextInstrumentation = true;
});

// Add custom telemetry initializer
builder.Services.AddSingleton<ITelemetryInitializer, CustomTelemetryInitializer>();

var app = builder.Build();
app.Run();
```

Custom telemetry initializer:

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
            // Add user information
            if (context.User.Identity?.IsAuthenticated == true)
            {
                propTelemetry.Properties["UserId"] = context.User.FindFirst("sub")?.Value ?? "unknown";
            }

            // Add request correlation
            propTelemetry.Properties["CorrelationId"] =
                context.Request.Headers["X-Correlation-ID"].FirstOrDefault()
                ?? context.TraceIdentifier;

            // Add environment
            propTelemetry.Properties["Environment"] =
                Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production";
        }
    }
}
```

### Node.js Integration

```javascript
// app.js
const appInsights = require("applicationinsights");

appInsights.setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
    .setAutoDependencyCorrelation(true)
    .setAutoCollectRequests(true)
    .setAutoCollectPerformance(true, true)
    .setAutoCollectExceptions(true)
    .setAutoCollectDependencies(true)
    .setAutoCollectConsole(true, true)
    .setUseDiskRetryCaching(true)
    .setSendLiveMetrics(true)
    .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
    .start();

const client = appInsights.defaultClient;

// Custom telemetry
client.trackEvent({
    name: "OrderCreated",
    properties: {
        orderId: "12345",
        customerId: "C123",
        totalAmount: 99.99
    }
});

client.trackMetric({
    name: "OrderProcessingTime",
    value: 1500
});

// Custom dependency tracking
const startTime = Date.now();
try {
    // External call
    const result = await externalService.call();

    client.trackDependency({
        target: "external-service",
        name: "GetData",
        data: "https://external.api/data",
        duration: Date.now() - startTime,
        resultCode: 200,
        success: true,
        dependencyTypeName: "HTTP"
    });
} catch (error) {
    client.trackDependency({
        target: "external-service",
        name: "GetData",
        duration: Date.now() - startTime,
        resultCode: 500,
        success: false,
        dependencyTypeName: "HTTP"
    });
    throw error;
}
```

### Python Integration

```python
# app.py
from opencensus.ext.azure import metrics_exporter
from opencensus.ext.azure.trace_exporter import AzureExporter
from opencensus.ext.flask.flask_middleware import FlaskMiddleware
from opencensus.trace.samplers import ProbabilitySampler
import logging

# Configure logging
logger = logging.getLogger(__name__)
handler = AzureLogHandler(
    connection_string=os.environ['APPLICATIONINSIGHTS_CONNECTION_STRING']
)
logger.addHandler(handler)
logger.setLevel(logging.INFO)

# Configure Flask middleware
app = Flask(__name__)
middleware = FlaskMiddleware(
    app,
    exporter=AzureExporter(connection_string=os.environ['APPLICATIONINSIGHTS_CONNECTION_STRING']),
    sampler=ProbabilitySampler(rate=1.0)
)

# Configure metrics
exporter = metrics_exporter.new_metrics_exporter(
    connection_string=os.environ['APPLICATIONINSIGHTS_CONNECTION_STRING']
)

# Custom metrics
from opencensus.stats import aggregation, measure, stats, view

order_count_measure = measure.MeasureInt("order_count", "Number of orders", "orders")
order_count_view = view.View(
    "order_count",
    "Count of orders processed",
    [],
    order_count_measure,
    aggregation.CountAggregation()
)

stats.stats.view_manager.register_view(order_count_view)
mmap = stats.stats.stats_recorder.new_measurement_map()

@app.route('/orders', methods=['POST'])
def create_order():
    # Track custom event
    logger.info("Order created", extra={
        'custom_dimensions': {
            'order_id': order.id,
            'customer_id': order.customer_id
        }
    })

    # Record metric
    mmap.measure_int_put(order_count_measure, 1)
    mmap.record()

    return jsonify(order)
```

## Distributed Tracing

### W3C Trace Context

```csharp
// Propagate trace context in outgoing calls
public class TracingHttpHandler : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var activity = Activity.Current;
        if (activity != null)
        {
            // Add W3C traceparent header
            request.Headers.Add("traceparent",
                $"00-{activity.TraceId}-{activity.SpanId}-{(activity.Recorded ? "01" : "00")}");

            // Add tracestate if present
            if (!string.IsNullOrEmpty(activity.TraceStateString))
            {
                request.Headers.Add("tracestate", activity.TraceStateString);
            }
        }

        return await base.SendAsync(request, cancellationToken);
    }
}

// Register handler
builder.Services.AddHttpClient("api")
    .AddHttpMessageHandler<TracingHttpHandler>();
```

### Custom Operations

```csharp
public class OrderProcessor
{
    private readonly TelemetryClient _telemetry;

    public OrderProcessor(TelemetryClient telemetry)
    {
        _telemetry = telemetry;
    }

    public async Task<Order> ProcessOrderAsync(OrderRequest request)
    {
        // Start operation
        using var operation = _telemetry.StartOperation<RequestTelemetry>("ProcessOrder");
        operation.Telemetry.Properties["OrderId"] = request.OrderId;

        try
        {
            // Track dependencies
            using (_telemetry.StartOperation<DependencyTelemetry>("ValidateInventory"))
            {
                await ValidateInventoryAsync(request);
            }

            using (_telemetry.StartOperation<DependencyTelemetry>("ProcessPayment"))
            {
                await ProcessPaymentAsync(request);
            }

            // Track custom event
            _telemetry.TrackEvent("OrderProcessed", new Dictionary<string, string>
            {
                { "OrderId", request.OrderId },
                { "TotalAmount", request.TotalAmount.ToString() }
            });

            operation.Telemetry.Success = true;
            return new Order { Id = request.OrderId, Status = "Completed" };
        }
        catch (Exception ex)
        {
            operation.Telemetry.Success = false;
            _telemetry.TrackException(ex, new Dictionary<string, string>
            {
                { "OrderId", request.OrderId }
            });
            throw;
        }
    }
}
```

## KQL Queries for Application Insights

### Performance Analysis

```kql
// Slow requests
requests
| where timestamp > ago(1h)
| where duration > 1000
| project timestamp, name, duration, resultCode, operation_Id
| order by duration desc
| take 100

// Request performance percentiles
requests
| where timestamp > ago(24h)
| summarize
    Count = count(),
    Avg = avg(duration),
    P50 = percentile(duration, 50),
    P90 = percentile(duration, 90),
    P95 = percentile(duration, 95),
    P99 = percentile(duration, 99)
    by bin(timestamp, 1h), name
| render timechart

// Failed requests by error
requests
| where timestamp > ago(24h)
| where success == false
| summarize Count = count() by resultCode, name
| order by Count desc

// Dependency performance
dependencies
| where timestamp > ago(1h)
| summarize
    AvgDuration = avg(duration),
    FailureRate = countif(success == false) * 100.0 / count()
    by target, name
| order by AvgDuration desc
```

### User Analytics

```kql
// Active users
pageViews
| where timestamp > ago(7d)
| summarize Users = dcount(user_Id) by bin(timestamp, 1d)
| render timechart

// User sessions by location
sessions
| where timestamp > ago(24h)
| summarize SessionCount = count() by client_CountryOrRegion
| order by SessionCount desc
| take 20

// User flow through pages
pageViews
| where timestamp > ago(24h)
| project timestamp, user_Id, name
| order by timestamp asc
| serialize
| extend PrevPage = prev(name, 1), PrevUser = prev(user_Id, 1)
| where user_Id == PrevUser
| summarize Transitions = count() by PrevPage, name
| where Transitions > 10
```

### Exception Analysis

```kql
// Top exceptions
exceptions
| where timestamp > ago(24h)
| summarize Count = count() by type, outerMessage
| order by Count desc
| take 20

// Exception trends
exceptions
| where timestamp > ago(7d)
| summarize Count = count() by bin(timestamp, 1h), type
| render timechart

// Exception with full stack trace
exceptions
| where timestamp > ago(1h)
| project timestamp, type, outerMessage, details
| take 10
```

## Alerts and Smart Detection

### Create Alert Rules

```bicep
param appInsightsName string
param actionGroupId string

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

resource failureRateAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'High Failure Rate'
  location: 'global'
  properties: {
    description: 'Alert when request failure rate exceeds 5%'
    severity: 2
    enabled: true
    scopes: [appInsights.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'FailureRate'
          metricName: 'requests/failed'
          operator: 'GreaterThan'
          threshold: 5
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroupId
      }
    ]
  }
}

resource responseTimeAlert 'Microsoft.Insights/scheduledQueryRules@2021-08-01' = {
  name: 'Slow Response Time'
  location: resourceGroup().location
  properties: {
    description: 'Alert when P95 response time exceeds 2 seconds'
    severity: 3
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [appInsights.id]
    criteria: {
      allOf: [
        {
          query: '''
            requests
            | summarize P95 = percentile(duration, 95) by bin(timestamp, 5m)
            | where P95 > 2000
          '''
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
        }
      ]
    }
    actions: {
      actionGroups: [actionGroupId]
    }
  }
}
```

## Workbooks and Dashboards

### Custom Workbook

```json
{
  "version": "Notebook/1.0",
  "items": [
    {
      "type": 1,
      "content": {
        "json": "## Application Health Dashboard"
      }
    },
    {
      "type": 3,
      "content": {
        "version": "KqlItem/1.0",
        "query": "requests\n| where timestamp > ago(24h)\n| summarize Requests = count(), Failures = countif(success == false), AvgDuration = avg(duration) by bin(timestamp, 1h)\n| project timestamp, Requests, Failures, AvgDuration",
        "size": 0,
        "queryType": 0,
        "resourceType": "microsoft.insights/components",
        "visualization": "timechart"
      }
    },
    {
      "type": 3,
      "content": {
        "version": "KqlItem/1.0",
        "query": "dependencies\n| where timestamp > ago(24h)\n| summarize AvgDuration = avg(duration), FailureRate = countif(success == false) * 100.0 / count() by target\n| order by AvgDuration desc",
        "size": 0,
        "queryType": 0,
        "resourceType": "microsoft.insights/components",
        "visualization": "table"
      }
    }
  ]
}
```

Application Insights provides the deep observability needed for modern applications. Combined with Azure Monitor's broader capabilities, it enables proactive monitoring and rapid incident response.

## Resources

- [Application Insights Documentation](https://docs.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview)
- [KQL Reference](https://docs.microsoft.com/en-us/azure/data-explorer/kusto/query/)
- [Distributed Tracing](https://docs.microsoft.com/en-us/azure/azure-monitor/app/distributed-tracing)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
