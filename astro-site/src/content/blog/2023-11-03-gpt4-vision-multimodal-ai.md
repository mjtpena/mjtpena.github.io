---
title: "Building Intelligent Document Processing with Azure AI Services"
author: "Michael John Peña"
draft: false
date: 2023-11-03
tags: ["Azure", "Document Intelligence", "AI", "Computer Vision", "OCR"]

---

I wrote "Building Intelligent Document Processing with Azure AI Services" to share practical, production-minded guidance on this topic.

Intelligent document processing is where Azure AI Services earn their keep in enterprise settings — processing invoices, contracts, medical records, forms, and correspondence at a scale and accuracy that would require hundreds of manual staff otherwise. Azure Document Intelligence (previously Form Recognizer) handles structured and semi-structured documents with prebuilt models for common document types; Azure AI Vision handles scene understanding and OCR for unstructured images; and combining either with Azure OpenAI adds the natural language layer for extracting intent and context that pure extraction models miss. The architecture decision that matters most: whether the document processing is synchronous (a user uploads a document and waits for a result) or asynchronous (documents are queued and processed in bulk) — because the service tier, retry strategy, and cost model are different for each.

## Azure Document Intelligence (Form Recognizer)

### Setting Up Document Analysis

```python
from azure.ai.formrecognizer import DocumentAnalysisClient
from azure.core.credentials import AzureKeyCredential
from dataclasses import dataclass
from typing import List, Dict, Optional
import os

@dataclass
class ExtractedField:
    name: str
    value: str
    confidence: float
    bounding_box: Optional[List[float]] = None

@dataclass
class ExtractedTable:
    rows: int
    columns: int
    cells: List[Dict]

class DocumentProcessor:
    def __init__(self):
        self.client = DocumentAnalysisClient(
            endpoint=os.getenv("AZURE_FORM_RECOGNIZER_ENDPOINT"),
            credential=AzureKeyCredential(os.getenv("AZURE_FORM_RECOGNIZER_KEY"))
        )

    def analyze_document(
        self,
        document_path: str,
        model_id: str = "prebuilt-document"
    ) -> Dict:
        """Analyze a document using specified model."""
        with open(document_path, "rb") as f:
            poller = self.client.begin_analyze_document(
                model_id=model_id,
                document=f
            )
        result = poller.result()

        return self._process_result(result)

    def analyze_invoice(self, document_path: str) -> Dict:
        """Extract structured data from invoices."""
        with open(document_path, "rb") as f:
            poller = self.client.begin_analyze_document(
                model_id="prebuilt-invoice",
                document=f
            )
        result = poller.result()

        invoices = []
        for invoice in result.documents:
            invoice_data = {
                "vendor_name": self._get_field_value(invoice.fields.get("VendorName")),
                "customer_name": self._get_field_value(invoice.fields.get("CustomerName")),
                "invoice_id": self._get_field_value(invoice.fields.get("InvoiceId")),
                "invoice_date": self._get_field_value(invoice.fields.get("InvoiceDate")),
                "due_date": self._get_field_value(invoice.fields.get("DueDate")),
                "subtotal": self._get_field_value(invoice.fields.get("SubTotal")),
                "tax": self._get_field_value(invoice.fields.get("TotalTax")),
                "total": self._get_field_value(invoice.fields.get("InvoiceTotal")),
                "line_items": self._extract_line_items(invoice.fields.get("Items")),
                "confidence": invoice.confidence
            }
            invoices.append(invoice_data)

        return {"invoices": invoices}

    def analyze_receipt(self, document_path: str) -> Dict:
        """Extract structured data from receipts."""
        with open(document_path, "rb") as f:
            poller = self.client.begin_analyze_document(
                model_id="prebuilt-receipt",
                document=f
            )
        result = poller.result()

        receipts = []
        for receipt in result.documents:
            receipt_data = {
                "merchant_name": self._get_field_value(receipt.fields.get("MerchantName")),
                "merchant_address": self._get_field_value(receipt.fields.get("MerchantAddress")),
                "transaction_date": self._get_field_value(receipt.fields.get("TransactionDate")),
                "items": self._extract_receipt_items(receipt.fields.get("Items")),
                "subtotal": self._get_field_value(receipt.fields.get("Subtotal")),
                "tax": self._get_field_value(receipt.fields.get("TotalTax")),
                "total": self._get_field_value(receipt.fields.get("Total")),
                "confidence": receipt.confidence
            }
            receipts.append(receipt_data)

        return {"receipts": receipts}

    def _get_field_value(self, field) -> Optional[str]:
        """Safely extract field value."""
        if field is None:
            return None
        return str(field.value) if field.value else None

    def _extract_line_items(self, items_field) -> List[Dict]:
        """Extract line items from invoice."""
        if not items_field or not items_field.value:
            return []

        line_items = []
        for item in items_field.value:
            line_item = {
                "description": self._get_field_value(item.value.get("Description")),
                "quantity": self._get_field_value(item.value.get("Quantity")),
                "unit_price": self._get_field_value(item.value.get("UnitPrice")),
                "amount": self._get_field_value(item.value.get("Amount"))
            }
            line_items.append(line_item)

        return line_items

    def _extract_receipt_items(self, items_field) -> List[Dict]:
        """Extract items from receipt."""
        if not items_field or not items_field.value:
            return []

        items = []
        for item in items_field.value:
            receipt_item = {
                "name": self._get_field_value(item.value.get("Name")),
                "quantity": self._get_field_value(item.value.get("Quantity")),
                "price": self._get_field_value(item.value.get("Price")),
                "total_price": self._get_field_value(item.value.get("TotalPrice"))
            }
            items.append(receipt_item)

        return items

    def _process_result(self, result) -> Dict:
        """Process general document analysis result."""
        return {
            "content": result.content,
            "pages": len(result.pages),
            "tables": [
                {
                    "row_count": table.row_count,
                    "column_count": table.column_count,
                    "cells": [
                        {
                            "row": cell.row_index,
                            "column": cell.column_index,
                            "content": cell.content
                        }
                        for cell in table.cells
                    ]
                }
                for table in result.tables
            ],
            "key_value_pairs": [
                {
                    "key": kv.key.content if kv.key else None,
                    "value": kv.value.content if kv.value else None,
                    "confidence": kv.confidence
                }
                for kv in result.key_value_pairs
            ]
        }

# Usage
processor = DocumentProcessor()
invoice_data = processor.analyze_invoice("sample_invoice.pdf")
print(f"Invoice Total: {invoice_data['invoices'][0]['total']}")
```

## Building a Document Processing Pipeline

### End-to-End Pipeline

```python
import asyncio
from enum import Enum
from typing import Callable
from azure.storage.blob import BlobServiceClient
import logging

class DocumentType(Enum):
    INVOICE = "invoice"
    RECEIPT = "receipt"
    CONTRACT = "contract"
    GENERAL = "general"

class DocumentPipeline:
    def __init__(
        self,
        blob_connection_string: str,
        processor: DocumentProcessor
    ):
        self.blob_client = BlobServiceClient.from_connection_string(
            blob_connection_string
        )
        self.processor = processor
        self.logger = logging.getLogger(__name__)

        self.type_processors = {
            DocumentType.INVOICE: self.processor.analyze_invoice,
            DocumentType.RECEIPT: self.processor.analyze_receipt,
            DocumentType.GENERAL: self.processor.analyze_document
        }

    def classify_document(self, filename: str, content: bytes) -> DocumentType:
        """Simple document classification based on filename and content."""
        filename_lower = filename.lower()

        if "invoice" in filename_lower:
            return DocumentType.INVOICE
        elif "receipt" in filename_lower:
            return DocumentType.RECEIPT
        elif "contract" in filename_lower:
            return DocumentType.CONTRACT
        else:
            return DocumentType.GENERAL

    async def process_document(
        self,
        container_name: str,
        blob_name: str
    ) -> Dict:
        """Process a single document from blob storage."""
        self.logger.info(f"Processing document: {blob_name}")

        try:
            # Download document
            container_client = self.blob_client.get_container_client(container_name)
            blob_client = container_client.get_blob_client(blob_name)
            content = blob_client.download_blob().readall()

            # Save temporarily for processing
            temp_path = f"/tmp/{blob_name}"
            with open(temp_path, "wb") as f:
                f.write(content)

            # Classify and process
            doc_type = self.classify_document(blob_name, content)
            processor_func = self.type_processors.get(
                doc_type,
                self.processor.analyze_document
            )

            result = processor_func(temp_path)

            # Add metadata
            result["source"] = blob_name
            result["document_type"] = doc_type.value
            result["status"] = "success"

            self.logger.info(f"Successfully processed: {blob_name}")
            return result

        except Exception as e:
            self.logger.error(f"Error processing {blob_name}: {e}")
            return {
                "source": blob_name,
                "status": "error",
                "error": str(e)
            }

    async def process_batch(
        self,
        container_name: str,
        prefix: str = "",
        max_concurrent: int = 5
    ) -> List[Dict]:
        """Process multiple documents concurrently."""
        container_client = self.blob_client.get_container_client(container_name)
        blobs = list(container_client.list_blobs(name_starts_with=prefix))

        self.logger.info(f"Found {len(blobs)} documents to process")

        semaphore = asyncio.Semaphore(max_concurrent)

        async def process_with_semaphore(blob_name: str):
            async with semaphore:
                return await self.process_document(container_name, blob_name)

        tasks = [
            process_with_semaphore(blob.name)
            for blob in blobs
            if blob.name.endswith(('.pdf', '.png', '.jpg', '.jpeg', '.tiff'))
        ]

        results = await asyncio.gather(*tasks)
        return results

# Usage
pipeline = DocumentPipeline(
    blob_connection_string=os.getenv("AZURE_STORAGE_CONNECTION_STRING"),
    processor=DocumentProcessor()
)

# Process batch
results = asyncio.run(pipeline.process_batch(
    container_name="incoming-documents",
    prefix="2023/11/",
    max_concurrent=3
))

# Summarize results
successful = [r for r in results if r["status"] == "success"]
failed = [r for r in results if r["status"] == "error"]
print(f"Processed: {len(successful)} successful, {len(failed)} failed")
```

## Combining with Azure Cognitive Search

```python
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SimpleField,
    SearchableField,
    SearchFieldDataType
)

class DocumentSearchIndexer:
    def __init__(
        self,
        search_endpoint: str,
        search_key: str,
        index_name: str
    ):
        self.index_client = SearchIndexClient(
            endpoint=search_endpoint,
            credential=AzureKeyCredential(search_key)
        )
        self.search_client = SearchClient(
            endpoint=search_endpoint,
            index_name=index_name,
            credential=AzureKeyCredential(search_key)
        )
        self.index_name = index_name

    def create_document_index(self):
        """Create search index for documents."""
        fields = [
            SimpleField(name="id", type=SearchFieldDataType.String, key=True),
            SearchableField(name="content", type=SearchFieldDataType.String),
            SearchableField(name="vendor_name", type=SearchFieldDataType.String, filterable=True),
            SearchableField(name="customer_name", type=SearchFieldDataType.String, filterable=True),
            SimpleField(name="document_type", type=SearchFieldDataType.String, filterable=True),
            SimpleField(name="total_amount", type=SearchFieldDataType.Double, filterable=True, sortable=True),
            SimpleField(name="document_date", type=SearchFieldDataType.DateTimeOffset, filterable=True, sortable=True),
            SimpleField(name="source_path", type=SearchFieldDataType.String),
            SimpleField(name="confidence", type=SearchFieldDataType.Double)
        ]

        index = SearchIndex(name=self.index_name, fields=fields)
        self.index_client.create_or_update_index(index)

    def index_document(self, processed_doc: Dict):
        """Index a processed document."""
        # Transform to search document
        search_doc = {
            "id": processed_doc.get("source", "").replace("/", "_"),
            "content": processed_doc.get("content", ""),
            "vendor_name": processed_doc.get("invoices", [{}])[0].get("vendor_name", ""),
            "customer_name": processed_doc.get("invoices", [{}])[0].get("customer_name", ""),
            "document_type": processed_doc.get("document_type", ""),
            "total_amount": self._parse_amount(
                processed_doc.get("invoices", [{}])[0].get("total")
            ),
            "source_path": processed_doc.get("source", ""),
            "confidence": processed_doc.get("invoices", [{}])[0].get("confidence", 0)
        }

        self.search_client.upload_documents([search_doc])

    def _parse_amount(self, amount_str: str) -> float:
        """Parse amount string to float."""
        if not amount_str:
            return 0.0
        try:
            # Remove currency symbols and convert
            cleaned = amount_str.replace("$", "").replace(",", "").strip()
            return float(cleaned)
        except ValueError:
            return 0.0

    def search_documents(
        self,
        query: str,
        filters: str = None,
        top: int = 10
    ) -> List[Dict]:
        """Search indexed documents."""
        results = self.search_client.search(
            search_text=query,
            filter=filters,
            top=top,
            include_total_count=True
        )

        return [
            {
                "id": r["id"],
                "content_snippet": r.get("content", "")[:200],
                "vendor": r.get("vendor_name"),
                "total": r.get("total_amount"),
                "score": r["@search.score"]
            }
            for r in results
        ]

# Usage
indexer = DocumentSearchIndexer(
    search_endpoint=os.getenv("AZURE_SEARCH_ENDPOINT"),
    search_key=os.getenv("AZURE_SEARCH_KEY"),
    index_name="documents-index"
)

# Create index
indexer.create_document_index()

# Index processed documents
for result in results:
    if result["status"] == "success":
        indexer.index_document(result)

# Search
matches = indexer.search_documents(
    query="office supplies",
    filters="total_amount gt 100"
)
```

## Conclusion

Azure's document processing capabilities enable powerful automation for invoice processing, receipt extraction, and document search. By combining Document Intelligence with Azure Cognitive Search, you can build comprehensive document management solutions. The key is building robust pipelines that handle errors gracefully and scale with your organization's needs.

