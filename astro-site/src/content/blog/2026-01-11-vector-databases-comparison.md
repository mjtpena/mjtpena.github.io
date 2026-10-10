---
title: "Five Vector Stores for RAG and Where Each One Hurts"
description: "Azure AI Search, Azure DocumentDB, pgvector, Pinecone and Redis each fail differently in RAG. Here is where each one hurts as of January 2026."
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

I've used five different vector stores across RAG projects: Azure AI Search, the MongoDB-compatible vCore flavour of Cosmos DB, PostgreSQL with pgvector, Pinecone and Redis. Each project picked a different one, and they all work on the happy path. Feature checklists don't separate them any more; the differences show up at the filtered query that returns too few results, the keyword query vectors can't answer, and the invoice nobody modelled.

For a side-by-side of the Azure-native options, see [comparing Azure AI Search, Cosmos DB and PostgreSQL](/blog/2025-11-20-november-ai-topic/). For Pinecone against Weaviate, see [this comparison](/blog/2025-12-09-december-ai-topic/). This one is about failure modes.

## What changed in 2025

Some names and statuses moved in 2025, so older posts (including some of mine) are out of date:

| Option | Status in January 2026 | What changed recently |
|---|---|---|
| Azure AI Search | GA vector, hybrid and semantic ranker | Agentic retrieval (knowledge bases) is still preview |
| Azure DocumentDB | GA (Nov 2025) | New name for Azure Cosmos DB for MongoDB (vCore), announced at Ignite 2025 |
| Azure Cosmos DB for NoSQL (alternative to DocumentDB) | Vector, full-text and hybrid search GA | Full-text and hybrid search went GA at Build 2025 |
| PostgreSQL + pgvector | pgvector 0.8.x; DiskANN GA on Azure Database for PostgreSQL | `pg_diskann` went GA in May 2025 |
| Pinecone | Serverless is the default | Pod-based indexes closed to new customers since August 2025 |
| Redis | Azure Managed Redis GA (May 2025) | Azure Cache for Redis tiers are scheduled for retirement |

If your shortlist still says "Cosmos DB MongoDB vCore" or "Pinecone p1 pods", update it before you take it to an architecture review.

## Azure AI Search: it hurts on the invoice and on control

AI Search is still my default for RAG on Azure, because it has the most retrieval features in one box. You get BM25 and vector queries fused with Reciprocal Rank Fusion, hybrid search in one request, semantic ranking on top, and integrated vectorisation that chunks and embeds documents during indexing. Most RAG quality problems are retrieval problems, and AI Search fixes many without a custom pipeline.

Where it hurts:

- **Capacity is billed by the search unit, not by usage.** You pay for replicas × partitions around the clock. Vector indexes live in memory-bound quotas per partition, so a large embedding collection can force you up a tier long before query volume justifies it. Quantisation and narrower dimensions help, but you have to plan for them.
- **Less control over the index.** You choose HNSW or exhaustive KNN and tune a few parameters. You don't control storage layout, and you can't join to your operational data.
- **It's a copy.** Your source of truth lives somewhere else, so you own an indexing pipeline and its freshness lag.

Avoid it when the corpus is small and the team already runs PostgreSQL. A dedicated search service is a lot of fixed cost for ten thousand chunks.

## Azure DocumentDB (formerly Cosmos DB for MongoDB vCore): it hurts when you aren't already there

The only good reason I've found to pick this service is that the application data already lives in the MongoDB API. Keeping vectors next to the documents removes a sync pipeline, and that's worth a lot. Since Ignite 2025 the service is Azure DocumentDB. It runs on the open-source DocumentDB engine. Existing clusters were renamed without any changes.

It supports HNSW, IVF and DiskANN vector indexes through `cosmosSearch`. Hybrid search is possible, but you build it in the aggregation pipeline: a `$search` stage using `cosmosSearch` for vectors, a `$match` with `$text` for keywords, and RRF scoring computed in later stages, as the [Learn sample](https://learn.microsoft.com/en-us/azure/documentdb/hybrid-search) shows. That works, but it's more query plumbing than AI Search asks of you.

Where it hurts:

- **vCore sizing is a cluster decision.** You pick compute and storage tiers up front. IVF runs on any tier, but DiskANN needs M30 or above and HNSW needs M40 or above (see the [DocumentDB vector search docs](https://learn.microsoft.com/en-us/azure/documentdb/vector-search)). So a vector workload has a real floor cost and doesn't scale smoothly from zero.
- **Hybrid relevance is your code.** Tuning the fusion and the weighting is on you.

My rule: choose it because your documents are already there, not for vector search on its own.

### If you're greenfield: Cosmos DB for NoSQL

If you're starting fresh on Cosmos DB, look at Azure Cosmos DB for NoSQL instead. It has DiskANN-based vector indexing and BM25 full-text search, hybrid search went GA at Build in May 2025, and you also get its global distribution story. It's a separate recommendation from DocumentDB, with its own pain points:

- **Retrieval costs request units.** Vector and full-text queries consume RUs, so heavy retrieval shows up directly in your RU bill.
- **The vector embedding policy is fixed at creation.** You set dimensions and distance function when you create the container. Changing embedding models later means a new container and a data migration.

Avoid it when you expect to swap embedding models often, or when retrieval volume would dominate the RU budget.

## PostgreSQL with pgvector: it hurts on filtered queries and on tuning

pgvector is the option I'd recommend most often to teams with a relational schema. You get SQL joins, row-level security, transactions, and one backup strategy covering both the data and its embeddings. On Azure Database for PostgreSQL flexible server you also get `pg_diskann`, which went GA in May 2025, alongside pgvector's HNSW and IVFFlat.

The classic pain point is filtered search. An approximate index returns the nearest `ef_search` candidates first and applies your `WHERE` clause afterwards. A selective tenant filter can then leave you with three results when you asked for ten. Before pgvector 0.8.0 the usual workarounds were partial indexes or partitioning. Version 0.8.0 added iterative index scans, which keep scanning until enough rows pass the filter. They only apply when the planner uses an HNSW (or IVFFlat) index, so the index has to exist first:

```sql
CREATE INDEX ON document_chunks USING hnsw (embedding vector_cosine_ops);
```

The distance operator in the query must match the index's operator class: `<=>` for `vector_cosine_ops`. If they don't match, the planner ignores the index, the query runs as a sequential scan, and the settings below do nothing.

```sql
-- Requires pgvector 0.8.0 or later.
-- Run each statement separately on the same connection (or use your driver's
-- transaction API); $1 (query embedding) and $2 (tenant) are driver-bound parameters.
BEGIN;
SET LOCAL hnsw.iterative_scan = relaxed_order;
SET LOCAL hnsw.ef_search = 100;
SET LOCAL hnsw.max_scan_tuples = 40000; -- default is 20000; raise it if filtered queries still return too few rows

SELECT id, title, embedding <=> $1::vector AS distance
FROM document_chunks
WHERE tenant_id = $2
ORDER BY embedding <=> $1::vector
LIMIT 10;
COMMIT;
```

`SET LOCAL` keeps the settings inside the transaction, which matters with a connection pool: a plain `SET` follows the connection to whichever request borrows it next. `relaxed_order` lets results come back slightly out of distance order in exchange for better recall. If ordering matters, use `strict_order`, or wrap the query in a `WITH ... AS MATERIALIZED` CTE and re-sort outside it, as the [pgvector README](https://github.com/pgvector/pgvector#iterative-index-scans) shows:

```sql
-- Run inside the same transaction, after the SET LOCAL statements above.
WITH r AS MATERIALIZED (
    SELECT id, title, embedding <=> $1::vector AS distance
    FROM document_chunks
    WHERE tenant_id = $2
    ORDER BY distance
    LIMIT 10
)
SELECT * FROM r ORDER BY distance + 0;
```

The `MATERIALIZED` keyword stops the planner from inlining the CTE, and `+ 0` stops PostgreSQL 17 and later from reusing the inner sort.

Other places it hurts:

- **Index builds are memory-hungry.** HNSW builds on millions of rows need `maintenance_work_mem` sized for them, or they crawl.
- **Hybrid search is DIY.** You combine `tsvector` ranking and vector distance yourself, usually with an RRF query. It's another thing to maintain.
- **Scaling out is your problem.** One flexible server scales a long way vertically. Past that, you need a sharding strategy.

Avoid it when nobody on the team is comfortable owning PostgreSQL performance. A cheap database is only cheap if you can operate it.

## Pinecone: it hurts on data gravity and pricing shape

Pinecone is the simplest of the five to reason about. It does one job, the API is small, and serverless indexes separate storage from compute, so you don't size pods any more. As of August 2025, [new customers can't create pod-based indexes](https://docs.pinecone.io/guides/indexes/pods/understanding-pod-based-indexes) at all. Advice about "p1 pods" is legacy now. Pinecone handles keyword-style relevance with sparse vectors, either from its hosted `pinecone-sparse-english-v0` model or from your own encoder, so hybrid search no longer means running a separate BM25 engine. Pinecone now recommends separate dense and sparse indexes that you query and fuse yourself; a single sparse-dense index with the `dotproduct` metric is still supported, with less flexibility.

Where it hurts:

- **Data leaves your cloud boundary.** Pinecone's serverless Azure region is East US 2 and there is no Australian region on any cloud, so for a lot of regulated workloads in Australia residency ends the conversation before performance comes up. Pinecone offers private networking on Enterprise plans. BYOC puts the data plane in your own cloud account but keeps the control plane with Pinecone, so check which clouds it supports and whether that split satisfies your residency rules.
- **Usage-based billing is harder to forecast.** Serverless bills read units, write units and storage. An agent that retrieves five times per turn costs five times as much. Paid plans also carry a monthly minimum.
- **Metadata is a filter, not a database.** You'll still need a system of record for the documents themselves.

Avoid it when governance requires every part of the service, control plane included, to sit inside your Azure tenant, or when the retrieval layer needs joins.

## Redis: it hurts on memory and on platform churn

Redis earns its place when latency matters and the working set is small: semantic caching of LLM responses, session-scoped retrieval, recommendation lookups. On Azure Managed Redis the query engine supports HNSW and FLAT vector indexes (Redis 8.2 adds SVS-VAMANA, but Azure Managed Redis isn't on 8.x yet), plus tag, numeric and full-text fields in the same index. Filtering is better than its reputation suggests.

Where it hurts:

- **Everything is in memory.** Cost scales with vectors × dimensions × replicas, and a 3,072-dimension embedding at float32 is about 12 KB per vector before overhead.
- **Platform choices on Azure are in flux.** Vector search needs the RediSearch module. On Azure Managed Redis, which went GA in May 2025, you have to enable it when you create the cache, and the Flash Optimized tier doesn't support it. Microsoft has also announced [retirement of the Azure Cache for Redis tiers](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/retirement-faq): Enterprise in March 2027 and Basic, Standard and Premium in September 2028, and new Enterprise caches can't be created after 1 April 2026. Don't start a new vector workload on Azure Cache for Redis.

Avoid it as the primary store for a large document corpus. Use it as a cache in front of one of the others.

## Why I'm not publishing a latency table

Latency and cost numbers rarely transfer. They depend on dimensions, index parameters, filter selectivity and region. In a typical RAG request, the embedding and LLM calls take far longer than the vector lookup. Measure with your own data and filters before you let a benchmark choose for you.

## How I decide

I ask four questions, in this order:

1. **Where does the source data already live?** If it's in PostgreSQL, DocumentDB or Cosmos DB, try vectors there first. Removing a sync pipeline beats almost any performance gain.
2. **Do users search with exact terms?** Product codes, policy numbers and people's names need keyword matching. If hybrid retrieval quality decides success, Azure AI Search does the most for you.
3. **What does governance allow?** Data residency and private networking rule out options faster than benchmarks do.
4. **What can the team operate?** A managed service you understand beats a cheaper one nobody can tune at 2am.

For a new Azure RAG project in January 2026, I start with Azure AI Search when retrieval quality is the product. I use pgvector on Azure Database for PostgreSQL when the data is relational and the corpus is moderate, DocumentDB only when the documents already live in the MongoDB API, and Cosmos DB for NoSQL for greenfield Cosmos DB work. Redis is the cache, and Pinecone is for teams that are not bound to Azure and want a vector service with no other jobs.

The vector store should be the boring part of a RAG system. Pick the one whose pain point you can live with. Then spend your effort on chunking, hybrid queries and evaluation, which is where [most RAG failures actually come from](/blog/2026-01-07-rag-patterns-production/).
