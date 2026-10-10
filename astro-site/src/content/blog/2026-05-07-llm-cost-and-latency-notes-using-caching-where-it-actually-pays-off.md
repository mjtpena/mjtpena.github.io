---
title: "Why an LLM Response Cache Moves Your p50 but Rarely Your p95"
description: "A response cache only speeds up the requests it hits, so the tail stays slow until hit rates get very high. Here's the arithmetic and what fixes p95 instead."
author: Michael John Peña
draft: false
date: 2026-05-07
tags:
  - Azure OpenAI
  - Caching
  - Performance
  - LLM
  - API Management
---

Teams often add a response cache to fix latency, and a month later the dashboard says the average dropped while the p95 complaint that started the project is still open. That isn't the cache failing. A cache only makes its hits faster, and the slow tail of the distribution is made up almost entirely of misses. If your latency target is a high percentile, you need to know how much of that tail a cache can reach before you build one.

I covered the cost side in [four LLM caches and how to tell which one will pay off](/blog/2026-04-15-llm-cost-and-latency-notes-using-caching-where-it-actually-pays-off/). This one is about latency, and specifically percentiles.

## The arithmetic of a mixed distribution

With a response cache in front of the model, every request is either a hit (a key lookup, milliseconds) or a miss (the full model call, seconds). The overall latency distribution is a mix of the two, weighted by the hit rate.

Because every hit is faster than every miss, the fastest `h` share of requests are the hits, where `h` is the hit rate. Any percentile above `h` falls among the misses. Specifically, the overall p-th percentile is the miss distribution's percentile at `(p − h) / (1 − h)`.

Plug in a p95 target and see what the cache does to it:

| Hit rate | Overall p95 equals this percentile of the misses | What that means |
|---|---|---|
| 0% | p95 | Baseline |
| 30% | p92.9 | Barely moves |
| 60% | p87.5 | Noticeable, but still a slow request |
| 80% | p75 | Better, still a full model call |
| 95% | The fastest misses (the boundary) | Below a second, still not a hit |
| Above 95% | Falls among the hits | The tail finally collapses |

The p50 behaves completely differently. Once the hit rate passes 50%, the median *is* a cache hit, and it drops from seconds to milliseconds. That's why the dashboard looks good while the people who complained still get slow answers 5% of the time.

The practical rule I use: **a response cache takes percentile p out of model-call territory only when the hit rate gets close to p.** Below that it trims the tail at best, and that trim is still a full model call. If you need a better p95 and you can't credibly reach a 90%+ hit rate on that route, a response cache isn't your latency fix. It may still be a cost fix, which is a different argument.

## Semantic caching shifts the whole curve the wrong way first

An exact-match cache adds almost nothing to a miss: hash the request, one key lookup, carry on. A semantic cache is different. Every request, hit or miss, waits for an embeddings call and a vector search before anything else happens. In Azure API Management, that's how the [`llm-semantic-cache-lookup` policy](https://learn.microsoft.com/azure/api-management/llm-semantic-cache-lookup-policy) works: it calls your embeddings backend to vectorise the prompt, then searches the configured Redis cache for a stored prompt within the score threshold.

The misses that make up the tail now carry the lookup overhead too. So a semantic cache always has a worse p95 than an exact-match cache at the same hit rate, and at low hit rates (around 10% with the inputs below) its p95 is no better than having no cache at all. It only clearly pays off at the tail when the hit rate is high enough to push p95 towards the hits.

## Simulating your own route

You don't need production traffic to see the shape of this. The script below uses only the Python standard library. It models misses as a lognormal distribution (a reasonable shape for model-call latency, which has a long right tail) and compares exact-match and semantic caches across hit rates. Every number at the top is a placeholder, so replace them with the median and spread you measure on your own route, and the semantic overhead you measure for your embeddings call plus Redis lookup.

```python
import math
import random
import statistics

# Placeholder latency model in seconds. Replace with your own route's measurements.
MISS_MEDIAN = 2.5          # median end-to-end model call
MISS_SPREAD = 0.5          # lognormal sigma; larger means a longer tail
HIT_LATENCY = 0.02         # exact-match key lookup and response return
LOOKUP_OVERHEAD = 0.15     # semantic cache: query embedding plus vector search, paid on every request
REQUESTS = 200_000


def miss_latency(rng: random.Random) -> float:
    return rng.lognormvariate(math.log(MISS_MEDIAN), MISS_SPREAD)


def simulate(hit_rate: float, semantic: bool, seed: int = 7) -> tuple[float, float, float]:
    rng = random.Random(seed)
    overhead = LOOKUP_OVERHEAD if semantic else 0.0
    samples = []
    for _ in range(REQUESTS):
        if rng.random() < hit_rate:
            samples.append(HIT_LATENCY + overhead)
        else:
            samples.append(miss_latency(rng) + overhead)
    cuts = statistics.quantiles(samples, n=100, method="inclusive")
    return statistics.fmean(samples), cuts[49], cuts[94]


if __name__ == "__main__":
    mean, p50, p95 = simulate(0.0, semantic=False)
    print(f"{'no cache':<22} mean={mean:5.2f}s  p50={p50:5.2f}s  p95={p95:5.2f}s")
    for hit_rate in (0.1, 0.3, 0.6, 0.8, 0.95):
        for semantic in (False, True):
            label = f"{'semantic' if semantic else 'exact'} @ {hit_rate:.0%} hits"
            mean, p50, p95 = simulate(hit_rate, semantic)
            print(f"{label:<22} mean={mean:5.2f}s  p50={p50:5.2f}s  p95={p95:5.2f}s")
```

With these placeholder inputs, the baseline p95 is about 5.7 seconds. A 30% hit rate takes the median from 2.5 to about 1.9 seconds but only takes p95 to about 5.2. At 60% hits the median is a cache hit while p95 is still around 4.5 seconds. Only at 95% does p95 fall below a second. At a 10% hit rate, the semantic variant's p95 is no better than having no cache at all. Your numbers will differ, but the shape won't, because it comes from the arithmetic above rather than from the inputs.

## Measure hits and misses as separate populations

The other reason caches look better than they are is reporting. If cache hits go into the same latency histogram as model calls, the average and median improve and everybody relaxes. I'd tag every request with how it was served (`hit`, `miss`, or `bypass` for routes that skip the cache) and report percentiles for each population separately, alongside the blended number.

That split answers the questions you actually need answered. Is the miss path getting slower? Did the semantic lookup overhead creep up after someone moved Redis to a different region? Is the hit rate holding up, or did a prompt template change quietly drop it? None of those are visible in a single blended p95.

Be explicit about which latency the target means, too. For streaming routes I'd define the SLO as time to first token, because that's what the user waits on; for non-streaming routes it has to be end-to-end. The levers differ: prompt caching and caching the steps before the model call shorten time to first token, while output length and reasoning effort mostly shorten end-to-end time. The simulation above models end-to-end latency, so read it with that in mind.

## What actually moves p95

If the tail is made of misses, the fix has to make misses faster. These are the levers I'd look at first, roughly in order of effort.

### Provider prompt caching

This is the one cache that helps the miss path, because it works on every eligible request rather than only on repeats. Azure OpenAI caches the processed prompt prefix automatically for requests of 1,024 tokens or more, and the [prompt caching documentation](https://learn.microsoft.com/azure/foundry/openai/how-to/prompt-caching) describes it as reducing both cost and latency. OpenAI's [guide to the same mechanism](https://developers.openai.com/api/docs/guides/prompt-caching) describes large time-to-first-token gains on long prompts. Treat any headline figure as a ceiling: the gain is in time to first token, it grows with the length of the cached prefix, and it does nothing for output generation. It also isn't guaranteed on every request: Azure's documentation notes that when one prefix and `prompt_cache_key` combination goes above roughly 15 requests per minute, some requests can overflow to other machines and miss the cache. On a high-volume route, check `cached_tokens` on your p95 requests, not just on average. Long-prompt, short-answer routes such as RAG with heavy instructions, classification and extraction get the most from it. If your hit rate is low, [why your Azure OpenAI prompt cache keeps missing](/blog/2026-02-16-prompt-caching-performance/) has the checklist.

### Cache the steps before the model call

A RAG request often embeds the query, runs one or more searches and calls a tool or two before the model sees anything. All of that is serial, and all of it lands before the first token. Caching query embeddings, retrieval results for common queries and slow reference-data lookups shortens every request that needs them, including the ones whose final answer is unique. This is a much better latency lever than a response cache for most conversational routes, because the hit rate on the parts is far higher than the hit rate on the whole.

### Fewer output tokens and less reasoning

On a miss, generation time usually dominates. A tighter output format, a sensible `max_completion_tokens`, and a lower reasoning effort on routes that don't need deep reasoning shorten every miss. I went through these in [where LLM latency goes](/blog/2026-03-24-llm-cost-and-latency-notes-reducing-token-waste-without-hurting-answer-quality/), so I won't repeat them here.

### Capacity that doesn't queue

Some tail latency isn't about the request at all. It's the variance of shared capacity at busy times. Provisioned throughput gives you more predictable latency on capacity you've reserved, and Microsoft introduced [priority processing](https://learn.microsoft.com/azure/foundry/openai/concepts/priority-processing) as a public preview at Ignite in November 2025 as a pay-as-you-go option for lower latency at a premium. Check its current status, supported models and deployment types before you plan around it. Picking between these per journey is the subject of [latency budgets as a cost control](/blog/2026-04-04-keeping-ai-workloads-economical-setting-latency-budgets-per-user-journey/).

## When a response cache really is the latency answer

There are routes where hit rates of 90% or more are realistic, and there a response cache does fix the tail:

- A UI action over content that rarely changes, such as "summarise this policy" on a fixed policy library.
- A small, closed set of questions, such as the dozen onboarding questions that make up most of an internal assistant's first-week traffic.
- Any input that is identical for every user, such as a daily digest.

For these, I'd go one step further and stop treating it as a cache at all. If you know the inputs, generate the answers ahead of time and serve them from a lookup table, refreshed when the source content changes. The [Batch API](https://learn.microsoft.com/azure/foundry/openai/how-to/batch) suits that refresh job: it targets a 24-hour turnaround at a discount on the Global Standard price, and it runs on its own quota. A precomputed answer has a 100% hit rate by construction, no first-user penalty after an expiry, and no similarity threshold to tune. The trade-off is that you only get answers for the inputs you predicted, so you still need a live fallback for everything else.

And remember the correctness side. A semantic cache that pushes hit rate up by loosening the similarity threshold buys latency with wrong answers. If a looser threshold is the only way to reach the hit rate your p95 needs, the route isn't a good fit for semantic caching.

## How I'd decide

Start from the percentile you've promised, not from the cache. Before building anything, pull last week's requests that landed above your p95 and count how many of them a cache could have served: exact repeats, near-duplicates you'd trust a semantic match on, or inputs you could have precomputed. If that count is small, the miss path is your project: prompt caching, the steps before the model call, output length, and capacity. If the target is the median, or the goal is really cost, a response cache can be the right call on its own. Either way, report hit and miss latency separately, so the next dashboard tells you which one you actually improved.
