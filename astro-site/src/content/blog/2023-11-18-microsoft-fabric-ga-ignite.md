---
title: "Microsoft Fabric is GA: What We Learned from Six Months of Preview"
description: "Microsoft Fabric reached General Availability at Ignite 2023 — November 15-17 in Seattle — and it's the outcome I genuinely thought might take another six…"
author: Michael John Peña
draft: false
date: 2023-11-18
tags:
  - Microsoft Fabric
  - Azure
  - Ignite
  - Data Engineering
  - Analytics
---

Microsoft Fabric reached General Availability at Ignite 2023 — November 15-17 in Seattle — and it's the outcome I genuinely thought might take another six months. When Fabric launched in preview at Build 2023 in May, the platform was impressive in breadth but rough in places that matter for production: the Capacity Metrics app was hard to read, Git integration was limited to Azure DevOps, and some features behaved differently from their documented behaviour. Six months of weekly updates addressed most of those rough edges, and the GA announcement means Microsoft is committing to production SLAs and backward compatibility for the core platform. What GA doesn't mean: complete. Copilot in Fabric, several data science features, and some governance capabilities remain in preview within the GA platform. The data platform teams who started their preview journey in May are in the best position to move to production — they already know where the edges are.

## The Numbers Speak

During preview:
- 25,000 organizations adopted Fabric
- 67% of Fortune 500 companies started using it
- 84% of organizations use 3+ workloads (not just Power BI)

These numbers suggest Fabric isn't just hype - organizations are finding real value in the integrated platform.

## What's GA vs. Still Preview

**Generally Available:**
- OneLake and Lakehouse
- Data Factory (Pipelines and Dataflows Gen2)
- Data Warehouse
- Power BI in Fabric
- Data Engineering (Spark notebooks and jobs)
- Basic Real-Time Analytics

**Still in Preview:**
- Copilot for Fabric (AI assistance)
- Data Activator (event-driven automation)
- Some Real-Time Analytics features
- Mirroring (replication from external databases)

For production workloads, stick to the GA features. Preview features are improving rapidly but may change.

## Pricing Clarity

Microsoft announced reservation pricing that can save up to 40.5% over pay-as-you-go:

| Capacity | Pay-As-You-Go | 1-Year Reserved |
|----------|---------------|-----------------|
| F2       | ~$262/month   | ~$175/month     |
| F4       | ~$525/month   | ~$350/month     |
| F64      | ~$8,400/month | ~$5,600/month   |

Key pricing insights:
- **One meter for all workloads**: Spark, SQL, Dataflows, Power BI - all draw from the same capacity
- **Burst capability**: Exceed your capacity temporarily (with throttling)
- **Pause/resume**: Stop billing when not in use (for dev/test environments)
- **OneLake storage**: Separate charge, ~$0.023/GB/month

## Copilot in Fabric Preview

The most exciting preview announcement is Copilot integration. AI assistance is coming to:

**Power BI:**
```
User: Create a report showing sales trends by region with year-over-year comparison

Copilot: [Generates a multi-page report with appropriate visualizations,
         filters, and DAX measures for YoY calculations]
```

**Data Engineering:**
```python
# In a notebook, ask Copilot:
# "Transform this sales data: remove nulls, standardize dates, add fiscal year column"

# Copilot generates:
df = df.dropna(subset=['amount', 'customer_id'])
df = df.withColumn('sale_date', to_date(col('sale_date'), 'yyyy-MM-dd'))
df = df.withColumn('fiscal_year',
    when(month(col('sale_date')) >= 7, year(col('sale_date')) + 1)
    .otherwise(year(col('sale_date'))))
```

**Data Factory:**
Natural language to pipeline creation - describe what you want to move and transform, Copilot generates the pipeline.

This is still preview and requires appropriate licensing, but the potential is significant.

## Lessons from Six Months of Preview

**1. OneLake Shortcuts are Powerful**

We migrated a client from Azure Data Lake + Synapse to Fabric without moving data:

```python
# Create shortcut to existing ADLS data
# No data movement, immediate access in Fabric

# In Fabric portal:
# Lakehouse > Get data > New shortcut > Azure Data Lake Storage Gen2
# Point to existing containers

# Immediately available for:
# - Spark processing
# - SQL queries via SQL endpoint
# - Power BI reports
```

**2. Start with Lakehouse, Not Warehouse**

The Lakehouse is more flexible:
- Write with Spark or Dataflows
- Query with SQL via auto-generated endpoint
- Direct Power BI connectivity
- Full Delta Lake capabilities

Reserve the Warehouse for scenarios requiring:
- Traditional T-SQL workloads
- Specific SQL Server compatibility
- Teams that only know SQL

**3. Capacity Planning Requires Monitoring**

Fabric's single capacity model means workloads compete. We've seen:
- Heavy Spark jobs throttling Power BI queries
- Large dataflow refreshes impacting report performance
- Need for workload management

```python
# Monitor capacity usage via Fabric Admin REST APIs
import requests
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default")

headers = {"Authorization": f"Bearer {token.token}"}

# Get capacity metrics via Admin API
capacity_id = "your-capacity-id"
url = f"https://api.fabric.microsoft.com/v1/admin/capacities/{capacity_id}"

response = requests.get(url, headers=headers)
capacity_info = response.json()

# For detailed metrics, use the Fabric Capacity Metrics app
# or query the metrics workspace
print(f"Capacity state: {capacity_info.get('state')}")

# Alert if capacity is throttling
if capacity_info.get("state") == "Throttled":
    print("WARNING: Fabric capacity is throttling - consider scaling up")
```

**4. Governance is Built-in but Requires Setup**

OneLake provides unified governance, but you need to configure:
- Workspace roles and permissions
- Sensitivity labels
- Endorsement for trusted content
- Lineage tracking

Don't assume default settings are sufficient for enterprise compliance.

## Migration Patterns

**From Power BI Premium:**
- Easiest migration - enable Fabric on existing capacity
- Lakehouse can supplement existing datasets
- Gradual adoption of additional workloads

**From Azure Synapse Analytics:**
- OneLake shortcuts to existing ADLS data
- Migrate pipelines to Fabric Data Factory
- Consider hybrid: Synapse Serverless + Fabric Lakehouse

**From Databricks:**
- Unity Catalog data accessible via shortcuts
- Consider keeping Databricks for ML workloads
- Use Fabric for Power BI and downstream analytics

## What I'm Excited About

**Real-Time Intelligence:** The combination of KQL databases, Real-Time hub, and Data Activator creates an end-to-end streaming platform. For IoT and operational analytics, this is compelling.

**Copilot Potential:** AI assistance across the entire data lifecycle - from ingestion to visualization - could dramatically accelerate development.

**Simplified Operations:** One capacity, one admin experience, one governance model. For organizations drowning in Azure service sprawl, Fabric offers consolidation.

## What I'm Watching

**Performance at Scale:** GA doesn't mean battle-tested. Large workloads will reveal limitations.

**Copilot Accuracy:** AI-generated code and reports need careful validation. Hallucinations in data pipelines have real consequences.

**Multi-Cloud Story:** Fabric is deeply Azure-native. Organizations with multi-cloud strategies need hybrid approaches.

## Getting Started with GA

1. **Assess Current State:** Inventory your existing Azure data services
2. **Identify Quick Wins:** Power BI Premium workloads are easiest to migrate
3. **Pilot with Lakehouse:** Start a new project in Fabric Lakehouse
4. **Monitor Capacity:** Understand your consumption patterns before committing
5. **Train Teams:** The unified experience requires updated skills

## Conclusion

Microsoft Fabric GA is a milestone. It's not the end of the journey - many features are still preview, and real-world production experience will reveal areas for improvement. But for organizations committed to the Microsoft data platform, Fabric represents the future.

The question is no longer whether to adopt Fabric, but when and how.

## Resources

- [Microsoft Fabric GA Announcement](https://www.microsoft.com/en-us/microsoft-fabric/blog/2023/11/15/prepare-your-data-for-ai-innovation-with-microsoft-fabric-now-generally-available/)
- [Fabric Pricing](https://azure.microsoft.com/en-us/pricing/details/microsoft-fabric/)
- [Fabric Learning Path](https://learn.microsoft.com/en-us/training/fabric/)
- [Ignite 2023 Fabric Sessions](https://ignite.microsoft.com/sessions)
