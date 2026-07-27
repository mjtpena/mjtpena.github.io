---
title: "Form Recognizer v3: Intelligent Document Processing at Scale"
author: Michael John Peña
draft: false
date: 2022-03-05
tags:
  - Azure
  - Form Recognizer
  - AI
  - Document Processing
  - OCR

---

I wrote "Form Recognizer v3: Intelligent Document Processing at Scale" to share practical, production-minded guidance on this topic.

## What's New in v3

Form Recognizer v3 introduces:
- **Unified API**: Single endpoint for all document types
- **Improved accuracy**: Better handling of handwriting and poor-quality scans
- **New prebuilt models**: ID documents, health insurance cards, W-2 forms
- **Custom neural models**: Train models without labeled data
- **Query fields**: Extract specific fields without full model training

## Getting Started

Install the new SDK:

```bash
pip install azure-ai-formrecognizer==3.2.0
```

Basic document analysis:

```python
from azure.ai.formrecognizer import DocumentAnalysisClient
from azure.core.credentials import AzureKeyCredential
import os

endpoint = os.environ["FORM_RECOGNIZER_ENDPOINT"]
key = os.environ["FORM_RECOGNIZER_KEY"]

client = DocumentAnalysisClient(
    endpoint=endpoint,
    credential=AzureKeyCredential(key)
)

# Analyze a document
with open("invoice.pdf", "rb") as f:
    poller = client.begin_analyze_document("prebuilt-invoice", f)
    result = poller.result()

for doc in result.documents:
    print(f"Document type: {doc.doc_type}")

    # Extract invoice fields
    vendor = doc.fields.get("VendorName")
    if vendor:
        print(f"Vendor: {vendor.value} (confidence: {vendor.confidence:.2%})")

    invoice_total = doc.fields.get("InvoiceTotal")
    if invoice_total:
        print(f"Total: {invoice_total.value} (confidence: {invoice_total.confidence:.2%})")

    # Line items
    items = doc.fields.get("Items")
    if items:
        for idx, item in enumerate(items.value):
            description = item.value.get("Description")
            amount = item.value.get("Amount")
            print(f"Item {idx + 1}: {description.value if description else 'N/A'} - {amount.value if amount else 'N/A'}")
```

## Prebuilt Models

### Invoice Model

Extract common invoice fields:

```python
def process_invoice(file_path):
    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-invoice", f)
        result = poller.result()

    invoice_data = {}
    for doc in result.documents:
        fields = doc.fields

        invoice_data = {
            "vendor_name": get_field_value(fields, "VendorName"),
            "vendor_address": get_field_value(fields, "VendorAddress"),
            "customer_name": get_field_value(fields, "CustomerName"),
            "invoice_id": get_field_value(fields, "InvoiceId"),
            "invoice_date": get_field_value(fields, "InvoiceDate"),
            "due_date": get_field_value(fields, "DueDate"),
            "subtotal": get_field_value(fields, "SubTotal"),
            "tax": get_field_value(fields, "TotalTax"),
            "total": get_field_value(fields, "InvoiceTotal"),
            "line_items": []
        }

        items = fields.get("Items")
        if items:
            for item in items.value:
                invoice_data["line_items"].append({
                    "description": get_field_value(item.value, "Description"),
                    "quantity": get_field_value(item.value, "Quantity"),
                    "unit_price": get_field_value(item.value, "UnitPrice"),
                    "amount": get_field_value(item.value, "Amount")
                })

    return invoice_data

def get_field_value(fields, name):
    field = fields.get(name)
    return field.value if field else None
```

### ID Document Model

Process identity documents:

```python
def process_id_document(file_path):
    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-idDocument", f)
        result = poller.result()

    for doc in result.documents:
        doc_type = doc.doc_type
        print(f"Document type: {doc_type}")

        if doc_type == "idDocument.driverLicense":
            fields = doc.fields
            return {
                "type": "driver_license",
                "first_name": get_field_value(fields, "FirstName"),
                "last_name": get_field_value(fields, "LastName"),
                "document_number": get_field_value(fields, "DocumentNumber"),
                "date_of_birth": get_field_value(fields, "DateOfBirth"),
                "date_of_expiration": get_field_value(fields, "DateOfExpiration"),
                "address": get_field_value(fields, "Address"),
                "region": get_field_value(fields, "Region"),
                "country": get_field_value(fields, "CountryRegion")
            }
        elif doc_type == "idDocument.passport":
            fields = doc.fields
            return {
                "type": "passport",
                "first_name": get_field_value(fields, "FirstName"),
                "last_name": get_field_value(fields, "LastName"),
                "document_number": get_field_value(fields, "DocumentNumber"),
                "date_of_birth": get_field_value(fields, "DateOfBirth"),
                "date_of_expiration": get_field_value(fields, "DateOfExpiration"),
                "nationality": get_field_value(fields, "Nationality"),
                "machine_readable_zone": get_field_value(fields, "MachineReadableZone")
            }
```

### Receipt Model

Extract receipt data:

```python
def process_receipt(file_path):
    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-receipt", f)
        result = poller.result()

    for doc in result.documents:
        fields = doc.fields

        return {
            "merchant_name": get_field_value(fields, "MerchantName"),
            "merchant_address": get_field_value(fields, "MerchantAddress"),
            "merchant_phone": get_field_value(fields, "MerchantPhoneNumber"),
            "transaction_date": get_field_value(fields, "TransactionDate"),
            "transaction_time": get_field_value(fields, "TransactionTime"),
            "subtotal": get_field_value(fields, "Subtotal"),
            "tax": get_field_value(fields, "TotalTax"),
            "tip": get_field_value(fields, "Tip"),
            "total": get_field_value(fields, "Total"),
            "items": extract_receipt_items(fields.get("Items"))
        }

def extract_receipt_items(items_field):
    if not items_field:
        return []

    items = []
    for item in items_field.value:
        items.append({
            "description": get_field_value(item.value, "Description"),
            "quantity": get_field_value(item.value, "Quantity"),
            "price": get_field_value(item.value, "Price"),
            "total_price": get_field_value(item.value, "TotalPrice")
        })
    return items
```

## Custom Models

### Training with Labels

Train a custom model with labeled data:

```python
from azure.ai.formrecognizer import DocumentModelAdministrationClient

admin_client = DocumentModelAdministrationClient(
    endpoint=endpoint,
    credential=AzureKeyCredential(key)
)

# Training data in Azure Blob Storage with labeled data
training_data_url = "https://mystorageaccount.blob.core.windows.net/training-data?sv=..."

# Start training
poller = admin_client.begin_build_document_model(
    "template",  # or "neural" for neural model
    blob_container_url=training_data_url,
    model_id="my-custom-model",
    description="Custom invoice model for Contoso"
)

model = poller.result()

print(f"Model ID: {model.model_id}")
print(f"Description: {model.description}")
print(f"Created: {model.created_on}")

# List document types the model can recognize
for doc_type, doc_info in model.doc_types.items():
    print(f"\nDocument type: {doc_type}")
    for field_name, field_info in doc_info.field_schema.items():
        print(f"  Field: {field_name} ({field_info['type']})")
```

### Neural Models

Train without labels using the new neural approach:

```python
# Neural models require only 5-10 sample documents
# No labeling needed - the model learns document structure automatically

poller = admin_client.begin_build_document_model(
    "neural",  # Use neural build mode
    blob_container_url=training_data_url,
    model_id="my-neural-model",
    description="Neural model for purchase orders"
)

model = poller.result()
print(f"Neural model trained: {model.model_id}")
```

## Query Fields

Extract specific information without training a model:

```python
# Use query fields to extract specific information
with open("contract.pdf", "rb") as f:
    poller = client.begin_analyze_document(
        "prebuilt-document",
        f,
        features=["queryFields"],
        query_fields=["ContractStartDate", "ContractEndDate", "PartyA", "PartyB", "TotalValue"]
    )
    result = poller.result()

for doc in result.documents:
    for field_name, field in doc.fields.items():
        print(f"{field_name}: {field.value} (confidence: {field.confidence:.2%})")
```

## Batch Processing

Process multiple documents efficiently:

```python
from azure.storage.blob import BlobServiceClient
import asyncio
from concurrent.futures import ThreadPoolExecutor

def process_document_batch(container_url, document_names):
    results = []

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = []
        for doc_name in document_names:
            doc_url = f"{container_url}/{doc_name}"
            future = executor.submit(process_single_document, doc_url)
            futures.append((doc_name, future))

        for doc_name, future in futures:
            try:
                result = future.result(timeout=120)
                results.append({"document": doc_name, "status": "success", "data": result})
            except Exception as e:
                results.append({"document": doc_name, "status": "error", "error": str(e)})

    return results

def process_single_document(doc_url):
    poller = client.begin_analyze_document_from_url("prebuilt-invoice", doc_url)
    result = poller.result()

    # Extract relevant fields
    for doc in result.documents:
        return {
            "invoice_id": get_field_value(doc.fields, "InvoiceId"),
            "total": get_field_value(doc.fields, "InvoiceTotal"),
            "vendor": get_field_value(doc.fields, "VendorName")
        }
```

## Integration with Azure Functions

Create a serverless document processing pipeline:

```python
import azure.functions as func
import json
from azure.ai.formrecognizer import DocumentAnalysisClient
from azure.core.credentials import AzureKeyCredential

app = func.FunctionApp()

@app.blob_trigger(arg_name="blob", path="invoices/{name}", connection="AzureWebJobsStorage")
@app.queue_output(arg_name="output", queue_name="processed-invoices", connection="AzureWebJobsStorage")
def process_invoice_blob(blob: func.InputStream, output: func.Out[str]):
    client = DocumentAnalysisClient(
        endpoint=os.environ["FORM_RECOGNIZER_ENDPOINT"],
        credential=AzureKeyCredential(os.environ["FORM_RECOGNIZER_KEY"])
    )

    # Process the blob
    poller = client.begin_analyze_document("prebuilt-invoice", blob.read())
    result = poller.result()

    # Extract invoice data
    invoice_data = {
        "blob_name": blob.name,
        "processed_at": datetime.utcnow().isoformat(),
        "invoices": []
    }

    for doc in result.documents:
        invoice_data["invoices"].append({
            "vendor": get_field_value(doc.fields, "VendorName"),
            "invoice_id": get_field_value(doc.fields, "InvoiceId"),
            "total": get_field_value(doc.fields, "InvoiceTotal"),
            "confidence": doc.confidence
        })

    # Output to queue for further processing
    output.set(json.dumps(invoice_data))
```

## Handling Tables and Key-Value Pairs

Extract structured data from documents:

```python
def extract_tables_and_kvp(file_path):
    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-layout", f)
        result = poller.result()

    extracted_data = {
        "tables": [],
        "key_value_pairs": []
    }

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

        extracted_data["tables"].append(table_data)

    # Extract key-value pairs
    for kvp in result.key_value_pairs:
        if kvp.key and kvp.value:
            extracted_data["key_value_pairs"].append({
                "key": kvp.key.content,
                "value": kvp.value.content,
                "confidence": kvp.confidence
            })

    return extracted_data
```

## Model Management

Manage your custom models:

```python
# List all models
models = admin_client.list_document_models()
for model in models:
    print(f"{model.model_id}: {model.description} (created: {model.created_on})")

# Get model details
model = admin_client.get_document_model("my-custom-model")
print(f"Model: {model.model_id}")
print(f"API Version: {model.api_version}")
print(f"Document types: {list(model.doc_types.keys())}")

# Delete a model
admin_client.delete_document_model("old-model")

# Copy model to another resource
copy_auth = admin_client.get_copy_authorization(
    model_id="my-copied-model",
    description="Copy of production model"
)

# In source resource
source_admin_client.begin_copy_document_model_to(
    model_id="my-custom-model",
    target=copy_auth
)
```

## Best Practices

1. **Use prebuilt models first**: They're continuously improved and require no training
2. **Combine models**: Use composed models for documents with varying formats
3. **Handle confidence scores**: Implement human review for low-confidence extractions
4. **Optimize for cost**: Use layout model for simple extraction, custom models for complex documents
5. **Enable logging**: Track extraction accuracy over time

```python
# Composed model for multiple document types
poller = admin_client.begin_compose_document_model(
    component_model_ids=["invoice-model", "receipt-model", "po-model"],
    model_id="composed-model",
    description="Handles invoices, receipts, and purchase orders"
)

composed_model = poller.result()
```

## Conclusion

Form Recognizer v3 significantly simplifies intelligent document processing. The unified API, neural models, and query fields make it easier than ever to extract structured data from unstructured documents. Combined with Azure's serverless compute options, you can build scalable document processing pipelines with minimal code.

## Resources

- [Form Recognizer Documentation](https://docs.microsoft.com/en-us/azure/applied-ai-services/form-recognizer/)
- [Form Recognizer Studio](https://formrecognizer.appliedai.azure.com/)
- [SDK Reference](https://docs.microsoft.com/en-us/python/api/azure-ai-formrecognizer/)

