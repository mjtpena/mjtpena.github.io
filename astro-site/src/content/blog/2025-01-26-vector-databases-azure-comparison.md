---
title: "Vector Databases on Azure: Comparing Options for AI Applications"
author: Michael John Peña
draft: false
date: 2025-01-26
tags:
  - Vector Database
  - Azure
  - AI
  - RAG
  - Architecture

---

I wrote "Vector Databases on Azure: Comparing Options for AI Applications" to share practical, production-minded guidance on this topic.

## Vector Database Options on Azure

```
Azure AI Search
├── Full-text + Vector hybrid search
├── Semantic ranking
├── Built-in Azure integration
└── Managed service

Azure Cosmos DB (NoSQL + Vector)
├── Global distribution
├── Multi-model database
├── Integrated vector search
└── Transactional + analytical

PostgreSQL + pgvector
├── Familiar SQL interface
├── Flexible schema
├── Open source
└── Azure Database for PostgreSQL

Third-party (on Azure)
├── Pinecone
├── Weaviate
├── Qdrant
└── Milvus
```

## Azure AI Search

Best for: Enterprise search, RAG applications with complex filtering

```python
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SearchField,
    SearchFieldDataType,
    VectorSearch,
    HnswAlgorithmConfiguration,
    VectorSearchProfile
)
from azure.identity import DefaultAzureCredential

# Create index with vector search
index_client = SearchIndexClient(
    endpoint="https://my-search.search.windows.net",
    credential=DefaultAzureCredential()
)

index = SearchIndex(
    name="documents",
    fields=[
        SearchField(name="id", type=SearchFieldDataType.String, key=True),
        SearchField(name="title", type=SearchFieldDataType.String, searchable=True),
        SearchField(name="content", type=SearchFieldDataType.String, searchable=True),
        SearchField(name="category", type=SearchFieldDataType.String, filterable=True, facetable=True),
        SearchField(
            name="content_vector",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            searchable=True,
            vector_search_dimensions=1536,
            vector_search_profile_name="my-vector-config"
        )
    ],
    vector_search=VectorSearch(
        algorithms=[HnswAlgorithmConfiguration(name="my-hnsw")],
        profiles=[VectorSearchProfile(name="my-vector-config", algorithm_configuration_name="my-hnsw")]
    )
)

index_client.create_or_update_index(index)

# Search with hybrid query
search_client = SearchClient(
    endpoint="https://my-search.search.windows.net",
    index_name="documents",
    credential=DefaultAzureCredential()
)

query_vector = embedding_model.embed("search query")

results = search_client.search(
    search_text="search query",  # Full-text search
    vector_queries=[{
        "vector": query_vector,
        "k_nearest_neighbors": 10,
        "fields": "content_vector"
    }],
    filter="category eq 'technical'",
    query_type="semantic",
    semantic_configuration_name="my-semantic-config",
    top=10
)
```

**Pros:**
- Hybrid search (vector + keyword + semantic)
- Built-in semantic ranker
- Great Azure integration
- Enterprise security features

**Cons:**
- Can be expensive at scale
- Limited vector search customization
- Complex pricing model

## Azure Cosmos DB

Best for: Global applications, multi-model data, transactional + vector workloads

```python
from azure.cosmos import CosmosClient
from azure.identity import DefaultAzureCredential

# Connect to Cosmos DB with vector search enabled
client = CosmosClient(
    url="https://my-cosmos.documents.azure.com:443/",
    credential=DefaultAzureCredential()
)

database = client.get_database_client("vectordb")
container = database.get_container_client("documents")

# Container must be created with vector indexing policy
# Example container creation with vector index:
# container_properties = {
#     "id": "documents",
#     "partitionKey": {"paths": ["/category"]},
#     "vectorEmbeddingPolicy": {
#         "vectorEmbeddings": [{
#             "path": "/embedding",
#             "dataType": "float32",
#             "dimensions": 1536,
#             "distanceFunction": "cosine"
#         }]
#     },
#     "indexingPolicy": {
#         "vectorIndexes": [{
#             "path": "/embedding",
#             "type": "quantizedFlat"
#         }]
#     }
# }

# Insert document with vector
doc = {
    "id": "doc1",
    "title": "Sample Document",
    "content": "This is the content...",
    "category": "technical",
    "embedding": embedding_model.embed("This is the content...")
}
container.upsert_item(doc)

# Vector search query
query_vector = embedding_model.embed("search query")

query = """
SELECT TOP 10 c.id, c.title, c.content,
       VectorDistance(c.embedding, @queryVector) AS score
FROM c
WHERE c.category = @category
ORDER BY VectorDistance(c.embedding, @queryVector)
"""

results = container.query_items(
    query=query,
    parameters=[
        {"name": "@queryVector", "value": query_vector},
        {"name": "@category", "value": "technical"}
    ]
)
```

**Pros:**
- Global distribution
- Transactional guarantees
- Multi-model (document, graph, vector)
- Integrated with existing Cosmos workloads

**Cons:**
- Vector search is newer feature
- Limited vector search algorithms
- RU-based pricing can be complex

## PostgreSQL with pgvector

Best for: Teams familiar with SQL, flexible schemas, cost-effective

```python
import psycopg2
from pgvector.psycopg2 import register_vector

# Connect to Azure Database for PostgreSQL
conn = psycopg2.connect(
    host="my-postgres.postgres.database.azure.com",
    database="vectordb",
    user="admin@my-postgres",
    password=os.environ["PG_PASSWORD"],
    sslmode="require"
)

register_vector(conn)

# Create table with vector column
with conn.cursor() as cur:
    cur.execute("""
        CREATE EXTENSION IF NOT EXISTS vector;

        CREATE TABLE IF NOT EXISTS documents (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            category TEXT,
            embedding vector(1536),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS documents_embedding_idx
        ON documents USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);
    """)
    conn.commit()

# Insert with vector
def insert_document(title, content, category, embedding):
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO documents (title, content, category, embedding)
            VALUES (%s, %s, %s, %s)
            RETURNING id
        """, (title, content, category, embedding))
        conn.commit()
        return cur.fetchone()[0]

# Vector search
def search_similar(query_vector, category=None, limit=10):
    with conn.cursor() as cur:
        if category:
            cur.execute("""
                SELECT id, title, content, 1 - (embedding <=> %s) AS similarity
                FROM documents
                WHERE category = %s
                ORDER BY embedding <=> %s
                LIMIT %s
            """, (query_vector, category, query_vector, limit))
        else:
            cur.execute("""
                SELECT id, title, content, 1 - (embedding <=> %s) AS similarity
                FROM documents
                ORDER BY embedding <=> %s
                LIMIT %s
            """, (query_vector, query_vector, limit))

        return cur.fetchall()
```

**Pros:**
- Familiar SQL interface
- Cost-effective
- Flexible indexing options
- Full PostgreSQL capabilities

**Cons:**
- Manual scaling required
- Less sophisticated than dedicated vector DBs
- No built-in hybrid search

## Comparison Matrix

| Feature | AI Search | Cosmos DB | PostgreSQL |
|---------|-----------|-----------|------------|
| Hybrid Search | Excellent | Basic | Manual |
| Scalability | Auto | Global | Manual |
| Cost | High | Variable | Low |
| Learning Curve | Medium | Medium | Low |
| Vector Algorithms | HNSW | DiskANN | IVFFlat, HNSW |
| Filtering | Excellent | Good | Good |
| Azure Integration | Excellent | Excellent | Good |

## Choosing the Right Option

```python
def recommend_vector_db(requirements: dict) -> str:
    """Recommend vector database based on requirements."""

    # High-priority requirements
    if requirements.get("global_distribution"):
        return "cosmos_db"

    if requirements.get("advanced_text_search"):
        return "ai_search"

    if requirements.get("cost_sensitive") and requirements.get("sql_preferred"):
        return "postgresql"

    # Workload patterns
    if requirements.get("read_heavy") and requirements.get("complex_filters"):
        return "ai_search"

    if requirements.get("mixed_workload"):  # Vector + transactional
        return "cosmos_db"

    if requirements.get("existing_postgres"):
        return "postgresql"

    # Default recommendation
    return "ai_search"

# Example
requirements = {
    "global_distribution": False,
    "advanced_text_search": True,
    "cost_sensitive": False,
    "complex_filters": True
}

print(recommend_vector_db(requirements))  # ai_search
```

## Hybrid Architecture

For complex scenarios, combine multiple options:

```python
class HybridVectorStore:
    """Combine AI Search for search with Cosmos for storage."""

    def __init__(self, search_client, cosmos_container):
        self.search = search_client
        self.cosmos = cosmos_container

    def index(self, doc_id: str, content: str, embedding: list, metadata: dict):
        """Store in both systems."""
        # Full document in Cosmos
        self.cosmos.upsert_item({
            "id": doc_id,
            "content": content,
            "embedding": embedding,
            **metadata
        })

        # Searchable index in AI Search
        self.search.upload_documents([{
            "id": doc_id,
            "content": content,
            "content_vector": embedding,
            **{k: v for k, v in metadata.items() if self._is_searchable(k)}
        }])

    def search(self, query: str, query_vector: list, **kwargs) -> list:
        """Search via AI Search, enrich from Cosmos."""
        # Get IDs from search
        results = self.search.search(
            search_text=query,
            vector_queries=[{"vector": query_vector, "k_nearest_neighbors": 10, "fields": "content_vector"}],
            select=["id"],
            **kwargs
        )

        # Enrich with full documents from Cosmos
        enriched = []
        for result in results:
            doc = self.cosmos.read_item(result["id"], partition_key=result["id"])
            enriched.append({**doc, "score": result["@search.score"]})

        return enriched
```

Choose based on your specific requirements, team expertise, and existing infrastructure. There's no one-size-fits-all solution for vector databases.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
