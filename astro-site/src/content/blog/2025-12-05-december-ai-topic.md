---
title: "Building Production RAG Systems: Best Practices for 2026"
description: "Production RAG is iterative. Start simple, measure everything, and improve based on real user feedback."
author: Michael John Peña
draft: false
date: 2025-12-05
tags:
  - RAG
  - AI
  - Best-Practices
  - Vector-Search
  - Production
---

## Architecture Fundamentals

A production RAG system needs more than just a vector database and an LLM. Here's the architecture that works:

```
Documents -> Chunking -> Embedding -> Vector Store
                                        |
User Query -> Query Expansion -> Retrieval -> Reranking -> LLM -> Response
                                                         |
                                              Context Assembly
```

## Chunking Strategy

Chunk size dramatically impacts retrieval quality. After extensive testing:

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

def create_optimal_splitter(doc_type: str):
    """Create chunking strategy based on document type."""
    configs = {
        "technical_docs": {
            "chunk_size": 1000,
            "chunk_overlap": 200,
            "separators": ["\n## ", "\n### ", "\n\n", "\n", " "]
        },
        "legal_contracts": {
            "chunk_size": 1500,
            "chunk_overlap": 300,
            "separators": ["\nSection ", "\nArticle ", "\n\n", "\n"]
        },
        "support_articles": {
            "chunk_size": 500,
            "chunk_overlap": 100,
            "separators": ["\n\n", "\n", ". ", " "]
        }
    }

    config = configs.get(doc_type, configs["technical_docs"])
    return RecursiveCharacterTextSplitter(**config)
```

## Hybrid Search is Essential

Vector search alone isn't enough. Combine semantic and keyword search:

```python
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery

async def hybrid_search(query: str, top_k: int = 10):
    # Get embedding for semantic search
    embedding = await get_embedding(query)

    vector_query = VectorizedQuery(
        vector=embedding,
        k_nearest_neighbors=top_k,
        fields="content_vector"
    )

    # Hybrid search with RRF fusion
    results = search_client.search(
        search_text=query,  # BM25 keyword search
        vector_queries=[vector_query],  # Vector search
        query_type="semantic",
        semantic_configuration_name="default",
        top=top_k
    )

    return [{"content": r["content"], "score": r["@search.score"]}
            for r in results]
```

## Reranking Improves Precision

Add a reranking step before sending to the LLM:

```python
from cohere import Client

cohere_client = Client(api_key="your-key")

def rerank_results(query: str, documents: list, top_n: int = 5):
    response = cohere_client.rerank(
        query=query,
        documents=[d["content"] for d in documents],
        top_n=top_n,
        model="rerank-english-v3.0"
    )

    return [documents[r.index] for r in response.results]
```

## Key Metrics to Track

1. **Retrieval Recall@K** - Are relevant documents being retrieved?
2. **Answer Faithfulness** - Does the answer match the source?
3. **Latency P95** - Keep under 3 seconds for good UX
4. **Cost per Query** - Monitor embedding + LLM costs

Production RAG is iterative. Start simple, measure everything, and improve based on real user feedback.
