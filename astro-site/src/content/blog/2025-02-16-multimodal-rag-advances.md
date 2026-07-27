---
title: "Multimodal RAG Advances: Images, Documents, and Beyond"
author: Michael John Peña
draft: false
date: 2025-02-16
tags:
  - AI
  - RAG
  - Multimodal
  - Computer Vision
  - Azure

---

I wrote "Multimodal RAG Advances: Images, Documents, and Beyond" to share practical, production-minded guidance on this topic.

## Multimodal Embedding Strategies

```python
from azure.ai.foundry import AIFoundryClient
import base64

class MultimodalEmbedder:
    """Generate embeddings for multiple content types."""

    def __init__(self, ai_client: AIFoundryClient):
        self.ai_client = ai_client

    async def embed_text(self, text: str) -> list[float]:
        """Embed text content."""
        response = await self.ai_client.embeddings.create_async(
            deployment="text-embedding-3-large",
            input=[text],
            dimensions=1024
        )
        return response.data[0].embedding

    async def embed_image(self, image_path: str) -> list[float]:
        """Embed image via description-based approach."""
        # Generate detailed image description
        description = await self._describe_image(image_path)

        # Embed the description
        return await self.embed_text(description)

    async def embed_image_native(self, image_path: str) -> list[float]:
        """Embed image using native multimodal embedding (if available)."""
        # Some models support direct image embedding
        with open(image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode()

        response = await self.ai_client.embeddings.create_async(
            deployment="multimodal-embedding",
            input=[{"type": "image", "data": image_data}]
        )
        return response.data[0].embedding

    async def embed_document_page(self, page_image: str, page_text: str) -> dict:
        """Create hybrid embedding for document page."""
        # Text embedding
        text_emb = await self.embed_text(page_text) if page_text else None

        # Visual embedding (captures layout, charts, etc.)
        visual_emb = await self.embed_image(page_image)

        # Combined representation
        return {
            "text_embedding": text_emb,
            "visual_embedding": visual_emb,
            "combined_embedding": self._combine_embeddings(text_emb, visual_emb)
        }

    def _combine_embeddings(self, text_emb: list, visual_emb: list) -> list:
        """Combine text and visual embeddings."""
        if text_emb is None:
            return visual_emb
        if visual_emb is None:
            return text_emb

        # Weighted average
        import numpy as np
        text_weight, visual_weight = 0.7, 0.3
        combined = np.array(text_emb) * text_weight + np.array(visual_emb) * visual_weight
        return combined.tolist()
```

## Late Fusion Multimodal Search

```python
class LateFusionMultimodalSearch:
    """Search text and images separately, then fuse results."""

    def __init__(self, text_index, image_index, embedder):
        self.text_index = text_index
        self.image_index = image_index
        self.embedder = embedder

    async def search(
        self,
        query: str,
        include_images: bool = True,
        top_k: int = 10
    ) -> list[dict]:
        """Search with late fusion of text and image results."""

        # Embed query
        query_embedding = await self.embedder.embed_text(query)

        # Search both indexes
        text_results = await self.text_index.search(query_embedding, top_k=top_k)

        image_results = []
        if include_images:
            image_results = await self.image_index.search(query_embedding, top_k=top_k)

        # Fuse results
        all_results = []

        for r in text_results:
            all_results.append({
                **r,
                "content_type": "text",
                "fusion_score": r["score"]
            })

        for r in image_results:
            # Images may have lower scores but high visual relevance
            all_results.append({
                **r,
                "content_type": "image",
                "fusion_score": r["score"] * 0.9  # Slight discount
            })

        # Sort by fusion score
        all_results.sort(key=lambda x: x["fusion_score"], reverse=True)

        return all_results[:top_k]
```

## Chart and Diagram Understanding

```python
class ChartRAG:
    """RAG system specialized for charts and diagrams."""

    def __init__(self, ai_client: AIFoundryClient, index_client):
        self.ai_client = ai_client
        self.index = index_client

    async def index_chart(self, chart_path: str, metadata: dict) -> str:
        """Index a chart with extracted data and description."""

        # Extract chart data
        chart_data = await self._extract_chart_data(chart_path)

        # Generate searchable description
        description = await self._generate_description(chart_path, chart_data)

        # Create index entry
        doc = {
            "id": metadata.get("id", str(uuid.uuid4())),
            "type": "chart",
            "path": chart_path,
            "chart_type": chart_data["type"],
            "title": chart_data.get("title", ""),
            "data_summary": chart_data["summary"],
            "description": description,
            "extracted_data": json.dumps(chart_data["data"]),
            "embedding": await self.embedder.embed_text(description)
        }

        self.index.upload_documents([doc])
        return doc["id"]

    async def _extract_chart_data(self, chart_path: str) -> dict:
        """Extract structured data from chart."""

        with open(chart_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode()

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": """Extract all data from this chart.
                    Return JSON with:
                    - type: chart type
                    - title: chart title
                    - x_axis: x-axis label
                    - y_axis: y-axis label
                    - data: array of data points
                    - summary: brief text summary of key insights"""},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_data}"}}
                ]
            }]
        )

        return json.loads(response.choices[0].message.content)

    async def answer_chart_question(self, question: str) -> dict:
        """Answer questions about indexed charts."""

        # Search for relevant charts
        query_embedding = await self.embedder.embed_text(question)
        results = await self.index.search(
            query_embedding,
            filter="type eq 'chart'",
            top_k=3
        )

        if not results:
            return {"answer": "No relevant charts found.", "charts": []}

        # Build context with chart data
        context_parts = []
        chart_images = []

        for r in results:
            context_parts.append(f"Chart: {r['title']}\nData: {r['extracted_data']}\nSummary: {r['data_summary']}")
            chart_images.append(r["path"])

        # Answer with context
        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "system",
                "content": f"Answer based on these charts:\n\n" + "\n\n".join(context_parts)
            }, {
                "role": "user",
                "content": question
            }]
        )

        return {
            "answer": response.choices[0].message.content,
            "charts": chart_images,
            "sources": [r["id"] for r in results]
        }
```

## Document Layout Understanding

```python
class LayoutAwareRAG:
    """RAG that understands document layout and structure."""

    def __init__(self, doc_intelligence_client, ai_client, index_client):
        self.doc_client = doc_intelligence_client
        self.ai_client = ai_client
        self.index = index_client

    async def index_document(self, doc_path: str) -> list[str]:
        """Index document with layout understanding."""

        # Extract with layout analysis
        with open(doc_path, "rb") as f:
            result = self.doc_client.begin_analyze_document(
                "prebuilt-layout", f
            ).result()

        indexed_ids = []

        # Process each page
        for page in result.pages:
            page_content = self._extract_page_content(page, result)

            # Identify semantic regions
            regions = self._identify_regions(page_content)

            # Index each region
            for region in regions:
                doc_id = await self._index_region(region, doc_path, page.page_number)
                indexed_ids.append(doc_id)

        return indexed_ids

    def _identify_regions(self, page_content: dict) -> list[dict]:
        """Identify semantic regions in page."""

        regions = []

        # Headers
        for header in page_content.get("headers", []):
            regions.append({
                "type": "header",
                "content": header["text"],
                "level": header.get("level", 1)
            })

        # Paragraphs
        for para in page_content.get("paragraphs", []):
            regions.append({
                "type": "paragraph",
                "content": para["text"]
            })

        # Tables
        for table in page_content.get("tables", []):
            regions.append({
                "type": "table",
                "content": self._table_to_markdown(table),
                "headers": table.get("column_headers", [])
            })

        # Figures
        for figure in page_content.get("figures", []):
            regions.append({
                "type": "figure",
                "content": figure.get("caption", ""),
                "image_path": figure.get("image_path")
            })

        return regions

    async def search_with_layout(self, query: str, region_types: list = None) -> list[dict]:
        """Search with optional filtering by region type."""

        query_embedding = await self.embedder.embed_text(query)

        filter_str = None
        if region_types:
            filter_str = " or ".join([f"type eq '{t}'" for t in region_types])

        results = await self.index.search(
            query_embedding,
            filter=filter_str,
            top_k=10
        )

        return results
```

## Best Practices for Multimodal RAG

1. **Rich image descriptions**: Generate detailed text descriptions for visual content
2. **Preserve structure**: Maintain document layout information
3. **Multiple embeddings**: Consider separate text and visual embeddings
4. **Chart data extraction**: Store extracted data alongside visual embeddings
5. **Hybrid retrieval**: Combine visual and textual search
6. **Quality filtering**: Filter low-quality or irrelevant images

Multimodal RAG unlocks knowledge trapped in visual formats. Start with document-heavy use cases where diagrams and charts carry critical information.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
