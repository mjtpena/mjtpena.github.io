---
title: "Four LLM Caches and How to Tell Which One Will Pay Off"
description: "Prompt, response, semantic and retrieval caches save different money and add different risks. Here's a break-even check to run before you build one."
author: Michael John Peña
draft: false
date: 2026-04-15
tags:
  - Azure OpenAI
  - Caching
  - Cost Optimization
  - API Management
  - LLM
---

"Add a cache" is the first thing most teams suggest when the Azure OpenAI bill or the p95 latency gets uncomfortable. There are at least four different things people mean by an LLM cache. Each one saves a different part of the cost, adds a different failure mode, and only pays off for a particular traffic shape, so building the wrong one gets you a Redis bill, an extra network hop and a hit rate in single digits.

## The four layers

| Layer | What it reuses | What it saves | What it adds | Correctness risk |
|---|---|---|---|---|
| Provider prompt caching | Processed prefix of the input | Part of the input price, time to first token | Nothing to run | None (output unchanged) |
| Exact-match response cache | Whole response for an identical request | Input and output, all model latency | A key-value store and a key design | Stale answers if the key misses a variable |
| Semantic response cache | Whole response for a *similar* request | Input and output, all model latency | An embeddings call on every request, a vector-capable cache | Wrong answers for prompts that look alike but aren't |
| Upstream work cache | Embeddings, retrieval results, tool calls | Embeddings spend, search and tool latency | A store, and invalidation when the source changes | Stale context if invalidation is wrong |

They aren't alternatives; they stack at different points in the request path. The question is which ones earn their keep for a given route.

## Layer 1: provider prompt caching is free, so start there

Azure OpenAI caches prompt prefixes automatically on GPT-4o and later models. A request needs at least 1,024 tokens, and the first 1,024 must be identical to a recent request for any of it to hit. There's nothing to deploy and no opt-out. On Standard deployments, cached input tokens are billed at a discount that depends on the model, from 50% on GPT-4o up to 90% on the GPT-5 family. On provisioned deployments, cached tokens are deducted from utilisation, which turns a good hit rate into extra headroom on capacity you've already bought. The [prompt caching documentation](https://learn.microsoft.com/azure/foundry/openai/how-to/prompt-caching) has the rules.

Two limits are easy to miss. It only touches input, so if long generations dominate your bill, the best hit rate barely moves it. And the latency gain is in time to first token, not the seconds spent generating output.

I've written up how to diagnose a low hit rate separately, in [why your Azure OpenAI prompt cache keeps missing](/blog/2026-02-16-prompt-caching-performance/). The short version: put static content first, keep tools and schemas byte-stable, and measure `cached_tokens` per route before building anything else.

## Layer 2: exact-match response caching is cheap but rarely hits

An exact-match cache hashes the request and returns a stored response if it has seen that request before. A hit saves the whole call, input and output, for the price of a key lookup.

It almost never hits on conversational traffic: people phrase the same question differently, and chat history and per-user system prompts differ. Where it does work well is in pipelines that send the same input more than once:

- Classification or extraction jobs re-run over a dataset where most rows haven't changed.
- Evaluation runs that re-score the same test set while changing only the grader.
- Templated prompts behind a UI button, such as "summarise this ticket" on a ticket that hasn't changed.

The key design is where teams get burned. The key has to include everything that changes the answer: deployment name, model version, the version of the system prompt, temperature and other sampling parameters, the tool list, the response format, and the full message content. If the system prompt is injected server-side (an APIM policy, a stored prompt template), the key won't see it change, so add an explicit prompt version; otherwise you'll serve answers from last month's instructions after a deploy. I'd only cache routes configured for consistent output, such as temperature 0, and never routes meant to give varied answers. Reasoning models such as gpt-5, gpt-5-mini and the o-series reject a non-default `temperature`, so you can't pin sampling there. A structured output schema makes the format consistent but not the values, so only cache those routes when any valid answer is acceptable, such as classification into a fixed label set. Temperature 0 isn't fully deterministic either.

A plain Redis or table store is enough here. You don't need anything LLM-specific.

## Layer 3: semantic caching has a cost on every miss

Semantic caching embeds the incoming prompt, looks for a stored prompt within a similarity threshold, and returns that prompt's response. In Azure the low-effort route is API Management: the `llm-semantic-cache-lookup` and `llm-semantic-cache-store` policies, which first shipped in preview at Build 2024 as `azure-openai-semantic-cache-lookup` and `azure-openai-semantic-cache-store` (still available for Azure OpenAI APIs). The `llm-*` versions work with any supported LLM API and are available in all tiers. They need an embeddings deployment exposed as an APIM backend and an Azure Managed Redis instance with the RediSearch module, configured as the external cache. The [setup guide](https://learn.microsoft.com/azure/api-management/azure-openai-enable-semantic-caching) walks through it. The policy pair looks like this:

```xml
<policies>
    <inbound>
        <base />
        <llm-semantic-cache-lookup
            score-threshold="0.05"
            embeddings-backend-id="<your-embeddings-backend>"
            embeddings-backend-auth="system-assigned"
            ignore-system-messages="true"
            max-message-count="10">
            <vary-by>@(context.Subscription.Id)</vary-by>
        </llm-semantic-cache-lookup>
        <rate-limit calls="10" renewal-period="60" />
    </inbound>
    <outbound>
        <llm-semantic-cache-store duration="3600" />
        <base />
    </outbound>
</policies>
```

The details in that snippet matter more than they look:

- `score-threshold` is a distance, so lower is stricter. The [policy reference](https://learn.microsoft.com/azure/api-management/llm-semantic-cache-lookup-policy) suggests starting around 0.05 and warns that values above 0.2 can return mismatched answers.
- `vary-by` partitions the cache. Without it, one tenant's cached answer can be served to another, so partition by whatever boundary your data access has.
- `max-message-count` skips the cache for long conversations, where a similar last message says little about whether the answer applies.
- `ignore-system-messages="true"` (the docs recommend it) means a system prompt change won't invalidate cached answers. Add a second `<vary-by>` with your prompt version, such as `<vary-by>@(context.Api.Id + ":v3")</vary-by>`, or flush the cache on deploy.
- `rate-limit` sits right after the lookup, as the docs recommend. Hits return before reaching it, so only model calls count, and it protects the backend if Redis becomes unavailable.

What people underestimate is the cost on a miss. Every request now waits for an embeddings call and a vector lookup, and a miss then pays for the full model call as well. On a route with a 5% hit rate, you've added latency to 95% of requests, and taken on a Redis instance, to save on 5%. Semantic caching pays off when traffic is dominated by a small set of recurring intents (internal IT and HR FAQs, product questions on a public site, the same "what does this error mean" across many users) and the answers don't depend on who's asking.

The correctness risk is real, and the docs say so plainly. "How do I reset my password?" and "How do I reset someone else's password?" embed close together and need different answers. Anything personalised, permission-dependent, time-sensitive or numeric is a poor fit. I'd only put it on routes where a slightly-off answer is cheap and the underlying content changes slowly. Implementation options are in an earlier post on [semantic caching for LLM applications](/blog/2025-11-22-november-ai-topic/).

## Layer 4: cache the work before the model call

This is the layer I'd build second, and the one people skip because it isn't called an LLM cache. A typical RAG request makes an embeddings call for the query, one or more search calls, maybe a reranker, and sometimes tool calls to line-of-business APIs. Much of that is deterministic for a given input:

- Query embeddings: reuse them, keyed on model name and normalised text.
- Document embeddings: key them on a content hash, so a re-index only embeds what changed.
- Tool results from slow reference APIs (product catalogue, exchange rates, org chart): give them a TTL that matches how often the source changes.

None of this changes what the model sees, so the only risk is staleness, and it cuts latency before the first token.

## Run the break-even before you build

This script compares monthly cost for one route with and without a response cache, including the per-request overhead of a semantic lookup and the fixed cost of the cache. The prices are inputs you fill in from the [Azure OpenAI pricing page](https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/) and your Redis SKU; the values below roughly match GPT-5 and text-embedding-3-small Global Standard list prices in April 2026, so check the pricing page for your region and deployment type.

```python
from dataclasses import dataclass


@dataclass
class Route:
    requests_per_month: int
    input_tokens: int
    output_tokens: int
    prompt_cache_hit_rate: float  # share of input tokens already served from provider prompt cache


@dataclass
class Prices:
    input_per_1m: float
    cached_input_per_1m: float
    output_per_1m: float
    embedding_per_1m: float


def model_cost(route: Route, prices: Prices, requests: float) -> float:
    cached = route.input_tokens * route.prompt_cache_hit_rate
    uncached = route.input_tokens - cached
    per_request = (
        uncached * prices.input_per_1m
        + cached * prices.cached_input_per_1m
        + route.output_tokens * prices.output_per_1m
    ) / 1_000_000
    return per_request * requests


def response_cache_saving(
    route: Route,
    prices: Prices,
    hit_rate: float,
    cache_fixed_per_month: float,
    semantic: bool,
    query_embedding_tokens: int = 0,
) -> float:
    baseline = model_cost(route, prices, route.requests_per_month)
    misses = route.requests_per_month * (1 - hit_rate)
    with_cache = model_cost(route, prices, misses) + cache_fixed_per_month
    if semantic:
        # Every request is embedded, hit or miss.
        with_cache += route.requests_per_month * query_embedding_tokens * prices.embedding_per_1m / 1_000_000
    return baseline - with_cache


def break_even_hit_rate(
    route: Route,
    prices: Prices,
    cache_fixed_per_month: float,
    semantic: bool,
    query_embedding_tokens: int = 0,
) -> float:
    # The saving is linear in hit_rate, so solve saving == 0 directly.
    at_zero = response_cache_saving(
        route, prices, 0.0, cache_fixed_per_month, semantic, query_embedding_tokens
    )
    slope = model_cost(route, prices, route.requests_per_month)
    return -at_zero / slope


if __name__ == "__main__":
    # Route numbers are placeholders; prices roughly match GPT-5 / text-embedding-3-small Global Standard list rates (April 2026).
    route = Route(requests_per_month=300_000, input_tokens=3_000, output_tokens=400, prompt_cache_hit_rate=0.6)
    prices = Prices(input_per_1m=1.25, cached_input_per_1m=0.125, output_per_1m=10.0, embedding_per_1m=0.02)

    # Cost only: this model ignores latency (the embedding round trip and vector search on every request).
    # Placeholder: replace with your Azure Managed Redis SKU (RediSearch enabled) monthly cost.
    semantic_fixed = 500.0
    # Placeholder: exact-match needs only a small key-value store, so a lower fixed cost.
    exact_fixed = 50.0
    for hit_rate in (0.02, 0.05, 0.10, 0.20, 0.40):
        semantic_saving = response_cache_saving(
            route, prices, hit_rate, cache_fixed_per_month=semantic_fixed, semantic=True, query_embedding_tokens=200
        )
        exact_saving = response_cache_saving(route, prices, hit_rate, cache_fixed_per_month=exact_fixed, semantic=False)
        print(
            f"hit rate {hit_rate:>4.0%}: semantic saving {semantic_saving:>10,.2f}"
            f" | exact-match saving {exact_saving:>10,.2f}"
        )

    semantic_be = break_even_hit_rate(
        route, prices, cache_fixed_per_month=semantic_fixed, semantic=True, query_embedding_tokens=200
    )
    exact_be = break_even_hit_rate(route, prices, cache_fixed_per_month=exact_fixed, semantic=False)
    print(f"break-even hit rate: semantic {semantic_be:.1%} | exact-match {exact_be:.1%}")
```

With these placeholders, exact-match breaks even at about a 3% hit rate and semantic caching only at about 29%, almost all of it the fixed cost of the Redis instance. Break-even is roughly that fixed cost divided by baseline model spend, so the 29% scales directly with your Redis SKU price. If one Redis instance serves several APIs, put only this route's share of its cost into `cache_fixed_per_month`, which pulls the break-even down. Compare that break-even point to a hit rate you've measured, not one you hope for. To measure it before building, log normalised prompts for a fortnight (hashed or redacted if the route carries personal data) and count how often a near-duplicate turns up within your intended TTL. The output price usually dominates, so response caches look best on routes with long answers, and the per-request embedding is negligible (about $1.20 a month here). A response cache in front also thins the traffic that keeps provider prompt caches warm, so re-measure `cached_tokens` after you add one.

## When the answer is "none of the above"

Sometimes caching is the wrong tool. If the expensive route is an offline job (overnight enrichment, bulk classification, document summarisation for an index), the [Batch API](https://learn.microsoft.com/azure/foundry/openai/how-to/batch) offers a 24-hour target turnaround at 50% of the Global Standard price, with its own quota so it doesn't compete with online traffic. If the problem is latency rather than cost, a smaller model on the routes that don't need a large one usually beats any cache. And if output tokens dominate, the cheapest change is often a tighter output format and a sensible `max_completion_tokens`, not infrastructure.

## My order of operations

Fix the prompt structure so provider caching works, because it's free and safe. Cache embeddings, retrieval and tool results next, because the risk is only staleness. Add an exact-match response cache only to pipelines that genuinely repeat inputs, with a key that includes the prompt version. Leave semantic caching for last, put it only on high-volume FAQ-shaped routes with impersonal answers, and only after the break-even arithmetic says your measured near-duplicate rate clears the cost of embedding every request. A cache you can't justify with your own traffic numbers is one more thing to run, not an optimisation.
