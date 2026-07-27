---
title: "Microsoft Fabric Capacity Management: Optimization Strategies"
author: Michael John Peña
draft: false
date: 2024-01-14
tags:
  - Microsoft Fabric
  - Capacity Planning
  - Cost Optimization
  - Azure
  - Performance
---

Capacity choices in Fabric determine both performance and cost. From real projects, I'll share the monitoring signals and optimization steps that actually reduced bill shock and improved SLAs.

## Understanding Fabric Capacity Units (CUs)

Capacity in Fabric is measured in Capacity Units (CUs), which represent compute resources across all workloads.

### CU Consumption by Workload

| Workload | CU Consumption Pattern |
|----------|----------------------|
| Power BI | Burst during refreshes, steady for reports |
| Spark/Notebooks | High during execution, zero when idle |
| Data Pipelines | Proportional to data volume |
| Dataflows Gen2 | CPU-intensive, variable |
| Real-Time Intelligence | Continuous, scales with ingestion rate |

## Monitoring Capacity Utilization

### Using the Fabric Capacity Metrics App

```python
# Query capacity metrics via REST API
import requests
from datetime import datetime, timedelta

def get_capacity_metrics(capacity_id: str, token: str, hours: int = 24):
    """Fetch capacity metrics from Fabric API."""

    end_time = datetime.utcnow()
    start_time = end_time - timedelta(hours=hours)

    url = f"https://api.fabric.microsoft.com/v1/capacities/{capacity_id}/metrics"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    params = {
        "startDateTime": start_time.isoformat() + "Z",
        "endDateTime": end_time.isoformat() + "Z",
        "granularity": "PT1H"  # Hourly
    }

    response = requests.get(url, headers=headers, params=params)
    return response.json()

# Analyze utilization
def analyze_utilization(metrics: dict) -> dict:
    """Analyze capacity utilization patterns."""

    cu_values = [m["cuUsed"] for m in metrics["value"]]

    return {
        "average_utilization": sum(cu_values) / len(cu_values),
        "peak_utilization": max(cu_values),
        "min_utilization": min(cu_values),
        "over_100_count": sum(1 for v in cu_values if v > 100),  # Throttling events
        "under_50_count": sum(1 for v in cu_values if v < 50)  # Under-utilized
    }
```

### Custom Monitoring Dashboard

```python
# Fabric notebook for capacity monitoring dashboard
from pyspark.sql.functions import *
from datetime import datetime, timedelta

# Load capacity metrics (assuming you've set up logging)
capacity_logs = spark.read.table("Tables/capacity_metrics_log")

# Last 7 days analysis
recent_metrics = capacity_logs.filter(
    col("timestamp") > (datetime.utcnow() - timedelta(days=7))
)

# Hourly utilization by workload
hourly_by_workload = recent_metrics \
    .withColumn("hour", date_trunc("hour", "timestamp")) \
    .groupBy("hour", "workload_type") \
    .agg(
        avg("cu_used").alias("avg_cu"),
        max("cu_used").alias("peak_cu"),
        sum("cu_used").alias("total_cu")
    ) \
    .orderBy("hour")

display(hourly_by_workload)

# Identify throttling periods
throttling_events = recent_metrics.filter(col("cu_used") > col("cu_available"))

print(f"Throttling events in last 7 days: {throttling_events.count()}")

# Cost breakdown by workspace
cost_by_workspace = recent_metrics \
    .groupBy("workspace_name") \
    .agg(
        sum("cu_used").alias("total_cu"),
        countDistinct("user_id").alias("unique_users")
    ) \
    .withColumn("estimated_cost",
        col("total_cu") * 0.36 / 3600  # $0.36 per CU-hour
    ) \
    .orderBy(col("total_cu").desc())

display(cost_by_workspace)
```

## Optimization Strategies

### 1. Workload Scheduling

Spread workloads to avoid peak contention:

```python
# Example: Stagger notebook executions
from datetime import datetime, timedelta
import random

def schedule_notebook_runs(notebooks: list, window_hours: int = 6):
    """Generate staggered schedule for notebooks."""

    schedules = []
    base_time = datetime.utcnow().replace(hour=2, minute=0)  # Start at 2 AM

    minutes_between = (window_hours * 60) // len(notebooks)

    for i, notebook in enumerate(notebooks):
        run_time = base_time + timedelta(minutes=i * minutes_between)
        # Add some jitter to avoid exact collisions
        run_time += timedelta(minutes=random.randint(0, 5))

        schedules.append({
            "notebook": notebook,
            "scheduled_time": run_time.strftime("%H:%M"),
            "cron": f"{run_time.minute} {run_time.hour} * * *"
        })

    return schedules

# Schedule 10 notebooks across 6 hours
notebooks = [f"etl_notebook_{i}" for i in range(10)]
schedule = schedule_notebook_runs(notebooks)
for s in schedule:
    print(f"{s['notebook']}: {s['scheduled_time']} ({s['cron']})")
```

### 2. Spark Optimization

Reduce CU consumption with efficient Spark code:

```python
# Before: Inefficient
def inefficient_join():
    df1 = spark.read.table("large_table")  # 100M rows
    df2 = spark.read.table("lookup_table")  # 10K rows

    # Full shuffle join
    result = df1.join(df2, "key")
    return result.count()

# After: Optimized
def optimized_join():
    from pyspark.sql.functions import broadcast

    df1 = spark.read.table("large_table")
    df2 = spark.read.table("lookup_table")

    # Broadcast small table
    result = df1.join(broadcast(df2), "key")
    return result.count()

# Before: Reading entire table
def read_all():
    df = spark.read.table("partitioned_table")
    return df.filter(col("date") == "2024-01-01").count()

# After: Partition pruning
def read_with_pruning():
    df = spark.read.table("partitioned_table").filter(col("date") == "2024-01-01")
    return df.count()
```

### 3. Direct Lake Optimization

Minimize fallback to import mode:

```python
# Check Direct Lake eligibility
def check_direct_lake_compatibility(table_name: str) -> dict:
    """Check if table is compatible with Direct Lake."""

    issues = []

    # Read table metadata
    df = spark.read.table(table_name)

    # Check row count
    row_count = df.count()
    if row_count > 1_500_000_000:  # 1.5B row limit
        issues.append(f"Row count ({row_count:,}) exceeds limit")

    # Check column count
    col_count = len(df.columns)
    if col_count > 1000:
        issues.append(f"Column count ({col_count}) exceeds limit")

    # Check for unsupported types
    unsupported_types = ["binary", "array", "map", "struct"]
    for field in df.schema.fields:
        if field.dataType.simpleString() in unsupported_types:
            issues.append(f"Unsupported type: {field.name} ({field.dataType})")

    return {
        "table": table_name,
        "compatible": len(issues) == 0,
        "issues": issues
    }

# Optimize table for Direct Lake
def optimize_for_direct_lake(table_name: str):
    """Run optimization for Direct Lake performance."""

    # Optimize file sizes (target 128MB-1GB files)
    spark.sql(f"OPTIMIZE {table_name}")

    # Update statistics
    spark.sql(f"ANALYZE TABLE {table_name} COMPUTE STATISTICS FOR ALL COLUMNS")

    # Vacuum old files
    from delta.tables import DeltaTable
    delta_table = DeltaTable.forName(spark, table_name)
    delta_table.vacuum(168)  # 7 days retention

    print(f"Optimization complete for {table_name}")
```

### 4. Autoscaling Configuration

Configure autoscale for variable workloads:

```json
{
  "capacitySettings": {
    "autoscale": {
      "enabled": true,
      "minCapacity": "F2",
      "maxCapacity": "F64",
      "scaleUpThreshold": 80,
      "scaleDownThreshold": 30,
      "scaleUpCooldownMinutes": 5,
      "scaleDownCooldownMinutes": 30
    }
  }
}
```

### 5. Workspace Isolation

Separate workloads by capacity:

```
Production Capacity (F64)
├── prod-reporting-workspace (Power BI)
├── prod-etl-workspace (Notebooks, Pipelines)
└── prod-realtime-workspace (Eventstreams, KQL)

Development Capacity (F8)
├── dev-sandbox-workspace
├── dev-testing-workspace
└── dev-experiments-workspace

Shared Capacity (F16)
├── shared-analytics-workspace
└── shared-reports-workspace
```

## Cost Estimation

```python
def estimate_fabric_cost(
    capacity_sku: str,
    hours_per_day: int = 24,
    days_per_month: int = 30
) -> dict:
    """Estimate monthly Fabric costs."""

    # SKU pricing (approximate, check current Azure pricing)
    sku_pricing = {
        "F2": 0.36,
        "F4": 0.72,
        "F8": 1.44,
        "F16": 2.88,
        "F32": 5.76,
        "F64": 11.52,
        "F128": 23.04,
        "F256": 46.08,
        "F512": 92.16
    }

    hourly_rate = sku_pricing.get(capacity_sku, 0)
    daily_cost = hourly_rate * hours_per_day
    monthly_cost = daily_cost * days_per_month

    return {
        "sku": capacity_sku,
        "hourly_rate": hourly_rate,
        "daily_cost": daily_cost,
        "monthly_cost": monthly_cost,
        "annual_cost": monthly_cost * 12
    }

# Compare options
for sku in ["F8", "F16", "F32", "F64"]:
    cost = estimate_fabric_cost(sku)
    print(f"{sku}: ${cost['monthly_cost']:,.2f}/month (${cost['annual_cost']:,.2f}/year)")
```

## Monitoring Alerts

```python
# Set up capacity alerts
from azure.monitor.ingestion import LogsIngestionClient
from azure.identity import DefaultAzureCredential

def create_capacity_alert(
    capacity_id: str,
    threshold_percent: int = 80,
    duration_minutes: int = 15
):
    """Create alert for capacity utilization."""

    alert_rule = {
        "name": f"fabric-capacity-{capacity_id}-high-utilization",
        "description": f"Alert when capacity utilization exceeds {threshold_percent}%",
        "severity": 2,
        "enabled": True,
        "condition": {
            "query": f"""
                FabricCapacityMetrics
                | where CapacityId == '{capacity_id}'
                | where TimeGenerated > ago({duration_minutes}m)
                | summarize AvgUtilization = avg(UtilizationPercent)
                | where AvgUtilization > {threshold_percent}
            """,
            "threshold": 0,
            "operator": "GreaterThan"
        },
        "actions": {
            "actionGroups": ["capacity-alerts-action-group"]
        }
    }

    return alert_rule
```

## Conclusion

Effective Fabric capacity management requires:

1. **Continuous monitoring** - Know your utilization patterns
2. **Workload scheduling** - Spread load across time
3. **Code optimization** - Efficient Spark and DAX
4. **Direct Lake tuning** - Minimize fallbacks
5. **Right-sizing** - Match capacity to actual needs

Start with monitoring, identify patterns, then optimize. The goal is predictable performance at minimal cost.
