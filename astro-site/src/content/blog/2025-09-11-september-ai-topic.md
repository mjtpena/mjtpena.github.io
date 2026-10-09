---
title: "Azure Document Intelligence Custom Models: Training for Specialized Documents"
description: "Azure offers three custom model approaches: template models for fixed layouts, neural models for varied layouts, and composed models that combine multiple…"
author: Michael John Peña
draft: false
date: 2025-09-11
tags:
  - Azure
  - Document Intelligence
  - Custom Models
  - Machine Learning
  - Document Processing
---

## Choosing the Right Custom Model Type

Azure offers three custom model approaches: template models for fixed layouts, neural models for varied layouts, and composed models that combine multiple extractors.

## Preparing Training Data

```python
import os
import json
from azure.ai.documentintelligence import DocumentIntelligenceAdministrationClient
from azure.core.credentials import AzureKeyCredential

admin_client = DocumentIntelligenceAdministrationClient(
    endpoint=os.environ["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"],
    credential=AzureKeyCredential(os.environ["AZURE_DOCUMENT_INTELLIGENCE_KEY"])
)

def prepare_labeling_project(
    project_name: str,
    container_sas_url: str,
    field_schema: dict
) -> dict:
    """Set up a labeling project for custom model training."""

    project_config = {
        "projectName": project_name,
        "storageSource": {
            "kind": "AzureBlobContainer",
            "containerSasUrl": container_sas_url
        },
        "fieldSchema": field_schema
    }

    return project_config

# Define fields to extract from purchase orders
po_schema = {
    "fields": {
        "PurchaseOrderNumber": {"type": "string"},
        "OrderDate": {"type": "date"},
        "VendorName": {"type": "string"},
        "VendorAddress": {"type": "address"},
        "ShipToAddress": {"type": "address"},
        "LineItems": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "ItemNumber": {"type": "string"},
                    "Description": {"type": "string"},
                    "Quantity": {"type": "number"},
                    "UnitPrice": {"type": "currency"},
                    "TotalPrice": {"type": "currency"}
                }
            }
        },
        "Subtotal": {"type": "currency"},
        "Tax": {"type": "currency"},
        "Total": {"type": "currency"}
    }
}
```

## Training the Custom Model

```python
def train_custom_model(
    model_id: str,
    training_data_sas_url: str,
    model_description: str
) -> str:
    """Train a custom neural document model."""

    poller = admin_client.begin_build_document_model(
        build_request={
            "modelId": model_id,
            "description": model_description,
            "buildMode": "neural",  # Use neural for varied layouts
            "azureBlobSource": {
                "containerUrl": training_data_sas_url
            }
        }
    )

    model = poller.result()

    print(f"Model ID: {model.model_id}")
    print(f"Status: {model.status}")
    print(f"Created: {model.created_on}")
    print(f"Document types: {list(model.doc_types.keys())}")

    return model.model_id

def evaluate_model(model_id: str, test_document_url: str) -> dict:
    """Evaluate model performance on a test document."""

    from azure.ai.documentintelligence import DocumentIntelligenceClient

    client = DocumentIntelligenceClient(
        endpoint=os.environ["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"],
        credential=AzureKeyCredential(os.environ["AZURE_DOCUMENT_INTELLIGENCE_KEY"])
    )

    poller = client.begin_analyze_document(
        model_id=model_id,
        analyze_request={"urlSource": test_document_url}
    )

    result = poller.result()

    # Calculate field-level confidence
    confidence_scores = {}
    for doc in result.documents:
        for field_name, field in doc.fields.items():
            confidence_scores[field_name] = field.confidence

    return {
        "overall_confidence": sum(confidence_scores.values()) / len(confidence_scores),
        "field_confidences": confidence_scores
    }
```

## Best Practices

Provide at least 5 labeled samples per document variation. Include edge cases like partially filled forms and poor scan quality. Neural models require more samples (15-20) but handle layout variations better than template models.

Custom models unlock document automation for your unique business documents that no prebuilt model can handle.
