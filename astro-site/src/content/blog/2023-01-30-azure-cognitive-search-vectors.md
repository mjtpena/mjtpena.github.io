---
title: "Azure Cognitive Search and Embeddings Before Native Vector Search"
description: "Azure Cognitive Search can't search vectors in January 2023. Here's how to re-rank its keyword results with Azure OpenAI embeddings, and when not to bother."
author: Michael John Peña
draft: false
date: 2023-01-30
tags:
  - Azure
  - Cognitive Search
  - Azure OpenAI
  - Embeddings
  - Vector Search
---

If you already run Azure Cognitive Search, the obvious question after a week of embedding experiments is whether you can just put your vectors in the index you have. As of January 2023 the answer is no. Cognitive Search has no vector field type and no nearest-neighbour query, and Microsoft hasn't announced a preview. What you can do is use the index you already trust to find candidates and use Azure OpenAI embeddings to order them. That gets you most of the relevance gain without adding a second datastore, as long as you understand where it breaks.

## What Cognitive Search does and doesn't do today

It's worth being precise, because "semantic" is overloaded right now.

| Capability | Status in January 2023 | What it actually does |
|---|---|---|
| Full-text search (BM25) | GA | Keyword matching with analysers, filters, facets, scoring profiles and synonym maps |
| [Semantic search](https://learn.microsoft.com/azure/search/semantic-search-overview) | Public preview, with Free and Standard billing plans | Re-ranks the top keyword results using Microsoft's own language models, and adds captions and answers |
| Searching your own vectors | Not available | You can store a vector as a `Collection(Edm.Double)` field, but you can't query on similarity |

Semantic search is the closest thing to what people want, and I covered it in [an earlier post](/blog/2022-08-23-semantic-search-azure/). The catch is that it uses Microsoft's models, not yours. You can't feed it `text-embedding-ada-002` vectors. It needs a Standard tier service (S1 or higher), so it isn't available on Free or Basic, and the GA Python SDK (`azure-search-documents` 11.3.0) doesn't expose it. You need the 11.4.0 betas (11.4.0b2 at the time of writing) or the `2021-04-30-Preview` REST API, and for now captions and answers are easier to read from the REST response.

So if you want your own embeddings to influence ranking, the ranking has to happen in your code.

## The pattern: keyword recall, embedding precision

The design is a two-stage retriever, which is how most production search systems are built anyway:

1. **Recall stage.** Send the user's query to Cognitive Search as a normal full-text query, with whatever filters apply (security trimming, tenant, language). Ask for more results than you'll show, say 50.
2. **Precision stage.** Embed the query once with Azure OpenAI. Compare it with the stored embedding of each of the 50 candidates. Combine that similarity with the keyword rank and return the top 10.

The document embeddings are computed at indexing time and stored on each document in a retrievable `Collection(Edm.Double)` field. Cognitive Search treats that field as opaque data. It doesn't search it, and it just hands it back with the result.

Why I like this as a January 2023 answer:

- **No new infrastructure.** Your security filters, indexers, replicas and SLA already exist. A separate vector database means a second copy of your content, a second sync pipeline, and a second place to enforce document-level permissions. I made the broader version of that argument in [Do You Need a Vector Database Yet?](/blog/2023-01-25-vector-databases-intro/).
- **Filters stay exact.** Filtering happens in the recall stage on the server, before any similarity maths. Pre-filtering versus post-filtering is one of the hardest problems in ANN indexes, and this design sidesteps it.
- **Re-ranking 50 vectors is trivial.** It's a dot product over a 50 × 1,536 matrix. There's no index to tune.

## Building it

The code uses `azure-search-documents` 11.3.0 and the `openai` 0.26 Python library pointed at Azure OpenAI with API version `2022-12-01`, as set up in [the Python SDK post](/blog/2023-01-18-azure-openai-python-sdk/). It assumes you have an embeddings deployment. If you're new to how embeddings behave, Microsoft's [embeddings concepts page](https://learn.microsoft.com/azure/cognitive-services/openai/concepts/understand-embeddings) is a good short read. Use `text-embedding-ada-002` (1,536 dimensions) if your resource offers it. If it doesn't, the [embeddings introduction](/blog/2023-01-23-embeddings-introduction/) covers the first-generation `text-search-ada-doc-001` and `-query-001` pair (1,024 dimensions), which need two deployments.

```bash
pip install "azure-search-documents==11.3.0" "openai==0.26.4" numpy
```

### The index

The vector field is a `SimpleField` that is neither searchable nor filterable. It only needs to be retrievable.

```python
# create_index.py
import os

from azure.core.credentials import AzureKeyCredential
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchableField,
    SearchFieldDataType,
    SearchIndex,
    SimpleField,
)

endpoint = os.environ["SEARCH_ENDPOINT"]  # https://<your-search-service>.search.windows.net
admin_key = os.environ["SEARCH_ADMIN_KEY"]
index_name = "docs-rerank"

fields = [
    SimpleField(name="id", type=SearchFieldDataType.String, key=True),
    SearchableField(name="title", type=SearchFieldDataType.String),
    SearchableField(name="content", type=SearchFieldDataType.String),
    SimpleField(
        name="category",
        type=SearchFieldDataType.String,
        filterable=True,
        facetable=True,
    ),
    # Stored and returned, never searched. Cognitive Search can't query on it.
    SimpleField(
        name="contentVector",
        type=SearchFieldDataType.Collection(SearchFieldDataType.Double),
    ),
]

client = SearchIndexClient(endpoint, AzureKeyCredential(admin_key))
client.create_or_update_index(SearchIndex(name=index_name, fields=fields))
print(f"Index '{index_name}' is ready")
```

### Indexing with embeddings

Azure OpenAI takes one input per embeddings request at the moment, so this embeds one document at a time and backs off when the deployment returns HTTP 429. Each model also has an input token limit, so the code truncates long text to a character budget before embedding (a rough proxy for tokens; use `tiktoken` if you need it exact) and logs any document the service still rejects. Uploads go in batches of 100, because a single indexing request is capped at 1,000 documents and 16 MB, and vectors make each document heavy.

```python
# search_rerank.py
import os
import time

import numpy as np
import openai
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient

openai.api_type = "azure"
openai.api_base = os.environ["OPENAI_ENDPOINT"]  # https://<your-openai-resource>.openai.azure.com/
openai.api_version = "2022-12-01"
openai.api_key = os.environ["OPENAI_API_KEY"]
EMBEDDING_DEPLOYMENT = os.environ.get("EMBEDDING_DEPLOYMENT", "<your-embedding-deployment>")

search = SearchClient(
    os.environ["SEARCH_ENDPOINT"],
    "docs-rerank",
    AzureKeyCredential(os.environ["SEARCH_ADMIN_KEY"]),
)


# Roughly 4 characters per English token keeps input under a 2,046-token limit.
MAX_EMBED_CHARS = 6000
UPLOAD_BATCH_SIZE = 100


def embed(text, retries=5):
    text = text[:MAX_EMBED_CHARS]
    for attempt in range(retries):
        try:
            response = openai.Embedding.create(engine=EMBEDDING_DEPLOYMENT, input=text)
            return response["data"][0]["embedding"]
        except openai.error.RateLimitError:
            time.sleep(2 ** attempt)
    raise RuntimeError("Embedding request kept hitting the rate limit")


def index_documents(docs):
    batch = []
    for doc in docs:
        try:
            vector = embed(f"{doc['title']}\n{doc['content']}")
        except openai.error.InvalidRequestError as error:
            print(f"Skipping document {doc['id']}: {error}")
            continue
        batch.append({**doc, "contentVector": vector})

    failed = []
    for i in range(0, len(batch), UPLOAD_BATCH_SIZE):
        results = search.upload_documents(documents=batch[i : i + UPLOAD_BATCH_SIZE])
        failed.extend(r.key for r in results if not r.succeeded)
    if failed:
        raise RuntimeError(f"Failed to index: {failed}")


def search_rerank(query, top=10, candidates=50, odata_filter=None, rrf_k=60):
    # Stage 1: keyword recall, filtered on the server.
    hits = list(
        search.search(
            search_text=query,
            filter=odata_filter,
            top=candidates,
            select=["id", "title", "category", "contentVector"],
        )
    )
    if not hits:
        return []

    # Stage 2: cosine similarity between the query and each candidate.
    q = np.array(embed(query))
    q /= np.linalg.norm(q)
    matrix = np.array([hit["contentVector"] for hit in hits])
    matrix /= np.linalg.norm(matrix, axis=1, keepdims=True)
    cosine = matrix @ q

    # Reciprocal rank fusion: combine keyword rank and vector rank.
    vector_rank = {i: rank for rank, i in enumerate(np.argsort(-cosine))}
    fused = []
    for keyword_rank, hit in enumerate(hits):
        score = 1 / (rrf_k + keyword_rank + 1) + 1 / (rrf_k + vector_rank[keyword_rank] + 1)
        fused.append((score, float(cosine[keyword_rank]), hit))
    fused.sort(key=lambda item: item[0], reverse=True)

    return [
        {"id": h["id"], "title": h["title"], "category": h["category"], "rrf": s, "cosine": c}
        for s, c, h in fused[:top]
    ]


if __name__ == "__main__":
    index_documents(
        [
            {
                "id": "1",
                "title": "Auto-shutdown for Azure Virtual Machines",
                "content": "Schedule VMs to stop outside business hours so you stop paying for idle compute.",
                "category": "compute",
            },
            {
                "id": "2",
                "title": "Azure Functions Consumption plan",
                "content": "Pay only while your functions run. Instances scale to zero when idle.",
                "category": "compute",
            },
            {
                "id": "3",
                "title": "Azure Cosmos DB serverless",
                "content": "Billed per request unit consumed, with no provisioned throughput to pay for when idle.",
                "category": "database",
            },
        ]
    )
    time.sleep(2)  # give the index a moment to make new documents searchable
    for result in search_rerank("stop paying for idle machines"):
        print(f"{result['rrf']:.4f}  cos={result['cosine']:.3f}  {result['title']}")
```

## Design decisions worth arguing about

**Why reciprocal rank fusion and not a weighted sum.** The `@search.score` from BM25 isn't bounded and isn't comparable across queries, so adding it to a cosine similarity between 0 and 1 means a weight that is wrong for half your queries. [Reciprocal rank fusion](https://dl.acm.org/doi/10.1145/1571941.1572114) only uses ranks, needs one constant (60 is the value from the original paper), and is hard to break. If you'd rather trust the embeddings entirely, sort by `cosine` and ignore the keyword rank. Measure both against real queries, using the recall@k approach from [the NumPy prototype post](/blog/2023-01-24-semantic-search-embeddings/).

**Storing vectors in the index versus beside it.** A 1,536-dimension vector serialises to roughly 30 KB of JSON. That counts against your index storage and the per-request [indexing payload limits](https://learn.microsoft.com/azure/search/search-limits-quotas-capacity), and pulling back 50 candidates moves about 1.5 MB per query. On a small corpus that's fine. Beyond that, I'd keep only IDs in the index and fetch vectors from a cache such as Azure Cache for Redis, keyed by document ID. You trade a second round trip for a much lighter search payload. Whichever you pick, the vectors and the text must be refreshed together, so build the embedding step into the same pipeline that pushes documents.

**Whole documents versus chunks.** The code embeds title plus content as one string, which is fine for short articles and wrong for long ones. Every embedding model has an input limit (2,046 tokens for the first-generation ada models), so a long document either fails or gets truncated, and even when it fits, one vector averaged over twenty pages blurs whatever the document is actually about. Truncating is the simple option when the opening paragraphs carry the meaning. Otherwise, index each chunk of a few hundred tokens as its own search document with a `parentId` field, re-rank the chunks, and collapse the results to their parent before you show them. You pay for more documents in the index, but each vector is far sharper.

**Candidate count.** Larger candidate sets help recall but cost latency and bandwidth. I start at 50, check how often the final top 10 includes something that was ranked below 40 by keywords, and only raise the number if that happens a lot. Remember the query embedding too: every search now waits on an Azure OpenAI call and counts against the deployment's request limit, so cache embeddings for frequent queries and fall back to plain keyword order when that call returns a 429 or times out.

## Where this falls down

Be honest with yourself about the main limitation: **the embeddings can only re-order what keyword search finds.** If a relevant document shares no terms with the query, it never reaches the second stage. The example above works because "idle" appears in both the query and the documents. Ask "how do I cut my cloud bill overnight" and BM25 may return nothing useful, so there's nothing to re-rank. Synonym maps and better analysers narrow the gap, but they don't close it.

So I wouldn't use this pattern when:

- **Queries and documents use different vocabulary by nature**, such as customer language against engineering documentation or cross-lingual search. You need true vector retrieval, which today means a dedicated engine.
- **Similarity is the product**, such as "more like this", duplicate detection or clustering. There's no query text to drive the recall stage.
- **You only want better ranking and don't care whose model does it.** Turn on semantic search in preview and skip the embedding pipeline.

Where it does fit is the common enterprise case: a Cognitive Search index that already carries the filters, security trimming and connectors you depend on, with relevance that is good but not great. Re-ranking with your own embeddings is a small, reversible change you can measure in a week.

## The decision

If your search already lives in Azure Cognitive Search, don't move it to a vector database because the internet says so. Add embeddings as a re-ranking stage, measure the change against queries your users actually type, and look at the failures. If most of them are documents that keyword search never found, that's the evidence you need for true vector retrieval, and a reason to watch for native vector support in Cognitive Search. If most of the failures were ordering problems, you've already fixed them.
