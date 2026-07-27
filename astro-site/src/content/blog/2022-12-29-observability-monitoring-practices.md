---
title: "Observability and Monitoring: Practices That Worked in 2022"
author: Michael John Peña
draft: false
date: 2022-12-29
tags:
  - Azure
  - Observability
  - Monitoring
  - DevOps
  - Application Insights

---

I wrote "Observability and Monitoring: Practices That Worked in 2022" to share practical, production-minded guidance on this topic.

## The Three Pillars in Practice

```python
from dataclasses import dataclass
from typing import Dict, List, Optional
from datetime import datetime
import logging
import json

@dataclass
class ObservabilityEvent:
    """Unified observability event structure."""
    timestamp: datetime
    service: str
    operation: str
    trace_id: str
    span_id: str
    parent_span_id: Optional[str]
    duration_ms: float
    status: str
    attributes: Dict
    metrics: Dict[str, float]
    logs: List[Dict]

class UnifiedTelemetry:
    """Unified telemetry collection following OpenTelemetry patterns."""

    def __init__(self, service_name: str, connection_string: str):
        self.service_name = service_name
        self.connection_string = connection_string
        self._setup_exporters()

    def _setup_exporters(self):
        """Configure telemetry exporters."""
        from azure.monitor.opentelemetry import configure_azure_monitor

        configure_azure_monitor(
            connection_string=self.connection_string,
            service_name=self.service_name
        )

    def create_span(self, operation_name: str, attributes: Dict = None):
        """Create a new trace span."""
        from opentelemetry import trace

        tracer = trace.get_tracer(self.service_name)
        return tracer.start_as_current_span(
            operation_name,
            attributes=attributes or {}
        )

    def record_metric(self, name: str, value: float,
                      attributes: Dict = None):
        """Record a custom metric."""
        from opentelemetry import metrics

        meter = metrics.get_meter(self.service_name)
        counter = meter.create_counter(name)
        counter.add(value, attributes or {})

    def log_event(self, level: str, message: str,
                  attributes: Dict = None):
        """Log an event with context."""
        from opentelemetry import trace

        current_span = trace.get_current_span()
        span_context = current_span.get_span_context()

        log_record = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": level,
            "message": message,
            "trace_id": format(span_context.trace_id, "032x"),
            "span_id": format(span_context.span_id, "016x"),
            "service": self.service_name,
            **(attributes or {})
        }

        logging.log(
            getattr(logging, level.upper()),
            json.dumps(log_record)
        )
```

## Distributed Tracing Implementation

```csharp
// ASP.NET Core distributed tracing with Application Insights
using Microsoft.ApplicationInsights;
using Microsoft.ApplicationInsights.DataContracts;
using System.Diagnostics;

public class OrderService
{
    private readonly TelemetryClient _telemetry;
    private readonly HttpClient _httpClient;
    private static readonly ActivitySource _activitySource =
        new("OrderService");

    public OrderService(TelemetryClient telemetry, HttpClient httpClient)
    {
        _telemetry = telemetry;
        _httpClient = httpClient;
    }

    public async Task<OrderResult> ProcessOrderAsync(Order order)
    {
        using var activity = _activitySource.StartActivity(
            "ProcessOrder",
            ActivityKind.Internal
        );

        activity?.SetTag("order.id", order.Id);
        activity?.SetTag("order.customer_id", order.CustomerId);
        activity?.SetTag("order.total", order.Total);

        try
        {
            // Validate order
            using (var validateSpan = _activitySource.StartActivity("ValidateOrder"))
            {
                await ValidateOrderAsync(order);
                validateSpan?.SetStatus(ActivityStatusCode.Ok);
            }

            // Check inventory
            using (var inventorySpan = _activitySource.StartActivity("CheckInventory"))
            {
                inventorySpan?.SetTag("item.count", order.Items.Count);
                var inventoryResult = await CheckInventoryAsync(order);

                if (!inventoryResult.Available)
                {
                    inventorySpan?.SetStatus(ActivityStatusCode.Error, "Insufficient inventory");
                    throw new InsufficientInventoryException();
                }
            }

            // Process payment
            using (var paymentSpan = _activitySource.StartActivity(
                "ProcessPayment",
                ActivityKind.Client))
            {
                paymentSpan?.SetTag("payment.method", order.PaymentMethod);
                await ProcessPaymentAsync(order);
            }

            // Record success metrics
            _telemetry.GetMetric("orders_processed").TrackValue(1);
            _telemetry.GetMetric("order_value").TrackValue(order.Total);

            activity?.SetStatus(ActivityStatusCode.Ok);

            return new OrderResult { Success = true, OrderId = order.Id };
        }
        catch (Exception ex)
        {
            activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
            activity?.RecordException(ex);

            _telemetry.TrackException(ex, new Dictionary<string, string>
            {
                ["order_id"] = order.Id,
                ["customer_id"] = order.CustomerId
            });

            throw;
        }
    }
}

// Startup configuration
public void ConfigureServices(IServiceCollection services)
{
    services.AddApplicationInsightsTelemetry(options =>
    {
        options.ConnectionString = Configuration["ApplicationInsights:ConnectionString"];
        options.EnableAdaptiveSampling = true;
        options.EnableDependencyTrackingTelemetryModule = true;
        options.EnableRequestTrackingTelemetryModule = true;
    });

    services.AddOpenTelemetry()
        .WithTracing(builder => builder
            .AddSource("OrderService")
            .AddAspNetCoreInstrumentation()
            .AddHttpClientInstrumentation()
            .AddSqlClientInstrumentation()
            .AddAzureMonitorTraceExporter());
}
```

## Custom Metrics and Dashboards

```python
# Azure Monitor custom metrics
from azure.monitor.ingestion import LogsIngestionClient
from azure.identity import DefaultAzureCredential
from datetime import datetime
import json

class CustomMetricsCollector:
    def __init__(self, data_collection_endpoint: str,
                 data_collection_rule_id: str,
                 stream_name: str):
        credential = DefaultAzureCredential()
        self.client = LogsIngestionClient(
            endpoint=data_collection_endpoint,
            credential=credential
        )
        self.rule_id = data_collection_rule_id
        self.stream_name = stream_name

    def send_metrics(self, metrics: list):
        """Send custom metrics to Azure Monitor."""

        self.client.upload(
            rule_id=self.rule_id,
            stream_name=self.stream_name,
            logs=metrics
        )

    def collect_application_metrics(self) -> list:
        """Collect application-level metrics."""

        return [
            {
                "TimeGenerated": datetime.utcnow().isoformat(),
                "MetricName": "active_users",
                "MetricValue": get_active_user_count(),
                "Dimensions": json.dumps({
                    "region": "eastus",
                    "tier": "premium"
                })
            },
            {
                "TimeGenerated": datetime.utcnow().isoformat(),
                "MetricName": "api_latency_p99",
                "MetricValue": calculate_p99_latency(),
                "Dimensions": json.dumps({
                    "endpoint": "/api/orders",
                    "method": "POST"
                })
            },
            {
                "TimeGenerated": datetime.utcnow().isoformat(),
                "MetricName": "queue_depth",
                "MetricValue": get_queue_depth(),
                "Dimensions": json.dumps({
                    "queue": "orders-processing"
                })
            }
        ]
```

```kusto
// KQL queries for observability dashboards

// Service health overview
requests
| where timestamp > ago(1h)
| summarize
    TotalRequests = count(),
    SuccessRate = round(100.0 * countif(success == true) / count(), 2),
    AvgDuration = round(avg(duration), 2),
    P95Duration = round(percentile(duration, 95), 2),
    P99Duration = round(percentile(duration, 99), 2)
by bin(timestamp, 5m), cloud_RoleName
| order by timestamp desc

// Error analysis
exceptions
| where timestamp > ago(24h)
| summarize Count = count() by type, outerMessage, cloud_RoleName
| order by Count desc
| take 20

// Dependency performance
dependencies
| where timestamp > ago(1h)
| summarize
    CallCount = count(),
    SuccessRate = round(100.0 * countif(success == true) / count(), 2),
    AvgDuration = round(avg(duration), 2)
by target, type, name
| order by CallCount desc

// End-to-end transaction tracing
let operationId = "abc123";
union requests, dependencies, traces, exceptions
| where operation_Id == operationId
| project timestamp, itemType, name, duration, success, message, type
| order by timestamp asc

// SLO tracking
let slo_target = 99.9;
requests
| where timestamp > ago(30d)
| summarize
    TotalRequests = count(),
    SuccessfulRequests = countif(success == true and duration < 1000)
by bin(timestamp, 1d)
| extend
    DailySuccessRate = round(100.0 * SuccessfulRequests / TotalRequests, 3),
    SLOTarget = slo_target,
    SLOMet = iff(100.0 * SuccessfulRequests / TotalRequests >= slo_target, true, false)
| project timestamp, DailySuccessRate, SLOTarget, SLOMet
```

## Alerting Strategy

```bicep
// Alert rules with action groups
resource actionGroup 'Microsoft.Insights/actionGroups@2022-06-01' = {
  name: 'ag-platform-oncall'
  location: 'global'
  properties: {
    groupShortName: 'PlatformOC'
    enabled: true
    emailReceivers: [
      {
        name: 'oncall-email'
        emailAddress: 'oncall@company.com'
        useCommonAlertSchema: true
      }
    ]
    smsReceivers: [
      {
        name: 'oncall-sms'
        countryCode: '1'
        phoneNumber: '5551234567'
      }
    ]
    webhookReceivers: [
      {
        name: 'pagerduty'
        serviceUri: 'https://events.pagerduty.com/integration/...'
        useCommonAlertSchema: true
      }
    ]
  }
}

// High error rate alert
resource errorRateAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-high-error-rate'
  location: 'global'
  properties: {
    description: 'Alert when error rate exceeds 5%'
    severity: 1
    enabled: true
    scopes: [appInsights.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.MultipleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'HighErrorRate'
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
        actionGroupId: actionGroup.id
      }
    ]
  }
}

// Latency anomaly detection
resource latencyAnomalyAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-latency-anomaly'
  location: 'global'
  properties: {
    description: 'Alert on unusual latency patterns'
    severity: 2
    enabled: true
    scopes: [appInsights.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.MultipleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'LatencyAnomaly'
          metricName: 'requests/duration'
          operator: 'GreaterThan'
          alertSensitivity: 'Medium'
          failingPeriods: {
            numberOfEvaluationPeriods: 4
            minFailingPeriodsToAlert: 3
          }
          timeAggregation: 'Average'
          criterionType: 'DynamicThresholdCriterion'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
  }
}
```

## SRE Practices

```python
# Service Level Objectives implementation
from dataclasses import dataclass
from typing import List
from datetime import datetime, timedelta

@dataclass
class SLI:
    """Service Level Indicator."""
    name: str
    query: str
    unit: str

@dataclass
class SLO:
    """Service Level Objective."""
    name: str
    sli: SLI
    target: float
    window_days: int
    burn_rate_alerts: List[dict]

class SLOManager:
    def __init__(self, log_analytics_client):
        self.client = log_analytics_client

    def define_slos(self) -> List[SLO]:
        """Define standard SLOs for services."""

        availability_sli = SLI(
            name="availability",
            query="""
                requests
                | summarize
                    Total = count(),
                    Successful = countif(success == true)
                | extend Rate = 100.0 * Successful / Total
            """,
            unit="percentage"
        )

        latency_sli = SLI(
            name="latency_p99",
            query="""
                requests
                | summarize P99 = percentile(duration, 99)
            """,
            unit="milliseconds"
        )

        return [
            SLO(
                name="api_availability",
                sli=availability_sli,
                target=99.9,
                window_days=30,
                burn_rate_alerts=[
                    {"burn_rate": 14.4, "window": "1h", "severity": 1},
                    {"burn_rate": 6, "window": "6h", "severity": 2},
                    {"burn_rate": 3, "window": "24h", "severity": 3}
                ]
            ),
            SLO(
                name="api_latency",
                sli=latency_sli,
                target=500,  # 500ms P99
                window_days=30,
                burn_rate_alerts=[
                    {"burn_rate": 14.4, "window": "1h", "severity": 1},
                    {"burn_rate": 6, "window": "6h", "severity": 2}
                ]
            )
        ]

    def calculate_error_budget(self, slo: SLO) -> dict:
        """Calculate remaining error budget."""

        current_value = self._query_current_value(slo.sli)

        if slo.sli.unit == "percentage":
            budget_total = 100 - slo.target
            budget_consumed = 100 - current_value
            budget_remaining = budget_total - budget_consumed
            budget_remaining_percent = (budget_remaining / budget_total) * 100
        else:
            # For latency-type SLOs
            budget_total = slo.target
            budget_consumed = max(0, current_value - slo.target)
            budget_remaining = budget_total - budget_consumed
            budget_remaining_percent = (budget_remaining / budget_total) * 100

        return {
            "slo_name": slo.name,
            "target": slo.target,
            "current": current_value,
            "budget_total": budget_total,
            "budget_consumed": budget_consumed,
            "budget_remaining": budget_remaining,
            "budget_remaining_percent": max(0, budget_remaining_percent),
            "status": "healthy" if budget_remaining_percent > 20 else "at_risk" if budget_remaining_percent > 0 else "exhausted"
        }
```

## Best Practices Summary

```yaml
observability_best_practices:
  instrumentation:
    - Use OpenTelemetry for vendor-neutral instrumentation
    - Propagate trace context across all services
    - Include business context in spans and logs
    - Sample intelligently to manage costs

  metrics:
    - Focus on the four golden signals (latency, traffic, errors, saturation)
    - Use histograms for latency measurements
    - Include dimensions for filtering
    - Set up anomaly detection for key metrics

  logging:
    - Use structured logging (JSON)
    - Include correlation IDs in all logs
    - Log at appropriate levels
    - Avoid logging sensitive data

  alerting:
    - Alert on symptoms, not causes
    - Use multi-window, multi-burn-rate alerts for SLOs
    - Ensure alerts are actionable
    - Regularly review and tune alerts

  dashboards:
    - Create service-level dashboards
    - Include drill-down capabilities
    - Show SLO status prominently
    - Update dashboards as services evolve
```

## Conclusion

Observability in 2022 moved beyond simple monitoring to true understanding of system behavior. OpenTelemetry became the standard for instrumentation. SLOs and error budgets provided business-relevant reliability targets. As we enter 2023, expect deeper integration with AIOps for automated incident response and root cause analysis.

## Resources

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Azure Monitor](https://docs.microsoft.com/azure/azure-monitor/)
- [Application Insights](https://docs.microsoft.com/azure/azure-monitor/app/app-insights-overview)
- [SRE Workbook](https://sre.google/workbook/table-of-contents/)

