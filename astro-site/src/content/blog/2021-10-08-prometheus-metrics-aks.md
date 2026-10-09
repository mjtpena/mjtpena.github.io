---
title: "Prometheus Metrics Collection in AKS"
description: "Prometheus became the observability standard for Kubernetes because its data model—time-series metrics with labels—maps naturally to the dynamic…"
author: "Michael John Peña"
draft: false
date: 2021-10-08
tags: ["Azure", "Kubernetes", "AKS", "Prometheus", "Monitoring"]
---

Prometheus became the observability standard for Kubernetes because its data model—time-series metrics with labels—maps naturally to the dynamic, label-heavy nature of Kubernetes workloads. Every pod's metrics are queryable by namespace, deployment, node, or any label. The pull model means Prometheus scrapes `/metrics` endpoints on a configured interval; the push model (Pushgateway) handles short-lived jobs that complete before the scrape interval. On AKS, the common deployment path is the kube-prometheus-stack Helm chart (formerly prometheus-operator), which installs Prometheus, Alertmanager, and Grafana with Kubernetes-ready scrape configurations and dashboards pre-configured. The Azure Managed Prometheus option (launched in preview 2022) removes the self-managed Prometheus operational burden—worth evaluating for teams that don't want to manage Prometheus storage and retention themselves.

## Prometheus Architecture

Prometheus uses a pull-based model:
1. Applications expose metrics on an HTTP endpoint
2. Prometheus scrapes these endpoints at regular intervals
3. Metrics are stored in a time-series database
4. PromQL queries extract insights from the data

## Deploying Prometheus with Helm

```bash
# Add Prometheus community Helm repo
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Create namespace
kubectl create namespace monitoring

# Install Prometheus stack (includes Grafana)
helm install prometheus prometheus-community/kube-prometheus-stack \
    --namespace monitoring \
    --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false \
    --set prometheus.prometheusSpec.podMonitorSelectorNilUsesHelmValues=false
```

## Exposing Application Metrics

### Python Flask Example

```python
from flask import Flask
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
import time

app = Flask(__name__)

# Define metrics
REQUEST_COUNT = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'endpoint', 'status']
)

REQUEST_LATENCY = Histogram(
    'http_request_duration_seconds',
    'HTTP request latency',
    ['method', 'endpoint']
)

@app.route('/api/data')
def get_data():
    start_time = time.time()

    # Your business logic here
    result = {"data": "example"}

    # Record metrics
    REQUEST_COUNT.labels(method='GET', endpoint='/api/data', status='200').inc()
    REQUEST_LATENCY.labels(method='GET', endpoint='/api/data').observe(time.time() - start_time)

    return result

@app.route('/metrics')
def metrics():
    return generate_latest(), 200, {'Content-Type': CONTENT_TYPE_LATEST}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
```

### .NET Core Example

```csharp
using Prometheus;

var builder = WebApplication.CreateBuilder(args);

// Add Prometheus metrics
builder.Services.AddSingleton<Counter>(
    Metrics.CreateCounter("http_requests_total", "Total HTTP requests",
        new CounterConfiguration
        {
            LabelNames = new[] { "method", "endpoint", "status" }
        }));

builder.Services.AddSingleton<Histogram>(
    Metrics.CreateHistogram("http_request_duration_seconds", "HTTP request latency",
        new HistogramConfiguration
        {
            LabelNames = new[] { "method", "endpoint" },
            Buckets = Histogram.ExponentialBuckets(0.001, 2, 10)
        }));

var app = builder.Build();

// Enable Prometheus metrics endpoint
app.UseMetricServer();
app.UseHttpMetrics();

app.MapGet("/api/data", (Counter counter, Histogram histogram) =>
{
    using (histogram.WithLabels("GET", "/api/data").NewTimer())
    {
        counter.WithLabels("GET", "/api/data", "200").Inc();
        return Results.Ok(new { data = "example" });
    }
});

app.Run();
```

## Creating ServiceMonitors

ServiceMonitors tell Prometheus which services to scrape:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: my-app-monitor
  namespace: monitoring
  labels:
    release: prometheus
spec:
  selector:
    matchLabels:
      app: my-app
  namespaceSelector:
    matchNames:
    - default
  endpoints:
  - port: http
    interval: 30s
    path: /metrics
```

## Creating PodMonitors

For pods without services:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: batch-job-monitor
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: batch-processor
  namespaceSelector:
    matchNames:
    - batch
  podMetricsEndpoints:
  - port: metrics
    interval: 60s
```

## PromQL Queries

### Request Rate

```promql
# Requests per second over 5 minutes
rate(http_requests_total[5m])

# Requests per second by endpoint
sum(rate(http_requests_total[5m])) by (endpoint)
```

### Latency Percentiles

```promql
# 95th percentile latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# 99th percentile by endpoint
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, endpoint))
```

### Error Rate

```promql
# Error rate percentage
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100
```

### Resource Usage

```promql
# Container CPU usage
sum(rate(container_cpu_usage_seconds_total{namespace="default"}[5m])) by (pod)

# Container memory usage
sum(container_memory_working_set_bytes{namespace="default"}) by (pod)
```

## Azure Monitor Integration

Container Insights can scrape Prometheus metrics:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: container-azm-ms-agentconfig
  namespace: kube-system
data:
  prometheus-data-collection-settings: |
    [prometheus_data_collection_settings.cluster]
      interval = "1m"
      monitor_kubernetes_pods = true
      monitor_kubernetes_pods_namespaces = ["default", "app"]
    [prometheus_data_collection_settings.node]
      interval = "1m"
      urls = ["http://localhost:9100/metrics"]
```

## Recording Rules

Pre-compute expensive queries with recording rules:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: recording-rules
  namespace: monitoring
spec:
  groups:
  - name: http_requests
    interval: 30s
    rules:
    - record: http:requests:rate5m
      expr: sum(rate(http_requests_total[5m])) by (endpoint)
    - record: http:latency:p95
      expr: histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, endpoint))
```

## Alerting Rules

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: alerting-rules
  namespace: monitoring
spec:
  groups:
  - name: http_alerts
    rules:
    - alert: HighErrorRate
      expr: |
        sum(rate(http_requests_total{status=~"5.."}[5m]))
        / sum(rate(http_requests_total[5m])) > 0.05
      for: 5m
      labels:
        severity: critical
      annotations:
        summary: "High error rate detected"
        description: "Error rate is {{ $value | humanizePercentage }}"

    - alert: HighLatency
      expr: |
        histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le)) > 1
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "High latency detected"
        description: "95th percentile latency is {{ $value }}s"
```

## Federation for Multi-Cluster

Configure federation to aggregate metrics from multiple clusters:

```yaml
scrape_configs:
  - job_name: 'federate'
    scrape_interval: 15s
    honor_labels: true
    metrics_path: '/federate'
    params:
      'match[]':
        - '{job="prometheus"}'
        - '{__name__=~"http_.*"}'
    static_configs:
      - targets:
        - 'prometheus-cluster1:9090'
        - 'prometheus-cluster2:9090'
```

## Storage Considerations

For production, configure persistent storage:

```yaml
prometheus:
  prometheusSpec:
    retention: 15d
    storageSpec:
      volumeClaimTemplate:
        spec:
          storageClassName: managed-premium
          accessModes: ["ReadWriteOnce"]
          resources:
            requests:
              storage: 100Gi
```

## Conclusion

Prometheus provides powerful metrics collection and alerting capabilities for Kubernetes workloads. Combined with Azure Monitor integration, you get the best of both worlds - detailed application metrics and centralized Azure monitoring.

Tomorrow, we'll build Grafana dashboards to visualize these Prometheus metrics effectively.
