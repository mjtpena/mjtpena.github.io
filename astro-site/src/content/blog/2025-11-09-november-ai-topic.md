---
title: "Azure AI Search: Implementing Hybrid Search for Better RAG Results"
description: "Pure vector search excels at semantic similarity but can miss exact keyword matches. Pure keyword search finds exact terms but misses conceptually similar…"
author: Michael John Peña
draft: false
date: 2025-11-09
tags:
  - Azure AI Search
  - RAG
  - Vector Search
  - Hybrid Search
  - Information Retrieval
---

## Why Hybrid Search Wins

Pure vector search excels at semantic similarity but can miss exact keyword matches. Pure keyword search finds exact terms but misses conceptually similar content. Hybrid search captures both, improving recall and precision.

## Configuring Hybrid Search

Set up Azure AI Search with both vector and keyword capabilities:

```python
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SearchField,
    SearchFieldDataType,
    VectorSearch,
    HnswAlgorithmConfiguration,
    VectorSearchProfile,
    SemanticConfiguration,
    SemanticField,
    SemanticPrioritizedFields,
    SemanticSearch
)
from azure.identity import DefaultAzureCredential

# Create index with hybrid search configuration
index = SearchIndex(
    name="documents-hybrid",
    fields=[
        SearchField(name="id", type=SearchFieldDataType.String, key=True),
        SearchField(name="title", type=SearchFieldDataType.String, searchable=True),
        SearchField(name="content", type=SearchFieldDataType.String, searchable=True),
        SearchField(name="category", type=SearchFieldDataType.String, filterable=True),
        SearchField(
            name="content_vector",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            searchable=True,
            vector_search_dimensions=1536,
            vector_search_profile_name="vector-profile"
        )
    ],
    vector_search=VectorSearch(
        algorithms=[
            HnswAlgorithmConfiguration(
                name="hnsw-config",
                parameters={
                    "m": 4,
                    "efConstruction": 400,
                    "efSearch": 500,
                    "metric": "cosine"
                }
            )
        ],
        profiles=[
            VectorSearchProfile(
                name="vector-profile",
                algorithm_configuration_name="hnsw-config"
            )
        ]
    ),
    semantic_search=SemanticSearch(
        configurations=[
            SemanticConfiguration(
                name="semantic-config",
                prioritized_fields=SemanticPrioritizedFields(
                    title_field=SemanticField(field_name="title"),
                    content_fields=[SemanticField(field_name="content")]
                )
            )
        ]
    )
)

index_client = SearchIndexClient(
    endpoint="https://your-search.search.windows.net",
    credential=DefaultAzureCredential()
)
index_client.create_or_update_index(index)
```

## Executing Hybrid Queries

Combine vector, keyword, and semantic ranking in a single query:

```python
from azure.search.documents.models import VectorizedQuery

def hybrid_search(
    search_client: SearchClient,
    query: str,
    query_vector: list[float],
    top_k: int = 10,
    category_filter: str = None
) -> list[dict]:
    """Execute hybrid search with optional filtering."""

    vector_query = VectorizedQuery(
        vector=query_vector,
        k_nearest_neighbors=top_k * 2,  # Retrieve more for fusion
        fields="content_vector"
    )

    filter_expr = f"category eq '{category_filter}'" if category_filter else None

    results = search_client.search(
        search_text=query,  # Keyword search
        vector_queries=[vector_query],  # Vector search
        query_type="semantic",  # Enable semantic ranking
        semantic_configuration_name="semantic-config",
        filter=filter_expr,
        top=top_k,
        select=["id", "title", "content", "category"]
    )

    documents = []
    for result in results:
        documents.append({
            "id": result["id"],
            "title": result["title"],
            "content": result["content"],
            "score": result["@search.score"],
            "reranker_score": result.get("@search.reranker_score")
        })

    return documents

# Usage with OpenAI embeddings
from openai import AzureOpenAI

client = AzureOpenAI(...)
embedding = client.embeddings.create(
    model="text-embedding-ada-002",
    input="How do I configure network security?"
).data[0].embedding

results = hybrid_search(search_client, "configure network security", embedding)
```

Hybrid search typically improves RAG accuracy by 15-25% compared to pure vector search. The combination of keyword precision and semantic understanding delivers more relevant context to the LLM.
