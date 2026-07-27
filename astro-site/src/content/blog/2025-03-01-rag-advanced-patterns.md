---
title: "RAG Advanced Patterns: Beyond Basic Retrieval"
author: Michael John Peña
draft: false
date: 2025-03-01
tags:
  - AI
  - RAG
  - Retrieval
  - Patterns
  - Architecture

---

I wrote "RAG Advanced Patterns: Beyond Basic Retrieval" to share practical, production-minded guidance on this topic.

## Advanced RAG Architecture

```python
from azure.search.documents import SearchClient
from azure.ai.openai import AzureOpenAI
import numpy as np

class AdvancedRAGPipeline:
    def __init__(self, search_client: SearchClient, openai_client: AzureOpenAI):
        self.search = search_client
        self.openai = openai_client
        self.reranker = CrossEncoderReranker()

    async def query(self, question: str) -> str:
        # Step 1: Query transformation
        expanded_queries = await self.expand_query(question)

        # Step 2: Hybrid retrieval
        candidates = []
        for q in expanded_queries:
            results = await self.hybrid_search(q)
            candidates.extend(results)

        # Step 3: Reranking
        reranked = self.reranker.rerank(question, candidates, top_k=10)

        # Step 4: Context compression
        compressed = await self.compress_context(reranked)

        # Step 5: Generation with citations
        return await self.generate_with_citations(question, compressed)

    async def expand_query(self, question: str) -> list[str]:
        """Generate multiple query variations."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": "Generate 3 different ways to ask this question for search."
            }, {
                "role": "user",
                "content": question
            }]
        )
        return [question] + parse_queries(response)

    async def hybrid_search(self, query: str) -> list:
        """Combine vector, keyword, and semantic search."""
        return self.search.search(
            search_text=query,
            vector_queries=[self.get_vector_query(query)],
            query_type="semantic",
            semantic_configuration_name="default"
        )
```

Advanced RAG combines query expansion, hybrid retrieval, reranking, and context compression for better results.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
