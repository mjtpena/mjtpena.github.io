---
title: "Azure AI Document Intelligence: Extracting Structured Data from Invoices"
author: Michael John Peña
draft: false
date: 2025-09-02
tags:
  - Azure
  - Document Intelligence
  - OCR
  - Invoice Processing
  - Python

---

I wrote "Azure AI Document Intelligence: Extracting Structured Data from Invoices" to share practical, production-minded guidance on this topic.

## Setting Up Document Intelligence

First, provision an Azure AI Document Intelligence resource and configure your client.

```python
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeResult
from azure.core.credentials import AzureKeyCredential
import os

endpoint = os.environ["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"]
key = os.environ["AZURE_DOCUMENT_INTELLIGENCE_KEY"]

client = DocumentIntelligenceClient(
    endpoint=endpoint,
    credential=AzureKeyCredential(key)
)
```

## Processing Invoices

The prebuilt invoice model recognizes vendor details, line items, totals, and payment terms automatically.

```python
def extract_invoice_data(invoice_url: str) -> dict:
    """Extract structured data from an invoice URL."""
    poller = client.begin_analyze_document(
        model_id="prebuilt-invoice",
        analyze_request={"urlSource": invoice_url}
    )
    result: AnalyzeResult = poller.result()

    extracted_data = {
        "invoices": []
    }

    for invoice in result.documents:
        invoice_data = {
            "vendor_name": get_field_value(invoice, "VendorName"),
            "vendor_address": get_field_value(invoice, "VendorAddress"),
            "invoice_id": get_field_value(invoice, "InvoiceId"),
            "invoice_date": get_field_value(invoice, "InvoiceDate"),
            "due_date": get_field_value(invoice, "DueDate"),
            "subtotal": get_field_value(invoice, "SubTotal"),
            "total_tax": get_field_value(invoice, "TotalTax"),
            "invoice_total": get_field_value(invoice, "InvoiceTotal"),
            "line_items": extract_line_items(invoice)
        }
        extracted_data["invoices"].append(invoice_data)

    return extracted_data

def get_field_value(document, field_name: str):
    """Safely extract field value with confidence score."""
    field = document.fields.get(field_name)
    if field:
        return {
            "value": field.content,
            "confidence": field.confidence
        }
    return None

def extract_line_items(invoice) -> list:
    """Extract individual line items from invoice."""
    items_field = invoice.fields.get("Items")
    if not items_field:
        return []

    line_items = []
    for item in items_field.value:
        line_items.append({
            "description": item.value.get("Description", {}).get("content"),
            "quantity": item.value.get("Quantity", {}).get("content"),
            "unit_price": item.value.get("UnitPrice", {}).get("content"),
            "amount": item.value.get("Amount", {}).get("content")
        })
    return line_items
```

## Confidence Thresholds

Always implement confidence thresholds for automated processing. Fields below 0.85 confidence should trigger human review.

Document Intelligence handles multiple invoice formats without custom training, making it ideal for processing invoices from diverse vendors.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
