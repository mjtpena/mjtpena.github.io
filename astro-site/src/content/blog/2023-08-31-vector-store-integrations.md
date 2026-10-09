---
title: "Vector Store Integrations: Choosing and Using Vector Databases"
description: "This concludes our August 2023 series on LLM optimization and vector stores."
author: Michael John Peña
draft: false
date: 2023-08-31
tags:
  - Vector Stores
  - RAG
  - Embeddings
  - LLM
---

## Vector Store Comparison

```python
vector_stores = {
    "Azure AI Search": {
        "type": "managed",
        "features": ["hybrid search", "semantic ranking", "filters"],
        "scale": "enterprise"
    },
    "Pinecone": {
        "type": "managed",
        "features": ["fast queries", "metadata filtering", "namespaces"],
        "scale": "startup to enterprise"
    },
    "Weaviate": {
        "type": "self-hosted/managed",
        "features": ["hybrid search", "multi-modal", "GraphQL"],
        "scale": "flexible"
    },
    "Chroma": {
        "type": "self-hosted",
        "features": ["simple", "embedded", "local dev"],
        "scale": "development/small"
    },
    "FAISS": {
        "type": "library",
        "features": ["fast", "in-memory", "GPU support"],
        "scale": "variable"
    },
    "Qdrant": {
        "type": "self-hosted/managed",
        "features": ["filtering", "payloads", "recommendations"],
        "scale": "flexible"
    }
}
```

## Azure AI Search Integration

```python
from langchain.vectorstores import AzureSearch
from langchain.embeddings import AzureOpenAIEmbeddings
from azure.search.documents.indexes.models import (
    SearchableField,
    SearchField,
    SearchFieldDataType,
    SimpleField,
    VectorSearch,
    HnswAlgorithmConfiguration,
    VectorSearchProfile
)

# Setup embeddings
embeddings = AzureOpenAIEmbeddings(
    deployment="text-embedding-ada-002",
    model="text-embedding-ada-002"
)

# Create Azure Search vector store
vector_store = AzureSearch(
    azure_search_endpoint="https://your-search.search.windows.net",
    azure_search_key="your-key",
    index_name="documents",
    embedding_function=embeddings.embed_query
)

# Custom index with additional fields
fields = [
    SimpleField(
        name="id",
        type=SearchFieldDataType.String,
        key=True
    ),
    SearchableField(
        name="content",
        type=SearchFieldDataType.String
    ),
    SearchField(
        name="content_vector",
        type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
        searchable=True,
        vector_search_dimensions=1536,
        vector_search_profile_name="myHnswProfile"
    ),
    SimpleField(
        name="category",
        type=SearchFieldDataType.String,
        filterable=True
    ),
    SimpleField(
        name="timestamp",
        type=SearchFieldDataType.DateTimeOffset,
        filterable=True,
        sortable=True
    )
]

# Add documents
docs = [
    {"content": "Azure ML guide", "category": "ml"},
    {"content": "Azure OpenAI tutorial", "category": "ai"}
]
vector_store.add_texts(
    texts=[d["content"] for d in docs],
    metadatas=[{"category": d["category"]} for d in docs]
)

# Search with filters
results = vector_store.similarity_search(
    "machine learning",
    k=5,
    filters="category eq 'ml'"
)
```

## Pinecone Integration

```python
from langchain.vectorstores import Pinecone
import pinecone

# Initialize Pinecone
pinecone.init(
    api_key="your-api-key",
    environment="your-environment"
)

# Create index if not exists
if "documents" not in pinecone.list_indexes():
    pinecone.create_index(
        "documents",
        dimension=1536,
        metric="cosine",
        pods=1,
        pod_type="p1.x1"
    )

# Create vector store
vector_store = Pinecone.from_documents(
    documents=docs,
    embedding=embeddings,
    index_name="documents",
    namespace="production"
)

# Search with metadata filter
results = vector_store.similarity_search(
    "AI applications",
    k=5,
    filter={"category": {"$eq": "ai"}}
)

# Batch upsert
index = pinecone.Index("documents")
vectors = [
    {
        "id": f"doc_{i}",
        "values": embeddings.embed_query(doc),
        "metadata": {"content": doc, "source": "manual"}
    }
    for i, doc in enumerate(documents)
]
index.upsert(vectors=vectors, namespace="production")
```

## Weaviate Integration

```python
from langchain.vectorstores import Weaviate
import weaviate

# Connect to Weaviate
client = weaviate.Client(
    url="http://localhost:8080",
    auth_client_secret=weaviate.AuthApiKey(api_key="your-key")
)

# Define schema
schema = {
    "class": "Document",
    "vectorizer": "none",  # We provide our own embeddings
    "properties": [
        {"name": "content", "dataType": ["text"]},
        {"name": "category", "dataType": ["string"]},
        {"name": "source", "dataType": ["string"]}
    ]
}

if not client.schema.contains(schema):
    client.schema.create_class(schema)

# Create vector store
vector_store = Weaviate(
    client=client,
    index_name="Document",
    text_key="content",
    embedding=embeddings,
    by_text=False
)

# Add documents with metadata
vector_store.add_texts(
    texts=["Document content here"],
    metadatas=[{"category": "tutorial", "source": "blog"}]
)

# Hybrid search (vector + keyword)
results = vector_store.similarity_search(
    "machine learning tutorial",
    k=5,
    additional=["score"]
)
```

## Chroma for Local Development

```python
from langchain.vectorstores import Chroma

# In-memory Chroma
vector_store = Chroma.from_documents(
    documents=docs,
    embedding=embeddings
)

# Persistent Chroma
vector_store = Chroma.from_documents(
    documents=docs,
    embedding=embeddings,
    persist_directory="./chroma_db"
)
vector_store.persist()

# Load existing
vector_store = Chroma(
    persist_directory="./chroma_db",
    embedding_function=embeddings
)

# Search with score
results = vector_store.similarity_search_with_score(
    "query text",
    k=5
)
for doc, score in results:
    print(f"Score: {score:.4f} - {doc.page_content[:100]}")

# Filter by metadata
results = vector_store.similarity_search(
    "query",
    k=5,
    filter={"category": "ml"}
)
```

## FAISS for High Performance

```python
from langchain.vectorstores import FAISS
import faiss

# Create FAISS index
vector_store = FAISS.from_documents(docs, embeddings)

# Save and load
vector_store.save_local("faiss_index")
loaded_store = FAISS.load_local("faiss_index", embeddings)

# Merge indices
store1 = FAISS.from_documents(docs1, embeddings)
store2 = FAISS.from_documents(docs2, embeddings)
store1.merge_from(store2)

# Custom FAISS index for GPU
dimension = 1536
index = faiss.IndexFlatIP(dimension)  # Inner product
if faiss.get_num_gpus() > 0:
    index = faiss.index_cpu_to_gpu(
        faiss.StandardGpuResources(),
        0,
        index
    )

# Create with custom index
vector_store = FAISS(
    embedding_function=embeddings.embed_query,
    index=index,
    docstore=InMemoryDocstore({}),
    index_to_docstore_id={}
)
```

## Qdrant Integration

```python
from langchain.vectorstores import Qdrant
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams

# Connect to Qdrant
client = QdrantClient(
    url="http://localhost:6333",
    api_key="your-api-key"
)

# Create collection
client.create_collection(
    collection_name="documents",
    vectors_config=VectorParams(
        size=1536,
        distance=Distance.COSINE
    )
)

# Create vector store
vector_store = Qdrant(
    client=client,
    collection_name="documents",
    embeddings=embeddings
)

# Add with payload
vector_store.add_texts(
    texts=["Document content"],
    metadatas=[{"category": "ml", "author": "Michael"}],
    ids=["doc_001"]
)

# Search with complex filters
from qdrant_client.models import Filter, FieldCondition, MatchValue, Range

results = vector_store.similarity_search(
    "machine learning",
    k=5,
    filter=Filter(
        must=[
            FieldCondition(
                key="category",
                match=MatchValue(value="ml")
            )
        ]
    )
)
```

## Building a Multi-Store RAG System

```python
class MultiStoreRAG:
    """RAG system with multiple vector stores."""

    def __init__(self, embeddings):
        self.embeddings = embeddings
        self.stores = {}

    def add_store(self, name, store_type, config):
        if store_type == "azure":
            self.stores[name] = AzureSearch(**config)
        elif store_type == "pinecone":
            self.stores[name] = Pinecone(**config)
        elif store_type == "chroma":
            self.stores[name] = Chroma(**config)

    def search_all(self, query, k=5):
        """Search across all stores."""
        all_results = []

        for name, store in self.stores.items():
            results = store.similarity_search_with_score(query, k=k)
            for doc, score in results:
                doc.metadata["source_store"] = name
                all_results.append((doc, score))

        # Sort by score and return top k
        all_results.sort(key=lambda x: x[1], reverse=True)
        return all_results[:k]

    def search_specific(self, query, store_name, k=5, filters=None):
        """Search a specific store."""
        if store_name not in self.stores:
            raise ValueError(f"Store {store_name} not found")

        store = self.stores[store_name]
        if filters:
            return store.similarity_search(query, k=k, filter=filters)
        return store.similarity_search(query, k=k)

# Usage
rag = MultiStoreRAG(embeddings)
rag.add_store("azure", "azure", azure_config)
rag.add_store("local", "chroma", chroma_config)

results = rag.search_all("machine learning best practices")
```

## Hybrid Search Implementation

```python
class HybridSearchStore:
    """Combine vector and keyword search."""

    def __init__(self, vector_store, keyword_index):
        self.vector_store = vector_store
        self.keyword_index = keyword_index

    def hybrid_search(self, query, k=10, alpha=0.5):
        """
        Combine vector and keyword search results.
        alpha: weight for vector search (1-alpha for keyword)
        """
        # Vector search
        vector_results = self.vector_store.similarity_search_with_score(
            query, k=k * 2
        )

        # Keyword search (BM25)
        keyword_results = self.keyword_index.search(query, k=k * 2)

        # Normalize and combine scores
        combined = {}

        for doc, score in vector_results:
            doc_id = doc.metadata.get("id", hash(doc.page_content))
            combined[doc_id] = {
                "doc": doc,
                "vector_score": score,
                "keyword_score": 0
            }

        for doc, score in keyword_results:
            doc_id = doc.metadata.get("id", hash(doc.page_content))
            if doc_id in combined:
                combined[doc_id]["keyword_score"] = score
            else:
                combined[doc_id] = {
                    "doc": doc,
                    "vector_score": 0,
                    "keyword_score": score
                }

        # Calculate hybrid scores
        results = []
        for doc_id, data in combined.items():
            hybrid_score = (
                alpha * data["vector_score"] +
                (1 - alpha) * data["keyword_score"]
            )
            results.append((data["doc"], hybrid_score))

        results.sort(key=lambda x: x[1], reverse=True)
        return results[:k]
```

## Best Practices

```python
best_practices = {
    "chunking": {
        "size": "500-1000 tokens for most use cases",
        "overlap": "10-20% overlap for context continuity",
        "strategy": "Semantic chunking when possible"
    },
    "metadata": {
        "include": ["source", "timestamp", "category", "author"],
        "index": "Make filterable fields indexed"
    },
    "embeddings": {
        "consistency": "Use same model for indexing and querying",
        "normalization": "Normalize vectors for cosine similarity"
    },
    "scaling": {
        "batching": "Batch upserts for performance",
        "sharding": "Consider sharding for large datasets",
        "caching": "Cache frequent queries"
    }
}
```

This concludes our August 2023 series on LLM optimization and vector stores.

## Resources

- [Azure AI Search](https://learn.microsoft.com/en-us/azure/search/)
- [Pinecone Documentation](https://docs.pinecone.io/)
- [Weaviate Documentation](https://weaviate.io/developers/weaviate)
- [LangChain Vector Stores](https://python.langchain.com/docs/modules/data_connection/vectorstores/)
