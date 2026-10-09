---
title: "Hybrid Search Patterns in Azure Cognitive Search"
description: "Hybrid search patterns enable building search systems that handle diverse query types effectively."
author: "Michael John Peña"
draft: false
date: 2022-08-25
tags: ["Azure", "Cognitive Search", "Hybrid Search", "Vector Search", "AI"]
---

## Why Hybrid Search

- **Keyword Search**: Great for exact matches, filters, and facets
- **Vector Search**: Excellent for semantic similarity and concept matching
- **Hybrid**: Combines precision of keywords with recall of vectors

## Basic Hybrid Search

```python
from azure.search.documents import SearchClient
from azure.search.documents.models import Vector
from azure.core.credentials import AzureKeyCredential
import openai

endpoint = "https://mysearchservice.search.windows.net"
credential = AzureKeyCredential("your-admin-key")

search_client = SearchClient(
    endpoint=endpoint,
    index_name="hybrid-index",
    credential=credential
)

def hybrid_search(query, k=10):
    """Perform hybrid search combining keyword and vector"""
    # Generate query embedding
    query_embedding = get_embedding(query)

    results = search_client.search(
        search_text=query,  # Keyword component
        vectors=[
            Vector(
                value=query_embedding,
                k=k,
                fields="content_vector"
            )
        ],
        select=["id", "title", "content", "category"],
        top=k
    )

    return list(results)

# Execute hybrid search
results = hybrid_search("machine learning model deployment best practices")
for r in results:
    print(f"{r['title']}: {r['@search.score']:.4f}")
```

## Weighted Hybrid Search

```python
class WeightedHybridSearch:
    """Hybrid search with configurable weights"""

    def __init__(self, search_client, embedding_func):
        self.search_client = search_client
        self.get_embedding = embedding_func

    def search(self, query, keyword_weight=0.5, vector_weight=0.5, k=10):
        """Search with weighted combination of keyword and vector scores"""

        # Get keyword results
        keyword_results = self._keyword_search(query, k * 2)

        # Get vector results
        vector_results = self._vector_search(query, k * 2)

        # Combine and rerank
        combined = self._combine_results(
            keyword_results,
            vector_results,
            keyword_weight,
            vector_weight
        )

        return combined[:k]

    def _keyword_search(self, query, k):
        results = self.search_client.search(
            search_text=query,
            select=["id", "title", "content"],
            top=k
        )
        return {r["id"]: {"doc": r, "score": r["@search.score"]} for r in results}

    def _vector_search(self, query, k):
        embedding = self.get_embedding(query)
        results = self.search_client.search(
            search_text=None,
            vectors=[Vector(value=embedding, k=k, fields="content_vector")],
            select=["id", "title", "content"]
        )
        return {r["id"]: {"doc": r, "score": r["@search.score"]} for r in results}

    def _combine_results(self, keyword_results, vector_results, kw_weight, vec_weight):
        """Combine results using Reciprocal Rank Fusion or weighted scoring"""
        all_ids = set(keyword_results.keys()) | set(vector_results.keys())

        combined = []
        for doc_id in all_ids:
            kw_score = keyword_results.get(doc_id, {}).get("score", 0)
            vec_score = vector_results.get(doc_id, {}).get("score", 0)

            # Normalize scores (assuming max score of 1 for simplicity)
            normalized_kw = kw_score / max(r["score"] for r in keyword_results.values()) if keyword_results else 0
            normalized_vec = vec_score / max(r["score"] for r in vector_results.values()) if vector_results else 0

            combined_score = kw_weight * normalized_kw + vec_weight * normalized_vec

            doc = keyword_results.get(doc_id, vector_results.get(doc_id))["doc"]
            combined.append({
                **doc,
                "combined_score": combined_score,
                "keyword_score": kw_score,
                "vector_score": vec_score
            })

        return sorted(combined, key=lambda x: x["combined_score"], reverse=True)

# Usage
hybrid = WeightedHybridSearch(search_client, get_embedding)
results = hybrid.search("ML deployment", keyword_weight=0.3, vector_weight=0.7)
```

## Reciprocal Rank Fusion

```python
def reciprocal_rank_fusion(result_lists, k=60):
    """Combine multiple result lists using RRF"""
    scores = {}

    for results in result_lists:
        for rank, doc in enumerate(results, 1):
            doc_id = doc["id"]
            if doc_id not in scores:
                scores[doc_id] = {"doc": doc, "score": 0}

            # RRF formula: 1 / (k + rank)
            scores[doc_id]["score"] += 1 / (k + rank)

    # Sort by combined RRF score
    combined = sorted(scores.values(), key=lambda x: x["score"], reverse=True)
    return [{"doc": item["doc"], "rrf_score": item["score"]} for item in combined]

# Apply RRF to hybrid search
keyword_results = list(search_client.search(search_text="machine learning", top=50))
vector_results = list(search_client.search(
    search_text=None,
    vectors=[Vector(value=get_embedding("machine learning"), k=50, fields="content_vector")]
))

fused_results = reciprocal_rank_fusion([keyword_results, vector_results])
```

## Hybrid Search with Semantic Ranking

```python
from azure.search.documents.models import QueryType, QueryCaptionType

def semantic_hybrid_search(query, k=10):
    """Hybrid search with semantic reranking"""
    query_embedding = get_embedding(query)

    results = search_client.search(
        search_text=query,
        query_type=QueryType.SEMANTIC,
        semantic_configuration_name="my-semantic-config",
        vectors=[
            Vector(
                value=query_embedding,
                k=50,  # Over-retrieve for reranking
                fields="content_vector"
            )
        ],
        query_caption=QueryCaptionType.EXTRACTIVE,
        top=k
    )

    return list(results)

# Results are semantically reranked
results = semantic_hybrid_search("How do I deploy ML models to production?")
for r in results:
    print(f"{r['title']}")
    print(f"  Reranker Score: {r.get('@search.reranker_score', 'N/A')}")
    captions = r.get("@search.captions", [])
    if captions:
        print(f"  Caption: {captions[0].text}")
```

## Query Expansion for Hybrid Search

```python
def expanded_hybrid_search(query, k=10):
    """Hybrid search with query expansion"""

    # Generate expanded queries using embeddings
    query_embedding = get_embedding(query)

    # Also search for synonyms/related terms
    related_queries = generate_related_queries(query)  # Using LLM or thesaurus

    # Combine all keyword searches
    all_results = []

    # Original query search
    results = search_client.search(search_text=query, top=k*2)
    all_results.append(list(results))

    # Related queries
    for related in related_queries[:3]:
        results = search_client.search(search_text=related, top=k)
        all_results.append(list(results))

    # Vector search
    results = search_client.search(
        search_text=None,
        vectors=[Vector(value=query_embedding, k=k*2, fields="content_vector")]
    )
    all_results.append(list(results))

    # Combine using RRF
    return reciprocal_rank_fusion(all_results)[:k]

def generate_related_queries(query):
    """Generate related queries using OpenAI"""
    response = openai.ChatCompletion.create(
        model="gpt-3.5-turbo",
        messages=[
            {"role": "system", "content": "Generate 3 related search queries."},
            {"role": "user", "content": f"Original query: {query}"}
        ]
    )
    return response.choices[0].message.content.strip().split("\n")
```

## Adaptive Hybrid Search

```python
class AdaptiveHybridSearch:
    """Automatically adjust weights based on query characteristics"""

    def __init__(self, search_client, embedding_func):
        self.search_client = search_client
        self.get_embedding = embedding_func

    def search(self, query, k=10):
        """Search with adaptive weighting"""
        query_type = self._classify_query(query)
        weights = self._get_weights(query_type)

        return self._hybrid_search(query, weights, k)

    def _classify_query(self, query):
        """Classify query type"""
        # Short, specific queries -> favor keyword
        if len(query.split()) <= 3:
            return "keyword_focused"

        # Questions -> favor semantic/vector
        if query.strip().endswith("?") or query.lower().startswith(("how", "what", "why", "when")):
            return "semantic_focused"

        # Quotes indicate exact match need
        if '"' in query:
            return "exact_match"

        return "balanced"

    def _get_weights(self, query_type):
        """Get weights based on query type"""
        weights = {
            "keyword_focused": {"keyword": 0.7, "vector": 0.3},
            "semantic_focused": {"keyword": 0.3, "vector": 0.7},
            "exact_match": {"keyword": 0.9, "vector": 0.1},
            "balanced": {"keyword": 0.5, "vector": 0.5}
        }
        return weights.get(query_type, weights["balanced"])

    def _hybrid_search(self, query, weights, k):
        """Execute hybrid search with given weights"""
        embedding = self.get_embedding(query)

        results = self.search_client.search(
            search_text=query,
            vectors=[Vector(value=embedding, k=k, fields="content_vector")],
            top=k
        )

        return list(results)

# Usage
adaptive = AdaptiveHybridSearch(search_client, get_embedding)
results = adaptive.search("How to implement neural networks?")
```

Hybrid search patterns enable building search systems that handle diverse query types effectively.
