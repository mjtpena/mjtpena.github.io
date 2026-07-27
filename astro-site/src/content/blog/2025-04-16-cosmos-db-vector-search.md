---
title: "Cosmos DB Vector Search: Building AI-Ready Databases"
author: Michael John Peña
draft: false
date: 2025-04-16
tags:
  - Azure
  - Cosmos DB
  - Vector
  - Database
  - AI

---

I wrote "Cosmos DB Vector Search: Building AI-Ready Databases" to share practical, production-minded guidance on this topic.

## Cosmos DB Vector Search

```python
from azure.cosmos import CosmosClient, PartitionKey
from azure.cosmos.exceptions import CosmosResourceNotFoundError
import json

class CosmosVectorStore:
    def __init__(self, connection_string: str, database_name: str, container_name: str):
        self.client = CosmosClient.from_connection_string(connection_string)
        self.database = self.client.get_database_client(database_name)
        self.container = self.database.get_container_client(container_name)

    def create_container_with_vector(self):
        """Create container with vector indexing policy."""
        indexing_policy = {
            "indexingMode": "consistent",
            "automatic": True,
            "includedPaths": [{"path": "/*"}],
            "excludedPaths": [{"path": "/embedding/*"}],
            "vectorIndexes": [
                {
                    "path": "/embedding",
                    "type": "quantizedFlat"  # or "flat", "diskANN"
                }
            ]
        }

        vector_embedding_policy = {
            "vectorEmbeddings": [
                {
                    "path": "/embedding",
                    "dataType": "float32",
                    "distanceFunction": "cosine",
                    "dimensions": 1536
                }
            ]
        }

        self.database.create_container(
            id=self.container.id,
            partition_key=PartitionKey(path="/category"),
            indexing_policy=indexing_policy,
            vector_embedding_policy=vector_embedding_policy
        )

    async def upsert_document(self, doc_id: str, content: str, embedding: list, metadata: dict):
        """Upsert document with embedding."""
        document = {
            "id": doc_id,
            "content": content,
            "embedding": embedding,
            "category": metadata.get("category", "default"),
            **metadata
        }
        self.container.upsert_item(document)

    async def vector_search(self, query_embedding: list, top_k: int = 10, filters: str = None) -> list:
        """Perform vector similarity search."""
        query = """
        SELECT TOP @top_k
            c.id, c.content, c.category,
            VectorDistance(c.embedding, @queryVector) AS similarity
        FROM c
        WHERE VectorDistance(c.embedding, @queryVector) > 0.7
        """

        if filters:
            query += f" AND {filters}"

        query += " ORDER BY VectorDistance(c.embedding, @queryVector)"

        results = list(self.container.query_items(
            query=query,
            parameters=[
                {"name": "@top_k", "value": top_k},
                {"name": "@queryVector", "value": query_embedding}
            ],
            enable_cross_partition_query=True
        ))

        return results

    async def hybrid_search(self, text_query: str, query_embedding: list, top_k: int = 10) -> list:
        """Combine full-text and vector search."""
        query = """
        SELECT TOP @top_k
            c.id, c.content,
            VectorDistance(c.embedding, @queryVector) AS vectorScore,
            CONTAINS(LOWER(c.content), LOWER(@textQuery)) AS textMatch
        FROM c
        WHERE CONTAINS(LOWER(c.content), LOWER(@textQuery))
           OR VectorDistance(c.embedding, @queryVector) > 0.7
        ORDER BY VectorDistance(c.embedding, @queryVector)
        """

        return list(self.container.query_items(
            query=query,
            parameters=[
                {"name": "@top_k", "value": top_k},
                {"name": "@queryVector", "value": query_embedding},
                {"name": "@textQuery", "value": text_query}
            ],
            enable_cross_partition_query=True
        ))
```

Cosmos DB vector search brings global scale and multi-model capabilities to AI applications.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
