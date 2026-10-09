---
title: "Azure Cognitive Search Vector Search: Building Semantic Search Applications"
description: "Vector search enables powerful semantic search capabilities. Tomorrow, I will cover hybrid retrieval patterns in more detail."
author: Michael John Peña
draft: false
date: 2023-05-24
tags:
  - Azure Cognitive Search
  - Vector Search
  - Embeddings
  - Semantic Search
  - AI
---

## What is Vector Search?

Vector search uses embeddings (dense vector representations) to find semantically similar content:

```
┌─────────────────────────────────────────────────────┐
│              Vector Search Pipeline                  │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Document ──▶ Embedding Model ──▶ Vector [0.1,...]  │
│                                                      │
│  Query ──▶ Embedding Model ──▶ Query Vector         │
│                                                      │
│  Query Vector ──▶ Similarity Search ──▶ Results     │
│                   (cosine, dot product)             │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Setting Up Vector Search Index

```python
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SearchField,
    SearchFieldDataType,
    SimpleField,
    SearchableField,
    VectorSearch,
    HnswAlgorithmConfiguration,
    VectorSearchProfile,
    SemanticConfiguration,
    SemanticField,
    SemanticPrioritizedFields,
    SemanticSearch
)
from azure.core.credentials import AzureKeyCredential

# Initialize client
index_client = SearchIndexClient(
    endpoint="https://your-search.search.windows.net",
    credential=AzureKeyCredential("your-admin-key")
)

# Define index with vector field
fields = [
    SimpleField(
        name="id",
        type=SearchFieldDataType.String,
        key=True,
        filterable=True
    ),
    SearchableField(
        name="title",
        type=SearchFieldDataType.String,
        searchable=True
    ),
    SearchableField(
        name="content",
        type=SearchFieldDataType.String,
        searchable=True
    ),
    SimpleField(
        name="category",
        type=SearchFieldDataType.String,
        filterable=True,
        facetable=True
    ),
    SearchField(
        name="content_vector",
        type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
        searchable=True,
        vector_search_dimensions=1536,  # OpenAI ada-002 dimensions
        vector_search_profile_name="my-vector-profile"
    )
]

# Configure vector search
vector_search = VectorSearch(
    algorithms=[
        HnswAlgorithmConfiguration(
            name="my-hnsw-config",
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
            name="my-vector-profile",
            algorithm_configuration_name="my-hnsw-config"
        )
    ]
)

# Configure semantic search
semantic_config = SemanticConfiguration(
    name="my-semantic-config",
    prioritized_fields=SemanticPrioritizedFields(
        title_field=SemanticField(field_name="title"),
        content_fields=[SemanticField(field_name="content")]
    )
)

semantic_search = SemanticSearch(configurations=[semantic_config])

# Create index
index = SearchIndex(
    name="documents-vector",
    fields=fields,
    vector_search=vector_search,
    semantic_search=semantic_search
)

index_client.create_or_update_index(index)
print(f"Index 'documents-vector' created")
```

## Generating Embeddings

```python
from openai import AzureOpenAI

openai_client = AzureOpenAI(
    api_key="your-openai-key",
    api_version="2023-05-15",
    azure_endpoint="https://your-openai.openai.azure.com"
)

def get_embedding(text: str, model: str = "text-embedding-ada-002") -> list[float]:
    """Generate embedding for text"""
    response = openai_client.embeddings.create(
        model=model,
        input=text
    )
    return response.data[0].embedding

def get_embeddings_batch(texts: list[str], model: str = "text-embedding-ada-002") -> list[list[float]]:
    """Generate embeddings for multiple texts"""
    response = openai_client.embeddings.create(
        model=model,
        input=texts
    )
    return [item.embedding for item in response.data]
```

## Indexing Documents

```python
from azure.search.documents import SearchClient

search_client = SearchClient(
    endpoint="https://your-search.search.windows.net",
    index_name="documents-vector",
    credential=AzureKeyCredential("your-admin-key")
)

def index_documents(documents: list[dict]):
    """Index documents with embeddings"""

    # Generate embeddings for content
    contents = [doc["content"] for doc in documents]
    embeddings = get_embeddings_batch(contents)

    # Add embeddings to documents
    for doc, embedding in zip(documents, embeddings):
        doc["content_vector"] = embedding

    # Upload to index
    result = search_client.upload_documents(documents)
    print(f"Indexed {len(result)} documents")

# Example documents
documents = [
    {
        "id": "1",
        "title": "Introduction to Machine Learning",
        "content": "Machine learning is a subset of artificial intelligence...",
        "category": "AI"
    },
    {
        "id": "2",
        "title": "Deep Learning Fundamentals",
        "content": "Deep learning uses neural networks with many layers...",
        "category": "AI"
    },
    {
        "id": "3",
        "title": "Natural Language Processing",
        "content": "NLP enables computers to understand human language...",
        "category": "NLP"
    }
]

index_documents(documents)
```

## Vector Search Queries

### Pure Vector Search

```python
from azure.search.documents.models import VectorizedQuery

def vector_search(query: str, top_k: int = 5) -> list[dict]:
    """Perform pure vector search"""

    query_embedding = get_embedding(query)

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=top_k,
        fields="content_vector"
    )

    results = search_client.search(
        search_text=None,
        vector_queries=[vector_query],
        select=["id", "title", "content", "category"]
    )

    return [
        {
            "id": result["id"],
            "title": result["title"],
            "content": result["content"],
            "score": result["@search.score"]
        }
        for result in results
    ]

# Usage
results = vector_search("How do neural networks learn?")
for result in results:
    print(f"{result['title']} (score: {result['score']:.4f})")
```

### Hybrid Search (Vector + Text)

```python
def hybrid_search(query: str, top_k: int = 5) -> list[dict]:
    """Combine vector and keyword search"""

    query_embedding = get_embedding(query)

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=top_k,
        fields="content_vector"
    )

    results = search_client.search(
        search_text=query,  # Also perform text search
        vector_queries=[vector_query],
        select=["id", "title", "content", "category"],
        top=top_k
    )

    return list(results)
```

### Filtered Vector Search

```python
def filtered_vector_search(
    query: str,
    category: str = None,
    top_k: int = 5
) -> list[dict]:
    """Vector search with filters"""

    query_embedding = get_embedding(query)

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=top_k,
        fields="content_vector"
    )

    filter_expression = None
    if category:
        filter_expression = f"category eq '{category}'"

    results = search_client.search(
        search_text=None,
        vector_queries=[vector_query],
        filter=filter_expression,
        select=["id", "title", "content", "category"]
    )

    return list(results)

# Search only in AI category
results = filtered_vector_search("neural networks", category="AI")
```

### Semantic Ranking

```python
def semantic_hybrid_search(query: str, top_k: int = 5) -> list[dict]:
    """Hybrid search with semantic ranking"""

    query_embedding = get_embedding(query)

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=top_k,
        fields="content_vector"
    )

    results = search_client.search(
        search_text=query,
        vector_queries=[vector_query],
        query_type="semantic",
        semantic_configuration_name="my-semantic-config",
        query_caption="extractive",
        query_answer="extractive",
        top=top_k
    )

    processed_results = []
    for result in results:
        item = {
            "id": result["id"],
            "title": result["title"],
            "content": result["content"],
            "score": result["@search.score"],
            "reranker_score": result.get("@search.reranker_score")
        }

        # Add captions if available
        if "@search.captions" in result:
            captions = result["@search.captions"]
            if captions:
                item["caption"] = captions[0].text

        processed_results.append(item)

    return processed_results
```

## RAG Pattern Implementation

```python
class VectorRAG:
    """RAG implementation using Azure Cognitive Search"""

    def __init__(self, search_client, openai_client):
        self.search = search_client
        self.openai = openai_client

    def retrieve(self, query: str, top_k: int = 5) -> list[dict]:
        """Retrieve relevant documents"""
        query_embedding = get_embedding(query)

        vector_query = VectorizedQuery(
            vector=query_embedding,
            k_nearest_neighbors=top_k,
            fields="content_vector"
        )

        results = self.search.search(
            search_text=query,
            vector_queries=[vector_query],
            query_type="semantic",
            semantic_configuration_name="my-semantic-config",
            top=top_k
        )

        return list(results)

    def generate(self, query: str, context: list[dict]) -> str:
        """Generate answer using retrieved context"""

        context_text = "\n\n".join([
            f"Title: {doc['title']}\nContent: {doc['content']}"
            for doc in context
        ])

        messages = [
            {
                "role": "system",
                "content": """You are a helpful assistant that answers questions based on the provided context.
                Only use information from the context. If the answer is not in the context, say so."""
            },
            {
                "role": "user",
                "content": f"""Context:
{context_text}

Question: {query}

Answer:"""
            }
        ]

        response = self.openai.chat.completions.create(
            model="gpt-4",
            messages=messages,
            temperature=0.7,
            max_tokens=500
        )

        return response.choices[0].message.content

    def query(self, question: str) -> dict:
        """End-to-end RAG query"""
        # Retrieve
        documents = self.retrieve(question)

        # Generate
        answer = self.generate(question, documents)

        return {
            "question": question,
            "answer": answer,
            "sources": [
                {"title": doc["title"], "id": doc["id"]}
                for doc in documents
            ]
        }

# Usage
rag = VectorRAG(search_client, openai_client)
result = rag.query("How do neural networks learn?")
print(f"Answer: {result['answer']}")
print(f"Sources: {result['sources']}")
```

Vector search enables powerful semantic search capabilities. Tomorrow, I will cover hybrid retrieval patterns in more detail.

## Resources

- [Vector Search Documentation](https://learn.microsoft.com/en-us/azure/search/vector-search-overview)
- [Hybrid Search](https://learn.microsoft.com/en-us/azure/search/hybrid-search-overview)
- [Semantic Search](https://learn.microsoft.com/en-us/azure/search/semantic-search-overview)
