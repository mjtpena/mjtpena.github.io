---
title: "Looking Ahead to Microsoft Build 2023: What to Expect for Data and AI"
description: "Microsoft Build 2023 is scheduled for May 23–25, 2023, in Seattle—and based on the product roadmap signals Microsoft had been sending through Ignite 2022…"
author: Michael John Peña
draft: false
date: 2023-05-01
tags:
  - Microsoft
  - Azure
  - Build 2023
  - Data Analytics
  - AI
---

Microsoft Build 2023 is scheduled for May 23–25, 2023, in Seattle—and based on the product roadmap signals Microsoft had been sending through Ignite 2022 and the first quarter of 2023, this Build is shaping up to be one of the most significant in recent memory for data and AI practitioners. The AI announcements are somewhat predictable: Azure OpenAI Service updates, more Copilot surface area, prompt engineering tooling. The data platform announcement is less expected but increasingly hinted at: Microsoft has been building something that unified Azure Synapse Analytics, Azure Data Factory, Power BI, and Azure Data Explorer under a single product experience, with a shared storage layer. The preview access requests have been circulating quietly. The OneLake concept (a single, organisation-wide data lake underpinning all workloads) has been referenced in Microsoft blog posts without a full product name. My expectation: Build 2023 is where Microsoft announces the unified data platform that puts Azure in direct competition with Databricks and Snowflake's platform plays, backed by a generative AI narrative. If I'm right about the scope of this announcement, it will reshape how enterprise data teams plan their Azure data architecture for the next three to five years.

## The Data Platform Landscape

The Azure data platform has evolved significantly over the past few years. We've seen:

- **Azure Synapse Analytics**: Unifying data warehousing and big data
- **Power BI**: Continued evolution as a BI leader
- **Azure Data Factory**: Mature ETL/ELT orchestration
- **Azure Databricks**: Growing partnership for lakehouse workloads

The question many of us are asking: Will Microsoft announce a more unified approach?

## What I'm Watching For

### 1. Unified Data Experience

The biggest pain point for data teams today is managing multiple services with different:
- Security models
- Admin experiences
- Billing structures
- Development paradigms

I'm hoping Build will address this fragmentation. Rumors suggest something big is coming for data analytics.

### 2. AI Integration

With GPT-4 now available and Azure OpenAI Service gaining momentum, I expect to see:
- Deeper AI integration into data tools
- Copilot experiences for data professionals
- Natural language interfaces for analytics

### 3. Real-Time Analytics

Event-driven architectures are increasingly important. Expect enhancements to:
- Azure Event Hubs
- Azure Stream Analytics
- Real-time dashboarding

### 4. OneLake or Similar

There's been discussion about a unified storage layer. Think "OneDrive for data" - a single logical data lake across an organization.

## Preparing Your Skills

Regardless of specific announcements, these skills will remain valuable:

```python
# Core data engineering skills
skills = [
    "Apache Spark",
    "Delta Lake / Lakehouse patterns",
    "SQL (it never goes away)",
    "Python for data engineering",
    "Data governance and cataloging"
]

# Emerging skills to develop
emerging = [
    "Prompt engineering for AI",
    "LLM integration patterns",
    "Real-time data processing",
    "DataOps and automation"
]
```

## My Predictions

1. **Major platform announcement**: Something that consolidates multiple data services
2. **Copilot everywhere**: AI assistance in every data tool
3. **Simplified licensing**: One capacity model for multiple workloads
4. **Lakehouse as default**: Delta Lake format as the standard

## What to Do Now

While waiting for Build:

1. **Get comfortable with Spark**: It's the likely compute engine
2. **Learn Delta Lake**: Open table format gaining adoption
3. **Experiment with Azure OpenAI**: AI skills are increasingly essential
4. **Review your current architecture**: Identify pain points that might be addressed

## Conclusion

Build 2023 promises to be significant for data professionals. Whether my predictions are accurate or not, the direction is clear: more unification, more AI, more simplification.

I'll be watching the keynotes live and will share detailed analysis of any announcements. Stay tuned!

## Resources

- [Microsoft Build 2023 Registration](https://build.microsoft.com/)
- [Azure Updates](https://azure.microsoft.com/updates/)
- [Data Platform Blog](https://techcommunity.microsoft.com/t5/azure-data-blog/bg-p/AzureDataBlog)
