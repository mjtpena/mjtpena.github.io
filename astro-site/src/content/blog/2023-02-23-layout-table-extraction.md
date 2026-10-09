---
title: "Document Layout Analysis and Table Extraction with Azure AI"
author: Michael John Peña
draft: false
date: 2023-02-23
tags:
  - Azure
  - Document Intelligence
  - Tables
  - Layout
  - AI
---

## Layout Analysis Basics

```python
from azure.ai.formrecognizer import DocumentAnalysisClient
from azure.core.credentials import AzureKeyCredential

client = DocumentAnalysisClient(
    endpoint="https://your-resource.cognitiveservices.azure.com/",
    credential=AzureKeyCredential("your-key")
)

def analyze_layout(file_path: str) -> dict:
    """Analyze document layout."""

    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-layout", f)
    result = poller.result()

    layout = {
        "pages": [],
        "tables": [],
        "paragraphs": [],
        "styles": []
    }

    # Process pages
    for page in result.pages:
        page_info = {
            "page_number": page.page_number,
            "width": page.width,
            "height": page.height,
            "unit": page.unit,
            "lines": [],
            "words": [],
            "selection_marks": []
        }

        for line in page.lines:
            page_info["lines"].append({
                "content": line.content,
                "bounding_box": line.polygon
            })

        for word in page.words:
            page_info["words"].append({
                "content": word.content,
                "confidence": word.confidence
            })

        if page.selection_marks:
            for mark in page.selection_marks:
                page_info["selection_marks"].append({
                    "state": mark.state,
                    "confidence": mark.confidence
                })

        layout["pages"].append(page_info)

    # Process tables
    for table in result.tables:
        layout["tables"].append(extract_table(table))

    # Process paragraphs
    for para in result.paragraphs:
        layout["paragraphs"].append({
            "content": para.content,
            "role": para.role,
            "bounding_regions": [
                {"page": r.page_number}
                for r in para.bounding_regions
            ] if para.bounding_regions else []
        })

    return layout
```

## Table Extraction

```python
import pandas as pd

def extract_table(table) -> dict:
    """Extract table data."""
    table_data = {
        "row_count": table.row_count,
        "column_count": table.column_count,
        "cells": [],
        "spans": []
    }

    for cell in table.cells:
        cell_info = {
            "row": cell.row_index,
            "column": cell.column_index,
            "content": cell.content,
            "kind": cell.kind,  # "content", "rowHeader", "columnHeader", etc.
            "row_span": cell.row_span,
            "column_span": cell.column_span
        }
        table_data["cells"].append(cell_info)

        # Track spans
        if cell.row_span > 1 or cell.column_span > 1:
            table_data["spans"].append({
                "row": cell.row_index,
                "column": cell.column_index,
                "row_span": cell.row_span,
                "column_span": cell.column_span
            })

    return table_data

def table_to_dataframe(table) -> pd.DataFrame:
    """Convert extracted table to pandas DataFrame."""

    # Initialize grid
    grid = [[None] * table.column_count for _ in range(table.row_count)]

    # Fill grid with cell contents
    for cell in table.cells:
        grid[cell.row_index][cell.column_index] = cell.content

        # Handle spans
        if cell.row_span > 1 or cell.column_span > 1:
            for r in range(cell.row_index, cell.row_index + cell.row_span):
                for c in range(cell.column_index, cell.column_index + cell.column_span):
                    if r < table.row_count and c < table.column_count:
                        grid[r][c] = cell.content

    # Determine if first row is header
    header_row = None
    for cell in table.cells:
        if cell.row_index == 0 and cell.kind in ["columnHeader", "rowHeader"]:
            header_row = grid[0]
            break

    if header_row:
        df = pd.DataFrame(grid[1:], columns=header_row)
    else:
        df = pd.DataFrame(grid)

    return df

def extract_all_tables(file_path: str) -> list:
    """Extract all tables from document as DataFrames."""

    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-layout", f)
    result = poller.result()

    dataframes = []
    for i, table in enumerate(result.tables):
        df = table_to_dataframe(table)
        dataframes.append({
            "table_index": i,
            "page": table.bounding_regions[0].page_number if table.bounding_regions else None,
            "rows": table.row_count,
            "columns": table.column_count,
            "dataframe": df
        })

    return dataframes
```

## Structured Document Parsing

```python
class StructuredDocumentParser:
    """Parse documents with known structure."""

    def __init__(self, client):
        self.client = client

    def parse_report(self, file_path: str) -> dict:
        """Parse a structured report."""

        with open(file_path, "rb") as f:
            poller = self.client.begin_analyze_document("prebuilt-layout", f)
        result = poller.result()

        report = {
            "title": None,
            "sections": [],
            "tables": [],
            "figures": []
        }

        current_section = None

        for para in result.paragraphs:
            role = para.role

            if role == "title":
                report["title"] = para.content

            elif role == "sectionHeading":
                if current_section:
                    report["sections"].append(current_section)
                current_section = {
                    "heading": para.content,
                    "content": []
                }

            elif role in ["paragraph", None]:
                if current_section:
                    current_section["content"].append(para.content)
                else:
                    # Content before first section
                    report.setdefault("introduction", []).append(para.content)

        if current_section:
            report["sections"].append(current_section)

        # Add tables
        for table in result.tables:
            report["tables"].append(table_to_dataframe(table))

        return report

    def extract_section(
        self,
        result,
        section_title: str
    ) -> dict:
        """Extract a specific section by title."""

        in_section = False
        section_content = []

        for para in result.paragraphs:
            if para.role == "sectionHeading":
                if section_title.lower() in para.content.lower():
                    in_section = True
                elif in_section:
                    break  # Reached next section

            elif in_section:
                section_content.append(para.content)

        return {
            "title": section_title,
            "content": section_content
        }
```

## Complex Table Handling

```python
class TableProcessor:
    """Handle complex table scenarios."""

    @staticmethod
    def merge_split_tables(tables: list, threshold: float = 50) -> list:
        """Merge tables that span across pages."""
        if len(tables) < 2:
            return tables

        merged = []
        current_table = tables[0]

        for next_table in tables[1:]:
            # Check if tables should be merged
            if TableProcessor._should_merge(current_table, next_table, threshold):
                current_table = TableProcessor._merge_tables(current_table, next_table)
            else:
                merged.append(current_table)
                current_table = next_table

        merged.append(current_table)
        return merged

    @staticmethod
    def _should_merge(table1, table2, threshold) -> bool:
        """Determine if tables should be merged."""
        # Same column count suggests same table
        if table1.column_count != table2.column_count:
            return False

        # Check if on consecutive pages
        if table2.bounding_regions and table1.bounding_regions:
            page1 = table1.bounding_regions[0].page_number
            page2 = table2.bounding_regions[0].page_number
            if page2 - page1 != 1:
                return False

        return True

    @staticmethod
    def _merge_tables(table1, table2) -> dict:
        """Merge two tables."""
        df1 = table_to_dataframe(table1)
        df2 = table_to_dataframe(table2)

        # If df2 has same columns as df1, append rows
        if list(df1.columns) == list(df2.columns):
            merged_df = pd.concat([df1, df2], ignore_index=True)
        else:
            merged_df = pd.concat([df1, df2], ignore_index=True)

        return merged_df

    @staticmethod
    def extract_nested_headers(table) -> dict:
        """Extract multi-level headers from table."""
        headers = {"levels": [], "mapping": {}}

        # Find all header rows
        header_rows = set()
        for cell in table.cells:
            if cell.kind in ["columnHeader"]:
                header_rows.add(cell.row_index)

        header_rows = sorted(header_rows)

        for level, row_idx in enumerate(header_rows):
            level_headers = []
            for cell in table.cells:
                if cell.row_index == row_idx:
                    level_headers.append({
                        "column": cell.column_index,
                        "content": cell.content,
                        "span": cell.column_span
                    })
            headers["levels"].append(level_headers)

        return headers
```

## Visualization

```python
from PIL import Image, ImageDraw
import io

def visualize_layout(file_path: str, output_path: str):
    """Visualize detected layout elements."""

    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-layout", f)
    result = poller.result()

    # For PDF, you'd need to convert to image first
    # This example assumes image input

    with Image.open(file_path) as img:
        draw = ImageDraw.Draw(img)

        for page in result.pages:
            # Draw text lines in blue
            for line in page.lines:
                if line.polygon:
                    points = [(p.x, p.y) for p in line.polygon]
                    draw.polygon(points, outline="blue")

        # Draw tables in green
        for table in result.tables:
            if table.bounding_regions:
                for region in table.bounding_regions:
                    if region.polygon:
                        points = [(p.x, p.y) for p in region.polygon]
                        draw.polygon(points, outline="green", width=2)

        img.save(output_path)
```

## Best Practices

1. **Use layout for structure**: When you need document organization
2. **Handle multi-page tables**: Merge tables split across pages
3. **Validate table structure**: Check row/column counts
4. **Consider nested headers**: Multi-level headers are common
5. **Export to appropriate formats**: CSV, Excel, DataFrame

## Resources

- [Layout Model](https://learn.microsoft.com/azure/ai-services/document-intelligence/concept-layout)
- [Table Extraction](https://learn.microsoft.com/azure/ai-services/document-intelligence/concept-layout#tables)
- [Document Roles](https://learn.microsoft.com/azure/ai-services/document-intelligence/concept-layout#paragraph-roles)
