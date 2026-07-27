---
title: "Capacity Management in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-06-12
tags:
  - Microsoft Fabric
  - Capacity
  - Performance
  - Cost Management
  - Administration
---

Effective capacity management is crucial for Fabric performance and cost control. Today I'm diving deep into capacity planning and optimization.

## Understanding Fabric Capacity

### Capacity Units (CUs)

```
Fabric SKUs and CUs:
├── F2:    2 CUs    - Dev/test
├── F4:    4 CUs    - Small workloads
├── F8:    8 CUs    - Medium workloads
├── F16:  16 CUs    - Production
├── F32:  32 CUs    - Large production
├── F64:  64 CUs    - Enterprise
├── F128: 128 CUs   - Large enterprise
├── F256: 256 CUs   - Very large
├── F512: 512 CUs   - Maximum
```

### Workload Distribution

```
CU Consumption by Workload:
├── Power BI (Semantic Models, Reports)
├── Data Engineering (Spark, Notebooks)
├── Data Warehouse (T-SQL queries)
├── Real-Time Intelligence (KQL)
├── Data Factory (Pipelines)
└── Data Science (ML workloads)
```

## Capacity Metrics

```python
from azure.identity import DefaultAzureCredential
from datetime import datetime, timedelta
import requests

def get_capacity_health(capacity_id: str, hours: int = 24) -> dict:
    """Get comprehensive capacity health metrics via REST API."""

    credential = DefaultAzureCredential()
    token = credential.get_token("https://api.fabric.microsoft.com/.default").token
    headers = {"Authorization": f"Bearer {token}"}
    admin_url = "https://api.fabric.microsoft.com/v1/admin"

    # Get capacity details
    capacity_response = requests.get(f"{admin_url}/capacities/{capacity_id}", headers=headers)
    capacity = capacity_response.json()

    # Note: Detailed metrics require the Fabric Capacity Metrics app
    # or Azure Monitor integration. The Admin API provides basic info.

    return {
        "capacity_id": capacity_id,
        "display_name": capacity.get("displayName"),
        "sku": capacity.get("sku"),
        "region": capacity.get("region"),
        "state": capacity.get("state"),
        # For detailed metrics, use:
        # 1. Fabric Capacity Metrics app (Power BI template)
        # 2. Azure Monitor metrics for the capacity resource
        # 3. Admin monitoring workspace in Fabric
        "note": "Detailed CU metrics available in Fabric Capacity Metrics app"
    }

# For detailed metrics, install the Fabric Capacity Metrics app
# https://learn.microsoft.com/fabric/enterprise/metrics-app

# Alternative: Query Azure Monitor for capacity metrics
def get_azure_monitor_metrics(subscription_id: str, resource_group: str, capacity_name: str):
    """Get capacity metrics from Azure Monitor."""
    credential = DefaultAzureCredential()
    token = credential.get_token("https://management.azure.com/.default").token
    headers = {"Authorization": f"Bearer {token}"}

    resource_id = f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Fabric/capacities/{capacity_name}"
    metrics_url = f"https://management.azure.com{resource_id}/providers/Microsoft.Insights/metrics"

    params = {
        "api-version": "2023-10-01",
        "metricnames": "CapacityUtilization",
        "timespan": f"PT{24}H"
    }

    response = requests.get(metrics_url, headers=headers, params=params)
    return response.json()
```

## Workload Analysis

```python
def analyze_workload_distribution(capacity_id: str, days: int = 7) -> dict:
    """Analyze CU consumption by workload type."""

    workload_metrics = client.get_workload_metrics(
        capacity_id=capacity_id,
        start_time=(datetime.utcnow() - timedelta(days=days)).isoformat(),
        end_time=datetime.utcnow().isoformat()
    )

    distribution = {}
    for metric in workload_metrics:
        workload = metric.workload_type
        if workload not in distribution:
            distribution[workload] = {
                "total_cu_seconds": 0,
                "operation_count": 0,
                "peak_cu": 0
            }

        distribution[workload]["total_cu_seconds"] += metric.cu_seconds
        distribution[workload]["operation_count"] += metric.operations
        distribution[workload]["peak_cu"] = max(
            distribution[workload]["peak_cu"],
            metric.peak_cu
        )

    # Calculate percentages
    total_cu = sum(w["total_cu_seconds"] for w in distribution.values())
    for workload in distribution:
        distribution[workload]["percentage"] = \
            distribution[workload]["total_cu_seconds"] / total_cu * 100

    return distribution

# Analyze
distribution = analyze_workload_distribution("capacity-123", days=7)
for workload, stats in sorted(
    distribution.items(),
    key=lambda x: x[1]["percentage"],
    reverse=True
):
    print(f"{workload}: {stats['percentage']:.1f}% ({stats['operation_count']} operations)")
```

## Cost Optimization

### Right-Sizing Analysis

```python
def recommend_capacity_size(capacity_id: str, target_utilization: float = 70) -> dict:
    """Recommend optimal capacity size based on usage patterns."""

    # Get 30 days of metrics
    health = get_capacity_health(capacity_id, hours=30*24)
    current_sku = client.get_capacity(capacity_id).sku

    SKU_CUS = {
        "F2": 2, "F4": 4, "F8": 8, "F16": 16,
        "F32": 32, "F64": 64, "F128": 128, "F256": 256, "F512": 512
    }

    current_cus = SKU_CUS[current_sku]
    avg_utilization = health["cu_utilization"]["average"]
    p95_utilization = health["cu_utilization"]["p95"]

    # Calculate needed CUs for target utilization
    needed_cus_avg = current_cus * (avg_utilization / target_utilization)
    needed_cus_p95 = current_cus * (p95_utilization / target_utilization)

    # Find recommended SKU
    recommended_sku = None
    for sku, cus in sorted(SKU_CUS.items(), key=lambda x: x[1]):
        if cus >= needed_cus_p95:
            recommended_sku = sku
            break

    # Calculate cost impact
    MONTHLY_COST = {
        "F2": 262, "F4": 524, "F8": 1049, "F16": 2098,
        "F32": 4196, "F64": 8392, "F128": 16784, "F256": 33568, "F512": 67136
    }

    current_cost = MONTHLY_COST[current_sku]
    recommended_cost = MONTHLY_COST[recommended_sku] if recommended_sku else current_cost

    return {
        "current_sku": current_sku,
        "recommended_sku": recommended_sku,
        "average_utilization": avg_utilization,
        "p95_utilization": p95_utilization,
        "current_monthly_cost": current_cost,
        "recommended_monthly_cost": recommended_cost,
        "monthly_savings": current_cost - recommended_cost,
        "recommendation": (
            "downsize" if recommended_cost < current_cost
            else "upsize" if recommended_cost > current_cost
            else "keep"
        )
    }
```

### Scheduling and Pause/Resume

```python
class CapacityScheduler:
    """Manage capacity scaling based on schedule."""

    def __init__(self, client, capacity_id: str):
        self.client = client
        self.capacity_id = capacity_id

    def apply_schedule(self, schedule: dict):
        """
        Schedule format:
        {
            "weekday_business": {"sku": "F64", "hours": "08:00-18:00"},
            "weekday_off": {"sku": "F8", "hours": "18:00-08:00"},
            "weekend": {"sku": "F4", "hours": "00:00-24:00"}
        }
        """
        current_time = datetime.now()
        day_of_week = current_time.weekday()
        current_hour = current_time.hour

        if day_of_week < 5:  # Weekday
            if 8 <= current_hour < 18:
                target_sku = schedule["weekday_business"]["sku"]
            else:
                target_sku = schedule["weekday_off"]["sku"]
        else:  # Weekend
            target_sku = schedule["weekend"]["sku"]

        current_sku = self.client.get_capacity(self.capacity_id).sku
        if current_sku != target_sku:
            self.client.resize_capacity(self.capacity_id, target_sku)
            print(f"Resized capacity from {current_sku} to {target_sku}")

    def pause_if_idle(self, idle_threshold_minutes: int = 30):
        """Pause capacity if no activity for threshold period."""
        last_activity = self.client.get_last_activity(self.capacity_id)
        idle_minutes = (datetime.utcnow() - last_activity).total_seconds() / 60

        if idle_minutes > idle_threshold_minutes:
            self.client.pause_capacity(self.capacity_id)
            print(f"Paused capacity after {idle_minutes:.0f} minutes idle")

# Usage with Azure Functions timer trigger
def capacity_scheduler_function(timer):
    scheduler = CapacityScheduler(client, "capacity-123")
    scheduler.apply_schedule({
        "weekday_business": {"sku": "F64"},
        "weekday_off": {"sku": "F8"},
        "weekend": {"sku": "F4"}
    })
```

## Throttling Management

```python
def analyze_throttling(capacity_id: str, hours: int = 24) -> dict:
    """Analyze throttling patterns and impacts."""

    metrics = client.get_throttling_metrics(
        capacity_id=capacity_id,
        start_time=(datetime.utcnow() - timedelta(hours=hours)).isoformat()
    )

    analysis = {
        "total_throttled_operations": 0,
        "by_workload": {},
        "by_hour": {},
        "impacted_workspaces": set()
    }

    for m in metrics:
        if m.throttled:
            analysis["total_throttled_operations"] += 1

            # By workload
            workload = m.workload_type
            if workload not in analysis["by_workload"]:
                analysis["by_workload"][workload] = 0
            analysis["by_workload"][workload] += 1

            # By hour
            hour = m.timestamp.hour
            if hour not in analysis["by_hour"]:
                analysis["by_hour"][hour] = 0
            analysis["by_hour"][hour] += 1

            analysis["impacted_workspaces"].add(m.workspace_id)

    analysis["impacted_workspaces"] = list(analysis["impacted_workspaces"])

    # Find peak throttling hour
    if analysis["by_hour"]:
        peak_hour = max(analysis["by_hour"], key=analysis["by_hour"].get)
        analysis["peak_throttling_hour"] = peak_hour

    return analysis

# Monitor and alert
throttling = analyze_throttling("capacity-123", hours=24)
if throttling["total_throttled_operations"] > 100:
    print(f"HIGH THROTTLING: {throttling['total_throttled_operations']} operations throttled")
    print(f"Peak hour: {throttling.get('peak_throttling_hour', 'N/A')}")
```

## Multi-Capacity Strategy

```python
class MultiCapacityManager:
    """Manage multiple capacities for different workloads."""

    def __init__(self, client):
        self.client = client
        self.capacities = {
            "interactive": "capacity-interactive",
            "batch": "capacity-batch",
            "development": "capacity-dev"
        }

    def route_workload(self, workspace_id: str, workload_type: str) -> str:
        """Route workspace to appropriate capacity."""
        routing_rules = {
            "interactive_reporting": "interactive",
            "batch_processing": "batch",
            "development": "development",
            "ml_training": "batch"
        }

        target_pool = routing_rules.get(workload_type, "batch")
        target_capacity = self.capacities[target_pool]

        self.client.workspaces.assign_to_capacity(
            workspace_id,
            target_capacity
        )

        return target_capacity

    def rebalance(self):
        """Rebalance workspaces across capacities based on utilization."""
        utilization = {}
        for pool, cap_id in self.capacities.items():
            health = get_capacity_health(cap_id, hours=1)
            utilization[pool] = health["cu_utilization"]["average"]

        # Find overloaded and underloaded
        overloaded = [p for p, u in utilization.items() if u > 80]
        underloaded = [p for p, u in utilization.items() if u < 40]

        if overloaded and underloaded:
            # Move some workspaces from overloaded to underloaded
            source_cap = self.capacities[overloaded[0]]
            target_cap = self.capacities[underloaded[0]]

            # Get workspaces with lowest priority
            workspaces = self.client.workspaces.list_by_capacity(source_cap)
            movable = [ws for ws in workspaces if ws.priority == "low"][:3]

            for ws in movable:
                self.client.workspaces.assign_to_capacity(ws.id, target_cap)
                print(f"Moved {ws.name} from {source_cap} to {target_cap}")
```

## Best Practices

1. **Monitor continuously** - Set up alerts for utilization thresholds
2. **Right-size regularly** - Review capacity sizing monthly
3. **Use scheduling** - Scale down during off-hours
4. **Separate workloads** - Use multiple capacities for isolation
5. **Plan for peaks** - Consider burst capacity needs

## What's Next

Tomorrow I'll cover tenant settings in detail.

## Resources

- [Fabric Capacity](https://learn.microsoft.com/fabric/enterprise/capacity)
- [Capacity Metrics](https://learn.microsoft.com/fabric/enterprise/metrics)
- [Cost Management](https://learn.microsoft.com/fabric/enterprise/cost-management)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
