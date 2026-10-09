---
title: "Microsoft Ignite 2021: Data, AI, and the Intelligent Cloud"
description: "Microsoft Ignite Fall 2021 brought a wave of announcements across Azure. While hybrid work and Microsoft Teams dominated the headlines, the data and AI…"
author: Michael John Peña
draft: false
date: 2021-10-18
tags:
  - Azure
  - Ignite
  - Data
  - AI
  - Synapse
  - Microsoft
---

Microsoft Ignite Fall 2021 brought a wave of announcements across Azure. While hybrid work and Microsoft Teams dominated the headlines, the data and AI updates are what I'm most excited about. Here's my breakdown of what matters for those of us building data platforms.

## Azure Synapse Link for SQL

This is the announcement that has me most excited. Synapse Link for Azure SQL Database and SQL Server 2022 enables near-real-time analytics on operational data without ETL pipelines.

The concept: your OLTP data automatically replicates to Synapse Analytics where you can run analytical queries without impacting your transactional workload.

```sql
-- On your Azure SQL Database
CREATE SYNAPSE LINK saleslink
FOR TABLE [Sales].[Orders]
TO 'https://mysynapse.sql.azuresynapse.net'
WITH (
    AUTO_SYNC_SCHEMA = ON,
    TIMESTAMP_COLUMN = [modified_date]
);
```

This follows the pattern established by Synapse Link for Cosmos DB, which has been hugely successful. Eliminating the nightly ETL batch to move data from operational systems to analytics is a big deal - it simplifies architecture and enables real-time insights.

## Azure Purview Improvements

Azure Purview continues to mature as Microsoft's answer to enterprise data governance:

**Data Estate Insights**: New dashboards showing the health and coverage of your data estate - how much is cataloged, classified, and governed.

**Business Glossary Improvements**: Better support for hierarchical business terms and relationships between concepts.

**Sensitivity Label Integration**: Microsoft Information Protection labels now flow from Purview to downstream services like Synapse.

For organizations dealing with regulatory requirements or just trying to understand what data they have, Purview is becoming harder to ignore.

## Power BI Updates

Power BI received several updates that improve its integration with the broader data platform:

**Datamarts (Preview)**: Self-service data marts that give business users a way to create their own relational data models without requiring IT involvement. It's essentially a managed Azure SQL Database behind the scenes.

```sql
-- Datamarts use familiar SQL
SELECT
    Region,
    SUM(Sales) as TotalSales,
    COUNT(DISTINCT Customer) as UniqueCustomers
FROM SalesData
GROUP BY Region
```

**Hybrid Tables**: Tables that combine both import and DirectQuery modes, enabling both fast aggregations on imported data and real-time detail queries.

**Deployment Pipelines Improvements**: Better support for CI/CD workflows with Power BI artifacts.

## Azure Machine Learning Updates

The data science platform continues to evolve:

**Responsible AI Dashboard**: A unified view of model fairness, interpretability, and error analysis. This is important for enterprises deploying ML in regulated industries.

**Managed Feature Store (Preview)**: Centralized repository for ML features that can be shared across projects. Feature engineering is often the most time-consuming part of ML projects - having a shared store can significantly accelerate development.

```python
from azure.ai.ml.entities import FeatureSet, FeatureSetSpec

# Define a feature set
feature_set = FeatureSet(
    name="customer_features",
    version="1",
    spec=FeatureSetSpec(
        source={"type": "parquet", "path": "abfss://..."},
        transformations=[
            {"input_features": ["purchase_amount"], "output_feature": "total_purchases", "aggregation": "sum"},
            {"input_features": ["order_date"], "output_feature": "days_since_last_order", "aggregation": "datediff"}
        ]
    )
)
```

## Azure Cosmos DB Updates

Cosmos DB continues its evolution:

**Elastic Throughput Scaling**: Automatic instant scaling of throughput without pre-provisioning, useful for unpredictable workloads.

**Integrated Vector Search (Preview)**: This is forward-looking - as AI embeddings become more common, having vector search in your operational database makes sense.

**Burst Capacity**: Use idle throughput capacity from your provisioned RU/s to handle temporary spikes.

## The Bigger Picture

A few themes emerge from Ignite 2021:

1. **Operational Analytics**: Synapse Link for SQL, hybrid tables in Power BI - the industry is moving toward real-time analytics on operational data, eliminating traditional batch ETL.

2. **Self-Service with Guardrails**: Datamarts, Purview governance, deployment pipelines - enabling business users while maintaining IT governance.

3. **Responsible AI**: The emphasis on fairness, interpretability, and transparency in ML is growing. Regulations are coming, and platforms are preparing.

4. **Integration Acceleration**: Every service is getting more connected to every other service. The era of point solutions is ending.

## What's Next

I'm planning deep dives on:
- Synapse Link for SQL once it's available in my region
- Power BI Datamarts for self-service scenarios
- The Responsible AI Dashboard in Azure ML

The pace of change in the Azure data platform requires constant learning, but that's what makes this space exciting.

## Resources

- [Microsoft Ignite 2021 Book of News](https://news.microsoft.com/ignite-november-2021-book-of-news/)
- [Azure Synapse Link for SQL](https://docs.microsoft.com/en-us/azure/synapse-analytics/synapse-link/sql-synapse-link-overview)
- [Power BI Datamarts](https://docs.microsoft.com/en-us/power-bi/transform-model/datamarts/datamarts-overview)
- [Azure ML Responsible AI](https://docs.microsoft.com/en-us/azure/machine-learning/concept-responsible-ai)
