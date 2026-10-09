---
title: "Understanding Microsoft Fabric Capacities and SKUs"
description: "A Fabric Capacity is a pool of compute resources that powers all Fabric workloads in assigned workspaces. Unlike traditional Azure services where you…"
author: Michael John Peña
draft: false
date: 2023-05-11
tags:
  - Microsoft Fabric
  - Azure
  - Capacity Planning
  - Pricing
  - SKU
---

## What is a Fabric Capacity?

A Fabric Capacity is a pool of compute resources that powers all Fabric workloads in assigned workspaces. Unlike traditional Azure services where you provision separate resources, Fabric uses a unified capacity model.

```
┌─────────────────────────────────────────────────────┐
│                 Fabric Capacity                      │
│                   (F64 SKU)                         │
├─────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ Workspace A │  │ Workspace B │  │ Workspace C │ │
│  ├─────────────┤  ├─────────────┤  ├─────────────┤ │
│  │ Lakehouse   │  │ Warehouse   │  │ Power BI    │ │
│  │ Notebooks   │  │ Pipelines   │  │ Reports     │ │
│  │ Dataflows   │  │ KQL DB      │  │ Dataflows   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
├─────────────────────────────────────────────────────┤
│              Shared Compute Pool                     │
│     (64 Capacity Units - Burst & Smoothing)        │
└─────────────────────────────────────────────────────┘
```

## Fabric SKUs

Fabric offers various capacity SKUs measured in Capacity Units (CUs):

| SKU | Capacity Units | Power BI Equivalent | Use Case |
|-----|---------------|---------------------|----------|
| F2 | 2 CU | - | Trial, Testing |
| F4 | 4 CU | - | Small workloads |
| F8 | 8 CU | - | Small teams |
| F16 | 16 CU | - | Department |
| F32 | 32 CU | - | Department |
| F64 | 64 CU | P1 | Enterprise |
| F128 | 128 CU | P2 | Enterprise |
| F256 | 256 CU | P3 | Large Enterprise |
| F512 | 512 CU | P4 | Large Enterprise |
| F1024 | 1024 CU | P5 | Very Large Enterprise |
| F2048 | 2048 CU | - | Massive Scale |

```python
# Capacity Unit mapping to workload operations
capacity_mapping = {
    "spark_job": "CU-seconds based on cores used",
    "sql_query": "CU-seconds based on query complexity",
    "dataflow": "CU-hours based on data volume",
    "power_bi_refresh": "CU-seconds based on model size",
    "kql_query": "CU-seconds based on data scanned"
}
```

## Provisioning Capacity

### Azure Portal

```bash
# Create Fabric capacity via Azure CLI
az resource create \
    --resource-type "Microsoft.Fabric/capacities" \
    --name "my-fabric-capacity" \
    --resource-group "my-resource-group" \
    --location "eastus" \
    --properties '{
        "sku": {"name": "F64", "tier": "Fabric"},
        "administration": {
            "members": ["admin@contoso.com"]
        }
    }'
```

### Terraform

```hcl
# Terraform configuration for Fabric capacity
resource "azurerm_fabric_capacity" "main" {
  name                = "my-fabric-capacity"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  sku {
    name = "F64"
    tier = "Fabric"
  }

  administration {
    members = ["admin@contoso.com"]
  }

  tags = {
    environment = "production"
    department  = "analytics"
  }
}
```

## Capacity Management

### Pause and Resume

```python
# Pause capacity during off-hours to save costs
import requests
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
token = credential.get_token("https://management.azure.com/.default")

subscription_id = "your-subscription-id"
resource_group = "your-resource-group"
capacity_name = "your-capacity-name"

# Suspend capacity
suspend_url = f"https://management.azure.com/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Fabric/capacities/{capacity_name}/suspend?api-version=2022-07-01-preview"

response = requests.post(
    suspend_url,
    headers={"Authorization": f"Bearer {token.token}"}
)
print(f"Suspend status: {response.status_code}")

# Resume capacity
resume_url = f"https://management.azure.com/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Fabric/capacities/{capacity_name}/resume?api-version=2022-07-01-preview"

response = requests.post(
    resume_url,
    headers={"Authorization": f"Bearer {token.token}"}
)
print(f"Resume status: {response.status_code}")
```

### Auto-Pause Schedule

```python
# Azure Function to auto-pause capacity
import azure.functions as func
from azure.mgmt.fabric import FabricManagementClient
from azure.identity import DefaultAzureCredential

def main(timer: func.TimerRequest) -> None:
    credential = DefaultAzureCredential()
    client = FabricManagementClient(credential, subscription_id)

    # Pause at 8 PM
    if timer.schedule_status.last_occurrence.hour == 20:
        client.capacities.begin_suspend(resource_group, capacity_name)

    # Resume at 6 AM
    if timer.schedule_status.last_occurrence.hour == 6:
        client.capacities.begin_resume(resource_group, capacity_name)
```

## Capacity Metrics

Monitor capacity usage through the Fabric admin portal or Azure metrics:

```python
# Key metrics to monitor
metrics = {
    "capacity_cu_consumption": "Total CU consumption",
    "capacity_cu_percentage": "Percentage of capacity used",
    "active_users": "Number of concurrent users",
    "query_duration_seconds": "Average query execution time",
    "throttling_events": "Number of throttling occurrences"
}

# Query metrics via Azure Monitor
from azure.monitor.query import MetricsQueryClient
from datetime import timedelta

metrics_client = MetricsQueryClient(credential)

response = metrics_client.query_resource(
    resource_uri=f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Fabric/capacities/{capacity_name}",
    metric_names=["CUConsumption"],
    timespan=timedelta(days=1),
    granularity=timedelta(hours=1)
)

for metric in response.metrics:
    for ts in metric.timeseries:
        for data in ts.data:
            print(f"{data.timestamp}: {data.average} CU")
```

## Capacity Optimization

### Smoothing and Bursting

```python
# Fabric uses smoothing to handle burst workloads
# Operations are measured in CU-seconds
# Consumption is smoothed over time windows

# Example: A Spark job uses 128 CUs for 30 seconds
# Total consumption: 128 * 30 = 3,840 CU-seconds
# Smoothed over 5 minutes: 3,840 / 300 = 12.8 CU average

# If your capacity is F64 (64 CU):
# - Short bursts above 64 CU are allowed
# - Sustained load above 64 CU will cause throttling
```

### Right-Sizing Recommendations

```python
# Capacity sizing guidelines
def recommend_sku(daily_cu_hours, peak_cu, concurrent_users):
    """
    Recommend Fabric SKU based on usage patterns
    """
    recommendations = []

    # Based on sustained usage
    sustained_sku = daily_cu_hours / 24  # Average hourly CU

    # Based on peak with burst headroom (2x)
    peak_sku = peak_cu / 2

    # Based on concurrent users (rough estimate)
    user_sku = concurrent_users * 0.5  # ~0.5 CU per active user

    required_cu = max(sustained_sku, peak_sku, user_sku)

    # Map to available SKUs
    skus = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]
    recommended_sku = min(s for s in skus if s >= required_cu)

    return f"F{recommended_sku}"

# Example
sku = recommend_sku(
    daily_cu_hours=800,      # 800 CU-hours per day
    peak_cu=100,             # Peak of 100 CU
    concurrent_users=50      # 50 concurrent users
)
print(f"Recommended SKU: {sku}")  # Output: F64
```

## Cost Optimization Strategies

```python
# 1. Use appropriate SKU for workload
# Don't over-provision; monitor and adjust

# 2. Pause during off-hours
# Savings: Up to 50% if paused 12 hours/day

# 3. Use workspace load balancing
# Spread workloads across time if possible

# 4. Optimize queries and jobs
# Efficient code = less CU consumption

# 5. Consider reserved capacity
# 1-year commitment can save ~40%

cost_comparison = {
    "pay_as_you_go_f64": 4995.84,  # Monthly USD
    "reserved_1yr_f64": 2997.50,   # Monthly USD (40% savings)
}
```

Tomorrow, I will cover Fabric licensing for users and organizations.

## Resources

- [Fabric Capacity](https://learn.microsoft.com/en-us/fabric/enterprise/licenses)
- [Capacity SKUs](https://learn.microsoft.com/en-us/fabric/enterprise/fabric-capacity)
- [Capacity Metrics](https://learn.microsoft.com/en-us/fabric/enterprise/capacity-metrics)
