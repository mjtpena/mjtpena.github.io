---
title: "Qdrant Vector Database: Fast and Efficient Similarity Search"
author: Michael John Peña
draft: false
date: 2023-01-29
tags:
  - Qdrant
  - Vector Database
  - Embeddings
  - AI
  - rust
---

## Getting Started

```bash
# Install Qdrant client
pip install qdrant-client openai

# Run Qdrant with Docker
docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant
```

```python
from qdrant_client import QdrantClient
from qdrant_client.http import models
import openai

# Connect to Qdrant
client = QdrantClient(host="localhost", port=6333)

# Or connect to Qdrant Cloud
# client = QdrantClient(
#     url="https://your-cluster.qdrant.io",
#     api_key="your-api-key"
# )

# Configure Azure OpenAI
openai.api_type = "azure"
openai.api_base = "https://your-resource.openai.azure.com/"
openai.api_version = "2023-03-15-preview"
openai.api_key = "your-azure-key"
```

## Creating Collections

```python
from qdrant_client.http.models import Distance, VectorParams

def create_collection(
    client: QdrantClient,
    name: str,
    dimension: int = 1536
):
    """Create a Qdrant collection."""
    client.create_collection(
        collection_name=name,
        vectors_config=VectorParams(
            size=dimension,
            distance=Distance.COSINE
        )
    )

# Create collection
create_collection(client, "azure_docs")

# With custom configuration
client.create_collection(
    collection_name="advanced_docs",
    vectors_config=VectorParams(
        size=1536,
        distance=Distance.COSINE,
        on_disk=True  # Store vectors on disk for large collections
    ),
    optimizers_config=models.OptimizersConfigDiff(
        indexing_threshold=10000  # Start indexing after 10k vectors
    ),
    hnsw_config=models.HnswConfigDiff(
        m=16,
        ef_construct=100
    )
)

# List collections
collections = client.get_collections()
print([c.name for c in collections.collections])
```

## Upserting Points

```python
from qdrant_client.http.models import PointStruct
from typing import List, Dict, Any
import uuid

def get_embedding(text: str) -> List[float]:
    """Get embedding from Azure OpenAI."""
    response = openai.Embedding.create(
        engine="text-embedding-ada-002",
        input=text
    )
    return response['data'][0]['embedding']

def upsert_documents(
    client: QdrantClient,
    collection: str,
    documents: List[Dict[str, Any]],
    text_field: str = "text",
    batch_size: int = 100
):
    """Upsert documents to collection."""

    for i in range(0, len(documents), batch_size):
        batch = documents[i:i + batch_size]

        points = []
        for doc in batch:
            text = doc.get(text_field, "")
            embedding = get_embedding(text)

            point = PointStruct(
                id=doc.get("id", str(uuid.uuid4())),
                vector=embedding,
                payload={k: v for k, v in doc.items() if k != "id"}
            )
            points.append(point)

        client.upsert(
            collection_name=collection,
            points=points
        )

    return len(documents)

# Upsert documents
documents = [
    {
        "id": "doc1",
        "text": "Azure Virtual Machines provide IaaS compute resources",
        "category": "compute",
        "tags": ["vm", "iaas"]
    },
    {
        "id": "doc2",
        "text": "Azure Functions is a serverless compute service",
        "category": "compute",
        "tags": ["serverless", "functions"]
    },
    {
        "id": "doc3",
        "text": "Azure Cosmos DB is a globally distributed database",
        "category": "database",
        "tags": ["nosql", "global"]
    }
]

upsert_documents(client, "azure_docs", documents)
```

## Searching

```python
from qdrant_client.http.models import Filter, FieldCondition, MatchValue

def search(
    client: QdrantClient,
    collection: str,
    query: str,
    top_k: int = 10,
    filter_conditions: Filter = None
) -> List[Dict]:
    """Search for similar documents."""
    query_embedding = get_embedding(query)

    results = client.search(
        collection_name=collection,
        query_vector=query_embedding,
        limit=top_k,
        query_filter=filter_conditions,
        with_payload=True
    )

    return [
        {
            "id": hit.id,
            "score": hit.score,
            **hit.payload
        }
        for hit in results
    ]

# Simple search
results = search(client, "azure_docs", "serverless computing")
for r in results:
    print(f"[{r['score']:.4f}] {r.get('text', '')[:60]}...")

# Search with filter
filter_condition = Filter(
    must=[
        FieldCondition(
            key="category",
            match=MatchValue(value="compute")
        )
    ]
)

results = search(
    client,
    "azure_docs",
    "database for analytics",
    filter_conditions=filter_condition
)
```

## Advanced Filtering

```python
from qdrant_client.http.models import (
    Filter, FieldCondition, MatchValue, MatchText,
    Range, HasIdCondition, IsEmptyCondition, IsNullCondition
)

# Equality filter
filter_eq = Filter(
    must=[
        FieldCondition(key="category", match=MatchValue(value="compute"))
    ]
)

# Text match (full-text search on indexed field)
filter_text = Filter(
    must=[
        FieldCondition(key="text", match=MatchText(text="serverless"))
    ]
)

# Range filter
filter_range = Filter(
    must=[
        FieldCondition(
            key="timestamp",
            range=Range(gte=1672531200, lte=1704067200)
        )
    ]
)

# Array contains
filter_array = Filter(
    must=[
        FieldCondition(key="tags", match=MatchValue(value="serverless"))
    ]
)

# Multiple conditions (AND)
filter_and = Filter(
    must=[
        FieldCondition(key="category", match=MatchValue(value="compute")),
        FieldCondition(key="tags", match=MatchValue(value="serverless"))
    ]
)

# OR conditions
filter_or = Filter(
    should=[
        FieldCondition(key="category", match=MatchValue(value="compute")),
        FieldCondition(key="category", match=MatchValue(value="database"))
    ]
)

# NOT conditions
filter_not = Filter(
    must_not=[
        FieldCondition(key="category", match=MatchValue(value="networking"))
    ]
)

# Complex nested filter
filter_complex = Filter(
    must=[
        FieldCondition(key="category", match=MatchValue(value="compute"))
    ],
    should=[
        FieldCondition(key="tags", match=MatchValue(value="serverless")),
        FieldCondition(key="tags", match=MatchValue(value="containers"))
    ],
    must_not=[
        FieldCondition(key="deprecated", match=MatchValue(value=True))
    ]
)
```

## Payload Indexing

```python
# Create payload indexes for faster filtering
from qdrant_client.http.models import PayloadSchemaType

# Index string field
client.create_payload_index(
    collection_name="azure_docs",
    field_name="category",
    field_schema=PayloadSchemaType.KEYWORD
)

# Index numeric field
client.create_payload_index(
    collection_name="azure_docs",
    field_name="timestamp",
    field_schema=PayloadSchemaType.INTEGER
)

# Index text field (for full-text search)
client.create_payload_index(
    collection_name="azure_docs",
    field_name="text",
    field_schema=PayloadSchemaType.TEXT
)
```

## Complete Search Service

```python
from qdrant_client import QdrantClient
from qdrant_client.http import models
from typing import List, Dict, Any, Optional

class QdrantSearchService:
    """Search service using Qdrant and Azure OpenAI."""

    def __init__(
        self,
        host: str = "localhost",
        port: int = 6333,
        embedding_deployment: str = "text-embedding-ada-002"
    ):
        self.client = QdrantClient(host=host, port=port)
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

    def create_collection(
        self,
        name: str,
        dimension: int = 1536
    ):
        """Create a new collection."""
        self.client.create_collection(
            collection_name=name,
            vectors_config=models.VectorParams(
                size=dimension,
                distance=models.Distance.COSINE
            )
        )

    def add_documents(
        self,
        collection: str,
        documents: List[Dict],
        text_field: str = "text",
        batch_size: int = 100
    ):
        """Add documents to collection."""
        for i in range(0, len(documents), batch_size):
            batch = documents[i:i + batch_size]
            texts = [doc[text_field] for doc in batch]
            embeddings = self._embed_batch(texts)

            points = [
                models.PointStruct(
                    id=doc.get("id", str(uuid.uuid4())),
                    vector=emb,
                    payload={k: v for k, v in doc.items() if k != "id"}
                )
                for doc, emb in zip(batch, embeddings)
            ]

            self.client.upsert(collection_name=collection, points=points)

    def search(
        self,
        collection: str,
        query: str,
        top_k: int = 10,
        filter_dict: Optional[Dict] = None
    ) -> List[Dict]:
        """Search for similar documents."""
        query_embedding = self._embed(query)

        # Build filter if provided
        query_filter = None
        if filter_dict:
            conditions = [
                models.FieldCondition(
                    key=key,
                    match=models.MatchValue(value=value)
                )
                for key, value in filter_dict.items()
            ]
            query_filter = models.Filter(must=conditions)

        results = self.client.search(
            collection_name=collection,
            query_vector=query_embedding,
            limit=top_k,
            query_filter=query_filter,
            with_payload=True
        )

        return [
            {"id": hit.id, "score": hit.score, **hit.payload}
            for hit in results
        ]

    def delete_documents(self, collection: str, ids: List[str]):
        """Delete documents by ID."""
        self.client.delete(
            collection_name=collection,
            points_selector=models.PointIdsList(points=ids)
        )

    def get_collection_info(self, collection: str) -> Dict:
        """Get collection information."""
        info = self.client.get_collection(collection)
        return {
            "name": collection,
            "vectors_count": info.vectors_count,
            "points_count": info.points_count,
            "status": info.status
        }

# Usage
service = QdrantSearchService()
service.create_collection("my_docs")

service.add_documents("my_docs", [
    {"id": "1", "text": "Azure is great", "category": "cloud"},
    {"id": "2", "text": "Python is powerful", "category": "programming"}
])

results = service.search(
    "my_docs",
    "cloud computing",
    filter_dict={"category": "cloud"}
)
```

## Best Practices

1. **Index payload fields**: For frequently filtered fields
2. **Use appropriate distance**: Cosine for normalized, Dot for raw
3. **Tune HNSW params**: Balance memory vs accuracy
4. **Batch operations**: Upsert in batches for efficiency
5. **Use on_disk**: For large collections
6. **Monitor performance**: Track search latency

## Resources

- [Qdrant Documentation](https://qdrant.tech/documentation/)
- [Qdrant Python Client](https://github.com/qdrant/qdrant-client)
- [Qdrant Cloud](https://cloud.qdrant.io/)
