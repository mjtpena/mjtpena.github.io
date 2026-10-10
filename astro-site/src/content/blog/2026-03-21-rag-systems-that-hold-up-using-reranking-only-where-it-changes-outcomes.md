---
title: "Is Your Reranker Earning Its Place? Test It Before You Pay for It"
description: "The semantic ranker only reorders the top 50 results. A with-and-without test on a labelled set shows which RAG queries it rescues and which it just slows."
author: Michael John Peña
draft: false
date: 2026-03-21
tags:
  - RAG
  - Azure AI Search
  - Reranking
  - Evaluation
  - Python
---

Reranking is the easiest quality lever in an Azure AI Search RAG pipeline to pull. You set `query_type="semantic"`, name a semantic configuration, and every query goes through a second ranking pass using [deep learning models adapted from Bing](https://learn.microsoft.com/azure/search/semantic-search-overview). Because it's one parameter, most teams turn it on everywhere and never check what it changed. It's billed per request, it adds a step to every query, and on a lot of queries it doesn't change which passages reach the model at all.

My position: keep the reranker where you can show it changes outcomes, and know why you're paying for it everywhere else. This post is about how to find out. If you haven't yet worked out whether your failures are retrieval or prompt problems, start with [Wrong RAG Answer? Rule Out Retrieval Before You Edit the Prompt](/blog/2026-03-10-rag-tradeoffs-i-keep-seeing-fixing-retrieval-before-touching-prompts/), which builds the labelled question set this post reuses. Everything here uses Azure AI Search and the GA `azure-search-documents` 11.6.0 Python SDK as they stood in March 2026.

## What the semantic ranker can and can't change

The semantic ranker overview is precise about the mechanics, and they set the ceiling on what reranking can do for you:

- It starts from the result set your query already produced: BM25 for a text query, or the Reciprocal Rank Fusion result for a hybrid or vector query. Only the **top 50** go to the ranker.
- It reranks on **text only**. For each result it builds a summary of up to 2,048 tokens from the title, keyword and content fields named in your semantic configuration, and scores that against the query.
- Each result gets an `@search.rerankerScore` from 0 to 4, and results come back sorted by it. The Python SDK exposes it as `@search.reranker_score`, which is the key the script below reads.
- It can't find a document that wasn't in the top 50, and it can't invent text that isn't in your content.

So reranking only changes the answer when the passage you need was retrieved somewhere in the top 50 but sat below the cut-off of chunks you send to the model. If the right passage was already in your top five, reranking reshuffles the context without changing what the model can say. If it wasn't in the top 50, reranking can't help, and you're looking at chunking, hybrid search or query rewriting instead.

That gives you the question to measure: how many questions does reranking move a correct passage into the model's context for?

## Three outcomes per question

Run every labelled question twice: once with your production hybrid query, once with the same query plus the semantic ranker. For each run, check whether a passage from a correct source document landed in the top `k` chunks you send to the model. Each question then falls into one of three groups:

| Outcome | Without reranker | With reranker | What it tells you |
|---|---|---|---|
| Rescued | Correct passage outside top `k` | Inside top `k` | The reranker is doing its job |
| Hurt | Inside top `k` | Pushed outside | The ranker disagrees with your labels; read these closely |
| No change | Same either way | Same either way | You're paying for reranking without a change in what the model sees |

The "hurt" group is the one people don't expect. It happens. The ranker scores a summary built from your configured fields, so if the field that holds the answer isn't in the semantic configuration, or a table lost its heading during chunking, a passage that BM25 matched on an exact term can drop. A handful of hurt questions is normal; a pattern of them usually points at the semantic configuration rather than the ranker.

## The with-and-without test

This script runs that comparison. It reads the same `golden_set.jsonl` format as the triage post: one question per line with graded document labels. It also times each call, because latency is the other half of the trade.

```python
# rerank_ab.py
# pip install azure-search-documents==11.6.0 azure-identity
# golden_set.jsonl, one line per question:
# {"question": "Who approves leave exceptions in NZ?", "labels": {"hr-policy-nz": 3, "hr-faq": 1}}
import json
import time
from collections import Counter
from statistics import median

from azure.identity import DefaultAzureCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizableTextQuery

SEARCH_ENDPOINT = "https://<your-search-service>.search.windows.net"
INDEX_NAME = "<your-index-name>"
SEMANTIC_CONFIG = "<your-semantic-configuration>"
# Assumes a chunked index where each chunk stores its source document ID.
VECTOR_FIELD = "<your-vector-field>"  # requires a vectorizer on the vector field (integrated vectorization)
PARENT_FIELD = "<your-parent-id-field>"  # retrievable field holding the source document ID
CANDIDATES = 50   # the semantic ranker only sees the top 50
CONTEXT_SIZE = 5  # chunks your app actually sends to the model
ANSWERS_IT = 2    # label at or above this counts as "contains the answer"

client = SearchClient(SEARCH_ENDPOINT, INDEX_NAME, DefaultAzureCredential())


def run(question: str, rerank: bool) -> tuple[list[dict], float]:
    """Production hybrid query, with or without the semantic ranker."""
    options = {}
    if rerank:
        options = {
            "query_type": "semantic",
            "semantic_configuration_name": SEMANTIC_CONFIG,
            "semantic_error_mode": "fail",  # an outage should stop the test, not skew it
        }
    started = time.perf_counter()
    results = client.search(
        search_text=question,
        vector_queries=[
            VectorizableTextQuery(text=question, k_nearest_neighbors=CANDIDATES, fields=VECTOR_FIELD)
        ],
        select=[PARENT_FIELD],
        top=CANDIDATES,
        **options,
    )
    chunks = [
        {"parent_id": r[PARENT_FIELD], "reranker": r.get("@search.reranker_score")}
        for r in results
    ]
    return chunks, (time.perf_counter() - started) * 1000


def hit(chunks: list[dict], answer_ids: set[str]) -> bool:
    return any(c["parent_id"] in answer_ids for c in chunks[:CONTEXT_SIZE])


outcomes = Counter()
base_ms, rerank_ms = [], []
with open("golden_set.jsonl", encoding="utf-8") as f:
    for line in f:
        item = json.loads(line)
        answer_ids = {d for d, label in item["labels"].items() if label >= ANSWERS_IT}
        if not answer_ids:
            continue  # unanswerable questions belong to the threshold test, not this one

        base, base_time = run(item["question"], rerank=False)
        ranked, ranked_time = run(item["question"], rerank=True)
        base_ms.append(base_time)
        rerank_ms.append(ranked_time)

        before, after = hit(base, answer_ids), hit(ranked, answer_ids)
        if after and not before:
            outcome = "rescued"
        elif before and not after:
            outcome = "hurt"
        else:
            outcome = "no change (hit)" if before else "no change (miss)"
        outcomes[outcome] += 1
        if outcome in ("rescued", "hurt"):
            print(f"[{outcome}] {item['question']}")

print(dict(outcomes))
print(f"median latency: {median(base_ms):.0f} ms without, {median(rerank_ms):.0f} ms with")
```

A few notes on reading it. The latency numbers are client-side and include network time, so compare the two medians with each other rather than with anyone else's numbers. Run it from the same region as your app. Half the calls go through the ranker, so a 100-question run uses 100 semantic requests from your monthly allowance. And "no change (miss)" questions are the ones reranking can't fix. They go back to the retrieval triage.

## Reading the result

If rescued questions clearly outnumber hurt ones and they're questions your users actually ask, keep the reranker on. In my experience that's where it pays off: natural-language questions over long-form prose such as policies, contracts and manuals, where a ranker reading the whole passage has the most to work with.

If almost everything is "no change (hit)", the reranker isn't changing what the model sees for your traffic. Before turning it off, check two things.

**Is your context budget hiding the effect?** At `CONTEXT_SIZE = 10` the baseline often already includes the right chunk, so reranking looks useless. At three it might matter a lot. Rerun at the context size you'd *like* to use. One honest reason to keep reranking is that it lets you send fewer chunks, which can save more in generation tokens than the ranker costs. I covered that trade-off in [A Token Waste Audit: Cut What the Answer Doesn't Use](/blog/2026-03-13-cost-discipline-for-llm-apps-reducing-token-waste-without-hurting-answer-quality/).

**Are you using the score as a gate?** Reordering is only one job. The other is abstention: dropping chunks below a reranker score threshold, and answering "I don't know" when nothing survives. BM25 and RRF scores aren't comparable across queries, so they make poor gates. The 0 to 4 reranker score is far easier to threshold. If your grounding gate depends on it, the reranker is earning its place even on questions where the order didn't change. Calibrate that threshold on your own labelled set, including the unanswerable questions this script skips. Microsoft has shifted the score distribution before (July 2023), and the overview [warns](https://learn.microsoft.com/azure/search/semantic-search-overview#how-results-are-scored) that ranking model updates can move it again, so treat any fixed number as something you re-test, not a constant.

## Rerank selectively, not globally

Often the honest answer is "it depends on the query". That's when I route. Some query shapes rarely benefit from reranking:

| Query shape | Why reranking rarely changes the outcome | What I'd do instead |
|---|---|---|
| Identifiers and codes (`INV-20391`, `KB5034441`, an error code) | BM25 already puts the exact match first | Keyword or hybrid query without the ranker |
| Filter-driven lookups ("open incidents for site 12") | Filters do the work; few candidates come back | Structured filter, no ranker |
| Very short navigational queries ("leave policy") | Little query text for the ranker to work with | Hybrid with a title boost |
| Natural-language questions over prose | This is the ranker's home ground | Semantic ranker on |

A router doesn't need an LLM. A regex for identifier patterns and a check for whether the request is filter-only gets you most of the way, and the A/B script will tell you whether the routing helped. This fragment shows the shape. It plugs into the `run` call above:

```python
# Fragment: decide per query whether the semantic ranker is worth calling.
import re

IDENTIFIER = re.compile(r"\b[A-Z]{2,}[-_]?\d{3,}\b|\b0x[0-9A-Fa-f]+\b")


def should_rerank(question: str, has_filters: bool) -> bool:
    words = question.split()
    if IDENTIFIER.search(question):
        return False  # exact-match lookups: BM25 already wins
    if has_filters and len(words) <= 6:
        return False  # filter-driven lookup: the filter does the work, not the text
    return len(words) >= 4  # enough language for the ranker to read
```

Treat the thresholds in there as starting points to test, not rules. Measure the rescued and hurt counts for each route separately. Routing is only worth its complexity if the skipped route really shows "no change" and the latency or request savings matter to you.

There's also a middle option before routing. The `semantic_query` parameter lets you send the ranker different text from the retrieval query. If your app rewrites or expands the user's question for retrieval, rerank against the user's original wording instead. The [semantic query how-to](https://learn.microsoft.com/azure/search/semantic-how-to-query-request) covers the parameter.

## Production settings that matter more than the model

Two SDK parameters decide how the reranker behaves on a bad day, and I'd set both deliberately:

- **`semantic_error_mode`**: `"fail"` makes a ranker failure fail the whole query. `"partial"` returns the base BM25 or RRF results instead, with a response reason telling you why. For the A/B test, use `"fail"`. In production, I prefer `"partial"` plus logging. Answering from slightly worse ranking beats returning an error, as long as your score gate knows there won't be reranker scores to check.
- **`semantic_max_wait_in_milliseconds`**: an upper bound on how long semantic processing can take. Combined with `"partial"`, it turns the ranker into an optional improvement with a latency budget rather than a hard dependency.

Then check billing. The semantic ranker has two plans. The free plan gives a monthly allowance of requests, and once the allowance runs out, semantic requests return a billing error until next month. The standard plan, which needs the Basic tier or higher, switches to pay-as-you-go after the allowance. The [billing plan page](https://learn.microsoft.com/azure/search/semantic-how-to-enable-disable) covers both plans. A production app that hits the free plan's limit mid-month is an avoidable surprise, so put production services on the standard plan and alert on semantic errors either way.

## When I'd skip the test entirely

- **The candidate set is tiny.** If filters routinely narrow results to a handful of chunks and you send all of them, there's nothing to reorder.
- **Retrieval is the platform's job.** Azure AI Search agentic retrieval (preview) semantically reranks every subquery's results as part of the service. You compare the knowledge base against your own pipeline as a whole, which I covered in [Agentic Retrieval or a Hand-Built RAG Pipeline?](/blog/2026-02-02-rag-systems-that-work/)
- **You have fewer than about thirty labelled questions.** Two rescued and one hurt doesn't prove anything. Build the set first.

## What I'd do this week

Run the A/B script at the context size you want, not the one you have. If rescued clearly outnumbers hurt, keep the ranker, switch production to `"partial"` with a wait limit, and calibrate the score gate. If it's mostly "no change", decide whether you're keeping it for the gate or for nothing. If only some query shapes benefit, route. Spend on reranking where you can say what each semantic request buys you.
