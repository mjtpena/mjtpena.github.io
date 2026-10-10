---
title: "Qdrant 0.11 with Azure OpenAI: Point IDs, Payload Indexes and Filters"
description: "Run Qdrant 0.11 with Azure OpenAI embeddings: valid point IDs, payload indexes, filtered HNSW search, memory settings, and when Qdrant isn't the right choice."
author: Michael John Peña
draft: false
date: 2023-01-29
tags:
  - Qdrant
  - Vector Database
  - Embeddings
  - Azure OpenAI
  - Python
---

Qdrant is the vector database I'd look at when filtering matters as much as similarity: "find chunks like this question, but only from this product, this tenant and this year". Its query planner treats filters as part of the search rather than something applied afterwards, and it ships as a single Rust binary that's easy to run. The getting-started examples, though, skip the details that bite on the first real load: point IDs that the server rejects, a client call that deletes your data, and threshold settings measured in units nobody expects.

This post is the fourth in a run on vector stores. The [trade-offs post](/blog/2023-01-25-vector-databases-intro/) covers whether you need one at all, and [Pinecone](/blog/2023-01-26-pinecone-basics/), [Weaviate](/blog/2023-01-27-weaviate-basics/) and [Milvus](/blog/2023-01-28-milvus-basics/) cover the alternatives.

## Where Qdrant is right now

The current server release is v0.11.7, published on 13 January 2023. The 0.11 line, which started with [v0.11.0](https://github.com/qdrant/qdrant/releases/tag/v0.11.0) in late October 2022, added replication for distributed deployments, an `exact` search parameter that bypasses the HNSW index, and an API to switch a node to read-only. The release before it, [v0.10.0](https://github.com/qdrant/qdrant/releases/tag/v0.10.0) in September 2022, brought multiple named vectors per point, batch search and recommendation, and full-text filtering on payload fields. The Python client is `qdrant-client` 0.11.9; keep it on the same minor version as the server.

It's still a 0.x product. The API has changed shape within the last two minor versions (0.10 was explicitly a transition release that accepted old and new request formats), so pin both server and client and read the release notes before upgrading.

## Running it locally

```bash
docker run -d --name qdrant -p 6333:6333 -p 6334:6334 \
  -v "$(pwd)/qdrant_storage:/qdrant/storage" \
  qdrant/qdrant:v0.11.7

python -m venv .venv && source .venv/bin/activate
pip install "qdrant-client==0.11.9" "openai==0.26.1"
```

Port 6333 is the REST API and 6334 is gRPC. The volume mount matters more than it looks: without it, removing the container removes every collection. The `openai` pin and API version `2022-12-01` match my [Azure OpenAI Python SDK post](/blog/2023-01-18-azure-openai-python-sdk/).

## Three things to get right before the first upsert

**Point IDs must be unsigned integers or UUIDs.** The client's type hints accept any string, so `id="doc1"` looks fine in your editor and then fails on the server. Most source systems have their own keys (a URL, a SharePoint item ID, a file path plus chunk number), so I derive a UUID from that key with `uuid.uuid5` and keep the original key in the payload. Using `uuid4` instead creates a fresh ID every run, so re-running ingestion creates duplicates rather than overwriting.

**`recreate_collection` means drop and create.** In 0.11.9 the Python client has no separate `create_collection` method, and `recreate_collection` deletes the collection if it exists. Put it in a script that runs on every deployment and you lose the index every time. Check `get_collections()` first, as the loader below does.

**Optimiser thresholds are in kilobytes, not vectors.** `indexing_threshold` and `memmap_threshold` are both measured in kilobytes of vector data, and the documentation's rule of thumb is that 1 KB is one 256-dimension vector. An ada-002 vector has 1,536 float32 values, which is 6 KB. A setting you believe means "index after 10,000 vectors" actually means "index after roughly 1,700 ada-002 vectors".

## Loading Azure OpenAI embeddings

Save this as `load_qdrant.py`. It creates the collection only if it's missing, adds payload indexes, and upserts with deterministic IDs:

```python
import os
import time
import uuid
from typing import Dict, List

import openai
from qdrant_client import QdrantClient
from qdrant_client.http import models

openai.api_type = "azure"
openai.api_base = "https://<your-resource-name>.openai.azure.com/"
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

EMBEDDING_DEPLOYMENT = "<your-embedding-deployment>"
EMBEDDING_MODEL = "text-embedding-ada-002"
COLLECTION = "azure_docs"
ID_NAMESPACE = uuid.UUID("6f1c2a52-8a0e-4d55-9a57-0b3f4a1d9c11")


def embed(text: str, max_retries: int = 5) -> List[float]:
    """Embed one string. Azure OpenAI takes a single input per request."""
    for attempt in range(max_retries):
        try:
            response = openai.Embedding.create(
                engine=EMBEDDING_DEPLOYMENT, input=text.replace("\n", " ")
            )
            return response["data"][0]["embedding"]
        except openai.error.RateLimitError:
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Embedding failed after {max_retries} attempts")


def point_id(source_id: str) -> str:
    """Qdrant accepts unsigned integers or UUIDs, so derive a stable UUID."""
    return str(uuid.uuid5(ID_NAMESPACE, source_id))


def ensure_collection(client: QdrantClient, dim: int) -> None:
    existing = {c.name for c in client.get_collections().collections}
    if COLLECTION in existing:
        return

    # recreate_collection drops any existing collection, so only call it
    # after confirming the collection doesn't exist.
    client.recreate_collection(
        collection_name=COLLECTION,
        vectors_config=models.VectorParams(size=dim, distance=models.Distance.COSINE),
        hnsw_config=models.HnswConfigDiff(m=16, ef_construct=100),
        on_disk_payload=True,
    )
    client.create_payload_index(COLLECTION, "category", models.PayloadSchemaType.KEYWORD)
    client.create_payload_index(COLLECTION, "updated", models.PayloadSchemaType.INTEGER)
    client.create_payload_index(
        COLLECTION,
        "text",
        models.TextIndexParams(
            type="text",
            tokenizer=models.TokenizerType.WORD,
            min_token_len=2,
            max_token_len=20,
            lowercase=True,
        ),
    )


def upsert(client: QdrantClient, docs: List[Dict]) -> None:
    points = [
        models.PointStruct(
            id=point_id(doc["source_id"]),
            vector=embed(doc["text"]),
            payload={**doc, "model": EMBEDDING_MODEL},
        )
        for doc in docs
    ]
    client.upsert(collection_name=COLLECTION, points=points, wait=True)


if __name__ == "__main__":
    client = QdrantClient(host="localhost", port=6333)

    docs = [
        {"source_id": "learn/virtual-machines", "category": "compute", "updated": 20221201,
         "tags": ["vm", "iaas"],
         "text": "Azure Virtual Machines provide on-demand, scalable IaaS compute."},
        {"source_id": "learn/azure-functions", "category": "compute", "updated": 20230110,
         "tags": ["serverless"],
         "text": "Azure Functions runs event-driven code without managing servers."},
        {"source_id": "learn/cosmos-db", "category": "database", "updated": 20221115,
         "tags": ["nosql", "global"],
         "text": "Azure Cosmos DB is a globally distributed, multi-model NoSQL database."},
    ]

    dim = len(embed(docs[0]["text"]))
    ensure_collection(client, dim)
    upsert(client, docs)
    print(client.count(COLLECTION, exact=True))
```

**The dimension comes from the model.** `text-embedding-ada-002` returns 1,536 dimensions, but it's still rolling out across Azure OpenAI resources, and the first-generation `text-search-ada-doc-001` returns 1,024. The [Azure OpenAI models page](https://learn.microsoft.com/azure/cognitive-services/openai/concepts/models) lists what you can deploy. Measuring the first vector keeps the collection honest, and storing `model` on every point tells you what to re-embed when the deployment changes.

**Cosine is the right metric here, and it's cheap.** With `Distance.COSINE`, Qdrant normalises vectors when they're stored and then compares them with a dot product, so you don't pay for normalisation on every query. If you already normalise vectors yourself, `Dot` gives the same ranking.

**`wait=True` trades latency for read-your-writes.** With it, `upsert` returns after the change is applied. For bulk loads of millions of points, set it to `False` and confirm with `count` at the end.

## Filtered search

Save this as `search_qdrant.py`:

```python
import os

import openai
from qdrant_client import QdrantClient
from qdrant_client.http import models

openai.api_type = "azure"
openai.api_base = "https://<your-resource-name>.openai.azure.com/"
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

client = QdrantClient(host="localhost", port=6333)
query = "run code without provisioning servers"
vector = openai.Embedding.create(
    engine="<your-embedding-deployment>", input=query
)["data"][0]["embedding"]

query_filter = models.Filter(
    must=[
        models.FieldCondition(key="category", match=models.MatchValue(value="compute")),
        models.FieldCondition(key="updated", range=models.Range(gte=20230101)),
    ],
    must_not=[
        models.FieldCondition(key="tags", match=models.MatchValue(value="deprecated")),
    ],
)

hits = client.search(
    collection_name="azure_docs",
    query_vector=vector,
    query_filter=query_filter,
    search_params=models.SearchParams(hnsw_ef=128),
    limit=5,
)
approx_ids = [hit.id for hit in hits]

exact_hits = client.search(
    collection_name="azure_docs",
    query_vector=vector,
    query_filter=query_filter,
    search_params=models.SearchParams(exact=True),
    limit=5,
)
exact_ids = [hit.id for hit in exact_hits]

for hit in hits:
    print(f"{hit.score:.4f}  {hit.payload['source_id']}  {hit.payload['text']}")

overlap = len(set(approx_ids) & set(exact_ids)) / max(len(exact_ids), 1)
print(f"Overlap with exact search: {overlap:.0%}")
```

The [filter model](https://qdrant.tech/documentation/concepts/filtering/) is `must` (AND), `should` (at least one), and `must_not`, and they nest. A `MatchValue` on an array field such as `tags` matches if any element equals the value. For full-text conditions, `MatchText` on the `text` field uses the word-tokenised index created above. It filters; it doesn't rank. There's no BM25 score to blend with the vector score.

The second query is the reason I like the 0.11 `exact` parameter. It runs the same filtered search without the HNSW approximation, so you can measure recall on your own data instead of trusting defaults. On three documents the two always agree; on a real corpus, run a few hundred representative queries through both and raise `hnsw_ef` until the overlap is where you need it. I covered the same method with FAISS in the [trade-offs post](/blog/2023-01-25-vector-databases-intro/).

## Why payload indexes matter

Filtering works without payload indexes, but every condition then reads payloads point by point. With indexes, Qdrant's [query planner](https://qdrant.tech/documentation/concepts/indexing/) estimates how many points a filter will keep. If it's a small set, it scans just those points exactly. If it's a large set, it searches the HNSW graph and checks the filter during the traversal. Qdrant also adds extra links to the graph for indexed fields, so a restrictive filter doesn't leave the search stranded in a disconnected part of the graph. That combination is the main reason to pick Qdrant over a store that filters after the ANN step and hands you three results when you asked for ten.

My rule: index every field you filter on, choose `KEYWORD` for IDs and categories, `INTEGER` or `FLOAT` for dates and numbers, and don't index fields you only display. Indexed payload values stay in RAM even with `on_disk_payload=True`.

## Memory: what stays in RAM

By default, vectors, the HNSW graph and payloads all live in memory. At 6 KB per ada-002 vector, ten million chunks is about 60 GB of vectors before the graph. The levers in 0.11 are:

| Setting | Moves to disk | Cost |
|---|---|---|
| `on_disk_payload=True` (collection) | Unindexed payload values | Slightly slower payload reads |
| `memmap_threshold` (optimiser, KB) | Vectors in segments above the threshold, as read-only memory-mapped files | Search latency depends on page cache and disk speed |
| `HnswConfigDiff(on_disk=True)` | The HNSW graph | Slower traversal, especially on network disks |

On Azure, that last column is the real decision. Memory-mapped vectors on a Premium SSD behave very differently from those on a Standard HDD. Benchmark on the disk SKU you'll run in production, not on your laptop's NVMe.

## Operating it on Azure

Single-node Qdrant is one container with one volume, so a VM or a StatefulSet on AKS with a Premium SSD persistent volume is straightforward. The snapshot API gives you collection-level backups to copy to Blob Storage. Distributed mode with sharding and replication is newer: it's on the 0.11 line, and a distributed deployment isn't storage-compatible with the versions before it. I'd stay single-node until data size forces the question, and keep it on a private network (an internal AKS service or a VNet with no public IP) so only your application can reach it.

## When I'd choose something else

- **Under a million vectors with simple filters.** pgvector in a Postgres you already run, or a NumPy prototype like the one in my [semantic search post](/blog/2023-01-24-semantic-search-embeddings/), is less to operate.
- **You need keyword relevance and vector relevance in one score.** Qdrant's full-text condition is a filter, not a ranker. Weaviate's hybrid search or a keyword engine alongside is the better fit.
- **Nobody wants to own a stateful service.** Self-hosting means backups, upgrades on a 0.x API and capacity planning. A managed service costs more and removes that work.
- **Hundreds of millions of vectors from day one.** Milvus has the longer track record with independently scaled query and index nodes.

## The short version

Choose Qdrant when filtered similarity search is the core of your workload and you're comfortable running a single container. Pin v0.11.7 and client 0.11.9, derive UUIDs from your source keys, never let `recreate_collection` run against a collection that exists, index every field you filter on, and use `exact=True` to measure recall before you tune anything. Remember the threshold settings are in kilobytes before you copy one from a blog post, this one included.
