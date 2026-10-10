---
title: "Six Vector Stores for RAG and Where Each One Hurts"
description: "Azure AI Search, DocumentDB, Cosmos DB for NoSQL, pgvector, Pinecone and Redis each fail differently in RAG. Where each one hurts in January 2026."
author: Michael John Peña
draft: false
date: 2026-01-11
tags:
  - AI
  - Vector Database
  - RAG
  - Azure AI Search
  - PostgreSQL
---

I've used five different vector stores across RAG projects: Azure AI Search, the MongoDB-compatible vCore flavour of Cosmos DB, PostgreSQL with pgvector, Pinecone and Redis. They all work on the happy path, and the differences show up at the filtered query that returns too few results, the keyword query vectors can't answer, and the invoice nobody modelled. I've added Cosmos DB for NoSQL as a sixth, for greenfield Cosmos DB work.

For feature-level comparisons, see [Azure AI Search vs Cosmos DB vs PostgreSQL for vectors](/blog/2025-11-20-november-ai-topic/) and [Pinecone vs Weaviate vs Azure AI Search](/blog/2025-12-09-december-ai-topic/); both predate some of the 2025 renames and status changes summarised below.

## What changed in 2025

| Option | Status in January 2026 | What changed recently |
|---|---|---|
| Azure AI Search | GA vector, hybrid and semantic ranker | Agentic retrieval (knowledge bases) is still preview |
| [Azure DocumentDB](https://learn.microsoft.com/en-us/azure/documentdb/overview) | GA (Nov 2025); vector search GA, full-text (and so hybrid) search in preview | New name for Azure Cosmos DB for MongoDB (vCore), announced at Ignite 2025 |
| Azure Cosmos DB for NoSQL | Vector, full-text and hybrid search GA | Full-text and hybrid search went GA at Build 2025 |
| PostgreSQL + pgvector | pgvector 0.8.x; DiskANN GA on Azure Database for PostgreSQL | [`pg_diskann`](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/how-to-use-pgdiskann) went GA in May 2025 |
| Pinecone | Serverless is the default | New Standard/Enterprise sign-ups since 18 August 2025 can't create pod-based indexes |
| Redis | Azure Managed Redis GA (May 2025) | Azure Cache for Redis tiers are scheduled for retirement |

## Azure AI Search: it hurts on the invoice and on control

AI Search is still my default for RAG on Azure, because it has the most retrieval features in one box. You get BM25 and vector queries fused with Reciprocal Rank Fusion in one request, semantic ranking on top, and integrated vectorisation that chunks and embeds documents during indexing. Most RAG quality problems are retrieval problems, and AI Search fixes many out of the box.

Where it hurts:

- **Capacity is billed by the search unit, not by usage** (semantic ranker queries past the free allowance and integrated vectorisation's embedding calls are metered on top). You pay for replicas × partitions around the clock. For a large embedding collection, the vector quota per partition, not query volume, usually sets the bill. Before estimating cost, divide your expected vector index size by the [per-partition vector limit](https://learn.microsoft.com/en-us/azure/search/vector-search-index-size) for your tier; that's how many partitions you'll pay for. The levers are scalar or binary quantisation, `stored: false` on vector fields you never return, and fewer `dimensions` from text-embedding-3 models, all easier to set before the first index build.
- **Less control over the index.** You choose HNSW or exhaustive KNN and tune a few parameters. You don't control storage layout, and you can't join to your operational data.
- **It's a copy.** You own an indexing pipeline and its freshness lag.

Avoid it when the corpus is small and the team already runs PostgreSQL. A dedicated search service is a lot of fixed cost for ten thousand chunks.

## Azure DocumentDB (formerly Cosmos DB for MongoDB vCore): it hurts when you aren't already there

The only good reason I've found to pick this service is that the application data already lives in the MongoDB API. Vectors next to the documents remove a sync pipeline. Since Ignite 2025 the service is Azure DocumentDB, running on the open-source DocumentDB engine; existing clusters were renamed without changes.

It supports HNSW, IVF and DiskANN vector indexes through `cosmosSearch`. Full-text search, and therefore hybrid search, was still in preview in January 2026, and you build hybrid in the aggregation pipeline: a `$search` stage using `cosmosSearch` for vectors, a `$text` query for keywords in a `$unionWith` branch, then RRF scoring in later stages.

Where it hurts:

- **vCore sizing is a cluster decision.** You pick compute and storage tiers up front. IVF runs on any tier; HNSW and DiskANN need M30 or above, per the [DocumentDB vector search docs](https://learn.microsoft.com/en-us/azure/documentdb/vector-search). So production-grade vector search has a real floor cost.
- **Hybrid relevance is your code.** Fusion and weighting are yours to tune.

My rule: choose it because your documents are already there, not for vector search on its own.

### If you're greenfield: Cosmos DB for NoSQL

Starting fresh on Cosmos DB? Look at Azure Cosmos DB for NoSQL instead. It has DiskANN-based vector indexing and BM25 full-text search, hybrid search went GA at Build in May 2025, and you get its global distribution. Its own pain points:

- **Retrieval costs request units.** Vector and full-text queries consume RUs, so heavy retrieval shows up directly in your RU bill.
- **The vector embedding policy is set at creation.** The vector embedding policy defines dimensions, data type and distance function per vector path, and you can't change those for an existing path in place. Moving to an embedding model with different dimensions means a new container and re-embedding every document.

Avoid it when you expect to swap embedding models often, or when retrieval volume would dominate the RU budget.

## PostgreSQL with pgvector: it hurts on filtered queries and on tuning

pgvector is what I'd recommend most to teams with a relational schema. You get SQL joins, row-level security, transactions, and one backup strategy covering both the data and its embeddings. On Azure Database for PostgreSQL flexible server you also get `pg_diskann`, which went GA in May 2025, alongside pgvector's HNSW and IVFFlat.

The classic pain point is filtered search. An HNSW index returns the nearest `hnsw.ef_search` candidates (40 by default) and applies your `WHERE` clause afterwards; IVFFlat is limited the same way by `ivfflat.probes`. A selective tenant filter can leave you three results when you asked for ten. The old workarounds were partial indexes or partitioning. Version 0.8.0 added iterative index scans, which keep scanning until enough rows pass the filter. They only apply when the planner uses an HNSW or IVFFlat index. The examples below use this table:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE document_chunks (
    id bigserial PRIMARY KEY,
    tenant_id text NOT NULL,
    title text,
    embedding vector(1536)
);

CREATE INDEX ON document_chunks USING hnsw (embedding vector_cosine_ops);
```

The query's distance operator must match the operator class (`<=>` for `vector_cosine_ops`), or the planner falls back to a sequential scan and the settings below do nothing.

Here it is as a psql script; set `query_vec` to a real 1,536-value embedding in pgvector's text format (`[0.01,-0.02,…]`) and `tenant` to a tenant ID. psql's `:'name'` syntax quotes each value as a literal. From application code, bind both as driver parameters instead.

```sql
-- Requires pgvector 0.8.0 or later. Run in psql after replacing the two placeholders.
\set query_vec '<query-embedding>'
\set tenant '<tenant-id>'

BEGIN;
SET LOCAL hnsw.iterative_scan = relaxed_order;
SET LOCAL hnsw.ef_search = 100;
SET LOCAL hnsw.max_scan_tuples = 40000; -- default is 20000; raise it if filtered queries still return too few rows

SELECT id, title, embedding <=> :'query_vec'::vector AS distance
FROM document_chunks
WHERE tenant_id = :'tenant'
ORDER BY embedding <=> :'query_vec'::vector
LIMIT 10;
COMMIT;
```

`SET LOCAL` matters with a connection pool: a plain `SET` follows the connection to the next request that borrows it. `relaxed_order` lets results come back slightly out of distance order in exchange for better recall. If ordering matters, use `strict_order` or wrap the query in a `WITH ... AS MATERIALIZED` CTE and re-sort outside it, as the pgvector README shows:

```sql
-- Fragment: use in place of the SELECT above, between the SET LOCAL statements and COMMIT.
WITH r AS MATERIALIZED (
    SELECT id, title, embedding <=> :'query_vec'::vector AS distance
    FROM document_chunks
    WHERE tenant_id = :'tenant'
    ORDER BY distance
    LIMIT 10
)
SELECT * FROM r ORDER BY distance + 0;
```

`MATERIALIZED` stops the CTE being inlined, and `+ 0` stops PostgreSQL 17+ reusing the inner sort.

Other places it hurts:

- **Index builds are memory-hungry.** HNSW builds on millions of rows need `maintenance_work_mem` sized for them, or they crawl.
- **Hybrid search is DIY.** You combine `tsvector` ranking and vector distance yourself, usually with an RRF query.
- **Scaling out is your problem.** One flexible server scales a long way vertically; past that, you need a sharding strategy.

Avoid it when nobody on the team will own PostgreSQL performance. A cheap database is only cheap if you can operate it.

## Pinecone: it hurts on data gravity and pricing shape

Pinecone is the simplest of the six to reason about: one job, a small API, and serverless indexes separate storage from compute, so you don't size pods any more. Pod-based indexes are legacy. Keyword relevance comes from sparse vectors, via the hosted `pinecone-sparse-english-v0` model or your own encoder. Pinecone now recommends separate dense and sparse indexes that you query and fuse yourself; a single `dotproduct` sparse-dense index still works, with less flexibility.

Where it hurts:

- **Data leaves your cloud boundary.** Pinecone's serverless Azure region is East US 2 and there is no Australian region on any cloud, so for many regulated Australian workloads residency ends the conversation early. On networking, private endpoints and BYOC are Enterprise-plan features, and even BYOC keeps the control plane with Pinecone, so the service never sits entirely inside your tenant.
- **Usage-based billing is harder to forecast.** Serverless bills read units, write units and storage. An agent that retrieves five times per turn costs five times as much. Paid plans also carry a monthly minimum.
- **Metadata is a filter, not a database.** You'll still need a system of record for the documents themselves.

Avoid it when governance requires every part of the service, control plane included, to sit inside your Azure tenant, or when the retrieval layer needs joins.

## Redis: it hurts on memory and on platform churn

Redis earns its place when latency matters and the working set is small, such as semantic caching of LLM responses or session-scoped retrieval. On Azure Managed Redis the query engine supports HNSW and FLAT vector indexes (Redis 8.2's SVS-VAMANA index isn't offered there), plus tag, numeric and full-text fields in the same index. Tag and numeric filters run inside the same `FT.SEARCH` query as the vector clause, so Redis doesn't have pgvector's post-filter shortfall.

Where it hurts:

- **Everything is in memory.** Cost scales with vectors × dimensions × replicas, and a 3,072-dimension embedding at float32 is about 12 KB per vector before overhead.
- **Platform choices on Azure are in flux.** Vector search needs the RediSearch module. On Azure Managed Redis, which went GA in May 2025, you have to enable it when you create the cache, and the Flash Optimized tier doesn't support it. Microsoft has also announced [Azure Cache for Redis retirement](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/retirement-faq): Enterprise in March 2027 and Basic, Standard and Premium in September 2028, and new Enterprise caches can't be created after 1 April 2026. Don't start a new vector workload on Azure Cache for Redis.

Avoid it as the primary store for a large corpus; put it in front of one of the others.

## Why I'm not publishing a latency table

Latency numbers depend on dimensions, index parameters, filter selectivity and region, so they rarely transfer. In a typical RAG request, the embedding and LLM calls take far longer than the vector lookup. Measure with your own data and filters.

## How I decide

I ask four questions, in this order:

1. **Where does the source data already live?** If it's in PostgreSQL, DocumentDB or Cosmos DB, try vectors there first. Removing a sync pipeline beats most performance gains.
2. **Do users search with exact terms?** Product codes, policy numbers and people's names need keyword matching. If hybrid retrieval quality decides success, Azure AI Search does the most for you.
3. **What does governance allow?** Residency and private networking rule out options faster than benchmarks.
4. **What can the team operate?** If nobody can size `maintenance_work_mem` or read an RU bill, pick the service that hides that work, even if it costs more.

For a new Azure RAG project in January 2026, I start with Azure AI Search when retrieval quality is the product. I use pgvector when the data is relational and the corpus is moderate, DocumentDB only when the documents already live in the MongoDB API, and Cosmos DB for NoSQL for greenfield Cosmos DB work. Redis is the cache, and Pinecone is for teams that are not bound to Azure and want a vector service with no other jobs.

The vector store should be the boring part of a RAG system. Pick the pain point you can live with, then spend your effort on chunking, hybrid queries and evaluation, which is where [most RAG failures actually come from](/blog/2026-01-07-rag-patterns-production/).
