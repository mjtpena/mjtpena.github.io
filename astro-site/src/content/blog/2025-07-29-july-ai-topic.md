---
title: "Building AI-Powered Search with Azure AI Search and Semantic Ranker"
description: "Monitor reranker scores and caption extraction quality. A/B test semantic ranking against pure vector or keyword search to quantify improvements for your…"
author: Michael John Peña
draft: false
date: 2025-07-29
tags:
  - Azure AI Search
  - Semantic Search
  - Search Relevance
  - Python
  - Enterprise Search
---

## Configuring Semantic Search

Set up your index with semantic configuration:

```python
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SearchField,
    SearchFieldDataType,
    SemanticConfiguration,
    SemanticField,
    SemanticPrioritizedFields,
    SemanticSearch,
    VectorSearch,
    VectorSearchProfile,
    HnswAlgorithmConfiguration
)

index_client = SearchIndexClient(endpoint, credential)

# Define semantic configuration
semantic_config = SemanticConfiguration(
    name="default",
    prioritized_fields=SemanticPrioritizedFields(
        title_field=SemanticField(field_name="title"),
        content_fields=[
            SemanticField(field_name="content"),
            SemanticField(field_name="summary")
        ],
        keywords_fields=[
            SemanticField(field_name="tags")
        ]
    )
)

index = SearchIndex(
    name="knowledge-base",
    fields=[
        SearchField(name="id", type=SearchFieldDataType.String, key=True),
        SearchField(name="title", type=SearchFieldDataType.String, searchable=True),
        SearchField(name="content", type=SearchFieldDataType.String, searchable=True),
        SearchField(name="summary", type=SearchFieldDataType.String, searchable=True),
        SearchField(name="tags", type=SearchFieldDataType.Collection(SearchFieldDataType.String)),
        SearchField(
            name="embedding",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            vector_search_dimensions=1536,
            vector_search_profile_name="vector-profile"
        )
    ],
    vector_search=VectorSearch(
        algorithms=[HnswAlgorithmConfiguration(name="hnsw")],
        profiles=[VectorSearchProfile(name="vector-profile", algorithm_configuration_name="hnsw")]
    ),
    semantic_search=SemanticSearch(configurations=[semantic_config])
)

index_client.create_or_update_index(index)
```

## Hybrid Search Queries

Combine all three search modes for optimal results:

```python
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery, QueryType

search_client = SearchClient(endpoint, "knowledge-base", credential)

async def hybrid_search(query: str, query_embedding: list[float], top_k: int = 10):
    results = search_client.search(
        search_text=query,
        vector_queries=[
            VectorizedQuery(
                vector=query_embedding,
                k_nearest_neighbors=50,
                fields="embedding"
            )
        ],
        query_type=QueryType.SEMANTIC,
        semantic_configuration_name="default",
        query_caption="extractive",
        query_answer="extractive",
        top=top_k
    )

    search_results = []
    for result in results:
        search_results.append({
            "id": result["id"],
            "title": result["title"],
            "score": result["@search.score"],
            "reranker_score": result.get("@search.reranker_score"),
            "captions": result.get("@search.captions"),
            "answers": result.get("@search.answers")
        })

    return search_results
```

## Analyzing Search Quality

Monitor reranker scores and caption extraction quality. A/B test semantic ranking against pure vector or keyword search to quantify improvements for your specific domain.
