---
title: "Keeping Azure AI Search Vector Indexes Small Without Compression"
description: "Azure AI Search has no built-in vector compression yet. How to estimate vector index size, read the quota, and cut it with chunking and dimension choices."
author: Michael John Peña
draft: false
date: 2024-01-26
tags:
  - Azure AI Search
  - Vector Search
  - Cost Optimization
  - RAG
  - Embeddings
---

In Azure AI Search, vector storage is the limit RAG teams run into first, and it usually shows up as a failed indexer run halfway through a backfill. Every vector field is held in memory as an HNSW graph, each tier gets a fixed amount of vector memory per partition, and the only way to buy more is to add partitions, which you pay for as whole search units. If you're coming from a vector database that offers product quantization or int8 storage, you need to know this: Azure AI Search has no built-in vector compression today. As of January 2024, keeping the index small is a design job, not a setting.

## What the platform gives you today

The GA API is `2023-11-01` and the current preview is `2023-10-01-Preview`. Neither has a quantization setting, a narrower vector data type, or a way to skip storing the full-precision copy. Vector fields are `Collection(Edm.Single)`, which means 4 bytes per dimension, with no other options. I covered what's GA and what's preview more broadly in [the post-Ignite stock-take](/blog/2024-01-23-azure-ai-search-updates/).

Vector memory is a separate quota from disk storage, and it's much smaller. The [vector index size limits](https://learn.microsoft.com/en-us/azure/search/search-limits-quotas-capacity#vector-index-size-limits) depend on when the service was created:

| Tier | Vector quota per partition (created 1 July 2023 or later) | Vector quota per partition (created earlier) | Disk storage per partition |
|---|---|---|---|
| Basic | 1 GB | 0.5 GB | 2 GB |
| S1 | 3 GB | 1 GB | 25 GB |
| S2 | 12 GB | 6 GB | 100 GB |
| S3 | 36 GB | 12 GB | 200 GB |
| L1 | 12 GB | 12 GB | 1 TB |
| L2 | 36 GB | 36 GB | 2 TB |

The table shows the problem. An S1 partition has 25 GB of disk but only 3 GB for vectors, so a RAG index will hit the vector quota long before it runs out of disk. You can't upgrade an older service to the newer limits either. If your S1 was created in early 2023 and you're short on vector memory, create a new service. Recreating it costs an afternoon, while adding partitions to the old one costs money every month.

Azure AI Search is billed per search unit (replicas × partitions), not per gigabyte. Any per-GB storage figure you see in a cost model for this service is wrong. Vector size matters because it decides how many partitions you need, and each partition is billed in full.

## Estimating vector index size

Microsoft's [vector index size guidance](https://learn.microsoft.com/en-us/azure/search/vector-search-index-size) breaks the in-memory size into three parts:

1. **Raw size**: documents × dimensions × 4 bytes, for each vector field.
2. **Algorithm overhead**: the HNSW graph links. This is small for high-dimensional vectors. At the default `m` of 4 and 1,536 dimensions, it's about 1%.
3. **Deleted-document overhead**: an update is a delete plus an insert, and deleted vectors stay in the graph until they're cleaned up. There's no API that reports this ratio. Microsoft reports half of customers stay under 10%, so plan on 10–20% and more if you update often.

Only HNSW fields count toward the vector quota. Exhaustive KNN fields are paged into memory at query time, so they use disk storage but not vector quota. That matters for the levers below.

Here is the estimator I use before choosing a tier. It's plain Python with no dependencies:

```python
import math

# Vector quota per partition in GB, for services created on or after 1 July 2023.
VECTOR_QUOTA_GB = {"basic": 1, "s1": 3, "s2": 12, "s3": 36, "l1": 12, "l2": 36}
MAX_PARTITIONS = {"basic": 1, "s1": 12, "s2": 12, "s3": 12, "l1": 12, "l2": 12}


def estimate_vector_gb(
    chunks: int,
    dimensions: int,
    vector_fields: int = 1,
    hnsw_overhead: float = 0.01,
    deleted_ratio: float = 0.15,
) -> float:
    raw_bytes = chunks * dimensions * 4 * vector_fields  # Edm.Single = 4 bytes
    return raw_bytes * (1 + hnsw_overhead) * (1 + deleted_ratio) / 1_000_000_000


def partitions_needed(vector_gb: float, tier: str) -> int | None:
    needed = math.ceil(vector_gb / VECTOR_QUOTA_GB[tier])
    return needed if needed <= MAX_PARTITIONS[tier] else None


if __name__ == "__main__":
    scenarios = [
        ("1M chunks, ada-002, one field", 1_000_000, 1536, 1),
        ("1M chunks, ada-002, title + content fields", 1_000_000, 1536, 2),
        ("400K chunks, ada-002, one field", 400_000, 1536, 1),
    ]
    for label, chunks, dims, fields in scenarios:
        gb = estimate_vector_gb(chunks, dims, fields)
        plan = {tier: partitions_needed(gb, tier) for tier in ("s1", "s2", "s3")}
        print(f"{label}: {gb:.2f} GB -> partitions {plan}")
```

One million 1,536-dimension chunks come to about 7.1 GB with a 15% deleted-document allowance. That's three S1 partitions or one S2. Add a second vector field for titles and it doubles to about 14.3 GB, which needs five S1 partitions or two S2. The model and the number of chunks drive the cost much more than tier selection does.

## Checking what you actually use

Estimates are a starting point. The GA API reports actual usage. `GET /servicestats` returns `vectorIndexSize` usage and quota for the whole service, and `GET /indexes/{name}/stats` returns it per index. I call them directly so the numbers come back in bytes, exactly as the service reports them:

```python
import os

import requests

ENDPOINT = "https://<your-search-service>.search.windows.net"
API_VERSION = "2023-11-01"
HEADERS = {"api-key": os.environ["AZURE_SEARCH_ADMIN_KEY"]}


def gb(value: int) -> float:
    return value / 1_000_000_000


def report(index_name: str) -> None:
    service = requests.get(
        f"{ENDPOINT}/servicestats",
        params={"api-version": API_VERSION},
        headers=HEADERS,
        timeout=30,
    )
    service.raise_for_status()
    vector = service.json()["counters"]["vectorIndexSize"]
    print(f"Service vector memory: {gb(vector['usage']):.2f} of {gb(vector['quota']):.2f} GB")

    index = requests.get(
        f"{ENDPOINT}/indexes/{index_name}/stats",
        params={"api-version": API_VERSION},
        headers=HEADERS,
        timeout=30,
    )
    index.raise_for_status()
    stats = index.json()
    print(
        f"{index_name}: {stats['documentCount']} docs, "
        f"{gb(stats['vectorIndexSize']):.2f} GB vector, {gb(stats['storageSize']):.2f} GB on disk"
    )


if __name__ == "__main__":
    report("docs-chunks")
```

Run this after every large indexing job and alert when usage passes 80% of quota. Indexing fails outright once the quota is exhausted. A side-by-side rebuild holds both indexes in vector memory until you drop the old one, and in-place updates leave deleted vectors resident until cleanup, so leave headroom for both. I'll cover blue-green rebuilds in a follow-up.

## The levers you actually have

### Index fewer, better chunks

This lever has the biggest effect, and it improves relevance as well. Teams often index every page of every document, including boilerplate, navigation, legal footers and duplicate versions, and then pay to hold all of it in memory. Deduplicating before you embed and dropping chunks that will never answer a question can cut chunk counts substantially; measure it on your own corpus before and after. Chunk size matters too. Going from 500-token to 1,000-token chunks roughly halves the vector count, but retrieval gets less precise, so test it against real questions before committing. My [chunking post](/blog/2024-01-07-advanced-chunking-strategies/) covers how to chunk by structure rather than by character count.

### One vector field, not three

Every extra vector field costs as much memory as the first one. A separate title embedding rarely beats putting the title in the chunk text before you embed it, and BM25 already handles exact title matches in a hybrid query. I only add a second vector field when evaluation shows it helps.

### Use exhaustive KNN where HNSW isn't earning its memory

If a vector field is small, always heavily filtered, or queried rarely, configure it with the `exhaustiveKnn` algorithm. It uses disk instead of vector quota, and brute-force search over a few thousand filtered candidates is fast enough. Exhaustive KNN also gives exact recall, and with a filter its latency depends on how many vectors the filter leaves rather than on total index size, so it suits selective filters such as `tenantId` but not broad ones. Typical examples are per-tenant indexes, where every query filters to one tenant, and secondary fields used only for occasional lookups. Profiles make this easy to set per field. Here is the `vectorSearch` section of the index definition (a fragment, not a complete index):

```json
{
  "vectorSearch": {
    "algorithms": [
      { "name": "hnsw-content", "kind": "hnsw", "hnswParameters": { "m": 4, "efConstruction": 400, "efSearch": 500, "metric": "cosine" } },
      { "name": "eknn-secondary", "kind": "exhaustiveKnn", "exhaustiveKnnParameters": { "metric": "cosine" } }
    ],
    "profiles": [
      { "name": "content-profile", "algorithm": "hnsw-content" },
      { "name": "secondary-profile", "algorithm": "eknn-secondary" }
    ]
  }
}
```

Each vector field then binds to a profile by name. These are entries in the index's `fields` array (also a fragment):

```json
[
  { "name": "contentVector", "type": "Collection(Edm.Single)", "searchable": true, "retrievable": false, "dimensions": 1536, "vectorSearchProfile": "content-profile" },
  { "name": "summaryVector", "type": "Collection(Edm.Single)", "searchable": true, "retrievable": false, "dimensions": 1536, "vectorSearchProfile": "secondary-profile" }
]
```

Don't use exhaustive KNN on your main retrieval field across millions of unfiltered chunks. Latency grows linearly with the number of vectors it scans, and you'll trade a partition bill for timeouts.

### Keep HNSW `m` at the default

The [HNSW parameters](https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-create-index) allow `m` from 4 to 10, and each extra link adds bytes per document. With 1,536 dimensions the graph is a rounding error next to the vectors, so raising `m` costs little memory, but it also rarely gains enough recall to be worth it. Tune `efSearch` first. It controls query-time recall and latency and adds nothing to index size, whereas raising `m` makes the graph bigger.

### Dimensions: worth watching

The vectors themselves are the real cost, and that's set by the embedding model. Today, in Azure OpenAI, that means `text-embedding-ada-002` at a fixed 1,536 dimensions. Yesterday OpenAI announced `text-embedding-3-small` and `text-embedding-3-large` with a `dimensions` parameter that shortens embeddings ([OpenAI's announcement](https://openai.com/index/new-embedding-models-and-api-updates/)). A 512-dimension vector is a third the size of an ada-002 vector. These models aren't in Azure OpenAI yet, and switching models means re-embedding your whole corpus, so this isn't an action item this week. It's the reason I'd keep the embedding model a configuration value and the re-embed pipeline repeatable.

## What I'd skip

Don't try to build compression yourself by pushing int8 or truncated vectors into `Collection(Edm.Single)` fields. The service still stores 4 bytes per dimension, so you save nothing and lose accuracy. Truncating ada-002 vectors in particular hurts recall, because the model wasn't trained for it. Also, setting a vector field to `retrievable: false` keeps it out of query responses, which is good for payload size, but it doesn't shrink the index.

## Where I'd land

Size the index from chunk count × dimensions × fields before you pick a tier, and check `vectorIndexSize` after every large load. If you're on an older service, the cheapest fix may be a new one with up to three times the per-partition quota. Then cut volume: deduplicate, chunk thoughtfully, use one vector field, and use exhaustive KNN for anything filtered or rarely searched. Those choices are worth more than any tuning parameter, and they'll still be the right ones if compression does arrive in the service later.
