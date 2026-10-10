---
title: "Azure AI Search After Ignite 2023: What's GA and What's Still Preview"
description: "A January 2024 stock-take of Azure AI Search for RAG: which features are GA, which are preview, and which SDK and REST versions to build on."
author: Michael John Peña
draft: false
date: 2024-01-23
tags:
  - Azure AI Search
  - Vector Search
  - RAG
  - Semantic Search
  - Azure
---

Ignite 2023 changed a lot about Azure Cognitive Search in one go: it got a new name, vector search and semantic ranking went GA, and a set of RAG-focused features arrived in preview. Two months on, the hard part is not knowing what exists. It's knowing which pieces you can put in front of production traffic and which SDK or API version you need to reach each one. This is my stock-take of where things stand at the end of January 2024.

## The rename is cosmetic, the API versions are not

On 15 November 2023 Azure Cognitive Search became **Azure AI Search**. Nothing changes for existing services: the endpoint is still `https://<your-search-service>.search.windows.net`, the SKUs are the same, and the Python package is still `azure-search-documents`. Update your diagrams and move on.

What matters is that the platform now has two API tracks you need to care about:

| Track | REST API version | Python SDK | What you get |
|---|---|---|---|
| GA | `2023-11-01` | `azure-search-documents` 11.4.0 | Vector search (HNSW and exhaustive KNN), vector prefiltering, hybrid queries, semantic ranker |
| Preview | `2023-10-01-Preview` | 11.4.0 betas (up to 11.4.0b11) | Everything above, plus integrated vectorization (vectorizers and the Azure OpenAI Embedding skill), index projections, Split skill overlap |

Microsoft's [2023 What's new archive](https://learn.microsoft.com/en-us/previous-versions/azure/search/search-whats-new-2023) lists these under November 2023. The catch is in the 11.4.0 changelog: the GA SDK deliberately leaves out `AzureOpenAIEmbeddingSkill`, `AzureOpenAIParameters` and `AzureOpenAIVectorizer`, because those are preview-only. If you want integrated vectorization from Python today, you're either pinned to a beta with older, pre-GA class names, or you call the REST API directly. I prefer the second option for the indexing side. Index and skillset definitions are infrastructure, they belong in source control as JSON anyway, and it keeps preview surface area out of the application code that runs at query time.

## What's GA and safe to build on

### Vector search

Vector search left preview with the `2023-11-01` API. Prefiltering and exhaustive KNN are GA too.

If you built against the `2023-07-01-Preview` shape, expect to rewrite. `vectorSearchConfiguration` on a field became `vectorSearchProfile`, algorithms and profiles are now separate objects, and in Python `vectors=` became `vector_queries=` with `VectorizedQuery`. Those renames are mechanical but they will break every index definition and query you wrote last year. Do the migration now rather than carrying a preview API version into production.

### Semantic ranker

Semantic ranking is also GA. It re-scores the top 50 results from your initial query with a language model built for ranking and can return extractive captions and answers. The [semantic ranking overview](https://learn.microsoft.com/en-us/azure/search/semantic-search-overview) covers the mechanics, and I go deeper on configuration in [the semantic ranker deep dive](/blog/2024-01-25-semantic-ranker/).

My position: for RAG, hybrid retrieval plus semantic ranker should be the default, not an optimisation you add later. Microsoft's [published relevance benchmarks](https://techcommunity.microsoft.com/t5/azure-ai-services-blog/azure-cognitive-search-outperforming-vector-search-with-hybrid/ba-p/3929167) show hybrid retrieval with semantic reranking beating pure vector retrieval, and that matches what I'd expect from first principles. Embeddings are good at paraphrase and poor at exact identifiers. BM25 is the opposite. Reciprocal Rank Fusion merges the two lists ([how RRF scoring works](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking)), and the semantic ranker then puts the genuinely best chunks at the top, which is what your prompt's limited context window actually needs.

Here is a hybrid plus semantic query against the GA API with the 11.4.0 SDK. The query embedding comes from your own Azure OpenAI call, which keeps the query path entirely on GA components:

```python
import os

from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery
from openai import AzureOpenAI

openai_client = AzureOpenAI(
    azure_endpoint="https://<your-openai-resource>.openai.azure.com",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version="2023-05-15",
)

search_client = SearchClient(
    endpoint="https://<your-search-service>.search.windows.net",
    index_name="docs-chunks",
    credential=AzureKeyCredential(os.environ["AZURE_SEARCH_QUERY_KEY"]),
)


def retrieve(question: str, top: int = 5) -> list[dict]:
    embedding = openai_client.embeddings.create(
        model="<your-embedding-deployment>",
        input=question,
    ).data[0].embedding

    results = search_client.search(
        search_text=question,
        vector_queries=[
            VectorizedQuery(
                vector=embedding,
                k_nearest_neighbors=50,
                fields="chunk_vector",
            )
        ],
        query_type="semantic",
        semantic_configuration_name="default",
        query_caption="extractive",
        select=["chunk_id", "title", "chunk"],
        top=top,
    )

    return [
        {
            "chunk_id": r["chunk_id"],
            "title": r["title"],
            "chunk": r["chunk"],
            "reranker_score": r.get("@search.reranker_score") or 0.0,
        }
        for r in results
    ]


if __name__ == "__main__":
    for hit in retrieve("How do I rotate the storage account keys?"):
        print(f"{hit['reranker_score']:.2f}  {hit['title']}")
```

Two details are deliberate. `k_nearest_neighbors=50` gives RRF and the semantic ranker a full candidate pool even though only five chunks go to the model. And I return `@search.reranker_score` because it's on a fixed scale (0 to 4), which makes it usable as a relevance cut-off. The RRF `@search.score` is not comparable across queries, so don't threshold on it. A missing reranker score (which the code above turns into 0.0) means semantic ranking didn't run for that request, for example because the free plan's monthly quota ran out and the service fell back to the RRF results.

When not to turn on the semantic ranker: high-volume, low-value queries such as autocomplete or catalogue filtering, where the extra latency and the per-request billing on the Standard plan buy you nothing. Check the semantic ranker pricing for your region before you make it the default for every query.

## What's preview, and how much I'd lean on it

### Integrated vectorization

Integrated vectorization is the biggest change for RAG builders. A skillset can now chunk documents with the Split skill, call your Azure OpenAI embedding deployment through the Azure OpenAI Embedding skill, and write the vectors into the index. A vectorizer on the index means queries can send text and let the service embed it. The [integrated vectorization concept page](https://learn.microsoft.com/en-us/azure/search/vector-search-integrated-vectorization) has the full picture, and [my follow-up post](/blog/2024-01-24-integrated-vectorization/) walks through a build.

The index side, using the preview REST API, looks like this:

```json
{
  "name": "docs-chunks",
  "fields": [
    { "name": "chunk_id", "type": "Edm.String", "key": true, "searchable": true, "analyzer": "keyword" },
    { "name": "parent_id", "type": "Edm.String", "filterable": true },
    { "name": "title", "type": "Edm.String", "searchable": true },
    { "name": "chunk", "type": "Edm.String", "searchable": true },
    {
      "name": "chunk_vector",
      "type": "Collection(Edm.Single)",
      "searchable": true,
      "dimensions": 1536,
      "vectorSearchProfile": "aoai-profile"
    }
  ],
  "vectorSearch": {
    "algorithms": [
      { "name": "hnsw-default", "kind": "hnsw", "hnswParameters": { "metric": "cosine" } }
    ],
    "profiles": [
      { "name": "aoai-profile", "algorithm": "hnsw-default", "vectorizer": "aoai-vectorizer" }
    ],
    "vectorizers": [
      {
        "name": "aoai-vectorizer",
        "kind": "azureOpenAI",
        "azureOpenAIParameters": {
          "resourceUri": "https://<your-openai-resource>.openai.azure.com",
          "deploymentId": "<your-embedding-deployment>",
          "apiKey": "<your-openai-key>"
        }
      }
    ]
  },
  "semantic": {
    "configurations": [
      {
        "name": "default",
        "prioritizedFields": {
          "titleField": { "fieldName": "title" },
          "prioritizedContentFields": [ { "fieldName": "chunk" } ]
        }
      }
    ]
  }
}
```

Send it with `PUT https://<your-search-service>.search.windows.net/indexes/docs-chunks?api-version=2023-10-01-Preview`. The 1536 dimensions match `text-embedding-ada-002`, which is the embedding model most teams are on right now.

Would I put this in production? For an internal knowledge assistant where an indexing failure means stale answers for a few hours, yes, with the API version pinned and a rebuild script ready. For anything customer-facing with an SLA, I'd keep chunking and embedding in my own pipeline (an Azure Function or a Durable Functions fan-out) and push documents to the GA API. Preview features have no SLA and the property names can still move, as everyone who built on `2023-07-01-Preview` has just learned.

### Index projections

The Split skill produces many chunks per document, but historically the index stored one search document per source document, which is useless for retrieval. Index projections fix that by mapping each chunk to its own search document with a pointer back to the parent. The [index projections overview](https://learn.microsoft.com/en-us/azure/search/search-how-to-define-index-projections) explains the rules, and [the index projections post](/blog/2024-01-29-index-projections/) covers the edge cases.

Projections live on the skillset, not the indexer:

```json
{
  "name": "docs-chunking",
  "skills": [
    {
      "@odata.type": "#Microsoft.Skills.Text.SplitSkill",
      "name": "split",
      "context": "/document",
      "textSplitMode": "pages",
      "maximumPageLength": 2000,
      "pageOverlapLength": 500,
      "inputs": [ { "name": "text", "source": "/document/content" } ],
      "outputs": [ { "name": "textItems", "targetName": "pages" } ]
    },
    {
      "@odata.type": "#Microsoft.Skills.Text.AzureOpenAIEmbeddingSkill",
      "name": "embed",
      "context": "/document/pages/*",
      "resourceUri": "https://<your-openai-resource>.openai.azure.com",
      "deploymentId": "<your-embedding-deployment>",
      "apiKey": "<your-openai-key>",
      "inputs": [ { "name": "text", "source": "/document/pages/*" } ],
      "outputs": [ { "name": "embedding", "targetName": "vector" } ]
    }
  ],
  "indexProjections": {
    "selectors": [
      {
        "targetIndexName": "docs-chunks",
        "parentKeyFieldName": "parent_id",
        "sourceContext": "/document/pages/*",
        "mappings": [
          { "name": "chunk", "source": "/document/pages/*" },
          { "name": "chunk_vector", "source": "/document/pages/*/vector" },
          { "name": "title", "source": "/document/metadata_storage_name" }
        ]
      }
    ],
    "parameters": { "projectionMode": "skipIndexingParentDocuments" }
  }
}
```

`maximumPageLength` is measured in characters, so 2,000 characters with a 500-character overlap is roughly 400 to 500 tokens per chunk. That's a reasonable starting point for ada-002, not a universal answer. Tune it against real questions. `skipIndexingParentDocuments` stops the unchunked parent from landing in the index alongside its chunks, which you almost always want for RAG.

The portal's **Import and vectorize data** wizard (also preview) generates all of this for you. Use it to get a working baseline, then export the JSON and own it in source control.

## Index size: the constraint nobody mentions

The limit that bites RAG projects first is not document count or storage. It's vector index size. HNSW graphs have to sit in memory, so the service enforces a separate vector quota per partition, and indexing fails once you hit it. For services created from July 2023 onwards, the [published vector index size limits](https://learn.microsoft.com/en-us/azure/search/search-limits-quotas-capacity#vector-index-size-limits) are:

| Tier | Vector quota per partition |
|---|---|
| Basic | 1 GB |
| S1 | 3 GB |
| S2 | 12 GB |
| S3 | 36 GB |
| L1 | 12 GB |
| L2 | 36 GB |

Services created before July 2023 have lower limits (S1 is 1 GB), and there's no in-place upgrade, so check your service's creation date before you plan capacity on an old one.

Do the arithmetic early. A 1536-dimension ada-002 vector stored as 32-bit floats is about 6 KB before HNSW overhead, so a single S1 partition holds a few hundred thousand chunks at most. Chunk overlap multiplies that count. Neither API version offers vector compression or quantization today, so your levers are the tier, the partition count, how many chunks you create, and what you choose to index at all. Exhaustive KNN fields don't count against the quota, which is a fair trade for small, filtered corpora but not for anything that needs low latency at scale. Smaller chunks of the right content beat bigger indexes of everything. I cover the operational side in [index management](/blog/2024-01-28-search-index-management/).

## Where I'd land in January 2024

- **Query path:** GA only. `2023-11-01`, SDK 11.4.0, hybrid plus semantic ranker, with your own query-time embedding call.
- **Indexing path:** integrated vectorization and index projections on `2023-10-01-Preview` if the workload can tolerate preview; a custom chunk-and-embed pipeline pushing to the GA API if it can't.
- **Migrations:** anything still on `2023-07-01-Preview` should move now. The renames are tedious, not hard.

That split, GA at query time and preview only where a failure is recoverable, gets you most of the value of the Ignite releases without staking production on API shapes that haven't settled. For how this fits into a full RAG design, my earlier [RAG pattern post](/blog/2023-03-03-rag-pattern-azure-cognitive-search/) still holds; only the names and the plumbing have improved.
