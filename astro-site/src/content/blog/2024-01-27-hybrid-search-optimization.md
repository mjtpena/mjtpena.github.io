---
title: "Tuning Hybrid Search in Azure AI Search: What RRF Lets You Change"
description: "Which hybrid search knobs Azure AI Search exposes on the 2023-11-01 API, why I avoid client-side score weighting, and how to measure changes before shipping."
author: Michael John Peña
draft: false
date: 2024-01-27
tags:
  - Azure AI Search
  - Hybrid Search
  - Vector Search
  - RAG
  - Search Optimization
---

Turning on hybrid search in Azure AI Search is one extra parameter: send `search_text` and a vector query in the same request. Tuning it is less obvious, because the service merges the two result lists with Reciprocal Rank Fusion and gives you very few direct controls over that merge. Teams then reach for client-side score blending, which usually makes relevance worse and harder to debug.

The tuning half is what matters: what the generally available API lets you change as of January 2024, what it doesn't, and how to tell whether a change helped. If you want the basics of why keyword and vector retrieval complement each other, start with [combining vector and keyword search](/blog/2023-02-04-hybrid-search/). The reranking stage is covered in [the semantic ranker post](/blog/2024-01-25-semantic-ranker/).

## How a hybrid query is ranked today

Vector search, and with it hybrid queries, [became generally available at Ignite in November 2023](https://learn.microsoft.com/en-us/azure/search/whats-new) on the `2023-11-01` REST API, at the same time Azure Cognitive Search was renamed Azure AI Search. The Python SDK that matches it is [`azure-search-documents` 11.4.0](https://github.com/Azure/azure-sdk-for-python/blob/azure-search-documents_11.4.0/sdk/search/azure-search-documents/CHANGELOG.md), released on 13 November 2023. Older samples that use the beta `Vector` class or a `k=` argument won't run against 11.4.0; the GA class is `VectorizedQuery` with `k_nearest_neighbors`.

A [hybrid query](https://learn.microsoft.com/en-us/azure/search/hybrid-search-overview) runs the full-text (BM25) query and each vector query in parallel, then fuses the ranked lists. The [RRF scoring doc](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking) describes the formula: each document gets `1 / (rank + k)` from every list it appears in, with a constant `k` that the docs give as 60, and the sums are sorted. Three things follow from that:

- **Only rank matters, not raw score.** A document that is first in the BM25 list by a huge margin gets the same contribution as one that is first by a hair.
- **Both lists count equally.** On the GA API there is no per-subquery weight. A document ranked in the top fifty or so of both lists will outrank one that is first in only one list.
- **`@search.score` in a hybrid result is the fused RRF score.** It's a small number, capped at about (number of ranked lists) / 60, so don't use it as a relevance threshold or compare it across queries with a different number of vector queries. If you need a cut-off, use the semantic ranker's `@search.reranker_score`.

The same RRF merge applies when you send more than one vector query in a request, for example one against a title embedding and one against a chunk embedding.

## The knobs you actually have

| Lever | What it changes | When I touch it |
|---|---|---|
| `k_nearest_neighbors` on the vector query | How many vector candidates enter the fusion | Almost always: set it to at least `top`, and to 50 when the semantic ranker follows |
| `top` | How many fused results come back | Set by what the application consumes, not as a relevance lever |
| `search_fields`, `search_mode`, analysers | What the BM25 side matches on | When keyword recall is poor for product names, codes or acronyms |
| `filter` with `vector_filter_mode` | Which documents either side can return | Security trimming and scoping; `preFilter` is the default and the safer choice for small filtered sets |
| Extra vector queries | Adds another ranked list to the RRF merge | When titles or summaries carry signal the chunk embedding misses |
| `query_type="semantic"` | Reranks the top 50 fused results | When relevance at the top matters more than latency and per-query cost |
| `exhaustive=True` on the vector query | Exact KNN instead of HNSW | Evaluation only, to separate ANN recall loss from ranking problems |

The most common mistake I see is leaving `k_nearest_neighbors` small, say 3 or 5, because the RAG prompt only takes five chunks. That starves the fusion: the vector side contributes five candidates, the BM25 side contributes many more, and RRF has little to work with. Pull a deeper candidate pool from the vector side and let `top` control what you return.

```python
import os

from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery

search_client = SearchClient(
    endpoint="https://<your-search-service>.search.windows.net",
    index_name="<your-index>",
    credential=AzureKeyCredential(os.environ["AZURE_SEARCH_QUERY_KEY"]),
)


def hybrid_search(query: str, query_vector: list[float], top: int = 5, use_semantic: bool = True) -> list[dict]:
    vector_query = VectorizedQuery(
        vector=query_vector,
        k_nearest_neighbors=50,
        fields="<your-vector-field>",
    )
    params = {
        "search_text": query,
        "vector_queries": [vector_query],
        "select": ["id", "title", "chunk"],
        "top": top,
    }
    if use_semantic:
        params["query_type"] = "semantic"
        params["semantic_configuration_name"] = "<your-semantic-config>"
    return list(search_client.search(**params))
```

## Why I don't blend scores on the client

A pattern that circulates in a lot of RAG samples is to run a keyword query and a vector query separately, normalise their `@search.score` values, and combine them as something like `0.3 * keyword + 0.7 * vector`. I'd avoid it, for four reasons:

1. **The scores aren't on comparable scales.** BM25 scores are unbounded and depend on the query's terms and the corpus statistics. Vector scores are derived from the similarity metric. Min-max normalising each list per query makes the top result of a terrible list look as good as the top of a great one.
2. **You lose the semantic ranker.** The ranker runs inside the service on the fused list. Once you fuse on the client, you can't send that list back to be reranked.
3. **Two round trips instead of one.** Two requests per question double the query load on your replicas, latency becomes the slower of the two calls plus your merge, and all of that buys a merge the service already does in one request.
4. **The weights won't transfer.** Weights tuned on one sample of queries tend to overfit, and they silently drift as the index grows and BM25 statistics change.

If you genuinely need one side to count more, which the GA API can't express, do it on ranks rather than scores. A weighted RRF keeps the robustness of rank fusion and only nudges the balance:

```python
def weighted_rrf(ranked_lists: list[tuple[list[str], float]], k: int = 60) -> list[str]:
    """ranked_lists: (document ids in rank order, weight) pairs, one per retriever."""
    scores: dict[str, float] = {}
    for doc_ids, weight in ranked_lists:
        for rank, doc_id in enumerate(doc_ids, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + weight / (k + rank)
    return sorted(scores, key=scores.get, reverse=True)


keyword_ids = ["doc-3", "doc-1", "doc-9"]
vector_ids = ["doc-1", "doc-7", "doc-3"]
print(weighted_rrf([(keyword_ids, 1.0), (vector_ids, 1.5)]))
```

I treat this as a last resort and keep it out of production unless an evaluation shows it beating server-side hybrid plus reranking on real questions. Usually it doesn't.

## Route the query instead of reweighting it

When the fused results are poor for one class of query, the cause is usually that the query was the wrong shape for hybrid, not that the balance was off. An error code, a part number or a quoted phrase is a keyword query; the vector side adds near-misses that look plausible and push the exact match down. A long natural-language question is the opposite.

So rather than adaptive weights, I prefer a small, explicit router with two or three modes, each of which you can test on its own:

```python
import re

CODE_PATTERN = re.compile(r"\b[A-Z]{2,}-?\d{2,}\b|\b0x[0-9A-Fa-f]+\b")


def choose_mode(query: str) -> str:
    stripped = query.strip()
    if '"' in stripped or CODE_PATTERN.search(stripped):
        return "keyword"
    if len(stripped.split()) <= 2:
        return "hybrid"
    return "hybrid_semantic"


for q in ['"connection reset by peer"', "ERR-4031", "VPN setup", "why does my VPN drop after the laptop sleeps?"]:
    print(q, "->", choose_mode(q))
```

The rules here are placeholders. Build yours from the queries you actually receive, and keep the router dumb enough that anyone on the team can predict where a query will go. An LLM-based query classifier is possible, but it adds latency and cost to every question before retrieval even starts, and I'd only consider it once simple rules have clearly run out.

## Measure before you change anything

Every lever above needs a test set to justify it. Fifty to a hundred real questions, each labelled with the chunk IDs that answer it, is enough to see whether a change moves recall and ordering. I track two numbers: **recall@k** (did any correct chunk make it into what the model sees) and **MRR** (how high the first correct chunk ranked).

```python
import os

from openai import AzureOpenAI

aoai = AzureOpenAI(
    azure_endpoint="https://<your-openai-resource>.openai.azure.com",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version="2023-05-15",
)


def embed(text: str) -> list[float]:
    response = aoai.embeddings.create(model="<your-embedding-deployment>", input=text)
    return response.data[0].embedding


def run(mode: str, query: str, vector: list[float], top: int) -> list[str]:
    params = {"select": ["id"], "top": top}
    if mode in ("keyword", "hybrid", "hybrid_semantic"):
        params["search_text"] = query
    if mode in ("vector", "hybrid", "hybrid_semantic"):
        params["vector_queries"] = [
            VectorizedQuery(vector=vector, k_nearest_neighbors=50, fields="<your-vector-field>")
        ]
    if mode == "hybrid_semantic":
        params["query_type"] = "semantic"
        params["semantic_configuration_name"] = "<your-semantic-config>"
    return [r["id"] for r in search_client.search(**params)]


def evaluate(test_set: list[dict], modes: list[str], top: int = 5) -> dict:
    report = {}
    for mode in modes:
        hits, reciprocal_ranks = 0, []
        for case in test_set:
            ids = run(mode, case["query"], case["vector"], top)
            ranks = [i for i, doc_id in enumerate(ids, start=1) if doc_id in case["relevant_ids"]]
            hits += bool(ranks)
            reciprocal_ranks.append(1 / ranks[0] if ranks else 0.0)
        report[mode] = {
            "recall_at_k": hits / len(test_set),
            "mrr": sum(reciprocal_ranks) / len(test_set),
        }
    return report


test_set = [
    {"query": "<a real user question>", "relevant_ids": {"<id-of-the-right-chunk>"}},
]
for case in test_set:
    case["vector"] = embed(case["query"])

print(evaluate(test_set, ["keyword", "vector", "hybrid", "hybrid_semantic"]))
```

`run` reuses `search_client` and `VectorizedQuery` from the first snippet. Embed the questions once and reuse the vectors, so every mode sees identical inputs. If vector-only recall looks suspiciously low, rerun it with `exhaustive=True` on the `VectorizedQuery`. If exact search fixes it, the problem is HNSW recall (look at the `ef_search` setting on the algorithm configuration), not fusion.

Read the results per query, not only in aggregate. The questions where hybrid loses to keyword-only are the ones that tell you whether you need a router.

## When hybrid isn't worth it

- **Pure lookup traffic.** If nearly every query is an identifier, a filter, or an autocomplete prefix, BM25 alone is cheaper, faster and more predictable.
- **Content with little lexical overlap with queries.** For short, informal questions against a corpus written in very different language, vector-only can match hybrid; check your test set before paying for the embedding call on every query.
- **No labelled questions.** If nobody can say what a correct result looks like, tuning is guesswork. Spend the first week building the test set, not adjusting parameters.

## What I'd actually do

For RAG on Azure AI Search, the default I start from is a single hybrid request with `k_nearest_neighbors` at 50, the semantic ranker on, and `top` set by the prompt budget. The server-side RRF is a sound merge, and on the `2023-11-01` API it is the merge you get, so I spend tuning effort on what feeds it: analysers and search fields on the keyword side, chunking and embeddings on the vector side, and a simple router for queries that are clearly keyword-shaped. I don't blend raw scores on the client. Whatever I change, I check it against the same labelled questions before it ships. The [vector query how-to](https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-query) has the full parameter reference for the GA API.
