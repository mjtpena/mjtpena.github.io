---
title: "Azure AI Search: Implementing Hybrid Search with Vectors and Keywords"
description: "Hybrid search significantly improves retrieval quality for RAG applications by leveraging both semantic understanding and exact keyword matching."
author: Michael John Peña
draft: false
date: 2025-10-10
tags:
  - Azure AI Search
  - Vector Search
  - Hybrid Search
  - RAG
  - Semantic Search
---

## Setting Up Hybrid Search Index

Create an index that supports both keyword and vector search:

```python
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex, SearchField, SearchFieldDataType,
    VectorSearch, HnswAlgorithmConfiguration, VectorSearchProfile,
    SemanticConfiguration, SemanticField, SemanticPrioritizedFields, SemanticSearch
)
from azure.identity import DefaultAzureCredential

def create_hybrid_search_index(endpoint: str, index_name: str, vector_dimensions: int = 1536) -> SearchIndex:
    """Create an index supporting hybrid search."""

    client = SearchIndexClient(endpoint, DefaultAzureCredential())

    fields = [
        SearchField(name="id", type=SearchFieldDataType.String, key=True),
        SearchField(name="content", type=SearchFieldDataType.String, searchable=True, analyzer_name="en.microsoft"),
        SearchField(name="title", type=SearchFieldDataType.String, searchable=True),
        SearchField(
            name="content_vector",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            searchable=True,
            vector_search_dimensions=vector_dimensions,
            vector_search_profile_name="vector-profile"
        ),
        SearchField(name="category", type=SearchFieldDataType.String, filterable=True)
    ]

    vector_search = VectorSearch(
        algorithms=[HnswAlgorithmConfiguration(name="hnsw-config", parameters={"m": 4, "efConstruction": 400, "efSearch": 500, "metric": "cosine"})],
        profiles=[VectorSearchProfile(name="vector-profile", algorithm_configuration_name="hnsw-config")]
    )

    return client.create_or_update_index(SearchIndex(name=index_name, fields=fields, vector_search=vector_search))
```

## Executing Hybrid Queries

Combine keyword and vector search with semantic reranking:

```python
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery
from openai import AzureOpenAI

class HybridSearchService:
    def __init__(self, search_endpoint: str, index_name: str, openai_client: AzureOpenAI):
        self.search_client = SearchClient(endpoint=search_endpoint, index_name=index_name, credential=DefaultAzureCredential())
        self.openai_client = openai_client

    def get_embedding(self, text: str) -> list[float]:
        """Generate embedding for search query."""
        response = self.openai_client.embeddings.create(model="text-embedding-3-small", input=text)
        return response.data[0].embedding

    def hybrid_search(self, query: str, top_k: int = 10, category_filter: str = None) -> list[dict]:
        """Execute hybrid search with semantic reranking."""

        query_vector = self.get_embedding(query)
        vector_query = VectorizedQuery(vector=query_vector, k_nearest_neighbors=top_k * 2, fields="content_vector")
        filter_expr = f"category eq '{category_filter}'" if category_filter else None

        results = self.search_client.search(
            search_text=query,
            vector_queries=[vector_query],
            filter=filter_expr,
            select=["id", "title", "content", "category"],
            top=top_k,
            query_type="semantic",
            semantic_configuration_name="semantic-config"
        )

        return [{"id": r["id"], "title": r["title"], "content": r["content"], "score": r["@search.score"]} for r in results]
```

Hybrid search significantly improves retrieval quality for RAG applications by leveraging both semantic understanding and exact keyword matching.
