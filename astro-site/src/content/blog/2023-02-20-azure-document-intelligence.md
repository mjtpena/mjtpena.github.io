---
title: "Azure AI Document Intelligence: Extracting Data from Documents"
author: Michael John Peña
draft: false
date: 2023-02-20
tags:
  - Azure
  - Document Intelligence
  - AI
  - OCR
  - Data Extraction
---

## Getting Started

```bash
pip install azure-ai-formrecognizer
```

```python
from azure.ai.formrecognizer import DocumentAnalysisClient
from azure.core.credentials import AzureKeyCredential

# Initialize client
endpoint = "https://your-resource.cognitiveservices.azure.com/"
key = "your-api-key"

client = DocumentAnalysisClient(
    endpoint=endpoint,
    credential=AzureKeyCredential(key)
)
```

## Prebuilt Models

Use prebuilt models for common document types:

```python
# Read model - OCR and layout
def extract_text(file_path: str) -> str:
    """Extract text from any document."""
    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-read", f)
    result = poller.result()

    text = ""
    for page in result.pages:
        for line in page.lines:
            text += line.content + "\n"

    return text

# Invoice model
def extract_invoice(file_path: str) -> dict:
    """Extract data from invoice."""
    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-invoice", f)
    result = poller.result()

    invoice_data = {}
    for doc in result.documents:
        invoice_data = {
            "vendor_name": doc.fields.get("VendorName", {}).value,
            "customer_name": doc.fields.get("CustomerName", {}).value,
            "invoice_date": doc.fields.get("InvoiceDate", {}).value,
            "due_date": doc.fields.get("DueDate", {}).value,
            "total": doc.fields.get("InvoiceTotal", {}).value,
            "items": []
        }

        items = doc.fields.get("Items", {}).value or []
        for item in items:
            invoice_data["items"].append({
                "description": item.value.get("Description", {}).value,
                "quantity": item.value.get("Quantity", {}).value,
                "unit_price": item.value.get("UnitPrice", {}).value,
                "amount": item.value.get("Amount", {}).value
            })

    return invoice_data

# Receipt model
def extract_receipt(file_path: str) -> dict:
    """Extract data from receipt."""
    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-receipt", f)
    result = poller.result()

    for doc in result.documents:
        return {
            "merchant_name": doc.fields.get("MerchantName", {}).value,
            "transaction_date": doc.fields.get("TransactionDate", {}).value,
            "total": doc.fields.get("Total", {}).value,
            "items": [
                {
                    "name": item.value.get("Name", {}).value,
                    "price": item.value.get("TotalPrice", {}).value
                }
                for item in doc.fields.get("Items", {}).value or []
            ]
        }

# ID document model
def extract_id(file_path: str) -> dict:
    """Extract data from ID document."""
    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-idDocument", f)
    result = poller.result()

    for doc in result.documents:
        return {
            "first_name": doc.fields.get("FirstName", {}).value,
            "last_name": doc.fields.get("LastName", {}).value,
            "document_number": doc.fields.get("DocumentNumber", {}).value,
            "date_of_birth": doc.fields.get("DateOfBirth", {}).value,
            "expiration_date": doc.fields.get("DateOfExpiration", {}).value
        }
```

## Layout Analysis

Extract document structure:

```python
def analyze_layout(file_path: str) -> dict:
    """Analyze document layout."""
    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-layout", f)
    result = poller.result()

    layout = {
        "pages": [],
        "tables": [],
        "paragraphs": []
    }

    for page in result.pages:
        page_info = {
            "page_number": page.page_number,
            "width": page.width,
            "height": page.height,
            "lines": [line.content for line in page.lines],
            "selection_marks": len(page.selection_marks or [])
        }
        layout["pages"].append(page_info)

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
        layout["tables"].append(table_data)

    for paragraph in result.paragraphs:
        layout["paragraphs"].append({
            "content": paragraph.content,
            "role": paragraph.role
        })

    return layout
```

## Table Extraction

Extract and process tables:

```python
import pandas as pd

def extract_tables_to_dataframes(file_path: str) -> list:
    """Extract tables as pandas DataFrames."""
    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-layout", f)
    result = poller.result()

    dataframes = []

    for table in result.tables:
        # Initialize grid
        grid = [[None] * table.column_count for _ in range(table.row_count)]

        # Fill grid
        for cell in table.cells:
            grid[cell.row_index][cell.column_index] = cell.content

        # Create DataFrame
        if grid:
            # Check if first row is header
            if all(cell.kind == "columnHeader" for cell in table.cells if cell.row_index == 0):
                df = pd.DataFrame(grid[1:], columns=grid[0])
            else:
                df = pd.DataFrame(grid)

            dataframes.append(df)

    return dataframes

# Usage
tables = extract_tables_to_dataframes("financial_report.pdf")
for i, df in enumerate(tables):
    print(f"Table {i+1}:")
    print(df.to_string())
```

## Custom Models

Train models for your specific documents:

```python
from azure.ai.formrecognizer import DocumentModelAdministrationClient

# Admin client for training
admin_client = DocumentModelAdministrationClient(
    endpoint=endpoint,
    credential=AzureKeyCredential(key)
)

# Train custom model
def train_custom_model(
    training_data_url: str,
    model_id: str,
    description: str = ""
) -> str:
    """Train a custom document model."""
    poller = admin_client.begin_build_document_model(
        model_id=model_id,
        blob_container_url=training_data_url,
        description=description
    )

    model = poller.result()
    return model.model_id

# Use custom model
def extract_with_custom_model(file_path: str, model_id: str) -> dict:
    """Extract data using custom model."""
    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document(model_id, f)
    result = poller.result()

    extracted_data = {}
    for doc in result.documents:
        for name, field in doc.fields.items():
            extracted_data[name] = {
                "value": field.value,
                "confidence": field.confidence
            }

    return extracted_data
```

## Integration with RAG

Use Document Intelligence to feed RAG systems:

```python
class DocumentProcessor:
    """Process documents for RAG ingestion."""

    def __init__(self, endpoint: str, key: str):
        self.client = DocumentAnalysisClient(
            endpoint=endpoint,
            credential=AzureKeyCredential(key)
        )

    def process_for_rag(self, file_path: str) -> list:
        """Process document and return chunks for RAG."""
        with open(file_path, "rb") as f:
            poller = self.client.begin_analyze_document("prebuilt-layout", f)
        result = poller.result()

        chunks = []

        # Process paragraphs
        for para in result.paragraphs:
            chunks.append({
                "type": "paragraph",
                "content": para.content,
                "role": para.role,
                "page": para.bounding_regions[0].page_number if para.bounding_regions else None
            })

        # Process tables as structured text
        for i, table in enumerate(result.tables):
            table_text = self._table_to_text(table)
            chunks.append({
                "type": "table",
                "content": table_text,
                "role": "table",
                "page": table.bounding_regions[0].page_number if table.bounding_regions else None
            })

        return chunks

    def _table_to_text(self, table) -> str:
        """Convert table to readable text."""
        rows = [[None] * table.column_count for _ in range(table.row_count)]

        for cell in table.cells:
            rows[cell.row_index][cell.column_index] = cell.content

        lines = []
        for i, row in enumerate(rows):
            if i == 0:
                lines.append(" | ".join(str(c) for c in row))
                lines.append("-" * 50)
            else:
                lines.append(" | ".join(str(c) for c in row))

        return "\n".join(lines)

# Usage
processor = DocumentProcessor(endpoint, key)
chunks = processor.process_for_rag("contract.pdf")

# Add to vector store
for chunk in chunks:
    embedding = get_embedding(chunk["content"])
    vector_store.add(chunk["content"], embedding, chunk)
```

## Best Practices

1. **Choose the right model**: Prebuilt for common docs, custom for specific formats
2. **Handle confidence scores**: Filter low-confidence extractions
3. **Process asynchronously**: Use polling for large documents
4. **Validate extracted data**: Implement business rules validation
5. **Monitor costs**: Track pages processed

## Resources

- [Document Intelligence Documentation](https://learn.microsoft.com/azure/ai-services/document-intelligence/)
- [Prebuilt Models](https://learn.microsoft.com/azure/ai-services/document-intelligence/concept-model-overview)
- [SDK Reference](https://learn.microsoft.com/python/api/azure-ai-formrecognizer/)
