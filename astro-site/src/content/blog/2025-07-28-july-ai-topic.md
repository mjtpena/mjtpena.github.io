---
title: "Multimodal RAG: Combining Text, Images, and Tables for Enhanced Search"
description: "Multimodal RAG ensures users find relevant information regardless of how it's represented in the source documents."
author: Michael John Peña
draft: false
date: 2025-07-28
tags:
  - Multimodal AI
  - RAG
  - Computer Vision
  - Azure AI Search
  - Python
---

## Processing Multimodal Documents

Use GPT-4o to extract structured content from complex documents:

```python
from openai import AzureOpenAI
from azure.ai.documentintelligence import DocumentIntelligenceClient
import base64

class MultimodalProcessor:
    def __init__(self, openai_client: AzureOpenAI, doc_intel_client: DocumentIntelligenceClient):
        self.llm = openai_client
        self.doc_intel = doc_intel_client

    async def process_document(self, pdf_bytes: bytes) -> dict:
        # Extract structure with Document Intelligence
        poller = self.doc_intel.begin_analyze_document(
            "prebuilt-layout",
            pdf_bytes,
            output_content_format="markdown"
        )
        result = poller.result()

        extracted_content = {
            "text_chunks": [],
            "tables": [],
            "figures": []
        }

        # Process tables
        for table in result.tables:
            table_markdown = self._table_to_markdown(table)
            description = await self._describe_table(table_markdown)
            extracted_content["tables"].append({
                "content": table_markdown,
                "description": description,
                "page": table.bounding_regions[0].page_number
            })

        # Process figures/images
        for figure in result.figures:
            image_data = self._extract_figure_image(pdf_bytes, figure)
            description = await self._describe_image(image_data)
            extracted_content["figures"].append({
                "description": description,
                "caption": figure.caption.content if figure.caption else None,
                "page": figure.bounding_regions[0].page_number
            })

        return extracted_content

    async def _describe_image(self, image_base64: str) -> str:
        response = await self.llm.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": "Describe this image in detail for search indexing:"},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_base64}"}}
                ]
            }],
            max_tokens=500
        )
        return response.choices[0].message.content
```

## Indexing Multimodal Content

Create unified embeddings for all content types:

```python
async def create_multimodal_index(self, processed_doc: dict) -> list[dict]:
    index_entries = []

    # Index text chunks
    for chunk in processed_doc["text_chunks"]:
        embedding = await self.get_embedding(chunk["content"])
        index_entries.append({
            "type": "text",
            "content": chunk["content"],
            "embedding": embedding
        })

    # Index table descriptions
    for table in processed_doc["tables"]:
        embedding = await self.get_embedding(table["description"])
        index_entries.append({
            "type": "table",
            "content": table["content"],
            "description": table["description"],
            "embedding": embedding
        })

    # Index figure descriptions
    for figure in processed_doc["figures"]:
        embedding = await self.get_embedding(figure["description"])
        index_entries.append({
            "type": "figure",
            "description": figure["description"],
            "embedding": embedding
        })

    return index_entries
```

Multimodal RAG ensures users find relevant information regardless of how it's represented in the source documents.
