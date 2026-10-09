---
title: "Azure Document Intelligence: Table Extraction and Analysis"
description: "Table extraction transforms static reports into queryable data. Combine extracted tables with LLM analysis to answer questions about financial statements…"
author: Michael John Peña
draft: false
date: 2025-09-20
tags:
  - Azure
  - Document Intelligence
  - Table Extraction
  - Data Processing
  - Python
---

## Table Extraction Basics

```python
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeResult
from azure.core.credentials import AzureKeyCredential
import pandas as pd
import os

client = DocumentIntelligenceClient(
    endpoint=os.environ["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"],
    credential=AzureKeyCredential(os.environ["AZURE_DOCUMENT_INTELLIGENCE_KEY"])
)

def extract_tables(document_url: str) -> list[pd.DataFrame]:
    """Extract all tables from a document as DataFrames."""

    poller = client.begin_analyze_document(
        model_id="prebuilt-layout",
        analyze_request={"urlSource": document_url}
    )
    result: AnalyzeResult = poller.result()

    dataframes = []

    for table in result.tables:
        # Initialize empty grid
        rows = table.row_count
        cols = table.column_count
        grid = [[None for _ in range(cols)] for _ in range(rows)]

        # Fill grid with cell content
        for cell in table.cells:
            row_idx = cell.row_index
            col_idx = cell.column_index
            content = cell.content

            # Handle merged cells (spans)
            row_span = cell.row_span or 1
            col_span = cell.column_span or 1

            for r in range(row_span):
                for c in range(col_span):
                    if row_idx + r < rows and col_idx + c < cols:
                        grid[row_idx + r][col_idx + c] = content

        # Convert to DataFrame
        df = pd.DataFrame(grid[1:], columns=grid[0] if grid else None)
        df.attrs["confidence"] = sum(c.confidence for c in table.cells) / len(table.cells)
        df.attrs["page_number"] = table.bounding_regions[0].page_number if table.bounding_regions else 1

        dataframes.append(df)

    return dataframes
```

## Handling Complex Table Structures

```python
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class TableMetadata:
    page_number: int
    row_count: int
    column_count: int
    has_headers: bool
    confidence: float
    bounding_box: List[float]

def analyze_table_structure(table) -> TableMetadata:
    """Analyze table structure for processing decisions."""

    # Check if first row appears to be headers
    header_cells = [c for c in table.cells if c.row_index == 0]
    has_headers = all(
        c.kind == "columnHeader" or (c.content and c.content.isupper())
        for c in header_cells
    )

    return TableMetadata(
        page_number=table.bounding_regions[0].page_number if table.bounding_regions else 1,
        row_count=table.row_count,
        column_count=table.column_count,
        has_headers=has_headers,
        confidence=sum(c.confidence for c in table.cells) / len(table.cells),
        bounding_box=table.bounding_regions[0].polygon if table.bounding_regions else []
    )

def extract_tables_with_context(document_url: str) -> List[dict]:
    """Extract tables with surrounding context for better understanding."""

    poller = client.begin_analyze_document(
        model_id="prebuilt-layout",
        analyze_request={"urlSource": document_url}
    )
    result: AnalyzeResult = poller.result()

    tables_with_context = []

    for i, table in enumerate(result.tables):
        metadata = analyze_table_structure(table)

        # Find paragraphs near this table (potential captions)
        nearby_text = []
        if result.paragraphs:
            table_top = min(p.y for p in table.bounding_regions[0].polygon) if table.bounding_regions else 0
            for para in result.paragraphs:
                if para.bounding_regions:
                    para_bottom = max(p.y for p in para.bounding_regions[0].polygon)
                    # Check if paragraph is just above table
                    if abs(para_bottom - table_top) < 50:
                        nearby_text.append(para.content)

        tables_with_context.append({
            "index": i,
            "metadata": metadata,
            "caption": nearby_text[0] if nearby_text else None,
            "dataframe": extract_single_table(table)
        })

    return tables_with_context
```

Table extraction transforms static reports into queryable data. Combine extracted tables with LLM analysis to answer questions about financial statements, research papers, and technical specifications.
