---
title: "Why Your Azure OpenAI Prompt Cache Keeps Missing"
description: "Azure OpenAI caches prompt prefixes automatically, yet many apps see few cache hits. How to measure the hit rate and fix the prompt shapes that break it."
author: Michael John Peña
draft: false
date: 2026-02-16
tags:
  - Azure OpenAI
  - Prompt Engineering
  - Performance
  - Cost Optimization
---

Prompt caching on Azure OpenAI is switched on by default, needs no configuration, and costs nothing extra. That is exactly why most teams never look at it, and why so many production apps pay full input price for a system prompt the service has already processed thousands of times. The feature works; the prompts don't. If you never check `cached_tokens`, you have no idea which side of that line you are on.

I've covered the general idea before, in [prompt caching strategies](/blog/2025-03-17-prompt-caching-strategies/) and in a [comparison of Claude and Azure OpenAI caching](/blog/2025-07-09-july-ai-topic/). This post is narrower. It's a checklist for working out why your hit rate is low, based on how the service actually decides whether a request can reuse the cache.

## How the cache decides

The [Azure OpenAI prompt caching documentation](https://learn.microsoft.com/azure/foundry/openai/how-to/prompt-caching) is short, and every line in it matters. As of February 2026, it states these rules for Azure OpenAI in Microsoft Foundry Models. The routing hash and overflow rate match what OpenAI publishes for the same mechanism, and where the two sources differ, the table says which one is speaking:

| Rule | What it means for your prompt |
|---|---|
| Supported on GPT-4o and newer, for chat completions, completions, Responses and realtime operations | Older deployments get nothing, so check what you are actually calling |
| Request must be at least 1,024 tokens | Short prompts are never cached, no matter how often you send them |
| The first 1,024 tokens must be identical | One changed character early in the prompt means `cached_tokens` is 0 |
| After 1,024, hits extend in 128-token steps | The cached portion grows with the longest matching prefix |
| Requests are routed on a hash of the prefix, usually the first 256 tokens | The start of the prompt decides which machine, and which cache, you land on |
| Optional `prompt_cache_key` is combined with that hash | You can steer requests that share a prefix to the same place |
| Roughly 15 requests per minute per prefix and key before overflow | Above that, some requests spill to other machines and miss |
| Azure's page says caches are cleared within 24 hours and aren't shared across subscriptions; [OpenAI's guide](https://developers.openai.com/api/docs/guides/prompt-caching) for the same mechanism says in-memory caches typically clear after 5–10 minutes of inactivity and always within an hour | 24 hours is an upper bound, not a promise. If eviction behaves as OpenAI describes, infrequent traffic won't keep a cache warm |
| No opt-out | You can't disable it, only design for it |

What gets cached is broader than people assume: the whole messages array (system, developer, user and assistant turns), images in user messages (as long as `detail` is the same), tool definitions, and the structured output schema, which is added as a prefix to the system message.

The payoff depends on the deployment type. On Standard deployments, cached input tokens are billed at a discount on the input price, and the size of that discount depends on the model. In February 2026 it ranged from 50% on GPT-4o to 75% on GPT-4.1 and 90% on GPT-5-family models, so check the [Azure OpenAI pricing page](https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/) for the models you run. On provisioned deployments, the [provisioned throughput documentation](https://learn.microsoft.com/azure/foundry/openai/concepts/provisioned-throughput) says cached tokens are taken off the utilisation estimate, up to a 100% discount on prompt tokens. With PTU, that means a better hit rate gives you more concurrency on capacity you've already paid for. In my view that's the stronger argument for caring about this, more than the per-token saving.

## Measure before you restructure

Don't guess. Every response carries `usage.prompt_tokens_details.cached_tokens`, and the only number that matters is cached tokens divided by prompt tokens, summed over real traffic. Averaging per-request percentages overweights small requests, which aren't eligible for caching anyway.

Here's a small harness I'd use to replay a representative sample of production prompts against a deployment. Point `long_doc` at a real static prompt file over 1,024 tokens; with a short string, every call is ineligible and the script reports a 0% hit rate. It uses the v1 API, which reached GA in August 2025 and works with the standard `OpenAI` client (see the [API lifecycle page](https://learn.microsoft.com/azure/foundry/openai/api-version-lifecycle)). `prompt_cache_key` needs `openai` 1.98.0 or later (any 2.x release, current in February 2026, has it).

```python
import os
from collections import defaultdict
from pathlib import Path

from openai import OpenAI

client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
)

DEPLOYMENT = "<your-deployment-name>"


def run(requests: list[dict]) -> None:
    """Each request is {"route": str, "messages": list, "cache_key": str | None}."""
    totals = defaultdict(
        lambda: {
            "prompt": 0,
            "cached": 0,
            "calls": 0,
            "eligible": 0,
            "eligible_prompt": 0,
            "eligible_cached": 0,
        }
    )

    for req in requests:
        kwargs = {"model": DEPLOYMENT, "messages": req["messages"], "max_completion_tokens": 50}
        if req.get("cache_key"):
            kwargs["prompt_cache_key"] = req["cache_key"]

        response = client.chat.completions.create(**kwargs)
        usage = response.usage
        details = usage.prompt_tokens_details
        cached = (details.cached_tokens or 0) if details else 0

        t = totals[req["route"]]
        t["calls"] += 1
        t["prompt"] += usage.prompt_tokens
        t["cached"] += cached
        if usage.prompt_tokens >= 1024:
            t["eligible"] += 1
            t["eligible_prompt"] += usage.prompt_tokens
            t["eligible_cached"] += cached

    for route, t in sorted(totals.items()):
        rate = t["cached"] / t["prompt"] if t["prompt"] else 0.0
        eligible_rate = (
            t["eligible_cached"] / t["eligible_prompt"] if t["eligible_prompt"] else 0.0
        )
        print(
            f"{route:<20} calls={t['calls']:<5} eligible={t['eligible']:<5} "
            f"token_hit_rate={rate:.1%} eligible_hit_rate={eligible_rate:.1%}"
        )


if __name__ == "__main__":
    long_doc = Path("<your-static-prompt-file>.md").read_text(encoding="utf-8")  # must exceed 1,024 tokens
    sample = [
        {
            "route": "support",
            "messages": [
                {"role": "system", "content": long_doc},
                {"role": "user", "content": question},
            ],
            "cache_key": "support",
        }
        for question in ["How do I reset my password?", "Where is my invoice?"]
    ]
    run(sample)
```

Treat replay numbers as indicative, not exact: replay pays a cold miss on the first call per prefix that a warm production cache wouldn't, but sequential replay never triggers overflow or idle eviction, so production telemetry is the real measure. On reasoning models such as the GPT-5 family, 50 tokens may end in `finish_reason="length"`, which doesn't affect the usage numbers.

Break the result down by route or feature, not just for the whole app. A single global number hides the one endpoint that builds its prompt differently. The `eligible` count matters too: if most calls fall under 1,024 tokens, a low hit rate isn't a structure problem, and you can stop here. When there are enough eligible calls, `eligible_hit_rate` is the number to act on, because it leaves out requests that could never be cached.

In production, log the same two fields from every response into whatever telemetry you already have, and chart the token-weighted ratio per route. That's enough. You don't need a new platform for this.

## The usual culprits

When eligible requests aren't hitting, the cause is almost always one of these. Roughly in order of how often I see them:

### Dynamic values at the top of the system prompt

Today's date, the user's name, a tenant ID, a request ID "for tracing". Any of these in the first few hundred tokens changes the routing hash and the prefix together, so every request is effectively a new prompt. Move them into a short message after the static instructions, or into the user turn.

```python
from pathlib import Path

STATIC_INSTRUCTIONS = Path("system_prompt.md").read_text(encoding="utf-8")


def build_messages(user_name: str, today: str, question: str) -> list[dict]:
    return [
        {"role": "system", "content": STATIC_INSTRUCTIONS},
        {"role": "system", "content": f"Current user: {user_name}. Today's date: {today}."},
        {"role": "user", "content": question},
    ]
```

### Tools and schemas that aren't byte-stable

Tool definitions and structured output schemas are part of the cached prefix. If your code builds the tool list from a dictionary with unstable ordering, adds or removes tools depending on the user's permissions, or regenerates a JSON schema with different key order, the prefix changes. Freeze the tool list per route and serialise schemas deterministically. If different users need different tools, accept a separate cache per tool set rather than a fresh prefix per request.

### Retrieved context placed before the instructions

In RAG, the retrieved chunks change on every query, so they have to come after everything static: instructions, few-shot examples, output format and tools. I still see templates that put "Context:" at the very top because it read more naturally to whoever wrote it. Moving context after the instructions rarely hurts quality and often helps, but check with your evals; the cache, on the other hand, always cares.

### A shared prefix that's too short

If your static instructions come to 600 tokens, there's nothing to cache, because the first 1,024 tokens include per-request content. Sometimes the right answer is to move stable material you already send, such as few-shot examples or a fixed glossary, up into the static block so the shared prefix clears the threshold. Don't pad prompts with filler just to reach 1,024. You'd pay for those tokens on every miss and dilute the instructions.

### Hot prefixes overflowing

This is the opposite problem, and it only shows up at volume. A single popular prefix above roughly 15 requests per minute spills across machines, and the hit rate drops as traffic grows. One key per route doesn't fix this, because all of that route's traffic still lands on a single prefix and key combination. What helps is partitioning: split a hot prefix across several stable `prompt_cache_key` values (per tenant, or a fixed hash bucket of the tenant or user ID) so each prefix and key combination stays under about 15 requests per minute, and keep the key-to-prefix mapping stable so each bucket stays warm. Don't go to the other extreme with a per-request key or a raw per-user key on a high-traffic app, though. You'd split the cache into fragments too small to stay warm. The [OpenAI prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) gives the same advice for the same mechanism: pick a key granularity that keeps each prefix and key combination under that rate.

### Conversation history that gets rewritten

Multi-turn chat caches well when it only grows. Each turn's prefix is the previous turn plus new messages. It stops caching the moment you summarise, truncate from the front, or reorder history, because the prefix changes. If you need to compact, do it in large, infrequent steps instead of trimming a little on every turn, and you'll take one miss per compaction instead of one per request.

## When not to bother

Caching isn't worth engineering effort everywhere. Skip the restructuring when:

- Most of your prompts are under 1,024 tokens. Nothing will be cached.
- Traffic per prefix is sparse, with a few calls an hour across many distinct prompts. Azure only commits to clearing caches within 24 hours, but OpenAI's guide for the same mechanism says in-memory caches typically clear after 5–10 minutes of inactivity, so plan on a prefix used a few times an hour being cold.
- Output tokens dominate your bill. Caching only touches input, so a long-generation workload with short prompts gains little.
- The restructuring would hurt answer quality. If moving instructions around changes model behaviour, run your evaluations first. A cheaper wrong answer isn't a saving.

Also, don't confuse this with semantic or response caching. Prompt caching never changes the output. It only skips recomputing an identical prefix. Reusing whole answers for similar questions is a separate design with its own correctness risks.

## Where I'd start

Log `cached_tokens` and `prompt_tokens` for every call this week, and compute the token-weighted hit rate per route. For any route where most requests are over 1,024 tokens but the hit rate is low, look at the first 256 tokens of the prompt. That's usually where the culprit is. Fix the ordering, freeze the tools, add a `prompt_cache_key` per tenant or route for prompts that share a long prefix (the service combines it with the prefix hash to steer routing), split it into more keys if a prefix and key combination passes about 15 RPM, and measure again. On provisioned deployments, do this before you buy more PTUs. Some of the capacity you need may already be there.
