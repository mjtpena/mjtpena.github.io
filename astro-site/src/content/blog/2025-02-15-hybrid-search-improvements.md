---
title: "Hybrid Search Improvements: Latest Techniques for Better Retrieval"
author: Michael John Peña
draft: false
date: 2025-02-15
tags:
  - Search
  - Hybrid Search
  - RAG
  - AI
  - Azure

---

I wrote "Hybrid Search Improvements: Latest Techniques for Better Retrieval" to share practical, production-minded guidance on this topic.

## The Hybrid Search Stack

```
Query
  │
  ├──► Keyword Search (BM25/TF-IDF)
  │         │
  │         ▼
  │    Lexical Results
  │         │
  ├──► Vector Search (Semantic)        ──► Fusion ──► Reranking ──► Results
  │         │                               │
  │         ▼                               │
  │    Semantic Results                     │
  │         │                               │
  └──► Sparse Vector (SPLADE)  ────────────┘
              │
              ▼
         Sparse Results
```

## Advanced Fusion Techniques

### Reciprocal Rank Fusion (RRF)

```python
def reciprocal_rank_fusion(
    result_lists: list[list[dict]],
    k: int = 60,
    weights: list[float] = None
) -> list[dict]:
    """
    Combine multiple ranked lists using RRF.
    RRF is robust and doesn't require score normalization.
    """
    if weights is None:
        weights = [1.0] * len(result_lists)

    scores = {}
    docs = {}

    for list_idx, results in enumerate(result_lists):
        weight = weights[list_idx]
        for rank, doc in enumerate(results):
            doc_id = doc["id"]
            rrf_score = weight * (1 / (k + rank + 1))

            if doc_id in scores:
                scores[doc_id] += rrf_score
            else:
                scores[doc_id] = rrf_score
                docs[doc_id] = doc

    # Sort by combined score
    sorted_ids = sorted(scores.keys(), key=lambda x: scores[x], reverse=True)

    return [
        {**docs[doc_id], "rrf_score": scores[doc_id]}
        for doc_id in sorted_ids
    ]
```

### Distribution-Based Score Fusion

```python
import numpy as np
from scipy import stats

def distribution_based_fusion(
    result_lists: list[list[dict]],
    score_key: str = "score"
) -> list[dict]:
    """
    Normalize scores based on their distribution before fusion.
    Works better when score distributions vary significantly.
    """
    normalized_lists = []

    for results in result_lists:
        if not results:
            normalized_lists.append([])
            continue

        scores = np.array([r[score_key] for r in results])

        # Z-score normalization
        if len(scores) > 1 and np.std(scores) > 0:
            normalized = (scores - np.mean(scores)) / np.std(scores)
        else:
            normalized = scores

        # Scale to 0-1
        if len(normalized) > 1:
            normalized = (normalized - normalized.min()) / (normalized.max() - normalized.min() + 1e-8)

        normalized_results = []
        for i, r in enumerate(results):
            normalized_results.append({
                **r,
                "normalized_score": float(normalized[i])
            })
        normalized_lists.append(normalized_results)

    # Combine normalized scores
    combined = {}
    for results in normalized_lists:
        for r in results:
            doc_id = r["id"]
            if doc_id not in combined:
                combined[doc_id] = {"doc": r, "scores": []}
            combined[doc_id]["scores"].append(r["normalized_score"])

    # Average scores
    final_results = []
    for doc_id, data in combined.items():
        avg_score = np.mean(data["scores"])
        final_results.append({
            **data["doc"],
            "fusion_score": avg_score
        })

    return sorted(final_results, key=lambda x: x["fusion_score"], reverse=True)
```

### Learned Fusion

```python
class LearnedFusion:
    """Train a model to combine retrieval scores."""

    def __init__(self, model_path: str = None):
        if model_path:
            self.model = self._load_model(model_path)
        else:
            self.model = self._create_model()

    def _create_model(self):
        """Create a simple fusion model."""
        import torch.nn as nn

        return nn.Sequential(
            nn.Linear(4, 16),  # [bm25_score, vector_score, sparse_score, bm25_rank, ...]
            nn.ReLU(),
            nn.Linear(16, 8),
            nn.ReLU(),
            nn.Linear(8, 1),
            nn.Sigmoid()
        )

    def fuse(self, result_lists: list[list[dict]]) -> list[dict]:
        """Fuse results using learned model."""
        import torch

        # Build feature matrix
        all_docs = self._collect_all_docs(result_lists)

        features = []
        for doc_id, doc in all_docs.items():
            feature_vec = [
                doc.get("bm25_score", 0),
                doc.get("vector_score", 0),
                doc.get("sparse_score", 0),
                doc.get("bm25_rank", 100) / 100,
                doc.get("vector_rank", 100) / 100,
                doc.get("sparse_rank", 100) / 100,
            ]
            features.append((doc_id, feature_vec, doc))

        # Predict fusion scores
        feature_tensor = torch.tensor([f[1] for f in features], dtype=torch.float32)
        with torch.no_grad():
            scores = self.model(feature_tensor).squeeze()

        # Sort by predicted score
        results = [
            {**features[i][2], "fusion_score": float(scores[i])}
            for i in range(len(features))
        ]
        return sorted(results, key=lambda x: x["fusion_score"], reverse=True)

    def train(self, training_data: list[dict]):
        """Train the fusion model on labeled data."""
        # training_data: [{"results": [...], "relevance": {...}}]
        pass
```

## Sparse Vector Integration

```python
from transformers import AutoModelForMaskedLM, AutoTokenizer
import torch

class SparseEncoder:
    """SPLADE-style sparse encoder for hybrid search."""

    def __init__(self, model_name: str = "naver/splade-cocondenser-ensembledistil"):
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForMaskedLM.from_pretrained(model_name)

    def encode(self, text: str) -> dict:
        """Encode text to sparse vector."""
        inputs = self.tokenizer(text, return_tensors="pt", truncation=True, max_length=512)

        with torch.no_grad():
            outputs = self.model(**inputs)
            logits = outputs.logits

        # SPLADE aggregation: log(1 + ReLU(logits)) * attention_mask
        weights = torch.log1p(torch.relu(logits)) * inputs["attention_mask"].unsqueeze(-1)
        weights = torch.max(weights, dim=1).values.squeeze()

        # Convert to sparse representation
        non_zero = weights.nonzero().squeeze().tolist()
        if isinstance(non_zero, int):
            non_zero = [non_zero]

        sparse_vector = {
            self.tokenizer.decode([idx]): float(weights[idx])
            for idx in non_zero
            if weights[idx] > 0.1  # Threshold small values
        }

        return sparse_vector


class HybridSearchWithSparse:
    """Hybrid search combining dense, sparse, and keyword."""

    def __init__(self, dense_encoder, sparse_encoder, search_client):
        self.dense_encoder = dense_encoder
        self.sparse_encoder = sparse_encoder
        self.search_client = search_client

    async def search(
        self,
        query: str,
        top_k: int = 10,
        dense_weight: float = 0.4,
        sparse_weight: float = 0.3,
        keyword_weight: float = 0.3
    ) -> list[dict]:
        """Execute three-way hybrid search."""

        # Encode query
        dense_vector = await self.dense_encoder.encode(query)
        sparse_vector = self.sparse_encoder.encode(query)

        # Execute searches in parallel
        dense_results, sparse_results, keyword_results = await asyncio.gather(
            self._dense_search(dense_vector, top_k * 2),
            self._sparse_search(sparse_vector, top_k * 2),
            self._keyword_search(query, top_k * 2)
        )

        # Fuse with RRF
        fused = reciprocal_rank_fusion(
            [dense_results, sparse_results, keyword_results],
            weights=[dense_weight, sparse_weight, keyword_weight]
        )

        return fused[:top_k]
```

## Query-Adaptive Hybrid Search

```python
class AdaptiveHybridSearch:
    """Adjust search weights based on query characteristics."""

    def __init__(self, search_client, llm_client):
        self.search = search_client
        self.llm = llm_client

    async def search(self, query: str, top_k: int = 10) -> list[dict]:
        """Search with adaptive weights."""

        # Analyze query
        query_type = await self._analyze_query(query)

        # Set weights based on query type
        weights = self._get_weights(query_type)

        # Execute search
        return await self._hybrid_search(query, top_k, weights)

    async def _analyze_query(self, query: str) -> dict:
        """Classify query to determine optimal weights."""

        # Fast classification
        analysis = {
            "has_exact_terms": self._has_exact_terms(query),
            "is_question": query.strip().endswith("?"),
            "is_short": len(query.split()) < 5,
            "has_technical_terms": self._has_technical_terms(query),
        }

        return analysis

    def _get_weights(self, analysis: dict) -> dict:
        """Determine weights from query analysis."""

        if analysis["has_exact_terms"]:
            # Boost keyword search for exact term queries
            return {"dense": 0.3, "sparse": 0.3, "keyword": 0.4}

        if analysis["is_short"] and analysis["has_technical_terms"]:
            # Technical keyword lookup - balance all
            return {"dense": 0.35, "sparse": 0.35, "keyword": 0.3}

        if analysis["is_question"]:
            # Semantic question - boost dense
            return {"dense": 0.5, "sparse": 0.25, "keyword": 0.25}

        # Default balanced
        return {"dense": 0.4, "sparse": 0.3, "keyword": 0.3}

    def _has_exact_terms(self, query: str) -> bool:
        """Check for quoted terms or specific patterns."""
        return '"' in query or any(
            pattern in query.lower()
            for pattern in ["error:", "code:", "version:"]
        )

    def _has_technical_terms(self, query: str) -> bool:
        """Check for technical terminology."""
        technical_patterns = ["api", "function", "error", "exception", "config"]
        return any(term in query.lower() for term in technical_patterns)
```

## Best Practices

1. **Always use hybrid**: Pure vector search misses exact matches
2. **Tune weights empirically**: Optimal weights vary by use case
3. **Consider sparse vectors**: SPLADE improves keyword-like matching
4. **Use RRF for robustness**: Doesn't require score normalization
5. **Query-adaptive**: Different queries benefit from different weights
6. **Evaluate holistically**: Measure both precision and recall

Hybrid search continues to outperform pure vector or keyword approaches. Invest in tuning your fusion strategy for your specific domain.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
