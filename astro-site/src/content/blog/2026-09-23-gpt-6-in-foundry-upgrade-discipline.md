---
title: "GPT-6 Landed in Foundry: Upgrade Discipline Beats Upgrade Speed"
description: "GPT-6 arrived in Foundry ten weeks after GPT-5.6. Pin versions, gate on real queries, shadow traffic and plan retirements before you switch tiers on day one."
author: Michael John Peña
draft: false
date: 2026-09-23
tags:
  - Microsoft Foundry
  - Azure OpenAI
  - Evaluation
  - LLM
  - Governance
---

GPT-5.6 went GA in Microsoft Foundry on 9 July 2026. GPT-6 Astra arrived on 3 September, and GPT-6 Sol and Luna joined the GA lineup yesterday, 22 September. That is two model families and six named tiers in about ten weeks. Few teams can run a proper validation cycle in ten weeks, so the release cadence is now faster than the validation cadence. The question is no longer "should we move to GPT-6?" It is "what does the platform have to look like so that moving is cheap, safe and boring?"

## What actually landed

Microsoft's [model documentation lists three GPT-6 models](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure#gpt-6), but they did not arrive the same way:

- **GPT-6 Astra** is the top tier. It arrived in Foundry on 3 September. It needs no access request, but subscriptions below quota Tier 5 have to request quota before they can deploy it. Launch pricing for Global Standard is $10 per million input tokens and $50 per million output tokens for short-context requests, and long-context requests are billed at a higher rate. The context window is about 1.05 million tokens.
- **GPT-6 Sol** is the balanced middle tier, and **GPT-6 Luna** is the fast, low-cost tier for extraction, routing and classification. Both became generally available on 22 September with Standard deployments across the Global regions. Sol is $2 per million input tokens and $10 per million output tokens for short-context requests on Global Standard; check the [Azure OpenAI pricing page](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/) for Luna and for your region.

Deployment types, Data Zone coverage and quota differ per model and per region, and they are still moving. Check the [models sold directly by Azure](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure) page for your region before you plan anything around a specific SKU.

Sitting alongside all of that is the GPT-5.6 family (Sol, Terra and Luna), which I wrote about in [picking the tier per job](/blog/2026-08-01-gpt-5-6-sol-terra-luna-tiering/) only seven weeks ago. The names overlap ("Sol" and "Luna" exist in both generations), which makes it easier than ever for someone to change a model name in a config file and assume they have changed nothing else.

## Why day one is the wrong day

The usual argument for upgrading immediately is that newer models are better and per-token prices often fall. Both can be true, and it can still be a poor decision on the first day. Here is why.

**Benchmarks are not your workload.** A launch post reports aggregate scores. Your application is a specific mix of prompts, tools, retrieval context and output schemas that were tuned, often by accident, against the model you have today. A new generation changes instruction-following, verbosity, tool-calling habits and refusal behaviour all at once. Any of those can break a downstream parser or a grounding check without the model being "worse".

**Per-token price is not per-task cost.** Reasoning models spend different numbers of tokens on the same prompt. A model with a lower rate that thinks twice as long is not cheaper. A top tier with higher long-context rates can quietly multiply the cost of an agent that keeps its whole history in the prompt. For GPT-6, a prompt over 272K input tokens is billed entirely at the long-context rate ($20/$75 per million for Astra), so an agent whose history crosses that line roughly doubles its input cost in one step. You only find out by measuring tokens per task on your own traffic.

**Capacity and access lag the announcement.** Astra needs a quota request on lower quota tiers. New models often start with conservative quota, and some deployment types or Data Zones show up later than Global Standard. If you move production on day one, you are betting your uptime on the newest and least-provisioned capacity in the fleet.

**The first version is rarely the last.** Fast-moving families get point releases and new default versions. If you chase the newest model, you sign up to validate every one of them, which is the exact work the cadence has made impossible.

None of this means "wait six months". It means the upgrade decision has to come from your own evidence rather than from the calendar.

## Pin every production deployment

The foundation is boring: production never follows a moving target. Foundry model deployments have a `versionUpgradeOption` setting, and the [working with models](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/working-with-models) guide describes three values:

| Option | Behaviour | Where I use it |
|---|---|---|
| `OnceNewDefaultVersionAvailable` | Moves to a new default version within two weeks of it being designated | Dev and sandbox only |
| `OnceCurrentVersionExpired` | Stays pinned until the version retires, then moves to the current default | Low-risk internal tools |
| `NoAutoUpgrade` | Stays pinned; the deployment stops working at retirement | Production workloads with an owner |

`NoAutoUpgrade` sounds dangerous because the deployment stops at retirement. I prefer it for anything customer-facing, precisely because it forces a decision. A silent upgrade to a new default is a model change that bypassed every gate you built. A hard stop on a date you knew about months in advance is a planning failure you can see coming.

Pinning belongs in infrastructure as code so that it is reviewed, not clicked. This Bicep fragment pins a deployment to an explicit version. The model name and version are placeholders; copy the exact strings from the Foundry catalog for your region.

```bicep
param accountName string = '<your-resource-name>'

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: accountName
}

resource prodDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: account
  name: 'answer-prod-gs'
  sku: {
    name: 'GlobalStandard'
    capacity: 100
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: '<model-name-from-catalog>'
      version: '<model-version-from-catalog>'
    }
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}
```

Name deployments after their job, not their model (`answer-prod-gs`, not `gpt6-sol`). Application code points at the job, and the model behind it changes through a reviewed pull request.

## Gate on real user queries, not launch benchmarks

A candidate model earns a production slot by passing the same eval gate the current model passes, on queries your users actually send. I've written before about [building eval sets from real user queries](/blog/2026-04-22-how-i-evaluate-llm-changes-building-eval-sets-from-real-user-queries/). The short version: sample real traffic, strip or mask personal data, label the expected outcome or a rubric, and keep a slice of known-hard cases that have burned you before.

For an upgrade, the gate should compare three things against the pinned baseline:

1. **Quality** on your rubric, with a regression margin agreed before anyone sees the numbers.
2. **Tokens per task**, input and output separately, not price per token.
3. **Behavioural deltas** that break integrations: schema validity, tool-call correctness, refusal rate and response length.

The third one catches the most surprises. A model that is "better" but wraps JSON in prose, or calls a tool one step earlier than your orchestrator expects, is a regression for your system even when the judge model rates the text higher.

## Shadow traffic before any cut-over

Offline evals tell you whether the candidate can do the job. Shadow traffic tells you what it does with the long tail you didn't think to label. Send a sample of live requests to the candidate deployment as well as production, return only the production answer to the user, and log both for comparison.

This fragment uses the `openai` Python package against the Azure OpenAI v1 endpoint. It mirrors a configurable share of requests on a small, bounded thread pool so the shadow call never adds latency to the user path. Both logged outputs can contain personal data, so redact them or send them to a store with the same retention and access controls as your production transcripts.

```python
import json
import logging
import os
import random
from concurrent.futures import ThreadPoolExecutor

from openai import OpenAI

client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
)

PROD_DEPLOYMENT = os.environ.get("PROD_DEPLOYMENT", "answer-prod-gs")
SHADOW_DEPLOYMENT = os.environ.get("SHADOW_DEPLOYMENT", "answer-candidate-gs")
SHADOW_RATE = float(os.environ.get("SHADOW_RATE", "0.05"))

# Bounded pool: shadow calls queue up instead of spawning unlimited threads.
shadow_pool = ThreadPoolExecutor(max_workers=4)

log = logging.getLogger("shadow")
logging.basicConfig(level=logging.INFO)


def _call(deployment: str, instructions: str, user_input: str):
    return client.responses.create(model=deployment, instructions=instructions, input=user_input)


def _shadow(request_id: str, instructions: str, user_input: str, prod_text: str) -> None:
    try:
        r = _call(SHADOW_DEPLOYMENT, instructions, user_input)
        # prod_output and shadow_output may contain personal data: redact, or log
        # to a store with the same retention and access controls as production.
        log.info(json.dumps({
            "request_id": request_id,
            "prod_output": prod_text,
            "shadow_output": r.output_text,
            "shadow_input_tokens": r.usage.input_tokens,
            "shadow_output_tokens": r.usage.output_tokens,
        }))
    except Exception as exc:  # a shadow failure must never affect the user
        log.warning(json.dumps({"request_id": request_id, "shadow_error": str(exc)}))


def answer(request_id: str, instructions: str, user_input: str) -> str:
    prod = _call(PROD_DEPLOYMENT, instructions, user_input)
    if random.random() < SHADOW_RATE:
        shadow_pool.submit(_shadow, request_id, instructions, user_input, prod.output_text)
    return prod.output_text


if __name__ == "__main__":
    print(answer("demo-001", "Answer in one sentence.", "What is our refund window?"))
    shadow_pool.shutdown(wait=True)  # let any shadow call finish before exit
```

Two cautions. Shadowing costs real tokens, so keep the rate small and time-boxed. And do not shadow agents whose tools have side effects (sending email, writing records) unless the shadow path runs against stubbed tools. A shadow agent that actually acts is not a shadow.

Once the shadow logs look clean, cut over gradually: a small percentage of users, then a larger share, with the pinned previous deployment still running so rollback is a config change.

## Keep a retirement calendar on purpose

The other half of discipline is not drifting so far behind that retirement forces a rushed migration. Microsoft's [model retirement policy](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirements) commits to at least 60 days' notice before a GA model retires, and the automatic upgrades that follow a retirement roll out region by region. Sixty days is enough to run a planned upgrade. It is not enough to discover that nobody owns the deployment.

I keep a simple register per production deployment: owner, pinned model and version, published retirement date, the candidate being evaluated, and the date the gate last ran. Review it monthly. The goal is a steady rhythm where each workload moves about once or twice a year, on a date the team picked, after evidence. That rhythm should not be set by launch posts, and it should not be set by retirement emails either.

## When moving fast is fine

There are sensible exceptions. Prototypes and internal experiments should use the newest model, because learning what it can do is the point. A workload with no eval set gets no protection from waiting, though the honest fix is to build the eval set. And if a new tier unlocks something your current model simply cannot do, such as a context length your use case needs, then a fast, well-gated move is justified. It still goes through the gate.

## The decision I'd make this week

Deploy GPT-6 Sol and Luna into a non-production project, request Astra quota (if your subscription's quota tier needs it) only when the top tier is plausibly worth it, and point your existing eval gate at them. Leave production pinned. Start shadowing the step where you think the gain is largest, compare tokens per task as well as quality, and put a cut-over date in the calendar only when the evidence supports it.

The teams that benefit most from GPT-6 will not be the ones that switched on 22 September. They will be the ones whose platform makes the next switch, and the one after that, a routine change. For the operational side of that platform, my notes on [safer model lifecycle management in Foundry](/blog/2026-04-21-foundry-decisions-i-stand-behind-using-foundry-for-safer-model-lifecycle-management/) go into more detail.
