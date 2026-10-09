---
title: "Microsoft Fabric Trial: What You Get and How to Maximize It"
description: "The Fabric trial is one of the more generous evaluation paths Microsoft has offered for a data platform — a 60-day, F64-equivalent capacity for free is a…"
author: Michael John Peña
draft: false
date: 2023-07-03
tags:
  - Microsoft Fabric
  - Azure
  - Trial
  - Getting Started
---

The Fabric trial is one of the more generous evaluation paths Microsoft has offered for a data platform — a 60-day, F64-equivalent capacity for free is a meaningful allocation. F64 means 64 Capacity Units, which supports real Spark workloads, concurrent Warehouse queries, and Dataflow Gen2 refreshes without the toy-example limitations of a smaller SKU. What I noticed after activating my trial: the trial capacity is a specific tenant-level resource, not a subscription resource, so it doesn't appear in the Azure portal. You manage it entirely from the Fabric admin portal. The 60-day clock starts from activation, and at the end you can either purchase an F-SKU capacity or pause — your data stays in OneLake even after the capacity expires, it just becomes inaccessible until you reattach or reassign capacity.

## What the Trial Includes

When you start a Fabric trial, you receive:

| Resource | Amount |
|----------|--------|
| Capacity Units (CU) | 64 |
| Duration | 60 days |
| OneLake Storage | 1 TB |
| Workspaces | Unlimited |
| Users | Just you (individual trial) |

The 64 CUs translate to roughly:
- F64 capacity equivalent
- Significant Spark compute
- Substantial SQL processing power

## Starting Your Trial

```python
# How to start the trial:
# 1. Navigate to app.fabric.microsoft.com
# 2. Sign in with your work or school account
# 3. Click the user icon (top right)
# 4. Select "Start trial"

# Verify your trial is active:
# Go to Account > Manage account > Subscriptions
# You should see "Microsoft Fabric (Free Trial)"
```

## Understanding Capacity Units

Capacity Units (CUs) are the universal compute currency in Fabric:

```python
# CU consumption by workload type (approximate)
cu_consumption = {
    "spark_notebook": {
        "small_cluster": 4,   # CU per hour
        "medium_cluster": 16,
        "large_cluster": 32
    },
    "dataflow_gen2": {
        "standard": 0.33,     # CU per dataflow refresh
        "premium": 1.0
    },
    "sql_warehouse": {
        "per_query": 0.01,    # CU varies by query complexity
        "sustained": 2        # CU per hour for active use
    },
    "kql_database": {
        "ingestion": 0.05,    # CU per GB ingested
        "query": 0.01         # CU per query (varies)
    }
}

def estimate_daily_cu(workload_hours):
    """Estimate daily CU consumption"""
    estimate = 0
    estimate += workload_hours.get("spark", 0) * 16
    estimate += workload_hours.get("sql", 0) * 2
    estimate += workload_hours.get("dataflows", 0) * 5
    return estimate

# Example: 2 hours Spark, 4 hours SQL, 10 dataflows
daily_estimate = estimate_daily_cu({
    "spark": 2,
    "sql": 4,
    "dataflows": 10
})
print(f"Estimated daily CU: {daily_estimate}")
```

## Trial Limitations

Be aware of these trial-specific constraints:

```python
trial_limitations = {
    "sharing": "Cannot share workspaces with others",
    "api_access": "Limited API functionality",
    "capacity_pause": "Cannot pause capacity",
    "data_export": "Some export features limited",
    "premium_features": "Some P-SKU features unavailable"
}

# The biggest limitation: single user
# Trial is for individual evaluation only
# For team evaluation, you need a paid capacity
```

## Maximizing Your 60 Days

Here's my recommended trial evaluation plan:

### Week 1-2: Foundation

```python
week1_2_plan = [
    "Create workspaces for each workload type",
    "Build a Lakehouse with sample data",
    "Create basic notebooks for data transformation",
    "Explore the SQL endpoint",
    "Connect Power BI to DirectLake"
]

# Focus: Understanding the basics
```

### Week 3-4: Data Engineering

```python
week3_4_plan = [
    "Build a complete data pipeline",
    "Test Dataflow Gen2 vs notebooks",
    "Implement Delta Lake patterns",
    "Test data quality frameworks",
    "Explore shortcut capabilities"
]

# Focus: Data movement and transformation
```

### Week 5-6: Advanced Features

```python
week5_6_plan = [
    "Deploy ML models",
    "Build real-time analytics with KQL",
    "Create eventstreams",
    "Test cross-workspace queries",
    "Implement data governance patterns"
]

# Focus: Advanced capabilities
```

### Week 7-8: Production Readiness

```python
week7_8_plan = [
    "Document findings and patterns",
    "Create architecture recommendations",
    "Estimate production costs",
    "Identify gaps and workarounds",
    "Plan migration strategy"
]

# Focus: Decision making
```

## Sample Workloads to Test

Here are workloads I recommend testing during your trial:

```python
# 1. Batch data pipeline
def test_batch_pipeline():
    """Test standard ETL patterns"""
    # Load raw data
    raw = spark.read.format("csv").load("Files/raw/")

    # Transform
    transformed = raw.transform(clean_data).transform(enrich_data)

    # Load to Delta
    transformed.write.format("delta").mode("merge").save("Tables/processed")

# 2. Real-time ingestion
# Create an eventstream connected to Event Hub
# Verify latency and throughput

# 3. SQL analytics workload
"""
Run analytical queries typical of your workload:
- Aggregations over large datasets
- Complex joins
- Window functions
- Query performance analysis
"""

# 4. ML model deployment
# Train a simple model in a notebook
# Deploy to Fabric model registry
# Test inference patterns
```

## Monitoring Your Trial Usage

Track your consumption to avoid surprises:

```python
# Check usage in the Admin portal
# Capacity settings > View metrics

# Key metrics to watch:
monitoring_metrics = {
    "cpu_percent": "Should stay under 80% average",
    "memory_percent": "Watch for spikes",
    "cu_consumed": "Track daily trend",
    "throttling_events": "Should be zero"
}

# Set up alerts (if available in trial)
# Navigate to: Capacity settings > Notifications
```

## After the Trial

When your trial ends, you have options:

```python
post_trial_options = {
    "purchase_capacity": {
        "F2": "$262.80/month",  # Minimum for Fabric
        "F64": "$8,409.60/month",  # Equivalent to trial
        "description": "Continue with paid capacity"
    },
    "power_bi_premium": {
        "P1": "~$4,995/month",
        "description": "If you have existing Premium"
    },
    "export_data": {
        "method": "Download from OneLake",
        "description": "Preserve your work before trial ends"
    }
}

# Important: Export critical work before trial expiration!
```

## My Trial Experience

After using the trial extensively:

**What Works Well:**
- Spark notebooks are responsive
- SQL endpoint performance is good
- OneLake shortcuts work reliably
- Power BI DirectLake is impressive

**What Needs Work:**
- Some UI responsiveness issues
- Documentation gaps in some areas
- Error messages could be clearer

## Tips for Success

1. **Start with a clear goal**: Don't just explore randomly
2. **Document everything**: Screenshots, code, findings
3. **Test realistic workloads**: Use your actual data patterns
4. **Engage with community**: Microsoft Fabric Community has active discussions
5. **Submit feedback**: Use the feedback button in the portal

Tomorrow we'll dive into Fabric workspace setup and organization best practices.

## Resources

- [Start Fabric Trial](https://learn.microsoft.com/en-us/fabric/get-started/fabric-trial)
- [Fabric Capacity Planning](https://learn.microsoft.com/en-us/fabric/enterprise/licenses)
- [Fabric Community](https://community.fabric.microsoft.com/)
