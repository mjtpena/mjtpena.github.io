---
title: "Microsoft Fabric Public Preview: What You Need to Know"
description: "Six weeks into the Fabric public preview and I'm past the demo phase — I'm running actual data engineering workloads and discovering what holds up and what…"
author: Michael John Peña
draft: false
date: 2023-07-01
tags:
  - Microsoft Fabric
  - Azure
  - Data Engineering
  - Analytics
---

Six weeks into the Fabric public preview and I'm past the demo phase — I'm running actual data engineering workloads and discovering what holds up and what doesn't. The public preview launched at Build 2023 on May 23, and as of July the trial is stable: you get a free 60-day F64 capacity equivalent, which is a genuinely usable allocation for learning and prototyping (F64 maps to 64 Capacity Units, roughly equivalent to the old Power BI Premium P2). What's not yet here: VNet integration, full Warehouse connector parity with ADF, some Git integration edge cases with large workspaces, and GitHub repository support (Azure DevOps only for now). I want to give you an accurate picture of the preview as it stands — what works well, what has sharp edges, and what's clearly on the roadmap.

## The Preview State

Public preview means the service is available to everyone, but with some caveats:
- Features may change before GA
- Not recommended for production workloads
- SLAs are limited
- Some features are still being rolled out

That said, the preview is robust enough for serious evaluation and proof-of-concept work.

## What's Available in Preview

The current preview includes all major Fabric workloads:

### Data Engineering
- Lakehouses with Delta Lake format
- Spark notebooks with Python, Scala, R, and SQL
- Spark job definitions for scheduled workloads

### Data Factory
- Data pipelines for orchestration
- Dataflow Gen2 for Power Query-based ETL
- Copy activity for data movement

### Data Warehouse
- T-SQL data warehouse
- Cross-database queries
- Query insights and performance monitoring

### Real-Time Analytics
- KQL databases
- Eventstreams for streaming ingestion
- Real-time dashboards

### Data Science
- ML models and experiments
- MLflow integration
- Notebooks with ML libraries

### Power BI
- Direct Lake mode
- Integrated semantic models
- Real-time reporting

## Preview Limitations

Some features have limitations in preview:

```python
# Spark pool configuration is fixed in preview
# You can't customize these settings yet
spark.conf.get("spark.executor.memory")  # Returns preset value
spark.conf.get("spark.executor.cores")   # Returns preset value

# Workaround: Use session-level configs where supported
spark.conf.set("spark.sql.shuffle.partitions", "200")
```

Current limitations include:
- Fixed Spark pool configurations
- Limited regions available
- Some connectors not yet available
- Capacity limits on trial

## Accessing the Preview

To access Fabric preview:

```powershell
# Check if Fabric is enabled for your tenant
# In Power BI Admin Portal:
# Admin Portal > Tenant Settings > Microsoft Fabric

# For individual trial:
# 1. Go to app.fabric.microsoft.com
# 2. Click "Start trial" if prompted
# 3. Trial provides 64 capacity units for 60 days
```

## Creating Your First Workspace

```python
# Once in Fabric, create a workspace
# Via the UI: Workspaces > New workspace

# Important settings:
# - License: Trial or Premium capacity
# - Default storage: OneLake (automatic)
# - Region: Choose closest available

# Workspace naming convention I recommend:
# {team}-{environment}-{purpose}
# Example: analytics-dev-sales
```

## Preview vs GA Expectations

Based on Microsoft's announcements, expect these at GA:
- More Spark configuration options
- Additional connectors
- Enhanced security features
- Better monitoring and observability
- Performance improvements

## My Recommendation

If you're evaluating Fabric:

1. **Start now**: The preview is stable enough for learning
2. **Don't go to production**: Wait for GA for production workloads
3. **Test your patterns**: Validate your architecture approaches
4. **Document differences**: Note any workarounds needed

## Sample Evaluation Checklist

Here's what I'm testing in my evaluation:

```python
# Evaluation areas to test
evaluation_areas = {
    "data_ingestion": [
        "File upload to Lakehouse",
        "API data ingestion",
        "Database replication",
        "Streaming data"
    ],
    "data_transformation": [
        "Spark transformations",
        "Dataflow Gen2",
        "SQL-based transforms",
        "Data quality checks"
    ],
    "data_serving": [
        "SQL endpoint queries",
        "Power BI DirectLake",
        "API access patterns",
        "Cross-workspace queries"
    ],
    "operations": [
        "Monitoring capabilities",
        "Error handling",
        "Scheduling reliability",
        "Cost tracking"
    ]
}

for area, items in evaluation_areas.items():
    print(f"\n{area.upper()}")
    for item in items:
        print(f"  [ ] {item}")
```

## What's Next

Over the coming weeks, I'll dive deep into each Fabric workload. Tomorrow, we'll look at getting started with Fabric - the practical steps to go from zero to your first Lakehouse.

## Resources

- [Microsoft Fabric Preview Documentation](https://learn.microsoft.com/en-us/fabric/)
- [Fabric Preview FAQ](https://learn.microsoft.com/en-us/fabric/get-started/fabric-faq)
- [Known Issues in Preview](https://learn.microsoft.com/en-us/fabric/get-started/fabric-known-issues)
