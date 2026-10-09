---
title: "Azure Form Recognizer: Extract Data from Documents"
description: "A second pass at Form Recognizer, focused on what's changed since I last wrote about it. The prebuilt invoice and receipt models keep getting better — the…"
author: Michael John Peña
draft: false
date: 2020-10-28
tags:
  - Azure
  - AI
  - Form Recognizer
  - Cognitive Services
---

A second pass at Form Recognizer, focused on what's changed since I last wrote about it. The prebuilt invoice and receipt models keep getting better — the last time I benchmarked against a real client invoice corpus, it was in the high 90s on field-level accuracy without any custom training. The trick is still to design for *human review*: confidence-thresholded handoff, not blind trust.

## Pre-built Models

- **Invoice**: Extract vendor, dates, line items, totals
- **Receipt**: Merchant, date, items, tax, total
- **ID Document**: Name, DOB, address, document number
- **Business Card**: Name, company, phone, email
- **W-2 Tax Form**: Employer, employee, wages, taxes

## Analyze Invoice

```python
from azure.ai.formrecognizer import DocumentAnalysisClient
from azure.core.credentials import AzureKeyCredential

client = DocumentAnalysisClient(
    endpoint="https://myformrecognizer.cognitiveservices.azure.com/",
    credential=AzureKeyCredential("your-key")
)

# Analyze invoice
with open("invoice.pdf", "rb") as f:
    poller = client.begin_analyze_document("prebuilt-invoice", f)
    result = poller.result()

for document in result.documents:
    print(f"Vendor: {document.fields.get('VendorName').value}")
    print(f"Invoice Date: {document.fields.get('InvoiceDate').value}")
    print(f"Invoice Total: {document.fields.get('InvoiceTotal').value}")

    # Line items
    items = document.fields.get("Items")
    if items:
        for item in items.value:
            print(f"  - {item.value.get('Description').value}: {item.value.get('Amount').value}")
```

## Analyze Receipt

```python
with open("receipt.jpg", "rb") as f:
    poller = client.begin_analyze_document("prebuilt-receipt", f)
    result = poller.result()

for document in result.documents:
    print(f"Merchant: {document.fields.get('MerchantName').value}")
    print(f"Date: {document.fields.get('TransactionDate').value}")
    print(f"Total: {document.fields.get('Total').value}")

    items = document.fields.get("Items")
    for item in items.value:
        desc = item.value.get("Description")
        total = item.value.get("TotalPrice")
        print(f"  {desc.value}: ${total.value}")
```

## Custom Models

Train on your document types.

```python
from azure.ai.formrecognizer import DocumentModelAdministrationClient

admin_client = DocumentModelAdministrationClient(endpoint, credential)

# Start training
poller = admin_client.begin_build_document_model(
    "neural",  # or "template" for fixed layouts
    blob_container_url="https://storage.blob.core.windows.net/training-data?sas",
    model_id="my-custom-model"
)
model = poller.result()

print(f"Model ID: {model.model_id}")
print(f"Fields: {[field for field in model.doc_types['my-custom-model'].field_schema]}")
```

## Using Custom Model

```python
# Analyze with custom model
with open("my-document.pdf", "rb") as f:
    poller = client.begin_analyze_document("my-custom-model", f)
    result = poller.result()

for document in result.documents:
    for name, field in document.fields.items():
        print(f"{name}: {field.value} (confidence: {field.confidence})")
```

## Layout Analysis

Extract text, tables, and structure.

```python
with open("document.pdf", "rb") as f:
    poller = client.begin_analyze_document("prebuilt-layout", f)
    result = poller.result()

# Pages and lines
for page in result.pages:
    print(f"Page {page.page_number}: {len(page.lines)} lines")
    for line in page.lines:
        print(f"  {line.content}")

# Tables
for table in result.tables:
    print(f"Table: {table.row_count} rows x {table.column_count} columns")
    for cell in table.cells:
        print(f"  [{cell.row_index},{cell.column_index}]: {cell.content}")
```

## .NET SDK

```csharp
var client = new DocumentAnalysisClient(
    new Uri(endpoint),
    new AzureKeyCredential(key)
);

using var stream = File.OpenRead("invoice.pdf");
var operation = await client.AnalyzeDocumentAsync(
    WaitUntil.Completed,
    "prebuilt-invoice",
    stream
);

var result = operation.Value;
foreach (var document in result.Documents)
{
    if (document.Fields.TryGetValue("VendorName", out var vendor))
    {
        Console.WriteLine($"Vendor: {vendor.Value.AsString()}");
    }

    if (document.Fields.TryGetValue("InvoiceTotal", out var total))
    {
        Console.WriteLine($"Total: {total.Value.AsCurrency().Amount}");
    }
}
```

Form Recognizer automates document processing at scale.
