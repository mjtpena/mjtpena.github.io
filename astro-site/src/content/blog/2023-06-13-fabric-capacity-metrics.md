---
title: "Fabric Capacity Metrics: Understanding and Optimizing Consumption"
author: Michael John Peña
draft: false
date: 2023-06-13
tags:
  - Microsoft Fabric
  - Capacity
  - Metrics
  - Optimization
  - Cost Management
---

Fabric's capacity unit (CU) model is genuinely different from the per-resource billing in Synapse Analytics, and understanding it properly is the difference between a cost-optimised deployment and an expensive surprise at month end. Every operation in Fabric — a Spark job, a pipeline run, a semantic model refresh, a Warehouse query — consumes CUs, and all of that consumption is pooled against your F-SKU capacity. Fabric applies a smoothing mechanism (a 24-hour rolling window) so brief spikes don't immediately throttle you, but sustained oversubscription will. The Fabric Capacity Metrics app, available from AppSource, is the primary instrument for this — it shows CU consumption per operation, per item, per workspace, and highlights the top contributors to throttling events. Today I'm going through how to read those reports accurately.

## Capacity Unit (CU) Consumption

Fabric uses Capacity Units (CUs) as the unified measure of compute consumption:

```
┌─────────────────────────────────────────────────────┐
│            CU Consumption Model                      │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │              Workload Operations                 ││
│  │                                                  ││
│  │  Spark Job ──▶ CU-seconds based on cores       ││
│  │  SQL Query ──▶ CU-seconds based on complexity  ││
│  │  Dataflow  ──▶ CU-hours based on data volume   ││
│  │  Refresh   ──▶ CU-seconds based on model size  ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│                        ▼                            │
│  ┌─────────────────────────────────────────────────┐│
│  │              Smoothing                           ││
│  │                                                  ││
│  │  CU consumption is smoothed over time windows  ││
│  │  to allow for burst workloads                  ││
│  │                                                  ││
│  │  Burst: Can exceed capacity briefly            ││
│  │  Sustained: Must stay within capacity          ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│                        ▼                            │
│  ┌─────────────────────────────────────────────────┐│
│  │              Throttling                          ││
│  │                                                  ││
│  │  If smoothed consumption exceeds capacity,     ││
│  │  operations may be delayed or rejected         ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Using the Capacity Metrics App

```python
# Key metrics to monitor
key_metrics = {
    "cu_consumption": {
        "description": "Total CU consumption",
        "target": "Stay below capacity limit (smoothed)",
        "alert_threshold": "80% sustained"
    },
    "interactive_cu": {
        "description": "CU from interactive operations (queries, reports)",
        "priority": "High (not throttled)",
        "optimization": "Optimize queries, use caching"
    },
    "background_cu": {
        "description": "CU from background operations (refreshes, jobs)",
        "priority": "Can be delayed during peak",
        "optimization": "Schedule off-peak"
    },
    "throttling_events": {
        "description": "Operations delayed due to capacity limits",
        "target": "Zero or minimal",
        "action": "Scale up or optimize workloads"
    }
}
```

### Analyzing Consumption Patterns

```python
# Pattern analysis from Capacity Metrics App

# 1. Identify peak hours
# Look at hourly CU consumption chart
# Common peaks: Business hours, end-of-day, month-end

# 2. Identify heavy consumers
# Sort items by CU consumption
# Focus optimization on top 10-20%

# 3. Analyze workload mix
# Balance interactive and background workloads
# Move background jobs to off-peak hours

analysis_queries = {
    "peak_hours": """
        SELECT
            DATEPART(HOUR, Timestamp) as Hour,
            AVG(CUConsumption) as AvgCU,
            MAX(CUConsumption) as PeakCU
        FROM CapacityMetrics
        WHERE Timestamp > DATEADD(day, -7, GETUTCDATE())
        GROUP BY DATEPART(HOUR, Timestamp)
        ORDER BY AvgCU DESC
    """,

    "top_consumers": """
        SELECT TOP 20
            ItemName,
            ItemType,
            SUM(CUSeconds) as TotalCU,
            COUNT(*) as ExecutionCount,
            AVG(CUSeconds) as AvgCUPerRun
        FROM CapacityMetrics
        WHERE Timestamp > DATEADD(day, -7, GETUTCDATE())
        GROUP BY ItemName, ItemType
        ORDER BY TotalCU DESC
    """,

    "workload_distribution": """
        SELECT
            ItemType,
            SUM(CUSeconds) as TotalCU,
            100.0 * SUM(CUSeconds) / SUM(SUM(CUSeconds)) OVER() as Percentage
        FROM CapacityMetrics
        WHERE Timestamp > DATEADD(day, -7, GETUTCDATE())
        GROUP BY ItemType
        ORDER BY TotalCU DESC
    """
}
```

## Optimization Strategies

### Spark Optimization

```python
# Optimize Spark workloads

spark_optimization = {
    "partition_management": {
        "problem": "Too many or too few partitions",
        "solution": """
            # Set appropriate partitions
            spark.conf.set("spark.sql.shuffle.partitions", 200)

            # Repartition before heavy operations
            df = df.repartition(100, "partition_column")

            # Coalesce for writing smaller outputs
            df.coalesce(10).write.format("delta").save(path)
        """
    },
    "caching": {
        "problem": "Repeated reads of same data",
        "solution": """
            # Cache frequently accessed data
            df = spark.read.format("delta").table("dimension_table")
            df.cache()

            # Use after processing
            # ...

            # Unpersist when done
            df.unpersist()
        """
    },
    "broadcast_joins": {
        "problem": "Large shuffle joins",
        "solution": """
            from pyspark.sql.functions import broadcast

            # Broadcast small tables (< 10MB)
            result = large_df.join(broadcast(small_df), "key")
        """
    },
    "predicate_pushdown": {
        "problem": "Reading unnecessary data",
        "solution": """
            # Filter early, especially on partition columns
            df = spark.read.format("delta").table("sales") \\
                .filter("year = 2023") \\
                .filter("month = 6")

            # Select only needed columns
            df = df.select("col1", "col2", "col3")
        """
    }
}
```

### SQL Optimization

```sql
-- Optimize SQL queries

-- 1. Use appropriate indexes (Warehouse)
-- Fabric Warehouse auto-indexes, but you can hint

-- 2. Avoid SELECT *
SELECT column1, column2, column3  -- Explicit columns
FROM table_name
WHERE filter_column = 'value'

-- 3. Use appropriate filters
SELECT *
FROM large_table
WHERE partition_date = '2023-06-01'  -- Filter on partition

-- 4. Avoid expensive operations
-- Instead of DISTINCT on large datasets, use GROUP BY
SELECT column1, column2
FROM table_name
GROUP BY column1, column2  -- More efficient than DISTINCT

-- 5. Use CTEs for readability without perf impact
WITH filtered_data AS (
    SELECT * FROM sales WHERE year = 2023
)
SELECT category, SUM(amount)
FROM filtered_data
GROUP BY category
```

### Scheduling Optimization

```python
# Schedule background workloads for off-peak hours

scheduling_strategy = {
    "peak_hours": {
        "window": "8 AM - 6 PM local",
        "reserve_for": "Interactive queries, reports",
        "avoid": "Large refreshes, bulk processing"
    },
    "off_peak_hours": {
        "window": "10 PM - 6 AM local",
        "schedule": [
            "Semantic model refreshes",
            "Large pipeline runs",
            "Batch processing jobs",
            "OPTIMIZE operations"
        ]
    },
    "weekends": {
        "usage": "Typically lower",
        "schedule": [
            "Heavy maintenance tasks",
            "Full data loads",
            "Historical processing"
        ]
    }
}

# Example: Stagger refreshes
refresh_schedule = {
    "semantic_model_1": "02:00 UTC",
    "semantic_model_2": "02:30 UTC",
    "semantic_model_3": "03:00 UTC",
    "semantic_model_4": "03:30 UTC"
}
```

## Capacity Sizing

```python
def estimate_required_capacity(workload_analysis):
    """Estimate required capacity based on workload"""

    # Get peak sustained CU consumption
    peak_sustained_cu = workload_analysis["peak_15min_avg"]

    # Add headroom for burst (50%)
    required_cu = peak_sustained_cu * 1.5

    # Map to available SKUs
    sku_mapping = {
        2: "F2", 4: "F4", 8: "F8", 16: "F16",
        32: "F32", 64: "F64", 128: "F128",
        256: "F256", 512: "F512", 1024: "F1024"
    }

    # Find appropriate SKU
    recommended_sku = None
    for sku_cu, sku_name in sorted(sku_mapping.items()):
        if sku_cu >= required_cu:
            recommended_sku = sku_name
            break

    return {
        "peak_sustained_cu": peak_sustained_cu,
        "required_cu_with_headroom": required_cu,
        "recommended_sku": recommended_sku,
        "notes": [
            "Consider growth projections",
            "Evaluate pause/resume for cost savings",
            "Monitor after sizing adjustment"
        ]
    }
```

## Cost Optimization

```python
cost_optimization_strategies = {
    "right_sizing": {
        "description": "Match capacity to actual usage",
        "action": "Analyze 30-day consumption, adjust SKU",
        "savings": "20-40% typical"
    },
    "auto_pause": {
        "description": "Pause capacity during idle periods",
        "action": "Schedule pause during non-business hours",
        "savings": "Up to 50% (12 hours/day pause)"
    },
    "workload_optimization": {
        "description": "Reduce CU consumption per operation",
        "action": "Optimize queries, caching, scheduling",
        "savings": "10-30% typical"
    },
    "reserved_capacity": {
        "description": "Commit to 1-year for discount",
        "action": "Purchase reserved capacity",
        "savings": "~40% vs pay-as-you-go"
    }
}
```

Understanding and optimizing capacity consumption ensures cost-effective operations. Tomorrow, I will cover Fabric Security.

## Resources

- [Capacity Metrics App](https://learn.microsoft.com/en-us/fabric/enterprise/capacity-metrics-app)
- [Capacity Planning](https://learn.microsoft.com/en-us/fabric/enterprise/capacity-planning)
- [Optimization Best Practices](https://learn.microsoft.com/en-us/fabric/data-engineering/delta-optimization-and-v-order)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
