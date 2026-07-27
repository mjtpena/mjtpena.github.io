---
title: "Multimodal RAG: Retrieval Across Text, Images, and Documents"
author: Michael John Peña
draft: false
date: 2025-04-18
tags:
  - RAG
  - Multimodal
  - AI
  - Images
  - Documents

---

I wrote "Multimodal RAG: Retrieval Across Text, Images, and Documents" to share practical, production-minded guidance on this topic.

## Multimodal RAG Pipeline

```python
from azure.ai.openai import AzureOpenAI
from azure.ai.documentintelligence import DocumentIntelligenceClient
import base64
from typing import Union

class MultimodalRAG:
    def __init__(self, openai_client: AzureOpenAI, doc_client: DocumentIntelligenceClient):
        self.openai = openai_client
        self.doc_intelligence = doc_client
        self.vector_store = VectorStore()

    async def process_document(self, file_bytes: bytes, file_type: str) -> list[dict]:
        """Process document and extract multimodal content."""
        if file_type == "pdf":
            return await self.process_pdf(file_bytes)
        elif file_type in ["png", "jpg", "jpeg"]:
            return await self.process_image(file_bytes)
        else:
            return await self.process_text(file_bytes.decode())

    async def process_pdf(self, pdf_bytes: bytes) -> list[dict]:
        """Extract text, tables, and images from PDF."""
        # Use Document Intelligence for extraction
        result = self.doc_intelligence.begin_analyze_document(
            "prebuilt-layout",
            pdf_bytes,
            output_content_format="markdown"
        ).result()

        chunks = []

        # Process text content
        for paragraph in result.paragraphs:
            chunks.append({
                "type": "text",
                "content": paragraph.content,
                "page": paragraph.bounding_regions[0].page_number
            })

        # Process tables
        for table in result.tables:
            table_md = self.table_to_markdown(table)
            chunks.append({
                "type": "table",
                "content": table_md,
                "page": table.bounding_regions[0].page_number
            })

        # Process figures/images
        for figure in result.figures:
            if figure.elements:
                # Get image bytes and create description
                description = await self.describe_figure(figure)
                chunks.append({
                    "type": "image",
                    "content": description,
                    "page": figure.bounding_regions[0].page_number
                })

        return chunks

    async def describe_figure(self, figure) -> str:
        """Generate description for extracted figure."""
        # Convert figure to image bytes
        image_b64 = base64.b64encode(figure.data).decode()

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": "Describe this figure in detail, including any data or relationships shown."},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}}
                ]
            }]
        )
        return response.choices[0].message.content

    async def embed_multimodal(self, chunks: list[dict]) -> list[dict]:
        """Generate embeddings for multimodal content."""
        for chunk in chunks:
            if chunk["type"] == "text":
                embedding = await self.get_text_embedding(chunk["content"])
            elif chunk["type"] == "table":
                # Embed table with summary
                summary = await self.summarize_table(chunk["content"])
                embedding = await self.get_text_embedding(summary)
            else:  # image
                embedding = await self.get_text_embedding(chunk["content"])

            chunk["embedding"] = embedding

        return chunks

    async def query(self, question: str, include_images: bool = True) -> str:
        """Query multimodal knowledge base."""
        query_embedding = await self.get_text_embedding(question)
        results = self.vector_store.search(query_embedding, top_k=10)

        # Build multimodal context
        context = self.build_context(results, include_images)

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "Answer based on the provided context."},
                {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"}
            ]
        )
        return response.choices[0].message.content
```

Multimodal RAG unlocks intelligence from documents containing text, tables, and images.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
