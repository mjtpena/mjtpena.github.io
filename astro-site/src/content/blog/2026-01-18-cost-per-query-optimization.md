---
title: "Cost Per Query: Measure the Unit Cost Before You Cut It"
description: "Treat cost per query as the unit metric for an LLM app: decompose it from the usage object, then cut it in order with model choice, caching, context and batch."
author: Michael John Peña
draft: false
date: 2026-01-18
tags:
  - Azure OpenAI
  - Cost Optimization
  - FinOps
  - LLM
---

A monthly Azure OpenAI bill tells you that you spent money. It doesn't tell you whether the product can afford to grow. The number that does is cost per query: what one user question costs end to end, across every model call, retrieval step and retry it triggers. One system I worked on started at about $0.08 per query, which was too high for the user volume we expected, and the work to bring it down to $0.024 was mostly about finding waste rather than squeezing prices.

## Why per query, not per month

Monthly spend mixes two things you need to keep apart: how many queries you served and how expensive each one was. When spend goes up 30%, you want to know immediately whether that's growth (good) or a prompt change that doubled the system message (bad). A per-query number separates them.

It also gives product owners something to reason with. "A query costs 2.4 cents and a user asks about 40 a month" leads to a conversation about pricing and which features are worth their cost.

My rule is that the unit should match what the user experiences as one action. For a chat assistant that's one user turn. For a document pipeline it's one document. If a single user question fans out into a planner call, three tool calls and a final answer, all of those belong to the one query.

## Measure it from the usage object, not from estimates

Every chat completion response from Azure OpenAI includes a `usage` block with prompt tokens, completion tokens and, for models that support it, a breakdown of cached prompt tokens under `prompt_tokens_details.cached_tokens` and reasoning tokens under `completion_tokens_details.reasoning_tokens`. That is the meter. Log it per call, tag each call with a query ID, and sum per query.

The fragment below wraps a call and records what it actually cost. It uses the `openai` Python package against the Azure OpenAI v1 endpoint. The prices are placeholders on purpose: copy the current per-million-token rates for your model and deployment type from the [Azure OpenAI pricing page](https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/), because they differ by model, region type and over time. It requires Python 3.10+ and the `openai` package 1.x; configure logging or an OpenTelemetry exporter to see the ledger lines.

```python
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field

from openai import APIConnectionError, InternalServerError, OpenAI, RateLimitError

log = logging.getLogger("cost_ledger")

client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    max_retries=0,  # retry in answer(), where the ledger can see every attempt
    timeout=60,
)

# USD per 1M tokens, keyed on response.model: the versioned model name that
# served the request (e.g. gpt-4o-mini-2024-07-18), not the deployment name.
# With model router one deployment serves several models, so a price looked
# up by deployment would be wrong for most of its calls. Placeholders: fill
# in from the pricing page.
PRICES = {
    "<versioned-model-name, e.g. gpt-4o-mini-2024-07-18>": {
        "input": 0.0, "cached_input": 0.0, "output": 0.0,
    },
    "<versioned-model-name, e.g. gpt-4o-2024-11-20>": {
        "input": 0.0, "cached_input": 0.0, "output": 0.0,
    },
}

# Model router bills its own input-token charge on top of the model it picks.
ROUTER_DEPLOYMENTS = {"<your-model-router-deployment>"}
ROUTER_INPUT_PRICE = 0.0  # USD per 1M input tokens; placeholder


@dataclass
class QueryLedger:
    query_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    calls: list = field(default_factory=list)

    def record(self, deployment: str, model: str, usage, step: str) -> None:
        details = getattr(usage, "prompt_tokens_details", None)
        cached = (getattr(details, "cached_tokens", 0) or 0) if details else 0
        completion_details = getattr(usage, "completion_tokens_details", None)
        reasoning = (
            (getattr(completion_details, "reasoning_tokens", 0) or 0)
            if completion_details
            else 0
        )
        # Embeddings usage has no completion_tokens, so default it to zero.
        completion = getattr(usage, "completion_tokens", 0) or 0
        uncached = usage.prompt_tokens - cached

        # The router charge depends only on the deployment, so count it even
        # when the model it picked is missing from PRICES.
        router_cost = (
            usage.prompt_tokens * ROUTER_INPUT_PRICE / 1_000_000
            if deployment in ROUTER_DEPLOYMENTS
            else 0.0
        )
        price = PRICES.get(model)
        if price is None:
            # The call is already billed; log it as unpriced rather than crash.
            log.warning("unpriced model %s in query %s", model, self.query_id)
            cost = None
        else:
            cost = (
                uncached * price["input"]
                + cached * price["cached_input"]
                + completion * price["output"]
            ) / 1_000_000

        self._add(
            {
                "step": step,
                "deployment": deployment,
                "model": model,
                "prompt_tokens": usage.prompt_tokens,
                "cached_tokens": cached,
                "completion_tokens": completion,
                "reasoning_tokens": reasoning,
                "cost_usd": cost,
                "router_cost_usd": router_cost,
            }
        )

    def record_failure(self, deployment: str, step: str, error: Exception) -> None:
        # No usage object comes back, so the tokens are unknown. Count the attempt
        # anyway so reconciliation against Azure Monitor has something to match.
        self._add(
            {"step": step, "deployment": deployment, "error": type(error).__name__,
             "cost_usd": None}
        )

    def _add(self, call: dict) -> None:
        self.calls.append(call)
        # One JSON line per call; an OpenTelemetry/Application Insights log
        # exporter ships it to Log Analytics for the percentile queries.
        log.info(json.dumps({"query_id": self.query_id, **call}))

    @property
    def total_cost(self) -> float:
        return sum(
            (c["cost_usd"] or 0.0) + c.get("router_cost_usd", 0.0) for c in self.calls
        )

    @property
    def failed_calls(self) -> int:
        return sum(1 for c in self.calls if "error" in c)


def answer(
    question: str,
    context: str,
    deployment: str,
    ledger: QueryLedger,
    attempts: int = 3,
    max_completion_tokens: int = 800,
) -> str:
    messages = [
        {"role": "system", "content": "Answer using only the provided context."},
        {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"},
    ]
    for attempt in range(1, attempts + 1):
        step = f"answer#{attempt}"
        try:
            response = client.chat.completions.create(
                model=deployment,
                messages=messages,
                max_completion_tokens=max_completion_tokens,
            )
        except (RateLimitError, InternalServerError, APIConnectionError) as exc:
            # Transient (APITimeoutError is an APIConnectionError): back off, retry.
            ledger.record_failure(deployment, step, exc)
            if attempt == attempts:
                break  # no point waiting before giving up
            # Honour Retry-After on 429s; connection errors carry no response.
            headers = getattr(getattr(exc, "response", None), "headers", None) or {}
            retry_after = headers.get("retry-after")
            try:
                delay = float(retry_after) if retry_after else 2**attempt
            except ValueError:  # an HTTP date rather than seconds
                delay = 2**attempt
            time.sleep(delay)
            continue

        if response.usage:
            ledger.record(deployment, response.model, response.usage, step)
        choice = response.choices[0]
        if choice.finish_reason == "stop" and choice.message.content:
            return choice.message.content
        if choice.finish_reason == "content_filter":
            # Same input, same verdict: a retry only pays for the refusal twice.
            raise RuntimeError("Response was filtered; not retrying")
        if choice.finish_reason == "length":
            # An identical retry truncates again; give it room (or lower reasoning_effort).
            max_completion_tokens *= 2
        # Anything else (e.g. empty content) is treated as transient and retried.
    raise RuntimeError(f"No usable answer after {attempts} attempts")
```

Completion tokens already include reasoning tokens for reasoning models, so they're billed at the output rate even though the user never sees them. Each call becomes one JSON log line tagged with its query ID.

Embedding calls for the query are part of the query too, and so is re-ranking if you pay for it. Embeddings report only prompt tokens, so pass their usage to the same ledger and `record()` treats the missing completion count as zero.

Retries are the other cost people forget, which is why they live in `answer()` and not in the SDK. The `openai` client retries rate limits, server errors and timeouts on its own (`max_retries` defaults to 2), and a usage-based ledger never sees those attempts. With `max_retries=0` every attempt is visible but not always measurable: a timed-out call may still have consumed tokens without returning usage, so the ledger counts it under `failed_calls` but can't price it.

### Reconcile at the gateway

Azure Monitor reports processed prompt and generated completion tokens per deployment, so check that the ledger's daily totals land within a few percent of what was metered. When several apps share a deployment behind API Management, the [`llm-emit-token-metric` policy](https://learn.microsoft.com/en-us/azure/api-management/llm-emit-token-metric-policy) (or the older `azure-openai-emit-token-metric`) emits token counts to Application Insights with up to five custom dimensions, such as an app name. It can't go per query, because each dimension keeps at most 100 unique values and silently drops the rest. I use the gateway to attribute cost to apps and the ledger to explain it. For where the metered bill drifts from estimates, see [Azure OpenAI hidden costs](/blog/2026-01-04-azure-openai-hidden-costs/).

## Decompose before you optimise

Once you have a ledger per query, look at the distribution, not the average. In most systems a minority of queries carries a disproportionate share of cost: long conversations re-sending their history, questions that pull huge retrieved contexts, or agent loops that call tools several times. Report p50, p95 and p99 cost per query, plus the top 1% of queries by cost, from the logged calls in Log Analytics; that tail is where you start. Once the ledger lines are in a table ([LLM observability](/blog/2026-01-16-llm-observability/) covers getting them there), it's a few lines of KQL:

```kusto
LedgerCalls  // your table of parsed ledger lines
| summarize cost = sum(todouble(cost_usd)) + sum(todouble(router_cost_usd)) by query_id
| summarize percentiles(cost, 50, 95, 99), queries = count()
```

I break each query down along three axes. Input tokens usually dominate in retrieval-augmented apps, because every call carries a system prompt plus retrieved chunks; output dominates in generation-heavy apps and anything using a reasoning model.

| Axis | Question it answers | Typical lever |
|---|---|---|
| Which model | Is an expensive model doing work a cheaper one could do? | Routing, smaller models |
| Input vs output | Are we paying for what we send or what we generate? | Context trimming, caching, output limits |
| Which step | Is it the answer, the planner, the retries or retrieval? | Fewer calls, batching, fixing failure loops |

The input-vs-output row is the same formula the ledger uses. Take a retrieval query with placeholder counts: 6,000 prompt tokens, 2,000 of them cached, and 400 completion tokens. Its cost is (4,000 × input rate + 2,000 × cached-input rate + 400 × output rate) / 1,000,000, summed over every call in the query. Output rates are several times input rates, but here prompt tokens outnumber completion tokens 15 to 1, so the first term usually wins. The table tells you where to spend effort first.

## The levers, in the order I'd pull them

### 1. Match the model to the query

The biggest single change in the system I mentioned was moving simple queries from GPT-4o to GPT-4o-mini. Lookups, classification, short factual answers and reformatting rarely need the large model, and this one change moved the number more than anything else.

By January 2026 the menu is wider: the GPT-4.1 family and the GPT-5 family both have mini and nano sizes, and Microsoft Foundry's [model router](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/model-router) will pick a model per request for you. Model router reached GA in November 2025; Claude models in its pool must be deployed to your Foundry resource first. I still prefer explicit routing rules for anything with a quality bar I have to defend, because a rule I wrote is a rule I can test. Use the router when the query mix is broad and you can evaluate it against your own test set, not on faith. The router also bills its own input-token charge on top of the model it selects. That is what `ROUTER_INPUT_PRICE` in the ledger is for.

When not to do this: if a wrong answer is expensive (compliance, financial advice, anything a person acts on without checking), the saving from a smaller model can disappear in one bad outcome. Route on evaluated quality, never on price alone.

### 2. Stop paying twice for the same thing

There are two different kinds of caching and they solve different problems.

Application caching means you don't call the model at all. An exact-match cache on the normalised question, keyed together with the model and a prompt version, is simple and safe. Include the prompt version in the key, or a prompt change will keep serving stale answers. Caching query embeddings is also worthwhile, because the same questions get embedded again and again. Semantic caching (matching similar but not identical questions) saves more but can return a confidently wrong answer to a subtly different question, so I only use it for content that isn't personalised or time-sensitive.

[Prompt caching](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching) is the service-side kind, and it's on by default for supported models. Prompts of 1,024 tokens or more get a cache hit when their first 1,024 tokens exactly match a recent request (and further in 128-token increments); the matched tokens are billed at a discounted cached-input rate and show up in `cached_tokens`. The design implication is simple: put the stable parts first (system prompt, tool definitions, fixed instructions) and the variable parts last (retrieved chunks, the user's question). A timestamp at the top of the system prompt quietly defeats it. Caches are typically cleared within 5 to 10 minutes of inactivity and always within an hour of last use, so the benefit is greatest on steady traffic.

### 3. Send less context

Retrieval systems over-fetch because more context feels safer. Sending only the relevant chunks rather than whole documents was one of our steps, and it is usually the cheapest change. Practical moves: retrieve fewer, better chunks (a re-ranker helps here), trim chat history to a window or a running summary instead of re-sending every turn, and cap `max_completion_tokens` for responses that should be short. With reasoning models the cap includes reasoning tokens, so a tight cap can produce an empty, still-billed response; lower `reasoning_effort` instead.

Measure answer quality while you do it: context cuts are where cost work most often degrades the product unnoticed.

### 4. Move work off the interactive path

Anything that doesn't need an answer in seconds (nightly enrichment, document classification, evaluation runs, backfills) can go through [Global Batch](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/batch), which is priced at 50% less than Global Standard with a 24-hour target turnaround and its own quota. It won't help live chat, but it often removes a large chunk of spend. Grouping similar queries where latency allows, our last step, is the same idea at a smaller scale.

## When the number is wrong to chase

Cost per query is a unit metric, not a goal. Three cases where I'd stop optimising it:

- **The query is cheap relative to its value.** If a query replaces ten minutes of an analyst's time, shaving a cent off it is not where your effort belongs.
- **Volume is low.** At a few thousand queries a month, the engineering time costs more than the tokens. Measure, but don't build a routing layer yet.
- **The saving costs quality you can't measure.** If you don't have an evaluation set, you can't tell whether the cheaper configuration is equivalent. Build the evaluation first.

## The takeaway

Instrument first: per-call usage, tagged by query, including retries, reasoning tokens and embeddings, reconciled against what Azure metered. Then let the decomposition decide where to start:

- **Input dominates** (most retrieval apps): prompt caching and context trimming, which cost the least engineering and rarely change answer quality.
- **Output dominates** (especially reasoning models): the model choice and its reasoning effort, where the per-token price and the hidden tokens sit.
- **One step dominates:** fix that step before touching anything global.

If you can't state your cost per query today, that's the first ticket to write.
