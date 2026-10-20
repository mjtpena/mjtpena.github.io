---
title: "GPT-5 in January 2025: Reading the Signals Instead of Guessing"
description: "What o1, the o3 announcement and reports on Orion actually tell us about GPT-5 in January 2025, and what Azure OpenAI teams should build while they wait."
author: Michael John Peña
draft: false
date: 2025-01-04
tags:
  - OpenAI
  - Azure OpenAI
  - GPT-5
  - LLM
  - Predictions
---

Every new year brings a fresh round of GPT-5 feature lists, most of them written as if the API already exists. It doesn't. As of early January 2025 there is no GPT-5 model, no announced date and no published API surface, so any code that calls `model="gpt-5"` is fiction. What we do have is a run of concrete releases and credible reporting from the last three months, and they say more about how to plan for 2025 than any wish list does.

In November I wrote about [what enterprise teams should prepare for ahead of GPT-5](/blog/2024-11-04-gpt5-speculation-enterprise/). This post is the January update: what changed in December, what it implies, and what I'd build now regardless of what OpenAI calls its next model.

## What we actually know

Here is the evidence, with nothing speculative mixed in.

| Signal | Date | What it tells us |
|---|---|---|
| Sam Altman's Reddit AMA: good releases coming, but nothing that would be called GPT-5 in 2024 | 31 Oct 2024 | GPT-5 was never a 2024 product |
| o1 released in ChatGPT, then in the API as `o1-2024-12-17` with function calling, Structured Outputs, developer messages, vision and a `reasoning_effort` parameter | 5 and 17 Dec 2024 | Reasoning models are now production-shaped, not just a preview curiosity |
| o3 and o3-mini announced, with early access for safety testing only and o3-mini expected around the end of January | 20 Dec 2024 | OpenAI's visible momentum is in the o-series |
| WSJ reports the GPT-5 project (codename Orion) is behind schedule and expensive to train | 20 Dec 2024 | Scaling up pre-training alone is giving smaller gains per dollar |
| [o1 lands in Azure OpenAI Service](https://learn.microsoft.com/en-us/azure/ai-services/openai/whats-new), limited access with registration required | 17 Dec 2024 | Azure customers get new OpenAI models, but not always on day one or without an access request |

The OpenAI announcement for [o1 and the new developer tools](https://openai.com/index/o1-and-new-tools-for-developers/) is worth reading in full. o1 in the API replaces o1-preview, uses noticeably fewer reasoning tokens than o1-preview did, and was initially rolled out to usage tier 5 accounts. The Wall Street Journal's "The Next Great Leap in AI Is Behind Schedule and Crazy Expensive" ([as covered by TechCrunch](https://techcrunch.com/2024/12/21/openais-gpt-5-reportedly-falling-short-of-expectations/)) describes at least two large training runs on Orion that fell short of what researchers hoped for, with costs reported at around half a billion dollars in compute for a six-month run.

Put those together and the pattern points one way: OpenAI is getting its biggest visible gains from spending more compute at inference time (the o-series), not from making the base model bigger.

## What I think that means for GPT-5

These are my own reads of the evidence, so treat them as opinion.

**GPT-5 will probably be a convergence, not just a bigger GPT-4o.** If pre-training gains are flattening and reasoning gains are not, the obvious product move is to merge the two lines so that one model can answer quickly when a task is simple and think longer when it isn't. Today you make that choice yourself by picking GPT-4o or o1. I expect OpenAI to want to take that choice away from developers eventually, and I'd plan for an API where cost and latency vary per request rather than per model.

**Cost will be shaped by thinking, not just by tokens in and out.** With o1, you already pay for reasoning tokens you never see. `reasoning_effort` is the first explicit dial on that spend. Any successor that blends fast and slow modes will make cost forecasting harder, because two identical prompts can consume very different amounts of compute.

**Timing is unknowable, so don't put it in a plan.** I'm not going to give you quarter-by-quarter guesses. The WSJ reporting says Microsoft expected to see the new model around mid-2024, and that didn't happen. If the people with the most visibility can't hit a date, a blog post shouldn't pretend to.

**On Azure, add lag and access steps.** o1-preview and o1-mini arrived in Azure OpenAI in September 2024 behind a registration process, and the December o1 model followed the same path (both are logged in [What's new in Azure OpenAI Service](https://learn.microsoft.com/en-us/azure/ai-services/openai/whats-new)). The `2024-12-17` o1 model launched on the Global Standard deployment type in a small set of regions, so check now whether your data-residency rules allow Global deployments at all; if they only permit Standard (regional) deployments, you'll be waiting longer than everyone else. Assume any GPT-5-class model will start with limited access, a handful of regions and a narrow set of deployment types. If your architecture can't move a workload to a different region or deployment type, you won't be able to use a new model early even if you get access.

## What to build now

None of the following depends on GPT-5's feature list. All of it pays off with the models you can deploy today.

### Treat model parameters as data, not code

The o1 family already broke a lot of code that assumed every chat model takes the same parameters. o1 rejects `temperature` and `top_p`, needs `max_completion_tokens` instead of `max_tokens`, and treats a `developer` message the way GPT-4o treats a `system` message. The [Azure OpenAI reasoning models guide](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/reasoning) lists the full set of differences and the API version you need.

The fix is to keep a small profile per deployment and build requests from it, so a new model family is a configuration change rather than a refactor. This needs Python 3.10+ and the `openai` package 1.58.0 or later (the release that added `reasoning_effort`) and an Azure OpenAI resource with both deployments in place:

```python
import os
from dataclasses import dataclass

from openai import AzureOpenAI

client = AzureOpenAI(
    azure_endpoint="https://<your-resource-name>.openai.azure.com",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version="2024-12-01-preview",
)


@dataclass(frozen=True)
class ModelProfile:
    deployment: str
    reasoning: bool
    instruction_role: str
    reasoning_effort: str | None = None


PROFILES = {
    "fast": ModelProfile(deployment="<your-gpt-4o-deployment>", reasoning=False, instruction_role="system"),
    "deep": ModelProfile(
        deployment="<your-o1-deployment>",
        reasoning=True,
        instruction_role="developer",
        reasoning_effort="medium",
    ),
}


def complete(tier: str, instructions: str, prompt: str, max_output_tokens: int = 2000) -> str:
    profile = PROFILES[tier]
    params = {
        "model": profile.deployment,
        "messages": [
            {"role": profile.instruction_role, "content": instructions},
            {"role": "user", "content": prompt},
        ],
    }
    if profile.reasoning:
        # Reasoning models reject temperature/top_p and count hidden reasoning tokens here.
        params["max_completion_tokens"] = max_output_tokens
        if profile.reasoning_effort:
            params["reasoning_effort"] = profile.reasoning_effort
    else:
        params["max_tokens"] = max_output_tokens
        params["temperature"] = 0.2

    response = client.chat.completions.create(**params)
    usage = response.usage
    print(f"{tier}: {usage.prompt_tokens} in, {usage.completion_tokens} out")
    choice = response.choices[0]
    if choice.finish_reason == "length":
        raise RuntimeError(f"{tier}: hit max_completion_tokens before finishing; raise the limit")
    return choice.message.content or ""


if __name__ == "__main__":
    print(complete("fast", "Answer in one paragraph.", "What is a star schema?"))
    print(complete("deep", "Show the trade-offs.", "Should we partition a 2 TB fact table by date or by region?"))
```

Two notes on this. First, `max_completion_tokens` on a reasoning model covers the hidden reasoning as well as the visible answer, so a low limit can return an empty response with `finish_reason` set to `length`. The function raises in that case rather than passing an empty string downstream. Give it headroom. Second, the tier names (`fast`, `deep`) are what your application code should depend on. When a new model arrives, you point a tier at it, or add a tier, and nothing else moves.

### Build the evaluation set before the model arrives

The single most useful thing you can have on GPT-5 launch day is a set of 50 to 200 real prompts from your workload with known-good answers or grading criteria. Without it, "is the new model better for us?" becomes a week of opinions. With it, it's an afternoon. I'd rather a team had a modest, honest evaluation set than a clever abstraction layer, because the abstraction only helps if you can prove the swap is safe.

Keep it boring: a JSONL file of inputs, expected outcomes and a grading method per case (exact match, a schema check, or a rubric scored by a model you've calibrated against human judgement). Run it against GPT-4o and o1 now. You don't need a platform for this: plain pytest over the JSONL file works, and if you want built-in quality evaluators and Azure AI Foundry result tracking, the Azure AI Evaluation SDK (`azure-ai-evaluation`, 1.x since November 2024) can run the same dataset. You'll learn which of your tasks actually benefit from reasoning, which is useful today and tells you where a stronger model would matter.

### Route by task, and measure the route

In the workloads I've reviewed, most requests don't need the most capable model. Classification, extraction and short summaries run well on GPT-4o mini or GPT-4o. Multi-step analysis, tricky code and planning are where o1 earns its latency and cost. Make that split explicit, log which tier served each request and what it cost, and review it monthly. When a new model shows up, that log tells you exactly which traffic to test it on.

### Budget for variance, not just price

Reasoning models make per-request cost less predictable. Set per-tier output token ceilings, alert on spend per feature rather than per subscription, and keep reasoning tiers away from high-volume, low-value paths. That discipline will matter more, not less, if the next generation decides for itself how long to think.

## When not to wait for GPT-5

If you're holding a project until "the next model" because the current one isn't good enough, check whether the gap is really model capability. My rule of thumb: check retrieval quality, missing context, success criteria and evaluation before blaming the model, because those are the usual blockers. A better model papers over some of that, at a higher price, and the underlying problems come back the moment the workload grows. Fix those first; they transfer to every model.

Equally, don't re-architect around rumoured capabilities. Native video input, million-token context or built-in citations may or may not arrive, and designing for them now is building on guesses.

## The short version

As of January 2025, GPT-5 has no date and no API, and the clearest signal is that OpenAI's progress is coming through reasoning models rather than a bigger base model. The best preparation is unglamorous: keep model choices in configuration, handle the o-series parameter differences cleanly, build an evaluation set from your own workload, and route traffic by task with cost visible. Do that and a new model, whatever it's called, becomes a test run and a config change rather than a project.
