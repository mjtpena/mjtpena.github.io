---
title: "Canary a Model Swap in Foundry: Sticky Splits and Version Stamps"
description: "An offline evaluation can't tell you how a new model handles real traffic. How I'd canary a Foundry model change with sticky splits and per-call version logs."
author: Michael John Peña
draft: false
date: 2026-04-21
tags:
  - Microsoft Foundry
  - Azure OpenAI
  - LLMOps
  - Model Deployment
  - Python
---

An evaluation run tells you whether a new model version handles the questions you thought to ask. It doesn't tell you what happens to latency, token spend, refusals and the long tail of odd inputs once real users arrive. The usual approach treats a model swap in Microsoft Foundry as a single moment: the evaluation passes, the deployment name in config changes, and 100% of traffic moves at once. I'd rather the riskiest change in an AI app reach a small, stable slice of users first, with every call recording which model actually answered it.

This post covers the step after the [evaluation gate](/blog/2026-04-10-foundry-in-daily-engineering-work-moving-from-model-demos-to-governed-operations/) and before the [upgrade policy](/blog/2026-03-30-operating-ai-apps-with-foundry-using-foundry-for-safer-model-lifecycle-management/) decides for you: moving live traffic.

## What the evaluation gate misses

The offline gate is necessary, and I wouldn't skip it. It just has blind spots that only production traffic fills:

- **The input distribution.** Your evaluation set is a curated sample. Users send longer threads, pasted tables, other languages and requests nobody predicted. A new model can score better on the set and worse on the tail.
- **Cost shape.** Moving from a non-reasoning model to a reasoning model changes token economics. Reasoning tokens are billed as output tokens and show up in `usage.output_tokens_details.reasoning_tokens`, so the same prompt can cost noticeably more. You only see the real figure on real prompts.
- **Latency.** Time to first token and total response time change between model families, and downstream timeouts were tuned to the old model. The router below measures total response time only; time to first token needs `stream=True` and a timestamp on the first `response.output_text.delta` event.
- **Behaviour your evaluators don't score.** Output length, formatting, how often it refuses, and how it calls tools. A downstream parser that expected one shape of JSON is a regression no groundedness score will catch.

A canary turns those unknowns into measurements while the blast radius is small. The trade-off is time: you run two deployments for days instead of minutes.

## The design: two deployments, a sticky split, a version stamp

Three decisions make the pattern work.

**Two named deployments.** The current and candidate models each get their own deployment, named for model and version, for example `chat-gpt-41-2025-04-14` and `chat-gpt-51-2025-11-13`. I've used gpt-5.1 as the candidate because it's GA with a published retirement date of 15 May 2027; gpt-5.2 and gpt-5.4 are also listed by now, and the pattern is identical for any later version. The app never hard-codes either name. The candidate needs its own quota for the overlap, which on Standard deployment types is usually manageable. On provisioned deployments it's a capacity decision, and that's where I'd talk to whoever owns the PTU budget before anyone writes code.

**A sticky split.** Assign users or conversations, not requests. If request one of a conversation goes to the current model and request two goes to the candidate, you've built a jarring experience and an uninterpretable experiment. A hash of a stable key (user ID, tenant ID or conversation ID) into a bucket gives the same answer every time with no state to store, and raising the percentage only moves new buckets onto the candidate. Anyone already on it stays there.

**A version stamp on every call.** Log the arm, the deployment name and the `model` value the service returns on the response. That last field matters more than people expect. A deployment left on `OnceCurrentVersionExpired` can change model at retirement without anyone touching config, and the `model` reported on the response is where that shows up in your own telemetry. Without it, you can't tell a canary regression from an auto-upgrade.

## A router you can drop into a Python service

This uses the [v1 OpenAI-compatible endpoint](https://learn.microsoft.com/azure/foundry/openai/api-version-lifecycle), which no longer needs an `api-version` parameter, with the standard `OpenAI` client and Microsoft Entra ID instead of keys. `openai` 2.32.0 (15 April 2026) accepts a token provider callable as `api_key` and refreshes the token for you. The call itself uses the [Responses API](https://learn.microsoft.com/azure/foundry/openai/how-to/responses).

```bash
pip install "openai==2.32.0" azure-identity
```

```python
"""Sticky canary routing between two Foundry model deployments."""
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass, field

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import APIError, OpenAI

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("model-canary")


@dataclass(frozen=True)
class Arm:
    name: str
    deployment: str
    # Per-arm request options: a different model family may not accept the same parameters.
    options: dict = field(default_factory=dict)


CURRENT = Arm("current", os.environ.get("CURRENT_DEPLOYMENT", "chat-gpt-41-2025-04-14"), {"temperature": 0.2, "store": False})
CANDIDATE = Arm("candidate", os.environ.get("CANDIDATE_DEPLOYMENT", "chat-gpt-51-2025-11-13"), {"reasoning": {"effort": "low"}, "store": False})

# Percentage of buckets routed to the candidate. Supports values such as 0.5.
# Read once at import, so a change takes effect after each instance restarts.
CANARY_PERCENT = float(os.environ.get("CANARY_PERCENT", "5"))
# Change the salt only when you deliberately want to reshuffle who is in the canary.
SPLIT_SALT = os.environ.get("CANARY_SALT", "model-swap-2026-04")

token_provider = get_bearer_token_provider(DefaultAzureCredential(), "https://ai.azure.com/.default")
client = OpenAI(
    base_url=f"https://{os.environ['AZURE_OPENAI_RESOURCE']}.openai.azure.com/openai/v1/",
    api_key=token_provider,
    # No hidden retries: SDK retries on 429/5xx would inflate latency and hide throttling on one arm.
    max_retries=0,
    timeout=60.0,
)


def assign(routing_key: str) -> Arm:
    """Map a stable key to one of 10,000 buckets; the same key always gets the same arm."""
    digest = hashlib.sha256(f"{SPLIT_SALT}:{routing_key}".encode("utf-8")).digest()
    bucket = int.from_bytes(digest[:8], "big") % 10_000
    return CANDIDATE if bucket < int(CANARY_PERCENT * 100) else CURRENT


def answer(routing_key: str, prompt: str) -> str:
    arm = assign(routing_key)
    started = time.perf_counter()
    try:
        response = client.responses.create(model=arm.deployment, input=prompt, **arm.options)
    except APIError as exc:  # status, timeout and connection errors; local bugs propagate unlogged
        log.warning(json.dumps({
            "arm": arm.name,
            "deployment": arm.deployment,
            "latency_ms": round((time.perf_counter() - started) * 1000),
            "error": type(exc).__name__,
            "status_code": getattr(exc, "status_code", None),  # 400 for a filtered prompt
            "code": getattr(exc, "code", None),  # "content_filter" when the prompt is blocked
        }))
        raise

    usage = response.usage
    log.info(json.dumps({
        "arm": arm.name,
        "deployment": arm.deployment,
        "model": response.model,  # what actually answered, including the version
        "latency_ms": round((time.perf_counter() - started) * 1000),
        "input_tokens": usage.input_tokens if usage else None,
        "output_tokens": usage.output_tokens if usage else None,
        "reasoning_tokens": usage.output_tokens_details.reasoning_tokens if usage else None,
        "status": response.status,
        # "content_filter" or "max_output_tokens" when the output was cut short
        "incomplete_reason": response.incomplete_details.reason if response.incomplete_details else None,
    }))
    return response.output_text


if __name__ == "__main__":
    print(answer("<conversation-id>", "Summarise our leave policy in three bullet points."))
```

The caller needs the Cognitive Services OpenAI User role (or broader) on the Foundry resource. In a real service, send the JSON log line to Application Insights or whatever sink you already query, and use the conversation or tenant ID as the routing key. Don't log the prompt or the answer by default; the stamp is metadata, and it should stay that way unless your data handling rules say otherwise. If you want quality scores per arm, that needs its own capture path for a small, de-identified sample, separate from this log. The same applies on the service side: the Responses API stores responses for 30 days by default, so both arms set `store=False` unless you need `previous_response_id` chaining or background mode.

I've set `max_retries=0` on purpose. The `openai` client retries 429 and 5xx responses twice by default, which folds back-off time into `latency_ms` and turns throttling on the candidate's quota into slow successes instead of logged errors. If your service needs retries, add them around `answer()` and log the attempt count, so each attempt is measured separately.

The per-arm `options` dictionary is deliberate. Reasoning models handle sampling parameters differently from earlier chat models, so sharing one set of request options between arms is how a canary fails on its first request. Keep each arm's options next to its deployment name and review them together. gpt-5.1 defaults to reasoning effort `none`, so an unset candidate behaves like a non-reasoning model; pick the effort explicitly and treat changing it as its own canary.

## Where the split should live

The code above puts the split in the application. That isn't the only place, and the right answer depends on how many apps share the model.

| Where | Strength | Weakness | I'd use it when |
|---|---|---|---|
| Application code | Sticky by business key, version stamp next to app context | Every app implements it separately | One or two apps own the model |
| Azure API Management | Central control, [weighted backend pools](https://learn.microsoft.com/azure/api-management/backends) with optional session affinity | Affinity relies on a cookie the caller returns; balancing is approximate across gateway instances | Many apps share one gateway and a platform team owns it |
| Foundry Agent Application | Built-in promotion and rollback by version | One active deployment taking 100% of traffic; no split | Agents where fast rollback is acceptable instead of a canary |

API Management's weighted pools are a good fit for spreading load, and the docs list blue-green deployments as a use case. For a model canary, the cookie-based affinity is the weak point: server-side callers using an SDK usually don't return cookies, so you lose stickiness unless you build it yourself in policy. If a platform team runs the gateway, I'd still put the routing key decision in the app and pass it through as a header.

For published agents, the [Agent Application constraint](https://learn.microsoft.com/azure/foundry/agents/how-to/publish-agent) means the split has to happen in front of Foundry, with two applications. For most internal agents I'd accept the all-at-once switch and rely on rollback, as I argued in the agent versions post.

## Ramping, watching and rolling back

My rule of thumb is three steps: a small slice for long enough to see a full business cycle (often a week, because Monday traffic doesn't look like Friday's), a larger slice once nothing surprising has appeared, then everyone. The exact percentages matter less than writing down, before the canary starts, what would make you stop.

What I'd compare per arm, from the version-stamped logs:

- Error rate by status code and error code. A blocked prompt doesn't come back as a status; it raises an HTTP 400 with the code `content_filter`, which is why the router logs both. Count `incomplete_reason` too, so output-side filtering and `max_output_tokens` truncation show up per arm.
- p50 and p95 latency.
- Input, output and reasoning tokens per conversation, multiplied by each model's price.
- Output length, and failures in any downstream parser.
- Explicit user feedback, if the app collects it.
- Quality scores from sampled traffic. Continuous evaluation in the Foundry portal was still preview at the March GA, as I covered in [the post on what went GA](/blog/2026-03-19-microsoft-foundry-build-notes-moving-from-model-demos-to-governed-operations/), so if preview isn't acceptable I'd run a scheduled offline evaluation over a separately captured, de-identified sample of prompts and answers (with whatever approval your data handling rules require).

Rollback is setting `CANARY_PERCENT` to 0 and restarting each instance, or reading the value from App Configuration or a feature flag so it applies without a redeploy. Because the current deployment never stopped serving, that's a configuration change, not an incident. Once the candidate has held at 100% for an agreed window, rename the arms, delete the old deployment, and change the salt before the next model swap so a fresh set of users takes the first exposure.

## When a canary is the wrong tool

Don't build this for low-volume apps. If a few dozen people use a tool a day, a 5% canary sees almost nothing and you'll wait weeks for a signal you could get from a better evaluation set in an afternoon. Use the offline gate and switch.

Batch workloads are different too. For overnight document processing, run both models on the same inputs and compare outputs directly. Shadow comparison beats sampling users when nobody is waiting on the answer, though it doubles the token bill for the overlap.

And a canary doesn't replace the retirement work. A version that retires mid-canary still follows its [upgrade policy and retirement date](https://learn.microsoft.com/azure/foundry/openai/concepts/model-retirements), so start the swap early enough that the ramp finishes before the platform makes the decision for you.

The example's current arm is a real deadline. On the retirement table at the time of writing, gpt-4.1 2025-04-14 was deprecated for new customers on 14 April 2026, retires on 14 October 2026, and lists `gpt-5` as its replacement. An untouched `OnceCurrentVersionExpired` deployment is likely to land on gpt-5, not the gpt-5.1 you canaried, and the response `model` stamp is how you'd notice. Start the canary now rather than in September.

## The decision I'd make

For any app where another system or a customer consumes the output, a model change should go through three gates: an offline evaluation against the current model, a sticky canary with version-stamped logs, and a written stop condition. The version stamp alone is worth adding this week, even with no canary planned. It's the cheapest way to know which model answered a given request, and that's the first question in every model-related incident.
