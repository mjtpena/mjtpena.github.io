---
title: "Prometheus with Azure Monitor: Unified Observability"
description: "Azure Monitor for Prometheus addresses these while maintaining compatibility."
author: Michael John Peña
draft: false
date: 2021-05-15
tags:
  - Azure
  - Prometheus
  - Monitoring
  - Kubernetes
  - Observability
---

## The Challenge

Self-managed Prometheus requires:
- Scaling for high-cardinality metrics
- Long-term storage solutions
- High availability configuration
- Alert manager setup
- Security management

Azure Monitor for Prometheus addresses these while maintaining compatibility.

## Azure Monitor Managed Prometheus

### Creating a Workspace

```bash
# Create Azure Monitor Workspace
az monitor account create \
    --name my-prometheus-workspace \
    --resource-group my-rg \
    --location eastus

# Get workspace ID
WORKSPACE_ID=$(az monitor account show \
    --name my-prometheus-workspace \
    --resource-group my-rg \
    --query id -o tsv)
```

### Connecting AKS

```bash
# Enable Prometheus metrics on AKS
az aks update \
    --name my-aks-cluster \
    --resource-group my-rg \
    --enable-azure-monitor-metrics \
    --azure-monitor-workspace-resource-id $WORKSPACE_ID
```

This deploys:
- Metrics collection agents
- Recording rules processor
- Remote write endpoint

## Prometheus Scrape Configuration

Customize what gets scraped:

```yaml
# ama-metrics-prometheus-config ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: ama-metrics-prometheus-config
  namespace: kube-system
data:
  prometheus-config: |
    global:
      scrape_interval: 15s
      evaluation_interval: 15s

    scrape_configs:
      # Kubernetes API servers
      - job_name: 'kubernetes-apiservers'
        kubernetes_sd_configs:
          - role: endpoints
        scheme: https
        tls_config:
          ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
        bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token
        relabel_configs:
          - source_labels: [__meta_kubernetes_namespace, __meta_kubernetes_service_name, __meta_kubernetes_endpoint_port_name]
            action: keep
            regex: default;kubernetes;https

      # Kubernetes nodes
      - job_name: 'kubernetes-nodes'
        kubernetes_sd_configs:
          - role: node
        relabel_configs:
          - action: labelmap
            regex: __meta_kubernetes_node_label_(.+)

      # Application pods with prometheus.io annotations
      - job_name: 'kubernetes-pods'
        kubernetes_sd_configs:
          - role: pod
        relabel_configs:
          - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
            action: keep
            regex: true
          - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
            action: replace
            target_label: __metrics_path__
            regex: (.+)
          - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
            action: replace
            regex: ([^:]+)(?::\d+)?;(\d+)
            replacement: $1:$2
            target_label: __address__
```

## Querying with PromQL

Use Azure Monitor to query Prometheus metrics:

```bash
# Install Azure CLI extension
az extension add --name monitor-control-service

# Query metrics
az monitor metrics list \
    --resource $WORKSPACE_ID \
    --metric-namespace "prometheus" \
    --metric "up" \
    --start-time 2021-05-15T00:00:00Z \
    --end-time 2021-05-15T01:00:00Z
```

In Grafana, connect to Azure Monitor Prometheus:

```promql
# Container CPU usage
sum(rate(container_cpu_usage_seconds_total{namespace="production"}[5m])) by (pod)

# Memory usage percentage
sum(container_memory_working_set_bytes{namespace="production"}) by (pod)
/ sum(container_spec_memory_limit_bytes{namespace="production"}) by (pod)
* 100

# Request rate
sum(rate(http_requests_total{job="web-api"}[5m])) by (status_code)

# Error rate
sum(rate(http_requests_total{job="web-api",status_code=~"5.."}[5m]))
/ sum(rate(http_requests_total{job="web-api"}[5m]))
* 100

# P99 latency
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{job="web-api"}[5m])) by (le))
```

## Recording Rules

Define recording rules for expensive queries:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ama-metrics-prometheus-config
  namespace: kube-system
data:
  recording-rules: |
    groups:
      - name: kubernetes-apps
        interval: 30s
        rules:
          - record: namespace:container_cpu_usage_seconds_total:sum_rate
            expr: |
              sum by (namespace) (
                rate(container_cpu_usage_seconds_total{image!=""}[5m])
              )

          - record: namespace:container_memory_usage_bytes:sum
            expr: |
              sum by (namespace) (
                container_memory_usage_bytes{image!=""}
              )

          - record: namespace:http_request_rate:sum
            expr: |
              sum by (namespace) (
                rate(http_requests_total[5m])
              )

      - name: application-slos
        interval: 30s
        rules:
          - record: job:http_request_duration_seconds:p99
            expr: |
              histogram_quantile(0.99,
                sum by (job, le) (
                  rate(http_request_duration_seconds_bucket[5m])
                )
              )

          - record: job:http_request_error_rate:ratio
            expr: |
              sum by (job) (rate(http_requests_total{status_code=~"5.."}[5m]))
              /
              sum by (job) (rate(http_requests_total[5m]))
```

## Alert Rules

Configure alerting via Azure Monitor:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ama-metrics-prometheus-config
  namespace: kube-system
data:
  alerting-rules: |
    groups:
      - name: kubernetes-alerts
        rules:
          - alert: PodCrashLooping
            expr: |
              rate(kube_pod_container_status_restarts_total[15m]) * 60 * 5 > 0
            for: 15m
            labels:
              severity: warning
            annotations:
              summary: "Pod {{ $labels.namespace }}/{{ $labels.pod }} is crash looping"
              description: "Pod has restarted more than 5 times in the last 15 minutes"

          - alert: HighMemoryUsage
            expr: |
              sum by (namespace, pod) (container_memory_usage_bytes)
              / sum by (namespace, pod) (container_spec_memory_limit_bytes)
              > 0.9
            for: 5m
            labels:
              severity: warning
            annotations:
              summary: "High memory usage in {{ $labels.namespace }}/{{ $labels.pod }}"
              description: "Memory usage is above 90%"

          - alert: HighErrorRate
            expr: |
              job:http_request_error_rate:ratio > 0.05
            for: 5m
            labels:
              severity: critical
            annotations:
              summary: "High error rate for {{ $labels.job }}"
              description: "Error rate is above 5%"
```

## Python Application with Prometheus

Instrument your Python application:

```python
from prometheus_client import Counter, Histogram, Gauge, start_http_server
from functools import wraps
import time

# Define metrics
REQUEST_COUNT = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'endpoint', 'status_code']
)

REQUEST_LATENCY = Histogram(
    'http_request_duration_seconds',
    'HTTP request latency',
    ['method', 'endpoint'],
    buckets=[.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10]
)

ACTIVE_REQUESTS = Gauge(
    'http_requests_active',
    'Active HTTP requests',
    ['method', 'endpoint']
)

IN_PROGRESS = Gauge(
    'background_jobs_in_progress',
    'Background jobs currently running',
    ['job_type']
)

def track_requests(method, endpoint):
    """Decorator to track request metrics"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            ACTIVE_REQUESTS.labels(method=method, endpoint=endpoint).inc()
            start_time = time.time()

            try:
                result = func(*args, **kwargs)
                status_code = getattr(result, 'status_code', 200)
                REQUEST_COUNT.labels(
                    method=method,
                    endpoint=endpoint,
                    status_code=status_code
                ).inc()
                return result
            except Exception as e:
                REQUEST_COUNT.labels(
                    method=method,
                    endpoint=endpoint,
                    status_code=500
                ).inc()
                raise
            finally:
                REQUEST_LATENCY.labels(
                    method=method,
                    endpoint=endpoint
                ).observe(time.time() - start_time)
                ACTIVE_REQUESTS.labels(method=method, endpoint=endpoint).dec()

        return wrapper
    return decorator

# Flask example
from flask import Flask, Response
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST

app = Flask(__name__)

@app.route('/metrics')
def metrics():
    return Response(generate_latest(), mimetype=CONTENT_TYPE_LATEST)

@app.route('/api/users')
@track_requests('GET', '/api/users')
def get_users():
    # Your logic here
    return {'users': []}

if __name__ == '__main__':
    start_http_server(8001)  # Prometheus metrics on separate port
    app.run(host='0.0.0.0', port=8000)
```

## Kubernetes Deployment with Metrics

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-api
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "8000"
    prometheus.io/path: "/metrics"
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-api
  template:
    metadata:
      labels:
        app: web-api
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8000"
        prometheus.io/path: "/metrics"
    spec:
      containers:
      - name: web-api
        image: myregistry.azurecr.io/web-api:latest
        ports:
        - containerPort: 8000
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
          limits:
            cpu: "500m"
            memory: "512Mi"
```

## Federation with Self-Managed Prometheus

If you have existing Prometheus instances:

```yaml
# Remote write to Azure Monitor
remote_write:
  - url: "https://<workspace-id>.prometheus.monitor.azure.com/api/v1/write"
    azure_ad:
      cloud: AzurePublic
      managed_identity:
        client_id: "<managed-identity-client-id>"
```

## Resources

- [Azure Monitor Managed Prometheus](https://docs.microsoft.com/en-us/azure/azure-monitor/essentials/prometheus-metrics-overview)
- [PromQL Documentation](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Prometheus Client Libraries](https://prometheus.io/docs/instrumenting/clientlibs/)
