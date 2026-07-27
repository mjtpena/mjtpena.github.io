---
title: "Azure Document Intelligence: Extracting Structured Data from Documents"
author: Michael John Peña
draft: false
date: 2025-04-19
tags:
  - Azure
  - Document Intelligence
  - OCR
  - Extraction
  - AI

---

I wrote "Azure Document Intelligence: Extracting Structured Data from Documents" to share practical, production-minded guidance on this topic.

## Document Intelligence Integration

```python
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeResult
from azure.core.credentials import AzureKeyCredential

class DocumentProcessor:
    def __init__(self, endpoint: str, key: str):
        self.client = DocumentIntelligenceClient(
            endpoint=endpoint,
            credential=AzureKeyCredential(key)
        )

    async def analyze_document(self, document_bytes: bytes, model_id: str = "prebuilt-layout") -> dict:
        """Analyze document with specified model."""
        poller = self.client.begin_analyze_document(
            model_id,
            document_bytes,
            content_type="application/pdf"
        )

        result = poller.result()
        return self.parse_result(result)

    async def extract_invoice(self, invoice_bytes: bytes) -> dict:
        """Extract structured data from invoice."""
        poller = self.client.begin_analyze_document(
            "prebuilt-invoice",
            invoice_bytes
        )

        result = poller.result()

        if result.documents:
            invoice = result.documents[0]
            return {
                "vendor_name": self.get_field_value(invoice, "VendorName"),
                "invoice_number": self.get_field_value(invoice, "InvoiceId"),
                "invoice_date": self.get_field_value(invoice, "InvoiceDate"),
                "due_date": self.get_field_value(invoice, "DueDate"),
                "total": self.get_field_value(invoice, "InvoiceTotal"),
                "items": self.extract_line_items(invoice)
            }

        return {}

    async def extract_receipt(self, receipt_bytes: bytes) -> dict:
        """Extract data from receipt."""
        poller = self.client.begin_analyze_document(
            "prebuilt-receipt",
            receipt_bytes
        )

        result = poller.result()

        if result.documents:
            receipt = result.documents[0]
            return {
                "merchant_name": self.get_field_value(receipt, "MerchantName"),
                "transaction_date": self.get_field_value(receipt, "TransactionDate"),
                "total": self.get_field_value(receipt, "Total"),
                "items": self.extract_items(receipt)
            }

        return {}

    async def extract_tables(self, document_bytes: bytes) -> list[dict]:
        """Extract all tables from document."""
        poller = self.client.begin_analyze_document(
            "prebuilt-layout",
            document_bytes
        )

        result = poller.result()
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
                    "content": cell.content,
                    "is_header": cell.kind == "columnHeader"
                })

            tables.append(table_data)

        return tables

    def get_field_value(self, document, field_name: str):
        """Safely extract field value."""
        field = document.fields.get(field_name)
        if field:
            return field.content if hasattr(field, 'content') else field.value
        return None

    def extract_line_items(self, invoice) -> list[dict]:
        """Extract line items from invoice."""
        items_field = invoice.fields.get("Items")
        if not items_field or not items_field.value:
            return []

        items = []
        for item in items_field.value:
            items.append({
                "description": self.get_field_value(item, "Description"),
                "quantity": self.get_field_value(item, "Quantity"),
                "unit_price": self.get_field_value(item, "UnitPrice"),
                "amount": self.get_field_value(item, "Amount")
            })

        return items
```

Document Intelligence automates data extraction from complex business documents.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
