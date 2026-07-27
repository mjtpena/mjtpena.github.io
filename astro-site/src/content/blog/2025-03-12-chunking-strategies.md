---
title: "Chunking Strategies for RAG: Finding the Right Granularity"
author: Michael John Peña
draft: false
date: 2025-03-12
tags:
  - RAG
  - Chunking
  - AI
  - NLP
  - Best Practices

---

I wrote "Chunking Strategies for RAG: Finding the Right Granularity" to share practical, production-minded guidance on this topic.

## Advanced Chunking Techniques

```python
from langchain.text_splitter import (
    RecursiveCharacterTextSplitter,
    MarkdownHeaderTextSplitter,
    SemanticChunker
)
from azure.ai.openai import AzureOpenAI

class SmartChunker:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client

    def recursive_chunk(self, text: str, chunk_size: int = 1000, overlap: int = 200) -> list:
        """Basic recursive character splitting."""
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=overlap,
            separators=["\n\n", "\n", ". ", " ", ""]
        )
        return splitter.split_text(text)

    def markdown_chunk(self, markdown: str) -> list:
        """Chunk by markdown structure."""
        headers_to_split_on = [
            ("#", "Header 1"),
            ("##", "Header 2"),
            ("###", "Header 3"),
        ]
        splitter = MarkdownHeaderTextSplitter(headers_to_split_on)
        return splitter.split_text(markdown)

    def semantic_chunk(self, text: str) -> list:
        """Chunk by semantic similarity."""
        splitter = SemanticChunker(
            embeddings=self.get_embeddings,
            breakpoint_threshold_type="percentile",
            breakpoint_threshold_amount=95
        )
        return splitter.split_text(text)

    def parent_child_chunk(self, text: str) -> dict:
        """Create parent-child chunk hierarchy."""
        # Large parent chunks for context
        parent_splitter = RecursiveCharacterTextSplitter(chunk_size=2000)
        parents = parent_splitter.split_text(text)

        # Smaller child chunks for retrieval
        child_splitter = RecursiveCharacterTextSplitter(chunk_size=400)

        result = {}
        for i, parent in enumerate(parents):
            children = child_splitter.split_text(parent)
            result[f"parent_{i}"] = {
                "text": parent,
                "children": children
            }
        return result

    async def agentic_chunk(self, text: str) -> list:
        """Use LLM to identify natural chunk boundaries."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": "Identify natural semantic boundaries in this text. Return split points."
            }, {
                "role": "user",
                "content": text
            }]
        )
        boundaries = self.parse_boundaries(response)
        return self.split_at_boundaries(text, boundaries)
```

Choose chunking strategy based on document structure and retrieval requirements.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
