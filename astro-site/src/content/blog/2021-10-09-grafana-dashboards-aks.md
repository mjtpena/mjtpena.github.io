---
title: "Building Effective Grafana Dashboards for AKS"
author: "Michael John Peña"
draft: false
date: 2021-10-09
tags: ["Azure", "Kubernetes", "AKS", "Grafana", "Monitoring", "Visualization"]

---

I wrote "Building Effective Grafana Dashboards for AKS" to share practical, production-minded guidance on this topic.

Grafana is the visualisation layer that makes Prometheus metrics interpretable at a glance—and for AKS, the starting point is the community dashboards that someone has already built. The Grafana community dashboard library includes excellent AKS dashboards: the Kubernetes cluster overview (node CPU/memory, pod counts by namespace), the Kubernetes deployment dashboard (replica availability, rollout history), and the Node Exporter Full dashboard (detailed node-level metrics). The real value comes from building application-specific dashboards: importing application-level Prometheus metrics (request rate, error rate, latency percentiles from your services) and correlating them with infrastructure metrics. For production AKS operations, the RED method dashboards (Request rate, Error rate, Duration for each service) give the fastest path to identifying which service is responsible for a degradation in a distributed system.

## Deploying Grafana

If you installed kube-prometheus-stack, Grafana is already included. Otherwise:

```bash
helm install grafana grafana/grafana \
    --namespace monitoring \
    --set persistence.enabled=true \
    --set persistence.size=10Gi \
    --set adminPassword='your-secure-password'
```

## Accessing Grafana

```bash
# Port forward to access Grafana
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80

# Get admin password (if using kube-prometheus-stack)
kubectl get secret -n monitoring prometheus-grafana -o jsonpath="{.data.admin-password}" | base64 --decode
```

## Configuring Data Sources

### Prometheus Data Source

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    url: http://prometheus-kube-prometheus-prometheus:9090
    access: proxy
    isDefault: true
```

### Azure Monitor Data Source

```yaml
apiVersion: 1
datasources:
  - name: Azure Monitor
    type: grafana-azure-monitor-datasource
    jsonData:
      cloudName: azuremonitor
      tenantId: ${TENANT_ID}
      clientId: ${CLIENT_ID}
      subscriptionId: ${SUBSCRIPTION_ID}
    secureJsonData:
      clientSecret: ${CLIENT_SECRET}
```

## Building a Cluster Overview Dashboard

### JSON Dashboard Definition

```json
{
  "dashboard": {
    "title": "AKS Cluster Overview",
    "panels": [
      {
        "title": "Cluster CPU Usage",
        "type": "gauge",
        "gridPos": {"h": 8, "w": 6, "x": 0, "y": 0},
        "targets": [
          {
            "expr": "sum(rate(container_cpu_usage_seconds_total{namespace!=\"kube-system\"}[5m])) / sum(machine_cpu_cores) * 100",
            "legendFormat": "CPU %"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "thresholds": {
              "steps": [
                {"color": "green", "value": null},
                {"color": "yellow", "value": 70},
                {"color": "red", "value": 90}
              ]
            },
            "unit": "percent",
            "max": 100
          }
        }
      },
      {
        "title": "Cluster Memory Usage",
        "type": "gauge",
        "gridPos": {"h": 8, "w": 6, "x": 6, "y": 0},
        "targets": [
          {
            "expr": "sum(container_memory_working_set_bytes{namespace!=\"kube-system\"}) / sum(machine_memory_bytes) * 100",
            "legendFormat": "Memory %"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "thresholds": {
              "steps": [
                {"color": "green", "value": null},
                {"color": "yellow", "value": 70},
                {"color": "red", "value": 90}
              ]
            },
            "unit": "percent",
            "max": 100
          }
        }
      }
    ]
  }
}
```

## Creating Dashboard Panels

### Node Resource Panel

```promql
# CPU usage by node
sum(rate(container_cpu_usage_seconds_total{id="/"}[5m])) by (node)

# Memory usage by node
sum(container_memory_working_set_bytes{id="/"}) by (node)
```

### Pod Status Panel

```promql
# Running pods by namespace
count(kube_pod_status_phase{phase="Running"}) by (namespace)

# Pending pods
count(kube_pod_status_phase{phase="Pending"}) by (namespace)
```

### Network Traffic Panel

```promql
# Network receive rate by pod
sum(rate(container_network_receive_bytes_total[5m])) by (pod)

# Network transmit rate by pod
sum(rate(container_network_transmit_bytes_total[5m])) by (pod)
```

## Application Dashboard Template

```json
{
  "dashboard": {
    "title": "Application Metrics",
    "templating": {
      "list": [
        {
          "name": "namespace",
          "type": "query",
          "query": "label_values(kube_pod_info, namespace)",
          "datasource": "Prometheus"
        },
        {
          "name": "deployment",
          "type": "query",
          "query": "label_values(kube_deployment_labels{namespace=\"$namespace\"}, deployment)",
          "datasource": "Prometheus"
        }
      ]
    },
    "panels": [
      {
        "title": "Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "sum(rate(http_requests_total{namespace=\"$namespace\"}[5m])) by (endpoint)",
            "legendFormat": "{{endpoint}}"
          }
        ]
      },
      {
        "title": "Latency P95",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{namespace=\"$namespace\"}[5m])) by (le, endpoint))",
            "legendFormat": "{{endpoint}}"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "sum(rate(http_requests_total{namespace=\"$namespace\", status=~\"5..\"}[5m])) / sum(rate(http_requests_total{namespace=\"$namespace\"}[5m])) * 100",
            "legendFormat": "Error %"
          }
        ]
      }
    ]
  }
}
```

## SLA/SLO Dashboard

### Availability Panel

```promql
# Uptime percentage (30d)
(1 - sum(rate(http_requests_total{status=~"5.."}[30d])) / sum(rate(http_requests_total[30d]))) * 100
```

### Error Budget Panel

```promql
# Error budget remaining (99.9% SLO)
((1 - 0.999) - (sum(rate(http_requests_total{status=~"5.."}[30d])) / sum(rate(http_requests_total[30d])))) / (1 - 0.999) * 100
```

### Latency SLO Panel

```promql
# Percentage of requests under 200ms
sum(rate(http_request_duration_seconds_bucket{le="0.2"}[5m])) / sum(rate(http_request_duration_seconds_count[5m])) * 100
```

## Provisioning Dashboards via ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-dashboards
  namespace: monitoring
  labels:
    grafana_dashboard: "1"
data:
  cluster-overview.json: |
    {
      "dashboard": {
        "title": "AKS Cluster Overview",
        "uid": "aks-cluster-overview",
        "panels": [...]
      }
    }
```

## Alert Annotations

Show alerts on dashboards:

```json
{
  "annotations": {
    "list": [
      {
        "name": "Alerts",
        "datasource": "Prometheus",
        "enable": true,
        "expr": "ALERTS{alertstate=\"firing\"}",
        "titleFormat": "{{alertname}}",
        "textFormat": "{{description}}"
      }
    ]
  }
}
```

## Azure Managed Grafana

For production, consider Azure Managed Grafana:

```bash
# Create Azure Managed Grafana instance
az grafana create \
    --name myGrafana \
    --resource-group myResourceGroup \
    --location eastus

# Link to Azure Monitor workspace
az grafana data-source create \
    --name myGrafana \
    --resource-group myResourceGroup \
    --definition '{
        "name": "Azure Monitor",
        "type": "grafana-azure-monitor-datasource",
        "access": "proxy"
    }'
```

## Dashboard Best Practices

1. **Use variables** - Make dashboards reusable with template variables
2. **Layer information** - Overview at top, details below
3. **Consistent time ranges** - Use dashboard time picker, not per-panel
4. **Color coding** - Use consistent colors for status (green=good, red=bad)
5. **Include context** - Add text panels explaining metrics
6. **Link dashboards** - Create drill-down links between dashboards

## Conclusion

Effective Grafana dashboards provide immediate visibility into cluster and application health. By combining Prometheus metrics with thoughtful visualization, you can quickly identify and troubleshoot issues.

Tomorrow, we'll explore Azure Monitor for containers and how it integrates with your existing monitoring setup.

