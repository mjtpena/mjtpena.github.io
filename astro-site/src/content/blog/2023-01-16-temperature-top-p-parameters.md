---
title: "Temperature and Top-P in Azure OpenAI: What They Actually Change"
author: Michael John Peña
draft: false
date: 2023-01-16
description: "How temperature and top_p reshape token sampling in Azure OpenAI completions, why to tune one not both, and how to measure the effect before you ship."
tags:
  - Azure OpenAI
  - OpenAI
  - GPT-3
  - Prompt Engineering
  - Python
---

Most teams I talk to treat `temperature` as a "creativity dial" and leave it wherever the playground had it. That's a problem, because the completions API defaults to `temperature=1`, which is full sampling from the model's distribution, and that's rarely what you want behind an extraction or classification endpoint. With Azure OpenAI Service now [generally available](https://azure.microsoft.com/en-us/blog/general-availability-of-azure-openai-service-expands-access-to-large-advanced-ai-models-with-added-enterprise-benefits/), a lot of prototypes are about to become production workloads, and sampling settings are one of the cheapest things to get right before that happens.

This post explains what `temperature` and `top_p` do mechanically, shows how to see their effect on your own prompts, and gives my defaults for the common workloads. Everything here uses the completions endpoint with models such as `text-davinci-003` or `text-davinci-002` and the GA `2022-12-01` API version.

## What the model is actually choosing between

A GPT-3 model doesn't produce a sentence. At every step it produces a probability for every token in its vocabulary, and the service picks one. Then it does it again with that token appended. Both parameters act on that single step, repeated for every token in the output.

- **`temperature`** (0 to 2, default 1) rescales the distribution before sampling. Each token's log-probability is divided by the temperature and the result is renormalised. Below 1, likely tokens get more likely and unlikely ones fade. Above 1, the distribution flattens and long-tail tokens start getting picked. At 0 the service effectively takes the most likely token every time (argmax).
- **`top_p`** (0 to 1, default 1) is *nucleus sampling*, from Holtzman et al.'s [The Curious Case of Neural Text Degeneration](https://arxiv.org/abs/1904.09751). Sort tokens by probability, keep the smallest set whose cumulative probability reaches `top_p`, discard the rest, renormalise, then sample. At 0.1 you're sampling only from the tokens that make up the top 10% of probability mass.

The difference matters. Temperature changes the *shape* of the whole distribution. Top-p changes the *cut-off* and leaves the relative shape of what survives intact. When the model is confident (one token at 90%), `top_p=0.9` collapses to a single choice while `temperature=0.7` still leaves a small chance of the runner-up. When the model is uncertain (ten tokens at roughly 8% each), `top_p=0.9` keeps nearly all of them, while a low temperature still pushes hard toward the leader.

That's why the [Azure OpenAI REST reference](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference) carries the same advice as OpenAI's: alter `temperature` or `top_p`, but not both. Stacking them makes the effective behaviour hard to reason about, and you lose the ability to say which knob caused a regression.

## Seeing it on your own prompts

You don't have to take the theory on faith. The completions API can return the top candidate tokens and their log-probabilities through the `logprobs` parameter (up to 5). Pulling those for the first token of a response, then applying temperature and top-p locally, shows exactly what each setting would do to that one decision.

This uses the `openai` Python package (0.26.x at the time of writing) configured for Azure:

```python
import math
import os

import openai

openai.api_type = "azure"
openai.api_base = os.environ["AZURE_OPENAI_ENDPOINT"]  # https://<your-resource-name>.openai.azure.com/
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

DEPLOYMENT = "<your-davinci-deployment>"

PROMPT = (
    "Classify the sentiment of this review as Positive, Negative or Neutral.\n"
    "Review: The install was painless but support never replied.\n"
    "Sentiment:"
)

response = openai.Completion.create(
    engine=DEPLOYMENT,
    prompt=PROMPT,
    max_tokens=1,
    temperature=0,
    logprobs=5,
)

# Top 5 candidate tokens for the first position, as {token: logprob}
top = response["choices"][0]["logprobs"]["top_logprobs"][0]


def apply_temperature(logprobs: dict, temperature: float) -> dict:
    """Rescale and renormalise over the returned candidates only."""
    scaled = {tok: lp / temperature for tok, lp in logprobs.items()}
    total = sum(math.exp(v) for v in scaled.values())
    return {tok: math.exp(v) / total for tok, v in scaled.items()}


def apply_top_p(probs: dict, top_p: float) -> dict:
    """Keep the smallest set of tokens whose cumulative probability reaches top_p."""
    kept, cumulative = {}, 0.0
    for tok, p in sorted(probs.items(), key=lambda kv: kv[1], reverse=True):
        kept[tok] = p
        cumulative += p
        if cumulative >= top_p:
            break
    total = sum(kept.values())
    return {tok: p / total for tok, p in kept.items()}


for t in (0.3, 0.7, 1.0, 1.5):
    probs = apply_temperature(top, t)
    print(f"temperature={t}: " + ", ".join(f"{tok!r}={p:.2f}" for tok, p in probs.items()))

base = apply_temperature(top, 1.0)
for p in (0.5, 0.9, 1.0):
    probs = apply_top_p(base, p)
    print(f"top_p={p}: " + ", ".join(f"{tok!r}={v:.2f}" for tok, v in probs.items()))
```

It's an approximation: the service only returns the top five candidates, so renormalising over five tokens overstates their share compared with the full vocabulary. For a classification prompt like this one, the top five usually carry nearly all the mass, so the picture is close enough to be useful. Two things usually jump out. First, on a well-constrained prompt the leading token often sits above 0.9, so moderate temperature changes make little difference there. Second, on an open-ended prompt the leading token can sit at 0.2 or lower, and that's where temperature starts rewriting your output.

That's the real lesson: **the right setting depends on how confident the model is for your prompt**, not on a category label like "creative" or "factual".

## Measuring variability before you pick a number

The second check I'd run is empirical. Ask for several completions in one call with `n`, and count how many distinct answers come back at each setting:

```python
import os

import openai

openai.api_type = "azure"
openai.api_base = os.environ["AZURE_OPENAI_ENDPOINT"]
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

DEPLOYMENT = "<your-davinci-deployment>"
PROMPT = "Suggest a name for an internal tool that tracks Azure spend by team:"


def distinct_outputs(temperature: float, samples: int = 10) -> int:
    response = openai.Completion.create(
        engine=DEPLOYMENT,
        prompt=PROMPT,
        max_tokens=20,
        temperature=temperature,
        n=samples,
    )
    texts = {choice["text"].strip().lower() for choice in response["choices"]}
    return len(texts)


for t in (0.0, 0.4, 0.8, 1.2):
    print(f"temperature={t}: {distinct_outputs(t)} distinct out of 10")
```

Remember that `n=10` bills ten completions' worth of tokens. Keep `max_tokens` small for this kind of probe, and run it against a handful of representative prompts rather than one.

Also expect a non-zero count at `temperature=0` occasionally. Zero gets you close to deterministic, not guaranteed deterministic: when two tokens are nearly tied, small numerical differences can flip the choice, and one flipped token changes everything after it. If you need repeatable output for audit or caching, store the response rather than assuming you can regenerate it.

## My defaults

These are starting points, tuned by moving temperature only and leaving `top_p` at 1:

| Workload | `temperature` | Why |
|---|---|---|
| Extraction, classification, structured output | 0 | You want the most likely answer and a parseable format every time |
| Code generation (`code-davinci-002`) | 0 to 0.2 | Syntax is unforgiving; small variation helps only when retrying a failed attempt |
| Summarisation, Q&A over supplied text | 0.2 to 0.4 | Some phrasing variety, little drift from the source |
| Conversational replies | 0.5 to 0.7 | Avoids repeating the same canned sentence, still stays on topic |
| Brainstorming, naming, marketing drafts | 0.8 to 1.0 | Variety is the point, and a human picks from the output |

I rarely go above 1. Past that point you're deliberately sampling tokens the model thinks are unlikely, and davinci starts producing fluent nonsense. If a temperature of 1 isn't varied enough, the prompt usually needs work (ask for "ten different names in different styles") rather than the sampler.

When would I reach for `top_p` instead? When the long tail is the problem rather than the overall sharpness. For example, a moderately creative task where the occasional bizarre token derails an output: `top_p=0.9` at `temperature=1` trims the tail while keeping the genuine alternatives. That's a narrower use case than most guides suggest.

## The penalties are a different tool

`frequency_penalty` and `presence_penalty` (both -2.0 to 2.0, default 0) get lumped in with sampling, but they solve a different problem: repetition across a longer output. Frequency penalty reduces a token's likelihood in proportion to how often it has already appeared; presence penalty applies a flat reduction once it has appeared at all.

Use them for long-form generation that loops ("…and also scalable, and also scalable…") or for lists that keep returning near-duplicates. Values between 0.1 and 0.8 are usually plenty. Don't use them on structured output: a penalty on repeated tokens will happily discourage the quotes, commas and field names your JSON needs.

## When not to tune sampling at all

Sampling parameters get blamed for problems they can't fix:

- **Wrong answers at temperature 0** are a prompt or knowledge problem. Temperature 0 gives you the model's best guess; if that guess is wrong, add context or examples. I covered the prompt side in [Prompts Are Production Code](/blog/2023-01-12-prompt-engineering-fundamentals/).
- **Inconsistent format** is usually fixed with few-shot examples and a stop sequence, not a lower temperature.
- **Output that's too long or truncated** is `max_tokens` and `stop`, which I touched on in the [token management post](/blog/2023-01-11-token-management-azure-openai/).

## What I'd do this week

If you have Azure OpenAI completions in flight, check every call site for an explicit `temperature`. Anything that feeds code (parsers, classifiers, SQL, JSON) should be at 0 unless someone can say why it isn't. For the rest, pick a temperature per workload, leave `top_p` alone, and run the `n`-sample check on real prompts before you commit to a number. Keep the setting in configuration next to the prompt, not hard-coded, so you can change one without redeploying the other.

The settings are cheap to change and cheap to test. What's expensive is discovering in production that a classifier has been answering "Positive" one call and "Mostly positive" the next because nobody set the default.
