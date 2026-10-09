---
title: Publishing Custom Metrics to Azure Monitor
author: Michael John Peña
draft: false
date: 2021-07-20
url: /blog/azure-custom-metrics/
tags:
  - Azure
  - Monitoring
  - DevOps
  - Metrics
  - Application Insights
---

## Custom Metrics Overview

There are two ways to publish custom metrics:

- **Application Insights SDK**: For application-level metrics
- **Azure Monitor REST API**: For any metric source

## Publishing via Application Insights

Use the Application Insights SDK for application metrics:

```python
from applicationinsights import TelemetryClient
from applicationinsights.channel import AsynchronousQueue, AsynchronousSender, TelemetryChannel
import time

# Initialize telemetry client
instrumentation_key = "your-instrumentation-key"
tc = TelemetryClient(instrumentation_key)

# Track custom metric
def track_business_metric(metric_name, value, properties=None, measurements=None):
    """Track a custom metric with optional dimensions."""
    tc.track_metric(metric_name, value, properties=properties)
    tc.flush()

# Example: Track order processing metrics
def process_order(order):
    start_time = time.time()

    try:
        # Process the order
        result = execute_order_processing(order)

        # Track success metric
        processing_time = (time.time() - start_time) * 1000  # milliseconds

        track_business_metric(
            "OrderProcessingTime",
            processing_time,
            properties={
                "OrderType": order.type,
                "Region": order.region,
                "PaymentMethod": order.payment_method
            }
        )

        track_business_metric(
            "OrderValue",
            order.total_amount,
            properties={
                "OrderType": order.type,
                "Region": order.region
            }
        )

        return result

    except Exception as e:
        # Track failure metric
        track_business_metric(
            "OrderProcessingFailures",
            1,
            properties={
                "ErrorType": type(e).__name__,
                "OrderType": order.type
            }
        )
        raise
```

## Publishing via REST API

Send custom metrics directly to Azure Monitor:

```python
import requests
import json
from datetime import datetime
from azure.identity import DefaultAzureCredential

def get_access_token():
    """Get access token for Azure Monitor."""
    credential = DefaultAzureCredential()
    token = credential.get_token("https://monitoring.azure.com/.default")
    return token.token

def publish_custom_metric(resource_id, metric_data):
    """
    Publish custom metric to Azure Monitor.

    metric_data format:
    {
        "time": "2021-07-20T10:00:00Z",
        "data": {
            "baseData": {
                "metric": "MetricName",
                "namespace": "CustomNamespace",
                "dimNames": ["Dimension1", "Dimension2"],
                "series": [
                    {
                        "dimValues": ["Value1", "Value2"],
                        "min": 1.0,
                        "max": 10.0,
                        "sum": 50.0,
                        "count": 10
                    }
                ]
            }
        }
    }
    """
    token = get_access_token()

    # Extract region from resource ID
    region = "eastus"  # Should be determined from resource

    url = f"https://{region}.monitoring.azure.com{resource_id}/metrics"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    response = requests.post(url, headers=headers, json=metric_data)

    if response.status_code != 200:
        raise Exception(f"Failed to publish metric: {response.text}")

    return response

# Example: Publish aggregated metrics
def publish_queue_metrics(resource_id, queue_name, depth, processing_rate):
    """Publish queue depth and processing rate metrics."""

    current_time = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    metric_data = {
        "time": current_time,
        "data": {
            "baseData": {
                "metric": "QueueDepth",
                "namespace": "CustomMetrics/Messaging",
                "dimNames": ["QueueName"],
                "series": [{
                    "dimValues": [queue_name],
                    "min": depth,
                    "max": depth,
                    "sum": depth,
                    "count": 1
                }]
            }
        }
    }

    publish_custom_metric(resource_id, metric_data)

    # Publish processing rate
    rate_metric = {
        "time": current_time,
        "data": {
            "baseData": {
                "metric": "ProcessingRate",
                "namespace": "CustomMetrics/Messaging",
                "dimNames": ["QueueName"],
                "series": [{
                    "dimValues": [queue_name],
                    "min": processing_rate,
                    "max": processing_rate,
                    "sum": processing_rate,
                    "count": 1
                }]
            }
        }
    }

    publish_custom_metric(resource_id, rate_metric)
```

## Pre-Aggregated Metrics

For high-volume scenarios, pre-aggregate before publishing:

```python
from collections import defaultdict
from threading import Lock
import threading
import time

class MetricAggregator:
    """Aggregate metrics locally before publishing to Azure Monitor."""

    def __init__(self, resource_id, flush_interval_seconds=60):
        self.resource_id = resource_id
        self.flush_interval = flush_interval_seconds
        self.metrics = defaultdict(lambda: {"min": float("inf"), "max": float("-inf"), "sum": 0, "count": 0})
        self.lock = Lock()
        self._start_flush_thread()

    def record(self, metric_name, value, dimensions=None):
        """Record a metric value."""
        key = (metric_name, tuple(sorted((dimensions or {}).items())))

        with self.lock:
            self.metrics[key]["min"] = min(self.metrics[key]["min"], value)
            self.metrics[key]["max"] = max(self.metrics[key]["max"], value)
            self.metrics[key]["sum"] += value
            self.metrics[key]["count"] += 1

    def _start_flush_thread(self):
        """Start background thread to flush metrics periodically."""
        def flush_loop():
            while True:
                time.sleep(self.flush_interval)
                self._flush()

        thread = threading.Thread(target=flush_loop, daemon=True)
        thread.start()

    def _flush(self):
        """Flush aggregated metrics to Azure Monitor."""
        with self.lock:
            if not self.metrics:
                return

            metrics_to_send = dict(self.metrics)
            self.metrics = defaultdict(lambda: {"min": float("inf"), "max": float("-inf"), "sum": 0, "count": 0})

        current_time = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

        # Group by metric name
        by_metric = defaultdict(list)
        for (metric_name, dim_tuple), values in metrics_to_send.items():
            dimensions = dict(dim_tuple)
            by_metric[metric_name].append((dimensions, values))

        # Publish each metric
        for metric_name, series_data in by_metric.items():
            dim_names = list(series_data[0][0].keys()) if series_data[0][0] else []

            metric_data = {
                "time": current_time,
                "data": {
                    "baseData": {
                        "metric": metric_name,
                        "namespace": "CustomMetrics/Application",
                        "dimNames": dim_names,
                        "series": [{
                            "dimValues": [dims.get(d, "") for d in dim_names],
                            "min": values["min"],
                            "max": values["max"],
                            "sum": values["sum"],
                            "count": values["count"]
                        } for dims, values in series_data]
                    }
                }
            }

            try:
                publish_custom_metric(self.resource_id, metric_data)
            except Exception as e:
                print(f"Error publishing metric {metric_name}: {e}")

# Usage
aggregator = MetricAggregator(resource_id, flush_interval_seconds=60)

# Record metrics (high volume)
for request in requests:
    response_time = process_request(request)
    aggregator.record("ResponseTime", response_time, {"Endpoint": request.endpoint})
    aggregator.record("RequestCount", 1, {"Endpoint": request.endpoint, "StatusCode": str(response.status_code)})
```

## Using OpenTelemetry

Modern approach with OpenTelemetry SDK:

```python
from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from azure.monitor.opentelemetry.exporter import AzureMonitorMetricExporter

# Configure OpenTelemetry with Azure Monitor exporter
exporter = AzureMonitorMetricExporter(
    connection_string="InstrumentationKey=your-key;IngestionEndpoint=https://eastus-1.in.applicationinsights.azure.com/"
)

reader = PeriodicExportingMetricReader(exporter, export_interval_millis=60000)
provider = MeterProvider(metric_readers=[reader])
metrics.set_meter_provider(provider)

# Create meter and instruments
meter = metrics.get_meter("myapplication", "1.0.0")

# Counter for counting events
request_counter = meter.create_counter(
    "http_requests",
    description="Number of HTTP requests",
    unit="1"
)

# Histogram for distributions
response_histogram = meter.create_histogram(
    "http_response_time",
    description="HTTP response time",
    unit="ms"
)

# Observable gauge for current values
def get_active_connections():
    return [metrics.Observation(connection_pool.active_count)]

connection_gauge = meter.create_observable_gauge(
    "active_connections",
    callbacks=[get_active_connections],
    description="Number of active connections"
)

# Record metrics
def handle_request(request):
    start_time = time.time()

    try:
        response = process_request(request)

        # Record request count
        request_counter.add(1, {"method": request.method, "endpoint": request.path, "status": str(response.status_code)})

        # Record response time
        duration_ms = (time.time() - start_time) * 1000
        response_histogram.record(duration_ms, {"method": request.method, "endpoint": request.path})

        return response

    except Exception as e:
        request_counter.add(1, {"method": request.method, "endpoint": request.path, "status": "500"})
        raise
```

## Querying Custom Metrics

Query your custom metrics from Azure Monitor:

```python
from azure.mgmt.monitor import MonitorManagementClient

monitor_client = MonitorManagementClient(credential, subscription_id)

def query_custom_metrics(resource_id, namespace, metric_name, dimensions=None):
    """Query custom metrics from Azure Monitor."""

    end_time = datetime.utcnow()
    start_time = end_time - timedelta(hours=24)

    # Build dimension filter
    filter_str = None
    if dimensions:
        filter_parts = [f"{k} eq '{v}'" for k, v in dimensions.items()]
        filter_str = " and ".join(filter_parts)

    metrics = monitor_client.metrics.list(
        resource_uri=resource_id,
        metricnames=metric_name,
        metricnamespace=namespace,
        timespan=f"{start_time.isoformat()}Z/{end_time.isoformat()}Z",
        interval="PT1H",
        aggregation="Average,Sum,Count",
        filter=filter_str
    )

    results = []
    for metric in metrics.value:
        for timeseries in metric.timeseries:
            for data in timeseries.data:
                results.append({
                    "timestamp": data.time_stamp,
                    "average": data.average,
                    "sum": data.total,
                    "count": data.count
                })

    return results

# Query custom order metrics
order_metrics = query_custom_metrics(
    resource_id,
    "CustomMetrics/Application",
    "OrderProcessingTime",
    dimensions={"Region": "US-East"}
)

for m in order_metrics:
    print(f"{m['timestamp']}: avg={m['average']:.2f}ms, count={m['count']}")
```

## Alerting on Custom Metrics

Create alerts based on custom metrics:

```python
def create_custom_metric_alert(name, resource_id, namespace, metric_name, threshold):
    """Create alert for custom metric."""

    alert = monitor_client.metric_alerts.create_or_update(
        resource_group_name="rg-monitoring",
        rule_name=name,
        parameters={
            "location": "global",
            "description": f"Alert for custom metric {metric_name}",
            "severity": 2,
            "enabled": True,
            "scopes": [resource_id],
            "evaluation_frequency": "PT5M",
            "window_size": "PT15M",
            "criteria": {
                "odata.type": "Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria",
                "allOf": [{
                    "name": "criterion1",
                    "metricName": metric_name,
                    "metricNamespace": namespace,
                    "operator": "GreaterThan",
                    "threshold": threshold,
                    "timeAggregation": "Average"
                }]
            },
            "actions": [{
                "actionGroupId": f"/subscriptions/{subscription_id}/resourceGroups/rg-monitoring/providers/Microsoft.Insights/actionGroups/ops-team"
            }]
        }
    )

    return alert

# Create alert for slow order processing
create_custom_metric_alert(
    "slow-order-processing",
    resource_id,
    "CustomMetrics/Application",
    "OrderProcessingTime",
    threshold=5000  # 5 seconds
)
```

## Conclusion

Custom metrics extend Azure Monitor's capabilities to track application-specific KPIs and business metrics. Whether using Application Insights SDK for application code or the REST API for external systems, custom metrics provide flexibility in monitoring what matters most to your business.

Best practices include pre-aggregating high-volume metrics, using meaningful dimensions for filtering, and setting up alerts on critical business thresholds. Combined with platform metrics, custom metrics give you complete observability of your Azure solutions.
