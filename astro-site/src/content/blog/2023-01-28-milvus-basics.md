---
title: "Milvus 2.2 with Azure OpenAI Embeddings: A Self-Hosted Start"
description: "Run Milvus 2.2 standalone, load Azure OpenAI embeddings with pymilvus, and learn the schema, index, consistency and delete rules before you self-host it."
author: Michael John Peña
draft: false
date: 2023-01-28
tags:
  - Milvus
  - Vector Database
  - Embeddings
  - Azure OpenAI
  - Python
---

Milvus is the vector database people point to when the corpus is measured in hundreds of millions of vectors and a managed service is off the table. That reputation is earned, but it comes with a distributed system you have to run, and a handful of behaviours that surprise people who arrive expecting a document store. The install takes five minutes; the schema, consistency and delete rules are what decide whether self-hosting it is a good idea.

This post follows the [vector database trade-offs post](/blog/2023-01-25-vector-databases-intro/) and the managed alternative in the [Pinecone post](/blog/2023-01-26-pinecone-basics/). If you haven't decided you need a dedicated engine yet, read those first.

## Where Milvus is right now

The current line is 2.2. [Milvus 2.2.0](https://github.com/milvus-io/milvus/releases/tag/v2.2.0) shipped on 18 November 2022 with bulk insert from files, pagination for search and query results, role-based access control, collection-level TTL, rate limits, and two beta features: a disk-based index built on DiskANN and data backup. The latest patch, 2.2.2, landed on 22 December and is a bug-fix release. Its compatibility table pairs it with the Python SDK, pymilvus 2.2.1.

Two things that people often assume exist aren't in 2.2. There's no cosine metric: you get Euclidean distance (`L2`) and inner product (`IP`) for float vectors. And there's no upsert, so updating a record means deleting and re-inserting it. Both shape the code below.

## What you're signing up to operate

Milvus 2.x separates storage from compute. Even the standalone deployment is three containers: etcd for metadata, MinIO for object storage, and the Milvus server itself. The cluster deployment splits Milvus into coordinators plus query, data and index nodes, and adds Pulsar or Kafka as the log broker. On Azure that means AKS with the Helm chart or the Milvus Operator, persistent disks for etcd and the broker, and object storage. For Azure Blob Storage, the Helm chart's route is the bundled MinIO chart's `azuregateway` option, which relies on MinIO's gateway mode. MinIO deprecated gateway mode in 2022, so pin the chart's MinIO image rather than upgrading it, or point Milvus at an S3-compatible endpoint you already run.

That architecture is why Milvus scales: query nodes scale for search load and index nodes for build load, independently. It's also the cost. You own upgrades, broker health, etcd backups and capacity planning. My rule of thumb is that if nobody on the team wants to be paged for etcd, you're not ready to run the cluster deployment. Standalone is a different story: it's a reasonable choice for a single service with up to a few tens of millions of vectors, provided you're comfortable that it's one machine and you've done the memory sums in the index section below.

## Running it locally

Each release publishes its Docker Compose files as release assets. Pin the version rather than following `latest`:

```bash
mkdir milvus && cd milvus
wget https://github.com/milvus-io/milvus/releases/download/v2.2.2/milvus-standalone-docker-compose.yml -O docker-compose.yml
docker compose up -d

python -m venv .venv && source .venv/bin/activate
pip install "pymilvus==2.2.1" "openai==0.26.1"
```

Milvus listens on port 19530, and this standalone setup has no authentication by default. User authentication and RBAC are opt-in through `common.security.authorizationEnabled` in `milvus.yaml`, so turn that on before you expose the port beyond your machine. The `openai` pin matches my [Azure OpenAI Python SDK post](/blog/2023-01-18-azure-openai-python-sdk/), which uses API version `2022-12-01`.

## Schema decisions you can't easily undo

A Milvus collection has a fixed schema. You can't add a field later, so decide up front which metadata you'll filter on. Here's the whole loader, which creates the collection, embeds documents one at a time, and builds an HNSW index. Save it as `load_milvus.py`:

```python
import os
import time
from typing import Dict, List

import openai
from pymilvus import (
    Collection,
    CollectionSchema,
    DataType,
    FieldSchema,
    connections,
    utility,
)

openai.api_type = "azure"
openai.api_base = "https://<your-resource-name>.openai.azure.com/"
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

EMBEDDING_DEPLOYMENT = "<your-embedding-deployment>"
EMBEDDING_MODEL = "text-embedding-ada-002"
COLLECTION_NAME = "azure_docs"
MAX_TEXT_BYTES = 4000


def embed(text: str, max_retries: int = 5) -> List[float]:
    """Embed one string. Azure OpenAI takes a single input per request."""
    for attempt in range(max_retries):
        try:
            response = openai.Embedding.create(
                engine=EMBEDDING_DEPLOYMENT, input=text.replace("\n", " ")
            )
            return response["data"][0]["embedding"]
        except openai.error.RateLimitError:
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)
    raise ValueError("max_retries must be at least 1")


def truncate_utf8(text: str, max_bytes: int) -> str:
    """Trim text so its UTF-8 encoding fits in max_bytes."""
    return text.encode("utf-8")[:max_bytes].decode("utf-8", errors="ignore")


def get_or_create_collection(dim: int) -> Collection:
    if utility.has_collection(COLLECTION_NAME):
        return Collection(COLLECTION_NAME)

    fields = [
        FieldSchema("id", DataType.VARCHAR, is_primary=True, auto_id=False, max_length=64),
        FieldSchema("category", DataType.VARCHAR, max_length=64),
        FieldSchema("model", DataType.VARCHAR, max_length=64),
        FieldSchema("text", DataType.VARCHAR, max_length=MAX_TEXT_BYTES),
        FieldSchema("embedding", DataType.FLOAT_VECTOR, dim=dim),
    ]
    schema = CollectionSchema(fields, description="Azure documentation chunks")
    collection = Collection(COLLECTION_NAME, schema, consistency_level="Bounded")

    # ada-002 vectors are unit length, so inner product ranks like cosine.
    collection.create_index(
        field_name="embedding",
        index_params={
            "index_type": "HNSW",
            "metric_type": "IP",
            "params": {"M": 16, "efConstruction": 200},
        },
    )
    return collection


def upsert(collection: Collection, docs: List[Dict[str, str]]) -> None:
    """Milvus 2.2 has no upsert, so delete existing ids, then insert."""
    ids = [doc["id"] for doc in docs]
    texts = [truncate_utf8(doc["text"], MAX_TEXT_BYTES) for doc in docs]
    # Embed first: if this raises, the existing rows are still in place.
    vectors = [embed(text) for text in texts]

    quoted = ", ".join(f'"{doc_id}"' for doc_id in ids)
    collection.delete(f"id in [{quoted}]")
    collection.insert([
        ids,
        [doc["category"] for doc in docs],
        [EMBEDDING_MODEL] * len(docs),
        texts,
        vectors,
    ])


if __name__ == "__main__":
    connections.connect(alias="default", host="localhost", port="19530")

    docs = [
        {"id": "vm-001", "category": "compute",
         "text": "Azure Virtual Machines provide on-demand, scalable IaaS compute."},
        {"id": "func-001", "category": "compute",
         "text": "Azure Functions runs event-driven code without managing servers."},
        {"id": "cosmos-001", "category": "database",
         "text": "Azure Cosmos DB is a globally distributed, multi-model NoSQL database."},
    ]

    dim = len(embed(docs[0]["text"]))
    collection = get_or_create_collection(dim)
    upsert(collection, docs)
    collection.flush()
    # num_entities counts soft-deleted rows until compaction, so a re-run can
    # report 6 here even though only 3 rows are live.
    print(f"{collection.num_entities} entities in {COLLECTION_NAME} (dim={dim})")
```

A few choices in there are deliberate.

**The dimension comes from the model, not a constant.** `text-embedding-ada-002` returns 1,536 dimensions, but it's still rolling out across Azure OpenAI resources, and the first-generation `text-search-ada-doc-001` returns 1,024. Check the [Azure OpenAI models page](https://learn.microsoft.com/azure/ai-foundry/openai/concepts/models) for what you can deploy. Measuring the first vector means the schema matches whatever is behind your deployment. Because the schema is fixed, a model change means a new collection and a full re-embed, which is also why I store the model name on every row.

**`VARCHAR` primary keys, not `auto_id`.** Auto-generated IDs make the first load easy and every later load hard, because you can't find "the chunk for this document" again. Deterministic IDs from your source system make ingestion safe to re-run. `upsert()` embeds everything before it deletes anything, so a failed embedding call leaves the old rows untouched. The delete and the insert are still two separate calls, not a transaction: a search that lands between them won't see those documents, and a crash there leaves them missing until the next run.

**Treat `max_length` as a hard limit.** The server checks the encoded length, so treat it as bytes, and you can't widen it later because the schema is fixed, so truncate before you insert rather than relying on the server to catch oversized values. Truncating on UTF-8 bytes rather than characters is the conservative choice for non-English content.

**Delete takes a primary key expression.** In 2.2, [`delete`](https://milvus.io/docs/v2.2.x/delete_data.md) accepts an `id in [...]` expression on the primary key, not an arbitrary filter like `category == "compute"`. Deletes are also soft: the rows are marked deleted and cleaned up during compaction, which is why `num_entities` can overcount after a re-run. Plan your re-ingestion around IDs you can reconstruct.

## Searching and the consistency trap

```python
import os

import openai
from pymilvus import Collection, connections

openai.api_type = "azure"
openai.api_base = "https://<your-resource-name>.openai.azure.com/"
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

EMBEDDING_DEPLOYMENT = "<your-embedding-deployment>"

connections.connect(alias="default", host="localhost", port="19530")
collection = Collection("azure_docs")
collection.load()

query = "run code without provisioning servers"
# Same preprocessing as the loader's embed(); this minimal client skips the retry.
query_vector = openai.Embedding.create(
    engine=EMBEDDING_DEPLOYMENT, input=query.replace("\n", " ")
)["data"][0]["embedding"]

results = collection.search(
    data=[query_vector],
    anns_field="embedding",
    param={"metric_type": "IP", "params": {"ef": 64}},
    limit=3,
    expr='category in ["compute", "database"]',
    output_fields=["category", "text"],
    consistency_level="Strong",
)

for hit in results[0]:
    print(f"{hit.score:.4f}  {hit.id}  {hit.entity.get('text')}")
```

`collection.load()` pulls the collection into query node memory, and nothing is searchable until it's loaded. Memory sizing in Milvus is about loaded collections, not stored ones, and `collection.release()` gives that memory back.

The trap is consistency. A collection defaults to [**Bounded** staleness](https://milvus.io/docs/v2.2.x/consistency.md), so a search may not see rows inserted a moment ago. That's the right default for a production search service and the wrong one for a test that inserts and immediately queries, which then fails intermittently. Pass `consistency_level="Strong"` on the search when you need read-your-writes, and leave the default on everywhere else.

`ef` is the HNSW search-time knob: higher means better recall and more latency, and it must be at least `limit`. Don't tune it by feel. Measure recall against exact search on your own vectors, as I showed with FAISS in the [trade-offs post](/blog/2023-01-25-vector-databases-intro/).

The `expr` filter is applied during the search, which avoids the "filter after ANN returns fewer than k results" problem. That doesn't make filters free: a very selective filter on HNSW still costs latency and can hurt recall, so test `ef` with your real filters, not just unfiltered queries. For hard tenant or category separation, partitions are the 2.2 tool, and searching a named partition skips the rest of the collection. The filter works on scalar fields in your schema, which is one more reason to get the schema right the first time.

## Choosing an index

The [2.2 index reference](https://milvus.io/docs/v2.2.x/index.md) lists the options and their parameters, including the `L2` and `IP` metrics and the rule that HNSW's `ef` must be at least the top-k.

| Index | Memory | When I'd use it |
|---|---|---|
| `FLAT` | Full vectors | Small collections or measuring ground-truth recall |
| `HNSW` | Full vectors plus graph | The default when vectors fit in memory and latency matters |
| `IVF_FLAT` | Full vectors | Faster builds; tune `nlist` at build time and `nprobe` at search time |
| `IVF_SQ8` / `IVF_PQ` | Compressed | Memory is the constraint and you can accept lower recall |
| `DISKANN` | Mostly on SSD | Very large collections; beta in 2.2, so not for production yet |

I'd start with HNSW and move off it only when memory cost is the measured problem.

Do the memory sum before you pick a deployment. An ada-002 vector is 1,536 32-bit floats, so 1,536 × 4 bytes is about 6 KB. Ten million of them is about 60 GB of RAM for the raw vectors alone, before the HNSW graph (with `M` of 16, roughly another 100 to 200 bytes per vector), the scalar fields you load, and headroom for segments being built. That's where my thresholds come from: a million vectors is about 6 GB and fits comfortably beside Postgres, while a few tens of millions is a large single VM for standalone, and beyond that you either compress with `IVF_SQ8` or `IVF_PQ` or spread the load across query nodes in the cluster deployment.

## When I wouldn't choose Milvus

- **You have under a few million vectors.** pgvector or a single-container engine gets you there with far less to operate.
- **Nobody wants to run it.** The cluster deployment is a real distributed system. If the team won't own etcd, a broker and upgrades, use a managed service. Zilliz Cloud is the managed Milvus, but check that it runs in a region your data is allowed to live in.
- **You need frequent per-record updates.** Without upsert, every update is a delete plus insert and depends on compaction to reclaim space. Fine for nightly re-indexing, awkward for a write-heavy workload.
- **You need keyword and vector scoring together.** Milvus 2.2 is vector search with scalar filters. If exact identifiers matter, look at the hybrid search in [Weaviate](/blog/2023-01-27-weaviate-basics/) or keep a keyword engine alongside.

## The decision

Milvus is the option I'd pick when scale or data residency rules out a managed service and the team is prepared to operate it. Start with standalone on a pinned release, use deterministic IDs and a model column from day one, default to HNSW with inner product on normalised vectors, and pass `Strong` consistency only where you need to read your own writes. If those operational costs look heavier than the scale problem you actually have, that's your answer too.
