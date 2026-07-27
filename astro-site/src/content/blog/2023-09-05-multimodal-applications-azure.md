---
title: "Building Document Intelligence Solutions with Azure Form Recognizer"
author: Michael John Peña
draft: false
date: 2023-09-05
description: "Learn how to extract structured data from documents using Azure Form Recognizer for intelligent document processing."
tags:
  - Azure
  - Form Recognizer
  - Document Intelligence
  - AI
  - OCR

---

I wrote "Building Document Intelligence Solutions with Azure Form Recognizer" to share practical, production-minded guidance on this topic.

## Introduction

Azure Form Recognizer (now part of Azure AI Document Intelligence) enables automated extraction of text, key-value pairs, tables, and structures from documents. This is essential for automating document-heavy business processes.

## Form Recognizer Capabilities

### Pre-built Models
- **Invoice**: Extract vendor, dates, line items, totals
- **Receipt**: Extract merchant, transaction details
- **ID Document**: Extract identity information
- **Business Card**: Extract contact information
- **W-2 Tax Forms**: Extract tax document data

### Custom Models
- Train on your specific document types
- Layout-based or neural training options

## Getting Started

### Installation

```bash
pip install azure-ai-formrecognizer
```

### Basic Setup

```python
import os
from azure.ai.formrecognizer import DocumentAnalysisClient
from azure.core.credentials import AzureKeyCredential

# Initialize client
endpoint = os.getenv("AZURE_FORM_RECOGNIZER_ENDPOINT")
key = os.getenv("AZURE_FORM_RECOGNIZER_KEY")

client = DocumentAnalysisClient(
    endpoint=endpoint,
    credential=AzureKeyCredential(key)
)
```

## Analyzing Documents

### General Document Analysis

```python
def analyze_document(document_url: str) -> dict:
    """Analyze a document and extract content."""
    poller = client.begin_analyze_document_from_url(
        "prebuilt-document",
        document_url
    )
    result = poller.result()

    analysis = {
        "content": result.content,
        "pages": [],
        "tables": [],
        "key_value_pairs": []
    }

    # Extract page information
    for page in result.pages:
        page_info = {
            "page_number": page.page_number,
            "width": page.width,
            "height": page.height,
            "lines": [line.content for line in page.lines] if page.lines else []
        }
        analysis["pages"].append(page_info)

    # Extract tables
    for table in result.tables:
        table_data = {
            "row_count": table.row_count,
            "column_count": table.column_count,
            "cells": []
        }
        for cell in table.cells:
            table_data["cells"].append({
                "row": cell.row_index,
                "column": cell.column_index,
                "content": cell.content,
                "is_header": cell.kind == "columnHeader"
            })
        analysis["tables"].append(table_data)

    # Extract key-value pairs
    for kv_pair in result.key_value_pairs:
        if kv_pair.key and kv_pair.value:
            analysis["key_value_pairs"].append({
                "key": kv_pair.key.content,
                "value": kv_pair.value.content,
                "confidence": kv_pair.confidence
            })

    return analysis

# Usage
result = analyze_document("https://example.com/document.pdf")
print(f"Found {len(result['key_value_pairs'])} key-value pairs")
print(f"Found {len(result['tables'])} tables")
```

### Invoice Processing

```python
from dataclasses import dataclass
from typing import List, Optional
from datetime import date

@dataclass
class LineItem:
    description: str
    quantity: Optional[float]
    unit_price: Optional[float]
    amount: Optional[float]

@dataclass
class Invoice:
    vendor_name: Optional[str]
    vendor_address: Optional[str]
    invoice_id: Optional[str]
    invoice_date: Optional[date]
    due_date: Optional[date]
    subtotal: Optional[float]
    tax: Optional[float]
    total: Optional[float]
    line_items: List[LineItem]

def process_invoice(invoice_url: str) -> Invoice:
    """Process an invoice and extract structured data."""
    poller = client.begin_analyze_document_from_url(
        "prebuilt-invoice",
        invoice_url
    )
    result = poller.result()

    if not result.documents:
        raise ValueError("No invoice found in document")

    invoice_doc = result.documents[0]
    fields = invoice_doc.fields

    def get_value(field_name: str, default=None):
        field = fields.get(field_name)
        if field and field.value:
            return field.value
        return default

    def get_currency_value(field_name: str):
        field = fields.get(field_name)
        if field and field.value:
            return field.value.amount
        return None

    # Extract line items
    line_items = []
    items_field = fields.get("Items")
    if items_field and items_field.value:
        for item in items_field.value:
            item_fields = item.value
            line_items.append(LineItem(
                description=get_value("Description", item_fields) if "Description" in item_fields else None,
                quantity=get_value("Quantity", item_fields) if "Quantity" in item_fields else None,
                unit_price=get_currency_value("UnitPrice") if "UnitPrice" in item_fields else None,
                amount=get_currency_value("Amount") if "Amount" in item_fields else None
            ))

    return Invoice(
        vendor_name=get_value("VendorName"),
        vendor_address=str(get_value("VendorAddress")) if get_value("VendorAddress") else None,
        invoice_id=get_value("InvoiceId"),
        invoice_date=get_value("InvoiceDate"),
        due_date=get_value("DueDate"),
        subtotal=get_currency_value("SubTotal"),
        tax=get_currency_value("TotalTax"),
        total=get_currency_value("InvoiceTotal"),
        line_items=line_items
    )

# Usage
invoice = process_invoice("https://example.com/invoice.pdf")
print(f"Invoice from: {invoice.vendor_name}")
print(f"Total: ${invoice.total}")
print(f"Line items: {len(invoice.line_items)}")
```

### Receipt Processing

```python
@dataclass
class Receipt:
    merchant_name: Optional[str]
    merchant_address: Optional[str]
    transaction_date: Optional[date]
    transaction_time: Optional[str]
    items: List[dict]
    subtotal: Optional[float]
    tax: Optional[float]
    total: Optional[float]

def process_receipt(receipt_url: str) -> Receipt:
    """Process a receipt and extract transaction data."""
    poller = client.begin_analyze_document_from_url(
        "prebuilt-receipt",
        receipt_url
    )
    result = poller.result()

    if not result.documents:
        raise ValueError("No receipt found")

    receipt_doc = result.documents[0]
    fields = receipt_doc.fields

    def get_field_value(name: str):
        field = fields.get(name)
        if field:
            return field.value
        return None

    # Extract items
    items = []
    items_field = fields.get("Items")
    if items_field and items_field.value:
        for item in items_field.value:
            item_dict = {}
            if item.value:
                for key, val in item.value.items():
                    if val and val.value:
                        item_dict[key] = val.value
            items.append(item_dict)

    return Receipt(
        merchant_name=get_field_value("MerchantName"),
        merchant_address=str(get_field_value("MerchantAddress")) if get_field_value("MerchantAddress") else None,
        transaction_date=get_field_value("TransactionDate"),
        transaction_time=get_field_value("TransactionTime"),
        items=items,
        subtotal=get_field_value("Subtotal"),
        tax=get_field_value("TotalTax"),
        total=get_field_value("Total")
    )

# Usage
receipt = process_receipt("https://example.com/receipt.jpg")
print(f"Store: {receipt.merchant_name}")
print(f"Total: ${receipt.total}")
```

## Building a Document Processing Pipeline

```python
from enum import Enum
from typing import Union
import asyncio

class DocumentType(Enum):
    INVOICE = "invoice"
    RECEIPT = "receipt"
    GENERAL = "general"
    UNKNOWN = "unknown"

class DocumentProcessor:
    def __init__(self, client: DocumentAnalysisClient):
        self.client = client

    def classify_document(self, document_url: str) -> DocumentType:
        """Classify document type based on content."""
        # Analyze with general model first
        poller = self.client.begin_analyze_document_from_url(
            "prebuilt-document",
            document_url
        )
        result = poller.result()

        content_lower = result.content.lower()

        # Simple classification based on keywords
        if any(word in content_lower for word in ["invoice", "bill to", "invoice number"]):
            return DocumentType.INVOICE
        elif any(word in content_lower for word in ["receipt", "total", "thank you for"]):
            return DocumentType.RECEIPT
        else:
            return DocumentType.GENERAL

    def process(self, document_url: str) -> Union[Invoice, Receipt, dict]:
        """Process document based on its type."""
        doc_type = self.classify_document(document_url)

        if doc_type == DocumentType.INVOICE:
            return process_invoice(document_url)
        elif doc_type == DocumentType.RECEIPT:
            return process_receipt(document_url)
        else:
            return analyze_document(document_url)

    async def process_batch(self, document_urls: List[str]) -> List[dict]:
        """Process multiple documents concurrently."""
        results = []

        for url in document_urls:
            try:
                result = self.process(url)
                results.append({
                    "url": url,
                    "status": "success",
                    "data": result
                })
            except Exception as e:
                results.append({
                    "url": url,
                    "status": "error",
                    "error": str(e)
                })

        return results

# Usage
processor = DocumentProcessor(client)

# Single document
result = processor.process("https://example.com/document.pdf")

# Batch processing
urls = [
    "https://example.com/invoice1.pdf",
    "https://example.com/receipt1.jpg",
    "https://example.com/contract.pdf"
]
results = asyncio.run(processor.process_batch(urls))
```

## Combining with Azure OpenAI

Enhance extracted data with GPT-4 for additional insights:

```python
from langchain_openai import AzureChatOpenAI

def analyze_invoice_with_ai(invoice: Invoice) -> dict:
    """Use GPT-4 to provide insights on invoice data."""

    llm = AzureChatOpenAI(
        azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
        api_key=os.getenv("AZURE_OPENAI_KEY"),
        deployment_name="gpt-4"
    )

    invoice_summary = f"""
    Invoice Analysis Request:
    - Vendor: {invoice.vendor_name}
    - Invoice ID: {invoice.invoice_id}
    - Date: {invoice.invoice_date}
    - Due Date: {invoice.due_date}
    - Subtotal: ${invoice.subtotal}
    - Tax: ${invoice.tax}
    - Total: ${invoice.total}
    - Line Items: {len(invoice.line_items)}
    """

    prompt = f"""Analyze this invoice and provide:
1. Payment urgency (based on due date)
2. Any potential issues or anomalies
3. Category suggestions for expense tracking
4. Budget allocation recommendations

{invoice_summary}"""

    response = llm.invoke(prompt)

    return {
        "invoice": invoice,
        "ai_analysis": response.content
    }

# Usage
invoice = process_invoice("https://example.com/invoice.pdf")
analysis = analyze_invoice_with_ai(invoice)
print(analysis["ai_analysis"])
```

## Best Practices

### Error Handling

```python
from azure.core.exceptions import HttpResponseError

def safe_process_document(document_url: str) -> dict:
    """Process document with comprehensive error handling."""
    try:
        poller = client.begin_analyze_document_from_url(
            "prebuilt-document",
            document_url
        )
        result = poller.result()
        return {"status": "success", "data": result}

    except HttpResponseError as e:
        if e.status_code == 400:
            return {"status": "error", "error": "Invalid document format"}
        elif e.status_code == 404:
            return {"status": "error", "error": "Document not found"}
        else:
            return {"status": "error", "error": str(e)}

    except Exception as e:
        return {"status": "error", "error": f"Unexpected error: {str(e)}"}
```

### Cost Optimization

```python
class CostOptimizedProcessor:
    def __init__(self, client):
        self.client = client
        self.page_count = 0
        self.cost_per_page = 0.01  # Approximate cost

    def process_with_tracking(self, document_url: str) -> dict:
        """Process document while tracking costs."""
        poller = self.client.begin_analyze_document_from_url(
            "prebuilt-document",
            document_url
        )
        result = poller.result()

        pages = len(result.pages)
        self.page_count += pages
        estimated_cost = pages * self.cost_per_page

        return {
            "result": result,
            "pages_processed": pages,
            "estimated_cost": estimated_cost,
            "total_pages_session": self.page_count
        }

    def get_session_cost(self) -> float:
        return self.page_count * self.cost_per_page
```

## Conclusion

Azure Form Recognizer provides powerful document intelligence capabilities for automating document processing workflows. Combined with GPT-4 for additional analysis, you can build sophisticated document understanding solutions that transform how organizations handle paperwork.

## Resources

- [Azure AI Document Intelligence Documentation](https://learn.microsoft.com/azure/ai-services/document-intelligence/)
- [Pre-built Models Overview](https://learn.microsoft.com/azure/ai-services/document-intelligence/concept-model-overview)
- [Custom Model Training](https://learn.microsoft.com/azure/ai-services/document-intelligence/concept-custom)

