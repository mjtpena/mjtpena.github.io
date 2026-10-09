---
title: "Reranking Strategies: Improving RAG Precision"
description: "Cross-encoder reranking typically improves RAG precision by 10-20%."
author: Michael John Peña
draft: false
date: 2025-03-14
tags:
  - RAG
  - Reranking
  - AI
  - Search
  - Precision
---

## Reranking Implementation

```python
from azure.ai.openai import AzureOpenAI
from sentence_transformers import CrossEncoder
import numpy as np

class RerankerPipeline:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client
        self.cross_encoder = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-12-v2')

    def cross_encoder_rerank(self, query: str, documents: list[str], top_k: int = 5) -> list:
        """Rerank using cross-encoder model."""
        pairs = [[query, doc] for doc in documents]
        scores = self.cross_encoder.predict(pairs)

        # Sort by score
        ranked = sorted(zip(documents, scores), key=lambda x: x[1], reverse=True)
        return [doc for doc, score in ranked[:top_k]]

    async def llm_rerank(self, query: str, documents: list[str], top_k: int = 5) -> list:
        """Rerank using LLM for complex queries."""
        docs_text = "\n\n".join([f"[{i}] {doc}" for i, doc in enumerate(documents)])

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Rank these documents by relevance to the query.
                Return a JSON array of document indices in order of relevance.
                Consider semantic relevance, not just keyword matching."""
            }, {
                "role": "user",
                "content": f"Query: {query}\n\nDocuments:\n{docs_text}"
            }],
            response_format={"type": "json_object"}
        )

        ranking = json.loads(response.choices[0].message.content)["ranking"]
        return [documents[i] for i in ranking[:top_k]]

    async def cohere_rerank(self, query: str, documents: list[str], top_k: int = 5) -> list:
        """Use Cohere's reranking API."""
        import cohere
        co = cohere.Client(api_key)

        results = co.rerank(
            query=query,
            documents=documents,
            top_n=top_k,
            model="rerank-english-v3.0"
        )
        return [documents[r.index] for r in results.results]

    def reciprocal_rank_fusion(self, rankings: list[list], k: int = 60) -> list:
        """Combine multiple rankings using RRF."""
        scores = {}
        for ranking in rankings:
            for rank, doc in enumerate(ranking):
                if doc not in scores:
                    scores[doc] = 0
                scores[doc] += 1 / (k + rank + 1)

        return sorted(scores.keys(), key=lambda x: scores[x], reverse=True)
```

Cross-encoder reranking typically improves RAG precision by 10-20%.
