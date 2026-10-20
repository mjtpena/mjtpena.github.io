---
title: "Do You Need a Vector Database Yet? ANN Indexes and Trade-offs"
description: "What a vector database adds over brute force: ANN indexes, recall, filtering and updates, and how Pinecone, Weaviate, Milvus, Qdrant and pgvector compare."
author: Michael John Peña
draft: false
date: 2023-01-25
tags:
  - Vector Database
  - Embeddings
  - Vector Search
  - Architecture
  - Azure
---

Once you have embeddings working, the next question is where to keep them, and the market has a confident answer: buy a vector database. Sometimes that's right. Often it's a new piece of infrastructure bought to solve a problem you don't have yet. A vector database is an approximate nearest neighbour (ANN) index wrapped in the things a database normally gives you, and you should know which of those parts you need before you pick one.

## What brute force gets you, and where it stops

In the [NumPy prototype from yesterday's post](/blog/2023-01-24-semantic-search-embeddings/), search is one matrix multiplication: compare the query vector with every stored vector and keep the top results. That is exact nearest neighbour search. It's never wrong, and it's surprisingly fast. A hundred thousand 1,536-dimension float32 vectors take about 600 MB of memory, and a dot product across all of them takes tens of milliseconds per query on a laptop, because it has to read every byte of that memory.

The cost grows linearly with the number of vectors, and so does the memory. At ten million vectors you're holding roughly 60 GB in RAM and scanning all of it on every query. That's the point where exact search stops being practical and you start trading a little accuracy for a lot of speed.

That trade is the core idea. An ANN index doesn't promise the true top 10. It promises most of them, most of the time, much faster. The fraction of true neighbours it returns is **recall**, and every setting you tune on a vector index moves you along the line between recall, latency and memory.

## The three index families worth knowing

You don't need to implement any of these, but you do need to know what each one costs, because every product below is built on one or more of them.

| Family | How it works | Strengths | Costs |
|---|---|---|---|
| HNSW (graph) | Builds a layered proximity graph and walks it greedily from the top layer down | Excellent recall at low latency; handles inserts incrementally | Memory hungry: full vectors plus graph links; deletes are awkward |
| IVF (clustering) | Clusters vectors with k-means, then searches only the clusters nearest the query | Smaller and simpler; fast to build | Needs representative data to train the clusters; recall depends on how many clusters you probe |
| Product quantisation (compression) | Splits each vector into sub-vectors and stores a short code for each | Cuts memory by an order of magnitude or more | Distances are approximate, so recall drops; usually combined with IVF |

HNSW comes from a 2016 paper by Malkov and Yashunin, and it's the default in most of the dedicated vector databases. IVF and product quantisation are the workhorses of Meta's [FAISS](https://github.com/facebookresearch/faiss) library, which many of those databases either wrap or borrow ideas from.

My rule of thumb: start with HNSW if the vectors fit in memory, and consider IVF with product quantisation only when memory cost is the problem you're actually solving.

## Measuring recall before you trust an index

The mistake I see most often is tuning an ANN index for latency without ever measuring what it gives up. FAISS makes that comparison cheap, because you can build an exact index and an HNSW index over the same data and check how much they agree. This script runs as-is after `pip install faiss-cpu numpy`:

```python
import time

import faiss
import numpy as np

DIM = 1536
N_VECTORS = 100_000
N_QUERIES = 200
TOP_K = 10

rng = np.random.default_rng(42)
vectors = rng.standard_normal((N_VECTORS, DIM)).astype("float32")
queries = rng.standard_normal((N_QUERIES, DIM)).astype("float32")

# Normalise so that L2 distance ranks results the same way as cosine similarity.
faiss.normalize_L2(vectors)
faiss.normalize_L2(queries)

# Exact search: the ground truth.
exact = faiss.IndexFlatL2(DIM)
start = time.perf_counter()
exact.add(vectors)
print(f"flat build: {time.perf_counter() - start:.1f} s")
start = time.perf_counter()
_, true_ids = exact.search(queries, TOP_K)
exact_ms = (time.perf_counter() - start) * 1000 / N_QUERIES

# Approximate search with HNSW. M is the number of graph links per node.
hnsw = faiss.IndexHNSWFlat(DIM, 32)
hnsw.hnsw.efConstruction = 200
start = time.perf_counter()
hnsw.add(vectors)
print(f"hnsw build: {time.perf_counter() - start:.1f} s")

for ef_search in (16, 64, 256):
    hnsw.hnsw.efSearch = ef_search
    start = time.perf_counter()
    _, approx_ids = hnsw.search(queries, TOP_K)
    approx_ms = (time.perf_counter() - start) * 1000 / N_QUERIES

    hits = sum(
        len(set(true_row) & set(approx_row))
        for true_row, approx_row in zip(true_ids, approx_ids)
    )
    recall = hits / (N_QUERIES * TOP_K)
    print(
        f"efSearch={ef_search:>3}  recall@{TOP_K}={recall:.3f}  "
        f"hnsw={approx_ms:.2f} ms/query  exact={exact_ms:.2f} ms/query"
    )
```

Random vectors are a worst case for ANN indexes, because real embeddings cluster and graphs navigate clusters well. Run it on your own embeddings to get honest numbers. What you'll see is the shape of the trade-off: `efSearch` (how many candidates the search keeps while walking the graph) buys recall with latency, and the two build times the script prints show the graph taking far longer to build than the flat index. That build time matters when you re-embed a corpus after a model change.

Two things follow from the normalisation step. OpenAI's `text-embedding-ada-002` returns vectors normalised to length 1, so cosine similarity, dot product and Euclidean distance all give the same ranking. Pick the metric your store computes fastest and don't agonise over it. If you mix models or your vectors aren't normalised, the choice matters again, and it has to match how the model was trained.

## What the "database" part adds

FAISS is a library. It has no network API, no persistence beyond saving a file, no access control and no metadata. Those are exactly the parts that hurt in production, and they're what you're paying for with a vector database:

- **Metadata filtering.** Almost every real query is "similar to this, *and* in this tenant, *and* published after this date". Filtering after the ANN search can return fewer results than you asked for, or none. Filtering during the search is a hard problem, and it's where products differ most.
- **Updates and deletes.** Content changes. Graph indexes don't like deletes, so most engines mark records as deleted and clean up later. Ask how each one handles a steady stream of changes, not just a bulk load.
- **Persistence, replication and backup.** An in-memory index that has to be rebuilt after every restart is a liability.
- **Hybrid keyword and vector search.** Embeddings are poor at exact identifiers, product codes and error numbers. If your users search for those, you need keyword scoring next to vector similarity.

If you need none of these, a library is enough. If you need all four, you want a database.

## The landscape this month

Here's how I see the main options as of January 2023. Features in this space change monthly, so check the release notes before you commit.

| Option | Model | Notes |
|---|---|---|
| Pinecone | Managed service only | The least to operate. Hybrid sparse-dense search isn't generally available yet, so plan for vector-only queries today. |
| Weaviate | Open source; managed Weaviate Cloud Service | [Weaviate 1.17](https://weaviate.io/blog/weaviate-1-17-release), released in December 2022, added BM25 and hybrid search plus replication. |
| Milvus | Open source; managed Zilliz Cloud | Built for very large collections. [Milvus 2.2.0](https://github.com/milvus-io/milvus/releases/tag/v2.2.0), released in November 2022, added DiskANN as a beta disk-based index. More moving parts to run yourself. |
| Qdrant | Open source, written in Rust | Strong payload filtering during search. Easy to run in a single Docker container. |
| pgvector | PostgreSQL extension | Vectors next to your relational data, in SQL. Only an IVFFlat index for now. |
| FAISS or hnswlib | Libraries | No server, so you build persistence and filtering yourself. Fine inside a batch job or a single service. |

Azure doesn't have a native vector store yet: no first-party Azure data service lets you index and query your own embeddings. The nearest edge case is the Enterprise tier of Azure Cache for Redis, which runs Redis Ltd.'s RediSearch module as a partner offering; check which module version your instance runs before counting on vector queries there. Azure Cognitive Search offers [semantic search in preview](https://learn.microsoft.com/azure/search/semantic-search-overview), but that re-ranks keyword results with Microsoft's models. It doesn't index the vectors you generate with Azure OpenAI. I look at what Cognitive Search can and can't do for vectors in [a separate post](/blog/2023-01-30-azure-cognitive-search-vectors/).

If you're on Azure today, your realistic choices are:

- **Run an open-source engine yourself** on AKS or a VM, and own the operations.
- **Use a third-party managed service**, and accept the extra network hop and the data residency question.
- **Use Postgres.** On a managed service, confirm that pgvector is on that service's extension allowlist before designing around it.

I go deeper on each of the dedicated engines this week, covering [Pinecone](/blog/2023-01-26-pinecone-basics/), [Weaviate](/blog/2023-01-27-weaviate-basics/), [Milvus](/blog/2023-01-28-milvus-basics/) and [Qdrant](/blog/2023-01-29-qdrant-basics/).

## pgvector deserves a serious look

If you already run PostgreSQL, pgvector removes a whole system from your architecture. Your vectors, metadata, row-level security and transactions sit in the same place, and filters are just `WHERE` clauses. [Version 0.4.0](https://github.com/pgvector/pgvector/blob/master/CHANGELOG.md), released on 11 January, raised the maximum vector size to 16,000 dimensions and the maximum indexed size to 2,000, so 1,536-dimension embeddings now fit comfortably.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE document_chunks (
    id         bigserial PRIMARY KEY,
    tenant_id  text        NOT NULL,
    content    text        NOT NULL,
    embedding  vector(1536) NOT NULL
);

-- Load your rows here (COPY document_chunks ... or batched INSERTs)
-- before building the index below.

-- Build the IVFFlat index only once the table holds representative data,
-- otherwise k-means trains its clusters on nothing useful.
CREATE INDEX document_chunks_embedding_idx
    ON document_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Probe more clusters for better recall at the cost of latency.
SET ivfflat.probes = 10;

-- Fragment: $1 is the query embedding, bound as a parameter by your client
-- library (psycopg, Npgsql and so on). It won't run as-is in psql.
SELECT id, content, embedding <=> $1 AS cosine_distance
FROM document_chunks
WHERE tenant_id = 'contoso'
ORDER BY embedding <=> $1
LIMIT 5;
```

The trade-offs are real, though. IVFFlat needs data in the table before you build the index, and its clusters drift as content changes, so you'll rebuild it periodically. A restrictive `WHERE` clause combined with a small number of probes can return fewer rows than `LIMIT` asks for, because the filter runs on the candidates the index returns. And Postgres was never designed to scan hundreds of millions of high-dimensional vectors. For a few million chunks of internal documents, I'd take that deal without hesitation.

## When not to buy one

Don't adopt a vector database because a demo used one. I'd hold off when:

- **Your corpus is small.** Under a few hundred thousand chunks, exact search in memory is simpler, exact and fast enough.
- **You haven't proven embeddings help.** If you haven't measured recall against your current search on real queries, a new database just makes an unvalidated idea more expensive.
- **Keyword search is most of the value.** Content full of part numbers and error codes may be better served by improving the search engine you already run.
- **Your data can't leave your tenancy.** A managed service outside your cloud boundary is a governance conversation first and a technical one second.

## How I'd decide

Start with exact search and a labelled set of queries. When the corpus or the latency outgrows it, add an ANN index and measure the recall you give up. Move to a database when you need filtering, updates and persistence, not before. Then choose the boring option that fits: pgvector if you already live in Postgres, a managed service if nobody on the team wants to operate a cluster, and Milvus or Qdrant self-hosted when scale or data residency rules out everything else. Whatever you choose, keep the model name next to every vector. The day you change embedding models, you re-embed everything, and the database can't do that for you.
