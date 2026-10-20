---
title: "Latency Budgets as a Cost Control: Pricing Each AI User Journey"
description: "Set a latency budget per user journey, then let it choose the Azure OpenAI deployment tier, model and reasoning effort you actually pay for."
author: Michael John Peña
draft: false
date: 2026-04-04
tags:
  - AI
  - LLM
  - Azure OpenAI
  - Cost Optimization
  - Architecture
---

Most AI applications have one latency target, usually "as fast as possible", and one deployment configuration that serves every request. That is how a nightly summarisation job ends up running on the same provisioned capacity as the customer chat, and how a back-office classifier ends up on a reasoning model with default effort. Latency is not free on Azure OpenAI: every step towards faster or more predictable responses has a price, so a latency target is also a spending decision.

My position is that latency budgets should be set per user journey, written down, and used to choose the deployment tier, the model and the reasoning effort. The budget is what tells you where you are allowed to be cheap. Without it, teams default to the expensive option everywhere because nobody can prove the cheaper one is acceptable.

For the token-level side of this (which tokens slow a request and which only cost money), see [where LLM latency goes](/blog/2026-03-24-llm-cost-and-latency-notes-reducing-token-waste-without-hurting-answer-quality/). This post sits one level up: which journeys deserve fast, predictable capacity at all.

## What a latency budget per journey looks like

A user journey is a path a person or system takes that ends in an outcome: "agent drafts a reply to a support ticket", "analyst asks a question of the sales semantic model", "invoices are classified overnight". Each one has a different tolerance for waiting, and that tolerance is a product decision, not an engineering one.

A useful budget has four parts:

- **Who is waiting.** A customer in a chat window, an employee in an internal tool, or nobody.
- **Which clock matters.** Time to first token for anything streamed to a person; total time for anything a downstream system waits on.
- **The percentile.** I'd budget on p95, not the average. Users remember the slow responses, and averages hide queueing on a busy deployment.
- **What happens when the budget is missed.** Degrade to a simpler answer, fall back to another deployment, or simply wait. This is the part teams skip, and it decides whether you need reserved capacity at all.

The last point matters because "must never be slow" and "should usually be fast" lead to very different bills. Only the first needs reserved or premium capacity.

## The tiers you are actually choosing between

On Azure OpenAI in Microsoft Foundry, the deployment types give you a ladder of latency behaviour and cost. As of April 2026, the options that matter for this decision are:

| Option | Latency behaviour | How you pay | Fits journeys that |
|---|---|---|---|
| Global Batch | Asynchronous, 24-hour target turnaround | Around 50% less than Global Standard, separate enqueued quota | Nobody waits on; results needed within a day |
| Global Standard / Data Zone Standard | Good on average, varies with shared load | Pay per token | Most internal tools and tolerant user journeys |
| Priority processing | Lower, more consistent latency on pay-as-you-go | Premium per-token rate | Customer-facing, spiky, can't justify reserved capacity |
| Provisioned throughput (PTU) | Predictable when utilisation stays under capacity | Per PTU per hour, used or not; reservations lower the rate | Steady, high-volume, latency-sensitive traffic |

[Global Batch](https://learn.microsoft.com/azure/foundry/openai/how-to/batch) is the cheapest way to run anything that doesn't need an answer now, and its quota is separate from your online deployments, so batch work doesn't eat into the headroom your interactive journeys rely on. Microsoft announced priority processing as generally available on 23 March 2026 (some docs still label it preview). [Priority processing](https://learn.microsoft.com/azure/foundry/openai/concepts/priority-processing) is available on Global Standard and Data Zone Standard (US) deployments of gpt-4.1, gpt-5.1, gpt-5.2 and gpt-5.4, using API version 2025-12-01 or later (the v1 endpoint qualifies), and you opt in per deployment or per request with `service_tier`.

Priority is a request, not a guarantee. The service can serve a priority request at the standard tier when your priority traffic ramps by more than 50% in under 15 minutes or during peak demand, and on gpt-4.1 and gpt-5.4 requests estimated at over 128k prompt tokens are always downgraded. Those requests are billed at the standard rate and come back with `service_tier` set to `default` in the response. For a latency budget that matters: log the tier the service actually used, per journey, or you won't know whether a breached p95 came from your prompt or from a downgrade. Provisioned throughput is the one to be careful with: it only pays off when utilisation is high and steady, because idle PTUs cost the same as busy ones.

Data residency can narrow these choices before cost does. If a journey's data must stay in a geography, Global deployment types may be off the table, and the comparison becomes Data Zone or regional options only. Settle that first.

## Mapping journeys to tiers

Here is how I'd map a typical set of journeys onto the tiers from the previous table, with each journey's budget deciding which rung it sits on. The budgets are examples of the shape, not recommendations for your product.

| Journey | Who waits | Budget (p95) | Tier | Model and effort |
|---|---|---|---|---|
| Customer support chat | Customer | 1.5 s to first token | Global Standard with priority processing | Flagship model, `reasoning_effort: none` |
| Agent-assist reply draft | Employee | 4 s to first token | PTU with spillover to Global Standard | Mid-size model, low effort |
| Internal policy Q&A | Employee | 6 s to first token | Global (or Data Zone) Standard | Small model |
| Contract clause review | Analyst, async | Minutes | Global (or Data Zone) Standard, queued | Reasoning model, higher effort |
| Ticket classification | Nobody | Within 24 h | Global Batch | Small model |

Where residency rules out Global deployments, read "Data Zone" for "Global" throughout; the budgets don't change. Global Batch's 24-hour turnaround is a target, not a guarantee, so a job submitted at 6pm can legitimately finish at 6pm the next day. A hard morning deadline needs Global Standard or a submit time that leaves the full 24-hour window.

Two things stand out once you write a table like this. First, only two journeys in five need premium capacity, and only one of them pays a premium on every request; the agent-assist PTUs are sized for normal load and spill the rest to Standard. Second, model choice and reasoning effort are latency controls too. On GPT-5.1 and GPT-5.2, `reasoning_effort` accepts `none` (the default on GPT-5.1) per the [reasoning models guide](https://learn.microsoft.com/azure/foundry/openai/how-to/reasoning), and higher effort spends hidden output tokens before the first visible token appears. A journey with a 1.5-second budget can't afford much reasoning, whatever tier it runs on. Buying priority capacity for a request that thinks for six seconds buys nothing the user can see.

## Encoding the budget so it can't drift

Budgets that live in a slide deck drift. I'd put them in configuration next to the code that calls the model, so the journey name decides the deployment and parameters, and the budget is logged with every call. This fragment uses the `openai` Python library (`pip install "openai>=2.8"`) against the Azure OpenAI v1 endpoint.

```python
import os
import time
from dataclasses import dataclass, field

from openai import OpenAI

# API key keeps the sample short. In production, use Microsoft Entra ID:
# api_key=get_bearer_token_provider(DefaultAzureCredential(),
#     "https://cognitiveservices.azure.com/.default") from azure-identity.
client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
)


@dataclass(frozen=True)
class JourneyBudget:
    deployment: str
    p95_first_token_s: float
    params: dict = field(default_factory=dict)
    extra_headers: dict = field(default_factory=dict)


BUDGETS = {
    # Customer-facing: flagship model with no reasoning, priority processing on Global Standard.
    "support_chat": JourneyBudget(
        deployment="<your-gpt-5.2-global-standard>",
        p95_first_token_s=1.5,
        params={"service_tier": "priority", "reasoning_effort": "none"},
    ),
    # Steady agent-assist traffic on PTUs, spilling to Standard instead of failing.
    "agent_assist": JourneyBudget(
        deployment="<your-gpt-5.1-provisioned>",
        p95_first_token_s=4.0,
        params={"reasoning_effort": "low"},
        extra_headers={"x-ms-spillover-deployment": "<your-gpt-5.1-standard>"},
    ),
    # Internal tool: shared capacity is fine.
    "policy_qa": JourneyBudget(
        deployment="<your-gpt-5-mini-global-standard>",
        p95_first_token_s=6.0,
        params={"reasoning_effort": "low"},
    ),
}


def ask(journey: str, messages: list[dict]) -> str:
    budget = BUDGETS[journey]
    start = time.perf_counter()
    first_token_s = None
    served_tier = None
    reasoning_tokens = None
    parts = []

    stream = client.chat.completions.create(
        model=budget.deployment,
        messages=messages,
        stream=True,
        stream_options={"include_usage": True},
        extra_headers=budget.extra_headers or None,
        **budget.params,
    )
    for chunk in stream:
        # The tier the service actually used: "priority" or "default" if downgraded.
        if chunk.service_tier:
            served_tier = chunk.service_tier
        # With include_usage, the final chunk carries usage and no choices.
        if chunk.usage and chunk.usage.completion_tokens_details:
            reasoning_tokens = chunk.usage.completion_tokens_details.reasoning_tokens
        if chunk.choices and chunk.choices[0].delta.content:
            if first_token_s is None:
                first_token_s = time.perf_counter() - start
            parts.append(chunk.choices[0].delta.content)

    first_token_s = first_token_s if first_token_s is not None else time.perf_counter() - start
    over_budget = first_token_s > budget.p95_first_token_s
    # Replace print with your telemetry; alert on the p95 per journey, not single calls.
    print(
        f"journey={journey} tier={served_tier} first_token_s={first_token_s:.2f} "
        f"reasoning_tokens={reasoning_tokens} over_budget={over_budget}"
    )
    return "".join(parts)


if __name__ == "__main__":
    print(ask("policy_qa", [{"role": "user", "content": "How many days of carer's leave do I get?"}]))
```

The spillover header is worth knowing about. [Spillover](https://learn.microsoft.com/azure/foundry/openai/how-to/spillover-traffic-management) sends a provisioned deployment's overflow (most commonly 429s once PTUs are exhausted) to a Standard deployment of the same model in the same resource. That lets you size PTUs for normal load instead of peak, which is often the difference between provisioned capacity paying for itself and not. The trade-off is that spilled requests get Standard latency, so the journey's budget has to tolerate that at peak.

Batch jobs don't belong in this function at all. They go through the Batch API with a JSONL file and a Global Batch deployment, and their budget is a deadline, not a percentile.

## Where this goes wrong

- **Budgets set by engineers alone.** If product owners don't agree the budget, the first complaint about a slow answer turns into "move everything to PTUs". Get the number signed off.
- **Paying for capacity to hide a slow prompt.** If time to first token is dominated by reasoning tokens or a huge uncached prompt, premium capacity barely helps. Measure first.
- **One deployment for every journey.** Microsoft's [latency guidance](https://learn.microsoft.com/azure/foundry/openai/how-to/latency) recommends separating workloads, because long requests share capacity with short ones. Separate deployments per budget class also make the bill readable by journey.
- **Treating priority as guaranteed.** Priority requests can be served at the standard tier during ramps, peaks or long-context calls, and you only find out from the `service_tier` in the response. I'd use priority processing for journeys where an occasional Standard-latency answer is acceptable, and look at PTUs when a customer SLA can't absorb that.

## When this is overkill

If you have one journey, modest traffic and no complaints, a single Global Standard deployment with streaming is the right answer, and a budget framework adds process without saving anything. The approach pays off once you have several journeys with different audiences, a bill someone is asking questions about, or a proposal to buy provisioned capacity. At that point the question to ask of every journey is simple: who is waiting, for how long, and what are we willing to pay so they wait less? Anything that can wait a day should be in Global Batch. Anything a customer watches deserves a measured budget and the cheapest tier that meets it. Everything else lives on Standard until the numbers say otherwise.
