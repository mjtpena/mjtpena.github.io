---
title: "OpenTelemetry with Azure: Vendor-Neutral Observability"
author: Michael John Pena
draft: false
date: 2021-11-24
tags:
  - Azure
  - OpenTelemetry
  - Observability
  - Monitoring
  - Distributed Tracing

---

I wrote "OpenTelemetry with Azure: Vendor-Neutral Observability" to share practical, production-minded guidance on this topic.

## What is OpenTelemetry?

OpenTelemetry provides:

- **Vendor-neutral instrumentation**: Write once, export anywhere
- **Unified API**: Single API for traces, metrics, and logs
- **Auto-instrumentation**: Automatic capture of common frameworks
- **Semantic conventions**: Standardized attribute names

## Setting Up OpenTelemetry in .NET

### Basic Configuration

```csharp
// Program.cs
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using OpenTelemetry.Metrics;
using OpenTelemetry.Logs;
using Azure.Monitor.OpenTelemetry.Exporter;

var builder = WebApplication.CreateBuilder(args);

// Configure OpenTelemetry
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource
        .AddService(
            serviceName: "MyWebApp",
            serviceVersion: "1.0.0",
            serviceInstanceId: Environment.MachineName)
        .AddAttributes(new Dictionary<string, object>
        {
            { "deployment.environment", builder.Environment.EnvironmentName },
            { "service.namespace", "ecommerce" }
        }))
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation(options =>
        {
            options.RecordException = true;
            options.Filter = (context) => !context.Request.Path.StartsWithSegments("/health");
        })
        .AddHttpClientInstrumentation(options =>
        {
            options.RecordException = true;
        })
        .AddSqlClientInstrumentation(options =>
        {
            options.SetDbStatementForText = true;
            options.RecordException = true;
        })
        .AddSource("MyWebApp.Orders")
        .AddAzureMonitorTraceExporter(options =>
        {
            options.ConnectionString = builder.Configuration["ApplicationInsights:ConnectionString"];
        }))
    .WithMetrics(metrics => metrics
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddRuntimeInstrumentation()
        .AddMeter("MyWebApp.Orders")
        .AddAzureMonitorMetricExporter(options =>
        {
            options.ConnectionString = builder.Configuration["ApplicationInsights:ConnectionString"];
        }));

// Configure logging
builder.Logging.AddOpenTelemetry(logging =>
{
    logging.IncludeFormattedMessage = true;
    logging.IncludeScopes = true;
    logging.AddAzureMonitorLogExporter(options =>
    {
        options.ConnectionString = builder.Configuration["ApplicationInsights:ConnectionString"];
    });
});

var app = builder.Build();
app.Run();
```

### Custom Instrumentation

```csharp
using System.Diagnostics;
using System.Diagnostics.Metrics;

public class OrderService
{
    private static readonly ActivitySource ActivitySource = new("MyWebApp.Orders");
    private static readonly Meter Meter = new("MyWebApp.Orders");

    private static readonly Counter<int> OrdersCreated = Meter.CreateCounter<int>(
        "orders.created",
        unit: "orders",
        description: "Number of orders created");

    private static readonly Histogram<double> OrderProcessingTime = Meter.CreateHistogram<double>(
        "orders.processing_time",
        unit: "ms",
        description: "Order processing time in milliseconds");

    private static readonly ObservableGauge<int> PendingOrders = Meter.CreateObservableGauge<int>(
        "orders.pending",
        () => GetPendingOrderCount(),
        unit: "orders",
        description: "Number of pending orders");

    public async Task<Order> CreateOrderAsync(CreateOrderRequest request)
    {
        using var activity = ActivitySource.StartActivity("CreateOrder", ActivityKind.Internal);
        activity?.SetTag("order.customer_id", request.CustomerId);
        activity?.SetTag("order.items_count", request.Items.Count);

        var stopwatch = Stopwatch.StartNew();

        try
        {
            // Validate order
            using (var validateActivity = ActivitySource.StartActivity("ValidateOrder"))
            {
                await ValidateOrderAsync(request);
            }

            // Process payment
            using (var paymentActivity = ActivitySource.StartActivity("ProcessPayment"))
            {
                paymentActivity?.SetTag("payment.method", request.PaymentMethod);
                await ProcessPaymentAsync(request);
            }

            // Create order
            var order = new Order
            {
                Id = Guid.NewGuid().ToString(),
                CustomerId = request.CustomerId,
                Status = "Created"
            };

            activity?.SetTag("order.id", order.Id);
            activity?.SetStatus(ActivityStatusCode.Ok);

            // Record metrics
            OrdersCreated.Add(1, new TagList
            {
                { "customer.tier", request.CustomerTier },
                { "order.type", request.Type }
            });

            stopwatch.Stop();
            OrderProcessingTime.Record(stopwatch.ElapsedMilliseconds, new TagList
            {
                { "order.status", "success" }
            });

            return order;
        }
        catch (Exception ex)
        {
            activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
            activity?.RecordException(ex);

            stopwatch.Stop();
            OrderProcessingTime.Record(stopwatch.ElapsedMilliseconds, new TagList
            {
                { "order.status", "error" },
                { "error.type", ex.GetType().Name }
            });

            throw;
        }
    }

    private static int GetPendingOrderCount()
    {
        // Return current count of pending orders
        return 42;
    }
}
```

## OpenTelemetry in Node.js

```javascript
// tracing.js
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { AzureMonitorTraceExporter } = require('@azure/monitor-opentelemetry-exporter');
const { AzureMonitorMetricExporter } = require('@azure/monitor-opentelemetry-exporter');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'my-node-service',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV
});

const traceExporter = new AzureMonitorTraceExporter({
    connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
});

const metricExporter = new AzureMonitorMetricExporter({
    connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
});

const sdk = new NodeSDK({
    resource: resource,
    traceExporter: traceExporter,
    metricReader: new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 60000
    }),
    instrumentations: [
        getNodeAutoInstrumentations({
            '@opentelemetry/instrumentation-http': {
                ignoreIncomingPaths: ['/health', '/ready']
            },
            '@opentelemetry/instrumentation-express': {},
            '@opentelemetry/instrumentation-mongodb': {},
            '@opentelemetry/instrumentation-redis': {}
        })
    ]
});

sdk.start();

// Custom instrumentation
const { trace, metrics } = require('@opentelemetry/api');

const tracer = trace.getTracer('my-node-service');
const meter = metrics.getMeter('my-node-service');

// Custom metrics
const requestCounter = meter.createCounter('http_requests_total', {
    description: 'Total number of HTTP requests'
});

const requestDuration = meter.createHistogram('http_request_duration_ms', {
    description: 'HTTP request duration in milliseconds'
});

// Custom spans
async function processOrder(orderId) {
    return tracer.startActiveSpan('processOrder', async (span) => {
        span.setAttribute('order.id', orderId);

        try {
            // Process order logic
            await validateOrder(orderId);
            await chargePayment(orderId);

            span.setStatus({ code: SpanStatusCode.OK });
            return { success: true };
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
            throw error;
        } finally {
            span.end();
        }
    });
}

module.exports = { tracer, meter };
```

## OpenTelemetry in Python

```python
# tracing.py
from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource, SERVICE_NAME, SERVICE_VERSION
from azure.monitor.opentelemetry.exporter import (
    AzureMonitorTraceExporter,
    AzureMonitorMetricExporter
)
from opentelemetry.instrumentation.flask import FlaskInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

# Configure resource
resource = Resource.create({
    SERVICE_NAME: "my-python-service",
    SERVICE_VERSION: "1.0.0",
    "deployment.environment": os.environ.get("ENVIRONMENT", "development")
})

# Configure trace provider
trace_exporter = AzureMonitorTraceExporter(
    connection_string=os.environ["APPLICATIONINSIGHTS_CONNECTION_STRING"]
)
trace_provider = TracerProvider(resource=resource)
trace_provider.add_span_processor(BatchSpanProcessor(trace_exporter))
trace.set_tracer_provider(trace_provider)

# Configure meter provider
metric_exporter = AzureMonitorMetricExporter(
    connection_string=os.environ["APPLICATIONINSIGHTS_CONNECTION_STRING"]
)
metric_reader = PeriodicExportingMetricReader(metric_exporter, export_interval_millis=60000)
meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader])
metrics.set_meter_provider(meter_provider)

# Auto-instrumentation
FlaskInstrumentor().instrument()
RequestsInstrumentor().instrument()
SQLAlchemyInstrumentor().instrument()

# Custom instrumentation
tracer = trace.get_tracer(__name__)
meter = metrics.get_meter(__name__)

# Custom metrics
order_counter = meter.create_counter(
    "orders_created",
    unit="orders",
    description="Number of orders created"
)

processing_time = meter.create_histogram(
    "order_processing_time",
    unit="ms",
    description="Order processing time"
)

# Custom spans
@tracer.start_as_current_span("process_order")
def process_order(order_id: str):
    span = trace.get_current_span()
    span.set_attribute("order.id", order_id)

    start_time = time.time()

    try:
        with tracer.start_as_current_span("validate_order"):
            validate_order(order_id)

        with tracer.start_as_current_span("charge_payment"):
            charge_payment(order_id)

        order_counter.add(1, {"status": "success"})
        processing_time.record(
            (time.time() - start_time) * 1000,
            {"status": "success"}
        )

        return {"success": True}

    except Exception as e:
        span.record_exception(e)
        span.set_status(trace.StatusCode.ERROR, str(e))
        order_counter.add(1, {"status": "error"})
        raise
```

## Querying OpenTelemetry Data in Azure Monitor

### Traces

```kql
// View distributed traces
traces
| where timestamp > ago(1h)
| where customDimensions.["service.name"] == "MyWebApp"
| project timestamp, message, severityLevel, operation_Id, customDimensions
| order by timestamp desc

// Trace duration analysis
dependencies
| where timestamp > ago(24h)
| extend service = tostring(customDimensions.["service.name"])
| summarize
    AvgDuration = avg(duration),
    P95Duration = percentile(duration, 95),
    Count = count()
    by service, name
| order by AvgDuration desc
```

### Metrics

```kql
// Custom metrics from OpenTelemetry
customMetrics
| where timestamp > ago(1h)
| where name == "orders.created"
| extend customerTier = tostring(customDimensions.["customer.tier"])
| summarize OrderCount = sum(value) by bin(timestamp, 5m), customerTier
| render timechart

// Processing time histogram
customMetrics
| where timestamp > ago(24h)
| where name == "orders.processing_time"
| summarize
    Avg = avg(value),
    P50 = percentile(value, 50),
    P90 = percentile(value, 90),
    P99 = percentile(value, 99)
    by bin(timestamp, 1h)
| render timechart
```

## Best Practices

### Semantic Conventions

```csharp
// Use OpenTelemetry semantic conventions
using OpenTelemetry.Trace;

public void ProcessRequest(HttpContext context)
{
    var activity = Activity.Current;

    // HTTP semantic conventions
    activity?.SetTag("http.method", context.Request.Method);
    activity?.SetTag("http.url", context.Request.Path);
    activity?.SetTag("http.status_code", context.Response.StatusCode);

    // Database semantic conventions
    activity?.SetTag("db.system", "postgresql");
    activity?.SetTag("db.name", "orders");
    activity?.SetTag("db.operation", "SELECT");

    // Messaging semantic conventions
    activity?.SetTag("messaging.system", "servicebus");
    activity?.SetTag("messaging.destination", "orders-queue");
    activity?.SetTag("messaging.operation", "send");
}
```

### Sampling Configuration

```csharp
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing
        .SetSampler(new ParentBasedSampler(new TraceIdRatioBasedSampler(0.1))) // 10% sampling
        .AddAspNetCoreInstrumentation()
        .AddAzureMonitorTraceExporter());
```

OpenTelemetry provides a future-proof approach to observability. By using vendor-neutral instrumentation with Azure Monitor as the backend, you get the flexibility of open standards with the power of Azure's analytics platform.

## Resources

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Azure Monitor OpenTelemetry](https://docs.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-overview)
- [OpenTelemetry .NET](https://github.com/open-telemetry/opentelemetry-dotnet)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
