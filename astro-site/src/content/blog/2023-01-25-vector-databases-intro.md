---
title: "Introduction to Vector Databases for AI Applications"
author: Michael John Peña
draft: false
date: 2023-01-25
tags:
  - Azure
  - Vector Databases
  - Embeddings
  - AI
  - Data

---

I wrote "Introduction to Vector Databases for AI Applications" to share practical, production-minded guidance on this topic.

## Why Vector Databases?

Traditional databases are optimized for exact matches and range queries. Vector search requires finding approximate nearest neighbors in high-dimensional space - a fundamentally different problem.

```python
# The challenge: Find similar vectors among millions
import numpy as np

# 1 million documents, 1536 dimensions each
embeddings = np.random.rand(1_000_000, 1536)
query = np.random.rand(1536)

# Brute force: O(n) - too slow for production
def brute_force_search(query, embeddings, top_k=10):
    similarities = np.dot(embeddings, query)
    top_indices = np.argpartition(similarities, -top_k)[-top_k:]
    return top_indices[np.argsort(similarities[top_indices])[::-1]]

# Vector databases use approximate algorithms: O(log n) or O(1)
```

## Vector Database Landscape

| Database | Type | Best For | Managed Option |
|----------|------|----------|----------------|
| Pinecone | Managed SaaS | Simplicity, scale | Yes (only) |
| Weaviate | Open source | Flexibility, self-host | Weaviate Cloud |
| Milvus | Open source | High performance | Zilliz Cloud |
| Qdrant | Open source | Rust performance | Qdrant Cloud |
| Azure Cognitive Search | Azure native | Azure integration | Yes |
| pgvector | PostgreSQL ext | Existing Postgres | Any Postgres |

## Key Concepts

### Indexing Algorithms

```python
# HNSW (Hierarchical Navigable Small World)
# - Fast search: O(log n)
# - High accuracy
# - Memory intensive

# IVF (Inverted File Index)
# - Clusters vectors, searches relevant clusters
# - Good for large datasets
# - Trade-off between speed and accuracy

# Product Quantization
# - Compresses vectors
# - Reduces memory usage
# - Slight accuracy loss
```

### Distance Metrics

```python
import numpy as np

def cosine_similarity(a, b):
    """Best for semantic similarity (normalized vectors)."""
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

def euclidean_distance(a, b):
    """Best for actual distance in embedding space."""
    return np.linalg.norm(a - b)

def dot_product(a, b):
    """Best for pre-normalized vectors, fastest."""
    return np.dot(a, b)

# Choose based on your embeddings
# OpenAI embeddings: cosine or dot product (already normalized)
```

## Generic Vector DB Interface

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Dict, Any, Optional

@dataclass
class VectorDocument:
    """A document with embedding."""
    id: str
    embedding: List[float]
    metadata: Dict[str, Any]
    text: Optional[str] = None

@dataclass
class VectorSearchResult:
    """Search result from vector database."""
    id: str
    score: float
    metadata: Dict[str, Any]
    text: Optional[str] = None

class VectorDBInterface(ABC):
    """Abstract interface for vector databases."""

    @abstractmethod
    def create_collection(
        self,
        name: str,
        dimension: int,
        metric: str = "cosine"
    ) -> bool:
        """Create a new collection/index."""
        pass

    @abstractmethod
    def insert(
        self,
        collection: str,
        documents: List[VectorDocument]
    ) -> List[str]:
        """Insert documents into collection."""
        pass

    @abstractmethod
    def search(
        self,
        collection: str,
        query_vector: List[float],
        top_k: int = 10,
        filters: Optional[Dict] = None
    ) -> List[VectorSearchResult]:
        """Search for similar vectors."""
        pass

    @abstractmethod
    def delete(
        self,
        collection: str,
        ids: List[str]
    ) -> bool:
        """Delete documents by ID."""
        pass

    @abstractmethod
    def update(
        self,
        collection: str,
        document: VectorDocument
    ) -> bool:
        """Update a document."""
        pass
```

## In-Memory Vector Store (For Development)

```python
import numpy as np
from typing import List, Dict, Optional
import heapq

class InMemoryVectorStore(VectorDBInterface):
    """Simple in-memory vector store for development."""

    def __init__(self):
        self.collections: Dict[str, Dict] = {}

    def create_collection(
        self,
        name: str,
        dimension: int,
        metric: str = "cosine"
    ) -> bool:
        self.collections[name] = {
            "dimension": dimension,
            "metric": metric,
            "documents": {},
            "embeddings": []
        }
        return True

    def insert(
        self,
        collection: str,
        documents: List[VectorDocument]
    ) -> List[str]:
        if collection not in self.collections:
            raise ValueError(f"Collection {collection} not found")

        coll = self.collections[collection]
        ids = []

        for doc in documents:
            coll["documents"][doc.id] = {
                "embedding": doc.embedding,
                "metadata": doc.metadata,
                "text": doc.text
            }
            ids.append(doc.id)

        return ids

    def search(
        self,
        collection: str,
        query_vector: List[float],
        top_k: int = 10,
        filters: Optional[Dict] = None
    ) -> List[VectorSearchResult]:
        if collection not in self.collections:
            raise ValueError(f"Collection {collection} not found")

        coll = self.collections[collection]
        query = np.array(query_vector)

        # Calculate scores
        scores = []
        for doc_id, doc_data in coll["documents"].items():
            # Apply filters
            if filters:
                skip = False
                for key, value in filters.items():
                    if doc_data["metadata"].get(key) != value:
                        skip = True
                        break
                if skip:
                    continue

            embedding = np.array(doc_data["embedding"])

            if coll["metric"] == "cosine":
                score = np.dot(query, embedding) / (
                    np.linalg.norm(query) * np.linalg.norm(embedding)
                )
            elif coll["metric"] == "euclidean":
                score = -np.linalg.norm(query - embedding)
            else:
                score = np.dot(query, embedding)

            scores.append((score, doc_id, doc_data))

        # Get top k
        top_results = heapq.nlargest(top_k, scores, key=lambda x: x[0])

        return [
            VectorSearchResult(
                id=doc_id,
                score=score,
                metadata=doc_data["metadata"],
                text=doc_data.get("text")
            )
            for score, doc_id, doc_data in top_results
        ]

    def delete(self, collection: str, ids: List[str]) -> bool:
        if collection not in self.collections:
            return False

        for doc_id in ids:
            self.collections[collection]["documents"].pop(doc_id, None)
        return True

    def update(self, collection: str, document: VectorDocument) -> bool:
        if collection not in self.collections:
            return False

        self.collections[collection]["documents"][document.id] = {
            "embedding": document.embedding,
            "metadata": document.metadata,
            "text": document.text
        }
        return True

# Usage
store = InMemoryVectorStore()
store.create_collection("documents", dimension=1536, metric="cosine")

# Insert documents
docs = [
    VectorDocument(
        id="1",
        embedding=[0.1] * 1536,  # Placeholder
        metadata={"category": "tech"},
        text="Azure is a cloud platform"
    ),
    VectorDocument(
        id="2",
        embedding=[0.2] * 1536,
        metadata={"category": "tech"},
        text="AWS provides cloud services"
    )
]
store.insert("documents", docs)

# Search
results = store.search(
    "documents",
    query_vector=[0.15] * 1536,
    top_k=5,
    filters={"category": "tech"}
)
```

## Choosing a Vector Database

### Decision Factors

```python
def recommend_vector_db(requirements: dict) -> str:
    """Recommend a vector database based on requirements."""

    scale = requirements.get("vectors", 0)
    budget = requirements.get("budget", "medium")
    self_host = requirements.get("self_host", False)
    azure_native = requirements.get("azure_native", False)
    existing_postgres = requirements.get("existing_postgres", False)

    if azure_native:
        return "Azure Cognitive Search"

    if existing_postgres and scale < 1_000_000:
        return "pgvector"

    if not self_host:
        if budget == "low":
            return "Qdrant Cloud (free tier)"
        elif scale > 10_000_000:
            return "Pinecone"
        else:
            return "Weaviate Cloud"

    if self_host:
        if scale > 100_000_000:
            return "Milvus"
        else:
            return "Qdrant or Weaviate"

    return "Pinecone"

# Example
recommendation = recommend_vector_db({
    "vectors": 5_000_000,
    "budget": "medium",
    "self_host": False,
    "azure_native": True
})
print(f"Recommended: {recommendation}")
```

### Performance Characteristics

```python
VECTOR_DB_CHARACTERISTICS = {
    "pinecone": {
        "query_latency_ms": "10-50",
        "indexing_speed": "Fast",
        "max_vectors": "Billions",
        "filtering": "Yes",
        "hybrid_search": "Yes",
        "deployment": "Managed only"
    },
    "weaviate": {
        "query_latency_ms": "10-100",
        "indexing_speed": "Medium",
        "max_vectors": "Millions",
        "filtering": "Yes",
        "hybrid_search": "Yes",
        "deployment": "Self-host or Cloud"
    },
    "milvus": {
        "query_latency_ms": "1-10",
        "indexing_speed": "Fast",
        "max_vectors": "Billions",
        "filtering": "Yes",
        "hybrid_search": "Limited",
        "deployment": "Self-host or Zilliz"
    },
    "qdrant": {
        "query_latency_ms": "5-50",
        "indexing_speed": "Fast",
        "max_vectors": "Hundreds of millions",
        "filtering": "Yes",
        "hybrid_search": "Yes",
        "deployment": "Self-host or Cloud"
    },
    "azure_cognitive_search": {
        "query_latency_ms": "50-200",
        "indexing_speed": "Medium",
        "max_vectors": "Millions",
        "filtering": "Yes",
        "hybrid_search": "Yes",
        "deployment": "Azure managed"
    }
}
```

## Best Practices

1. **Start simple**: Use in-memory or pgvector for prototypes
2. **Choose based on scale**: Different DBs for different volumes
3. **Consider hybrid search**: Combine vector + keyword
4. **Plan for filtering**: Most queries need metadata filters
5. **Monitor performance**: Track latency and recall
6. **Design for updates**: Some DBs handle updates better

## Resources

- [Pinecone](https://www.pinecone.io/)
- [Weaviate](https://weaviate.io/)
- [Milvus](https://milvus.io/)
- [Qdrant](https://qdrant.tech/)
- [Azure Cognitive Search Vector Search](https://learn.microsoft.com/azure/search/vector-search-overview)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
