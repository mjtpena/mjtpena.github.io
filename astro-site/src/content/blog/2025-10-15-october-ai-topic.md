---
title: "Azure AI Document Intelligence: Automated Document Processing at Scale"
description: "For high-volume scenarios, implement batch processing with proper error handling and retry logic to ensure reliable document processing at scale."
author: Michael John Peña
draft: false
date: 2025-10-15
tags:
  - Azure AI
  - Document Intelligence
  - OCR
  - Form Recognition
  - Automation
---

## Using Pre-Built Models

Start with pre-built models for common document types:

```python
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeDocumentRequest
from azure.core.credentials import AzureKeyCredential

class DocumentProcessor:
    def __init__(self, endpoint: str, api_key: str):
        self.client = DocumentIntelligenceClient(
            endpoint=endpoint,
            credential=AzureKeyCredential(api_key)
        )

    def extract_invoice(self, document_url: str) -> dict:
        """Extract data from an invoice using pre-built model."""

        poller = self.client.begin_analyze_document(
            model_id="prebuilt-invoice",
            analyze_request=AnalyzeDocumentRequest(url_source=document_url)
        )

        result = poller.result()
        invoice_data = {}

        if result.documents:
            doc = result.documents[0]
            fields = doc.fields

            invoice_data = {
                "vendor_name": self._get_field_value(fields, "VendorName"),
                "invoice_number": self._get_field_value(fields, "InvoiceId"),
                "invoice_date": self._get_field_value(fields, "InvoiceDate"),
                "total": self._get_field_value(fields, "InvoiceTotal"),
                "items": self._extract_line_items(fields.get("Items"))
            }

        return invoice_data

    def _get_field_value(self, fields: dict, field_name: str):
        field = fields.get(field_name)
        if field:
            return field.value_string or field.value_number or field.value_date
        return None

    def _extract_line_items(self, items_field) -> list:
        if not items_field or not items_field.value_array:
            return []

        items = []
        for item in items_field.value_array:
            item_fields = item.value_object
            items.append({
                "description": self._get_field_value(item_fields, "Description"),
                "quantity": self._get_field_value(item_fields, "Quantity"),
                "unit_price": self._get_field_value(item_fields, "UnitPrice"),
                "amount": self._get_field_value(item_fields, "Amount")
            })

        return items
```

## Building Custom Models

Train custom models for domain-specific documents:

```python
class CustomModelTrainer:
    def __init__(self, client: DocumentIntelligenceClient):
        self.client = client

    def train_custom_model(
        self,
        training_data_url: str,
        model_id: str,
        description: str
    ) -> str:
        """Train a custom extraction model."""

        poller = self.client.begin_build_document_model(
            build_request={
                "modelId": model_id,
                "description": description,
                "azureBlobSource": {"containerUrl": training_data_url}
            },
            build_mode="template"  # or "neural" for complex layouts
        )

        model = poller.result()
        return model.model_id

    def analyze_with_custom_model(self, model_id: str, document_url: str) -> dict:
        """Analyze document with custom trained model."""

        poller = self.client.begin_analyze_document(
            model_id=model_id,
            analyze_request=AnalyzeDocumentRequest(url_source=document_url)
        )

        return poller.result()
```

## Batch Processing Pipeline

For high-volume scenarios, implement batch processing with proper error handling and retry logic to ensure reliable document processing at scale.
