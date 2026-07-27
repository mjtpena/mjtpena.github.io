---
title: "Implementing Hybrid Search in Azure AI Search"
author: Michael John Peña
draft: false
date: 2025-08-12
tags:
  - Azure AI Search
  - Hybrid Search
  - Vector Search
  - RAG
  - Information Retrieval

---

I wrote "Implementing Hybrid Search in Azure AI Search" to share practical, production-minded guidance on this topic.

## Understanding Hybrid Search

Keyword search excels at exact matches and rare terms. Vector search captures semantic similarity. Combining them leverages both strengths while mitigating individual weaknesses.

## Setting Up the Index

```python
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex, SearchField, SearchFieldDataType,
    VectorSearch, HnswAlgorithmConfiguration, VectorSearchProfile,
    SemanticConfiguration, SemanticSearch, SemanticPrioritizedFields,
    SemanticField
)

# Define index with vector and keyword fields
index = SearchIndex(
    name="hybrid-knowledge-base",
    fields=[
        SearchField(name="id", type=SearchFieldDataType.String, key=True),
        SearchField(name="title", type=SearchFieldDataType.String, searchable=True),
        SearchField(name="content", type=SearchFieldDataType.String, searchable=True),
        SearchField(
            name="content_vector",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            searchable=True,
            vector_search_dimensions=1536,
            vector_search_profile_name="vector-profile"
        )
    ],
    vector_search=VectorSearch(
        algorithms=[HnswAlgorithmConfiguration(name="hnsw-config")],
        profiles=[VectorSearchProfile(name="vector-profile", algorithm_configuration_name="hnsw-config")]
    ),
    semantic_search=SemanticSearch(
        configurations=[SemanticConfiguration(
            name="semantic-config",
            prioritized_fields=SemanticPrioritizedFields(
                content_fields=[SemanticField(field_name="content")]
            )
        )]
    )
)
```

## Executing Hybrid Queries

```python
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery

def hybrid_search(query: str, query_embedding: list[float], top_k: int = 5):
    search_client = SearchClient(endpoint, index_name, credential)

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=top_k,
        fields="content_vector"
    )

    results = search_client.search(
        search_text=query,  # Keyword search
        vector_queries=[vector_query],  # Vector search
        query_type="semantic",
        semantic_configuration_name="semantic-config",
        top=top_k
    )

    return list(results)
```

Hybrid search with semantic ranking typically improves retrieval relevance by 15-30% compared to vector-only approaches, making it the recommended pattern for production RAG systems.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
