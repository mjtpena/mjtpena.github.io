---
title: Intelligent Document Processing with Azure Form Recognizer
author: Michael John Pena
draft: false
date: 2021-03-30
url: /blog/form-recognizer/
tags:
  - Azure
  - Form Recognizer
  - Document Processing
  - OCR
  - AI
---

Form Recognizer is where I've seen the most immediate ROI from Cognitive Services in enterprise settings. Accounts payable teams manually keying invoice data from PDFs. Insurance claims with handwritten forms. Medical referrals with structured but non-standard layouts. Form Recognizer's prebuilt models—invoices, receipts, ID documents, business cards, tax forms—are production-ready for common formats without any training. The custom models let you train on your specific form layout with as few as five labelled examples. The confidence scores per field are honest and actionable; you route low-confidence extractions to human review rather than letting bad data into the system.

## Setting Up Form Recognizer

```bash
# Create Form Recognizer resource
az cognitiveservices account create \
    --name myformrecognizer \
    --resource-group myResourceGroup \
    --kind FormRecognizer \
    --sku S0 \
    --location eastus
```

## Pre-built Models

Form Recognizer includes pre-built models for common document types.

### Invoice Processing

```python
from azure.ai.formrecognizer import DocumentAnalysisClient
from azure.core.credentials import AzureKeyCredential
import json

class InvoiceProcessor:
    def __init__(self, endpoint, key):
        self.client = DocumentAnalysisClient(
            endpoint=endpoint,
            credential=AzureKeyCredential(key)
        )

    def analyze_invoice(self, document_url):
        """Analyze invoice using pre-built model."""
        poller = self.client.begin_analyze_document_from_url(
            "prebuilt-invoice",
            document_url
        )
        result = poller.result()

        invoices = []
        for invoice in result.documents:
            invoice_data = {
                "vendor_name": self._get_field_value(invoice.fields.get("VendorName")),
                "vendor_address": self._get_field_value(invoice.fields.get("VendorAddress")),
                "customer_name": self._get_field_value(invoice.fields.get("CustomerName")),
                "customer_address": self._get_field_value(invoice.fields.get("CustomerAddress")),
                "invoice_id": self._get_field_value(invoice.fields.get("InvoiceId")),
                "invoice_date": self._get_field_value(invoice.fields.get("InvoiceDate")),
                "due_date": self._get_field_value(invoice.fields.get("DueDate")),
                "purchase_order": self._get_field_value(invoice.fields.get("PurchaseOrder")),
                "subtotal": self._get_field_value(invoice.fields.get("SubTotal")),
                "tax": self._get_field_value(invoice.fields.get("TotalTax")),
                "total": self._get_field_value(invoice.fields.get("InvoiceTotal")),
                "amount_due": self._get_field_value(invoice.fields.get("AmountDue")),
                "items": self._extract_line_items(invoice.fields.get("Items"))
            }
            invoices.append(invoice_data)

        return invoices

    def analyze_invoice_stream(self, document_stream):
        """Analyze invoice from file stream."""
        poller = self.client.begin_analyze_document(
            "prebuilt-invoice",
            document_stream
        )
        return self._process_result(poller.result())

    def _get_field_value(self, field):
        if field is None:
            return None
        return {
            "value": field.value,
            "confidence": field.confidence
        }

    def _extract_line_items(self, items_field):
        if items_field is None:
            return []

        items = []
        for item in items_field.value:
            item_data = {}
            if "Description" in item.value:
                item_data["description"] = item.value["Description"].value
            if "Quantity" in item.value:
                item_data["quantity"] = item.value["Quantity"].value
            if "UnitPrice" in item.value:
                item_data["unit_price"] = item.value["UnitPrice"].value
            if "Amount" in item.value:
                item_data["amount"] = item.value["Amount"].value
            items.append(item_data)

        return items


# Usage
processor = InvoiceProcessor(
    "https://your-resource.cognitiveservices.azure.com",
    "your-key"
)

# Analyze from URL
invoice = processor.analyze_invoice(
    "https://example.com/invoice.pdf"
)[0]

print(f"Vendor: {invoice['vendor_name']['value']}")
print(f"Invoice #: {invoice['invoice_id']['value']}")
print(f"Total: ${invoice['total']['value']}")
print(f"Line items:")
for item in invoice['items']:
    print(f"  - {item.get('description')}: ${item.get('amount')}")
```

### Receipt Processing

```python
def analyze_receipt(self, receipt_url):
    """Analyze receipt using pre-built model."""
    poller = self.client.begin_analyze_document_from_url(
        "prebuilt-receipt",
        receipt_url
    )
    result = poller.result()

    receipts = []
    for receipt in result.documents:
        receipt_data = {
            "merchant_name": self._get_field_value(receipt.fields.get("MerchantName")),
            "merchant_address": self._get_field_value(receipt.fields.get("MerchantAddress")),
            "merchant_phone": self._get_field_value(receipt.fields.get("MerchantPhoneNumber")),
            "transaction_date": self._get_field_value(receipt.fields.get("TransactionDate")),
            "transaction_time": self._get_field_value(receipt.fields.get("TransactionTime")),
            "subtotal": self._get_field_value(receipt.fields.get("Subtotal")),
            "tax": self._get_field_value(receipt.fields.get("TotalTax")),
            "tip": self._get_field_value(receipt.fields.get("Tip")),
            "total": self._get_field_value(receipt.fields.get("Total")),
            "items": self._extract_receipt_items(receipt.fields.get("Items"))
        }
        receipts.append(receipt_data)

    return receipts
```

### Business Card Processing

```python
def analyze_business_card(self, card_url):
    """Extract contact information from business card."""
    poller = self.client.begin_analyze_document_from_url(
        "prebuilt-businessCard",
        card_url
    )
    result = poller.result()

    contacts = []
    for card in result.documents:
        contact = {
            "names": [n.value for n in card.fields.get("ContactNames", {}).value or []],
            "job_titles": [j.value for j in card.fields.get("JobTitles", {}).value or []],
            "companies": [c.value for c in card.fields.get("CompanyNames", {}).value or []],
            "emails": [e.value for e in card.fields.get("Emails", {}).value or []],
            "phones": [p.value for p in card.fields.get("MobilePhones", {}).value or []] +
                     [p.value for p in card.fields.get("WorkPhones", {}).value or []],
            "addresses": [a.value for a in card.fields.get("Addresses", {}).value or []],
            "websites": [w.value for w in card.fields.get("Websites", {}).value or []]
        }
        contacts.append(contact)

    return contacts
```

### ID Document Processing

```python
def analyze_id_document(self, id_url):
    """Extract information from ID documents (passport, driver's license)."""
    poller = self.client.begin_analyze_document_from_url(
        "prebuilt-idDocument",
        id_url
    )
    result = poller.result()

    documents = []
    for id_doc in result.documents:
        doc_data = {
            "document_type": id_doc.doc_type,
            "first_name": self._get_field_value(id_doc.fields.get("FirstName")),
            "last_name": self._get_field_value(id_doc.fields.get("LastName")),
            "date_of_birth": self._get_field_value(id_doc.fields.get("DateOfBirth")),
            "date_of_expiration": self._get_field_value(id_doc.fields.get("DateOfExpiration")),
            "document_number": self._get_field_value(id_doc.fields.get("DocumentNumber")),
            "address": self._get_field_value(id_doc.fields.get("Address")),
            "country_region": self._get_field_value(id_doc.fields.get("CountryRegion")),
            "sex": self._get_field_value(id_doc.fields.get("Sex"))
        }
        documents.append(doc_data)

    return documents
```

## Custom Models

Train custom models for your specific document types.

```python
from azure.ai.formrecognizer import DocumentModelAdministrationClient
import time

class CustomModelTrainer:
    def __init__(self, endpoint, key):
        self.admin_client = DocumentModelAdministrationClient(
            endpoint=endpoint,
            credential=AzureKeyCredential(key)
        )
        self.analysis_client = DocumentAnalysisClient(
            endpoint=endpoint,
            credential=AzureKeyCredential(key)
        )

    def train_model(self, training_data_url, model_id, description=None):
        """Train a custom model on labeled data."""
        poller = self.admin_client.begin_build_document_model(
            "neural",  # or "template"
            blob_container_url=training_data_url,
            model_id=model_id,
            description=description
        )

        model = poller.result()
        print(f"Model ID: {model.model_id}")
        print(f"Description: {model.description}")
        print(f"Created: {model.created_on}")

        print("Document types:")
        for name, doc_type in model.doc_types.items():
            print(f"  {name}:")
            for field_name, field in doc_type.field_schema.items():
                print(f"    - {field_name}: {field['type']}")

        return model

    def compose_models(self, model_ids, composed_model_id, description=None):
        """Combine multiple models into one."""
        poller = self.admin_client.begin_compose_document_model(
            model_ids,
            model_id=composed_model_id,
            description=description
        )
        return poller.result()

    def analyze_with_custom_model(self, model_id, document_url):
        """Analyze document with custom model."""
        poller = self.analysis_client.begin_analyze_document_from_url(
            model_id,
            document_url
        )
        result = poller.result()

        documents = []
        for doc in result.documents:
            doc_data = {
                "doc_type": doc.doc_type,
                "confidence": doc.confidence,
                "fields": {}
            }

            for name, field in doc.fields.items():
                doc_data["fields"][name] = {
                    "value": field.value,
                    "confidence": field.confidence,
                    "value_type": field.value_type
                }

            documents.append(doc_data)

        return documents

    def list_models(self):
        """List all custom models."""
        models = self.admin_client.list_document_models()
        return [
            {
                "model_id": m.model_id,
                "description": m.description,
                "created_on": m.created_on
            }
            for m in models
        ]

    def delete_model(self, model_id):
        """Delete a custom model."""
        self.admin_client.delete_document_model(model_id)


# Train custom model
trainer = CustomModelTrainer(
    "https://your-resource.cognitiveservices.azure.com",
    "your-key"
)

# Training data in blob storage with OCR JSON files
model = trainer.train_model(
    training_data_url="https://storage.blob.core.windows.net/training-data?sv=...",
    model_id="purchase-order-v1",
    description="Custom model for purchase orders"
)

# Use custom model
results = trainer.analyze_with_custom_model(
    "purchase-order-v1",
    "https://example.com/po.pdf"
)
```

## Layout Analysis

```python
def analyze_layout(self, document_url):
    """Extract text, tables, and structure from document."""
    poller = self.client.begin_analyze_document_from_url(
        "prebuilt-layout",
        document_url
    )
    result = poller.result()

    analysis = {
        "pages": [],
        "tables": [],
        "paragraphs": []
    }

    # Extract page information
    for page in result.pages:
        page_data = {
            "page_number": page.page_number,
            "width": page.width,
            "height": page.height,
            "unit": page.unit,
            "lines": [
                {
                    "content": line.content,
                    "bounding_box": line.polygon
                }
                for line in page.lines
            ],
            "words": [
                {
                    "content": word.content,
                    "confidence": word.confidence
                }
                for word in page.words
            ]
        }
        analysis["pages"].append(page_data)

    # Extract tables
    for table in result.tables:
        table_data = {
            "row_count": table.row_count,
            "column_count": table.column_count,
            "cells": [
                {
                    "content": cell.content,
                    "row_index": cell.row_index,
                    "column_index": cell.column_index,
                    "row_span": cell.row_span,
                    "column_span": cell.column_span,
                    "is_header": cell.kind == "columnHeader"
                }
                for cell in table.cells
            ]
        }
        analysis["tables"].append(table_data)

    # Extract paragraphs
    for paragraph in result.paragraphs:
        analysis["paragraphs"].append({
            "content": paragraph.content,
            "role": paragraph.role  # title, sectionHeading, pageHeader, etc.
        })

    return analysis


def extract_table_as_dataframe(table_data):
    """Convert extracted table to pandas DataFrame."""
    import pandas as pd

    # Create empty grid
    rows = [[None] * table_data["column_count"] for _ in range(table_data["row_count"])]

    # Fill in cells
    for cell in table_data["cells"]:
        rows[cell["row_index"]][cell["column_index"]] = cell["content"]

    # Create DataFrame
    df = pd.DataFrame(rows[1:], columns=rows[0])
    return df
```

## Batch Processing

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor

async def process_documents_batch(processor, document_urls, model_id="prebuilt-invoice"):
    """Process multiple documents concurrently."""
    results = []

    async def process_one(url):
        poller = processor.client.begin_analyze_document_from_url(model_id, url)
        return poller.result()

    # Process in batches of 5
    batch_size = 5
    for i in range(0, len(document_urls), batch_size):
        batch = document_urls[i:i + batch_size]
        tasks = [process_one(url) for url in batch]
        batch_results = await asyncio.gather(*tasks)
        results.extend(batch_results)

    return results


# Usage
async def main():
    urls = [
        "https://storage.blob.core.windows.net/invoices/inv001.pdf",
        "https://storage.blob.core.windows.net/invoices/inv002.pdf",
        "https://storage.blob.core.windows.net/invoices/inv003.pdf",
    ]

    processor = InvoiceProcessor("endpoint", "key")
    results = await process_documents_batch(processor, urls)

    for i, result in enumerate(results):
        print(f"Invoice {i + 1}: Total = {result.documents[0].fields.get('InvoiceTotal')}")

asyncio.run(main())
```

## Integration Example: Invoice Processing Pipeline

```python
from azure.storage.blob import BlobServiceClient
import json

class InvoicePipeline:
    def __init__(self, form_recognizer_endpoint, form_recognizer_key,
                 storage_connection_string):
        self.processor = InvoiceProcessor(form_recognizer_endpoint, form_recognizer_key)
        self.blob_service = BlobServiceClient.from_connection_string(storage_connection_string)

    def process_new_invoices(self, input_container, output_container):
        """Process new invoices from blob storage."""
        input_client = self.blob_service.get_container_client(input_container)
        output_client = self.blob_service.get_container_client(output_container)

        processed = []

        for blob in input_client.list_blobs():
            if blob.name.lower().endswith(('.pdf', '.jpg', '.png')):
                print(f"Processing: {blob.name}")

                # Get blob URL with SAS token
                blob_url = self._get_blob_url_with_sas(input_container, blob.name)

                # Process invoice
                try:
                    invoices = self.processor.analyze_invoice(blob_url)

                    # Save results
                    result_json = json.dumps(invoices, default=str, indent=2)
                    output_blob_name = f"{blob.name}.json"
                    output_client.upload_blob(output_blob_name, result_json, overwrite=True)

                    processed.append({
                        "file": blob.name,
                        "status": "success",
                        "data": invoices
                    })
                except Exception as e:
                    processed.append({
                        "file": blob.name,
                        "status": "error",
                        "error": str(e)
                    })

        return processed

    def _get_blob_url_with_sas(self, container, blob_name):
        from datetime import datetime, timedelta
        from azure.storage.blob import generate_blob_sas, BlobSasPermissions

        sas_token = generate_blob_sas(
            self.blob_service.account_name,
            container,
            blob_name,
            permission=BlobSasPermissions(read=True),
            expiry=datetime.utcnow() + timedelta(hours=1)
        )

        return f"{self.blob_service.url}{container}/{blob_name}?{sas_token}"
```

## Conclusion

Azure Form Recognizer transforms document processing:

- **Pre-built models** for invoices, receipts, IDs, and business cards
- **Custom models** for domain-specific documents
- **Layout analysis** for complex document structures
- **Table extraction** for structured data
- **Batch processing** for high-volume scenarios

It eliminates manual data entry and enables intelligent document workflows.
