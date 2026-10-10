---
title: "Seven RAG Failure Modes and the Pattern That Fixes Each"
description: "Diagnose why a RAG system fails before adding patterns: hybrid search, semantic reranking, grounding gates and citations on Azure AI Search, mapped to failures."
author: Michael John Peña
draft: false
date: 2026-01-07
tags:
  - RAG
  - Azure AI Search
  - Hybrid Search
  - Architecture
  - Python
---

Most RAG systems that disappoint in production were not built badly. Someone added patterns in tutorial order instead of starting from the failure in front of them. Hybrid search, reranking, query decomposition and compression each fix one specific problem, and each adds latency, cost or moving parts. If you can't name the failure a pattern fixes, you're paying for it without getting anything back.

Examples use Azure AI Search and Azure OpenAI as of January 2026; the reasoning carries over to any stack.

## The baseline everyone starts with

The naive pipeline is the same everywhere. Embed the question, take the top five vector matches, paste them into a prompt and ask the model to answer. It demos well because demo questions are written by the person who loaded the documents.

It breaks when real users show up. They ask for part numbers, mix two questions into one sentence, and ask things your corpus can't answer. None of those failures are fixed by a better model. My rule of thumb: fix retrieval before you touch the model. A strong model given the wrong passages produces a fluent wrong answer, and that's worse than no answer.

## 1. Exact terms go missing

**Symptom:** a user searches for an error code, a SKU or a clause number and gets back passages that are about the right topic but don't contain the string they typed.

**Fix:** hybrid search. Run a keyword (BM25) query and a vector query together and merge the results. Azure AI Search does this natively: send `search_text` and a vector query in the same request and the service fuses the two ranked lists with [Reciprocal Rank Fusion](https://learn.microsoft.com/azure/search/hybrid-search-ranking). RRF combines rank positions, not raw scores, so you don't need to normalise BM25 and cosine similarity onto one scale. If one signal should dominate, the Python SDK exposes a `weight` on each vector query. `weight` applies to vector queries only; to favour keywords, set the vector weight below 1.0.

**When not to bother:** a small corpus of conversational prose with no identifiers, codes or proper nouns. That's rarer than people think. Most enterprise content is full of identifiers, which is why I treat hybrid as the default and pure vector as the exception you have to justify. I covered the index setup in [Azure AI Search: Implementing Hybrid Search for Better RAG Results](/blog/2025-11-09-november-ai-topic/).

## 2. The right passage is retrieved but ranked too low

**Symptom:** when you log the top 50 candidates, the answer is in there at position 14, but you only send five chunks to the model.

**Fix:** a second-stage reranker. First-stage retrieval is tuned for recall and speed. A cross-encoder reads the query and each candidate together, which is slower but far more precise. On Azure AI Search that's the [semantic ranker](https://learn.microsoft.com/azure/search/semantic-search-overview), which reranks the top 50 results from the BM25 or RRF stage and returns a `@search.rerankerScore` (exposed as `@search.reranker_score` in the Python SDK's result dict) between 0 and 4. Off Azure AI Search, or when you need control over the model, self-host an open cross-encoder such as `cross-encoder/ms-marco-MiniLM-L-12-v2` and own the compute and latency yourself.

Semantic ranking only runs when the query asks for it (`query_type="semantic"` plus a semantic configuration). New services start on the free plan, which allows 1,000 semantic requests a month and then returns a billing error. To keep going you switch the service to the standard plan, which bills per 1,000 requests, so budget for it before you make it a default.

**When not to bother:** when your logs show the answer is almost always already in the top three. Reranking costs time and money on every query, so measure it before you add it. [Reranking Strategies: Improving RAG Precision](/blog/2025-03-14-reranking-strategies/) goes deeper on the options.

## 3. The model answers confidently from irrelevant context

**Symptom:** for a question your corpus doesn't cover, the system still produces a plausible answer stitched together from loosely related chunks.

**Fix:** a grounding gate. Decide *before* generation whether you have anything worth answering from, and if you don't, say so.

Most grounding gates threshold the wrong number. Hybrid RRF scores are small rank-derived values, and cosine similarities cluster differently for every embedding model, so a threshold like "average score below 0.7" means nothing.

The semantic ranker's score is far better suited to this because it has a documented scale: 4 means the passage answers the question completely, 2 means somewhat relevant, and 0 means irrelevant. I start the gate at 2.0 and tune it against logged queries.

One trap: when the semantic ranker is overloaded, times out or hits a transient failure, the default partial mode returns results with no reranker score at all. If your code coerces that missing score to zero, every query is quietly refused as "nothing relevant" and nobody learns the ranker is down. Ask for a hard failure instead (`semantic_error_mode="fail"`) and treat a missing score as an error, not a low score.

Here is the retrieval step with hybrid search, semantic reranking and the gate together, using `azure-search-documents` 11.6.0 (GA in October 2025, targeting the 2025-09-01 REST API). It assumes an index with a vectoriser configured on `content_vector`, so the service embeds the query text itself, and a semantic configuration named `default`. Keyless auth needs role-based access enabled on the search service, Search Index Data Reader for the calling identity, and Cognitive Services OpenAI User on the Azure OpenAI resource.

```python
# rag_retrieval.py
# pip install azure-search-documents==11.6.0 azure-identity openai==2.14.0
from azure.identity import DefaultAzureCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizableTextQuery

SEARCH_ENDPOINT = "https://<your-search-service>.search.windows.net"
INDEX_NAME = "<your-index-name>"
MIN_RERANKER_SCORE = 2.0  # 0-4 scale; 2.0 = "somewhat relevant"

credential = DefaultAzureCredential()
search_client = SearchClient(SEARCH_ENDPOINT, INDEX_NAME, credential)


def retrieve(question: str, max_passages: int = 5) -> list[dict]:
    """Hybrid search + semantic reranking, keeping only passages above the gate."""
    vector_query = VectorizableTextQuery(
        text=question,
        k_nearest_neighbors=50,
        fields="content_vector",
    )
    results = search_client.search(
        search_text=question,             # BM25 leg of the hybrid query
        vector_queries=[vector_query],    # vector leg, embedded by the index vectoriser
        query_type="semantic",
        semantic_configuration_name="default",
        select=["id", "title", "url", "content"],
        top=50,                           # give the semantic ranker its full 50 candidates
        semantic_error_mode="fail",       # raise instead of silently returning unranked results
    )

    passages = []
    for result in results:
        score = result.get("@search.reranker_score")
        if score is None:
            # Defensive: with semantic_error_mode="fail" the SDK should already have raised.
            # A missing score means semantic ranking didn't run; don't treat it as "irrelevant".
            raise RuntimeError("Semantic ranker returned no score; check quota and service health.")
        if score >= MIN_RERANKER_SCORE:
            passages.append(
                {
                    "title": result["title"],
                    "url": result["url"],
                    "content": result["content"],
                    "score": score,
                }
            )
    # Results come back in reranker order; keep the best few.
    return passages[:max_passages]
```

## 4. Multi-part questions get half an answer

**Symptom:** "How does our leave policy differ between Australia and New Zealand, and who approves exceptions?" retrieves the Australian policy and nothing else.

**Fix:** query decomposition. Split the question into sub-queries, retrieve for each, and answer from the union. You can build this yourself with an extra LLM call, or use what the platform offers. Azure AI Search currently has two related features, both in **preview**, and only one of them decomposes. [Query rewrite](https://learn.microsoft.com/azure/search/semantic-how-to-query-rewrite) generates alternative phrasings of the query alongside the semantic ranker. That helps when users and documents use different vocabulary, but it doesn't split a two-part question into two searches. [Agentic retrieval](https://learn.microsoft.com/azure/search/agentic-retrieval-overview) is the platform feature that actually decomposes: its query planning uses an LLM to break the question into sub-queries and runs them in parallel. Its API changed in the 2025-11-01-preview, when knowledge agents were renamed knowledge bases, breaking routes and properties. Treat it as something to prototype on, not something to build a production contract around yet.

**When not to bother:** most real queries are single-intent. Decomposition adds an LLM call before retrieval even starts, which you'll feel in time-to-first-token. Route only the questions that need it. A cheap classifier or a simple heuristic, such as several question marks or "and" joining two clauses, is usually enough. [Query Transformation Techniques](/blog/2025-03-15-query-transformation-techniques/) covers the variants.

## 5. Chunks lose the context that made them meaningful

**Symptom:** a retrieved chunk says "this limit applies to all regions" and nobody, model included, can tell which limit or which product.

**Fix:** structure-aware chunking. Split on headings and sections rather than a fixed token count, keep small sections whole, and carry the document title and section heading into each chunk's metadata, or into the chunk text itself. On Azure AI Search the [Document Layout skill](https://learn.microsoft.com/azure/search/cognitive-search-skill-document-intelligence-layout), which went GA in the 2025-09-01 API, produces chunks aligned to document structure during indexing, so you don't have to maintain your own parser. It's billable: beyond 20 documents per indexer per day you need to attach a billable Microsoft Foundry resource to the skillset and pay for the Document Intelligence calls.

**When not to bother:** you can't skip chunking, but you can skip the clever version when documents are short and uniform, such as FAQ entries or support tickets. One record per chunk is fine there.

I'd spend more time on chunking than on any other part of the pipeline. It is the one decision you can't fix at query time. Re-chunking means re-indexing everything.

## 6. Context bloat drowns the useful passage

**Symptom:** you send twenty chunks "to be safe", the model latches onto the wrong one, and every call costs more than it should.

**Fix:** send fewer, better passages. A common recommendation is sentence-level compression: score each sentence by embedding similarity and keep the top three. I don't recommend it. Sentence extraction strips out the qualifiers ("except in Western Australia", "unless approved in writing") that matter most in enterprise answers. A reranker plus a hard cap on passage count gets you most of the token savings without breaking meaning. In the code above, `max_passages=5` in `retrieve()` is that cap. Raise it to eight or ten only when your section-sized chunks are short and the answer often spans several of them. Use LLM-based compression only when individual chunks are long and the cap alone can't keep you inside your budget.

**When not to bother:** if your chunks are already section-sized and you're sending five or fewer, compression is optimising a problem you don't have.

## 7. Nobody can check the answer

**Symptom:** users stop trusting the system after one wrong answer, because they can't see where any answer came from.

**Fix:** number the passages, tell the model to cite them, and return only the sources it actually cited. The generation half continues the same file. It uses the `AzureOpenAI` client with Entra ID auth against a non-reasoning deployment such as gpt-4.1, on the 2024-10-21 GA API version. It refuses when the gate from failure mode 3 left nothing to answer from, and it tells a search outage apart from "nothing relevant". I pin the dated 2024-10-21 GA version here for a stable contract; the v1 API (OpenAI client pointed at /openai/v1/) is Microsoft's recommended path for new code and drops the api_version parameter.

```python
# rag_retrieval.py (continued)
import re

from azure.core.exceptions import HttpResponseError
from azure.identity import get_bearer_token_provider
from openai import AzureOpenAI

token_provider = get_bearer_token_provider(
    credential, "https://cognitiveservices.azure.com/.default"
)
llm = AzureOpenAI(
    azure_endpoint="https://<your-openai-resource>.openai.azure.com",
    azure_ad_token_provider=token_provider,
    api_version="2024-10-21",
)
CHAT_DEPLOYMENT = "<your-chat-deployment-name>"

SYSTEM_PROMPT = (
    "Answer only from the numbered sources provided. Cite every claim with its "
    "source number in square brackets, for example [1] or [2][3]. If the sources "
    "do not contain the answer, reply exactly: I don't know based on the available documents."
)


def answer(question: str) -> dict:
    try:
        passages = retrieve(question)
    except HttpResponseError as e:
        # 4xx other than 429 is a configuration fault (wrong semantic configuration name,
        # missing RBAC role): raise it rather than disguise it as an outage.
        if e.status_code and 400 <= e.status_code < 500 and e.status_code != 429:
            raise
        # Throttling, 5xx or a failed semantic ranker (semantic_error_mode="fail").
        # Report an outage, not "nothing relevant", and alert on it.
        return {
            "answer": "Search is temporarily unavailable. Please try again shortly.",
            "sources": [],
        }
    except RuntimeError:
        # retrieve() found results with no reranker score: semantic ranking didn't run.
        return {
            "answer": "Search is temporarily unavailable. Please try again shortly.",
            "sources": [],
        }
    if not passages:
        return {
            "answer": "I couldn't find anything relevant enough to answer that. "
            "Try rephrasing, or ask about a specific policy or product.",
            "sources": [],
        }

    numbered = "\n\n".join(
        f"[{i}] {p['title']}\n{p['content']}" for i, p in enumerate(passages, start=1)
    )
    response = llm.chat.completions.create(
        model=CHAT_DEPLOYMENT,
        # Reasoning deployments (o3, o4-mini, GPT-5 family) reject temperature other than
        # the default: omit it and use 2025-04-01-preview or later, or the v1 API.
        temperature=0,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Sources:\n{numbered}\n\nQuestion: {question}"},
        ],
    )
    text = response.choices[0].message.content or ""

    cited = sorted({int(n) for n in re.findall(r"\[(\d+)\]", text)})
    sources = [
        {"id": n, "title": passages[n - 1]["title"], "url": passages[n - 1]["url"]}
        for n in cited
        if 1 <= n <= len(passages)
    ]
    return {"answer": text, "sources": sources}


if __name__ == "__main__":
    result = answer("<a question your documents can answer>")
    print(result["answer"])
    for source in result["sources"]:
        print(f"[{source['id']}] {source['title']} - {source['url']}")
```

Returning only cited sources matters more than it looks. A list of five "related documents" under every answer teaches users to ignore citations. A short list where every entry backs a specific sentence teaches them to click.

**When not to bother:** never, for anything user-facing. If an answer can't be traced to a source, it shouldn't ship.

## Where to start

Don't adopt all seven patterns at once. Log the full candidate list, the reranker scores and the final answer for every query, then take a sample of the ones users were unhappy with and label each by failure mode. The distribution tells you what to build next. In my experience it's usually hybrid search and the grounding gate first, chunking second, and decomposition much later than people expect.

My defaults for a new system on Azure AI Search are hybrid search, semantic ranking, a reranker-score gate, structure-aware chunks and cited sources, all on GA features. I keep query rewrite and agentic retrieval behind a feature flag until they leave preview. Then I measure. [RAG Evaluation: Measuring Retrieval-Augmented Generation Quality](/blog/2024-03-18-rag-evaluation/) covers the metrics, and a weekly review of thumbs-down answers will catch problems no offline test set predicted.
