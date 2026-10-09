---
title: "Vector Search Preview in Azure Cognitive Search"
description: "Vector search enables powerful similarity-based retrieval that complements traditional keyword search."
author: "Michael John Peña"
draft: false
date: 2022-08-24
tags: ["Azure", "Cognitive Search", "Vector Search", "Embeddings", "AI"]
---

## Understanding Vector Search

Vector search works by:
1. Converting documents and queries into numerical vectors (embeddings)
2. Finding documents with vectors similar to the query vector
3. Using distance metrics like cosine similarity

## Setting Up Vector Search

```python
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SimpleField,
    SearchableField,
    SearchFieldDataType,
    VectorSearch,
    VectorSearchAlgorithmConfiguration,
    VectorSearchProfile,
    HnswParameters
)
from azure.core.credentials import AzureKeyCredential

endpoint = "https://mysearchservice.search.windows.net"
credential = AzureKeyCredential("your-admin-key")

index_client = SearchIndexClient(endpoint=endpoint, credential=credential)

# Define vector search configuration
vector_search = VectorSearch(
    algorithms=[
        VectorSearchAlgorithmConfiguration(
            name="my-hnsw-config",
            kind="hnsw",
            hnsw_parameters=HnswParameters(
                m=4,  # Number of bi-directional links
                ef_construction=400,  # Size of dynamic candidate list during indexing
                ef_search=500,  # Size of dynamic candidate list during search
                metric="cosine"  # Similarity metric
            )
        )
    ],
    profiles=[
        VectorSearchProfile(
            name="my-vector-profile",
            algorithm="my-hnsw-config"
        )
    ]
)

# Define fields including vector field
fields = [
    SimpleField(name="id", type=SearchFieldDataType.String, key=True),
    SearchableField(name="title", type=SearchFieldDataType.String),
    SearchableField(name="content", type=SearchFieldDataType.String),
    SimpleField(
        name="content_vector",
        type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
        searchable=True,
        vector_search_dimensions=1536,  # OpenAI ada-002 dimension
        vector_search_profile="my-vector-profile"
    )
]

# Create index with vector search
index = SearchIndex(
    name="vector-search-index",
    fields=fields,
    vector_search=vector_search
)

index_client.create_or_update_index(index)
```

## Generating Embeddings

```python
import openai
import numpy as np

# Configure OpenAI
openai.api_key = "your-openai-key"

def get_embedding(text, model="text-embedding-ada-002"):
    """Generate embedding for text using OpenAI"""
    response = openai.Embedding.create(
        input=text,
        model=model
    )
    return response['data'][0]['embedding']

# Generate embeddings for documents
documents = [
    {
        "id": "1",
        "title": "Introduction to Machine Learning",
        "content": "Machine learning is a subset of artificial intelligence..."
    },
    {
        "id": "2",
        "title": "Deep Learning Fundamentals",
        "content": "Deep learning uses neural networks with multiple layers..."
    }
]

# Add embeddings
for doc in documents:
    doc["content_vector"] = get_embedding(doc["content"])

# Index documents
from azure.search.documents import SearchClient

search_client = SearchClient(
    endpoint=endpoint,
    index_name="vector-search-index",
    credential=credential
)

search_client.upload_documents(documents=documents)
```

## Vector Search Queries

```python
from azure.search.documents.models import Vector

# Generate query embedding
query = "What is artificial intelligence?"
query_vector = get_embedding(query)

# Perform vector search
results = search_client.search(
    search_text=None,
    vectors=[
        Vector(
            value=query_vector,
            k=10,  # Number of nearest neighbors to return
            fields="content_vector"
        )
    ],
    select=["id", "title", "content"]
)

for result in results:
    print(f"{result['title']}: {result['@search.score']:.4f}")
```

## Hybrid Search (Vector + Keyword)

```python
# Combine vector and keyword search
results = search_client.search(
    search_text="machine learning neural networks",  # Keyword search
    vectors=[
        Vector(
            value=get_embedding("machine learning neural networks"),
            k=10,
            fields="content_vector"
        )
    ],
    select=["id", "title", "content"],
    top=10
)

# Results are combined and ranked
for result in results:
    print(f"{result['title']}: {result['@search.score']:.4f}")
```

## Multi-Vector Search

```python
# Index with multiple vector fields
fields = [
    SimpleField(name="id", type=SearchFieldDataType.String, key=True),
    SearchableField(name="title", type=SearchFieldDataType.String),
    SearchableField(name="content", type=SearchFieldDataType.String),
    SimpleField(
        name="title_vector",
        type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
        searchable=True,
        vector_search_dimensions=1536,
        vector_search_profile="my-vector-profile"
    ),
    SimpleField(
        name="content_vector",
        type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
        searchable=True,
        vector_search_dimensions=1536,
        vector_search_profile="my-vector-profile"
    )
]

# Search across multiple vector fields
results = search_client.search(
    search_text=None,
    vectors=[
        Vector(
            value=get_embedding("machine learning"),
            k=10,
            fields="title_vector"
        ),
        Vector(
            value=get_embedding("deep learning applications"),
            k=10,
            fields="content_vector"
        )
    ],
    select=["id", "title"]
)
```

## Vector Search with Filters

```python
# Combine vector search with filters
results = search_client.search(
    search_text=None,
    vectors=[
        Vector(
            value=get_embedding("cloud computing"),
            k=10,
            fields="content_vector"
        )
    ],
    filter="category eq 'Technology' and year gt 2020",
    select=["id", "title", "category", "year"]
)
```

## Batch Embedding Generation

```python
import asyncio
from openai import AsyncOpenAI

client = AsyncOpenAI(api_key="your-key")

async def get_embeddings_batch(texts, model="text-embedding-ada-002", batch_size=100):
    """Generate embeddings in batches"""
    embeddings = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        response = await client.embeddings.create(
            input=batch,
            model=model
        )
        embeddings.extend([e.embedding for e in response.data])

    return embeddings

# Process large document set
async def process_documents(documents):
    texts = [doc["content"] for doc in documents]
    embeddings = await get_embeddings_batch(texts)

    for doc, embedding in zip(documents, embeddings):
        doc["content_vector"] = embedding

    return documents

# Run
documents = asyncio.run(process_documents(documents))
```

## Semantic Ranking with Vectors

```python
# Combine vector search with semantic ranking
results = search_client.search(
    search_text="How to build machine learning models",
    query_type=QueryType.SEMANTIC,
    semantic_configuration_name="my-semantic-config",
    vectors=[
        Vector(
            value=get_embedding("How to build machine learning models"),
            k=50,  # Retrieve more for reranking
            fields="content_vector"
        )
    ],
    top=10,
    query_caption=QueryCaptionType.EXTRACTIVE
)

for result in results:
    print(f"{result['title']}")
    print(f"  Vector Score: {result['@search.score']:.4f}")
    print(f"  Reranker Score: {result.get('@search.reranker_score', 'N/A')}")
```

Vector search enables powerful similarity-based retrieval that complements traditional keyword search.
