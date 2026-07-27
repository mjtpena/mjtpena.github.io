---
title: "Intelligent Document Processing with Azure Form Recognizer"
author: Michael John Pena
draft: false
date: 2023-03-08
tags:
  - Azure
  - AI
  - Form Recognizer
  - Document Processing
  - OCR

---

I wrote "Intelligent Document Processing with Azure Form Recognizer" to share practical, production-minded guidance on this topic.

## Form Recognizer Capabilities

- **Pre-built models**: Invoices, receipts, IDs, business cards
- **Layout analysis**: Tables, text, selection marks
- **Custom models**: Train on your specific documents
- **Composed models**: Combine multiple models

## Setting Up

```python
from azure.ai.formrecognizer import DocumentAnalysisClient
from azure.core.credentials import AzureKeyCredential

endpoint = "https://your-form-recognizer.cognitiveservices.azure.com/"
key = "your-api-key"

client = DocumentAnalysisClient(
    endpoint=endpoint,
    credential=AzureKeyCredential(key)
)
```

## Pre-built Invoice Model

```python
from dataclasses import dataclass
from typing import Optional
from decimal import Decimal

@dataclass
class ExtractedInvoice:
    vendor_name: Optional[str]
    invoice_number: Optional[str]
    invoice_date: Optional[str]
    due_date: Optional[str]
    total_amount: Optional[Decimal]
    tax_amount: Optional[Decimal]
    line_items: list

def extract_invoice(file_path: str) -> ExtractedInvoice:
    """Extract data from an invoice document."""
    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-invoice", f)

    result = poller.result()

    for document in result.documents:
        fields = document.fields

        # Extract line items
        line_items = []
        if "Items" in fields and fields["Items"].value:
            for item in fields["Items"].value:
                item_fields = item.value
                line_items.append({
                    "description": item_fields.get("Description", {}).value if item_fields.get("Description") else None,
                    "quantity": item_fields.get("Quantity", {}).value if item_fields.get("Quantity") else None,
                    "unit_price": item_fields.get("UnitPrice", {}).value if item_fields.get("UnitPrice") else None,
                    "amount": item_fields.get("Amount", {}).value if item_fields.get("Amount") else None,
                })

        return ExtractedInvoice(
            vendor_name=fields.get("VendorName", {}).value if fields.get("VendorName") else None,
            invoice_number=fields.get("InvoiceId", {}).value if fields.get("InvoiceId") else None,
            invoice_date=str(fields.get("InvoiceDate", {}).value) if fields.get("InvoiceDate") else None,
            due_date=str(fields.get("DueDate", {}).value) if fields.get("DueDate") else None,
            total_amount=fields.get("InvoiceTotal", {}).value if fields.get("InvoiceTotal") else None,
            tax_amount=fields.get("TotalTax", {}).value if fields.get("TotalTax") else None,
            line_items=line_items
        )

# Usage
invoice = extract_invoice("invoice.pdf")
print(f"Vendor: {invoice.vendor_name}")
print(f"Invoice #: {invoice.invoice_number}")
print(f"Total: ${invoice.total_amount}")
print(f"Line Items: {len(invoice.line_items)}")
```

## Layout Analysis for Tables

```python
def extract_tables(file_path: str) -> list[list[list[str]]]:
    """Extract tables from a document."""
    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-layout", f)

    result = poller.result()

    tables = []
    for table in result.tables:
        # Create 2D array for table
        rows = [[None] * table.column_count for _ in range(table.row_count)]

        for cell in table.cells:
            rows[cell.row_index][cell.column_index] = cell.content

        tables.append(rows)

    return tables

# Usage
tables = extract_tables("report.pdf")
for i, table in enumerate(tables):
    print(f"\nTable {i + 1}:")
    for row in table:
        print(" | ".join(str(cell) for cell in row))
```

## Building a Custom Model

When pre-built models don't fit your documents:

```python
from azure.ai.formrecognizer import DocumentModelAdministrationClient

admin_client = DocumentModelAdministrationClient(
    endpoint=endpoint,
    credential=AzureKeyCredential(key)
)

def train_custom_model(
    training_data_url: str,
    model_id: str,
    description: str
):
    """Train a custom model on labeled documents."""

    # Start training
    poller = admin_client.begin_build_document_model(
        build_mode="template",  # or "neural" for varied documents
        blob_container_url=training_data_url,
        model_id=model_id,
        description=description
    )

    model = poller.result()

    print(f"Model ID: {model.model_id}")
    print(f"Created: {model.created_on}")
    print(f"Doc types: {list(model.doc_types.keys())}")

    return model

# Train on your labeled documents in blob storage
# training_url = "https://yourstorage.blob.core.windows.net/training-data?SAS_TOKEN"
# train_custom_model(training_url, "my-custom-model", "Custom purchase orders")
```

## Document Processing Pipeline

```python
import os
from azure.storage.blob import BlobServiceClient
from azure.servicebus import ServiceBusClient, ServiceBusMessage
import json
from enum import Enum

class DocumentType(Enum):
    INVOICE = "invoice"
    RECEIPT = "receipt"
    PURCHASE_ORDER = "purchase_order"
    UNKNOWN = "unknown"

class DocumentProcessor:
    def __init__(
        self,
        form_recognizer_client: DocumentAnalysisClient,
        blob_client: BlobServiceClient,
        servicebus_client: ServiceBusClient
    ):
        self.fr_client = form_recognizer_client
        self.blob_client = blob_client
        self.sb_client = servicebus_client

    def classify_document(self, file_path: str) -> DocumentType:
        """Classify document type based on content."""
        with open(file_path, "rb") as f:
            poller = self.fr_client.begin_analyze_document("prebuilt-layout", f)

        result = poller.result()

        # Simple classification based on keywords
        text = " ".join([line.content for page in result.pages for line in page.lines])
        text_lower = text.lower()

        if "invoice" in text_lower:
            return DocumentType.INVOICE
        elif "receipt" in text_lower:
            return DocumentType.RECEIPT
        elif "purchase order" in text_lower or "p.o." in text_lower:
            return DocumentType.PURCHASE_ORDER
        else:
            return DocumentType.UNKNOWN

    def process_document(self, file_path: str) -> dict:
        """Process document based on its type."""
        doc_type = self.classify_document(file_path)

        with open(file_path, "rb") as f:
            if doc_type == DocumentType.INVOICE:
                poller = self.fr_client.begin_analyze_document("prebuilt-invoice", f)
            elif doc_type == DocumentType.RECEIPT:
                poller = self.fr_client.begin_analyze_document("prebuilt-receipt", f)
            else:
                poller = self.fr_client.begin_analyze_document("prebuilt-layout", f)

        result = poller.result()

        return {
            "document_type": doc_type.value,
            "confidence": result.documents[0].confidence if result.documents else None,
            "fields": self._extract_fields(result),
            "tables": self._extract_tables(result)
        }

    def _extract_fields(self, result) -> dict:
        """Extract fields from analysis result."""
        fields = {}
        for document in result.documents:
            for name, field in document.fields.items():
                if field.value is not None:
                    fields[name] = {
                        "value": str(field.value),
                        "confidence": field.confidence
                    }
        return fields

    def _extract_tables(self, result) -> list:
        """Extract tables from analysis result."""
        tables = []
        for table in result.tables:
            table_data = {
                "rows": table.row_count,
                "columns": table.column_count,
                "cells": []
            }
            for cell in table.cells:
                table_data["cells"].append({
                    "row": cell.row_index,
                    "column": cell.column_index,
                    "content": cell.content
                })
            tables.append(table_data)
        return tables

    def process_and_route(self, file_path: str, source: str):
        """Process document and route to appropriate queue."""
        result = self.process_document(file_path)

        # Add metadata
        result["source"] = source
        result["file_name"] = os.path.basename(file_path)

        # Route to appropriate queue based on document type
        queue_name = f"documents-{result['document_type']}"

        with self.sb_client.get_queue_sender(queue_name) as sender:
            message = ServiceBusMessage(json.dumps(result))
            sender.send_messages(message)

        return result
```

## Batch Processing with Azure Functions

```python
import azure.functions as func
from azure.ai.formrecognizer import DocumentAnalysisClient
from azure.core.credentials import AzureKeyCredential
import json
import os

app = func.FunctionApp()

@app.blob_trigger(
    arg_name="blob",
    path="incoming-documents/{name}",
    connection="AzureWebJobsStorage"
)
@app.queue_output(
    arg_name="output",
    queue_name="processed-documents",
    connection="AzureWebJobsStorage"
)
def process_incoming_document(blob: func.InputStream, output: func.Out[str]):
    """Process documents uploaded to blob storage."""

    client = DocumentAnalysisClient(
        endpoint=os.environ["FORM_RECOGNIZER_ENDPOINT"],
        credential=AzureKeyCredential(os.environ["FORM_RECOGNIZER_KEY"])
    )

    # Analyze document
    poller = client.begin_analyze_document("prebuilt-invoice", blob)
    result = poller.result()

    # Extract data
    extracted = {
        "file_name": blob.name,
        "documents": []
    }

    for document in result.documents:
        doc_data = {
            "doc_type": document.doc_type,
            "confidence": document.confidence,
            "fields": {}
        }

        for name, field in document.fields.items():
            if field.value is not None:
                doc_data["fields"][name] = str(field.value)

        extracted["documents"].append(doc_data)

    # Send to output queue
    output.set(json.dumps(extracted))
```

## Validation and Confidence Scoring

```python
@dataclass
class ValidationResult:
    is_valid: bool
    confidence_score: float
    issues: list[str]

def validate_extracted_invoice(invoice: ExtractedInvoice) -> ValidationResult:
    """Validate extracted invoice data."""
    issues = []
    confidence_scores = []

    # Required fields
    if not invoice.vendor_name:
        issues.append("Missing vendor name")
    if not invoice.invoice_number:
        issues.append("Missing invoice number")
    if not invoice.total_amount:
        issues.append("Missing total amount")

    # Line item validation
    if invoice.line_items:
        line_total = sum(
            item.get("amount", 0) or 0
            for item in invoice.line_items
        )
        if invoice.total_amount and abs(line_total - float(invoice.total_amount)) > 0.01:
            issues.append(f"Line items total ({line_total}) doesn't match invoice total ({invoice.total_amount})")

    # Date validation
    from datetime import datetime
    if invoice.invoice_date:
        try:
            date = datetime.strptime(invoice.invoice_date, "%Y-%m-%d")
            if date > datetime.now():
                issues.append("Invoice date is in the future")
        except:
            issues.append("Invalid invoice date format")

    return ValidationResult(
        is_valid=len(issues) == 0,
        confidence_score=0.9 if len(issues) == 0 else 0.5,
        issues=issues
    )
```

## Integration with ERP Systems

```python
class ERPIntegration:
    def __init__(self, erp_api_url: str, api_key: str):
        self.api_url = erp_api_url
        self.api_key = api_key

    def create_invoice_entry(self, invoice: ExtractedInvoice) -> dict:
        """Create invoice entry in ERP system."""
        payload = {
            "vendor": invoice.vendor_name,
            "invoice_number": invoice.invoice_number,
            "invoice_date": invoice.invoice_date,
            "due_date": invoice.due_date,
            "total_amount": float(invoice.total_amount) if invoice.total_amount else 0,
            "tax_amount": float(invoice.tax_amount) if invoice.tax_amount else 0,
            "line_items": [
                {
                    "description": item.get("description"),
                    "quantity": item.get("quantity"),
                    "unit_price": item.get("unit_price"),
                    "amount": item.get("amount")
                }
                for item in invoice.line_items
            ],
            "status": "pending_approval"
        }

        response = requests.post(
            f"{self.api_url}/invoices",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            },
            json=payload
        )

        return response.json()
```

Azure Form Recognizer transforms manual document processing into automated workflows. The combination of pre-built and custom models handles most document types, while confidence scores enable human-in-the-loop validation for edge cases.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
