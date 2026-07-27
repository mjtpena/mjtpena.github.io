---
title: "Vector Databases for AI Applications"
author: Michael John Pena
draft: false
date: 2023-03-09
tags:
  - AI
  - Vector Databases
  - Embeddings
  - Architecture
  - Azure

---

I wrote "Vector Databases for AI Applications" to share practical, production-minded guidance on this topic.

## Why Vector Databases?

Traditional databases optimize for exact matches. AI applications need similarity:
- "Find documents similar to this query"
- "Recommend products like ones this user bought"
- "Match this image to similar images"

Vectors (embeddings) represent meaning in high-dimensional space. Similar items have similar vectors.

## Vector Database Options

### 1. Pinecone

Managed, purpose-built for vectors:

```python
import pinecone

pinecone.init(api_key="your-key", environment="us-east1-gcp")

# Create index
pinecone.create_index(
    name="documents",
    dimension=1536,  # OpenAI embedding size
    metric="cosine",
    pod_type="p1"
)

index = pinecone.Index("documents")

# Upsert vectors
index.upsert(vectors=[
    ("doc1", [0.1, 0.2, ...], {"title": "Azure Data Factory", "category": "data"}),
    ("doc2", [0.3, 0.4, ...], {"title": "Databricks", "category": "analytics"}),
])

# Query
results = index.query(
    vector=[0.15, 0.25, ...],
    top_k=5,
    include_metadata=True,
    filter={"category": {"$eq": "data"}}
)

for match in results.matches:
    print(f"{match.id}: {match.score} - {match.metadata['title']}")
```

### 2. Weaviate

Open-source with built-in vectorization:

```python
import weaviate

client = weaviate.Client(
    url="http://localhost:8080",
    additional_headers={
        "X-OpenAI-Api-Key": "your-openai-key"
    }
)

# Create schema with automatic vectorization
client.schema.create_class({
    "class": "Document",
    "vectorizer": "text2vec-openai",
    "moduleConfig": {
        "text2vec-openai": {
            "model": "ada",
            "modelVersion": "002",
            "type": "text"
        }
    },
    "properties": [
        {"name": "title", "dataType": ["text"]},
        {"name": "content", "dataType": ["text"]},
        {"name": "category", "dataType": ["string"]}
    ]
})

# Add objects - vectors generated automatically
client.data_object.create({
    "title": "Azure Synapse Analytics",
    "content": "Unified analytics platform combining data warehousing and big data...",
    "category": "analytics"
}, "Document")

# Query with natural language
result = client.query.get("Document", ["title", "content"]) \
    .with_near_text({"concepts": ["data lakehouse"]}) \
    .with_limit(5) \
    .do()
```

### 3. Qdrant

Open-source with advanced filtering:

```python
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

client = QdrantClient("localhost", port=6333)

# Create collection
client.create_collection(
    collection_name="documents",
    vectors_config=VectorParams(size=1536, distance=Distance.COSINE)
)

# Upsert points
client.upsert(
    collection_name="documents",
    points=[
        PointStruct(
            id=1,
            vector=[0.1, 0.2, ...],
            payload={"title": "Azure ML", "category": "ai", "year": 2023}
        ),
        PointStruct(
            id=2,
            vector=[0.3, 0.4, ...],
            payload={"title": "Cognitive Services", "category": "ai", "year": 2022}
        ),
    ]
)

# Search with filters
results = client.search(
    collection_name="documents",
    query_vector=[0.15, 0.25, ...],
    query_filter={
        "must": [
            {"key": "category", "match": {"value": "ai"}},
            {"key": "year", "range": {"gte": 2022}}
        ]
    },
    limit=5
)
```

### 4. Azure Cognitive Search

Enterprise option with hybrid capabilities:

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
index_client = SearchIndexClient(
    endpoint="https://your-search.search.windows.net",
    credential=AzureKeyCredential("your-key")
)

index = SearchIndex(
    name="documents",
    fields=[
        SearchField(name="id", type=SearchFieldDataType.String, key=True),
        SearchField(name="title", type=SearchFieldDataType.String, searchable=True),
        SearchField(name="content", type=SearchFieldDataType.String, searchable=True),
        SearchField(
            name="vector",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            searchable=True,
            vector_search_dimensions=1536,
            vector_search_configuration="default"
        ),
    ],
    vector_search=VectorSearch(
        algorithm_configurations=[
            HnswVectorSearchAlgorithmConfiguration(name="default")
        ]
    )
)

index_client.create_or_update_index(index)

# Search
search_client = SearchClient(
    endpoint="https://your-search.search.windows.net",
    index_name="documents",
    credential=AzureKeyCredential("your-key")
)

# Hybrid search (vector + keyword)
results = search_client.search(
    search_text="data warehouse",  # Keyword search
    vector=query_embedding,         # Vector search
    top_k=10,
    vector_fields="vector",
    select=["id", "title", "content"]
)
```

## Comparison Matrix

| Feature | Pinecone | Weaviate | Qdrant | Azure Search |
|---------|----------|----------|--------|--------------|
| Managed | Yes | Optional | Optional | Yes |
| Open Source | No | Yes | Yes | No |
| Built-in Embedding | No | Yes | No | No |
| Hybrid Search | Limited | Yes | Yes | Yes |
| Filtering | Yes | Yes | Advanced | Yes |
| Scale | Excellent | Good | Good | Excellent |
| Azure Integration | API | API | API | Native |

## Architecture Patterns

### Pattern 1: RAG with Vector Store

```python
from dataclasses import dataclass
from typing import Protocol

class VectorStore(Protocol):
    def add(self, id: str, vector: list[float], metadata: dict): ...
    def search(self, vector: list[float], k: int) -> list[dict]: ...

@dataclass
class RAGConfig:
    vector_store: VectorStore
    embedding_model: str
    chat_model: str
    top_k: int = 5

class RAGApplication:
    def __init__(self, config: RAGConfig):
        self.config = config
        self.vector_store = config.vector_store

    def ingest(self, documents: list[dict]):
        """Ingest documents into vector store."""
        for doc in documents:
            embedding = self._get_embedding(doc["content"])
            self.vector_store.add(
                id=doc["id"],
                vector=embedding,
                metadata={
                    "title": doc.get("title"),
                    "source": doc.get("source")
                }
            )

    def query(self, question: str) -> dict:
        """Query with RAG."""
        # Get embedding for question
        query_vector = self._get_embedding(question)

        # Retrieve relevant documents
        results = self.vector_store.search(query_vector, self.config.top_k)

        # Build context
        context = "\n\n".join([r["content"] for r in results])

        # Generate response
        response = self._generate(question, context)

        return {
            "answer": response,
            "sources": [{"id": r["id"], "score": r["score"]} for r in results]
        }

    def _get_embedding(self, text: str) -> list[float]:
        # Implementation depends on embedding provider
        pass

    def _generate(self, question: str, context: str) -> str:
        # Implementation depends on LLM provider
        pass
```

### Pattern 2: Multi-Vector Retrieval

For complex documents, use multiple vectors:

```python
class MultiVectorDocument:
    """Document with multiple vector representations."""

    def __init__(self, doc_id: str, content: str):
        self.doc_id = doc_id
        self.content = content

    def get_vectors(self) -> dict[str, list[float]]:
        """Generate multiple vectors for different aspects."""
        return {
            "summary": self._embed(self._summarize(self.content)),
            "questions": self._embed(self._generate_questions(self.content)),
            "full": self._embed(self.content[:8000])  # Truncate for embedding
        }

    def _summarize(self, content: str) -> str:
        # Use LLM to summarize
        pass

    def _generate_questions(self, content: str) -> str:
        # Use LLM to generate potential questions
        pass

    def _embed(self, text: str) -> list[float]:
        # Get embedding
        pass

class MultiVectorRetriever:
    def search(self, query: str, strategy: str = "summary") -> list[dict]:
        """Search using specified vector type."""
        query_vector = self._embed(query)

        # Search against specific vector type
        results = self.vector_store.search(
            vector=query_vector,
            filter={"vector_type": strategy}
        )

        return results
```

### Pattern 3: Tiered Retrieval

Coarse-to-fine retrieval for large datasets:

```python
class TieredRetriever:
    """Two-stage retrieval for efficiency."""

    def __init__(self, coarse_store, fine_store):
        self.coarse_store = coarse_store  # Fewer, summarized vectors
        self.fine_store = fine_store       # Full document vectors

    def search(self, query: str, top_k: int = 5) -> list[dict]:
        query_vector = self._embed(query)

        # Stage 1: Coarse retrieval (fast)
        coarse_results = self.coarse_store.search(
            vector=query_vector,
            k=top_k * 10  # Get more candidates
        )

        # Get document IDs from coarse results
        candidate_ids = [r["doc_id"] for r in coarse_results]

        # Stage 2: Fine retrieval (accurate)
        fine_results = self.fine_store.search(
            vector=query_vector,
            filter={"doc_id": {"$in": candidate_ids}},
            k=top_k
        )

        return fine_results
```

## Performance Optimization

```python
class VectorStoreOptimizer:
    """Optimize vector store operations."""

    def __init__(self, store):
        self.store = store
        self.cache = {}

    def batch_upsert(self, vectors: list[tuple], batch_size: int = 100):
        """Batch upsert for efficiency."""
        for i in range(0, len(vectors), batch_size):
            batch = vectors[i:i + batch_size]
            self.store.upsert(batch)

    def cached_search(self, query_hash: str, query_vector: list[float], k: int) -> list:
        """Cache frequent queries."""
        if query_hash in self.cache:
            return self.cache[query_hash]

        results = self.store.search(query_vector, k)
        self.cache[query_hash] = results
        return results

    def quantize_vectors(self, vectors: list[list[float]], bits: int = 8) -> list[list[int]]:
        """Reduce vector size with quantization."""
        import numpy as np

        vectors_np = np.array(vectors)
        min_val, max_val = vectors_np.min(), vectors_np.max()

        # Scale to integer range
        scale = (2 ** bits - 1) / (max_val - min_val)
        quantized = ((vectors_np - min_val) * scale).astype(int)

        return quantized.tolist()
```

Vector databases are the foundation for modern AI applications. Choose based on your scale, filtering needs, and Azure integration requirements. For most Azure-centric applications, start with Azure Cognitive Search for its native integration, then evaluate specialized options as needs grow.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
