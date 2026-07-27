---
title: "Table Extraction with AI: From Images to Structured Data"
author: Michael John Peña
draft: false
date: 2025-04-20
tags:
  - AI
  - Tables
  - Extraction
  - OCR
  - Data

---

I wrote "Table Extraction with AI: From Images to Structured Data" to share practical, production-minded guidance on this topic.

## Table Extraction Pipeline

```python
from azure.ai.openai import AzureOpenAI
from azure.ai.documentintelligence import DocumentIntelligenceClient
import pandas as pd
import base64

class TableExtractor:
    def __init__(self, openai_client: AzureOpenAI, doc_client: DocumentIntelligenceClient):
        self.openai = openai_client
        self.doc_intelligence = doc_client

    async def extract_from_image(self, image_bytes: bytes) -> pd.DataFrame:
        """Extract table from image using vision model."""
        image_b64 = base64.b64encode(image_bytes).decode()

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": """Extract the table from this image.
                        Return as JSON with format:
                        {
                            "headers": ["col1", "col2", ...],
                            "rows": [["val1", "val2", ...], ...]
                        }
                        Preserve all data accurately."""
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{image_b64}"}
                    }
                ]
            }],
            response_format={"type": "json_object"}
        )

        table_data = json.loads(response.choices[0].message.content)
        return pd.DataFrame(table_data["rows"], columns=table_data["headers"])

    async def extract_from_pdf(self, pdf_bytes: bytes) -> list[pd.DataFrame]:
        """Extract all tables from PDF."""
        result = self.doc_intelligence.begin_analyze_document(
            "prebuilt-layout",
            pdf_bytes
        ).result()

        tables = []
        for table in result.tables:
            df = self.table_to_dataframe(table)
            tables.append(df)

        return tables

    def table_to_dataframe(self, table) -> pd.DataFrame:
        """Convert Document Intelligence table to DataFrame."""
        # Initialize empty grid
        data = [[None] * table.column_count for _ in range(table.row_count)]

        # Fill in cells
        for cell in table.cells:
            data[cell.row_index][cell.column_index] = cell.content

        # Use first row as headers if it's a header row
        if table.cells and table.cells[0].kind == "columnHeader":
            headers = data[0]
            data = data[1:]
        else:
            headers = [f"Column_{i}" for i in range(table.column_count)]

        return pd.DataFrame(data, columns=headers)

    async def normalize_table(self, df: pd.DataFrame, schema: dict) -> pd.DataFrame:
        """Normalize table data using AI."""
        # Convert to string representation
        table_str = df.to_string()

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": f"""Normalize this table data to match the schema: {schema}
                - Convert dates to ISO format
                - Standardize numbers (remove currency symbols, commas)
                - Map column names to schema fields
                Return as JSON array of objects."""
            }, {
                "role": "user",
                "content": table_str
            }],
            response_format={"type": "json_object"}
        )

        normalized = json.loads(response.choices[0].message.content)
        return pd.DataFrame(normalized["data"])

    async def merge_tables(self, tables: list[pd.DataFrame], description: str) -> pd.DataFrame:
        """Intelligently merge multiple tables."""
        tables_str = "\n\n".join([f"Table {i}:\n{t.to_string()}" for i, t in enumerate(tables)])

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": "Merge these tables intelligently. Identify common keys and combine data."
            }, {
                "role": "user",
                "content": f"Description: {description}\n\n{tables_str}"
            }],
            response_format={"type": "json_object"}
        )

        merged = json.loads(response.choices[0].message.content)
        return pd.DataFrame(merged["data"])
```

AI-powered table extraction handles complex layouts and normalizes data automatically.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
