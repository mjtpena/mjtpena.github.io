---
title: "Improved Vector Search in Azure AI Search: Deep Dive"
author: Michael John Peña
draft: false
date: 2024-07-26
tags:
  - Azure
  - Vector Search
  - AI Search
  - HNSW
  - Performance
---

## Vector Search Fundamentals

Vector search finds similar items by comparing their mathematical representations (embeddings). The key components:

- **Embeddings**: Dense vectors representing semantic meaning
- **Index structure**: How vectors are organized for fast retrieval
- **Distance metric**: How similarity is calculated
- **Approximate nearest neighbor (ANN)**: Trade-off between speed and accuracy

## HNSW Algorithm Deep Dive

Azure AI Search uses HNSW (Hierarchical Navigable Small World) for approximate nearest neighbor search:

```
Level 2:  [A] -------- [B]
           |
Level 1:  [A] -- [C] -- [B] -- [D]
           |      |      |
Level 0:  [A]-[E]-[C]-[F]-[B]-[G]-[D]-[H]
```

**Key Parameters:**

```python
from azure.search.documents.indexes.models import (
    HnswAlgorithmConfiguration, HnswParameters
)

# Understanding each parameter
hnsw_config = HnswAlgorithmConfiguration(
    name="optimized",
    parameters=HnswParameters(
        # m: Number of bi-directional links per node
        # Higher = better recall, more memory, slower indexing
        # Range: 4-10, Default: 4
        m=6,

        # efConstruction: Size of dynamic candidate list during index building
        # Higher = better index quality, slower indexing
        # Range: 100-1000, Default: 400
        ef_construction=600,

        # efSearch: Size of dynamic candidate list during search
        # Higher = better recall, slower search
        # Range: 100-1000, Default: 500
        ef_search=500,

        # metric: Distance function
        # Options: cosine, euclidean, dotProduct
        metric="cosine"
    )
)
```

## Choosing the Right Configuration

**High Recall Configuration** (when accuracy matters most):

```python
high_recall = HnswAlgorithmConfiguration(
    name="high-recall",
    parameters=HnswParameters(
        m=8,
        ef_construction=800,
        ef_search=800,
        metric="cosine"
    )
)
# Use case: Legal document search, medical records
# Trade-off: 20-30% slower queries, 2x index size
```

**Balanced Configuration** (recommended for most use cases):

```python
balanced = HnswAlgorithmConfiguration(
    name="balanced",
    parameters=HnswParameters(
        m=4,
        ef_construction=400,
        ef_search=500,
        metric="cosine"
    )
)
# Use case: General RAG applications, chatbots
```

**High Speed Configuration** (when latency is critical):

```python
high_speed = HnswAlgorithmConfiguration(
    name="high-speed",
    parameters=HnswParameters(
        m=4,
        ef_construction=200,
        ef_search=200,
        metric="cosine"
    )
)
# Use case: Real-time autocomplete, high-volume APIs
# Trade-off: 5-10% lower recall
```

## Multi-Vector Indexing

Index multiple embeddings per document for different search scenarios:

```python
from azure.search.documents.indexes.models import (
    SearchIndex, SearchField, SearchFieldDataType,
    VectorSearch, VectorSearchProfile
)

index = SearchIndex(
    name="multi-vector-index",
    fields=[
        SearchField(name="id", type=SearchFieldDataType.String, key=True),
        SearchField(name="title", type=SearchFieldDataType.String),
        SearchField(name="content", type=SearchFieldDataType.String),

        # Title embedding - for title-focused searches
        SearchField(
            name="title_vector",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            vector_search_dimensions=1536,
            vector_search_profile_name="title-profile"
        ),

        # Content embedding - for content searches
        SearchField(
            name="content_vector",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            vector_search_dimensions=1536,
            vector_search_profile_name="content-profile"
        ),

        # Question embedding - trained on questions about content
        SearchField(
            name="question_vector",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            vector_search_dimensions=1536,
            vector_search_profile_name="question-profile"
        )
    ],
    vector_search=VectorSearch(
        algorithms=[
            HnswAlgorithmConfiguration(name="hnsw-high", parameters=HnswParameters(m=6, ef_search=600)),
            HnswAlgorithmConfiguration(name="hnsw-fast", parameters=HnswParameters(m=4, ef_search=300))
        ],
        profiles=[
            VectorSearchProfile(name="title-profile", algorithm_configuration_name="hnsw-fast"),
            VectorSearchProfile(name="content-profile", algorithm_configuration_name="hnsw-high"),
            VectorSearchProfile(name="question-profile", algorithm_configuration_name="hnsw-high")
        ]
    )
)
```

## Weighted Multi-Vector Search

```python
from azure.search.documents.models import VectorizedQuery

def multi_vector_search(query: str, query_type: str = "general"):
    embeddings = generate_embedding(query)

    # Weight vectors based on query type
    if query_type == "question":
        weights = {"question": 0.6, "content": 0.3, "title": 0.1}
    elif query_type == "title_lookup":
        weights = {"title": 0.7, "content": 0.3, "question": 0.0}
    else:
        weights = {"content": 0.5, "question": 0.3, "title": 0.2}

    vector_queries = []

    if weights["title"] > 0:
        vector_queries.append(VectorizedQuery(
            vector=embeddings,
            k_nearest_neighbors=50,
            fields="title_vector",
            weight=weights["title"]
        ))

    if weights["content"] > 0:
        vector_queries.append(VectorizedQuery(
            vector=embeddings,
            k_nearest_neighbors=50,
            fields="content_vector",
            weight=weights["content"]
        ))

    if weights["question"] > 0:
        vector_queries.append(VectorizedQuery(
            vector=embeddings,
            k_nearest_neighbors=50,
            fields="question_vector",
            weight=weights["question"]
        ))

    results = client.search(
        search_text=None,
        vector_queries=vector_queries,
        top=10
    )

    return list(results)
```

## Filtering with Vector Search

Combine filters with vector search efficiently:

```python
# Pre-filtering: Filter before vector search (more efficient for selective filters)
# Post-filtering: Filter after vector search (more accurate for broad filters)

def filtered_vector_search(
    query_embedding: list[float],
    category: str = None,
    date_from: str = None,
    min_score: float = None
):
    # Build filter
    filters = []
    if category:
        filters.append(f"category eq '{category}'")
    if date_from:
        filters.append(f"date ge {date_from}")

    filter_str = " and ".join(filters) if filters else None

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=100,  # Over-fetch when filtering
        fields="content_vector"
    )

    results = client.search(
        search_text=None,
        vector_queries=[vector_query],
        filter=filter_str,
        top=20
    )

    # Post-filter by score if needed
    if min_score:
        return [r for r in results if r["@search.score"] >= min_score]

    return list(results)
```

## Monitoring Vector Search Performance

```python
import time
from dataclasses import dataclass
from typing import Optional

@dataclass
class SearchMetrics:
    query_time_ms: float
    result_count: int
    top_score: float
    avg_score: float
    filter_applied: bool

def measure_search(query_func, *args, **kwargs) -> tuple[list, SearchMetrics]:
    """Measure search performance."""
    start = time.perf_counter()
    results = list(query_func(*args, **kwargs))
    elapsed = (time.perf_counter() - start) * 1000

    scores = [r.get("@search.score", 0) for r in results]

    metrics = SearchMetrics(
        query_time_ms=elapsed,
        result_count=len(results),
        top_score=max(scores) if scores else 0,
        avg_score=sum(scores) / len(scores) if scores else 0,
        filter_applied="filter" in kwargs
    )

    return results, metrics

# Usage
results, metrics = measure_search(
    client.search,
    search_text=None,
    vector_queries=[vector_query],
    top=10
)

print(f"Query time: {metrics.query_time_ms:.2f}ms")
print(f"Results: {metrics.result_count}")
print(f"Top score: {metrics.top_score:.4f}")
```

## Optimizing Index Performance

**Batch Indexing:**

```python
from azure.search.documents import SearchClient
from concurrent.futures import ThreadPoolExecutor
import itertools

def batch_index_documents(documents: list[dict], batch_size: int = 1000):
    """Index documents in parallel batches."""

    def index_batch(batch):
        return client.upload_documents(documents=batch)

    # Split into batches
    batches = [
        documents[i:i + batch_size]
        for i in range(0, len(documents), batch_size)
    ]

    # Index in parallel
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(index_batch, batches))

    # Summarize results
    total_succeeded = sum(r.succeeded_count for r in results)
    total_failed = sum(r.failed_count for r in results)

    return {"succeeded": total_succeeded, "failed": total_failed}
```

**Index Warm-up:**

```python
async def warm_up_index(sample_queries: list[str]):
    """Warm up index with representative queries."""
    for query in sample_queries:
        embedding = await generate_embedding(query)
        vector_query = VectorizedQuery(
            vector=embedding,
            k_nearest_neighbors=10,
            fields="content_vector"
        )
        # Fire and forget
        list(client.search(search_text=None, vector_queries=[vector_query], top=1))

    print(f"Warmed up with {len(sample_queries)} queries")
```

## Best Practices

1. **Choose embedding model carefully**: Dimensions affect storage and speed
2. **Tune HNSW for your workload**: Test different configurations
3. **Use multi-vector for different search types**: Title, content, questions
4. **Over-fetch when filtering**: Request more than you need
5. **Monitor performance**: Track latency and recall
6. **Batch index updates**: Don't index one document at a time

## Conclusion

Vector search in Azure AI Search has matured significantly. Understanding HNSW parameters, multi-vector strategies, and performance optimization allows you to build highly effective search applications.

Start with balanced settings, measure your specific workload, and tune from there.
