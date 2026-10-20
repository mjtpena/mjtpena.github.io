---
title: "Self-Correcting RAG: Grade Retrieval Before You Answer"
description: "How to add retrieval grading, query rewriting, and groundedness checks to RAG on Azure OpenAI and Azure AI Search without tripling latency or cost."
author: Michael John Peña
draft: false
date: 2024-01-08
tags:
  - RAG
  - AI Agents
  - Azure OpenAI
  - Azure AI Search
  - Python
---

A standard RAG pipeline retrieves once and generates once, whatever comes back. When retrieval misses, the model doesn't say "I couldn't find it". It writes a confident answer from whatever loosely related chunks it was handed, and nobody notices until a user does. The fix is to let the system check its own work: grade what it retrieved, try again when the evidence is weak, and verify the answer against the sources before returning it.

That idea gets called "agentic" RAG, and it's easy to overbuild. This post covers the self-correcting loop I'd actually put in front of users, where it pays for itself, and where it doesn't.

## Where the idea comes from

Two research threads from 2023 are worth knowing because they frame the design choices.

[Self-RAG](https://arxiv.org/abs/2310.11511) (Asai et al., October 2023) trains a language model to emit special "reflection tokens" that decide whether to retrieve at all, judge whether each retrieved passage is relevant, and critique whether its own output is supported by the evidence. The important detail: Self-RAG is a fine-tuned model (7B and 13B Llama 2 variants), not a prompting trick. You can't switch it on in GPT-4. What you can do is borrow its structure, using separate prompted calls for "is this relevant?" and "is this answer supported?".

[FLARE](https://arxiv.org/abs/2305.06983) (Jiang et al., EMNLP 2023) takes a different angle. It drafts the next sentence, and when the draft contains low-confidence tokens it uses that draft as a new retrieval query. It's clever, but it depends on token probabilities and many retrieval rounds per answer, which makes it a poor fit for a chat endpoint with a latency budget.

My take: the useful, production-ready part of this research is the *evaluate, then decide* loop. Training your own reflection model, or retrieving on every sentence, is research territory for most enterprise teams right now.

## The loop

```text
question
   │
   ▼
retrieve (hybrid + semantic ranker)
   │
   ▼
grade evidence ──── weak ───► rewrite query ──► retrieve again (max 2 rounds)
   │ strong                                          │
   ▼                                                 ▼
generate with citations                     still weak → say "I don't know"
   │
   ▼
groundedness check ── unsupported ──► regenerate once, or return with a warning
   │ supported
   ▼
answer
```

Three decisions drive this design.

**Grade cheaply first.** If you use Azure AI Search with [semantic ranker](https://learn.microsoft.com/azure/search/semantic-search-overview) (generally available since November 2023), each result already comes back with a `@search.reranker_score` from 0 to 4. That score is a free relevance signal, computed by a cross-encoder-style model, and it's comparable across queries in a way that BM25 and vector similarity scores are not. I use it as the first gate: clearly strong results skip the LLM grader, clearly weak ones go straight to a rewrite, and only the middle band pays for a GPT-4 Turbo call. The thresholds (I start at 2.0 and 1.0) are tuning parameters; set them from your own labelled queries, not from this post.

**Cap the iterations.** Every retry is another embedding call, another search, and another grading call. Two retrieval rounds is my default ceiling. If two reformulations of the question can't find evidence, a third rarely will, and the honest answer is that the knowledge base doesn't cover it.

**Make "I don't know" a first-class outcome.** The point of grading isn't only to retry. It's to stop. A system that refuses on weak evidence is more useful than one that always answers, especially for policy, HR, or compliance content where a wrong answer has consequences.

## An implementation on Azure OpenAI and Azure AI Search

The code below uses the `openai` 1.x Python library's `AsyncAzureOpenAI` client and the async `SearchClient` from `azure-search-documents` 11.4.0 (install `aiohttp` too, the async client needs it). The grader uses [JSON mode](https://learn.microsoft.com/azure/ai-services/openai/how-to/json-mode), which on Azure OpenAI requires a GPT-4 Turbo `1106-preview` deployment and API version `2023-12-01-preview` or later. JSON mode also requires the word "JSON" to appear in the messages, which the prompts below include.

It assumes an index with `content` and `title` fields, a `content_vector` field, and a semantic configuration named `default`. Deployment and resource names are placeholders.

```python
import asyncio
import json
import os

from azure.core.credentials import AzureKeyCredential
from azure.search.documents.aio import SearchClient
from azure.search.documents.models import VectorizedQuery
from openai import AsyncAzureOpenAI

CHAT_DEPLOYMENT = "<your-gpt-4-turbo-deployment>"
EMBEDDING_DEPLOYMENT = "<your-ada-002-deployment>"
STRONG, WEAK = 2.0, 1.0  # semantic reranker score thresholds (0-4 scale)
MAX_ROUNDS = 2

aoai = AsyncAzureOpenAI(
    azure_endpoint="https://<your-openai-resource>.openai.azure.com",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version="2023-12-01-preview",
)
search = SearchClient(
    endpoint="https://<your-search-service>.search.windows.net",
    index_name="<your-index>",
    credential=AzureKeyCredential(os.environ["AZURE_SEARCH_API_KEY"]),
)


async def retrieve(query: str, top: int = 5) -> list[dict]:
    emb = await aoai.embeddings.create(model=EMBEDDING_DEPLOYMENT, input=query)
    vq = VectorizedQuery(
        vector=emb.data[0].embedding, k_nearest_neighbors=50, fields="content_vector"
    )
    results = await search.search(
        search_text=query,
        vector_queries=[vq],
        query_type="semantic",
        semantic_configuration_name="default",
        select=["title", "content"],
        top=top,
    )
    return [
        {"title": r["title"], "content": r["content"],
         "score": r["@search.reranker_score"] or 0.0}
        async for r in results
    ]


async def ask_json(system: str, user: str) -> dict:
    resp = await aoai.chat.completions.create(
        model=CHAT_DEPLOYMENT,
        response_format={"type": "json_object"},
        temperature=0,
        messages=[{"role": "system", "content": system},
                  {"role": "user", "content": user}],
    )
    return json.loads(resp.choices[0].message.content)


async def grade(question: str, docs: list[dict]) -> list[dict]:
    """Keep strong docs, drop weak ones, ask the model about the middle band."""
    kept = [d for d in docs if d["score"] >= STRONG]
    for d in (d for d in docs if WEAK <= d["score"] < STRONG):
        verdict = await ask_json(
            'Decide if the passage helps answer the question. '
            'Reply in JSON: {"relevant": true} or {"relevant": false}.',
            f"Question: {question}\n\nPassage:\n{d['content']}",
        )
        if verdict.get("relevant") is True:
            kept.append(d)
    return kept


async def rewrite(question: str, attempt: str) -> str:
    out = await ask_json(
        "The search query below did not find relevant documents. Rewrite it as a "
        "single, more specific search query using likely document terminology. "
        'Reply in JSON: {"query": "..."}.',
        f"Original question: {question}\nLast query: {attempt}",
    )
    return out.get("query", question)


async def generate(question: str, docs: list[dict]) -> str:
    sources = "\n\n".join(f"[{i + 1}] {d['title']}\n{d['content']}" for i, d in enumerate(docs))
    resp = await aoai.chat.completions.create(
        model=CHAT_DEPLOYMENT,
        temperature=0,
        messages=[
            {"role": "system", "content": "Answer only from the numbered sources. "
             "Cite them like [1]. If they don't contain the answer, say so."},
            {"role": "user", "content": f"Sources:\n{sources}\n\nQuestion: {question}"},
        ],
    )
    return resp.choices[0].message.content


async def is_grounded(answer: str, docs: list[dict]) -> bool:
    sources = "\n\n".join(d["content"] for d in docs)
    out = await ask_json(
        "Check every factual claim in the answer against the sources. "
        'Reply in JSON: {"supported": true} only if all claims are supported, '
        'otherwise {"supported": false}.',
        f"Sources:\n{sources}\n\nAnswer:\n{answer}",
    )
    return out.get("supported") is True


async def answer(question: str) -> dict:
    query, evidence = question, []
    for round_no in range(1, MAX_ROUNDS + 1):
        evidence = await grade(question, await retrieve(query))
        if evidence:
            break
        query = await rewrite(question, query)
    if not evidence:
        return {"answer": "I couldn't find this in the knowledge base.", "rounds": round_no}

    draft = await generate(question, evidence)
    grounded = await is_grounded(draft, evidence)
    return {"answer": draft, "grounded": grounded, "rounds": round_no}


async def main() -> None:
    try:
        print(await answer("<a question your index should be able to answer>"))
    finally:
        await search.close()
        await aoai.close()


if __name__ == "__main__":
    asyncio.run(main())
```

A few things in there are deliberate.

The grader always judges the passage against the *original* question, even after a rewrite. Rewritten queries drift, and grading against the drifted query lets irrelevant results in. The rewriter also sees its previous attempt so it doesn't produce the same query twice.

The grounded flag is returned rather than acted on. What you do with an unsupported answer is a product decision: regenerate once with a stricter prompt, show it with a "couldn't verify" label, or suppress it. I lean towards labelling, because silent regeneration hides the signal you need for tuning. Log it either way.

Grading the middle band runs one call per document sequentially, which keeps the example readable. In production, run those calls with `asyncio.gather` so grading latency is one model call, not five.

## What it costs

| Path | Model calls | When it happens |
|---|---|---|
| Strong first retrieval | 1 embedding, 1 generation, 1 groundedness check | Most well-covered questions |
| Middle-band grading | Adds up to 5 grading calls (parallelisable) | Ambiguous queries |
| Rewrite and retry | Adds 1 rewrite, 1 embedding, 1 search, plus grading | Vocabulary mismatch |
| Nothing found | No generation at all | Out-of-scope questions |

The groundedness check is the cost you pay on every request, and it roughly doubles the GPT-4 Turbo tokens because it re-reads the sources. If that's too much, sample it (check 10–20% of traffic) and use the results to monitor quality rather than to gate each answer. Prompt flow's built-in [evaluation flows](https://learn.microsoft.com/azure/machine-learning/prompt-flow/how-to-bulk-test-evaluate-flow) can run the same groundedness and relevance metrics in bulk against a test set, which is where I'd validate the thresholds before trusting the loop online.

## When not to do this

- **Your retrieval is the problem.** If hybrid search and semantic ranker aren't in place yet, fix that first. A grading loop over poor retrieval just retries poor retrieval. I laid out that ordering in [A RAG Maturity Model](/blog/2024-01-06-rag-architecture-maturity/); self-correction sits on top of Level 3, not in place of it.
- **Most questions are simple lookups.** If logs show nearly every query is answered by the first retrieval, the loop adds a groundedness call and buys little. Keep the reranker-score threshold and the "I don't know" path, and skip the rest.
- **Tight latency budgets.** Each retry adds a full embedding, search, and grading round trip. For a voice or type-ahead experience, a single well-tuned retrieval with a refusal threshold beats a smarter but slower loop.
- **Multi-hop questions.** Comparisons and "how does X differ from Y" need decomposition into several sub-queries, not a retry of one query. That's a different pattern, covered in the query-aware retrieval level of the maturity post.

I'd also be cautious about adding web search as a fallback when the knowledge base comes up empty. It sounds helpful, but for internal policy content it changes what the system is: answers stop being traceable to approved sources, and you've introduced a new data flow your security team will want to review. Saying "not in the knowledge base" is usually the right behaviour.

## The short version

Self-correcting RAG is mostly about adding two questions to the pipeline: "is this evidence good enough?" and "does the answer stick to it?". Answer the first with the semantic reranker score wherever you can, and only spend an LLM call on the cases it can't decide. Cap retries at two, treat "I don't know" as a success, and measure groundedness before you decide whether to gate on it. Leave the fully autonomous, plan-everything agent for the problems that need it.
