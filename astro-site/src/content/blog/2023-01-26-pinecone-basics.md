---
title: "Pinecone Vector Database: Getting Started Guide"
author: Michael John Peña
draft: false
date: 2023-01-26
tags:
  - Pinecone
  - Vector Database
  - Embeddings
  - AI
  - Azure OpenAI

---

I wrote "Pinecone Vector Database: Getting Started Guide" to share practical, production-minded guidance on this topic.

## Getting Started

```bash
pip install pinecone-client openai
```

```python
import pinecone
import openai
from typing import List, Dict, Any

# Initialize Pinecone
pinecone.init(
    api_key="your-pinecone-api-key",
    environment="us-west1-gcp"  # Or your environment
)

# Configure Azure OpenAI
openai.api_type = "azure"
openai.api_base = "https://your-resource.openai.azure.com/"
openai.api_version = "2023-03-15-preview"
openai.api_key = "your-azure-key"
```

## Creating an Index

```python
# Create index for OpenAI embeddings (1536 dimensions)
index_name = "azure-openai-docs"

# Check if index exists
if index_name not in pinecone.list_indexes():
    pinecone.create_index(
        name=index_name,
        dimension=1536,
        metric="cosine",
        pods=1,
        pod_type="p1.x1"  # Starter pod type
    )

# Connect to index
index = pinecone.Index(index_name)

# Check index stats
print(index.describe_index_stats())
```

## Upserting Vectors

```python
from dataclasses import dataclass
from typing import Optional
import hashlib

@dataclass
class Document:
    id: str
    text: str
    metadata: Dict[str, Any]

def get_embedding(text: str) -> List[float]:
    """Get embedding from Azure OpenAI."""
    response = openai.Embedding.create(
        engine="text-embedding-ada-002",
        input=text
    )
    return response['data'][0]['embedding']

def upsert_documents(index, documents: List[Document], batch_size: int = 100):
    """Upsert documents to Pinecone."""
    vectors = []

    for doc in documents:
        embedding = get_embedding(doc.text)
        vectors.append({
            "id": doc.id,
            "values": embedding,
            "metadata": {
                **doc.metadata,
                "text": doc.text[:1000]  # Store truncated text in metadata
            }
        })

        # Batch upsert
        if len(vectors) >= batch_size:
            index.upsert(vectors=vectors)
            vectors = []

    # Upsert remaining
    if vectors:
        index.upsert(vectors=vectors)

# Example usage
documents = [
    Document(
        id="doc1",
        text="Azure Virtual Machines provide scalable computing resources",
        metadata={"category": "compute", "service": "VM"}
    ),
    Document(
        id="doc2",
        text="Azure Functions is a serverless compute service",
        metadata={"category": "compute", "service": "Functions"}
    ),
    Document(
        id="doc3",
        text="Azure Cosmos DB is a globally distributed database",
        metadata={"category": "database", "service": "CosmosDB"}
    )
]

upsert_documents(index, documents)
```

## Querying

```python
def search(
    index,
    query: str,
    top_k: int = 5,
    filter: Optional[Dict] = None,
    include_metadata: bool = True
) -> List[Dict]:
    """Search for similar documents."""
    query_embedding = get_embedding(query)

    results = index.query(
        vector=query_embedding,
        top_k=top_k,
        filter=filter,
        include_metadata=include_metadata
    )

    return [
        {
            "id": match.id,
            "score": match.score,
            "metadata": match.metadata
        }
        for match in results.matches
    ]

# Simple search
results = search(index, "serverless computing")
for r in results:
    print(f"[{r['score']:.4f}] {r['metadata'].get('text', '')[:60]}...")

# Search with filter
compute_results = search(
    index,
    "database for high throughput",
    filter={"category": {"$eq": "database"}}
)
```

## Advanced Filtering

```python
# Pinecone supports various filter operators

# Equality
filter = {"category": {"$eq": "compute"}}

# In list
filter = {"service": {"$in": ["VM", "Functions", "AKS"]}}

# Numeric comparison
filter = {"year": {"$gte": 2020}}

# Combined filters (AND)
filter = {
    "category": {"$eq": "compute"},
    "year": {"$gte": 2022}
}

# Combined filters (OR) using $or
filter = {
    "$or": [
        {"category": {"$eq": "compute"}},
        {"category": {"$eq": "database"}}
    ]
}

# NOT operator
filter = {"category": {"$ne": "networking"}}

# Example search with complex filter
results = index.query(
    vector=get_embedding("cloud infrastructure"),
    top_k=10,
    filter={
        "$and": [
            {"category": {"$in": ["compute", "storage"]}},
            {"year": {"$gte": 2021}}
        ]
    },
    include_metadata=True
)
```

## Namespaces

```python
# Use namespaces to organize data
# Each namespace is isolated - searches only return results from the queried namespace

# Upsert to specific namespace
index.upsert(
    vectors=[
        {"id": "doc1", "values": [0.1] * 1536, "metadata": {"text": "..."}}
    ],
    namespace="production"
)

# Query specific namespace
results = index.query(
    vector=[0.1] * 1536,
    top_k=5,
    namespace="production"
)

# Delete from namespace
index.delete(ids=["doc1"], namespace="production")

# Delete entire namespace
index.delete(delete_all=True, namespace="staging")
```

## Building a Complete Search Service

```python
class PineconeSearchService:
    """Complete search service using Pinecone and Azure OpenAI."""

    def __init__(
        self,
        pinecone_api_key: str,
        pinecone_environment: str,
        index_name: str,
        embedding_deployment: str = "text-embedding-ada-002"
    ):
        pinecone.init(api_key=pinecone_api_key, environment=pinecone_environment)
        self.index = pinecone.Index(index_name)
        self.embedding_deployment = embedding_deployment

    def _embed(self, text: str) -> List[float]:
        """Get embedding for text."""
        response = openai.Embedding.create(
            engine=self.embedding_deployment,
            input=text
        )
        return response['data'][0]['embedding']

    def _embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Get embeddings for multiple texts."""
        response = openai.Embedding.create(
            engine=self.embedding_deployment,
            input=texts
        )
        return [item['embedding'] for item in response['data']]

    def add_documents(
        self,
        documents: List[Dict[str, Any]],
        text_field: str = "text",
        id_field: str = "id",
        namespace: str = "",
        batch_size: int = 100
    ):
        """Add documents to the index."""
        for i in range(0, len(documents), batch_size):
            batch = documents[i:i + batch_size]
            texts = [doc[text_field] for doc in batch]
            embeddings = self._embed_batch(texts)

            vectors = []
            for doc, embedding in zip(batch, embeddings):
                doc_id = doc.get(id_field, str(hash(doc[text_field])))
                metadata = {k: v for k, v in doc.items() if k != id_field}

                # Truncate text for metadata storage
                if text_field in metadata and len(metadata[text_field]) > 1000:
                    metadata[text_field] = metadata[text_field][:1000]

                vectors.append({
                    "id": doc_id,
                    "values": embedding,
                    "metadata": metadata
                })

            self.index.upsert(vectors=vectors, namespace=namespace)

    def search(
        self,
        query: str,
        top_k: int = 10,
        filter: Optional[Dict] = None,
        namespace: str = ""
    ) -> List[Dict]:
        """Search for similar documents."""
        query_embedding = self._embed(query)

        results = self.index.query(
            vector=query_embedding,
            top_k=top_k,
            filter=filter,
            namespace=namespace,
            include_metadata=True
        )

        return [
            {
                "id": match.id,
                "score": match.score,
                **match.metadata
            }
            for match in results.matches
        ]

    def delete_documents(
        self,
        ids: List[str],
        namespace: str = ""
    ):
        """Delete documents by ID."""
        self.index.delete(ids=ids, namespace=namespace)

    def get_stats(self) -> Dict:
        """Get index statistics."""
        return self.index.describe_index_stats()

# Usage
service = PineconeSearchService(
    pinecone_api_key="your-key",
    pinecone_environment="us-west1-gcp",
    index_name="my-index"
)

# Add documents
service.add_documents([
    {"id": "1", "text": "Azure is great", "category": "cloud"},
    {"id": "2", "text": "Python is powerful", "category": "programming"}
])

# Search
results = service.search("cloud computing", top_k=5)
```

## Cost Optimization

```python
# Pod types and pricing considerations

POD_TYPES = {
    "s1.x1": {"storage": "small", "qps": "low", "cost": "$"},
    "s1.x2": {"storage": "small", "qps": "medium", "cost": "$$"},
    "p1.x1": {"storage": "medium", "qps": "medium", "cost": "$$"},
    "p1.x2": {"storage": "medium", "qps": "high", "cost": "$$$"},
    "p2.x1": {"storage": "large", "qps": "high", "cost": "$$$$"}
}

def estimate_pod_requirements(
    num_vectors: int,
    dimension: int = 1536,
    qps_required: int = 10
) -> str:
    """Estimate required pod type."""
    # Rough estimates
    vectors_per_pod = {
        "s1": 500_000,
        "p1": 1_000_000,
        "p2": 5_000_000
    }

    if num_vectors < 500_000 and qps_required < 20:
        return "s1.x1"
    elif num_vectors < 1_000_000:
        return "p1.x1"
    elif num_vectors < 5_000_000:
        return "p1.x2"
    else:
        return "p2.x1"
```

## Best Practices

1. **Use batching**: Upsert in batches of 100+ for efficiency
2. **Store text in metadata**: Include searchable text in metadata
3. **Use namespaces**: Organize data and enable multi-tenant
4. **Optimize filters**: Use appropriate metadata types
5. **Monitor usage**: Track vector count and query volume
6. **Consider pod types**: Balance cost and performance

## Resources

- [Pinecone Documentation](https://docs.pinecone.io/)
- [Pinecone Python Client](https://github.com/pinecone-io/pinecone-python-client)
- [Pricing Calculator](https://www.pinecone.io/pricing/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
