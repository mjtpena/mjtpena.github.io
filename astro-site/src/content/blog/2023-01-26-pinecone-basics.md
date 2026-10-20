---
title: "Pinecone With Azure OpenAI Embeddings: Design the Index First"
description: "Set up a Pinecone index for Azure OpenAI embeddings: dimensions, pod types, namespaces, metadata indexing and idempotent upserts, plus when to skip it."
author: Michael John Peña
draft: false
date: 2023-01-26
tags:
  - Pinecone
  - Vector Database
  - Embeddings
  - Azure OpenAI
  - Python
---

Pinecone is the fastest way I know to get a managed vector index running: sign up, grab an API key, create an index, upsert. That speed hides several decisions you can't easily undo. Dimension, metric, pod type and how you split tenants are all fixed or painful to change once an index holds data, and getting them wrong shows up later as a re-index or a surprise bill. Make these choices before the first upsert, because the index won't let you make them after.

If you haven't yet decided whether you need a vector database at all, start with [yesterday's post on ANN indexes and trade-offs](/blog/2023-01-25-vector-databases-intro/). This one assumes you've decided a managed service is worth it.

## What you're actually buying

Pinecone is a hosted service only. There's nothing to install, and you can't run it inside your own Azure subscription. You pick an environment (a cloud region, such as `us-west1-gcp`) when you create the project, and you size indexes in **pods**. A pod is a unit of capacity billed per hour, and replicas multiply the pod count. Three [pod families](https://docs.pinecone.io/guides/indexes/pods/understanding-pod-based-indexes) are available:

| Pod type | Built for | Rough capacity per x1 pod | Notes |
|---|---|---|---|
| `s1` | Storage | ~5M vectors at 768 dimensions | Cheapest per vector; slower queries |
| `p1` | Performance | ~1M vectors at 768 dimensions | Sensible default for a first index |
| `p2` | High throughput, low latency | Similar to p1 | Newest family, [announced late 2022](https://www.pinecone.io/blog/pods-for-performance/); slower upserts than p1, so best for read-heavy workloads |

Each family comes in sizes (`x1`, `x2`, `x4`, `x8`), and you can scale up a size or add replicas later with `configure_index`. The capacity figures are for 768-dimension vectors, which is the first trap for an Azure developer.

## Dimension: check what your Azure deployment returns

OpenAI's `text-embedding-ada-002` returns 1536 dimensions, and most Pinecone tutorials hard-code that number. In Azure OpenAI, though, ada-002 is still rolling out and many resources can't deploy it yet; check the [models page](https://learn.microsoft.com/azure/ai-services/openai/concepts/models) and your deployments list in Azure OpenAI Studio. Until it shows up for you, you're choosing from the first-generation `-001` models, and their sizes vary widely: ada models return 1,024 dimensions, babbage 2,048, curie 4,096 and davinci 12,288. The [embeddings concepts page](https://learn.microsoft.com/azure/ai-services/openai/concepts/understand-embeddings) explains why cosine similarity is the comparison to use.

That matters twice. First, the index dimension is fixed at creation, and an index built for 1536 will reject a 4,096-dimension vector. Second, pod capacity scales roughly inversely with dimension. If a p1 pod holds about a million 768-dimension vectors, it holds something nearer 190,000 curie vectors. My rule of thumb is to never type the dimension. Embed a probe string with the deployment you'll actually use and take the length.

The search models also come in pairs, such as `text-search-curie-doc-001` for documents and `text-search-curie-query-001` for queries. Use the doc model at ingestion and the query model at search time, and deploy both. And plan to re-embed and rebuild the index when ada-002 arrives, which is why the source text has to live somewhere you control.

## Creating the index

This uses `pinecone-client` 2.1.0 (released [3 January](https://pypi.org/project/pinecone-client/2.1.0/)) and `openai` 0.26.1, the same pins as my [Azure OpenAI Python SDK post](/blog/2023-01-18-azure-openai-python-sdk/). Install them with `pip install "pinecone-client==2.1.0" "openai==0.26.1"`.

```python
import os

import openai
import pinecone

openai.api_type = "azure"
openai.api_base = "https://<your-resource-name>.openai.azure.com/"
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

DOC_DEPLOYMENT = "<your-doc-embedding-deployment>"      # e.g. text-search-curie-doc-001
QUERY_DEPLOYMENT = "<your-query-embedding-deployment>"  # the matching -query-001 model

pinecone.init(
    api_key=os.environ["PINECONE_API_KEY"],
    environment="<your-pinecone-environment>",  # e.g. us-west1-gcp
)

INDEX_NAME = "company-docs"


def embed(text: str, deployment: str) -> list:
    # Azure OpenAI: one input per request for now.
    response = openai.Embedding.create(engine=deployment, input=text)
    return response["data"][0]["embedding"]


if INDEX_NAME not in pinecone.list_indexes():
    dimension = len(embed("dimension probe", DOC_DEPLOYMENT))
    pinecone.create_index(
        name=INDEX_NAME,
        dimension=dimension,
        metric="cosine",
        pods=1,
        pod_type="p1.x1",
        metadata_config={"indexed": ["source", "category", "updated"]},
    )

index = pinecone.Index(INDEX_NAME)
print(index.describe_index_stats())
```

Two choices in there deserve a sentence each. **Cosine** is the right metric for OpenAI embeddings, and the metric can't be changed later. **`metadata_config`** tells Pinecone which metadata fields to index for filtering. By default every field is indexed, which includes the chunk text you store for display. Free text is about as high-cardinality as metadata gets, and indexing it uses pod memory you'd rather spend on vectors. List the fields you filter on, and the rest are stored but not indexed.

## Namespaces versus metadata filters

Pinecone gives you two ways to partition data inside one index, and they solve different problems.

A **namespace** is a hard partition. A query runs against exactly one namespace and can't see the others, so it's the natural boundary for tenants: one namespace per customer means a bug in your filter-building code can't leak another customer's documents. The cost is that you can't search across namespaces in one call.

A **metadata filter** is a soft partition within a namespace. Pinecone supports a [MongoDB-style subset](https://docs.pinecone.io/guides/search/filter-by-metadata): `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, plus `$and` and `$or`. Use it for the facets a user picks (product area, document type, recency), and keep metadata small. Pinecone caps it at 40 KB per vector (see the [limits page](https://docs.pinecone.io/reference/api/database-limits)).

I'd use namespaces for anything that's a security boundary and filters for anything that's a user preference. Don't put a tenant ID in a filter and hope every code path remembers to add it.

## Ingestion that can safely run twice

The ingestion job will be re-run: after a failure, after a document changes, after you switch embedding models. Design for that from the start by deriving vector IDs from the source and chunk position, so a re-run overwrites rather than duplicates. Splitting text into chunks is its own topic. Here the chunks arrive ready-made. The code continues from the setup block above (same session or module), so `index`, `embed` and the deployment names are already defined.

```python
import hashlib
from typing import List


def chunk_id(source: str, position: int) -> str:
    return hashlib.sha1(f"{source}#{position}".encode("utf-8")).hexdigest()


def batch_size_for(dimension: int, request_budget: int = 1_000_000) -> int:
    # Pinecone caps an upsert request at 2 MB. pinecone.Index is the REST client,
    # so vectors travel as JSON: budget ~20 bytes per value (a float written out
    # as text) plus ~4 KB per vector for the id and metadata, and use half the cap.
    per_vector = dimension * 20 + 4_000
    return max(1, min(100, request_budget // per_vector))


def ingest(source: str, chunks: List[str], category: str, updated: int, namespace: str) -> None:
    if not chunks:
        # An empty document would otherwise delete everything for this source.
        raise ValueError(f"No chunks for {source}; refusing to wipe its vectors.")
    # Embed everything first, so a failed embedding call leaves the index untouched.
    vectors = [
        (
            chunk_id(source, position),
            embed(text, DOC_DEPLOYMENT),
            {"source": source, "category": category, "updated": updated, "text": text},
        )
        for position, text in enumerate(chunks)
    ]
    # Remove chunks left over from an older, longer version of this document.
    index.delete(filter={"source": {"$eq": source}}, namespace=namespace)
    index.upsert(
        vectors=vectors,
        namespace=namespace,
        batch_size=batch_size_for(len(vectors[0][1])),
        show_progress=False,  # the default draws a tqdm bar, which clutters job logs
    )


ingest(
    source="handbook/leave-policy.md",
    chunks=[
        "Annual leave accrues at four weeks per year for full-time staff.",
        "Leave requests longer than two weeks need manager approval a month ahead.",
    ],
    category="hr",
    updated=20230115,
    namespace="<tenant-id>",
)
```

The delete-then-upsert sequence leaves a short window where the document returns no results, and the two calls aren't atomic. If the job dies after the delete and before the upsert finishes, the document stays missing until the next successful run, so treat any failure as "re-run this document", not "log and move on". For an internal handbook that's acceptable. For anything user-facing I'd flip the order: upsert first, then track how many chunks each document had last time and delete only the surplus IDs. A crash then leaves a few stale chunks rather than a hole.

The `batch_size` argument is new in 2.1.0 and splits a large list into multiple requests for you. It also turns on a tqdm progress bar by default, which is why the code passes `show_progress=False` for a scheduled job. Don't hard-code the batch size. Pinecone [caps an upsert request at 2 MB](https://docs.pinecone.io/reference/api/database-limits), and the size that counts is what goes over the wire. `pinecone.Index` sends JSON, where each float is written out as 12 to 20 characters, so a 1,536-dimension vector is roughly 20 to 30 KB before its id and metadata, not the 6 KB its float32 values would take in memory. A batch of 100 at that size is already over the cap. `batch_size_for` works out to about 40 vectors per batch at 1,024 dimensions, about 30 at 1,536, about 10 at curie's 4,096 and 4 at davinci's 12,288, which keeps each request near 1 MB. The client also ships a `pinecone.GRPCIndex` that sends binary floats at 4 bytes each, but that needs the gRPC extras installed and is worth it only when upsert throughput is the bottleneck.

In this code the slow part is Azure OpenAI, not Pinecone. With one input per embedding call, a large corpus means thousands of requests against your deployment's rate limit, so wrap `embed` in the retry-with-backoff logic from my [rate limiting post](/blog/2023-01-10-rate-limiting-azure-openai/) before you point it at real data.

## Querying

```python
from typing import List, Optional, Tuple


def search(query: str, namespace: str, category: Optional[str] = None,
           top_k: int = 5) -> List[Tuple[str, float, str]]:
    metadata_filter = {"category": {"$eq": category}} if category else None
    result = index.query(
        vector=embed(query, QUERY_DEPLOYMENT),
        top_k=top_k,
        namespace=namespace,
        filter=metadata_filter,
        include_metadata=True,
    )
    return [(m.metadata["source"], m.score, m.metadata["text"]) for m in result.matches]


for source, score, text in search("how much annual leave do I get", "<tenant-id>", category="hr"):
    print(f"{score:.3f}  {source}  {text}")
```

With cosine, higher scores mean closer matches. What counts as a "good" score depends on the model and your content, and changes when you switch models, so don't pick a relevance cutoff by eye. Calibrate it against a few dozen labelled queries from your own content, the way I described in the [semantic search prototype](/blog/2023-01-24-semantic-search-embeddings/).

## When I wouldn't reach for Pinecone

- **Data residency matters.** Pinecone runs in a small set of GCP and AWS regions, none of them in Australia. For a lot of Australian government and financial services work, sending document text (which you're storing as metadata) to a US-hosted third party is a non-starter, whatever the vectors look like.
- **The corpus is small.** Under a few hundred thousand vectors, brute-force search in NumPy or FAISS on your own compute is fast enough and costs nothing extra.
- **You need keyword and vector ranking together.** Pinecone [announced hybrid sparse-dense search](https://www.pinecone.io/blog/hybrid-search/) late last year, but it's still early access, so plan on vector-only queries today.
- **You'd rather stay inside Azure.** The Azure-resident option today is Redis Enterprise, whose RediSearch module added vector similarity search in 2022 and is available as a module on the Enterprise tiers of Azure Cache for Redis (check which RediSearch version your cache runs). Azure Cognitive Search has no vector support yet, only keyword and semantic ranking, and pgvector on a Postgres server you manage yourself is the other route.
- **Your security review takes longer than the project.** A new SaaS vendor means a new contract, a new data processing assessment and a new API key to rotate. Sometimes that's quicker than building, and sometimes it's the slowest step.

The free Starter plan is fine for working through all of this. It gives you a single small index, and Pinecone may delete Starter indexes that sit idle, so don't keep anything there you can't rebuild.

## The short version

Decide four things before the first upsert: the embedding deployment (and so the dimension), the metric, the pod type and size, and whether tenants get namespaces. Index only the metadata you filter on, derive IDs from the source so re-runs are safe, and keep the original text outside Pinecone so moving to ada-002 is a batch job rather than a migration. If those decisions feel premature, that's a sign the prototype stage isn't over yet.
