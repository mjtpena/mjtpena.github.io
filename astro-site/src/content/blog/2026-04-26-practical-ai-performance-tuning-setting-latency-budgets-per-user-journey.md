---
title: "Splitting an AI Journey's Latency Budget Across Its Steps"
description: "A journey-level latency budget only works when each step gets a cap, a timeout and a fallback; here is how to split one across a RAG request."
author: Michael John Peña
draft: false
date: 2026-04-26
tags:
  - Performance
  - LLM
  - RAG
  - Observability
  - Azure OpenAI
---

A latency budget per user journey tells you how long a person is willing to wait. It doesn't tell you where the time goes. A RAG answer that blows its 3-second budget usually isn't slow in one place: it is slow in four places at once (query rewriting, retrieval, reranking and the model), and each team owning a step thinks their part is fine. Tuning only gets traction once the journey's budget is split into per-step allowances that are enforced in code and visible in traces.

I've written before about [using latency budgets to choose deployment tiers](/blog/2026-04-04-keeping-ai-workloads-economical-setting-latency-budgets-per-user-journey/) and about [which tokens actually slow a request down](/blog/2026-03-24-llm-cost-and-latency-notes-reducing-token-waste-without-hurting-answer-quality/). This post sits between them: once a journey has a number, how do you spend it?

## A budget is a deadline, not a set of timeouts

The common mistake is to give every step its own fixed timeout: 2 seconds for search, 30 seconds for the model, defaults everywhere else. Add those up and the "budget" is 32 seconds plus retries, and nobody notices because each step individually stays inside its limit.

I'd treat the journey budget as a single deadline that starts when the request arrives. Each step gets two numbers:

- **A cap.** The most this step is allowed to take, even if there is time left. This stops one step from quietly eating everyone else's share.
- **The remaining time.** Whatever is left on the journey's deadline. A step's real timeout is the smaller of its cap and the remaining time.

That second number is what fixed timeouts miss. If retrieval runs long, the model call should know it has less time, not start its own fresh 30-second clock.

## Allocating the budget across a RAG request

Here's how I'd split a 3-second time-to-first-token budget for an internal Q&A journey. The numbers illustrate the shape; yours should come from measured p95s per step.

| Step | Cap | If it runs over |
|---|---|---|
| Query rewrite (small model) | 400 ms | Skip it and search with the raw question |
| Retrieval with semantic ranking | 1,000 ms, of which the ranker may use 700 ms | Return results without the ranker (BM25 order, or RRF order for hybrid) |
| Prompt assembly | 50 ms | Shouldn't happen; this is a bug if it does |
| Model, time to first token | Remaining time | Return a "still working" message or a shorter answer path |

Two principles drive the allocation.

**The model gets what's left, and it should be the biggest share.** Time to first token on Azure OpenAI depends on the model, prompt size, reasoning tokens and load on the deployment. Microsoft's [latency guidance](https://learn.microsoft.com/azure/foundry/openai/how-to/latency) names the model and the number of tokens generated as the factors that contribute most to total time. Every millisecond the earlier steps save is a millisecond of headroom for the step with the most variance.

**Optional steps get tight caps and a clean skip.** Query rewriting and reranking improve answers, but the journey can still produce a reasonable answer without them. That makes them the right place to absorb overruns. The [semantic ranker](https://learn.microsoft.com/azure/search/semantic-search-overview) in Azure AI Search reorders the top 50 results from the initial query, so it adds a step on top of retrieval rather than replacing it. If you haven't measured whether it changes outcomes for your queries, do that first; I covered a with-and-without test in [testing whether a reranker earns its place](/blog/2026-03-21-rag-systems-that-hold-up-using-reranking-only-where-it-changes-outcomes/). A step that doesn't move quality shouldn't get budget at all.

The same logic applies to [agentic retrieval](https://learn.microsoft.com/azure/search/agentic-retrieval-overview) in Azure AI Search. According to the [Azure AI Search "What's new" page](https://learn.microsoft.com/azure/search/whats-new), knowledge bases went GA in the 2026-04-01 REST API, but only for extractive retrieval; LLM query planning, answer synthesis and configurable reasoning effort are still preview and need the 2025-11-01-preview API. Planning adds a model call before retrieval even starts, so a journey with a tight budget needs a cap on it and a fallback to a plain query.

## Enforcing it in code

The script below is a complete, runnable request path: an async RAG call that carries one deadline through retrieval and generation, drops the ranker first when time is short, and records each step's budget as span attributes. To keep it short, it leaves out the query-rewrite step from the table; that step would get its own `step_span` and cap in the same way.

You'll need:

- Python 3.11 or later, for `asyncio.timeout`.
- The packages below. `aiohttp` is there because the async Search client uses azure-core's aiohttp transport, which none of the other packages install.

```bash
pip install "openai>=2.8" "azure-search-documents>=11.6,<12" azure-monitor-opentelemetry aiohttp
```

```python
import asyncio
import os
import time
from contextlib import contextmanager

from azure.core.credentials import AzureKeyCredential
from azure.monitor.opentelemetry import configure_azure_monitor
from azure.search.documents.aio import SearchClient
from openai import AsyncOpenAI
from opentelemetry import trace
from opentelemetry.trace import SpanKind

configure_azure_monitor()  # reads APPLICATIONINSIGHTS_CONNECTION_STRING
tracer = trace.get_tracer("journeys")

# Retries are disabled here: a retry is a step the budget must know about.
llm = AsyncOpenAI(
    base_url="https://<your-openai-resource>.openai.azure.com/openai/v1/",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    max_retries=0,
)
search = SearchClient(
    endpoint="https://<your-search-service>.search.windows.net",
    index_name="<your-index>",
    credential=AzureKeyCredential(os.environ["AZURE_SEARCH_API_KEY"]),
    retry_total=0,  # same reason: no hidden retries inside the retrieval allowance
)

JOURNEY = "policy_qa"
BUDGET_S = 3.0
CAPS_S = {"retrieve": 1.0, "retrieve_fallback": 0.5}
RANKER_WAIT_MS = 700  # the service minimum for the semantic max wait


class Deadline:
    def __init__(self, budget_s: float):
        self.start = time.monotonic()
        self.end = self.start + budget_s

    def remaining(self) -> float:
        return max(0.0, self.end - time.monotonic())

    def allowance(self, step: str) -> float:
        return min(CAPS_S.get(step, float("inf")), self.remaining())


@contextmanager
def step_span(step: str, deadline: Deadline):
    with tracer.start_as_current_span(step) as span:
        span.set_attribute("journey.name", JOURNEY)
        span.set_attribute("journey.step_allowance_ms", int(deadline.allowance(step) * 1000))
        try:
            yield span
        finally:
            # Recorded on timeouts too, which are the paths that matter most.
            span.set_attribute("journey.remaining_ms", int(deadline.remaining() * 1000))


async def run_search(question: str, semantic: bool) -> list[dict]:
    options = {}
    if semantic:
        options = {
            "query_type": "semantic",
            "semantic_configuration_name": "<your-semantic-config>",
            # If the ranker overruns, the service returns the initial ranking instead of failing.
            "semantic_error_mode": "partial",
            "semantic_max_wait_in_milliseconds": RANKER_WAIT_MS,
        }
    results = await search.search(search_text=question, top=5, select=["content"], **options)
    return [doc async for doc in results]


async def retrieve(question: str, deadline: Deadline) -> list[str]:
    with step_span("retrieve", deadline) as span:
        try:
            async with asyncio.timeout(deadline.allowance("retrieve")):
                docs = await run_search(question, semantic=True)
            # A document without a reranker score means the service skipped the ranker. The
            # authoritative signal is @search.semanticPartialResponseReason on the response,
            # which 11.6.0 parses but doesn't expose on the public results object.
            skipped = any(doc["@search.reranker_score"] is None for doc in docs)
            span.set_attribute("journey.degraded", skipped)
            return [doc["content"] for doc in docs]
        except TimeoutError:
            span.set_attribute("journey.degraded", True)
            span.set_attribute("journey.fallback_query", True)
        # Search with ranking overran its allowance. Fall back to an unranked query
        # only if enough time remains for it to have a realistic chance of finishing.
        # With this script's numbers ~2 s remain here, so the check only bites once an
        # earlier step (such as the query rewrite) has consumed part of the budget.
        if deadline.remaining() < 0.3:
            raise TimeoutError
        # The fallback has its own cap so it can't spend the model's share.
        async with asyncio.timeout(deadline.allowance("retrieve_fallback")):
            docs = await run_search(question, semantic=False)
        return [doc["content"] for doc in docs]


async def generate(question: str, docs: list[str], deadline: Deadline) -> str:
    with step_span("generate", deadline) as span:
        context = "\n\n".join(docs)
        messages = [
            {"role": "system", "content": "Answer only from the context. Say so if it isn't there."},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"},
        ]
        parts: list[str] = []
        stream = None
        try:
            # The budget covers time to first token, so the deadline wraps only that wait.
            async with asyncio.timeout(deadline.remaining()):
                stream = await llm.chat.completions.create(
                    model="<your-gpt-5-mini-deployment>",
                    messages=messages,
                    stream=True,
                    reasoning_effort="minimal",  # reasoning happens before the first token
                )
                chunks = aiter(stream)
                async for chunk in chunks:
                    if chunk.choices and chunk.choices[0].delta.content:
                        parts.append(chunk.choices[0].delta.content)
                        # Measured from request arrival, so it is comparable with journey.budget_ms.
                        ttft_ms = int((time.monotonic() - deadline.start) * 1000)
                        span.set_attribute("journey.ttft_ms", ttft_ms)
                        break
            # First token arrived inside the budget; finish the same stream without a deadline.
            async for chunk in chunks:
                if chunk.choices and chunk.choices[0].delta.content:
                    parts.append(chunk.choices[0].delta.content)
            return "".join(parts)
        finally:
            # Close the HTTP response on every path, including a missed deadline.
            if stream is not None:
                await stream.close()


async def answer(question: str) -> str:
    deadline = Deadline(BUDGET_S)
    with tracer.start_as_current_span(JOURNEY, kind=SpanKind.SERVER) as root:
        root.set_attribute("journey.budget_ms", int(BUDGET_S * 1000))
        try:
            docs = await retrieve(question, deadline)
            return await generate(question, docs, deadline)
        except TimeoutError:
            root.set_attribute("journey.over_budget", True)
            return "This is taking longer than usual. Please try again shortly."


async def main() -> None:
    async with search, llm:
        print(await answer("How many days of carer's leave do I get?"))


if __name__ == "__main__":
    asyncio.run(main())
```

### Why the code makes these choices

**The ranker cap.** The ranker cap is enforced by the service, not by cancelling the request. With `semantic_error_mode="partial"` and `semantic_max_wait_in_milliseconds`, both available on the async `search()` in `azure-search-documents` 11.6.0, Azure AI Search returns the initial BM25 ranking (or RRF ranking for a hybrid query) when the ranker runs past its wait, so the retrieval work that already finished isn't thrown away. The service won't accept a wait below 700 ms, which is why the retrieval cap above is 1,000 ms rather than 700. The outer `asyncio.timeout` is only a safety net for a hard overall deadline: if base retrieval or the network is the slow part, it cancels the call and spends what's left on one query without the ranker. I'd only fall back if at least ~300 ms remain; when base retrieval is the slow part, the second query usually hits the same slow path, so with less time than that it's better to go straight to the "taking longer than usual" response. That check only bites once an earlier step, such as the query rewrite, has eaten into the budget. The fallback query also has its own 500 ms cap rather than inheriting whatever time is left, so a second slow search can't spend the model's share. The missing-`@search.reranker_score` check is an indirect signal; the authoritative one is `@search.semanticPartialResponseReason` on the response, which 11.6.0 doesn't expose publicly.

**The generation deadline.** The deadline in `generate` wraps only the wait for the first token, because that's what this journey's budget is defined on. Once the first token is on screen, the user is reading, and cutting the answer off mid-sentence to honour a number would be worse than letting it finish. In production you'd stream those tokens to the caller, but the deadline's scope stays the same. If the deadline does fire, the `finally` block closes the stream rather than leaving the connection to the garbage collector. The call uses `reasoning_effort="minimal"`, which GPT-5 models support, because reasoning tokens are generated before the first visible token and count against a TTFT budget. It trades some quality on hard questions for a faster start; if evaluation says you need `low`, budget for it. Bear in mind that a cancelled generation can still be billed for the tokens the service already processed, so a deadline protects the user's wait, not your bill.

**No hidden retries.** The other choice that matters is `max_retries=0`. The `openai` library retries some failures by default, which is sensible for batch work and harmful here: a hidden retry can spend the whole budget on a request the user has already given up on. The Azure SDK retries too (by default up to three times per failure type and 10 in total, with exponential backoff), so `retry_total=0` on the Search client turns that off for the same reason. If a journey can afford a retry, make it an explicit step with its own allowance.

## Making the split visible

Enforcement without visibility just turns slow answers into degraded answers nobody knows about. The spans above land in Application Insights through the [Azure Monitor OpenTelemetry Distro](https://learn.microsoft.com/azure/azure-monitor/app/opentelemetry-enable), and the attributes are what make them useful. Spans you create yourself default to the internal kind and show up in the `dependencies` table, so the journey root is created with `kind=SpanKind.SERVER` to land in `requests` and the Performance view. If `answer()` already runs inside an instrumented web request, drop that argument and let the framework's span be the root.

Three attributes do most of the work:

- **`journey.step_allowance_ms` vs span duration** shows which step is consuming more than its share.
- **`journey.degraded`** tells you how often the ranker is skipped, whether by the service or by the client-side fallback (`journey.fallback_query` separates the two). If that rate climbs, you're quietly serving lower-quality answers, and that's a quality regression as much as a latency one.
- **`journey.remaining_ms` going into `generate`** is the single most useful number. If the model routinely starts with half the budget gone, tuning the prompt won't fix it.

I'd chart p95 per step per journey, not per service. A search service with a healthy overall p95 can still be the step that breaks one journey because that journey's queries are longer or hit a bigger index. If you want token counts and model names on the same traces, the OpenTelemetry [semantic conventions for generative AI](https://opentelemetry.io/docs/specs/semconv/gen-ai/) define attribute names such as `gen_ai.request.model` and `gen_ai.usage.input_tokens`. They're still marked as in development, so expect names to move and pin whichever instrumentation you adopt.

## When splitting the budget is the wrong move

Per-step budgets add code paths, and every fallback is a path that needs testing. I wouldn't bother when:

- **The journey has one meaningful step.** A single model call with streaming needs a timeout and a sensible client configuration, not a deadline framework.
- **Nobody is waiting.** Overnight jobs need a completion deadline and retries, which is the opposite trade-off.
- **There's no fallback worth having.** If skipping the ranker produces answers you wouldn't ship, a cap on it just converts slow answers into wrong ones. Fix the step or raise the budget.

Fallbacks also have a cost side. The client-side fallback query issues a second search exactly when search is slow, which is often because the service is busy, so during an incident it can double your query volume. Let the service-side partial mode handle ranker overruns, and cap the rate of client-side fallbacks (or skip the fallback and return the "taking longer than usual" message) so that degradation doesn't amplify the overload.

## Where I'd start

Take your slowest important journey, trace one request end to end, and write down the p95 for each step. Give the optional steps tight caps with a clean skip, give the model whatever is left, and remove any retry the budget doesn't know about. Then watch the degraded rate, not just the latency. A budget that's met by silently dropping the steps that make answers good isn't tuning; it's hiding the problem one level down.
