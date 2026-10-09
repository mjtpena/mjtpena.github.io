---
title: "Re-ranking Search Results for Better RAG Performance"
author: Michael John Peña
draft: false
date: 2023-02-05
tags:
  - Azure
  - Search
  - RAG
  - Reranking
  - AI
---

## Why Re-ranking?

```python
# Stage 1: Fast retrieval (100ms)
# - Retrieve top 50-100 candidates
# - Uses efficient vector/keyword search
# - Good recall but lower precision

# Stage 2: Re-ranking (500ms)
# - Re-score top 10-20 candidates
# - Uses expensive but accurate models
# - High precision for final results

# Result: Best of both worlds
```

## Cross-Encoder Re-ranking

Cross-encoders directly score query-document pairs:

```python
from sentence_transformers import CrossEncoder
from typing import List, Dict, Tuple

class CrossEncoderReranker:
    """Re-rank using a cross-encoder model."""

    def __init__(self, model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"):
        self.model = CrossEncoder(model_name)

    def rerank(
        self,
        query: str,
        documents: List[Dict],
        text_field: str = "content",
        top_k: int = 10
    ) -> List[Dict]:
        """Re-rank documents using cross-encoder."""
        if not documents:
            return []

        # Create query-document pairs
        pairs = [(query, doc[text_field]) for doc in documents]

        # Score all pairs
        scores = self.model.predict(pairs)

        # Combine with documents
        scored_docs = list(zip(documents, scores))
        scored_docs.sort(key=lambda x: x[1], reverse=True)

        # Return top k with scores
        return [
            {**doc, "rerank_score": float(score)}
            for doc, score in scored_docs[:top_k]
        ]

# Usage
reranker = CrossEncoderReranker()
initial_results = retriever.search("Azure Functions scaling", top_k=50)
reranked = reranker.rerank("Azure Functions scaling", initial_results, top_k=10)
```

## LLM-Based Re-ranking

Use an LLM to judge relevance:

```python
import openai
from typing import List, Dict
import json

class LLMReranker:
    """Re-rank using LLM relevance judgments."""

    def __init__(self, deployment: str = "gpt-35-turbo"):
        self.deployment = deployment

    def score_document(
        self,
        query: str,
        document: str
    ) -> float:
        """Score a single document's relevance."""
        prompt = f"""Rate the relevance of this document to the query on a scale of 0-10.

Query: {query}
Document: {document[:1000]}

Return only a number from 0-10:"""

        response = openai.ChatCompletion.create(
            engine=self.deployment,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=5
        )

        try:
            score = float(response.choices[0].message.content.strip())
            return min(max(score, 0), 10) / 10  # Normalize to 0-1
        except:
            return 0.5

    def batch_rerank(
        self,
        query: str,
        documents: List[Dict],
        text_field: str = "content",
        top_k: int = 10
    ) -> List[Dict]:
        """Re-rank documents with batch LLM call."""
        if not documents:
            return []

        # Create numbered document list
        doc_list = "\n".join([
            f"{i+1}. {doc[text_field][:200]}..."
            for i, doc in enumerate(documents[:20])  # Limit to 20
        ])

        prompt = f"""Given the query: "{query}"

Rank these documents by relevance (most relevant first).
Return only the document numbers separated by commas.

Documents:
{doc_list}

Ranking (e.g., "3,1,5,2,4"):"""

        response = openai.ChatCompletion.create(
            engine=self.deployment,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=100
        )

        # Parse ranking
        try:
            ranking_str = response.choices[0].message.content.strip()
            ranking = [int(x.strip()) - 1 for x in ranking_str.split(",")]

            reranked = []
            for rank, idx in enumerate(ranking):
                if 0 <= idx < len(documents):
                    doc = documents[idx].copy()
                    doc["rerank_position"] = rank + 1
                    reranked.append(doc)

            return reranked[:top_k]
        except:
            return documents[:top_k]

    def pairwise_rerank(
        self,
        query: str,
        documents: List[Dict],
        text_field: str = "content"
    ) -> List[Dict]:
        """Re-rank using pairwise comparisons."""
        # Use tournament-style comparison
        n = len(documents)
        wins = [0] * n

        for i in range(n):
            for j in range(i + 1, n):
                winner = self._compare_pair(
                    query,
                    documents[i][text_field],
                    documents[j][text_field]
                )
                if winner == 1:
                    wins[i] += 1
                else:
                    wins[j] += 1

        # Sort by wins
        indexed = list(enumerate(documents))
        indexed.sort(key=lambda x: wins[x[0]], reverse=True)

        return [doc for _, doc in indexed]

    def _compare_pair(
        self,
        query: str,
        doc1: str,
        doc2: str
    ) -> int:
        """Compare two documents, return 1 or 2 for winner."""
        prompt = f"""Query: {query}

Document A: {doc1[:500]}
Document B: {doc2[:500]}

Which document is more relevant to the query? Reply with only 'A' or 'B':"""

        response = openai.ChatCompletion.create(
            engine=self.deployment,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=5
        )

        answer = response.choices[0].message.content.strip().upper()
        return 1 if answer == "A" else 2
```

## Cohere Re-ranking

Using Cohere's specialized rerank API:

```python
import cohere

class CohereReranker:
    """Re-rank using Cohere's rerank API."""

    def __init__(self, api_key: str, model: str = "rerank-english-v2.0"):
        self.client = cohere.Client(api_key)
        self.model = model

    def rerank(
        self,
        query: str,
        documents: List[Dict],
        text_field: str = "content",
        top_k: int = 10
    ) -> List[Dict]:
        """Re-rank using Cohere."""
        if not documents:
            return []

        texts = [doc[text_field] for doc in documents]

        response = self.client.rerank(
            query=query,
            documents=texts,
            model=self.model,
            top_n=top_k
        )

        reranked = []
        for result in response.results:
            doc = documents[result.index].copy()
            doc["rerank_score"] = result.relevance_score
            reranked.append(doc)

        return reranked
```

## Multi-Stage Re-ranking Pipeline

```python
class MultiStageReranker:
    """Multi-stage re-ranking pipeline."""

    def __init__(
        self,
        cross_encoder_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2",
        llm_deployment: str = "gpt-35-turbo"
    ):
        self.cross_encoder = CrossEncoderReranker(cross_encoder_model)
        self.llm_reranker = LLMReranker(llm_deployment)

    def rerank(
        self,
        query: str,
        documents: List[Dict],
        text_field: str = "content",
        final_k: int = 5
    ) -> List[Dict]:
        """Multi-stage re-ranking."""
        if len(documents) <= final_k:
            return documents

        # Stage 1: Cross-encoder (fast, handles many docs)
        stage1_k = min(20, len(documents))
        stage1_results = self.cross_encoder.rerank(
            query, documents, text_field, top_k=stage1_k
        )

        # Stage 2: LLM (slower, more accurate, fewer docs)
        final_results = self.llm_reranker.batch_rerank(
            query, stage1_results, text_field, top_k=final_k
        )

        return final_results
```

## Combining Initial Scores with Re-rank Scores

```python
class ScoreFusionReranker:
    """Combine initial and re-rank scores."""

    def __init__(
        self,
        reranker,
        initial_weight: float = 0.3,
        rerank_weight: float = 0.7
    ):
        self.reranker = reranker
        self.initial_weight = initial_weight
        self.rerank_weight = rerank_weight

    def rerank(
        self,
        query: str,
        documents: List[Dict],
        initial_score_field: str = "score",
        text_field: str = "content",
        top_k: int = 10
    ) -> List[Dict]:
        """Re-rank and combine scores."""
        # Get re-rank scores
        reranked = self.reranker.rerank(query, documents, text_field)

        # Normalize initial scores
        initial_scores = [doc.get(initial_score_field, 0) for doc in documents]
        max_initial = max(initial_scores) if initial_scores else 1
        min_initial = min(initial_scores) if initial_scores else 0
        range_initial = max_initial - min_initial or 1

        # Normalize re-rank scores
        rerank_scores = [doc.get("rerank_score", 0) for doc in reranked]
        max_rerank = max(rerank_scores) if rerank_scores else 1
        min_rerank = min(rerank_scores) if rerank_scores else 0
        range_rerank = max_rerank - min_rerank or 1

        # Combine scores
        for doc in reranked:
            norm_initial = (doc.get(initial_score_field, 0) - min_initial) / range_initial
            norm_rerank = (doc.get("rerank_score", 0) - min_rerank) / range_rerank

            doc["combined_score"] = (
                self.initial_weight * norm_initial +
                self.rerank_weight * norm_rerank
            )

        # Sort by combined score
        reranked.sort(key=lambda x: x.get("combined_score", 0), reverse=True)
        return reranked[:top_k]
```

## Best Practices

1. **Retrieve more, re-rank fewer**: Get top 50-100, re-rank top 10-20
2. **Use specialized models**: Cross-encoders outperform bi-encoders for re-ranking
3. **Consider latency**: LLM re-ranking adds 500ms+ per call
4. **Cache when possible**: Same query-doc pairs get same scores
5. **Combine scores carefully**: Initial scores still provide signal
6. **Test on your data**: Re-ranking effectiveness varies by domain

## Resources

- [Cross-Encoders](https://www.sbert.net/examples/applications/cross-encoder/README.html)
- [MS MARCO Benchmarks](https://microsoft.github.io/msmarco/)
- [Cohere Rerank](https://docs.cohere.com/docs/rerank)
