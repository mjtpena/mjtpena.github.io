---
title: "Cosmos DB Vector Search: Implementing Semantic Search at Global Scale"
description: "Configure your Cosmos account with write regions near your users and read replicas globally. Vector searches automatically route to the nearest replica…"
author: Michael John Peña
draft: false
date: 2025-07-08
tags:
  - Cosmos DB
  - Vector Search
  - NoSQL
  - Global Distribution
  - Python
---

## Configuring Vector Indexing

Set up your container with vector indexing policies that balance performance and cost:

```python
from azure.cosmos import CosmosClient, PartitionKey
from azure.cosmos.documents import IndexingMode

client = CosmosClient(endpoint, credential)
database = client.get_database_client("semantic-search")

# Create container with vector indexing
container = database.create_container_if_not_exists(
    id="documents",
    partition_key=PartitionKey(path="/category"),
    indexing_policy={
        "indexingMode": IndexingMode.Consistent,
        "includedPaths": [{"path": "/*"}],
        "excludedPaths": [{"path": "/embedding/*"}],
        "vectorIndexes": [
            {
                "path": "/embedding",
                "type": "quantizedFlat",
                "quantizationConfig": {
                    "quantizationType": "int8"
                },
                "dimensions": 1536,
                "distanceFunction": "cosine"
            }
        ]
    },
    vector_embedding_policy={
        "vectorEmbeddings": [
            {
                "path": "/embedding",
                "dataType": "float32",
                "dimensions": 1536,
                "distanceFunction": "cosine"
            }
        ]
    },
    offer_throughput=10000
)
```

## Executing Vector Queries

Combine vector similarity with SQL filtering for powerful hybrid queries:

```python
async def semantic_search(query_embedding: list, category: str, limit: int = 10):
    query = """
    SELECT TOP @limit c.id, c.title, c.content,
           VectorDistance(c.embedding, @embedding) AS similarity
    FROM c
    WHERE c.category = @category
    ORDER BY VectorDistance(c.embedding, @embedding)
    """

    results = container.query_items(
        query=query,
        parameters=[
            {"name": "@limit", "value": limit},
            {"name": "@embedding", "value": query_embedding},
            {"name": "@category", "value": category}
        ],
        enable_cross_partition_query=True
    )

    return [doc async for doc in results]
```

## Global Distribution Strategy

Configure your Cosmos account with write regions near your users and read replicas globally. Vector searches automatically route to the nearest replica, delivering consistent sub-10ms latency worldwide.
