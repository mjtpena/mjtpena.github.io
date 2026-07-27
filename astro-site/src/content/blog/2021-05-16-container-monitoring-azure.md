---
title: "Container Monitoring on Azure: AKS Insights and Beyond"
author: Michael John Peña
draft: false
date: 2021-05-16
tags:
  - Azure
  - Kubernetes
  - Monitoring
  - Containers
  - AKS

---

I wrote "Container Monitoring on Azure: AKS Insights and Beyond" to share practical, production-minded guidance on this topic.

## Azure Monitor Container Insights

Container Insights is the built-in monitoring solution for AKS:

```bash
# Enable Container Insights on existing cluster
az aks enable-addons \
    --name my-aks-cluster \
    --resource-group my-rg \
    --addons monitoring \
    --workspace-resource-id /subscriptions/.../workspaces/my-workspace
```

This deploys:
- OMS agent as DaemonSet
- Metrics collection
- Log forwarding to Log Analytics

## Key Metrics to Monitor

### Node-Level Metrics

```kusto
// Node CPU utilization
Perf
| where ObjectName == "K8SNode"
| where CounterName == "cpuUsageNanoCores"
| summarize AvgCPU = avg(CounterValue) by bin(TimeGenerated, 5m), Computer
| render timechart

// Node memory utilization
Perf
| where ObjectName == "K8SNode"
| where CounterName == "memoryRssBytes"
| summarize AvgMemory = avg(CounterValue / 1073741824) by bin(TimeGenerated, 5m), Computer
| render timechart

// Disk IOPS
Perf
| where ObjectName == "K8SNode"
| where CounterName in ("diskIOPS", "diskReadBytes", "diskWriteBytes")
| summarize avg(CounterValue) by bin(TimeGenerated, 5m), CounterName
```

### Pod-Level Metrics

```kusto
// Container CPU usage
Perf
| where ObjectName == "K8SContainer"
| where CounterName == "cpuUsageNanoCores"
| extend PodName = tostring(split(InstanceName, "/")[1])
| summarize AvgCPU = avg(CounterValue / 1000000) by bin(TimeGenerated, 1m), PodName
| where AvgCPU > 100
| render timechart

// Container memory working set
Perf
| where ObjectName == "K8SContainer"
| where CounterName == "memoryWorkingSetBytes"
| extend PodName = tostring(split(InstanceName, "/")[1])
| summarize AvgMemory = avg(CounterValue / 1048576) by bin(TimeGenerated, 1m), PodName
| render timechart

// Container restarts
KubePodInventory
| where TimeGenerated > ago(24h)
| where ContainerRestartCount > 0
| summarize RestartCount = max(ContainerRestartCount) by PodName, Namespace
| order by RestartCount desc
```

## Custom Metrics with Application Insights

Instrument your containerized applications:

```python
from applicationinsights import TelemetryClient
from applicationinsights.channel import TelemetryChannel, AsynchronousQueue, AsynchronousSender
from opencensus.ext.azure import metrics_exporter
from opencensus.stats import aggregation, measure, stats, view
import os

# Application Insights configuration
instrumentation_key = os.environ.get('APPINSIGHTS_INSTRUMENTATIONKEY')
tc = TelemetryClient(instrumentation_key)

# Custom metrics
def track_order_processing(order_id: str, duration_ms: float, items_count: int):
    tc.track_metric('OrderProcessingDuration', duration_ms, properties={
        'order_id': order_id
    })
    tc.track_metric('OrderItemsCount', items_count)

# OpenCensus for automatic instrumentation
exporter = metrics_exporter.new_metrics_exporter(
    connection_string=f'InstrumentationKey={instrumentation_key}'
)

# Define custom measure
request_measure = measure.MeasureFloat(
    "request_latency",
    "The request latency in milliseconds",
    "ms"
)

# Create view
latency_view = view.View(
    "request_latency_distribution",
    "Distribution of request latencies",
    [],
    request_measure,
    aggregation.DistributionAggregation([0, 25, 50, 100, 200, 500, 1000])
)

# Register view and exporter
stats.stats.view_manager.register_view(latency_view)
stats.stats.view_manager.register_exporter(exporter)
```

## Log Collection Patterns

### Structured Logging

```python
import logging
import json
from pythonjsonlogger import jsonlogger
from opencensus.ext.azure.log_exporter import AzureLogHandler

# Configure JSON logging
logger = logging.getLogger()
handler = logging.StreamHandler()

formatter = jsonlogger.JsonFormatter(
    fmt='%(asctime)s %(levelname)s %(name)s %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S'
)
handler.setFormatter(formatter)
logger.addHandler(handler)

# Add Azure Log Handler
azure_handler = AzureLogHandler(
    connection_string=f'InstrumentationKey={instrumentation_key}'
)
logger.addHandler(azure_handler)

# Structured logging
def process_order(order_id: str, customer_id: str, total: float):
    logger.info("Processing order", extra={
        'custom_dimensions': {
            'order_id': order_id,
            'customer_id': customer_id,
            'total': total,
            'event_type': 'order_processing'
        }
    })
```

### Query Logs

```kusto
// Application logs with custom dimensions
traces
| where customDimensions.event_type == "order_processing"
| project timestamp, message,
    order_id = tostring(customDimensions.order_id),
    customer_id = tostring(customDimensions.customer_id),
    total = todouble(customDimensions.total)
| order by timestamp desc

// Error analysis
exceptions
| where timestamp > ago(1h)
| summarize count() by type, outerMessage
| order by count_ desc

// Request traces with dependencies
requests
| where timestamp > ago(1h)
| project timestamp, name, duration, resultCode, operation_Id
| join kind=inner (
    dependencies
    | where timestamp > ago(1h)
    | project operation_Id, dependency_name = name, dependency_duration = duration
) on operation_Id
| summarize
    request_count = count(),
    avg_duration = avg(duration),
    avg_dependency_duration = avg(dependency_duration)
    by bin(timestamp, 5m), name
```

## Distributed Tracing

Enable end-to-end tracing across services:

```python
from opencensus.ext.azure.trace_exporter import AzureExporter
from opencensus.trace import config_integration
from opencensus.trace.samplers import ProbabilitySampler
from opencensus.trace.tracer import Tracer

# Configure tracing
config_integration.trace_integrations(['requests', 'sqlalchemy'])

exporter = AzureExporter(
    connection_string=f'InstrumentationKey={instrumentation_key}'
)

tracer = Tracer(
    exporter=exporter,
    sampler=ProbabilitySampler(rate=1.0)
)

# Use tracer
def process_request():
    with tracer.span(name='process_request') as span:
        span.add_attribute('custom.attribute', 'value')

        with tracer.span(name='database_query'):
            # Database operation
            pass

        with tracer.span(name='external_api_call'):
            # External API call
            pass
```

## Alert Configuration

Create alerts for container workloads:

```bash
# Create action group
az monitor action-group create \
    --name ops-team \
    --resource-group my-rg \
    --short-name ops \
    --action email ops ops@company.com

# Alert for high CPU
az monitor metrics alert create \
    --name "High CPU in AKS" \
    --resource-group my-rg \
    --scopes /subscriptions/.../containerservice/managedClusters/my-aks \
    --condition "avg node_cpu_usage_percentage > 80" \
    --window-size 5m \
    --evaluation-frequency 1m \
    --action ops-team \
    --severity 2

# Alert for pod failures
az monitor scheduled-query create \
    --name "Pod Failures Alert" \
    --resource-group my-rg \
    --scopes /subscriptions/.../workspaces/my-workspace \
    --condition "count > 5" \
    --condition-query "
        KubePodInventory
        | where PodStatus == 'Failed'
        | summarize count() by PodName
    " \
    --action ops-team
```

## Workbooks for Visualization

Create custom workbooks:

```json
{
  "version": "Notebook/1.0",
  "items": [
    {
      "type": 1,
      "content": {
        "json": "# AKS Cluster Overview"
      }
    },
    {
      "type": 3,
      "content": {
        "version": "KqlItem/1.0",
        "query": "Perf\n| where ObjectName == 'K8SNode'\n| where CounterName == 'cpuUsageNanoCores'\n| summarize AvgCPU = avg(CounterValue/1000000000*100) by bin(TimeGenerated, 5m)\n| render timechart",
        "size": 0,
        "title": "Cluster CPU Usage",
        "timeContext": {
          "durationMs": 3600000
        },
        "queryType": 0,
        "resourceType": "microsoft.operationalinsights/workspaces"
      }
    },
    {
      "type": 3,
      "content": {
        "version": "KqlItem/1.0",
        "query": "KubePodInventory\n| where TimeGenerated > ago(1h)\n| summarize count() by PodStatus\n| render piechart",
        "size": 1,
        "title": "Pod Status Distribution",
        "queryType": 0
      }
    }
  ]
}
```

## Best Practices

1. **Set resource requests and limits**: Enables accurate monitoring
2. **Use labels consistently**: Facilitates filtering and grouping
3. **Implement health checks**: Kubernetes probes provide valuable signals
4. **Centralize logging**: Use a consistent format across services
5. **Establish baselines**: Know normal behavior to detect anomalies

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-api
  labels:
    app: web-api
    team: backend
    environment: production
spec:
  template:
    spec:
      containers:
      - name: web-api
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
          limits:
            cpu: "500m"
            memory: "512Mi"
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
```

## Resources

- [Container Insights Documentation](https://docs.microsoft.com/en-us/azure/azure-monitor/containers/container-insights-overview)
- [Log Analytics Query Language](https://docs.microsoft.com/en-us/azure/azure-monitor/logs/log-analytics-tutorial)
- [Application Insights for Kubernetes](https://docs.microsoft.com/en-us/azure/azure-monitor/app/kubernetes-codeless)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
