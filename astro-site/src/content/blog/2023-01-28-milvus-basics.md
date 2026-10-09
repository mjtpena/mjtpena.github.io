---
title: "Milvus Vector Database: High-Performance Similarity Search"
author: Michael John Peña
draft: false
date: 2023-01-28
tags:
  - Milvus
  - Vector Database
  - Embeddings
  - AI
  - High Performance
---

## Getting Started

```bash
# Install Milvus client
pip install pymilvus openai

# Run Milvus with Docker Compose
# Download docker-compose.yml from Milvus docs
docker-compose up -d
```

```python
from pymilvus import (
    connections,
    Collection,
    CollectionSchema,
    FieldSchema,
    DataType,
    utility
)
import openai

# Connect to Milvus
connections.connect("default", host="localhost", port="19530")

# Configure Azure OpenAI
openai.api_type = "azure"
openai.api_base = "https://your-resource.openai.azure.com/"
openai.api_version = "2023-03-15-preview"
openai.api_key = "your-azure-key"
```

## Creating Collections

```python
from pymilvus import CollectionSchema, FieldSchema, DataType, Collection

def create_collection(
    name: str,
    dimension: int = 1536,
    description: str = ""
):
    """Create a Milvus collection."""

    # Define fields
    fields = [
        FieldSchema(
            name="id",
            dtype=DataType.VARCHAR,
            max_length=100,
            is_primary=True,
            auto_id=False
        ),
        FieldSchema(
            name="embedding",
            dtype=DataType.FLOAT_VECTOR,
            dim=dimension
        ),
        FieldSchema(
            name="text",
            dtype=DataType.VARCHAR,
            max_length=5000
        ),
        FieldSchema(
            name="category",
            dtype=DataType.VARCHAR,
            max_length=100
        ),
        FieldSchema(
            name="timestamp",
            dtype=DataType.INT64
        )
    ]

    schema = CollectionSchema(
        fields=fields,
        description=description
    )

    collection = Collection(
        name=name,
        schema=schema
    )

    return collection

# Create collection
collection = create_collection("azure_docs", description="Azure documentation")

# Check existing collections
print(utility.list_collections())
```

## Creating Indexes

```python
# Create index for vector search
index_params = {
    "metric_type": "IP",  # Inner Product (cosine for normalized vectors)
    "index_type": "IVF_FLAT",
    "params": {"nlist": 1024}
}

collection.create_index(
    field_name="embedding",
    index_params=index_params
)

# Index types comparison
INDEX_TYPES = {
    "FLAT": {
        "description": "Brute force, 100% accurate",
        "use_case": "Small datasets < 1M",
        "params": {}
    },
    "IVF_FLAT": {
        "description": "Inverted file index",
        "use_case": "Balanced accuracy/speed",
        "params": {"nlist": 1024}  # Number of clusters
    },
    "IVF_SQ8": {
        "description": "IVF with scalar quantization",
        "use_case": "Memory constrained",
        "params": {"nlist": 1024}
    },
    "HNSW": {
        "description": "Graph-based, very fast",
        "use_case": "Low latency requirements",
        "params": {"M": 16, "efConstruction": 256}
    }
}

# HNSW index for low latency
hnsw_params = {
    "metric_type": "IP",
    "index_type": "HNSW",
    "params": {"M": 16, "efConstruction": 256}
}
```

## Inserting Data

```python
from typing import List
import time

def get_embedding(text: str) -> List[float]:
    """Get embedding from Azure OpenAI."""
    response = openai.Embedding.create(
        engine="text-embedding-ada-002",
        input=text
    )
    return response['data'][0]['embedding']

def insert_documents(
    collection: Collection,
    documents: List[dict]
):
    """Insert documents into collection."""

    ids = []
    embeddings = []
    texts = []
    categories = []
    timestamps = []

    for doc in documents:
        ids.append(doc["id"])
        embeddings.append(get_embedding(doc["text"]))
        texts.append(doc["text"][:5000])  # Truncate to max length
        categories.append(doc.get("category", ""))
        timestamps.append(int(time.time()))

    # Insert data
    collection.insert([
        ids,
        embeddings,
        texts,
        categories,
        timestamps
    ])

    # Flush to persist
    collection.flush()

    return len(ids)

# Insert example documents
documents = [
    {
        "id": "doc1",
        "text": "Azure Virtual Machines provide scalable IaaS compute",
        "category": "compute"
    },
    {
        "id": "doc2",
        "text": "Azure Functions is a serverless compute service",
        "category": "compute"
    },
    {
        "id": "doc3",
        "text": "Azure Cosmos DB is a globally distributed NoSQL database",
        "category": "database"
    }
]

count = insert_documents(collection, documents)
print(f"Inserted {count} documents")
```

## Searching

```python
def search(
    collection: Collection,
    query: str,
    top_k: int = 10,
    output_fields: List[str] = None,
    expr: str = None
):
    """Search for similar vectors."""

    # Load collection to memory
    collection.load()

    # Get query embedding
    query_embedding = get_embedding(query)

    # Search parameters
    search_params = {
        "metric_type": "IP",
        "params": {"nprobe": 16}  # Number of clusters to search
    }

    results = collection.search(
        data=[query_embedding],
        anns_field="embedding",
        param=search_params,
        limit=top_k,
        output_fields=output_fields or ["text", "category"],
        expr=expr  # Filter expression
    )

    return results

# Simple search
results = search(collection, "serverless computing")
for hits in results:
    for hit in hits:
        print(f"[{hit.score:.4f}] {hit.entity.get('text')[:60]}...")

# Search with filter
results = search(
    collection,
    "database for high throughput",
    expr='category == "database"'
)

# Complex filter expressions
expr_examples = [
    'category == "compute"',
    'category in ["compute", "database"]',
    'timestamp > 1672531200',
    'category == "compute" and timestamp > 1672531200'
]
```

## Batch Operations

```python
def batch_insert(
    collection: Collection,
    documents: List[dict],
    batch_size: int = 1000
):
    """Insert documents in batches."""

    total = 0

    for i in range(0, len(documents), batch_size):
        batch = documents[i:i + batch_size]

        ids = [doc["id"] for doc in batch]
        texts = [doc["text"][:5000] for doc in batch]
        categories = [doc.get("category", "") for doc in batch]
        timestamps = [int(time.time()) for _ in batch]

        # Batch embed
        response = openai.Embedding.create(
            engine="text-embedding-ada-002",
            input=texts
        )
        embeddings = [item['embedding'] for item in response['data']]

        collection.insert([ids, embeddings, texts, categories, timestamps])
        total += len(batch)

        print(f"Inserted batch {i//batch_size + 1}, total: {total}")

    collection.flush()
    return total
```

## Complete Search Service

```python
from pymilvus import connections, Collection, utility
from typing import List, Dict, Optional

class MilvusSearchService:
    """Search service using Milvus and Azure OpenAI."""

    def __init__(
        self,
        host: str = "localhost",
        port: str = "19530",
        embedding_deployment: str = "text-embedding-ada-002"
    ):
        connections.connect("default", host=host, port=port)
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

    def get_collection(self, name: str) -> Collection:
        """Get or create collection."""
        if utility.has_collection(name):
            return Collection(name)
        else:
            raise ValueError(f"Collection {name} does not exist")

    def add_documents(
        self,
        collection_name: str,
        documents: List[Dict],
        text_field: str = "text",
        batch_size: int = 100
    ):
        """Add documents to collection."""
        collection = self.get_collection(collection_name)

        for i in range(0, len(documents), batch_size):
            batch = documents[i:i + batch_size]
            texts = [doc[text_field][:5000] for doc in batch]
            embeddings = self._embed_batch(texts)

            # Prepare data
            ids = [doc.get("id", str(hash(doc[text_field]))) for doc in batch]
            categories = [doc.get("category", "") for doc in batch]
            timestamps = [int(time.time()) for _ in batch]

            collection.insert([ids, embeddings, texts, categories, timestamps])

        collection.flush()

    def search(
        self,
        collection_name: str,
        query: str,
        top_k: int = 10,
        filter_expr: Optional[str] = None
    ) -> List[Dict]:
        """Search for similar documents."""
        collection = self.get_collection(collection_name)
        collection.load()

        query_embedding = self._embed(query)

        results = collection.search(
            data=[query_embedding],
            anns_field="embedding",
            param={"metric_type": "IP", "params": {"nprobe": 16}},
            limit=top_k,
            output_fields=["text", "category"],
            expr=filter_expr
        )

        return [
            {
                "id": hit.id,
                "score": hit.score,
                "text": hit.entity.get("text"),
                "category": hit.entity.get("category")
            }
            for hits in results
            for hit in hits
        ]

    def delete_documents(
        self,
        collection_name: str,
        expr: str
    ):
        """Delete documents matching expression."""
        collection = self.get_collection(collection_name)
        collection.delete(expr)

    def get_stats(self, collection_name: str) -> Dict:
        """Get collection statistics."""
        collection = self.get_collection(collection_name)
        return {
            "name": collection_name,
            "num_entities": collection.num_entities,
            "schema": str(collection.schema)
        }

# Usage
service = MilvusSearchService()

# Search
results = service.search("azure_docs", "serverless computing", top_k=5)
for r in results:
    print(f"[{r['score']:.4f}] {r['text'][:60]}...")
```

## Performance Tuning

```python
# Search parameter tuning
SEARCH_PARAMS = {
    "IVF_FLAT": {
        "nprobe": 16,  # Increase for accuracy, decrease for speed
    },
    "HNSW": {
        "ef": 64,  # Increase for accuracy, decrease for speed
    }
}

# Memory management
collection.release()  # Release from memory when not in use
collection.load()     # Load when searching

# Partition for better performance
collection.create_partition("compute")
collection.create_partition("database")

# Insert to specific partition
collection.insert(data, partition_name="compute")

# Search specific partition
collection.search(
    data=[query_embedding],
    partition_names=["compute"],
    ...
)
```

## Best Practices

1. **Choose index wisely**: HNSW for low latency, IVF for memory efficiency
2. **Tune search parameters**: Balance accuracy and speed
3. **Use partitions**: For filtered searches and data management
4. **Manage memory**: Load/release collections appropriately
5. **Batch operations**: Insert in batches for efficiency
6. **Monitor performance**: Track query latency and recall

## Resources

- [Milvus Documentation](https://milvus.io/docs)
- [PyMilvus](https://github.com/milvus-io/pymilvus)
- [Zilliz Cloud](https://zilliz.com/) (Managed Milvus)
