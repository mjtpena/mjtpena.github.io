---
title: "Fabric Monitoring: Observability for Your Data Platform"
author: Michael John Peña
draft: false
date: 2023-06-12
tags:
  - Microsoft Fabric
  - Monitoring
  - Observability
  - Admin
  - Operations
---

One of my first questions when evaluating any data platform for enterprise use is "how do I see what's actually running?" — and in the early Fabric previews, the answer was incomplete. That's improving. The Monitoring Hub in Fabric gives a workspace-scoped view of all activities: running and completed Spark jobs, pipeline runs, dataflow refreshes, and semantic model refreshes — all in a single list with status, duration, and drill-through to logs. At the capacity level, the Fabric Capacity Metrics app (a separately installed Power BI app from Microsoft AppSource) provides the deeper telemetry: CU consumption over time, throttling events, smoothing behaviour, and which operations consumed the most capacity units. Both tools are necessary — neither tells the full story alone.

## Monitoring Overview

```
┌─────────────────────────────────────────────────────┐
│              Fabric Monitoring Stack                 │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │              Monitoring Hub                      ││
│  │  - Activity history                              ││
│  │  - Job status                                    ││
│  │  - Error details                                 ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────┴───────────────────────────┐│
│  │           Capacity Metrics App                   ││
│  │  - CU consumption                                ││
│  │  - Workload distribution                        ││
│  │  - Throttling events                            ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────┴───────────────────────────┐│
│  │              Admin Portal                        ││
│  │  - Tenant settings                               ││
│  │  - Usage metrics                                 ││
│  │  - Audit logs                                    ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────┴───────────────────────────┐│
│  │           Azure Log Analytics                    ││
│  │  - Diagnostic logs                               ││
│  │  - Custom queries                                ││
│  │  - Alerts                                        ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Monitoring Hub

The Monitoring Hub provides real-time visibility into activities:

```python
# Access Monitoring Hub:
# 1. Fabric Portal > Monitoring Hub (left nav)
# 2. View recent activities across workspaces

monitoring_hub_features = {
    "activity_types": [
        "Notebook runs",
        "Pipeline runs",
        "Dataflow refreshes",
        "Spark job definitions",
        "Semantic model refreshes"
    ],
    "filters": [
        "Time range",
        "Status (Running, Completed, Failed)",
        "Item type",
        "Workspace"
    ],
    "details": [
        "Start/end time",
        "Duration",
        "Error messages",
        "Resource consumption"
    ]
}
```

### Querying Activity History

```python
from azure.identity import DefaultAzureCredential
import requests
from datetime import datetime, timedelta

def get_recent_activities(workspace_id: str, hours: int = 24):
    """Get recent activities from Monitoring Hub"""

    credential = DefaultAzureCredential()
    token = credential.get_token("https://api.fabric.microsoft.com/.default")

    start_time = (datetime.utcnow() - timedelta(hours=hours)).isoformat() + "Z"

    url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/activities"

    params = {
        "startDateTime": start_time,
        "status": "Failed"  # Filter for failures
    }

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {token.token}"},
        params=params
    )

    activities = response.json()["value"]

    for activity in activities:
        print(f"Activity: {activity['itemName']}")
        print(f"  Type: {activity['itemType']}")
        print(f"  Status: {activity['status']}")
        print(f"  Start: {activity['startTime']}")
        if activity.get('errorMessage'):
            print(f"  Error: {activity['errorMessage']}")
        print()

    return activities
```

## Capacity Metrics App

Install and use the Capacity Metrics app for detailed capacity analysis:

```python
# Install from AppSource:
# 1. Power BI > Apps > Get apps
# 2. Search "Microsoft Fabric Capacity Metrics"
# 3. Install and connect to your capacity

capacity_metrics = {
    "overview": [
        "Total CU consumption",
        "CU by workload type",
        "Peak utilization times",
        "Throttling indicators"
    ],
    "workload_breakdown": [
        "Spark CU consumption",
        "SQL CU consumption",
        "Dataflow CU consumption",
        "Power BI CU consumption"
    ],
    "time_analysis": [
        "Hourly consumption patterns",
        "Daily trends",
        "Weekly comparisons"
    ]
}
```

### Custom Capacity Monitoring

```python
# Create custom monitoring using Log Analytics
# Configure diagnostic settings on capacity

log_analytics_queries = {
    "cu_consumption_by_hour": """
        FabricCapacityMetrics
        | where TimeGenerated > ago(24h)
        | summarize AvgCU = avg(CUConsumption), MaxCU = max(CUConsumption)
            by bin(TimeGenerated, 1h)
        | order by TimeGenerated asc
    """,

    "top_consuming_items": """
        FabricCapacityMetrics
        | where TimeGenerated > ago(24h)
        | summarize TotalCU = sum(CUConsumption) by ItemName, ItemType
        | top 20 by TotalCU desc
    """,

    "throttling_events": """
        FabricCapacityMetrics
        | where TimeGenerated > ago(7d)
        | where ThrottlingOccurred == true
        | summarize ThrottleCount = count() by bin(TimeGenerated, 1h), ItemType
        | order by TimeGenerated asc
    """,

    "failed_activities": """
        FabricActivityLogs
        | where TimeGenerated > ago(24h)
        | where Status == "Failed"
        | summarize FailureCount = count() by ItemName, ErrorCode
        | order by FailureCount desc
    """
}
```

## Spark Monitoring

```python
# Monitor Spark jobs within notebooks

from pyspark.sql import SparkSession

# Access Spark UI
# In notebook: View > Spark session > Open Spark UI

# Programmatic monitoring
spark = SparkSession.builder.getOrCreate()

# Get Spark application ID
app_id = spark.sparkContext.applicationId
print(f"Application ID: {app_id}")

# Monitor job progress
def monitor_job_progress():
    """Track Spark job stages"""
    sc = spark.sparkContext
    status_tracker = sc.statusTracker()

    active_jobs = status_tracker.getActiveJobIds()
    print(f"Active jobs: {active_jobs}")

    for job_id in active_jobs:
        job_info = status_tracker.getJobInfo(job_id)
        if job_info:
            print(f"Job {job_id}: {job_info.status}")

# Enable detailed logging
spark.conf.set("spark.sql.debug.maxToStringFields", "100")
spark.conf.set("spark.eventLog.enabled", "true")
```

### Spark Metrics in Notebooks

```python
# Track execution metrics
import time
from contextlib import contextmanager

@contextmanager
def track_execution(operation_name):
    """Track execution time and row counts"""
    start_time = time.time()
    print(f"Starting: {operation_name}")

    yield

    duration = time.time() - start_time
    print(f"Completed: {operation_name} in {duration:.2f}s")

# Usage
with track_execution("Load and transform sales"):
    df = spark.read.format("delta").table("raw_sales")
    transformed = df.transform(my_transformation)
    row_count = transformed.count()
    print(f"Processed {row_count:,} rows")
```

## Pipeline Monitoring

```python
# Monitor pipeline runs
def get_pipeline_runs(workspace_id: str, pipeline_name: str, days: int = 7):
    """Get pipeline run history"""

    credential = DefaultAzureCredential()
    token = credential.get_token("https://api.fabric.microsoft.com/.default")

    # Get pipeline ID
    pipelines_url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items?type=DataPipeline"
    pipelines_response = requests.get(
        pipelines_url,
        headers={"Authorization": f"Bearer {token.token}"}
    )

    pipeline_id = None
    for pipeline in pipelines_response.json()["value"]:
        if pipeline["displayName"] == pipeline_name:
            pipeline_id = pipeline["id"]
            break

    if not pipeline_id:
        return []

    # Get runs
    runs_url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items/{pipeline_id}/runs"
    runs_response = requests.get(
        runs_url,
        headers={"Authorization": f"Bearer {token.token}"}
    )

    runs = runs_response.json()["value"]

    # Summarize
    summary = {
        "total_runs": len(runs),
        "successful": sum(1 for r in runs if r["status"] == "Succeeded"),
        "failed": sum(1 for r in runs if r["status"] == "Failed"),
        "avg_duration": sum(r.get("durationInMs", 0) for r in runs) / len(runs) / 1000 if runs else 0
    }

    return summary
```

## Alerting

```python
# Set up alerts using Azure Monitor

alert_rules = {
    "capacity_threshold": {
        "name": "High CU Usage Alert",
        "condition": "CUConsumption > 90%",
        "window": "15 minutes",
        "severity": "Warning",
        "action": "Send email to data-ops@company.com"
    },
    "pipeline_failure": {
        "name": "Pipeline Failure Alert",
        "condition": "PipelineStatus == Failed",
        "window": "Immediate",
        "severity": "Error",
        "action": "Send to Teams channel"
    },
    "refresh_failure": {
        "name": "Semantic Model Refresh Failure",
        "condition": "RefreshStatus == Failed",
        "window": "Immediate",
        "severity": "Error",
        "action": "Create PagerDuty incident"
    }
}

# Create alert via Azure Monitor API
def create_alert_rule(rule_config):
    """Create Azure Monitor alert rule"""
    # Implementation using Azure Monitor Management API
    pass
```

## Custom Monitoring Dashboard

```python
# Build monitoring dashboard in Power BI
dashboard_components = {
    "capacity_overview": {
        "metrics": ["Current CU %", "24h Avg CU", "Peak CU Today"],
        "visualization": "Card/KPI"
    },
    "activity_trend": {
        "metrics": ["Activities by hour", "Success rate"],
        "visualization": "Line chart"
    },
    "failure_analysis": {
        "metrics": ["Failures by type", "Error codes"],
        "visualization": "Bar chart"
    },
    "top_consumers": {
        "metrics": ["Items by CU consumption"],
        "visualization": "Table"
    }
}
```

Effective monitoring ensures your Fabric platform operates reliably. Tomorrow, I will cover Fabric Capacity Metrics in more detail.

## Resources

- [Monitoring Hub](https://learn.microsoft.com/en-us/fabric/admin/monitoring-hub)
- [Capacity Metrics App](https://learn.microsoft.com/en-us/fabric/enterprise/capacity-metrics-app)
- [Diagnostic Settings](https://learn.microsoft.com/en-us/fabric/admin/service-admin-premium-workloads)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
