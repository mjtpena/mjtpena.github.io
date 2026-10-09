---
title: "Document Intelligence: Extracting Structured Data from Complex Documents"
description: "Document Intelligence understands document structure, extracting tables, key-value pairs, and semantic entities rather than just raw text. This structured…"
author: Michael John Peña
draft: false
date: 2025-11-24
tags:
  - Document Intelligence
  - Azure AI
  - OCR
  - Data Extraction
  - Automation
---

## Beyond Basic OCR

Document Intelligence understands document structure, extracting tables, key-value pairs, and semantic entities rather than just raw text. This structured output integrates directly into business processes.

## Processing Invoices

Extract invoice data using pre-built models:

```python
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeResult
from azure.identity import DefaultAzureCredential
from dataclasses import dataclass
from decimal import Decimal

@dataclass
class InvoiceData:
    vendor_name: str
    invoice_number: str
    invoice_date: str
    total_amount: Decimal
    line_items: list[dict]
    confidence: float

class InvoiceProcessor:
    def __init__(self, endpoint: str):
        self.client = DocumentIntelligenceClient(
            endpoint=endpoint,
            credential=DefaultAzureCredential()
        )

    async def process_invoice(self, document_url: str) -> InvoiceData:
        """Extract structured data from invoice document."""

        poller = await self.client.begin_analyze_document(
            model_id="prebuilt-invoice",
            analyze_request={"urlSource": document_url}
        )

        result: AnalyzeResult = await poller.result()

        if not result.documents:
            raise ValueError("No invoice detected in document")

        invoice = result.documents[0]
        fields = invoice.fields

        # Extract line items
        line_items = []
        items_field = fields.get("Items")
        if items_field and items_field.value:
            for item in items_field.value:
                item_fields = item.value
                line_items.append({
                    "description": self._get_field_value(item_fields, "Description"),
                    "quantity": self._get_field_value(item_fields, "Quantity"),
                    "unit_price": self._get_field_value(item_fields, "UnitPrice"),
                    "amount": self._get_field_value(item_fields, "Amount")
                })

        return InvoiceData(
            vendor_name=self._get_field_value(fields, "VendorName"),
            invoice_number=self._get_field_value(fields, "InvoiceId"),
            invoice_date=self._get_field_value(fields, "InvoiceDate"),
            total_amount=Decimal(str(self._get_field_value(fields, "InvoiceTotal") or 0)),
            line_items=line_items,
            confidence=invoice.confidence
        )

    def _get_field_value(self, fields: dict, key: str):
        """Safely extract field value."""
        field = fields.get(key)
        return field.value if field else None
```

## Custom Document Models

Train models for organization-specific documents:

```python
class CustomDocumentProcessor:
    def __init__(self, client: DocumentIntelligenceClient):
        self.client = client

    async def train_custom_model(
        self,
        training_data_url: str,
        model_id: str,
        description: str
    ):
        """Train a custom extraction model."""

        poller = await self.client.begin_build_document_model(
            build_request={
                "modelId": model_id,
                "description": description,
                "buildMode": "template",  # or "neural" for complex layouts
                "azureBlobSource": {
                    "containerUrl": training_data_url
                }
            }
        )

        model = await poller.result()

        return {
            "model_id": model.model_id,
            "created": model.created_date_time,
            "doc_types": list(model.doc_types.keys())
        }

    async def analyze_with_custom_model(
        self,
        model_id: str,
        document_url: str
    ) -> dict:
        """Analyze document using custom trained model."""

        poller = await self.client.begin_analyze_document(
            model_id=model_id,
            analyze_request={"urlSource": document_url}
        )

        result = await poller.result()

        extracted_data = {}
        for doc in result.documents:
            for field_name, field in doc.fields.items():
                extracted_data[field_name] = {
                    "value": field.value,
                    "confidence": field.confidence
                }

        return extracted_data
```

## LLM Enhancement

Combine Document Intelligence with LLMs for complex reasoning:

```python
async def process_contract_with_llm(
    doc_processor: CustomDocumentProcessor,
    llm_client: AzureOpenAI,
    document_url: str
) -> dict:
    """Extract and analyze contract with LLM enhancement."""

    # Extract structured data
    extracted = await doc_processor.analyze_with_custom_model(
        "contract-model", document_url
    )

    # Use LLM for complex analysis
    analysis_prompt = f"""
    Analyze this contract data and identify:
    1. Key obligations for each party
    2. Important dates and deadlines
    3. Potential risks or unusual terms

    Contract Data:
    {json.dumps(extracted, indent=2)}
    """

    response = await llm_client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": analysis_prompt}]
    )

    return {
        "extracted_data": extracted,
        "analysis": response.choices[0].message.content
    }
```

Document Intelligence transforms document-heavy processes, reducing manual data entry and enabling intelligent automation of workflows that previously required human review.
