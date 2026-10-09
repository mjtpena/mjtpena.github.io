---
title: "Azure Applied AI Services: Pre-Built AI for Common Scenarios"
description: "Applied AI Services are Microsoft's answer to \"I need AI in this process, but I don't want to wire up five Cognitive Services and build the integration…"
author: Michael John Peña
draft: false
date: 2021-05-01
tags:
  - Azure
  - AI
  - Applied AI
  - Cognitive Services
  - Microsoft
---

Applied AI Services are Microsoft's answer to "I need AI in this process, but I don't want to wire up five Cognitive Services and build the integration logic myself." The services in this category—Form Recognizer for document intelligence, Video Indexer for media analysis, Immersive Reader for accessibility, Metrics Advisor for anomaly detection at scale, Azure Cognitive Search for knowledge mining—each bundle multiple underlying AI capabilities into a scenario-specific API. The trade-off is configurability: you get a lot out of the box, but the customisation surface is narrower than building directly with the foundational services. For the scenarios they target, that trade-off is usually right.

## What Are Applied AI Services?

While Cognitive Services give you building blocks like vision, speech, and language APIs, Applied AI Services package these together with business logic for common use cases. Think of it as the difference between buying individual components versus a pre-assembled solution.

The current lineup includes:
- **Azure Form Recognizer**: Extract data from documents
- **Azure Metrics Advisor**: Detect anomalies in time-series data
- **Azure Cognitive Search**: AI-powered search
- **Azure Immersive Reader**: Help users read and comprehend text
- **Azure Bot Service**: Build conversational AI

## Form Recognizer in Practice

Form Recognizer has been particularly useful in document processing scenarios. Here's how to extract data from invoices:

```python
from azure.ai.formrecognizer import DocumentAnalysisClient
from azure.core.credentials import AzureKeyCredential

endpoint = "https://your-resource.cognitiveservices.azure.com/"
credential = AzureKeyCredential("your-key")

client = DocumentAnalysisClient(endpoint, credential)

# Analyze an invoice
with open("invoice.pdf", "rb") as f:
    poller = client.begin_analyze_document("prebuilt-invoice", f)
    result = poller.result()

for document in result.documents:
    vendor_name = document.fields.get("VendorName")
    invoice_total = document.fields.get("InvoiceTotal")

    if vendor_name:
        print(f"Vendor: {vendor_name.value}")
    if invoice_total:
        print(f"Total: {invoice_total.value.amount} {invoice_total.value.currency_symbol}")
```

The prebuilt models handle common document types without training:
- Invoices
- Receipts
- Business cards
- ID documents

For custom document types, you can train your own models with as few as 5 labeled examples.

## Custom Model Training

When prebuilt models don't fit your needs, create custom models:

```python
from azure.ai.formrecognizer import DocumentModelAdministrationClient

admin_client = DocumentModelAdministrationClient(endpoint, credential)

# Start training with labeled data in blob storage
training_data_url = "https://yourstorage.blob.core.windows.net/training-data?sas-token"

poller = admin_client.begin_build_document_model(
    build_mode="template",
    blob_container_url=training_data_url,
    model_id="custom-contract-model"
)

model = poller.result()
print(f"Model ID: {model.model_id}")
print(f"Fields: {[name for name in model.doc_types]}")
```

## Metrics Advisor for Anomaly Detection

Metrics Advisor monitors your time-series data and automatically detects anomalies. It's particularly useful for:
- Application performance monitoring
- Business metrics tracking
- IoT sensor data analysis

```python
from azure.ai.metricsadvisor import MetricsAdvisorClient
from azure.ai.metricsadvisor.models import (
    SqlServerDataFeedSource,
    DataFeedSchema,
    DataFeedMetric,
    DataFeedDimension,
    DataFeedGranularityType,
)

# Create a data feed from SQL Server
data_feed = client.create_data_feed(
    name="Website Performance Metrics",
    source=SqlServerDataFeedSource(
        connection_string="your-connection-string",
        query="""
            SELECT
                timestamp,
                region,
                response_time,
                error_count
            FROM performance_logs
            WHERE timestamp >= @StartTime AND timestamp < @EndTime
        """
    ),
    granularity=DataFeedGranularityType.HOURLY,
    schema=DataFeedSchema(
        metrics=[
            DataFeedMetric(name="response_time"),
            DataFeedMetric(name="error_count")
        ],
        dimensions=[
            DataFeedDimension(name="region")
        ],
        timestamp_column="timestamp"
    )
)
```

Once ingested, Metrics Advisor applies ML algorithms to detect:
- Unexpected spikes or drops
- Trend changes
- Seasonal anomalies

## Integration with Azure Cognitive Search

Azure Cognitive Search is often the glue that ties AI services together. You can enrich your search index with cognitive skills:

```json
{
  "name": "document-skillset",
  "description": "AI enrichment pipeline",
  "skills": [
    {
      "@odata.type": "#Microsoft.Skills.Vision.OcrSkill",
      "name": "ocr-skill",
      "context": "/document/normalized_images/*",
      "inputs": [
        {
          "name": "image",
          "source": "/document/normalized_images/*"
        }
      ],
      "outputs": [
        {
          "name": "text",
          "targetName": "text"
        }
      ]
    },
    {
      "@odata.type": "#Microsoft.Skills.Text.KeyPhraseExtractionSkill",
      "name": "keyphrase-skill",
      "context": "/document",
      "inputs": [
        {
          "name": "text",
          "source": "/document/content"
        }
      ],
      "outputs": [
        {
          "name": "keyPhrases",
          "targetName": "keyphrases"
        }
      ]
    }
  ]
}
```

This skillset extracts text from images via OCR and identifies key phrases, making documents searchable by their content rather than just metadata.

## When to Use Applied AI vs Cognitive Services

Choose Applied AI Services when:
- Your scenario matches a pre-built solution
- You want faster time-to-value
- You don't need fine-grained control over individual AI components

Choose Cognitive Services when:
- You need specific AI capabilities
- You're building a custom solution
- You want maximum flexibility

## Cost Considerations

Applied AI Services pricing varies by service:
- Form Recognizer: Per page analyzed
- Metrics Advisor: Per time series monitored
- Cognitive Search: Per search unit + AI enrichment transactions

For high-volume scenarios, these costs can add up. Run a proof of concept to estimate production costs before committing.

## Getting Started

The fastest way to explore these services:

1. Create an Azure account if you don't have one
2. Provision a Cognitive Services multi-service resource
3. Use the built-in studios (Form Recognizer Studio, Language Studio)
4. Export code once you've validated your approach

These studios provide a no-code way to test the services with your own data before writing any code.

## Resources

- [Azure Applied AI Services Documentation](https://docs.microsoft.com/en-us/azure/applied-ai-services/)
- [Form Recognizer Studio](https://formrecognizer.appliedai.azure.com/)
- [Metrics Advisor Documentation](https://docs.microsoft.com/en-us/azure/applied-ai-services/metrics-advisor/)
