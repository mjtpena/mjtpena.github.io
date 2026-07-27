---
title: "Hybrid Search: Combining Vector and Keyword Search in Azure AI Search"
author: Michael John Peña
draft: false
date: 2025-09-09
tags:
  - Azure AI Search
  - Hybrid Search
  - Vector Search
  - RAG
  - Information Retrieval

---

I wrote "Hybrid Search: Combining Vector and Keyword Search in Azure AI Search" to share practical, production-minded guidance on this topic.

## Why Hybrid Search Wins

Vector search excels at semantic similarity but can miss exact matches. Keyword search finds precise terms but misses synonyms and context. Together, they cover each other's weaknesses.

## Implementing Hybrid Search

```python
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery
from azure.core.credentials import AzureKeyCredential
from openai import AzureOpenAI
import os

# Initialize clients
search_client = SearchClient(
    endpoint=os.environ["AZURE_SEARCH_ENDPOINT"],
    index_name="documents-index",
    credential=AzureKeyCredential(os.environ["AZURE_SEARCH_KEY"])
)

openai_client = AzureOpenAI(
    api_key=os.environ["AZURE_OPENAI_KEY"],
    api_version="2024-06-01",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"]
)

def get_embedding(text: str) -> list[float]:
    """Generate embedding for search query."""
    response = openai_client.embeddings.create(
        model="text-embedding-3-large",
        input=text
    )
    return response.data[0].embedding

def hybrid_search(query: str, top_k: int = 10) -> list[dict]:
    """Execute hybrid search combining vector and keyword search."""

    # Generate query embedding
    query_vector = get_embedding(query)

    # Create vector query
    vector_query = VectorizedQuery(
        vector=query_vector,
        k_nearest_neighbors=top_k,
        fields="content_vector"
    )

    # Execute hybrid search
    results = search_client.search(
        search_text=query,  # Keyword search
        vector_queries=[vector_query],  # Vector search
        select=["id", "title", "content", "url", "last_updated"],
        top=top_k,
        query_type="semantic",  # Enable semantic ranking
        semantic_configuration_name="my-semantic-config"
    )

    documents = []
    for result in results:
        documents.append({
            "id": result["id"],
            "title": result["title"],
            "content": result["content"],
            "url": result["url"],
            "score": result["@search.score"],
            "reranker_score": result.get("@search.reranker_score")
        })

    return documents
```

## Configuring the Search Index

```json
{
  "name": "documents-index",
  "fields": [
    {"name": "id", "type": "Edm.String", "key": true},
    {"name": "title", "type": "Edm.String", "searchable": true},
    {"name": "content", "type": "Edm.String", "searchable": true},
    {"name": "content_vector", "type": "Collection(Edm.Single)",
     "dimensions": 3072, "vectorSearchProfile": "my-vector-profile"},
    {"name": "url", "type": "Edm.String"},
    {"name": "last_updated", "type": "Edm.DateTimeOffset", "filterable": true}
  ],
  "vectorSearch": {
    "profiles": [{"name": "my-vector-profile", "algorithm": "my-hnsw"}],
    "algorithms": [{"name": "my-hnsw", "kind": "hnsw"}]
  },
  "semantic": {
    "configurations": [{
      "name": "my-semantic-config",
      "prioritizedFields": {
        "titleField": {"fieldName": "title"},
        "contentFields": [{"fieldName": "content"}]
      }
    }]
  }
}
```

## Tuning the Balance

Experiment with different weights between keyword and vector scores. For technical documentation, keyword matching often deserves higher weight. For conversational queries, lean toward semantic search.

Hybrid search is not just an improvement; it is a fundamental shift toward more robust information retrieval.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
