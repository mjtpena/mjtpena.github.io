---
title: "Agentic Retrieval or a Hand-Built RAG Pipeline? How I Decide"
description: "Azure AI Search knowledge bases now plan queries for you, in preview. When to hand over the RAG pipeline, when to keep building it, and how to test both."
author: Michael John Peña
draft: false
date: 2026-02-02
tags:
  - RAG
  - Azure AI Search
  - Architecture
  - AI Agents
  - Python
---

Good RAG has never been about the vector database or the embedding model. It's about the pipeline around them: how you chunk, rewrite the query, combine keyword and vector results, rerank, and decide when nothing relevant came back. Until recently, building that pipeline was your job. Azure AI Search now offers to do most of it for you through agentic retrieval and knowledge bases, which raises a practical question for anyone designing a RAG system this quarter: which parts do you hand over, and which do you keep?

If you want the pattern-by-pattern view of what each stage fixes, start with [Seven RAG Failure Modes and the Pattern That Fixes Each](/blog/2026-01-07-rag-patterns-production/); here I'm assuming you know the stages and asking who should own them.

## What the hand-built pipeline looks like

The pipeline most teams build on Azure AI Search today runs entirely on generally available features:

1. **Ingest:** structure-aware chunks with title and section metadata, embedded at indexing time (integrated vectorization or your own code).
2. **Query:** optional LLM rewrite or decomposition in your app.
3. **Retrieve:** a [hybrid query](https://learn.microsoft.com/azure/search/hybrid-search-overview) that runs BM25 and vector search in parallel and merges them with Reciprocal Rank Fusion.
4. **Rerank:** the semantic ranker over the top 50 results.
5. **Gate:** drop anything below a reranker score threshold, and say "I don't know" when nothing survives.
6. **Generate:** a grounded prompt that requires citations.

Every stage is visible in your code. You can log the exact query that ran, the scores that came back and the passages the model saw. When an answer is wrong, you can tell whether retrieval or generation failed. That transparency is the main reason I still default to it.

The cost is that steps 2 and 5 are yours to build and maintain, and step 2 is where most teams stop. Their pipeline sends the raw user message to search, so a question like "compare the leave policy for contractors with the one for permanent staff" becomes one blended query that finds half the answer.

## What agentic retrieval takes over

[Agentic retrieval](https://learn.microsoft.com/azure/search/agentic-retrieval-overview) moves query planning into the search service. You create **knowledge sources** (the content) and a **knowledge base** (the orchestrator that points at those sources and, optionally, an Azure OpenAI model). Your app calls the knowledge base's `retrieve` action with the conversation. The service uses the LLM to break the question into subqueries, runs them in parallel against the selected sources, semantically reranks each result set, and returns merged grounding content with references and an activity log.

A few facts about where this stands in February 2026:

- **It's preview.** It first appeared at Build in May 2025 as "knowledge agents". The current API is `2025-11-01-preview`, which renamed knowledge agents to knowledge bases and broke routes and properties along the way. The [migration guide](https://learn.microsoft.com/azure/search/agentic-retrieval-how-to-migrate) lists the breaking changes, and there are a lot of them: two breaking releases in the first six months of preview.
- **Knowledge source types** in that version are search index, Azure Blob, indexed OneLake, indexed SharePoint, remote SharePoint and web. Not every type can be created in the Azure portal yet, so plan on creating sources through code.
- **Reasoning effort** controls how much LLM work happens. `minimal` skips LLM query planning and sends your query straight to every source. `low` (the default) runs one pass of query planning and source selection. `medium` adds a semantic classifier that checks whether the results are good enough and, if not, runs one follow-up iteration with a revised plan. The [reasoning effort docs](https://learn.microsoft.com/azure/search/agentic-retrieval-how-to-set-retrieval-reasoning-effort) cover the constraints, including that `minimal` only supports extractive output. The limits differ by level too: `minimal` searches every source in the knowledge base (up to 10), `low` caps out at three subqueries across three knowledge sources, and `medium` at five across five. `medium` is also only available in select regions (no Australian region as of February 2026), so check the region list in the reasoning effort docs before you plan around it.
- **Output mode** is either `extractiveData`, which returns grounding content for your own model call, or `answerSynthesis`, where the knowledge base's LLM writes a cited answer itself.
- **Billing comes from two places.** Search charges for the tokens it reranks, with a monthly free allowance, and Azure OpenAI bills the planning and synthesis tokens to your model deployment. Since November 2025, semantic ranker and agentic retrieval are also available on the free search tier in some regions, which makes prototyping cheap.

The same knowledge bases sit behind Foundry IQ (also preview) for agents in Foundry Agent Service, which is why I expect this API to keep getting attention. Expect it to keep changing too.

## The trade-off, side by side

| Concern | Hand-built pipeline | Agentic retrieval (knowledge base) |
|---|---|---|
| Release status | GA features throughout | Preview, with breaking changes between versions |
| Multi-part and follow-up questions | Only if you build decomposition | Query planning handles them at `low` and `medium` |
| Multiple sources | Your app queries each index and merges | One call fans out across knowledge sources (three at `low`, five at `medium`) |
| Document-level security | Your filters | Depends on knowledge source type (ACL ingestion or user-identity queries) |
| Debuggability | Every query and score in your logs | Activity log shows subqueries and token use; planning logic is the service's |
| Latency | One search round trip plus generation | Adds an LLM planning call at `low` and `medium` (none at `minimal`), plus a possible second pass at `medium` |
| Cost model | Per-query semantic ranker charges | Token-based reranking plus planning tokens |
| Prompt and answer control | Fully yours | Yours with `extractiveData`; shared with `answerSynthesis` |
| SDK support | Stable `azure-search-documents` 11.6.0 | Preview packages, such as Python 11.7.0b2 |

The table looks balanced, but the rows aren't equally important. For most enterprise RAG systems I'd rank release status and debuggability first, then question complexity, then everything else.

## Test it against your own questions first

Don't decide from a demo. The cheapest useful experiment is to point a knowledge base at the index you already have and replay the questions your current pipeline gets wrong. A search index knowledge source reuses your existing index, so there's nothing to re-ingest.

This script sends the same question at `minimal` and `low` reasoning effort, both in extractive mode, and prints what the service did. It uses the REST API directly because the preview SDKs have been renaming types between releases. It assumes you've already created a knowledge base with a model configured and a search index knowledge source attached, and that your identity has the Search Index Data Reader role.

```python
import time

import requests
from azure.identity import DefaultAzureCredential

SEARCH_ENDPOINT = "https://<your-search-service>.search.windows.net"
KNOWLEDGE_BASE = "<your-knowledge-base>"
KNOWLEDGE_SOURCE = "<your-search-index-knowledge-source>"
API_VERSION = "2025-11-01-preview"

token = DefaultAzureCredential().get_token("https://search.azure.com/.default").token
HEADERS = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
RETRIEVE_URL = (
    f"{SEARCH_ENDPOINT}/knowledgebases/{KNOWLEDGE_BASE}/retrieve"
    f"?api-version={API_VERSION}"
)

SOURCE_PARAMS = [
    {
        "knowledgeSourceName": KNOWLEDGE_SOURCE,
        "kind": "searchIndex",
        "includeReferences": True,
        "rerankerThreshold": 2.5,
    }
]


def retrieve(body: dict) -> tuple[dict, float]:
    started = time.perf_counter()
    response = requests.post(RETRIEVE_URL, headers=HEADERS, json=body, timeout=60)
    elapsed = time.perf_counter() - started
    response.raise_for_status()  # 206 Partial Content passes; check activity for errors
    return response.json(), elapsed


def summarise(label: str, result: dict, elapsed: float) -> None:
    print(f"{label}: {len(result.get('references', []))} references in {elapsed:.2f}s")
    for record in result.get("activity", []):
        kind = record.get("type")
        if kind == "searchIndex":
            query = record.get("searchIndexArguments", {}).get("search")
            print(f"  searchIndex query: {query!r} ({record.get('count')} hits)")
        elif kind == "modelQueryPlanning":
            print(
                f"  planning tokens: {record.get('inputTokens')} in, "
                f"{record.get('outputTokens')} out"
            )
        else:
            print(f"  {kind}")


question = (
    "Compare the leave policy for contractors with the one for permanent staff"
)

minimal, minimal_seconds = retrieve(
    {
        "intents": [{"type": "semantic", "search": question}],
        "retrievalReasoningEffort": {"kind": "minimal"},
        "outputMode": "extractiveData",
        "includeActivity": True,
        "knowledgeSourceParams": SOURCE_PARAMS,
    }
)

planned, planned_seconds = retrieve(
    {
        "messages": [
            {"role": "user", "content": [{"type": "text", "text": question}]}
        ],
        "retrievalReasoningEffort": {"kind": "low"},
        "outputMode": "extractiveData",
        "includeActivity": True,
        "knowledgeSourceParams": SOURCE_PARAMS,
    }
)

summarise("minimal", minimal, minimal_seconds)
summarise("low", planned, planned_seconds)
```

`rerankerThreshold` is the same gate as step 5 of the hand-built pipeline, on the semantic ranker's 0 to 4 scale. Tune it with your evaluation set rather than accepting 2.5.

Two details matter here. `minimal` takes `intents` rather than `messages`, because there's no LLM to interpret a conversation. And with `includeActivity` on, the `low` response shows the subqueries the planner generated and the tokens it used, which is the evidence you need for the decision. If the planned subqueries are the ones you would have written by hand, and the references cover both halves of the question where `minimal` only covered one, you've found a class of question where the service earns its latency.

Run this over 30 to 50 real questions, not three. Score each mode on whether the passages that answer the question show up in the references, using the retrieval metrics from [RAG Evaluation: Measuring Retrieval-Augmented Generation Quality](/blog/2024-03-18-rag-evaluation/). Record the elapsed time and planning token counts the script prints next to each score. That gives you a cost-per-improved-answer number instead of an impression.

## When I'd use each

**Keep the hand-built pipeline when:**

- The system is going to production in the next few months and needs a stable contract. A preview API that shipped breaking changes in both August and November 2025 isn't one.
- Most questions are single-intent lookups: a policy clause, a product code, an error message. Hybrid search plus the semantic ranker already handles these well, and query planning only adds latency.
- You need to explain every answer to an auditor or a risk team. With your own pipeline, the query, the scores and the threshold decision are all in your logs.
- Latency targets are tight. An LLM planning call before search adds a full model round trip to every question.

**Prototype on agentic retrieval when:**

- Users ask compound or conversational questions ("and what about for contractors?") and your evaluation shows single-query retrieval missing half the answer.
- Content is spread across sources you'd otherwise have to query and merge yourself, such as an index plus SharePoint plus a blob container.
- You're building agents in Foundry and want retrieval as a managed tool rather than code you own.
- You have the engineering time to absorb another breaking change before GA.

**Don't use answer synthesis** if you already have a generation step you've tuned. It hands prompt control to the service and makes it harder to tell retrieval failures from generation failures. `extractiveData` gives you the query planning benefit and keeps generation in your code.

## Where I land

My default for a new enterprise RAG system in February 2026 is still the hand-built pipeline on GA features: structure-aware chunks, hybrid search, the semantic ranker, a reranker-score gate and cited answers. The mistake I see most often isn't choosing the wrong retrieval engine. It's skipping the gate and the evaluation, so nobody knows which questions fail.

Agentic retrieval moves query planning, the stage teams most often skip, into the service. Point a knowledge base at your existing index, run the questions that already fail, and keep it behind a feature flag. When it reaches GA with a stable API, the evidence from that comparison tells you which question types should move over. That might be all of them, or only the compound ones.
