---
title: "Hybrid Search Optimization: Combining Vector, Keyword, and Semantic Search"
description: "Combining vector, keyword, and semantic search solved many relevance problems for us. This post distils the hybrid strategies I used to get the best of each…"
author: Michael John Peña
draft: false
date: 2024-01-27
tags:
  - Hybrid Search
  - Azure AI Search
  - Vector Search
  - RAG
  - Search Optimization
---

Combining vector, keyword, and semantic search solved many relevance problems for us. This post distils the hybrid strategies I used to get the best of each method.

## Why Hybrid Search?

Each search method has strengths and weaknesses:

| Method | Strengths | Weaknesses |
|--------|-----------|------------|
| Keyword (BM25) | Exact matches, acronyms | No semantic understanding |
| Vector | Semantic similarity | Misses exact terms |
| Semantic | Intent understanding | Requires reranking overhead |

## Basic Hybrid Configuration

```python
from azure.search.documents.models import VectorizedQuery, VectorQuery

def hybrid_search(query: str, query_vector: list, top_k: int = 10):
    """Basic hybrid search combining vector and keyword."""

    vector_query = VectorizedQuery(
        vector=query_vector,
        k_nearest_neighbors=top_k * 2,
        fields="content_vector"
    )

    results = search_client.search(
        search_text=query,
        vector_queries=[vector_query],
        top=top_k
    )

    return list(results)
```

## Advanced: Three-Way Hybrid

```python
def advanced_hybrid_search(query: str, query_vector: list):
    """Combine vector + keyword + semantic ranking."""

    vector_query = VectorizedQuery(
        vector=query_vector,
        k_nearest_neighbors=50,
        fields="content_vector"
    )

    results = search_client.search(
        search_text=query,
        vector_queries=[vector_query],
        query_type="semantic",
        semantic_configuration_name="my-semantic-config",
        query_caption="extractive",
        top=10
    )

    return [
        {
            "id": r["id"],
            "title": r["title"],
            "score": r["@search.score"],
            "reranker_score": r.get("@search.reranker_score"),
            "captions": r.get("@search.captions")
        }
        for r in results
    ]
```

## Score Fusion Strategies

### Reciprocal Rank Fusion (RRF)

```python
def reciprocal_rank_fusion(result_lists: list[list], k: int = 60):
    """Combine multiple result lists using RRF."""

    scores = {}

    for results in result_lists:
        for rank, doc in enumerate(results):
            doc_id = doc["id"]
            if doc_id not in scores:
                scores[doc_id] = {"doc": doc, "score": 0}
            scores[doc_id]["score"] += 1 / (k + rank + 1)

    # Sort by fused score
    sorted_results = sorted(
        scores.values(),
        key=lambda x: x["score"],
        reverse=True
    )

    return [r["doc"] for r in sorted_results]

# Usage
keyword_results = keyword_search(query)
vector_results = vector_search(query_vector)
fused_results = reciprocal_rank_fusion([keyword_results, vector_results])
```

### Weighted Combination

```python
def weighted_hybrid(
    query: str,
    query_vector: list,
    keyword_weight: float = 0.3,
    vector_weight: float = 0.7
):
    """Weighted combination of keyword and vector scores."""

    # Separate searches
    keyword_results = search_client.search(search_text=query, top=50)
    vector_results = search_client.search(
        vector_queries=[VectorizedQuery(vector=query_vector, k=50, fields="content_vector")]
    )

    # Normalize and combine scores
    scores = {}

    for r in keyword_results:
        scores[r["id"]] = {"doc": r, "keyword_score": r["@search.score"], "vector_score": 0}

    for r in vector_results:
        if r["id"] in scores:
            scores[r["id"]]["vector_score"] = r["@search.score"]
        else:
            scores[r["id"]] = {"doc": r, "keyword_score": 0, "vector_score": r["@search.score"]}

    # Calculate weighted score
    for doc_id in scores:
        ks = normalize_score(scores[doc_id]["keyword_score"])
        vs = normalize_score(scores[doc_id]["vector_score"])
        scores[doc_id]["final_score"] = keyword_weight * ks + vector_weight * vs

    return sorted(scores.values(), key=lambda x: x["final_score"], reverse=True)
```

## Optimization Tips

### Query Analysis

```python
def analyze_query_for_search(query: str) -> dict:
    """Analyze query to optimize search strategy."""

    analysis = {
        "has_exact_terms": bool(re.search(r'"[^"]+"', query)),
        "is_question": query.strip().endswith("?"),
        "has_technical_terms": bool(re.search(r'\b[A-Z]{2,}\b', query)),
        "word_count": len(query.split())
    }

    # Recommend weights
    if analysis["has_exact_terms"]:
        analysis["recommended_keyword_weight"] = 0.6
    elif analysis["is_question"]:
        analysis["recommended_keyword_weight"] = 0.3
    else:
        analysis["recommended_keyword_weight"] = 0.4

    return analysis
```

### Dynamic Weight Adjustment

```python
def adaptive_hybrid_search(query: str, query_vector: list):
    """Adapt search weights based on query characteristics."""

    analysis = analyze_query_for_search(query)

    keyword_weight = analysis["recommended_keyword_weight"]
    vector_weight = 1 - keyword_weight

    return weighted_hybrid(query, query_vector, keyword_weight, vector_weight)
```

## Evaluation

```python
def evaluate_hybrid_configs(test_queries: list, configs: list[dict]):
    """Evaluate different hybrid configurations."""

    results = {}

    for config in configs:
        name = config["name"]
        results[name] = {"precision": [], "recall": [], "mrr": []}

        for test in test_queries:
            search_results = hybrid_search(
                test["query"],
                test["vector"],
                keyword_weight=config["keyword_weight"],
                vector_weight=config["vector_weight"]
            )

            retrieved = [r["id"] for r in search_results[:10]]
            relevant = test["relevant_docs"]

            results[name]["precision"].append(
                len(set(retrieved) & set(relevant)) / len(retrieved)
            )
            results[name]["recall"].append(
                len(set(retrieved) & set(relevant)) / len(relevant)
            )

    return {
        name: {
            "avg_precision": sum(m["precision"]) / len(m["precision"]),
            "avg_recall": sum(m["recall"]) / len(m["recall"])
        }
        for name, m in results.items()
    }
```

## Best Practices

1. **Always use hybrid** for production RAG
2. **Add semantic reranking** for final relevance boost
3. **Tune weights** based on your data and queries
4. **Measure quality** with representative test queries
5. **Consider query type** when setting weights

## Conclusion

Hybrid search is essential for production RAG systems. The combination of vector (semantic similarity) and keyword (exact matching) with semantic reranking delivers the best results across diverse query types.
