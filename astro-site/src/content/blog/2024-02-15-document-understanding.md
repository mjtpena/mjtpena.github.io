---
title: "Document Understanding with AI: From Images to Insights"
author: Michael John Peña
draft: false
date: 2024-02-15
tags:
  - Document Understanding
  - Azure AI
  - GPT-4 Vision
  - Document Intelligence
  - OCR
---

## Azure Document Intelligence + GPT-4

```python
from azure.ai.documentintelligence import DocumentIntelligenceClient
from openai import AzureOpenAI

doc_client = DocumentIntelligenceClient(endpoint="...", credential=credential)
openai_client = AzureOpenAI(...)

async def process_document(document_path: str, query: str) -> dict:
    """Process document with Document Intelligence and GPT-4."""

    # Extract with Document Intelligence
    with open(document_path, "rb") as f:
        poller = doc_client.begin_analyze_document("prebuilt-document", f)
        result = poller.result()

    # Structure extracted content
    extracted_text = "\n".join([
        para.content for page in result.pages
        for para in page.get("paragraphs", [])
    ])

    # Analyze with GPT-4
    response = openai_client.chat.completions.create(
        model="gpt-4-turbo",
        messages=[
            {"role": "system", "content": "You analyze documents and answer questions."},
            {"role": "user", "content": f"Document:\n{extracted_text}\n\nQuestion: {query}"}
        ]
    )

    return {
        "extracted_text": extracted_text,
        "answer": response.choices[0].message.content,
        "tables": [t.to_dict() for t in result.tables] if result.tables else []
    }
```

## Layout-Aware Processing

```python
def process_with_layout(document_path: str) -> dict:
    """Process document preserving layout information."""

    with open(document_path, "rb") as f:
        poller = doc_client.begin_analyze_document("prebuilt-layout", f)
        result = poller.result()

    structured_content = {
        "pages": [],
        "tables": [],
        "key_value_pairs": []
    }

    for page in result.pages:
        page_content = {
            "page_number": page.page_number,
            "paragraphs": [],
            "lines": []
        }

        for line in page.lines:
            page_content["lines"].append({
                "text": line.content,
                "bounding_box": line.polygon
            })

        structured_content["pages"].append(page_content)

    return structured_content
```

## Table Extraction

```python
def extract_tables(document_path: str) -> list[dict]:
    """Extract tables from document."""

    with open(document_path, "rb") as f:
        poller = doc_client.begin_analyze_document("prebuilt-layout", f)
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
                "content": cell.content
            })

        tables.append(table_data)

    return tables
```

## Best Practices

1. **Choose the right model** - prebuilt-invoice, prebuilt-receipt, or prebuilt-document
2. **Handle multi-page** - Process pages appropriately
3. **Preserve layout** - Use bounding boxes for spatial understanding
4. **Combine with LLM** - GPT-4 for reasoning over extracted content
5. **Validate extractions** - Confidence scores indicate reliability

## Conclusion

Document understanding pipelines combine specialized extraction with LLM reasoning for powerful document automation.
