---
title: "Microsoft Build 2021: GPT-3 in Power Apps and Azure AI Updates"
author: Michael John Peña
draft: false
date: 2021-05-28
tags:
  - Azure
  - AI
  - GPT-3
  - Power Platform
  - Build
  - Microsoft

---

I wrote "Microsoft Build 2021: GPT-3 in Power Apps and Azure AI Updates" to share practical, production-minded guidance on this topic.

## GPT-3 Powers Natural Language to Code in Power Apps

The headline announcement for me was the integration of GPT-3 into Power Apps. You can now describe what you want in plain English, and GPT-3 generates the Power Fx formula for you.

For example, if you type:
> "Show me products where the price is greater than 100 and sort by name"

GPT-3 generates:
```
Sort(
    Filter(Products, Price > 100),
    Name, Ascending
)
```

This isn't just autocomplete - it's understanding intent and translating it into working code. The implications for citizen developers are significant. People who understand their business processes but don't know formula syntax can now build functional applications.

I tested this with some of our internal teams, and while it's not perfect, it gets you 80% of the way there most of the time. That last 20% still requires understanding Power Fx, but the barrier to entry has dropped dramatically.

## Azure Machine Learning Managed Endpoints

For data scientists and ML engineers, the announcement of Azure ML Managed Endpoints simplifies one of the most painful parts of ML workflows - deployment.

Previously, deploying a model meant:
1. Creating an inference cluster
2. Writing scoring scripts
3. Managing the deployment manually
4. Handling scaling yourself

With Managed Endpoints, you just deploy:

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import ManagedOnlineDeployment, ManagedOnlineEndpoint

# Create an endpoint
endpoint = ManagedOnlineEndpoint(
    name="sales-forecast",
    description="Sales forecasting model",
    auth_mode="key"
)

ml_client.begin_create_or_update(endpoint).result()

# Create a deployment
blue_deployment = ManagedOnlineDeployment(
    name="blue",
    endpoint_name=endpoint.name,
    model=model,
    instance_type="Standard_DS3_v2",
    instance_count=1
)

ml_client.begin_create_or_update(blue_deployment).result()
```

The service handles auto-scaling, blue/green deployments, and monitoring. This is what serverless should look like for ML.

## Azure Video Analyzer

The new Azure Video Analyzer combines Live Video Analytics and Video Indexer into a single service. It uses AI to:
- Detect objects and people in video streams
- Extract insights from video content
- Identify anomalies in real-time

```json
{
  "@type": "#Microsoft.VideoAnalyzer.ObjectTrackingProcessor",
  "name": "objectTracker",
  "inputs": [
    {
      "nodeName": "motionDetection"
    }
  ],
  "objectsToTrack": ["person", "vehicle", "bag"]
}
```

For industries like retail, manufacturing, and security, this opens up scenarios that previously required expensive custom solutions.

## Azure Metrics Advisor is GA

Azure Metrics Advisor graduated to general availability. This is an underrated service - it takes your time-series data and automatically detects anomalies using ML, without requiring ML expertise.

Use cases I've seen work well:
- Monitoring application performance metrics
- Detecting anomalies in IoT sensor data
- Identifying unusual patterns in business KPIs

```python
from azure.ai.metricsadvisor import MetricsAdvisorClient

# Add a data feed
data_feed = client.create_data_feed(
    name="Sales Data Feed",
    source=SqlServerDataFeedSource(
        connection_string="<connection_string>",
        query="SELECT timestamp, product, revenue FROM sales"
    ),
    granularity="Daily",
    schema=DataFeedSchema(
        metrics=[DataFeedMetric(name="revenue")]
    )
)

# Anomalies are detected automatically
# Configure alerting separately
```

## Bot Framework Composer 2.0

For those building conversational AI, Bot Framework Composer 2.0 brings a visual authoring experience with:
- New templates to get started quickly
- Integrated resource provisioning to Azure
- Better testing and debugging

The visual canvas for designing conversation flows makes it much easier to prototype and iterate than writing JSON configuration by hand.

## Azure Purview Expands

Azure Purview, which launched in preview alongside Synapse GA, now supports:
- Azure Database for MySQL
- Azure Database for PostgreSQL
- Additional data sources for lineage tracking

Data governance is becoming table stakes for enterprises. Having a unified catalog across Azure data services is increasingly valuable as data estates grow.

## Cosmos DB Improvements

Several quality-of-life improvements for Cosmos DB:
- **Partial document updates**: PATCH operations without retrieving and replacing entire documents
- **Continuous backup**: Point-in-time restore instead of periodic backups
- **Integrated cache**: Built-in caching layer to reduce RU consumption

```javascript
// Partial document update - no more read-modify-write
const patchOperations = [
    { op: "add", path: "/orders/-", value: { id: "123", amount: 99.99 } },
    { op: "set", path: "/lastUpdated", value: new Date().toISOString() },
    { op: "incr", path: "/orderCount", value: 1 }
];

await container.item(id, partitionKey).patch(patchOperations);
```

The partial update is particularly significant - it reduces both RU consumption and the risk of lost updates in concurrent scenarios.

## The Bigger Picture

Looking at Build 2021 through a data and AI lens, I see three themes:

1. **AI Democratization**: GPT-3 in Power Apps, no-code anomaly detection, visual bot building - Microsoft is making AI accessible to people who aren't ML specialists.

2. **Managed Services Evolution**: Managed Endpoints for ML, improved Cosmos DB operations - the platform is handling more of the operational complexity.

3. **Integration and Governance**: Purview expansion, unified Video Analyzer, Power Platform connectors - connecting services and governing them centrally.

The pace of innovation in Azure data and AI services continues to accelerate. For those of us building on this platform, there's always something new to learn and evaluate.

## Resources

- [Microsoft Build 2021 Book of News](https://news.microsoft.com/build-2021-book-of-news/)
- [Azure Machine Learning Managed Endpoints](https://docs.microsoft.com/en-us/azure/machine-learning/how-to-deploy-managed-online-endpoints)
- [Power Apps GPT-3 Integration](https://powerapps.microsoft.com/en-us/blog/introducing-power-fx-the-low-code-programming-language-for-everyone/)
- [Azure Video Analyzer](https://docs.microsoft.com/en-us/azure/azure-video-analyzer/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
