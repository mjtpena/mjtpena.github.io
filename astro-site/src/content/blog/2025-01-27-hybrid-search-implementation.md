---
title: "Hybrid Search Implementation: Combining Vector and Keyword Search"
author: Michael John Peña
draft: false
date: 2025-01-27
tags:
  - Search
  - Vector Search
  - AI
  - Azure
  - RAG

---

I wrote "Hybrid Search Implementation: Combining Vector and Keyword Search" to share practical, production-minded guidance on this topic.

## Why Hybrid Search?

```
Query: "Error code ERR_CONNECTION_REFUSED"

Vector Search Only:
- Finds documents about connection errors (semantic)
- May miss exact error code matches

Keyword Search Only:
- Finds exact "ERR_CONNECTION_REFUSED" matches
- Misses semantically related troubleshooting docs

Hybrid Search:
- Finds exact matches (keyword)
- PLUS semantically related docs (vector)
- Best of both worlds
```

## Azure AI Search Hybrid Implementation

```python
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery
from azure.identity import DefaultAzureCredential

class AzureHybridSearch:
    def __init__(self, endpoint: str, index_name: str, embedding_model):
        self.client = SearchClient(
            endpoint=endpoint,
            index_name=index_name,
            credential=DefaultAzureCredential()
        )
        self.embedding_model = embedding_model

    def search(
        self,
        query: str,
        filter: str = None,
        top: int = 10,
        vector_weight: float = 0.5,
        keyword_weight: float = 0.5
    ) -> list[dict]:
        """Execute hybrid search with configurable weights."""

        # Generate query embedding
        query_vector = self.embedding_model.embed(query)

        # Hybrid query: text + vector
        results = self.client.search(
            search_text=query,  # Keyword search
            vector_queries=[
                VectorizedQuery(
                    vector=query_vector,
                    k_nearest_neighbors=top * 2,  # Over-fetch for reranking
                    fields="content_vector",
                    weight=vector_weight  # Vector component weight
                )
            ],
            filter=filter,
            query_type="semantic",  # Enable semantic ranking
            semantic_configuration_name="default",
            top=top,
            select=["id", "title", "content", "source"]
        )

        return [
            {
                "id": r["id"],
                "title": r["title"],
                "content": r["content"],
                "source": r["source"],
                "score": r["@search.score"],
                "reranker_score": r.get("@search.reranker_score")
            }
            for r in results
        ]
```

## Custom Hybrid Search with Score Fusion

When using databases without built-in hybrid search:

```python
import numpy as np
from dataclasses import dataclass
from typing import Callable

@dataclass
class SearchResult:
    id: str
    content: str
    score: float
    source: str  # 'vector' or 'keyword'

class HybridSearchEngine:
    def __init__(
        self,
        vector_search_fn: Callable,
        keyword_search_fn: Callable,
        fusion_method: str = "rrf"
    ):
        self.vector_search = vector_search_fn
        self.keyword_search = keyword_search_fn
        self.fusion_method = fusion_method

    def search(
        self,
        query: str,
        query_vector: list[float],
        top_k: int = 10,
        vector_weight: float = 0.5
    ) -> list[SearchResult]:
        """Execute hybrid search with score fusion."""

        # Get results from both sources
        vector_results = self.vector_search(query_vector, top_k=top_k * 2)
        keyword_results = self.keyword_search(query, top_k=top_k * 2)

        # Fuse results
        if self.fusion_method == "rrf":
            return self._reciprocal_rank_fusion(
                vector_results, keyword_results, top_k, vector_weight
            )
        elif self.fusion_method == "linear":
            return self._linear_combination(
                vector_results, keyword_results, top_k, vector_weight
            )
        else:
            raise ValueError(f"Unknown fusion method: {self.fusion_method}")

    def _reciprocal_rank_fusion(
        self,
        vector_results: list[SearchResult],
        keyword_results: list[SearchResult],
        top_k: int,
        vector_weight: float,
        k: int = 60  # RRF constant
    ) -> list[SearchResult]:
        """Reciprocal Rank Fusion - robust score combination."""

        scores = {}
        contents = {}

        # Score vector results
        for rank, result in enumerate(vector_results):
            rrf_score = vector_weight * (1 / (k + rank + 1))
            scores[result.id] = scores.get(result.id, 0) + rrf_score
            contents[result.id] = result.content

        # Score keyword results
        keyword_weight = 1 - vector_weight
        for rank, result in enumerate(keyword_results):
            rrf_score = keyword_weight * (1 / (k + rank + 1))
            scores[result.id] = scores.get(result.id, 0) + rrf_score
            contents[result.id] = result.content

        # Sort by combined score
        sorted_ids = sorted(scores.keys(), key=lambda x: scores[x], reverse=True)

        return [
            SearchResult(
                id=doc_id,
                content=contents[doc_id],
                score=scores[doc_id],
                source="hybrid"
            )
            for doc_id in sorted_ids[:top_k]
        ]

    def _linear_combination(
        self,
        vector_results: list[SearchResult],
        keyword_results: list[SearchResult],
        top_k: int,
        vector_weight: float
    ) -> list[SearchResult]:
        """Linear combination of normalized scores."""

        # Normalize scores
        def normalize(results):
            if not results:
                return results
            max_score = max(r.score for r in results)
            min_score = min(r.score for r in results)
            if max_score == min_score:
                return [(r.id, r.content, 1.0) for r in results]
            return [
                (r.id, r.content, (r.score - min_score) / (max_score - min_score))
                for r in results
            ]

        vector_normalized = normalize(vector_results)
        keyword_normalized = normalize(keyword_results)

        scores = {}
        contents = {}

        for doc_id, content, score in vector_normalized:
            scores[doc_id] = vector_weight * score
            contents[doc_id] = content

        keyword_weight = 1 - vector_weight
        for doc_id, content, score in keyword_normalized:
            scores[doc_id] = scores.get(doc_id, 0) + keyword_weight * score
            contents[doc_id] = content

        sorted_ids = sorted(scores.keys(), key=lambda x: scores[x], reverse=True)

        return [
            SearchResult(id=doc_id, content=contents[doc_id], score=scores[doc_id], source="hybrid")
            for doc_id in sorted_ids[:top_k]
        ]
```

## PostgreSQL Hybrid Search

```python
import psycopg2
from pgvector.psycopg2 import register_vector

class PostgresHybridSearch:
    def __init__(self, conn_string: str):
        self.conn = psycopg2.connect(conn_string)
        register_vector(self.conn)

    def search(
        self,
        query: str,
        query_vector: list[float],
        top_k: int = 10,
        vector_weight: float = 0.5
    ) -> list[dict]:
        """Hybrid search using PostgreSQL full-text + pgvector."""

        keyword_weight = 1 - vector_weight

        with self.conn.cursor() as cur:
            # Combined query using RRF-style fusion
            cur.execute("""
                WITH vector_search AS (
                    SELECT
                        id,
                        title,
                        content,
                        ROW_NUMBER() OVER (ORDER BY embedding <=> %s) as vector_rank
                    FROM documents
                    ORDER BY embedding <=> %s
                    LIMIT %s
                ),
                keyword_search AS (
                    SELECT
                        id,
                        title,
                        content,
                        ROW_NUMBER() OVER (ORDER BY ts_rank(to_tsvector('english', content), plainto_tsquery('english', %s)) DESC) as keyword_rank
                    FROM documents
                    WHERE to_tsvector('english', content) @@ plainto_tsquery('english', %s)
                    LIMIT %s
                ),
                combined AS (
                    SELECT
                        COALESCE(v.id, k.id) as id,
                        COALESCE(v.title, k.title) as title,
                        COALESCE(v.content, k.content) as content,
                        COALESCE(%s * (1.0 / (60 + v.vector_rank)), 0) +
                        COALESCE(%s * (1.0 / (60 + k.keyword_rank)), 0) as rrf_score
                    FROM vector_search v
                    FULL OUTER JOIN keyword_search k ON v.id = k.id
                )
                SELECT id, title, content, rrf_score
                FROM combined
                ORDER BY rrf_score DESC
                LIMIT %s
            """, (
                query_vector, query_vector, top_k * 2,
                query, query, top_k * 2,
                vector_weight, keyword_weight,
                top_k
            ))

            results = cur.fetchall()

        return [
            {"id": r[0], "title": r[1], "content": r[2], "score": r[3]}
            for r in results
        ]
```

## Adaptive Hybrid Search

Adjust weights based on query characteristics:

```python
class AdaptiveHybridSearch:
    def __init__(self, hybrid_engine: HybridSearchEngine, llm_client):
        self.engine = hybrid_engine
        self.llm = llm_client

    async def search(self, query: str, query_vector: list[float], top_k: int = 10) -> list[dict]:
        """Adaptively adjust weights based on query type."""

        # Analyze query to determine optimal weights
        weights = await self._analyze_query(query)

        results = self.engine.search(
            query=query,
            query_vector=query_vector,
            top_k=top_k,
            vector_weight=weights["vector"]
        )

        return {
            "results": results,
            "weights_used": weights,
            "query_analysis": weights.get("reasoning")
        }

    async def _analyze_query(self, query: str) -> dict:
        """Use LLM to determine optimal search weights."""

        response = await self.llm.chat.complete_async(
            deployment="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": f"""Analyze this search query and determine optimal weights for hybrid search:

                Query: {query}

                Consider:
                - Does it contain specific terms (error codes, product names)?
                - Is it a conceptual/semantic query?
                - Does it mix both?

                Return JSON:
                {{
                    "vector": 0.0-1.0,  // Weight for semantic/vector search
                    "keyword": 0.0-1.0, // Weight for keyword search (must sum to 1)
                    "reasoning": "brief explanation"
                }}"""
            }]
        )

        weights = json.loads(response.choices[0].message.content)

        # Ensure weights are valid
        total = weights["vector"] + weights["keyword"]
        weights["vector"] /= total
        weights["keyword"] /= total

        return weights

# Example adaptive behavior:
# "ERR_CONNECTION_REFUSED troubleshooting" -> keyword: 0.7, vector: 0.3
# "how to fix network connectivity issues" -> keyword: 0.3, vector: 0.7
# "API rate limiting best practices" -> keyword: 0.5, vector: 0.5
```

## Evaluation

```python
class HybridSearchEvaluator:
    def evaluate(
        self,
        queries: list[dict],  # {"query": str, "relevant_ids": list[str]}
        search_fn: Callable,
        k_values: list[int] = [1, 5, 10]
    ) -> dict:
        """Evaluate hybrid search performance."""

        metrics = {f"recall@{k}": [] for k in k_values}
        metrics.update({f"precision@{k}": [] for k in k_values})
        metrics["mrr"] = []

        for item in queries:
            query = item["query"]
            relevant = set(item["relevant_ids"])

            results = search_fn(query)
            result_ids = [r["id"] for r in results]

            # Calculate metrics
            for k in k_values:
                top_k_ids = set(result_ids[:k])
                hits = len(top_k_ids & relevant)

                metrics[f"recall@{k}"].append(hits / len(relevant))
                metrics[f"precision@{k}"].append(hits / k)

            # MRR
            mrr = 0
            for i, rid in enumerate(result_ids):
                if rid in relevant:
                    mrr = 1 / (i + 1)
                    break
            metrics["mrr"].append(mrr)

        # Average metrics
        return {k: np.mean(v) for k, v in metrics.items()}
```

Hybrid search delivers better results than either approach alone. Implement it early in your RAG pipeline and tune the weights based on your specific use case.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
