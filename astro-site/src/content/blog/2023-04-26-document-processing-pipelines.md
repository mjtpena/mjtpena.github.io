---
title: "Intelligent Document Processing Pipelines with AI"
description: "Intelligent document processing transforms unstructured documents into structured, actionable data. Combining OCR, layout analysis, and LLM understanding…"
author: Michael John Pena
draft: false
date: 2023-04-26
tags:
  - AI
  - Document Processing
  - Azure
  - Data Engineering
  - OCR
---

## Document Processing Architecture

```python
from dataclasses import dataclass
from typing import List, Optional, Dict
from enum import Enum
import json

class DocumentType(Enum):
    INVOICE = "invoice"
    CONTRACT = "contract"
    FORM = "form"
    REPORT = "report"
    EMAIL = "email"
    UNKNOWN = "unknown"

@dataclass
class ProcessedDocument:
    document_id: str
    document_type: DocumentType
    raw_text: str
    structured_data: Dict
    entities: List[Dict]
    metadata: Dict
    confidence: float

class DocumentProcessingPipeline:
    """End-to-end document processing pipeline."""

    def __init__(self, config: dict):
        self.config = config
        self._init_services()

    def _init_services(self):
        """Initialize Azure services."""
        from azure.ai.formrecognizer import DocumentAnalysisClient
        from azure.core.credentials import AzureKeyCredential

        self.form_recognizer = DocumentAnalysisClient(
            endpoint=self.config["form_recognizer_endpoint"],
            credential=AzureKeyCredential(self.config["form_recognizer_key"])
        )

        self.llm_client = self.config["llm_client"]

    async def process_document(
        self,
        document_bytes: bytes,
        filename: str
    ) -> ProcessedDocument:
        """Process a single document."""

        # Step 1: Extract text and layout
        extraction_result = await self._extract_content(document_bytes)

        # Step 2: Classify document
        doc_type = await self._classify_document(
            extraction_result["text"],
            filename
        )

        # Step 3: Extract structured data based on type
        structured_data = await self._extract_structured_data(
            extraction_result,
            doc_type
        )

        # Step 4: Extract entities
        entities = await self._extract_entities(extraction_result["text"])

        return ProcessedDocument(
            document_id=self._generate_id(filename),
            document_type=doc_type,
            raw_text=extraction_result["text"],
            structured_data=structured_data,
            entities=entities,
            metadata={
                "filename": filename,
                "page_count": extraction_result.get("page_count", 1),
                "tables_found": len(extraction_result.get("tables", [])),
                "processing_timestamp": datetime.utcnow().isoformat()
            },
            confidence=structured_data.get("confidence", 0.0)
        )

    async def _extract_content(self, document_bytes: bytes) -> dict:
        """Extract content using Form Recognizer."""

        poller = self.form_recognizer.begin_analyze_document(
            "prebuilt-document",
            document_bytes
        )
        result = poller.result()

        return {
            "text": result.content,
            "pages": [
                {
                    "page_number": page.page_number,
                    "width": page.width,
                    "height": page.height,
                    "lines": [line.content for line in page.lines]
                }
                for page in result.pages
            ],
            "tables": [
                {
                    "row_count": table.row_count,
                    "column_count": table.column_count,
                    "cells": [
                        {
                            "row": cell.row_index,
                            "col": cell.column_index,
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
                    "value": kv.value.content if kv.value else None
                }
                for kv in result.key_value_pairs
            ],
            "page_count": len(result.pages)
        }

    async def _classify_document(
        self,
        text: str,
        filename: str
    ) -> DocumentType:
        """Classify document type using LLM."""

        prompt = f"""Classify this document into one of these types:
- invoice: bills, invoices, receipts
- contract: legal agreements, terms of service
- form: application forms, surveys
- report: business reports, analysis documents
- email: email correspondence
- unknown: cannot determine

Filename: {filename}

Document text (first 2000 chars):
{text[:2000]}

Return only the document type (lowercase)."""

        response = await self.llm_client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        doc_type = response.content.strip().lower()

        try:
            return DocumentType(doc_type)
        except ValueError:
            return DocumentType.UNKNOWN
```

## Invoice Processing

```python
class InvoiceProcessor:
    """Specialized invoice processing."""

    def __init__(self, form_recognizer_client, llm_client):
        self.form_recognizer = form_recognizer_client
        self.llm_client = llm_client

    async def process_invoice(
        self,
        document_bytes: bytes
    ) -> dict:
        """Process invoice using pre-built model."""

        poller = self.form_recognizer.begin_analyze_document(
            "prebuilt-invoice",
            document_bytes
        )
        result = poller.result()

        invoices = []

        for invoice in result.documents:
            extracted = {
                "vendor_name": self._get_field_value(invoice, "VendorName"),
                "vendor_address": self._get_field_value(invoice, "VendorAddress"),
                "customer_name": self._get_field_value(invoice, "CustomerName"),
                "customer_address": self._get_field_value(invoice, "CustomerAddress"),
                "invoice_id": self._get_field_value(invoice, "InvoiceId"),
                "invoice_date": self._get_field_value(invoice, "InvoiceDate"),
                "due_date": self._get_field_value(invoice, "DueDate"),
                "purchase_order": self._get_field_value(invoice, "PurchaseOrder"),
                "subtotal": self._get_field_value(invoice, "SubTotal"),
                "tax": self._get_field_value(invoice, "TotalTax"),
                "total": self._get_field_value(invoice, "InvoiceTotal"),
                "amount_due": self._get_field_value(invoice, "AmountDue"),
                "line_items": self._extract_line_items(invoice),
                "confidence": invoice.confidence
            }
            invoices.append(extracted)

        return {"invoices": invoices}

    def _get_field_value(self, document, field_name):
        """Safely get field value."""
        field = document.fields.get(field_name)
        if field:
            return {
                "value": field.value if hasattr(field, "value") else field.content,
                "confidence": field.confidence
            }
        return None

    def _extract_line_items(self, invoice) -> List[dict]:
        """Extract line items from invoice."""
        items = invoice.fields.get("Items")
        if not items or not items.value:
            return []

        line_items = []
        for item in items.value:
            line_item = {}
            for field_name in ["Description", "Quantity", "Unit", "UnitPrice", "Amount"]:
                field = item.value.get(field_name)
                if field:
                    line_item[field_name.lower()] = field.value
            line_items.append(line_item)

        return line_items

    async def validate_invoice(
        self,
        extracted_invoice: dict
    ) -> dict:
        """Validate extracted invoice data."""

        prompt = f"""Validate this extracted invoice data for consistency.

Invoice Data:
{json.dumps(extracted_invoice, indent=2, default=str)}

Check for:
1. Math validation: do line items sum to subtotal?
2. Tax validation: is tax calculation reasonable?
3. Date validation: is due date after invoice date?
4. Missing required fields
5. Suspicious values

Return JSON with:
- is_valid: boolean
- issues: list of issues found
- suggestions: list of corrections"""

        response = await self.llm_client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return json.loads(response.content)
```

## Contract Analysis

```python
class ContractAnalyzer:
    """AI-powered contract analysis."""

    def __init__(self, llm_client):
        self.client = llm_client

    async def analyze_contract(
        self,
        contract_text: str
    ) -> dict:
        """Comprehensive contract analysis."""

        # Extract key sections
        sections = await self._identify_sections(contract_text)

        # Extract key terms
        key_terms = await self._extract_key_terms(contract_text)

        # Identify obligations
        obligations = await self._identify_obligations(contract_text)

        # Risk analysis
        risks = await self._analyze_risks(contract_text)

        return {
            "sections": sections,
            "key_terms": key_terms,
            "obligations": obligations,
            "risks": risks,
            "summary": await self._generate_summary(contract_text)
        }

    async def _identify_sections(self, text: str) -> List[dict]:
        """Identify contract sections."""

        prompt = f"""Identify the main sections of this contract.

Contract (first 5000 chars):
{text[:5000]}

For each section provide:
- section_name: name of the section
- start_position: approximate character position
- summary: brief summary of section content

Return as JSON array."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return json.loads(response.content)

    async def _extract_key_terms(self, text: str) -> dict:
        """Extract key contract terms."""

        prompt = f"""Extract key terms from this contract.

Contract:
{text[:8000]}

Extract:
- parties: who are the parties involved
- effective_date: when contract starts
- termination_date: when contract ends (if specified)
- payment_terms: payment amounts, schedules
- termination_clauses: how contract can be terminated
- liability_limits: any liability caps
- confidentiality: confidentiality requirements
- governing_law: applicable jurisdiction
- renewal_terms: automatic renewal provisions

Return as structured JSON."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return json.loads(response.content)

    async def _identify_obligations(self, text: str) -> List[dict]:
        """Identify contractual obligations."""

        prompt = f"""Identify contractual obligations in this contract.

Contract:
{text[:8000]}

For each obligation identify:
- party: who has the obligation
- obligation: what they must do
- deadline: when (if specified)
- conditions: any conditions
- consequences: consequences of non-compliance

Return as JSON array."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return json.loads(response.content)

    async def _analyze_risks(self, text: str) -> List[dict]:
        """Analyze contract risks."""

        prompt = f"""Analyze risks in this contract from a business perspective.

Contract:
{text[:8000]}

Identify:
1. Financial risks
2. Operational risks
3. Legal/compliance risks
4. Termination risks
5. Missing protections

For each risk provide:
- risk_type: category
- description: what the risk is
- severity: high/medium/low
- mitigation: suggested mitigation
- clause_reference: relevant contract section

Return as JSON array."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return json.loads(response.content)

    async def compare_contracts(
        self,
        contract1: str,
        contract2: str
    ) -> dict:
        """Compare two contracts."""

        prompt = f"""Compare these two contracts and identify differences.

Contract 1 (first 4000 chars):
{contract1[:4000]}

Contract 2 (first 4000 chars):
{contract2[:4000]}

Compare:
1. Payment terms differences
2. Liability differences
3. Term/duration differences
4. Termination clause differences
5. Key clause differences

Return as JSON with structured comparison."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return json.loads(response.content)
```

## Batch Processing Pipeline

```python
class BatchDocumentProcessor:
    """Process documents at scale."""

    def __init__(self, spark, config: dict):
        self.spark = spark
        self.config = config
        self.pipeline = DocumentProcessingPipeline(config)

    async def process_batch(
        self,
        input_path: str,
        output_table: str,
        parallelism: int = 10
    ):
        """Process batch of documents."""
        import asyncio
        from concurrent.futures import ThreadPoolExecutor

        # List documents
        documents = self._list_documents(input_path)

        # Process in parallel
        results = []
        semaphore = asyncio.Semaphore(parallelism)

        async def process_with_semaphore(doc_path):
            async with semaphore:
                return await self._process_single_document(doc_path)

        tasks = [process_with_semaphore(doc) for doc in documents]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Filter successful results
        successful = [r for r in results if isinstance(r, ProcessedDocument)]

        # Convert to DataFrame
        df = self._results_to_dataframe(successful)

        # Save to Delta
        df.write \
            .format("delta") \
            .mode("append") \
            .saveAsTable(output_table)

        return {
            "total": len(documents),
            "successful": len(successful),
            "failed": len(documents) - len(successful)
        }

    def _list_documents(self, path: str) -> List[str]:
        """List documents in path."""
        from azure.storage.blob import ContainerClient

        container = ContainerClient.from_connection_string(
            self.config["storage_connection"],
            self.config["container"]
        )

        return [
            blob.name
            for blob in container.list_blobs(name_starts_with=path)
            if blob.name.endswith(('.pdf', '.png', '.jpg', '.tiff'))
        ]

    async def _process_single_document(
        self,
        document_path: str
    ) -> ProcessedDocument:
        """Process single document."""
        from azure.storage.blob import BlobClient

        blob = BlobClient.from_connection_string(
            self.config["storage_connection"],
            self.config["container"],
            document_path
        )

        document_bytes = blob.download_blob().readall()

        return await self.pipeline.process_document(
            document_bytes,
            document_path
        )

    def _results_to_dataframe(
        self,
        results: List[ProcessedDocument]
    ):
        """Convert results to Spark DataFrame."""
        from pyspark.sql.types import *

        schema = StructType([
            StructField("document_id", StringType()),
            StructField("document_type", StringType()),
            StructField("raw_text", StringType()),
            StructField("structured_data", StringType()),  # JSON string
            StructField("entities", StringType()),  # JSON string
            StructField("metadata", StringType()),  # JSON string
            StructField("confidence", DoubleType())
        ])

        rows = [
            (
                r.document_id,
                r.document_type.value,
                r.raw_text,
                json.dumps(r.structured_data),
                json.dumps(r.entities),
                json.dumps(r.metadata),
                r.confidence
            )
            for r in results
        ]

        return self.spark.createDataFrame(rows, schema)

# Usage
processor = BatchDocumentProcessor(spark, {
    "form_recognizer_endpoint": "https://...",
    "form_recognizer_key": "...",
    "storage_connection": "...",
    "container": "documents",
    "llm_client": llm_client
})

# Process batch
stats = await processor.process_batch(
    input_path="invoices/2023/",
    output_table="silver.processed_invoices"
)
print(f"Processed {stats['successful']}/{stats['total']} documents")
```

Intelligent document processing transforms unstructured documents into structured, actionable data. Combining OCR, layout analysis, and LLM understanding enables automation of document-heavy business processes.
