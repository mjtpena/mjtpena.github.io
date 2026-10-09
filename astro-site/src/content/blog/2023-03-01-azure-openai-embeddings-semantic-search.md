---
title: "Building Semantic Search with Azure OpenAI Embeddings"
description: "Embeddings are numerical representations of text that capture semantic meaning. Similar concepts have similar vectors. Azure OpenAI provides the…"
author: Michael John Pena
draft: false
date: 2023-03-01
tags:
  - Azure
  - OpenAI
  - AI
  - Embeddings
  - Semantic Search
---

## What Are Embeddings?

Embeddings are numerical representations of text that capture semantic meaning. Similar concepts have similar vectors. Azure OpenAI provides the `text-embedding-ada-002` model, which creates 1536-dimensional vectors.

```python
import openai
from azure.identity import DefaultAzureCredential

# Configure Azure OpenAI
openai.api_type = "azure"
openai.api_base = "https://your-resource.openai.azure.com/"
openai.api_version = "2023-03-15-preview"
openai.api_key = "your-api-key"

def get_embedding(text: str) -> list[float]:
    """Generate embedding for text using Azure OpenAI."""
    response = openai.Embedding.create(
        input=text,
        engine="text-embedding-ada-002"  # Your deployment name
    )
    return response['data'][0]['embedding']

# Example usage
doc_embedding = get_embedding("Azure Data Factory is a cloud ETL service")
query_embedding = get_embedding("How do I move data in Azure?")
```

## Computing Similarity

Cosine similarity measures how similar two vectors are:

```python
import numpy as np

def cosine_similarity(vec1: list[float], vec2: list[float]) -> float:
    """Calculate cosine similarity between two vectors."""
    a = np.array(vec1)
    b = np.array(vec2)
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

# Compare query to document
similarity = cosine_similarity(query_embedding, doc_embedding)
print(f"Similarity: {similarity:.4f}")  # Higher = more similar
```

## Building a Simple Search Index

For a proof of concept, we can store embeddings in memory:

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class Document:
    id: str
    content: str
    embedding: Optional[list[float]] = None

class SemanticSearchIndex:
    def __init__(self):
        self.documents: list[Document] = []

    def add_document(self, doc_id: str, content: str):
        """Add a document with its embedding."""
        embedding = get_embedding(content)
        self.documents.append(Document(
            id=doc_id,
            content=content,
            embedding=embedding
        ))

    def search(self, query: str, top_k: int = 5) -> list[tuple[Document, float]]:
        """Search for similar documents."""
        query_embedding = get_embedding(query)

        results = []
        for doc in self.documents:
            similarity = cosine_similarity(query_embedding, doc.embedding)
            results.append((doc, similarity))

        # Sort by similarity descending
        results.sort(key=lambda x: x[1], reverse=True)
        return results[:top_k]

# Usage
index = SemanticSearchIndex()
index.add_document("doc1", "Azure Synapse Analytics provides unified analytics")
index.add_document("doc2", "Databricks is a lakehouse platform")
index.add_document("doc3", "Power BI creates interactive dashboards")

results = index.search("data visualization tool")
for doc, score in results:
    print(f"{doc.id}: {score:.4f} - {doc.content[:50]}...")
```

## Scaling with Azure Cognitive Search

For production, use Azure Cognitive Search with vector support:

```python
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SearchField,
    SearchFieldDataType,
    VectorSearch,
    HnswVectorSearchAlgorithmConfiguration,
)
from azure.core.credentials import AzureKeyCredential

# Create index with vector field
index = SearchIndex(
    name="documents",
    fields=[
        SearchField(name="id", type=SearchFieldDataType.String, key=True),
        SearchField(name="content", type=SearchFieldDataType.String, searchable=True),
        SearchField(
            name="contentVector",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            searchable=True,
            vector_search_dimensions=1536,
            vector_search_configuration="my-vector-config"
        ),
    ],
    vector_search=VectorSearch(
        algorithm_configurations=[
            HnswVectorSearchAlgorithmConfiguration(name="my-vector-config")
        ]
    )
)

# Search with vector
search_client = SearchClient(
    endpoint="https://your-search.search.windows.net",
    index_name="documents",
    credential=AzureKeyCredential("your-key")
)

results = search_client.search(
    search_text=None,
    vector=query_embedding,
    top_k=10,
    vector_fields="contentVector"
)
```

## Chunking Strategies

Large documents need to be split into chunks:

```python
def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """Split text into overlapping chunks."""
    words = text.split()
    chunks = []

    for i in range(0, len(words), chunk_size - overlap):
        chunk = ' '.join(words[i:i + chunk_size])
        chunks.append(chunk)

        if i + chunk_size >= len(words):
            break

    return chunks

# Chunk and embed a large document
document = "..." # Your large document
chunks = chunk_text(document)

for i, chunk in enumerate(chunks):
    index.add_document(f"doc1_chunk{i}", chunk)
```

## Hybrid Search

Combine semantic and keyword search for best results:

```python
def hybrid_search(query: str, index: SemanticSearchIndex, keyword_weight: float = 0.3):
    """Combine semantic and keyword search."""
    # Semantic results
    semantic_results = index.search(query, top_k=20)

    # Simple keyword matching
    query_terms = set(query.lower().split())
    keyword_scores = {}

    for doc in index.documents:
        doc_terms = set(doc.content.lower().split())
        overlap = len(query_terms & doc_terms)
        keyword_scores[doc.id] = overlap / len(query_terms) if query_terms else 0

    # Combine scores
    combined = {}
    for doc, semantic_score in semantic_results:
        keyword_score = keyword_scores.get(doc.id, 0)
        combined[doc.id] = (
            (1 - keyword_weight) * semantic_score +
            keyword_weight * keyword_score
        )

    # Sort and return
    sorted_results = sorted(combined.items(), key=lambda x: x[1], reverse=True)
    return sorted_results[:10]
```

## Cost Optimization

Embeddings cost ~$0.0004 per 1K tokens. Strategies to optimize:

1. **Cache embeddings**: Store and reuse document embeddings
2. **Batch requests**: Embed multiple texts in one API call
3. **Pre-compute**: Generate embeddings during ingestion, not query time

```python
def batch_embed(texts: list[str], batch_size: int = 100) -> list[list[float]]:
    """Embed multiple texts efficiently."""
    embeddings = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        response = openai.Embedding.create(
            input=batch,
            engine="text-embedding-ada-002"
        )
        batch_embeddings = [item['embedding'] for item in response['data']]
        embeddings.extend(batch_embeddings)

    return embeddings
```

## Real-World Application

I've been using semantic search for internal documentation at clients. Results are dramatically better than keyword search - users find answers even when they don't know the exact terminology.

Next steps to explore:
- Adding metadata filtering
- Re-ranking with cross-encoders
- Integrating with RAG patterns

The combination of Azure OpenAI embeddings and Azure Cognitive Search provides a production-ready semantic search foundation.
