---
title: "Multimodal RAG: Building Retrieval Systems for Images, Documents, and Text"
description: "Multimodal RAG opens up new possibilities for enterprise knowledge systems. Start with your most valuable visual content and expand from there."
author: Michael John Peña
draft: false
date: 2025-01-28
tags:
  - AI
  - RAG
  - Multimodal
  - Computer Vision
  - Azure
---

## Multimodal RAG Architecture

```
                    ┌──────────────────────────────┐
                    │         User Query           │
                    │  "Show me the architecture   │
                    │   diagram for the pipeline"  │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │     Query Understanding      │
                    │  - Text embedding            │
                    │  - Intent classification     │
                    └──────────────┬───────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
            ▼                      ▼                      ▼
    ┌───────────────┐    ┌───────────────┐    ┌───────────────┐
    │  Text Index   │    │  Image Index  │    │  Doc Index    │
    │               │    │               │    │  (PDF, etc)   │
    └───────┬───────┘    └───────┬───────┘    └───────┬───────┘
            │                    │                    │
            └──────────────────┬─┴────────────────────┘
                               │
                    ┌──────────▼───────────┐
                    │    Result Fusion     │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  Multimodal LLM      │
                    │  (GPT-4o, Gemini)    │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │    Response with     │
                    │  text + images       │
                    └──────────────────────┘
```

## Image Embedding and Indexing

```python
from azure.ai.foundry import AIFoundryClient
from azure.search.documents import SearchClient
import base64
from PIL import Image
import io

class ImageIndexer:
    def __init__(self, ai_client: AIFoundryClient, search_client: SearchClient):
        self.ai_client = ai_client
        self.search_client = search_client

    async def index_image(self, image_path: str, metadata: dict) -> str:
        """Index an image for multimodal retrieval."""

        # Load and encode image
        with open(image_path, "rb") as f:
            image_bytes = f.read()

        base64_image = base64.b64encode(image_bytes).decode("utf-8")

        # Generate image description using GPT-4o
        description = await self._describe_image(base64_image)

        # Generate text embedding of description
        text_embedding = await self._embed_text(description)

        # Generate image embedding (CLIP or similar)
        image_embedding = await self._embed_image(base64_image)

        # Index in search
        doc = {
            "id": self._generate_id(image_path),
            "type": "image",
            "path": image_path,
            "description": description,
            "text_vector": text_embedding,
            "image_vector": image_embedding,
            **metadata
        }

        self.search_client.upload_documents([doc])

        return doc["id"]

    async def _describe_image(self, base64_image: str) -> str:
        """Generate text description of image."""

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": """Describe this image in detail for search indexing.
                        Include:
                        - What type of image/diagram it is
                        - Key elements and their relationships
                        - Any text visible in the image
                        - Technical concepts shown"""
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{base64_image}"}
                    }
                ]
            }]
        )

        return response.choices[0].message.content

    async def _embed_text(self, text: str) -> list[float]:
        """Generate text embedding."""
        response = await self.ai_client.embeddings.create_async(
            deployment="text-embedding-3-large",
            input=[text]
        )
        return response.data[0].embedding

    async def _embed_image(self, base64_image: str) -> list[float]:
        """Generate image embedding using CLIP or similar."""
        # Using Azure AI Vision or custom CLIP endpoint
        # This is a placeholder - implement based on your setup
        pass
```

## PDF and Document Processing

```python
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeDocumentRequest

class DocumentIndexer:
    def __init__(
        self,
        doc_intelligence_client: DocumentIntelligenceClient,
        ai_client: AIFoundryClient,
        search_client: SearchClient
    ):
        self.doc_client = doc_intelligence_client
        self.ai_client = ai_client
        self.search_client = search_client

    async def index_pdf(self, pdf_path: str, metadata: dict) -> list[str]:
        """Index a PDF document with text and images."""

        # Extract content using Document Intelligence
        with open(pdf_path, "rb") as f:
            poller = self.doc_client.begin_analyze_document(
                model_id="prebuilt-layout",
                body=f,
                content_type="application/pdf"
            )
        result = poller.result()

        indexed_ids = []

        # Index text content by page
        for page in result.pages:
            page_text = self._extract_page_text(page, result)

            if page_text.strip():
                doc_id = await self._index_text_chunk(
                    text=page_text,
                    source=pdf_path,
                    page=page.page_number,
                    metadata=metadata
                )
                indexed_ids.append(doc_id)

        # Index tables
        for table in result.tables:
            table_text = self._table_to_text(table)
            doc_id = await self._index_text_chunk(
                text=table_text,
                source=pdf_path,
                page=table.bounding_regions[0].page_number if table.bounding_regions else 0,
                content_type="table",
                metadata=metadata
            )
            indexed_ids.append(doc_id)

        # Index figures/images
        for figure in result.figures:
            if figure.bounding_regions:
                # Extract figure image and index
                doc_id = await self._index_figure(figure, pdf_path, metadata)
                indexed_ids.append(doc_id)

        return indexed_ids

    def _extract_page_text(self, page, result) -> str:
        """Extract text content from a page."""
        lines = []
        for line in page.lines:
            lines.append(line.content)
        return "\n".join(lines)

    def _table_to_text(self, table) -> str:
        """Convert table to markdown text."""
        rows = []
        current_row = []
        current_row_idx = 0

        for cell in table.cells:
            if cell.row_index != current_row_idx:
                rows.append(" | ".join(current_row))
                current_row = []
                current_row_idx = cell.row_index
            current_row.append(cell.content)

        if current_row:
            rows.append(" | ".join(current_row))

        return "\n".join(rows)
```

## Multimodal Query Processing

```python
class MultimodalRAG:
    def __init__(
        self,
        ai_client: AIFoundryClient,
        text_index: SearchClient,
        image_index: SearchClient,
        doc_index: SearchClient
    ):
        self.ai_client = ai_client
        self.text_index = text_index
        self.image_index = image_index
        self.doc_index = doc_index

    async def query(self, user_query: str, include_images: bool = True) -> dict:
        """Process multimodal query."""

        # Generate query embedding
        query_embedding = await self._embed_text(user_query)

        # Search all indexes
        text_results = await self._search_text(query_embedding, user_query)
        doc_results = await self._search_documents(query_embedding, user_query)

        image_results = []
        if include_images:
            image_results = await self._search_images(query_embedding, user_query)

        # Combine and rerank results
        combined = self._fuse_results(text_results, doc_results, image_results)

        # Generate response with multimodal context
        response = await self._generate_response(user_query, combined)

        return {
            "query": user_query,
            "answer": response["text"],
            "sources": response["sources"],
            "images": response.get("relevant_images", [])
        }

    async def _search_images(self, query_embedding: list, query_text: str) -> list:
        """Search image index."""

        results = self.image_index.search(
            search_text=query_text,
            vector_queries=[{
                "vector": query_embedding,
                "k_nearest_neighbors": 5,
                "fields": "text_vector"
            }],
            select=["id", "path", "description", "type"]
        )

        return [
            {
                "id": r["id"],
                "path": r["path"],
                "description": r["description"],
                "type": "image",
                "score": r["@search.score"]
            }
            for r in results
        ]

    async def _generate_response(self, query: str, context: list) -> dict:
        """Generate multimodal response."""

        # Prepare context with images
        messages = [{"role": "system", "content": "Answer based on the provided context. Reference images when relevant."}]

        # Add text context
        text_context = "\n\n".join([
            f"Source: {c['source']}\n{c['content']}"
            for c in context if c["type"] in ["text", "document"]
        ])

        content_parts = [{"type": "text", "text": f"Context:\n{text_context}\n\nQuestion: {query}"}]

        # Add image context
        relevant_images = []
        for c in context:
            if c["type"] == "image":
                with open(c["path"], "rb") as f:
                    base64_img = base64.b64encode(f.read()).decode()
                content_parts.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{base64_img}"}
                })
                content_parts.append({
                    "type": "text",
                    "text": f"Image description: {c['description']}"
                })
                relevant_images.append(c["path"])

        messages.append({"role": "user", "content": content_parts})

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=messages
        )

        return {
            "text": response.choices[0].message.content,
            "sources": [c["source"] for c in context if "source" in c],
            "relevant_images": relevant_images
        }
```

## Handling Charts and Diagrams

```python
class ChartAnalyzer:
    def __init__(self, ai_client: AIFoundryClient):
        self.ai_client = ai_client

    async def analyze_chart(self, image_path: str) -> dict:
        """Extract structured data from a chart image."""

        with open(image_path, "rb") as f:
            base64_image = base64.b64encode(f.read()).decode()

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": """Analyze this chart and extract:
                        1. Chart type (bar, line, pie, etc.)
                        2. Title and labels
                        3. Data points (as JSON)
                        4. Key insights

                        Return as JSON:
                        {
                            "chart_type": "...",
                            "title": "...",
                            "x_axis": "...",
                            "y_axis": "...",
                            "data": [...],
                            "insights": ["..."]
                        }"""
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{base64_image}"}
                    }
                ]
            }]
        )

        return json.loads(response.choices[0].message.content)

    async def analyze_architecture_diagram(self, image_path: str) -> dict:
        """Extract components and relationships from architecture diagram."""

        with open(image_path, "rb") as f:
            base64_image = base64.b64encode(f.read()).decode()

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": """Analyze this architecture diagram and extract:
                        1. Components (services, databases, etc.)
                        2. Connections/data flows between components
                        3. Technologies/products shown
                        4. Overall architecture pattern

                        Return as JSON:
                        {
                            "components": [{"name": "...", "type": "...", "description": "..."}],
                            "connections": [{"from": "...", "to": "...", "description": "..."}],
                            "technologies": ["..."],
                            "pattern": "...",
                            "summary": "..."
                        }"""
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{base64_image}"}
                    }
                ]
            }]
        )

        return json.loads(response.choices[0].message.content)
```

## Best Practices

1. **Rich descriptions**: Generate detailed text descriptions for images
2. **Multiple embeddings**: Use both text and image embeddings
3. **Structured extraction**: Extract data from charts/diagrams
4. **Source attribution**: Track which images/documents answers come from
5. **Chunk wisely**: Keep related images with their context

Multimodal RAG opens up new possibilities for enterprise knowledge systems. Start with your most valuable visual content and expand from there.
