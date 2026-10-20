---
title: "Where Should Your Vectors Live on Azure? Search Index vs Database"
description: "Azure AI Search, Cosmos DB for NoSQL and PostgreSQL with pgvector can all hold embeddings now. Here is how I decide between a search index and your database."
author: Michael John Peña
draft: false
date: 2025-01-26
tags:
  - Vector Database
  - Azure AI Search
  - Cosmos DB
  - PostgreSQL
  - RAG
  - Architecture
---

Two years ago, picking a vector store on Azure was easy because there was barely a choice. As of January 2025, Azure AI Search, Azure Cosmos DB for NoSQL, Azure Database for PostgreSQL flexible server and (in preview) Azure SQL Database can all store embeddings and run similarity queries. Azure Cosmos DB for MongoDB vCore has [vector search too](https://learn.microsoft.com/azure/cosmos-db/mongodb/vcore/vector-search) (IVF and HNSW generally available, DiskANN in preview), which is the natural fit if your app already speaks the MongoDB API; I'll leave it out of the detailed comparison because the trade-offs mirror Cosmos DB for NoSQL. The real question is no longer "which vector database?" but "should the vectors sit in a search index or next to the operational data they describe?" Get that wrong and you either pay to keep two systems in sync for no reason, or you rebuild relevance features your database was never designed to provide.

If you want the broader background on vector stores and the third-party options (Pinecone, Qdrant, Weaviate and friends), I covered that in [Vector Store Integrations](/blog/2023-08-31-vector-store-integrations/). This post stays on first-party Azure services and the state they're in right now.

## The landscape at the end of January 2025

| | Azure AI Search | Cosmos DB for NoSQL | PostgreSQL flexible server + pgvector |
|---|---|---|---|
| Vector status | GA (stable API `2024-07-01`) | GA since November 2024 | `vector` extension supported (pgvector 0.7.0) |
| Index algorithms | HNSW, exhaustive KNN | flat, quantizedFlat, DiskANN | HNSW, IVFFlat; DiskANN (`pg_diskann`) in preview |
| Keyword + vector in one query | Yes, with RRF fusion, GA | Full-text and hybrid (RRF) in public preview | Do it yourself with `tsvector` and SQL |
| Re-ranking | Semantic ranker, GA | None built in | None built in |
| Pay for | Search units (partitions × replicas) | Request units and storage | vCores and storage |
| Where it shines | Content retrieval, RAG over documents | Vectors on operational records | Teams already on Postgres |

Azure SQL Database deserves a footnote: the native `VECTOR` data type and `VECTOR_DISTANCE` function reached public preview in November 2024, but there is no approximate vector index yet, so every query is an exact scan. Fine for experimenting or small tables, not something I'd put a production RAG workload on this month.

## Azure AI Search: a retrieval engine, not just a vector store

AI Search is the only option here that was built for relevance first. With the `2024-07-01` stable API, [vector search, integrated vectorization and vector compression are all generally available](https://learn.microsoft.com/azure/search/search-api-migration): the indexer can chunk documents with the Text Split skill, call Azure OpenAI for embeddings, and vectorise queries at search time, so you don't have to run your own embedding pipeline. Scalar and binary quantisation, plus narrow types such as `Collection(Edm.Half)`, cut the vector index footprint substantially. I've written about [quantisation trade-offs](/blog/2024-07-27-binary-vectors-quantization/) and [filtered vector search](/blog/2024-07-31-filtered-vector-search/) separately.

The deciding feature is still hybrid search plus the semantic ranker. Keyword search catches product codes, acronyms and exact names that embeddings smear together; vector search catches paraphrase; RRF merges them; the semantic ranker re-scores the top results. For document RAG, that stack is hard to beat without writing a lot of code.

Here is a hybrid query with the current Python SDK (`azure-search-documents` 11.5.2). It assumes an index with a `content_vector` field, a filterable `category` field and a semantic configuration already exist. The client is created once and reused, so each query doesn't pay for a new token and connection.

```python
from azure.identity import DefaultAzureCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery

search_client = SearchClient(
    endpoint="https://<your-search-service>.search.windows.net",
    index_name="<your-index-name>",
    credential=DefaultAzureCredential(),
)


def hybrid_search(query_text: str, query_vector: list[float], category: str) -> list[dict]:
    # OData string literals escape a single quote by doubling it.
    safe_category = category.replace("'", "''")

    vector_query = VectorizedQuery(
        vector=query_vector,
        k_nearest_neighbors=50,
        fields="content_vector",
    )

    results = search_client.search(
        search_text=query_text,
        vector_queries=[vector_query],
        filter=f"category eq '{safe_category}'",
        query_type="semantic",
        semantic_configuration_name="<your-semantic-config>",
        select=["id", "title", "content"],
        top=10,
    )

    return [
        {
            "id": r["id"],
            "title": r["title"],
            "score": r["@search.score"],
            "reranker_score": r.get("@search.reranker_score"),
        }
        for r in results
    ]
```

Note `k_nearest_neighbors=50` with `top=10`: giving the fusion and ranker a wider candidate pool usually helps relevance more than any HNSW tuning.

The catch is cost shape. You pay for search units around the clock, whether you run ten queries or ten million, and the semantic ranker is billed on top beyond its free allowance. Capacity also depends on when the service was created: services created after April 2024 get much larger partitions and vector quotas than older ones at the same price, so an old service hitting vector limits is often a reason to [check the service limits](https://learn.microsoft.com/azure/search/search-limits-quotas-capacity) and recreate rather than scale out.

And you are now running a second copy of your data. Something has to keep the index in step with the source of truth, whether that's an indexer on a schedule or your own push pipeline.

## Cosmos DB for NoSQL: vectors on the records themselves

Cosmos DB's [vector search for the NoSQL API](https://learn.microsoft.com/azure/cosmos-db/nosql/vector-search) went GA in November 2024, along with the DiskANN index, which came out of Microsoft Research. Full-text search and hybrid search with RRF were announced in public preview at the same time, so don't build your production design on them yet.

The appeal is architectural: the embedding lives on the same JSON document as the order, the support ticket or the user profile. One write updates both, partitioning and global distribution are built in, and there's no indexer to babysit. For agent memory, chat history, product catalogues and personalisation, that's a much simpler system than a database plus a search index.

There are some sharp edges to know before you commit:

- You must enable the **Vector Search for NoSQL API** feature on the account first.
- The vector embedding policy and vector indexes are defined when the container is created. You can't bolt them onto an existing container, so plan a migration if your data is already there.
- `flat` is exact but limited to 505 dimensions, which rules it out for `text-embedding-ada-002` or `text-embedding-3-small` at 1,536. Use `quantizedFlat` or `diskANN` (up to 4,096 dimensions). Both need at least 1,000 vectors before the index is used; below that you get a full scan.
- Always use `TOP N` with `ORDER BY VectorDistance(...)`. Without it, the query tries to score everything and the RU bill follows.

Creating the database and container is a management operation, and Entra ID data-plane roles don't cover it: with `DefaultAzureCredential` the create calls fail with a 403 even when you hold Built-in Data Contributor. In production that belongs in Bicep or the Azure CLI. For a quick start, here is a one-off setup script with `azure-cosmos` 4.9.0 that uses the account key, read from an environment variable:

```python
import os

from azure.cosmos import CosmosClient, PartitionKey

# One-off setup: key auth, because Entra data-plane roles can't create databases or containers.
admin_client = CosmosClient(
    url="https://<your-account>.documents.azure.com:443/",
    credential=os.environ["COSMOS_KEY"],
)
database = admin_client.create_database_if_not_exists("<your-database>")

vector_embedding_policy = {
    "vectorEmbeddings": [
        {
            "path": "/embedding",
            "dataType": "float32",
            "dimensions": 1536,
            "distanceFunction": "cosine",
        }
    ]
}

indexing_policy = {
    "indexingMode": "consistent",
    "includedPaths": [{"path": "/*"}],
    "excludedPaths": [{"path": "/embedding/*"}],
    "vectorIndexes": [{"path": "/embedding", "type": "diskANN"}],
}

database.create_container_if_not_exists(
    id="documents",
    partition_key=PartitionKey(path="/tenantId"),
    indexing_policy=indexing_policy,
    vector_embedding_policy=vector_embedding_policy,
)
```

The application itself then authenticates with Entra ID and only reads and writes items, getting the container by name rather than creating it:

```python
from azure.cosmos import CosmosClient
from azure.identity import DefaultAzureCredential

client = CosmosClient(
    url="https://<your-account>.documents.azure.com:443/",
    credential=DefaultAzureCredential(),
)
container = client.get_database_client("<your-database>").get_container_client("documents")


def vector_search(query_vector: list[float], tenant_id: str, top: int = 10) -> list[dict]:
    query = (
        f"SELECT TOP {int(top)} c.id, c.title, "
        "VectorDistance(c.embedding, @queryVector) AS similarity "
        "FROM c WHERE c.tenantId = @tenantId "
        "ORDER BY VectorDistance(c.embedding, @queryVector)"
    )
    return list(
        container.query_items(
            query=query,
            parameters=[
                {"name": "@queryVector", "value": query_vector},
                {"name": "@tenantId", "value": tenant_id},
            ],
            partition_key=tenant_id,
        )
    )
```

Excluding `/embedding/*` from the regular index matters: indexing 1,536 floats as ordinary paths wastes RUs on every write. Scoping the query to one partition key keeps it cheap; a cross-partition vector query fans out to every physical partition. Also remember that `DefaultAzureCredential` needs a Cosmos DB data-plane role assignment, which is separate from Azure RBAC on the account. Entra data-plane roles cover reads and writes of items, not creating databases or containers, which is why the setup script above uses the key. Once the container exists, consider disabling key auth on the account altogether.

What Cosmos DB doesn't give you yet is relevance tooling. There's no semantic re-ranker, and hybrid search is preview. If retrieval quality on messy documents is the hard part of your problem, this is the wrong layer to solve it in.

## PostgreSQL with pgvector: the boring, capable choice

If your application already runs on Postgres, [pgvector on Azure Database for PostgreSQL flexible server](https://learn.microsoft.com/azure/postgresql/flexible-server/how-to-use-pgvector) is the lowest-friction path. Allow-list `vector` in the `azure.extensions` server parameter, run `CREATE EXTENSION`, and you have HNSW indexes, `halfvec` for half-precision storage, and the full SQL toolbox for joins, row-level security and transactions. Microsoft's `pg_diskann` extension is in preview for larger datasets; I'd wait for it to settle before relying on it.

Two things to watch. First, Single Server is being retired in March 2025, so make sure you're on flexible server; the old `user@servername` login format is a Single Server habit that doesn't apply here. Second, hybrid search is your job: combine a `tsvector` query with a vector query and fuse the ranks yourself. Doable, but it's code you now own.

A minimal version with `psycopg` 3.2 and the `pgvector` Python package:

```python
import os

import numpy as np
import psycopg
from pgvector.psycopg import register_vector

conn = psycopg.connect(
    host="<your-server>.postgres.database.azure.com",
    dbname="<your-database>",
    user="<your-admin-user>",
    password=os.environ["PGPASSWORD"],
    sslmode="require",
    autocommit=True,
)
conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
register_vector(conn)

conn.execute("""
    CREATE TABLE IF NOT EXISTS documents (
        id bigserial PRIMARY KEY,
        tenant_id text NOT NULL,
        title text NOT NULL,
        content text NOT NULL,
        embedding vector(1536) NOT NULL
    )
""")
conn.execute("""
    CREATE INDEX IF NOT EXISTS documents_embedding_hnsw
    ON documents USING hnsw (embedding vector_cosine_ops)
""")


def search_similar(query_vector: list[float], tenant_id: str, limit: int = 10) -> list[tuple]:
    vec = np.array(query_vector, dtype=np.float32)
    return conn.execute(
        """
        SELECT id, title, 1 - (embedding <=> %s) AS similarity
        FROM documents
        WHERE tenant_id = %s
        ORDER BY embedding <=> %s
        LIMIT %s
        """,
        (vec, tenant_id, vec, limit),
    ).fetchall()
```

The filter plus approximate index combination is the classic pgvector trap: HNSW returns its top candidates first, then the `WHERE` clause throws some away, so a selective tenant filter can return fewer rows than you asked for. Raise `hnsw.ef_search`, partition by tenant, or use a partial index when the filter is very selective.

## How I decide

My rule of thumb: **put vectors where the query is answered.**

- If the question is "find the passages that best answer this", across PDFs, wikis and policies, use **Azure AI Search**. Hybrid retrieval and the semantic ranker are worth the second copy of the data.
- If the question is "find records like this one, for this user, and update them", use **Cosmos DB for NoSQL** when the data already lives there, or **PostgreSQL** when it lives there. Don't introduce a new database just for vectors.
- If you are tempted to use both, have a clear reason. The common good one is operational data in Cosmos DB or Postgres with a curated subset pushed to AI Search for RAG. The common bad one is "we weren't sure, so we did both".

When **not** to reach for each:

- **AI Search:** a few thousand vectors, a tight budget and no keyword relevance needs. A fixed monthly bill for a search service is hard to justify there.
- **Cosmos DB:** you need production-grade hybrid ranking today, or your data is already in containers created without a vector policy and you can't migrate.
- **PostgreSQL:** you have no Postgres skills in the team and would be adopting it purely for pgvector, or you expect hundreds of millions of vectors before `pg_diskann` is out of preview.
- **Azure SQL:** anything production until it gets an approximate index.

The vector capability has become a commodity across Azure's data services. The differentiators are now everything around it: keyword relevance, re-ranking, sync cost, and which team already knows how to operate the thing. Choose on those, not on a benchmark of nearest-neighbour latency.
