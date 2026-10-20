---
title: "A RAG Maturity Model: Diagnosing Where Your System Falls Short"
description: "A five-level RAG maturity model for Azure AI Search and Azure OpenAI, covering what each level fixes, what it costs, and when to stop climbing."
author: Michael John Peña
draft: false
date: 2024-01-06
tags:
  - RAG
  - Architecture
  - Azure AI Search
  - Vector Search
  - Enterprise AI
---

I've seen hundreds of RAG prototypes. Most of them look great in a demo and then fall apart in the first week of real use, and the cause is rarely the language model. The gap between a demo and a production system usually comes down to three things: retrieval quality, content freshness, and whether anyone can see what the system is doing. A maturity model is useful because it turns a vague "the answers are bad" into a specific question: which level are we at, and what is the next problem worth fixing?

This is not a checklist where Level 5 is the goal for everyone. Each level adds cost and moving parts. The point is to know which failure you're actually seeing and to climb only as far as that failure requires.

## Why a maturity model rather than a reference architecture

If you want the component view of a RAG system (ingestion, index, orchestrator, model), I covered that in [RAG Architecture Patterns](/blog/2023-02-01-rag-architecture-patterns/). Reference architectures tell you what the boxes are. They don't tell you which box is causing your current problem, or what to build next with a fixed budget.

The model below is organised by symptom. Each level exists because the one below it fails in a recognisable way.

| Level | Name | What it adds | The symptom that tells you to move up |
|---|---|---|---|
| 1 | Naive vector RAG | Embed, top-k similarity, stuff the prompt | Misses exact terms: product codes, policy numbers, acronyms |
| 2 | Hybrid retrieval | Keyword + vector, citations | Right documents retrieved, wrong ones ranked first |
| 3 | Reranked and filtered | Semantic reranking, relevance threshold, security filters | Multi-part questions get half an answer |
| 4 | Query-aware | Query rewriting and decomposition | Nobody can say whether a change made things better |
| 5 | Operated | Evaluation, monitoring, freshness, fallbacks | Stay here; improve by measurement |

## Level 1: naive vector RAG

Embed the question with `text-embedding-ada-002`, pull the top five chunks by cosine similarity, paste them into the prompt. Every tutorial starts here, and that's fine for proving the idea has value.

It fails in a predictable way on enterprise content. Embeddings are good at meaning and poor at exact strings. Ask about "form SR-204" or a specific error code and the nearest neighbours are often documents that are *about* similar forms rather than the one that contains the code. There's also no notion of "nothing relevant was found": top-k always returns k results, so the model always gets context, relevant or not.

My rule of thumb: if your users search for identifiers, names, or jargon, Level 1 is a demo, not a product.

## Level 2: hybrid retrieval with citations

Hybrid search runs a BM25 keyword query and a vector query in the same request and merges the two result lists with Reciprocal Rank Fusion. In Azure AI Search (renamed from Azure Cognitive Search in November 2023) vector search and hybrid queries became generally available with the [2023-11-01 REST API](https://learn.microsoft.com/azure/search/whats-new), and the stable `azure-search-documents` 11.4.0 Python package exposes it through `VectorizedQuery`. I went through the fusion mechanics in [Hybrid Retrieval Patterns for RAG Applications](/blog/2023-05-25-hybrid-retrieval-patterns/).

The second half of Level 2 is citations. Ask the model to cite the source of each claim, and return the source metadata to the UI. Citations are not decoration. They are how users learn to trust the system, and how you find out, from the first support ticket, which chunk misled it.

Chunking is the other lever at this level, and the most common hidden cause of Level 1 to 3 symptoms. Chunks that are too small lose context, chunks that are too large dilute the embedding, and chunks without their document title and section header can't be matched or cited properly. Start with a few hundred tokens and some overlap, carry the title and headers into each chunk, and change the settings only when your evaluation set says so.

Hybrid is the single highest-value step in this model. If you do nothing else this quarter, do this.

## Level 3: reranking, thresholds, and filters

At Level 2 the right document is usually *somewhere* in the top 50, just not in the top 3 you send to the model. Level 3 fixes ordering and noise.

[Semantic ranker](https://learn.microsoft.com/azure/search/semantic-search-overview), which also went GA in November 2023, takes the top 50 results from the BM25 or hybrid query and rescores them with a cross-encoder-style model. Each result gets a `@search.reranker_score` from 0 to 4, where 4 means highly relevant. That score is the first thing in the stack that is comparable across queries, which makes a relevance threshold possible: if nothing scores above your cut-off, tell the user you don't know instead of letting the model improvise. (I covered reranking more generally in [Re-ranking Search Results](/blog/2023-02-05-reranking-results/).)

Here is Level 3 retrieval with the SDKs as they stand today: `azure-search-documents` 11.4.0 and the `openai` 1.x Python library against Azure OpenAI.

```python
import os

from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery
from openai import AzureOpenAI

aoai = AzureOpenAI(
    azure_endpoint="https://<your-openai-resource>.openai.azure.com",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version="2023-12-01-preview",
)

search = SearchClient(
    endpoint="https://<your-search-service>.search.windows.net",
    index_name="<your-index-name>",
    credential=AzureKeyCredential(os.environ["AZURE_SEARCH_API_KEY"]),
)

RERANKER_THRESHOLD = 2.0  # 0-4 scale; tune against your own test set


def retrieve(question: str, user_groups: list[str], top: int = 5) -> list[dict]:
    embedding = aoai.embeddings.create(
        model="<your-ada-002-deployment>",  # Azure OpenAI deployment name
        input=question,
    ).data[0].embedding

    vector_query = VectorizedQuery(
        vector=embedding,
        k_nearest_neighbors=50,
        fields="content_vector",
    )

    # Security trimming: only return chunks the caller's groups can see.
    # Escape single quotes for OData and use an explicit comma delimiter, so
    # group names containing spaces or apostrophes can't split or break the filter.
    group_list = ",".join(g.replace("'", "''") for g in user_groups)
    results = search.search(
        search_text=question,
        vector_queries=[vector_query],
        query_type="semantic",
        semantic_configuration_name="default",
        filter=f"group_ids/any(g: search.in(g, '{group_list}', ','))",
        select=["chunk_id", "title", "content", "source_url"],
        top=50,
    )

    passed = [
        {
            "title": r["title"],
            "content": r["content"],
            "source": r["source_url"],
            "score": r["@search.reranker_score"],
        }
        for r in results
        if (r.get("@search.reranker_score") or 0) >= RERANKER_THRESHOLD
    ]
    return passed[:top]


if __name__ == "__main__":
    hits = retrieve("What is the approval limit for form SR-204?", ["finance-staff"])
    if not hits:
        print("No sufficiently relevant content found.")
    for h in hits:
        print(f"{h['score']:.2f}  {h['title']}  {h['source']}")
```

The script assumes an index with a `content_vector` field, a `group_ids` collection field, and a semantic configuration named `default`.

Two cautions. First, don't copy my threshold. Microsoft's documentation notes the reranker score distribution changed in July 2023, so any threshold you hard-code needs to be validated against your own labelled questions. Second, the security filter belongs at this level, not later. If your index mixes content with different audiences and you don't trim at query time, no amount of prompt engineering will stop the model from quoting a document the user shouldn't see.

Semantic ranker is [available on Basic tier and above](https://learn.microsoft.com/azure/search/semantic-how-to-enable-disable). The free plan covers 1,000 semantic queries a month, after which you need the standard (pay-as-you-go) plan, so size it against your query volume before turning it on for every request.

## Level 4: query-aware retrieval

Levels 1 to 3 treat the user's question as the search query. That breaks on questions like "How does our parental leave policy compare between Australia and New Zealand?", which needs two retrievals and a synthesis, or on conversational follow-ups like "what about contractors?", which mean nothing without the chat history.

Level 4 adds a cheap model call before retrieval to rewrite the question into one or more standalone search queries, then retrieves for each and de-duplicates. `gpt-35-turbo` (1106) or GPT-4 Turbo (`1106-preview`, still a preview model that Microsoft doesn't recommend for production) both support [JSON mode](https://learn.microsoft.com/azure/ai-services/openai/how-to/json-mode), added in API version `2023-12-01-preview`, which makes the rewrite output easy to parse reliably. The cheaper 3.5 model is usually enough for query rewriting.

When not to do this: if most of your traffic is single-hop lookups, query decomposition adds latency and a second model bill for no gain. Measure the share of multi-part and follow-up questions in your logs before building it. Standalone-question rewriting for chat history is almost always worth it; full decomposition often isn't.

## Level 5: operating the system

Level 5 is less about new retrieval tricks and more about knowing whether the system is working.

- **Evaluation set.** A few hundred real questions with known good sources and answers. Every change to chunking, embedding, prompts, or thresholds runs against it. Without this, Levels 2 to 4 are guesswork.
- **Quality metrics.** Groundedness, relevance, and retrieval hit rate tracked over time. Prompt flow in Azure Machine Learning and Azure AI Studio (both in preview; AI Studio since Ignite) includes built-in [evaluation flows](https://learn.microsoft.com/azure/machine-learning/prompt-flow/how-to-bulk-test-evaluate-flow) for groundedness and relevance that you can run in bulk against a test set.
- **Freshness.** An indexer schedule or change-tracking pipeline, plus a "last indexed" timestamp on every chunk. Stale answers erode trust faster than wrong ones, and they are invisible unless you surface the date. Integrated vectorization, in preview since November 2023 through the `2023-10-01-Preview` API, lets an indexer chunk and embed content itself, which removes a custom pipeline to keep in sync; I'd treat it as preview and keep it out of anything with an SLA for now.
- **Telemetry.** Log the question, the retrieved chunk IDs with scores, the prompt token count, latency, and user feedback. When an answer is wrong, you need to know whether retrieval or generation failed.
- **Fallbacks.** Retry Azure OpenAI throttling (HTTP 429) with exponential back-off that honours the `retry-after` header. The `openai` 1.x client already does this for you (`max_retries`, default 2), so raise that number rather than wrapping it in a second retry loop. Add a secondary deployment or region for availability, and a keyword-only search path if the embedding call fails.

Caching deserves a warning. Exact-match caching of answers is safe for a public FAQ bot. For anything with security trimming, a cache keyed only on the question will serve one user's answer to another. Key on the question plus the caller's effective permissions, or don't cache answers at all.

## Where to stop

Most internal knowledge assistants I'd put into production sit at a solid Level 3 with the Level 5 basics: an evaluation set, telemetry, and freshness. That combination fixes the majority of bad answers. Query decomposition is worth it when your logs show complex questions; otherwise it's complexity you'll pay for in latency and cost.

If you're deciding what to do next, ask which symptom from the table you're actually seeing, fix that one, and measure against your evaluation set before moving on. Skipping straight to Level 4 query decomposition on top of naive Level 1 retrieval is the most expensive mistake in this space, because the model gets cleverer at reasoning over the wrong documents.
