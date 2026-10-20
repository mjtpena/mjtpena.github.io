---
title: "Weaviate 1.17 with Azure OpenAI: Bring Your Own Vectors"
description: "Run Weaviate 1.17 with embeddings from Azure OpenAI: schema choices, batch imports, filtered vector search, BM25 and the hybrid search caveats to know first."
author: Michael John Peña
draft: false
date: 2023-01-27
tags:
  - Weaviate
  - Vector Database
  - Azure OpenAI
  - Embeddings
  - Python
---

Weaviate is the open source vector database I'd look at first when a team wants filtering, keyword search and vector search in one engine they can run themselves. The catch for Azure shops is that its built-in OpenAI vectorizer talks to OpenAI, not to your Azure OpenAI resource. That makes the setup decision for you: generate embeddings yourself and hand Weaviate the vectors. Here's that pattern on Weaviate 1.17, plus the places the newest features still have rough edges.

If you're still deciding whether you need a vector database at all, start with [the ANN indexes and trade-offs post](/blog/2023-01-25-vector-databases-intro/). For a managed alternative, see [the Pinecone getting started guide](/blog/2023-01-26-pinecone-basics/).

## What Weaviate 1.17 gives you

[Weaviate 1.17](https://github.com/weaviate/weaviate/releases/tag/v1.17.0), released on 20 December 2022, is the version that makes it worth a fresh look. It added three things:

- **BM25 and BM25F keyword search** over the inverted index, with no vectors involved.
- **Hybrid search**, which runs a BM25 query and a vector query and merges the two ranked lists with reciprocal rank fusion.
- **Leaderless replication** with tunable consistency, set per class with a replication factor.

Patch releases have followed quickly. 1.17.2 shipped on 26 January, and that's the image used below. The Python client is `weaviate-client` 3.11.0, released on 20 January. You can self-host with Docker or Kubernetes, or use the managed Weaviate Cloud Services.

BM25, hybrid search and replication all arrived in 1.17, so they have had about five weeks of real-world use. I'd treat hybrid search as something to evaluate, not something to bet a launch on, for reasons covered further down.

## Why bring your own vectors

Weaviate has vectorizer modules such as `text2vec-openai`, `text2vec-cohere` and `text2vec-transformers`. With one of those enabled, Weaviate calls the model on import and at query time, and you send it text. That's convenient, but in 1.17 the OpenAI module calls the OpenAI API directly. There's no setting for an Azure OpenAI endpoint or deployment name.

For most Azure organisations, that settles it. The data has to stay inside the Azure tenancy and go through the Azure OpenAI resource that security already approved. So you set `"vectorizer": "none"` on the class, call Azure OpenAI yourself, and pass the vector with every object and every query.

Bringing your own vectors has real advantages beyond compliance:

- **You control the model version.** Vectors from different models aren't comparable. When the embedding model is your code, a model change is a deliberate re-index, not a surprise.
- **You can cache and reuse embeddings.** The same vectors can feed another store or an evaluation notebook.
- **Failures are easier to see.** A throttled embedding call fails in your pipeline, where you can retry it, not halfway through a Weaviate batch.

The cost is that every caller needs the embedding step, including the query path. Put it in one shared function, as below, so the document side and query side can't drift apart.

## Running Weaviate locally

Weaviate is configured through environment variables. This Compose file runs a single node with no vectorizer module, anonymous access and a named volume for data.

```yaml
version: "3.4"
services:
  weaviate:
    image: semitechnologies/weaviate:1.17.2
    ports:
      - "8080:8080"
    restart: on-failure:0
    environment:
      QUERY_DEFAULTS_LIMIT: 25
      AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED: "true"
      PERSISTENCE_DATA_PATH: "/var/lib/weaviate"
      DEFAULT_VECTORIZER_MODULE: "none"
      CLUSTER_HOSTNAME: "node1"
    volumes:
      - weaviate_data:/var/lib/weaviate
volumes:
  weaviate_data:
```

Pin the image tag. `latest` is how a laptop demo quietly ends up on a different version from the cluster it's meant to match. Anonymous access is for a laptop only. Turn it off and configure OIDC authentication before anything else touches it.

Start the container and install the two pinned libraries the script below uses:

```bash
docker compose up -d
pip install "weaviate-client==3.11.0" "openai==0.26.4"
```

## Schema: decide how each property is searched

Weaviate's schema tells it which index each property goes into and how text is tokenised. That matters more than it looks, because it decides whether filters and keyword search behave as you expect.

The code blocks from here on form one script, `weaviate_demo.py`, in order. The embedding setup uses the `openai` 0.26 library with API version `2022-12-01`, as in [the Azure OpenAI Python setup post](/blog/2023-01-18-azure-openai-python-sdk/).

```python
import os
import time
from typing import Any, Dict, List, Optional

import openai
import weaviate
from weaviate.util import generate_uuid5

openai.api_type = "azure"
openai.api_base = "https://<your-resource-name>.openai.azure.com/"
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

EMBEDDING_DEPLOYMENT = "<your-embedding-deployment>"
CLASS_NAME = "Document"

client = weaviate.Client("http://localhost:8080")
assert client.is_ready(), "Weaviate is not ready"


def embed(text: str, max_attempts: int = 5) -> List[float]:
    """One input per call, with exponential back-off when the deployment returns 429."""
    for attempt in range(max_attempts):
        try:
            response = openai.Embedding.create(engine=EMBEDDING_DEPLOYMENT, input=text)
            return response["data"][0]["embedding"]
        except openai.error.RateLimitError:
            if attempt == max_attempts - 1:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


def run(builder) -> List[Dict]:
    """Execute a Get query and raise on GraphQL errors instead of returning them."""
    result = builder.do()
    if "errors" in result:
        raise RuntimeError(result["errors"])
    return result["data"]["Get"][CLASS_NAME]


document_class = {
    "class": CLASS_NAME,
    "description": "A chunk of internal documentation",
    "vectorizer": "none",
    "vectorIndexConfig": {"distance": "cosine"},
    "properties": [
        {"name": "title", "dataType": ["string"]},
        {"name": "content", "dataType": ["text"]},
        {"name": "category", "dataType": ["string"], "tokenization": "field"},
        {"name": "tags", "dataType": ["string[]"], "tokenization": "field"},
        {"name": "sourceId", "dataType": ["string"], "tokenization": "field"},
    ],
}

existing = [c["class"] for c in client.schema.get().get("classes", [])]
if CLASS_NAME not in existing:
    client.schema.create_class(document_class)
```

The decisions in that schema:

- **`text` for prose, `string` for labels.** `text` is always tokenised into words, which is what BM25 needs on body content. `string` lets you choose.
- **`tokenization: field` for anything you filter on exactly.** With the default `word` tokenisation, a category of `"data platform"` is indexed as two tokens and an `Equal` filter matches on words. `field` keeps the whole value as one token, so `Equal` means equal.
- **Cosine distance** is the default, and it suits OpenAI embeddings. It's set explicitly here so nobody has to look it up.

Changing tokenisation or data types later means recreating the class and re-importing. Get this right before you load a million objects.

## Importing with deterministic IDs

```python
def import_chunks(chunks: List[Dict[str, Any]]) -> None:
    failures: List[Dict] = []

    def collect_errors(results: Optional[List[Dict]]) -> None:
        for item in results or []:
            errors = item.get("result", {}).get("errors")
            if errors:
                failures.append({"id": item.get("id"), "errors": errors})

    client.batch.configure(batch_size=50, dynamic=True, callback=collect_errors)
    with client.batch as batch:
        for chunk in chunks:
            batch.add_data_object(
                data_object=chunk,
                class_name=CLASS_NAME,
                uuid=generate_uuid5(chunk["sourceId"]),
                vector=embed(chunk["content"]),
            )
    if failures:
        raise RuntimeError(f"{len(failures)} objects failed to import: {failures[:3]}")


import_chunks([
    {
        "title": "Azure Functions hosting plans",
        "content": "The Consumption plan scales out automatically and bills per execution.",
        "category": "compute",
        "tags": ["serverless", "functions"],
        "sourceId": "kb-0001#0",
    },
    {
        "title": "Choosing a Cosmos DB API",
        "content": "Cosmos DB offers the SQL API alongside MongoDB, Cassandra, Gremlin and Table APIs.",
        "category": "database",
        "tags": ["nosql", "cosmos-db"],
        "sourceId": "kb-0002#0",
    },
])

count = client.query.aggregate(CLASS_NAME).with_meta_count().do()
print("objects:", count["data"]["Aggregate"][CLASS_NAME][0]["meta"]["count"])
```

Two choices here are worth copying.

**Derive the UUID from your own source key.** `generate_uuid5` turns `kb-0001#0` into the same UUID every time. Re-running the import replaces objects instead of duplicating them, and deleting a source document means deleting known IDs.

**Use the client's batching, and make it fail loudly.** The context manager sends objects in batches and flushes the rest on exit, and `dynamic=True` lets the client adjust batch size to how fast Weaviate responds. What it doesn't do by default is raise. In client 3.x the default callback, `check_batch_result`, prints per-object errors and carries on, so an import where every object was rejected can still look like it worked. The `collect_errors` callback gathers those errors, and the function raises once the context manager has flushed the last batch.

**Check the count.** The `Aggregate` query with `with_meta_count()` is the cheapest way to confirm the objects landed. Add `.with_where(...)` to the same builder and you can also check that a filter matches the number of objects you expect before you trust it in a search.

Embedding inline, one object at a time, is fine for a demo like this one. In this pipeline the slow part is Azure OpenAI, not Weaviate. Each `embed` call is one HTTP request against your deployment's rate limit, and the back-off in `embed` only absorbs short bursts of HTTP 429. At real volume, embed in a separate step, store the vectors, then import, so a throttled run doesn't hold a Weaviate batch open.

## Three ways to query

### Vector search with filters

```python
def vector_search(query: str, where: Optional[Dict] = None, limit: int = 5) -> List[Dict]:
    builder = (
        client.query
        .get(CLASS_NAME, ["title", "category", "sourceId"])
        .with_near_vector({"vector": embed(query)})
        .with_limit(limit)
        .with_additional(["distance"])
    )
    if where:
        builder = builder.with_where(where)
    return run(builder)


compute_only = {"path": ["category"], "operator": "Equal", "valueString": "compute"}
for hit in vector_search("how does serverless billing work", where=compute_only):
    print(round(hit["_additional"]["distance"], 4), hit["title"])
```

Filters are where Weaviate earns its place over a library like FAISS. The `where` filter is applied during the vector search, not by throwing away results afterwards, so a narrow filter doesn't leave you with two hits out of the five you asked for. Filters combine with `And` and `Or` operands, and on a `string[]` property `Equal` matches any object whose array contains that value. Check for an `errors` key on every response, which is why all three query functions go through `run`. A misspelled property comes back as a GraphQL error in the payload, not as a Python exception.

### BM25 keyword search

```python
def keyword_search(query: str, limit: int = 5) -> List[Dict]:
    return run(
        client.query
        .get(CLASS_NAME, ["title", "sourceId"])
        .with_bm25(query=query, properties=["title", "content"])
        .with_limit(limit)
        .with_additional(["score"])
    )


print(keyword_search("Cassandra Gremlin"))
```

Don't skip this because you have embeddings. Product names, error codes and ticket numbers are exactly where vector search is weakest. BM25 uses the usual defaults, `k1` of 1.2 and `b` of 0.75, which you can override per class under `invertedIndexConfig`.

### Hybrid search

```python
def hybrid_search(query: str, alpha: float = 0.75, limit: int = 5) -> List[Dict]:
    return run(
        client.query
        .get(CLASS_NAME, ["title", "sourceId"])
        .with_hybrid(query=query, alpha=alpha, vector=embed(query))
        .with_limit(limit)
    )


print(hybrid_search("Functions consumption plan pricing", alpha=0.5))
```

`alpha` sets the weighting: 0 is pure BM25, 1 is pure vector, and the default is 0.75. Weaviate's [hybrid search documentation](https://weaviate.io/developers/weaviate/search/hybrid) covers the parameter and the BM25 settings it builds on. Because we brought our own vectors, the query vector must be passed explicitly. Without a vectorizer module, Weaviate has nothing to turn the query text into a vector.

Two caveats before you rely on it. First, the fusion is rank-based, so the merged ordering says nothing about absolute relevance. Don't build a "minimum score" threshold on it. Second, in [the 1.17.2 query code](https://github.com/weaviate/weaviate/blob/v1.17.2/usecases/traverser/explorer.go) the vector half of a hybrid query runs without the `where` filter. Only the BM25 half applies it. Until that changes, keep filtered queries on `with_near_vector` or `with_bm25` and keep hybrid for unfiltered search. Test any filtered hybrid query against your own data before trusting it.

## When Weaviate is the wrong choice

| Situation | What I'd do instead |
|---|---|
| Under a few hundred thousand chunks and one service reading them | NumPy or FAISS in-process, as in [the semantic search prototype](/blog/2023-01-24-semantic-search-embeddings/) |
| You already run PostgreSQL and need row-level security on results | pgvector, so access control stays in the database you already govern |
| No one on the team can own a stateful service | A managed service, either Weaviate Cloud Services or Pinecone |
| You want Weaviate to vectorise through Azure OpenAI | Not available in 1.17. Bring your own vectors, as above |

Self-hosting means you also own upgrades, backups (the `backup-filesystem`, `backup-s3` and `backup-gcs` modules) and capacity planning for an HNSW index that lives in memory. That's fine for a platform team. It's a poor trade for a single application team that just wants search to work.

## The decision

Use Weaviate when you need vector search, structured filters and keyword search in one engine and you're willing to run it. On Azure, set the vectorizer to `none`, own the embedding call, pin the image and client versions, and design the schema around how each property will be filtered. Adopt BM25 now, because it fills the biggest gap in pure vector search. Evaluate hybrid search on unfiltered queries with a labelled query set, and wait for filtering to apply to both halves before putting it behind a production search box. Microsoft's [embeddings concept page](https://learn.microsoft.com/azure/ai-services/openai/concepts/understand-embeddings) is the reference for the model side, and the [`weaviate-client` 3.11.0 release](https://pypi.org/project/weaviate-client/3.11.0/) for the client used here.
