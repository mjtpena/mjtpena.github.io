---
title: "Azure AI Search Semantic Ranker: Configuration, Thresholds and Cost"
description: "How to design semantic configurations, use reranker scores as a RAG cut-off, and decide when Azure AI Search's semantic ranker is worth paying for."
author: Michael John Peña
draft: false
date: 2024-01-25
tags:
  - Azure AI Search
  - Semantic Search
  - RAG
  - Search Optimization
  - Python
---

Turning on the semantic ranker in Azure AI Search takes one parameter. Getting value from it takes more thought than most teams give it, because the ranker only sees a slice of each document, only reorders 50 results, and bills per query on the Standard plan. If you get the semantic configuration wrong, you pay for a reranker that is reading the wrong text.

Here's how I configure it, gate on its score, and decide when it isn't worth the money.

## What changed at Ignite 2023

At Ignite in November 2023, Azure Cognitive Search was renamed Azure AI Search, and the feature previously called "semantic search" became the **semantic ranker**, now generally available on the `2023-11-01` REST API and the `azure-search-documents` 11.4.0 Python SDK. I covered the wider GA-versus-preview picture in [Azure AI Search after Ignite 2023](/blog/2024-01-23-azure-ai-search-updates/). If you're still on a preview API version for semantic queries, move to `2023-11-01`. The SDK renamed several types on the way to GA (`SemanticSettings` became `SemanticSearch`, `CaptionResult` became `QueryCaptionResult`), so older samples fail with `ImportError` against 11.4.0.

The ranker is available on Basic tier and above, subject to region. There are two billing plans: **Free**, which gives you 1,000 semantic requests a month and then fails with a billing error, and **Standard**, which charges per 1,000 requests after the free allowance. A request is billable when `queryType` is `semantic` and the search text isn't empty. The [enable or disable semantic ranker](https://learn.microsoft.com/en-us/azure/search/semantic-how-to-enable-disable) page covers how the plans behave; check the [pricing page](https://azure.microsoft.com/pricing/details/search/) for your region's per-request price before you make it the default.

## How the ranker works, and why that matters for design

The [semantic ranking overview](https://learn.microsoft.com/en-us/azure/search/semantic-search-overview) describes a two-stage pipeline:

1. **L1 retrieval.** Your keyword (BM25), vector, or hybrid query runs as normal and produces a ranked list.
2. **L2 reranking.** The top 50 results from L1 are passed to a language model built for ranking. For each document, the service assembles a string from the fields in your semantic configuration, truncates it, and scores it against the query text. Results come back sorted by `@search.rerankerScore`, on a 0 to 4 scale.

Three consequences follow, and they drive every decision below.

**The ranker can't rescue what L1 missed.** If the right chunk is result 73, it's never reranked. Recall is L1's job. That is why I pair the ranker with hybrid retrieval rather than keyword-only, and why I set `k_nearest_neighbors` to 50 on the vector side so the reranker gets a full candidate pool. I'll cover the hybrid half separately.

**The ranker reads a truncated string, in your order.** The content and keyword fields are prioritised by their order in the configuration, and lower-priority fields get truncated when content is long. Put a 3,000-word body field first and your carefully written summary field in second place may never be seen.

**Scoring profiles don't affect the final order.** A scoring profile boosts L1 scores, which changes *which* 50 documents get in, but the L2 order comes from the reranker alone. If the business needs "newer documents first", use a filter (for example a date window) or re-sort in application code after reranking. Semantic queries reject `$orderby` with a 400, and a freshness boost won't survive reranking either.

## Designing the semantic configuration

A semantic configuration has three slots: one title field, an ordered list of content fields, and an ordered list of keyword fields. All must be string or string collection fields, and they should hold natural language. The mistake I see most often is treating the configuration as "every searchable field", which mostly adds noise to a truncated input.

My rules of thumb:

- **Title field:** short and descriptive. For RAG chunks, I store the parent document title plus the section heading in one field, so each chunk carries its context.
- **Content fields:** the chunk text first. If you chunk at around 500 to 1,000 tokens, which is common for RAG, the chunk usually fits. If you index whole documents, put an abstract or summary field ahead of the body.
- **Keyword fields:** tags, product names, categories. Keep them short. Don't put IDs, URLs, or JSON here; the model gets nothing from them.

Here is a complete index definition with the 11.4.0 SDK, including a vector field so it can serve hybrid queries:

```python
import os

from azure.core.credentials import AzureKeyCredential
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    HnswAlgorithmConfiguration,
    SearchableField,
    SearchField,
    SearchFieldDataType,
    SearchIndex,
    SemanticConfiguration,
    SemanticField,
    SemanticPrioritizedFields,
    SemanticSearch,
    SimpleField,
    VectorSearch,
    VectorSearchProfile,
)

endpoint = "https://<your-search-service>.search.windows.net"
credential = AzureKeyCredential(os.environ["AZURE_SEARCH_ADMIN_KEY"])

fields = [
    SimpleField(name="id", type=SearchFieldDataType.String, key=True),
    SearchableField(name="title"),
    SearchableField(name="chunk"),
    SearchableField(name="tags", collection=True, filterable=True),
    SimpleField(name="source_url", type=SearchFieldDataType.String),
    SearchField(
        name="chunk_vector",
        type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
        searchable=True,
        vector_search_dimensions=1536,
        vector_search_profile_name="hnsw-profile",
    ),
]

semantic_config = SemanticConfiguration(
    name="rag-config",
    prioritized_fields=SemanticPrioritizedFields(
        title_field=SemanticField(field_name="title"),
        content_fields=[SemanticField(field_name="chunk")],
        keywords_fields=[SemanticField(field_name="tags")],
    ),
)

index = SearchIndex(
    name="docs-chunks",
    fields=fields,
    vector_search=VectorSearch(
        algorithms=[HnswAlgorithmConfiguration(name="hnsw")],
        profiles=[VectorSearchProfile(name="hnsw-profile", algorithm_configuration_name="hnsw")],
    ),
    semantic_search=SemanticSearch(
        default_configuration_name="rag-config",
        configurations=[semantic_config],
    ),
)

SearchIndexClient(endpoint, credential).create_or_update_index(index)
```

`default_configuration_name` means queries don't have to name the configuration every time. I still pass it explicitly in application code, because when an index carries more than one configuration (say, one for a support portal and one for RAG), an explicit name makes it obvious which one a query used. Note that `source_url` is deliberately left out of the configuration. Semantic configuration changes don't require a rebuild, so iterating on field order is cheap.

## Querying: reranker score as a cut-off

The value of `@search.rerankerScore` for RAG is that it's on a fixed scale, unlike the RRF score from hybrid queries, which you shouldn't compare across queries. That makes it usable as a gate: if nothing scores above your threshold, tell the user you don't know rather than handing weak chunks to the model.

```python
import os

from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import QueryCaptionType, VectorizedQuery

search_client = SearchClient(
    endpoint="https://<your-search-service>.search.windows.net",
    index_name="docs-chunks",
    credential=AzureKeyCredential(os.environ["AZURE_SEARCH_QUERY_KEY"]),
)


def retrieve(question: str, question_vector: list[float], min_score: float = 2.0) -> list[dict]:
    results = search_client.search(
        search_text=question,
        vector_queries=[
            VectorizedQuery(vector=question_vector, k_nearest_neighbors=50, fields="chunk_vector")
        ],
        query_type="semantic",
        semantic_configuration_name="rag-config",
        query_caption=QueryCaptionType.EXTRACTIVE,
        semantic_error_mode="partial",
        semantic_max_wait_in_milliseconds=1500,
        select=["id", "title", "chunk", "source_url"],
        top=5,
    )

    chunks = []
    for r in results:
        score = r.get("@search.reranker_score")
        if score is None or score < min_score:
            continue
        captions = r.get("@search.captions") or []
        chunks.append(
            {
                "title": r["title"],
                "chunk": r["chunk"],
                "source_url": r["source_url"],
                "reranker_score": score,
                "caption": captions[0].text if captions else None,
            }
        )
    return chunks
```

A few deliberate choices:

- **`min_score=2.0` is a starting point, not a recommendation.** Microsoft's scale describes 2 as "somewhat relevant" and 3 as "relevant", but the right value depends on your content. Calibrate it with labelled queries (next section). Microsoft notes that ranking model updates can shift the score distribution, so re-check thresholds periodically rather than tuning to the second decimal.
- **`semantic_error_mode="partial"` with a wait cap.** In partial mode, if semantic processing fails or exceeds `semantic_max_wait_in_milliseconds`, you get the L1 results back instead of an error. That's the right trade for a chat experience. The catch: in that case `@search.reranker_score` can be missing, so the filter above returns nothing. Decide explicitly whether a degraded response should fall back to L1 order or say "I don't know".
- **The ranker scores against `search_text`.** In a hybrid query on the GA API, the vector carries the embedding and the text carries the question. Don't send an empty string: both billing and reranking key off a non-empty query string, so an empty one quietly gives you plain L1 results.

### Captions and answers

Extractive captions are cheap to request and useful in a search UI for highlighting. For RAG, I pass the full chunk to the model, not the caption, because a caption is a short extract and loses surrounding context the model needs.

Semantic answers (`query_answer="extractive"`, with `query_answer_count` and `query_answer_threshold`) return a passage the ranker thinks directly answers the question. They're good for an FAQ-style "answer card" above traditional results, and I'd use them there. In a RAG pipeline they mostly duplicate what the LLM does, so I leave them off.

## Measure before you pay for it

The ranker usually helps, but "usually" isn't a budget justification. The test I'd run is a straight A/B on the same queries, same index, same `top`, same hybrid L1 query: hybrid alone versus hybrid plus the semantic ranker.

```python
# Reuses search_client from the retrieval example above.
from azure.search.documents.models import VectorizedQuery


def hit_rate_at_k(test_set: list[dict], use_semantic: bool, k: int = 5) -> float:
    """test_set items look like
    {"query": "...", "query_vector": [0.01, ...], "relevant_ids": {"doc-1", "doc-7"}}.
    """
    hits = 0
    for case in test_set:
        params = {
            "search_text": case["query"],
            "vector_queries": [
                VectorizedQuery(
                    vector=case["query_vector"], k_nearest_neighbors=50, fields="chunk_vector"
                )
            ],
            "select": ["id"],
            "top": k,
        }
        if use_semantic:
            params["query_type"] = "semantic"
            params["semantic_configuration_name"] = "rag-config"
        returned = {r["id"] for r in search_client.search(**params)}
        if returned & case["relevant_ids"]:
            hits += 1
    return hits / len(test_set)


test_set = [
    {
        "query": "<a real user question>",
        # Placeholder: replace with the question's embedding from the same
        # model (and dimensions) you used for chunk_vector.
        "query_vector": [0.0] * 1536,
        "relevant_ids": {"<id-of-the-right-chunk>"},
    },
]
print("hybrid (L1):", hit_rate_at_k(test_set, use_semantic=False))
print("hybrid + semantic ranker:", hit_rate_at_k(test_set, use_semantic=True))
```

Fifty to a hundred real questions with known-good chunks is enough to show whether the ranker improves hit rate on your content. Run the same set when you change the semantic configuration's field order, because that's the main tuning lever you have.

## When I'd leave it off

- **Short, structured lookups.** Product codes, SKUs, error numbers, autocomplete. BM25 handles these well, and the ranker adds latency for no gain.
- **Filter-and-sort experiences.** If users mostly browse by facets and sort by price or date, you can't combine `$orderby` with semantic ranking at all (the service returns a 400), so the ranker adds nothing.
- **High-volume, low-value traffic.** Every semantic query on the Standard plan is billable. If a request is a bot crawling your search page, you're paying for nothing.
- **Content the model can't read.** Tables flattened into text, scanned PDFs with poor OCR, or fields full of codes. Fix the content before you add a reranker on top.

## The decision

For RAG on Azure AI Search, I treat hybrid retrieval plus the semantic ranker as the default, with three conditions: the semantic configuration lists a small number of natural-language fields in deliberate order, the application gates on `@search.rerankerScore` rather than passing whatever comes back, and someone has measured the lift on real queries. For keyword-shaped or browse-shaped search, I leave it off and spend the money elsewhere. The [semantic query how-to](https://learn.microsoft.com/en-us/azure/search/semantic-how-to-query-request) has the full parameter reference for the `2023-11-01` API.
