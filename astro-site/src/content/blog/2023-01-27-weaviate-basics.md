---
title: "Weaviate Vector Database: Open Source Semantic Search"
author: Michael John Peña
draft: false
date: 2023-01-27
tags:
  - Weaviate
  - Vector Database
  - Embeddings
  - AI
  - Open Source
---

## Getting Started

```bash
# Install Weaviate client
pip install weaviate-client openai

# Run Weaviate locally with Docker
docker run -d -p 8080:8080 semitechnologies/weaviate:latest
```

```python
import weaviate
import openai

# Connect to Weaviate
client = weaviate.Client("http://localhost:8080")

# Configure Azure OpenAI
openai.api_type = "azure"
openai.api_base = "https://your-resource.openai.azure.com/"
openai.api_version = "2023-03-15-preview"
openai.api_key = "your-azure-key"
```

## Schema Definition

Weaviate uses a schema-first approach:

```python
# Define schema for documents
schema = {
    "classes": [
        {
            "class": "Document",
            "description": "A searchable document",
            "vectorizer": "none",  # We'll provide our own vectors
            "properties": [
                {
                    "name": "title",
                    "dataType": ["string"],
                    "description": "Document title"
                },
                {
                    "name": "content",
                    "dataType": ["text"],
                    "description": "Document content"
                },
                {
                    "name": "category",
                    "dataType": ["string"],
                    "description": "Document category"
                },
                {
                    "name": "createdAt",
                    "dataType": ["date"],
                    "description": "Creation timestamp"
                },
                {
                    "name": "tags",
                    "dataType": ["string[]"],
                    "description": "Document tags"
                }
            ]
        }
    ]
}

# Create schema
client.schema.create(schema)

# Or create individual class
client.schema.create_class({
    "class": "Article",
    "vectorizer": "none",
    "properties": [
        {"name": "title", "dataType": ["string"]},
        {"name": "body", "dataType": ["text"]},
        {"name": "author", "dataType": ["string"]}
    ]
})
```

## Adding Data

```python
from typing import List, Dict, Any
import uuid

def get_embedding(text: str) -> List[float]:
    """Get embedding from Azure OpenAI."""
    response = openai.Embedding.create(
        engine="text-embedding-ada-002",
        input=text
    )
    return response['data'][0]['embedding']

def add_document(
    client: weaviate.Client,
    class_name: str,
    properties: Dict[str, Any],
    text_for_embedding: str,
    doc_id: str = None
) -> str:
    """Add a document with embedding."""
    embedding = get_embedding(text_for_embedding)

    doc_uuid = doc_id or str(uuid.uuid4())

    client.data_object.create(
        class_name=class_name,
        data_object=properties,
        vector=embedding,
        uuid=doc_uuid
    )

    return doc_uuid

# Add single document
doc_id = add_document(
    client,
    "Document",
    {
        "title": "Azure Functions Guide",
        "content": "Azure Functions is a serverless compute service...",
        "category": "compute",
        "tags": ["serverless", "azure", "functions"]
    },
    "Azure Functions is a serverless compute service that runs event-driven code"
)

# Batch add documents
def batch_add_documents(
    client: weaviate.Client,
    class_name: str,
    documents: List[Dict[str, Any]],
    text_field: str = "content"
):
    """Add multiple documents in batch."""
    with client.batch as batch:
        batch.batch_size = 100

        for doc in documents:
            text = doc.get(text_field, "")
            embedding = get_embedding(text)

            batch.add_data_object(
                data_object=doc,
                class_name=class_name,
                vector=embedding
            )

# Example batch add
documents = [
    {
        "title": "VM Guide",
        "content": "Azure Virtual Machines provide IaaS compute",
        "category": "compute"
    },
    {
        "title": "Cosmos DB Guide",
        "content": "Azure Cosmos DB is a globally distributed database",
        "category": "database"
    }
]

batch_add_documents(client, "Document", documents)
```

## Querying

```python
def semantic_search(
    client: weaviate.Client,
    class_name: str,
    query: str,
    limit: int = 10,
    properties: List[str] = None
) -> List[Dict]:
    """Perform semantic search."""
    query_embedding = get_embedding(query)

    result = (
        client.query
        .get(class_name, properties or ["title", "content", "category"])
        .with_near_vector({"vector": query_embedding})
        .with_limit(limit)
        .with_additional(["distance", "id"])
        .do()
    )

    return result["data"]["Get"][class_name]

# Simple search
results = semantic_search(client, "Document", "serverless computing")
for r in results:
    print(f"[{r['_additional']['distance']:.4f}] {r['title']}")

# Search with filters
def filtered_search(
    client: weaviate.Client,
    class_name: str,
    query: str,
    where_filter: Dict,
    limit: int = 10
) -> List[Dict]:
    """Semantic search with filters."""
    query_embedding = get_embedding(query)

    result = (
        client.query
        .get(class_name, ["title", "content", "category"])
        .with_near_vector({"vector": query_embedding})
        .with_where(where_filter)
        .with_limit(limit)
        .with_additional(["distance"])
        .do()
    )

    return result["data"]["Get"][class_name]

# Filter by category
where_filter = {
    "path": ["category"],
    "operator": "Equal",
    "valueString": "compute"
}

results = filtered_search(client, "Document", "database", where_filter)
```

## Advanced Filtering

```python
# Weaviate filter operators

# Equality
where = {
    "path": ["category"],
    "operator": "Equal",
    "valueString": "compute"
}

# Comparison operators
where = {
    "path": ["createdAt"],
    "operator": "GreaterThan",
    "valueDate": "2023-01-01T00:00:00Z"
}

# Contains (for arrays)
where = {
    "path": ["tags"],
    "operator": "ContainsAny",
    "valueStringArray": ["serverless", "cloud"]
}

# Logical AND
where = {
    "operator": "And",
    "operands": [
        {
            "path": ["category"],
            "operator": "Equal",
            "valueString": "compute"
        },
        {
            "path": ["createdAt"],
            "operator": "GreaterThan",
            "valueDate": "2023-01-01T00:00:00Z"
        }
    ]
}

# Logical OR
where = {
    "operator": "Or",
    "operands": [
        {
            "path": ["category"],
            "operator": "Equal",
            "valueString": "compute"
        },
        {
            "path": ["category"],
            "operator": "Equal",
            "valueString": "database"
        }
    ]
}

# Text search within content
where = {
    "path": ["content"],
    "operator": "Like",
    "valueString": "*serverless*"
}
```

## Hybrid Search

Combine vector search with keyword search:

```python
def hybrid_search(
    client: weaviate.Client,
    class_name: str,
    query: str,
    alpha: float = 0.5,  # 0 = keyword only, 1 = vector only
    limit: int = 10
) -> List[Dict]:
    """Hybrid search combining vector and keyword."""
    query_embedding = get_embedding(query)

    result = (
        client.query
        .get(class_name, ["title", "content"])
        .with_hybrid(
            query=query,
            vector=query_embedding,
            alpha=alpha
        )
        .with_limit(limit)
        .with_additional(["score"])
        .do()
    )

    return result["data"]["Get"][class_name]

# More vector weight
results = hybrid_search(client, "Document", "cloud computing", alpha=0.75)

# More keyword weight
results = hybrid_search(client, "Document", "Azure Functions", alpha=0.25)
```

## Complete Search Service

```python
class WeaviateSearchService:
    """Search service using Weaviate and Azure OpenAI."""

    def __init__(
        self,
        weaviate_url: str,
        embedding_deployment: str = "text-embedding-ada-002"
    ):
        self.client = weaviate.Client(weaviate_url)
        self.embedding_deployment = embedding_deployment

    def _embed(self, text: str) -> List[float]:
        """Get embedding for text."""
        response = openai.Embedding.create(
            engine=self.embedding_deployment,
            input=text
        )
        return response['data'][0]['embedding']

    def create_class(
        self,
        class_name: str,
        properties: List[Dict]
    ):
        """Create a new class in the schema."""
        self.client.schema.create_class({
            "class": class_name,
            "vectorizer": "none",
            "properties": properties
        })

    def add_documents(
        self,
        class_name: str,
        documents: List[Dict],
        text_field: str = "content"
    ):
        """Add documents with embeddings."""
        with self.client.batch as batch:
            batch.batch_size = 100

            for doc in documents:
                text = doc.get(text_field, "")
                embedding = self._embed(text)

                batch.add_data_object(
                    data_object=doc,
                    class_name=class_name,
                    vector=embedding
                )

    def search(
        self,
        class_name: str,
        query: str,
        properties: List[str],
        limit: int = 10,
        where_filter: Dict = None
    ) -> List[Dict]:
        """Perform semantic search."""
        query_embedding = self._embed(query)

        query_builder = (
            self.client.query
            .get(class_name, properties)
            .with_near_vector({"vector": query_embedding})
            .with_limit(limit)
            .with_additional(["distance", "id"])
        )

        if where_filter:
            query_builder = query_builder.with_where(where_filter)

        result = query_builder.do()
        return result["data"]["Get"][class_name]

    def hybrid_search(
        self,
        class_name: str,
        query: str,
        properties: List[str],
        alpha: float = 0.5,
        limit: int = 10
    ) -> List[Dict]:
        """Hybrid vector + keyword search."""
        query_embedding = self._embed(query)

        result = (
            self.client.query
            .get(class_name, properties)
            .with_hybrid(query=query, vector=query_embedding, alpha=alpha)
            .with_limit(limit)
            .with_additional(["score"])
            .do()
        )

        return result["data"]["Get"][class_name]

    def delete_class(self, class_name: str):
        """Delete a class and all its data."""
        self.client.schema.delete_class(class_name)

    def get_schema(self) -> Dict:
        """Get current schema."""
        return self.client.schema.get()

# Usage
service = WeaviateSearchService("http://localhost:8080")

# Create class
service.create_class("Article", [
    {"name": "title", "dataType": ["string"]},
    {"name": "content", "dataType": ["text"]},
    {"name": "category", "dataType": ["string"]}
])

# Add documents
service.add_documents("Article", [
    {"title": "Azure Guide", "content": "Azure is...", "category": "cloud"},
    {"title": "Python Guide", "content": "Python is...", "category": "programming"}
])

# Search
results = service.search(
    "Article",
    "cloud computing",
    ["title", "content", "category"]
)
```

## Best Practices

1. **Define schema carefully**: Properties and types matter
2. **Use batching**: For efficient data loading
3. **Choose appropriate filters**: Use indexed properties
4. **Tune hybrid alpha**: Based on your use case
5. **Monitor performance**: Use Weaviate metrics
6. **Backup regularly**: Export data periodically

## Resources

- [Weaviate Documentation](https://weaviate.io/developers/weaviate)
- [Weaviate Python Client](https://github.com/weaviate/weaviate-python-client)
- [Weaviate Cloud Services](https://weaviate.io/pricing)
