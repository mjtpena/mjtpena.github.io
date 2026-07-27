---
title: "Hybrid Search: Combining Vector and Keyword Search"
author: Michael John Peña
draft: false
date: 2023-02-04
tags:
  - Azure
  - Search
  - Embeddings
  - RAG
  - AI

---

I wrote "Hybrid Search: Combining Vector and Keyword Search" to share practical, production-minded guidance on this topic.

## Why Hybrid Search?

```python
# Vector search weakness: Exact terms
query = "error code 0x80070005"
# Vector search might return general "error handling" docs
# instead of specific error code documentation

# Keyword search weakness: Synonyms
query = "fix computer freezing"
# Keyword search misses "resolve system hang" or "troubleshoot PC lock up"

# Hybrid combines strengths of both
```

## Basic Hybrid Search Implementation

```python
from typing import List, Dict
import numpy as np
from rank_bm25 import BM25Okapi

class HybridSearchEngine:
    """Combine vector and keyword search."""

    def __init__(
        self,
        embedding_model,
        vector_weight: float = 0.5
    ):
        self.embedding_model = embedding_model
        self.vector_weight = vector_weight
        self.keyword_weight = 1 - vector_weight

        self.documents: List[Dict] = []
        self.embeddings: List[List[float]] = []
        self.bm25 = None

    def _tokenize(self, text: str) -> List[str]:
        """Simple tokenization."""
        return text.lower().split()

    def add_documents(self, documents: List[Dict], text_field: str = "content"):
        """Add documents to both indexes."""
        self.documents = documents

        # Build vector index
        texts = [doc[text_field] for doc in documents]
        self.embeddings = [
            self.embedding_model.embed(text)
            for text in texts
        ]

        # Build BM25 index
        tokenized = [self._tokenize(text) for text in texts]
        self.bm25 = BM25Okapi(tokenized)

    def _vector_search(self, query: str, top_k: int) -> List[tuple]:
        """Perform vector similarity search."""
        query_embedding = self.embedding_model.embed(query)

        scores = []
        for i, doc_emb in enumerate(self.embeddings):
            similarity = np.dot(query_embedding, doc_emb) / (
                np.linalg.norm(query_embedding) * np.linalg.norm(doc_emb)
            )
            scores.append((i, similarity))

        scores.sort(key=lambda x: x[1], reverse=True)
        return scores[:top_k]

    def _keyword_search(self, query: str, top_k: int) -> List[tuple]:
        """Perform BM25 keyword search."""
        tokenized_query = self._tokenize(query)
        scores = self.bm25.get_scores(tokenized_query)

        indexed_scores = [(i, score) for i, score in enumerate(scores)]
        indexed_scores.sort(key=lambda x: x[1], reverse=True)
        return indexed_scores[:top_k]

    def _normalize_scores(self, scores: List[tuple]) -> Dict[int, float]:
        """Normalize scores to 0-1 range."""
        if not scores:
            return {}

        max_score = max(s for _, s in scores)
        min_score = min(s for _, s in scores)
        range_score = max_score - min_score

        if range_score == 0:
            return {idx: 1.0 for idx, _ in scores}

        return {
            idx: (score - min_score) / range_score
            for idx, score in scores
        }

    def search(
        self,
        query: str,
        top_k: int = 10,
        vector_weight: float = None
    ) -> List[Dict]:
        """Perform hybrid search."""
        v_weight = vector_weight if vector_weight is not None else self.vector_weight
        k_weight = 1 - v_weight

        # Get results from both methods
        vector_results = self._vector_search(query, top_k * 2)
        keyword_results = self._keyword_search(query, top_k * 2)

        # Normalize scores
        vector_scores = self._normalize_scores(vector_results)
        keyword_scores = self._normalize_scores(keyword_results)

        # Combine scores
        combined_scores = {}
        all_indices = set(vector_scores.keys()) | set(keyword_scores.keys())

        for idx in all_indices:
            v_score = vector_scores.get(idx, 0)
            k_score = keyword_scores.get(idx, 0)
            combined_scores[idx] = v_weight * v_score + k_weight * k_score

        # Sort and return
        sorted_results = sorted(
            combined_scores.items(),
            key=lambda x: x[1],
            reverse=True
        )

        return [
            {
                **self.documents[idx],
                "score": score,
                "vector_score": vector_scores.get(idx, 0),
                "keyword_score": keyword_scores.get(idx, 0)
            }
            for idx, score in sorted_results[:top_k]
        ]
```

## Reciprocal Rank Fusion (RRF)

A robust way to combine rankings:

```python
class RRFHybridSearch:
    """Hybrid search using Reciprocal Rank Fusion."""

    def __init__(self, embedding_model, k: int = 60):
        self.embedding_model = embedding_model
        self.k = k  # RRF parameter, typically 60
        self.documents = []
        self.embeddings = []
        self.bm25 = None

    def _rrf_score(self, rank: int) -> float:
        """Calculate RRF score for a rank."""
        return 1 / (self.k + rank)

    def search(self, query: str, top_k: int = 10) -> List[Dict]:
        """Search using RRF to combine results."""
        # Get rankings from both methods
        vector_results = self._vector_search(query, top_k * 2)
        keyword_results = self._keyword_search(query, top_k * 2)

        # Calculate RRF scores
        rrf_scores = {}

        for rank, (idx, _) in enumerate(vector_results, 1):
            rrf_scores[idx] = rrf_scores.get(idx, 0) + self._rrf_score(rank)

        for rank, (idx, _) in enumerate(keyword_results, 1):
            rrf_scores[idx] = rrf_scores.get(idx, 0) + self._rrf_score(rank)

        # Sort by combined RRF score
        sorted_results = sorted(
            rrf_scores.items(),
            key=lambda x: x[1],
            reverse=True
        )

        return [
            {**self.documents[idx], "rrf_score": score}
            for idx, score in sorted_results[:top_k]
        ]
```

## Dynamic Weight Adjustment

Adjust weights based on query characteristics:

```python
class AdaptiveHybridSearch:
    """Hybrid search with adaptive weighting."""

    def __init__(self, embedding_model):
        self.embedding_model = embedding_model
        self.documents = []
        self.embeddings = []
        self.bm25 = None

    def _analyze_query(self, query: str) -> Dict:
        """Analyze query to determine optimal weights."""
        analysis = {
            "has_quotes": '"' in query,
            "has_special_terms": any(c in query for c in ['#', '@', '/', '\\']),
            "is_question": query.strip().endswith('?'),
            "word_count": len(query.split()),
            "has_numbers": any(c.isdigit() for c in query)
        }

        return analysis

    def _determine_weights(self, query: str) -> tuple:
        """Determine vector/keyword weights based on query."""
        analysis = self._analyze_query(query)

        # Start with balanced weights
        vector_weight = 0.5
        keyword_weight = 0.5

        # Exact phrase search - boost keyword
        if analysis["has_quotes"]:
            keyword_weight += 0.3
            vector_weight -= 0.3

        # Technical terms, codes - boost keyword
        if analysis["has_special_terms"] or analysis["has_numbers"]:
            keyword_weight += 0.2
            vector_weight -= 0.2

        # Natural language questions - boost vector
        if analysis["is_question"] and analysis["word_count"] > 5:
            vector_weight += 0.2
            keyword_weight -= 0.2

        # Normalize
        total = vector_weight + keyword_weight
        return vector_weight / total, keyword_weight / total

    def search(self, query: str, top_k: int = 10) -> List[Dict]:
        """Search with adaptive weighting."""
        v_weight, k_weight = self._determine_weights(query)

        # Log weights for debugging
        print(f"Query: '{query}' - Vector: {v_weight:.2f}, Keyword: {k_weight:.2f}")

        # Perform hybrid search with determined weights
        # ... (implementation similar to HybridSearchEngine)
```

## Integration with Azure Cognitive Search

```python
from azure.search.documents import SearchClient
from azure.search.documents.models import Vector

class AzureHybridSearch:
    """Hybrid search using Azure Cognitive Search."""

    def __init__(
        self,
        endpoint: str,
        key: str,
        index_name: str,
        embedding_model
    ):
        self.search_client = SearchClient(
            endpoint=endpoint,
            index_name=index_name,
            credential=AzureKeyCredential(key)
        )
        self.embedding_model = embedding_model

    def search(
        self,
        query: str,
        top_k: int = 10,
        vector_fields: str = "contentVector",
        filter_expr: str = None
    ) -> List[Dict]:
        """Perform hybrid search."""
        query_embedding = self.embedding_model.embed(query)

        vector = Vector(
            value=query_embedding,
            k=top_k,
            fields=vector_fields
        )

        results = self.search_client.search(
            search_text=query,  # Keyword search
            vectors=[vector],    # Vector search
            filter=filter_expr,
            top=top_k,
            select=["id", "title", "content", "category"]
        )

        return [dict(r) for r in results]
```

## Evaluation

```python
class HybridSearchEvaluator:
    """Evaluate hybrid search performance."""

    def evaluate(
        self,
        search_engine,
        test_queries: List[str],
        relevance_judgments: Dict[str, List[str]],  # query -> list of relevant doc ids
        weight_configs: List[float] = [0.0, 0.25, 0.5, 0.75, 1.0]
    ) -> Dict:
        """Evaluate different weight configurations."""
        results = {}

        for vector_weight in weight_configs:
            mrr_sum = 0
            ndcg_sum = 0

            for query in test_queries:
                relevant_ids = set(relevance_judgments.get(query, []))
                search_results = search_engine.search(
                    query,
                    vector_weight=vector_weight
                )

                # Calculate MRR
                for rank, result in enumerate(search_results, 1):
                    if result["id"] in relevant_ids:
                        mrr_sum += 1 / rank
                        break

                # Calculate NDCG@10
                dcg = sum(
                    1 / np.log2(rank + 1)
                    for rank, r in enumerate(search_results[:10], 1)
                    if r["id"] in relevant_ids
                )
                ideal_dcg = sum(
                    1 / np.log2(rank + 1)
                    for rank in range(1, min(len(relevant_ids), 10) + 1)
                )
                ndcg_sum += dcg / ideal_dcg if ideal_dcg > 0 else 0

            n = len(test_queries)
            results[vector_weight] = {
                "mrr": mrr_sum / n,
                "ndcg@10": ndcg_sum / n
            }

        return results
```

## Best Practices

1. **Start balanced**: 50/50 is often a good default
2. **Tune on your data**: Optimal weights are domain-specific
3. **Consider query type**: Adjust weights dynamically
4. **Use RRF for robustness**: Less sensitive to score scaling
5. **Evaluate thoroughly**: Test with realistic queries

## Resources

- [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)
- [Azure Cognitive Search Hybrid](https://learn.microsoft.com/azure/search/hybrid-search-overview)
- [BM25 Algorithm](https://en.wikipedia.org/wiki/Okapi_BM25)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
