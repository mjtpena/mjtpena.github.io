---
title: "Hybrid Search for RAG: Test What the BM25 Leg Rescues"
description: "Hybrid search is default RAG advice, but the BM25 leg has real costs; a three-way test on Azure AI Search shows which questions it rescues."
author: Michael John Peña
draft: false
date: 2026-04-12
tags:
  - RAG
  - Azure AI Search
  - Hybrid Search
  - Evaluation
  - Python
---

"Use hybrid search" has become the reflex answer to every RAG retrieval problem. On Azure AI Search it's cheap to try: add `search_text` next to your vector query and the service fuses the two ranked lists for you. But the keyword leg isn't free once it's in production. It brings analysers to tune, a score you can no longer threshold, and a second retrieval path to keep an eye on every time the index changes.

Hybrid is the right default for most enterprise corpora, but "most" isn't "yours". Before you carry that complexity, run the test that shows which questions the keyword leg actually rescues and which ones it makes worse. This post builds on the labelled question set from [Wrong RAG Answer? Rule Out Retrieval Before You Edit the Prompt](/blog/2026-03-10-rag-tradeoffs-i-keep-seeing-fixing-retrieval-before-touching-prompts/) and uses Azure AI Search with `azure-search-documents` 11.6.0, which is still the current GA Python library in April 2026.

## How hybrid ranking works, and why it can hurt

A hybrid query runs a BM25 full-text query and one or more vector queries in parallel, then merges them with [Reciprocal Rank Fusion](https://learn.microsoft.com/azure/search/hybrid-search-ranking). Each document gets `1/(rank + k)` from every list it appears in, with `k` a small constant (the docs cite 60), which is unrelated to the nearest-neighbour `k`, and the sums decide the final order.

Two consequences follow from that formula, and they're the whole case for testing rather than assuming:

- **RRF rewards agreement, not strength.** A chunk ranked 8th by both legs can beat a chunk ranked 1st by vectors and absent from BM25. If your keyword leg is noisy, say because boilerplate headers or disclaimers match every query, it can push down the chunk your vector search had right. I call that dilution.
- **The score loses meaning.** BM25 has no upper bound and cosine similarity has a fixed range, but RRF scores are tiny and depend only on positions. The [vector query docs](https://learn.microsoft.com/azure/search/vector-search-how-to-query) say outright that hybrid queries don't suit minimum thresholds because the RRF range is small and volatile. If your grounding gate relied on a similarity cut-off on the final list, hybrid takes it away. A preview vector `threshold` can still filter the vector leg before fusion, but nothing gates the fused result. For that you need the semantic ranker's 0 to 4 score instead, which I covered in [Is Your Reranker Earning Its Place?](/blog/2026-03-21-rag-systems-that-hold-up-using-reranking-only-where-it-changes-outcomes/)

## What the keyword leg really costs

The per-query cost on Azure AI Search is small: there's no separate charge for the text half, and it runs in parallel. The cost is in engineering and operations.

| Cost | What it means in practice |
|---|---|
| Analysers | The standard analyser splits `INV-20391` into `inv` and `20391`. BM25 still matches `20391`, but `PO-20391` matches too and every `INV-*` document shares the `inv` term, so the exact identifier gets no special weight. Exact matching may need a custom analyser (for example a keyword or pattern tokeniser on a dedicated field) and a re-index. |
| Searchable fields | Every field marked searchable feeds BM25. Titles, footers and metadata dumps all compete with the chunk text unless you scope `search_fields`. |
| No usable raw score | You lose the ability to gate on similarity, as above. |
| Tuning surface | Vector `weight` (GA) shifts the balance. `maxTextRecallSize`, which caps how many BM25 results reach fusion (default 1,000), is still in preview, available only through the 2025-11-01-preview REST API and the 11.7.0b2 beta SDK (via `hybrid_search=HybridSearch(max_text_recall_size=...)`). |
| Off Azure AI Search | On pgvector or a vector-only store you build the full-text query and the fusion yourself, and own both. |

None of these costs show up in a demo; all of them show up the first time someone re-indexes with a new analyser.

## The three-way test

Run every labelled question three ways: keyword only, vector only and hybrid. Use the same chunks and the same context budget each time. For each run, record whether a chunk from a correct source document landed in the top `k` chunks your app sends to the model. Then compare vector-only with hybrid, because the question you're answering is "should I add the keyword leg to my vector pipeline?"

| Outcome | Vector only | Hybrid | What it tells you |
|---|---|---|---|
| Rescued | Miss | Hit | The keyword leg is doing its job |
| Diluted | Hit | Miss | BM25 noise is outvoting a correct vector result |
| Both hit | Hit | Hit | Hybrid adds nothing for this question |
| Both miss | Miss | Miss | Neither leg finds it; look at chunking or query rewriting |

The keyword-only run is the diagnostic. If a question is "diluted" but keyword-only also misses, the text leg is pure noise for that query shape. If both single legs hit but hybrid misses, the usual cause is that each leg found a different correct chunk and fusion promoted noise both partly agreed on. Confirm it before changing anything: for those questions, print the rank of the correct parent in the keyword and vector lists and work out its RRF contribution from each leg. If that's the pattern, raise the vector weight first.

```python
# hybrid_ab.py
# pip install azure-search-documents==11.6.0 azure-identity
# golden_set.jsonl, one line per question:
# {"question": "What is the refund window for INV-20391?", "labels": {"billing-policy": 3, "billing-faq": 1}}
import json
import time
from collections import Counter

from azure.core.exceptions import HttpResponseError
from azure.identity import DefaultAzureCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizableTextQuery

SEARCH_ENDPOINT = "https://<your-search-service>.search.windows.net"
INDEX_NAME = "<your-index-name>"
VECTOR_FIELD = "<your-vector-field>"  # the field's vector profile must reference a vectoriser (integrated vectorisation)
PARENT_FIELD = "<your-parent-id-field>"  # retrievable field holding the source document ID
TEXT_FIELDS = ["<your-chunk-text-field>"]  # scope BM25 to the fields you mean to match
SEMANTIC_CONFIG = "<your-semantic-config>"  # only needed for the semantic runs
CANDIDATES = 50  # results fetched per query; also the semantic ranker's input window
CONTEXT_SIZE = 5  # chunks your app actually sends to the model
VECTOR_WEIGHT = 1.0  # raise to 1.5 or 2.0 if you see dilution
USE_SEMANTIC = False  # set True if production reranks with the semantic ranker
ANSWERS_IT = 2  # label at or above this counts as "contains the answer"

# azure-core's retry policy already retries 429 and 503; these settings make it more patient
# on a busy or low-tier service. Results are consumed inside retrieve(), so paging is covered too.
client = SearchClient(
    SEARCH_ENDPOINT,
    INDEX_NAME,
    DefaultAzureCredential(),
    retry_total=6,
    retry_backoff_factor=2.0,
)


def retrieve(question: str, mode: str, semantic: bool = False) -> list[str]:
    """Return parent IDs in ranked order for 'keyword', 'vector' or 'hybrid'."""
    use_text = mode in ("keyword", "hybrid")
    use_vector = mode in ("vector", "hybrid")
    vector_queries = (
        [
            VectorizableTextQuery(
                text=question,
                k_nearest_neighbors=CANDIDATES,
                fields=VECTOR_FIELD,
                weight=VECTOR_WEIGHT,
            )
        ]
        if use_vector
        else None
    )
    semantic_args = (
        {
            "query_type": "semantic",
            "semantic_configuration_name": SEMANTIC_CONFIG,
            # vector-only has no search_text, so give the ranker the question explicitly
            "semantic_query": None if use_text else question,
        }
        if semantic
        else {}
    )
    for attempt in range(3):
        try:
            results = client.search(
                search_text=question if use_text else None,
                search_fields=TEXT_FIELDS if use_text else None,
                vector_queries=vector_queries,
                select=[PARENT_FIELD],
                top=CANDIDATES,  # fetch the full candidate list; hit() applies the cut-off
                **semantic_args,
            )
            return [r[PARENT_FIELD] for r in results]
        except HttpResponseError as e:
            # still throttled after the client's own retries: wait longer, then try again
            if e.status_code not in (429, 503) or attempt == 2:
                raise
            time.sleep(30 * (attempt + 1))
    return []


def hit(parent_ids: list[str], answer_ids: set[str], k: int = CONTEXT_SIZE) -> bool:
    """True if a correct source appears in the top k. Call with k=3 or 10 on the same lists to see the curve."""
    return any(p in answer_ids for p in parent_ids[:k])


KS = (3, CONTEXT_SIZE, 10)  # score the same lists at several context sizes
outcomes = {k: Counter() for k in KS}
with open("golden_set.jsonl", encoding="utf-8") as f:
    for line in f:
        item = json.loads(line)
        answer_ids = {d for d, label in item["labels"].items() if label >= ANSWERS_IT}
        if not answer_ids:
            continue  # unanswerable questions test the grounding gate, not recall

        q = item["question"]
        try:
            kw_ids = retrieve(q, "keyword")
            vec_ids = retrieve(q, "vector", USE_SEMANTIC)
            hyb_ids = retrieve(q, "hybrid", USE_SEMANTIC)
        except HttpResponseError as e:
            # skip the question rather than lose the counts collected so far
            print(f"[skipped: HTTP {e.status_code}] {q}")
            continue

        for k in KS:
            keyword = hit(kw_ids, answer_ids, k)
            vector = hit(vec_ids, answer_ids, k)
            hybrid = hit(hyb_ids, answer_ids, k)

            if hybrid and not vector:
                outcome = "rescued"
            elif vector and not hybrid:
                outcome = "diluted"
            else:
                outcome = "both hit" if vector else "both miss"
            outcomes[k][outcome] += 1
            if k == CONTEXT_SIZE and outcome in ("rescued", "diluted"):
                print(f"[{outcome}] keyword-only={'hit' if keyword else 'miss'} | {q}")

for k in KS:
    print(f"k={k}: {dict(outcomes[k])}")
```

Because every query returns the full `CANDIDATES` list, the script scores the same results at `k=3`, 5 and 10 without re-querying; that tells you whether a diluted question was pushed just past your context budget or buried.

### If production uses the semantic ranker

Recall at top-5 after RRF isn't what your model sees if you rerank. The [semantic ranker](https://learn.microsoft.com/azure/search/semantic-search-overview) rescores up to the top 50 fused results, so a chunk that RRF diluted to position 12 can come back into the top five. In that case set `USE_SEMANTIC = True`, which runs vector+semantic and hybrid+semantic with `top=50`, and judge hits at the top `CONTEXT_SIZE` after reranking, because that's the list your model receives. Dilution that disappears after reranking isn't a reason to drop hybrid; dilution that survives it is. On the Standard semantic ranker plan, requests beyond the free 1,000 a month are billed per 1,000, so budget for two semantic queries per question.

Each question costs three queries and two query embeddings, because the vectoriser embeds the question for the vector and hybrid runs. For a few hundred questions that's negligible, but run it against a non-production search service (or a copy of the index), or outside peak hours if your service is busy. On a Basic or Free tier the burst of queries can still be throttled, which is why the script raises the client's retry settings, backs off on a 429 or 503 that outlasts them, and skips a question rather than losing the counts collected so far.

## Reading the result

**Rescued clearly outnumbers diluted.** Keep hybrid. Read the rescued list anyway, because it tells you which query shapes the keyword leg is serving, and those are the ones to protect when someone later changes the analyser or the chunking.

**Mostly "both hit".** Your embeddings are already handling your traffic. Hybrid is doing no harm here, and I'd usually still keep it as insurance for vocabulary your labelled set doesn't cover yet: new product codes, new staff names, acronyms coined after the embedding model was trained. But if you depend on a similarity threshold for abstention and you don't run the semantic ranker, vector-only with the threshold may be the better system.

**Diluted shows up as a pattern.** Don't turn hybrid off yet. Fix the noise first:

1. **Scope the text leg.** Set `search_fields` to the chunk text and title. Metadata fields full of repeated values are the most common source of dilution.
2. **Weight the vector query.** `VectorizableTextQuery` takes a `weight` (default 1.0) that multiplies the vector leg's contribution in RRF. Values above 1.0 favour the vector leg; for dilution, set `VECTOR_WEIGHT` to 1.5 and then 2.0 and rerun. (Below 1.0 favours keywords.) [Vector weighting](https://learn.microsoft.com/azure/search/vector-search-how-to-query#vector-weighting) is GA (REST 2024-07-01 and later), so 11.6.0 supports it.
3. **Look at the analyser.** If rescued questions are thinner than you expected on identifiers, check what the analyser does to them before concluding BM25 doesn't help.

## Where the keyword leg usually pays

Run the test before trusting this table, but it's where I'd expect each answer to land.

| Query shape | Hybrid usually | Why |
|---|---|---|
| Codes, SKUs, ticket and invoice numbers | Pays | Embeddings blur near-identical identifiers; BM25 doesn't, once tokenisation keeps them intact |
| Names of people, products and internal systems | Pays | Rare proper nouns are weakly represented in general embedding models |
| Jargon and acronyms specific to your organisation | Pays | Same reason, plus vocabulary the model never saw |
| Paraphrased natural-language questions over prose | Often neutral | Vectors already match meaning; BM25 adds little |
| Short, vague queries over boilerplate-heavy documents | Can dilute | Common words match headers and disclaimers everywhere |

## When I wouldn't bother testing

- **Your corpus is full of identifiers.** Policy numbers, part codes and error codes in user questions mean the keyword leg will pay off. Turn it on and spend the effort on the analyser instead.
- **The platform owns retrieval.** Azure AI Search [agentic retrieval](https://learn.microsoft.com/azure/search/agentic-retrieval-overview) (knowledge bases, in preview through the 2025-11-01-preview REST API) runs your query, or at low and medium [retrieval reasoning effort](https://learn.microsoft.com/azure/search/agentic-retrieval-how-to-set-retrieval-reasoning-effort) a set of LLM-planned subqueries, as keyword, vector or hybrid depending on the index's fields, and semantically reranks the results. You'd test the knowledge base against your pipeline as a whole, not one leg of it.
- **You have fewer than about thirty labelled questions.** Three rescued and two diluted is noise. Build the set first.
- **Your store doesn't do fusion and the corpus is small, clean prose.** Building and owning RRF yourself for a few thousand well-written pages is complexity I'd defer until the both-miss list says otherwise.

## The decision

Treat hybrid search as a second retrieval path with its own failure mode, not a setting you switch on once. Run the three-way test, keep hybrid when rescued beats diluted, fix scope and weighting before giving up on it, and keep the rescued questions in your [regression gate](/blog/2026-04-01-rag-engineering-log-fixing-retrieval-before-touching-prompts/) so the next index change can't quietly undo what the keyword leg is buying you.
