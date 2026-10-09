---
title: "Custom Models in Azure Form Recognizer for Domain-Specific Documents"
author: Michael John Peña
draft: false
date: 2023-02-21
tags:
  - Azure
  - Form Recognizer
  - Document Intelligence
  - Custom Models
  - AI
---

## Custom Model Types

```python
# Template models - for fixed layout documents
# Neural models - for varying layouts, better generalization

from azure.ai.formrecognizer import DocumentModelAdministrationClient
from azure.core.credentials import AzureKeyCredential

admin_client = DocumentModelAdministrationClient(
    endpoint="https://your-resource.cognitiveservices.azure.com/",
    credential=AzureKeyCredential("your-key")
)
```

## Preparing Training Data

```python
# Training data structure in Azure Blob Storage:
# /training-data/
#   /document1.pdf
#   /document1.pdf.labels.json
#   /document1.pdf.ocr.json  (optional, for pre-labeled)
#   /document2.pdf
#   /document2.pdf.labels.json
#   ...

# Label file format (document1.pdf.labels.json):
LABEL_EXAMPLE = {
    "document": "document1.pdf",
    "labels": [
        {
            "label": "CustomerName",
            "key": None,
            "value": [
                {
                    "page": 1,
                    "text": "Contoso Ltd",
                    "boundingBoxes": [[100, 200, 300, 200, 300, 220, 100, 220]]
                }
            ]
        },
        {
            "label": "InvoiceDate",
            "key": None,
            "value": [
                {
                    "page": 1,
                    "text": "2023-02-21",
                    "boundingBoxes": [[400, 200, 500, 200, 500, 220, 400, 220]]
                }
            ]
        }
    ]
}
```

## Training a Custom Model

```python
import time

def train_custom_model(
    admin_client,
    training_data_url: str,
    model_id: str,
    description: str = "",
    build_mode: str = "template"  # or "neural"
) -> str:
    """Train a custom document model."""

    # Start training
    poller = admin_client.begin_build_document_model(
        build_mode=build_mode,
        blob_container_url=training_data_url,
        model_id=model_id,
        description=description
    )

    print(f"Training model {model_id}...")

    # Wait for completion
    model = poller.result()

    print(f"Model trained successfully!")
    print(f"  Model ID: {model.model_id}")
    print(f"  Created: {model.created_on}")
    print(f"  Doc types: {list(model.doc_types.keys())}")

    return model.model_id

# Train template model (fixed layouts)
template_model_id = train_custom_model(
    admin_client,
    training_data_url="https://storage.blob.core.windows.net/training?sas=...",
    model_id="my-invoice-model-v1",
    description="Custom invoice model for Contoso",
    build_mode="template"
)

# Train neural model (varying layouts)
neural_model_id = train_custom_model(
    admin_client,
    training_data_url="https://storage.blob.core.windows.net/training?sas=...",
    model_id="my-contract-model-v1",
    description="Custom contract model with neural extraction",
    build_mode="neural"
)
```

## Using Custom Models

```python
from azure.ai.formrecognizer import DocumentAnalysisClient

analysis_client = DocumentAnalysisClient(
    endpoint="https://your-resource.cognitiveservices.azure.com/",
    credential=AzureKeyCredential("your-key")
)

def analyze_with_custom_model(
    file_path: str,
    model_id: str
) -> dict:
    """Analyze document with custom model."""

    with open(file_path, "rb") as f:
        poller = analysis_client.begin_analyze_document(
            model_id=model_id,
            document=f
        )

    result = poller.result()

    extracted_data = {}

    for doc in result.documents:
        print(f"Document type: {doc.doc_type}")
        print(f"Confidence: {doc.confidence:.2%}")

        for field_name, field in doc.fields.items():
            extracted_data[field_name] = {
                "value": field.value,
                "confidence": field.confidence,
                "content": field.content
            }

            print(f"  {field_name}: {field.value} ({field.confidence:.2%})")

    return extracted_data

# Use the model
data = analyze_with_custom_model("new_invoice.pdf", "my-invoice-model-v1")
```

## Composed Models

Combine multiple models for different document types:

```python
def create_composed_model(
    admin_client,
    model_ids: list,
    composed_model_id: str,
    description: str = ""
) -> str:
    """Create a composed model from multiple models."""

    poller = admin_client.begin_compose_document_model(
        component_model_ids=model_ids,
        model_id=composed_model_id,
        description=description
    )

    model = poller.result()

    print(f"Composed model created: {model.model_id}")
    print(f"Component models: {len(model_ids)}")

    return model.model_id

# Compose models for different document types
composed_id = create_composed_model(
    admin_client,
    model_ids=["invoice-model-v1", "receipt-model-v1", "contract-model-v1"],
    composed_model_id="all-documents-v1",
    description="Handles invoices, receipts, and contracts"
)

# The composed model automatically routes to the right sub-model
```

## Model Management

```python
class ModelManager:
    """Manage custom document models."""

    def __init__(self, admin_client):
        self.client = admin_client

    def list_models(self) -> list:
        """List all custom models."""
        models = self.client.list_document_models()
        return [
            {
                "id": m.model_id,
                "description": m.description,
                "created": m.created_on
            }
            for m in models
        ]

    def get_model_info(self, model_id: str) -> dict:
        """Get detailed model information."""
        model = self.client.get_document_model(model_id)

        return {
            "id": model.model_id,
            "description": model.description,
            "created": model.created_on,
            "doc_types": {
                name: {
                    "fields": list(doc_type.field_schema.keys()),
                    "field_confidence": doc_type.field_confidence
                }
                for name, doc_type in model.doc_types.items()
            }
        }

    def delete_model(self, model_id: str):
        """Delete a model."""
        self.client.delete_document_model(model_id)
        print(f"Deleted model: {model_id}")

    def copy_model(
        self,
        model_id: str,
        target_resource_id: str,
        target_region: str
    ) -> str:
        """Copy model to another resource."""
        # Get copy authorization from target
        target_client = DocumentModelAdministrationClient(
            endpoint=f"https://{target_resource_id}.cognitiveservices.azure.com/",
            credential=AzureKeyCredential("target-key")
        )

        auth = target_client.get_copy_authorization(
            model_id=f"{model_id}-copy",
            description=f"Copy of {model_id}"
        )

        # Copy model
        poller = self.client.begin_copy_document_model_to(
            model_id=model_id,
            target=auth
        )

        result = poller.result()
        return result.model_id
```

## Evaluation and Improvement

```python
class ModelEvaluator:
    """Evaluate custom model performance."""

    def __init__(self, analysis_client, model_id: str):
        self.client = analysis_client
        self.model_id = model_id

    def evaluate_on_test_set(
        self,
        test_files: list,
        ground_truth: dict
    ) -> dict:
        """Evaluate model on test documents."""
        results = {
            "total": len(test_files),
            "field_accuracy": {},
            "avg_confidence": []
        }

        for file_path in test_files:
            with open(file_path, "rb") as f:
                poller = self.client.begin_analyze_document(
                    model_id=self.model_id,
                    document=f
                )
                analysis = poller.result()

            for doc in analysis.documents:
                results["avg_confidence"].append(doc.confidence)

                expected = ground_truth.get(file_path, {})

                for field_name, field in doc.fields.items():
                    if field_name not in results["field_accuracy"]:
                        results["field_accuracy"][field_name] = {
                            "correct": 0,
                            "total": 0
                        }

                    results["field_accuracy"][field_name]["total"] += 1

                    if field.value == expected.get(field_name):
                        results["field_accuracy"][field_name]["correct"] += 1

        # Calculate percentages
        for field in results["field_accuracy"]:
            stats = results["field_accuracy"][field]
            stats["accuracy"] = stats["correct"] / stats["total"] if stats["total"] > 0 else 0

        results["overall_confidence"] = (
            sum(results["avg_confidence"]) / len(results["avg_confidence"])
            if results["avg_confidence"] else 0
        )

        return results

# Usage
evaluator = ModelEvaluator(analysis_client, "my-invoice-model-v1")
metrics = evaluator.evaluate_on_test_set(
    test_files=["test1.pdf", "test2.pdf"],
    ground_truth={
        "test1.pdf": {"CustomerName": "Contoso", "Amount": "100.00"},
        "test2.pdf": {"CustomerName": "Fabrikam", "Amount": "250.00"}
    }
)
print(f"Overall confidence: {metrics['overall_confidence']:.2%}")
```

## Best Practices

1. **Use 5+ training samples**: More samples improve accuracy
2. **Include edge cases**: Train on variations
3. **Validate with held-out data**: Don't overfit
4. **Version your models**: Track improvements
5. **Monitor in production**: Track confidence scores
6. **Retrain periodically**: Document formats evolve

## Resources

- [Custom Models Documentation](https://learn.microsoft.com/azure/ai-services/document-intelligence/concept-custom)
- [Training Data Setup](https://learn.microsoft.com/azure/ai-services/document-intelligence/how-to-guides/build-a-custom-model)
- [Form Recognizer Studio](https://formrecognizer.appliedai.azure.com/)
