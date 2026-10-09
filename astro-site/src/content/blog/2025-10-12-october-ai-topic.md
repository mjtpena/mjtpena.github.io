---
title: "Azure Cosmos DB for AI Applications: Vector Search and Change Feed Patterns"
description: "Use Change Feed to trigger embedding generation and synchronization with other AI services automatically when documents are created or updated."
author: Michael John Peña
draft: false
date: 2025-10-12
tags:
  - Azure Cosmos DB
  - Vector Search
  - NoSQL
  - AI Applications
  - Change Feed
---

## Configuring Vector Search in Cosmos DB

Set up a container with vector indexing for similarity search:

```python
from azure.cosmos import CosmosClient, PartitionKey
from azure.cosmos.documents import IndexingPolicy, VectorEmbeddingPolicy

def create_vector_container(
    client: CosmosClient,
    database_name: str,
    container_name: str,
    vector_dimensions: int = 1536
):
    """Create a Cosmos DB container with vector search capabilities."""

    database = client.create_database_if_not_exists(database_name)

    vector_embedding_policy = {
        "vectorEmbeddings": [
            {
                "path": "/embedding",
                "dataType": "float32",
                "distanceFunction": "cosine",
                "dimensions": vector_dimensions
            }
        ]
    }

    indexing_policy = {
        "includedPaths": [{"path": "/*"}],
        "excludedPaths": [{"path": "/embedding/*"}],
        "vectorIndexes": [
            {"path": "/embedding", "type": "quantizedFlat"}
        ]
    }

    container = database.create_container_if_not_exists(
        id=container_name,
        partition_key=PartitionKey(path="/category"),
        indexing_policy=indexing_policy,
        vector_embedding_policy=vector_embedding_policy,
        offer_throughput=1000
    )

    return container
```

## Implementing Vector Search Queries

Query documents by vector similarity:

```python
class CosmosVectorSearch:
    def __init__(self, container):
        self.container = container

    def similarity_search(
        self,
        query_vector: list[float],
        top_k: int = 10,
        category_filter: str = None
    ) -> list[dict]:
        """Find documents similar to the query vector."""

        query = """
        SELECT TOP @top_k c.id, c.title, c.content, c.category,
               VectorDistance(c.embedding, @query_vector) AS similarity
        FROM c
        """

        if category_filter:
            query += " WHERE c.category = @category"

        query += " ORDER BY VectorDistance(c.embedding, @query_vector)"

        parameters = [
            {"name": "@top_k", "value": top_k},
            {"name": "@query_vector", "value": query_vector}
        ]

        if category_filter:
            parameters.append({"name": "@category", "value": category_filter})

        results = list(self.container.query_items(
            query=query,
            parameters=parameters,
            enable_cross_partition_query=True
        ))

        return results

    def hybrid_search(self, query_vector: list[float], text_query: str, top_k: int = 10) -> list[dict]:
        """Combine vector and text search."""

        query = """
        SELECT TOP @top_k c.id, c.title, c.content,
               VectorDistance(c.embedding, @query_vector) AS vector_score
        FROM c
        WHERE CONTAINS(c.content, @text_query, true)
        ORDER BY VectorDistance(c.embedding, @query_vector)
        """

        return list(self.container.query_items(
            query=query,
            parameters=[
                {"name": "@top_k", "value": top_k},
                {"name": "@query_vector", "value": query_vector},
                {"name": "@text_query", "value": text_query}
            ],
            enable_cross_partition_query=True
        ))
```

## Change Feed for Real-Time AI Pipelines

Use Change Feed to trigger embedding generation and synchronization with other AI services automatically when documents are created or updated.
