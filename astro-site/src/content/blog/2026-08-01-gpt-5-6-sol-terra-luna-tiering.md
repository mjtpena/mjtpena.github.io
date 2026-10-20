---
title: "GPT-5.6 Sol, Terra or Luna: Pick the Tier per Job, Not per App"
description: "GPT-5.6 in Foundry has a 5x price spread across Sol, Terra and Luna. Choose a tier for each workflow step, back it with eval gates, then pick deployment types."
author: Michael John Peña
draft: false
date: 2026-08-01
tags:
  - Microsoft Foundry
  - Azure OpenAI
  - Cost Optimization
  - Evaluation
  - LLM
---

GPT-5.6 went generally available in Microsoft Foundry on 9 July 2026 as three models rather than one: Sol, Terra and Luna. The input and output rates for Sol are five times those for Luna, so the tier you choose matters more than most prompt tweaks. Most teams will still pick one of the three, point the whole application at it, and move on. I think it is one of the most expensive habits in LLM engineering, and this release makes it easy to see why.

## What actually shipped

Here is the [Foundry launch announcement](https://azure.microsoft.com/en-us/blog/gpt-5-6-now-available-in-microsoft-foundry/) reduced to the parts that affect architecture:

- **Three GA models** (Sol, Terra, Luna), each tuned for a different kind of workload, available in Foundry Models and Foundry Agent Service. Model version `2026-07-09`.
- **Deployment types from day one:** Global Standard for all three tiers across the existing 28 global regions, Global Priority Processing for Sol and Terra across the same 28 regions, Data Zone Standard, and Global Provisioned (Sol and Terra only at launch; Luna is pay-per-token).
- **GPT-5.6 Sol is available in the Asia-Pacific Data Zone** (Australia, Japan, Korea, Singapore, India), which Microsoft added in late June. At launch only Sol is offered in the APAC Data Zone. Terra and Luna Data Zone deployments are US and EU only, and there is no Data Zone Provisioned option in APAC yet.

The per-tier limits are easy to miss because they are spread across several matrices on the [region availability page](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability). Here they are in one place, as they stood at launch:

| Tier | Global Standard | Data Zone Standard (US/EU) | Data Zone Standard (APAC) | Global Provisioned | Global Priority Processing |
|---|---|---|---|---|---|
| Sol | Yes | Yes | Yes | Yes | Yes |
| Terra | Yes | Yes | No | Yes | Yes |
| Luna | Yes | Yes | No | No | No |

Check your own region before designing around a combination; these matrices change monthly.

The Global Standard list prices at launch, per million tokens (USD), from the [Azure OpenAI pricing page](https://azure.microsoft.com/pricing/details/azure-openai/):

| Tier | Input | Output | Where it fits |
|---|---|---|---|
| Sol | $5.00 | $30.00 | Deep reasoning, long-horizon agentic work |
| Terra | $2.50 | $15.00 | General production workload |
| Luna | $1.00 | $6.00 | High-volume, latency-sensitive, routine tasks |

Pricing for new models tends to move in the first few months, so check the pricing page rather than trusting a table in a blog post, and see the same page for Data Zone and Priority rates. If you want to know what Azure is actually charging you, look at Cost Management for your own deployments. The argument below doesn't depend on the exact figures, only on the spread from top to bottom tier staying large.

## Why one model per app is the wrong unit

Think of an application as a pipeline of steps, and those steps rarely need the same amount of intelligence. A typical document or support workflow might:

1. Classify the incoming item (intent, language, urgency).
2. Extract structured fields into a schema.
3. Retrieve context and draft a response or summary.
4. Make a judgement call on the hard cases (policy interpretation, multi-document reasoning, planning which tools to call).
5. Check the output before it leaves the system.

Steps 1, 2 and 5 are high-volume and narrow, and they are easy to score: either the label is right or it isn't. Step 3 is the bulk of the "real" generation. Step 4 is where a frontier model earns its price, and on most workloads it handles a small share of the traffic.

If everything runs on Sol, you pay frontier output rates to decide whether an email is in English. If everything runs on Luna, step 4 quietly degrades and nobody notices until a user escalates. Choosing one model for the whole app is really choosing which of those two failures you prefer. Nobody chooses it on purpose. Once the first prototype works on one deployment, that deployment name gets hard-coded everywhere.

My default allocation for a new workflow:

- **Luna** for classification, routing, extraction, PII detection, and output checks against a rubric.
- **Terra** as the default for everything else, including most drafting and summarisation.
- **Sol** only for steps where an eval shows a measurable quality gain that is worth the cost. Saying "it felt smarter in the playground" doesn't count.

That last rule is the important one. Sol is the exception, and it has to be justified by an eval.

## Make the tier a per-step setting

The mechanics are simple. Create one deployment per tier, and give each workflow step a setting that maps it to a deployment name. Code should never mention a tier directly. That way, moving extraction from Terra to Luna is a configuration change you can roll back, not a code change.

This script uses the `openai` Python package against the Azure OpenAI v1 endpoint. Deployment names are placeholders for whatever you named them in Foundry.

```python
import os
from openai import OpenAI

# One deployment per tier, created in Foundry. Steps map to deployments, not models.
# Each step is a (deployment, reasoning effort) pair, both overridable per environment.
STEPS = {
    "classify": (os.environ.get("DEPLOY_CLASSIFY", "gpt56-luna-gs"), os.environ.get("EFFORT_CLASSIFY", "low")),
    "extract": (os.environ.get("DEPLOY_EXTRACT", "gpt56-luna-gs"), os.environ.get("EFFORT_EXTRACT", "low")),
    "draft": (os.environ.get("DEPLOY_DRAFT", "gpt56-terra-gs"), os.environ.get("EFFORT_DRAFT", "medium")),
    "adjudicate": (os.environ.get("DEPLOY_ADJUDICATE", "gpt56-terra-gs"), os.environ.get("EFFORT_ADJUDICATE", "high")),
    "verify": (os.environ.get("DEPLOY_VERIFY", "gpt56-luna-gs"), os.environ.get("EFFORT_VERIFY", "low")),
}

client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
)


def run_step(step: str, instructions: str, user_input: str) -> str:
    deployment, effort = STEPS[step]
    response = client.responses.create(
        model=deployment,
        reasoning={"effort": effort},
        instructions=instructions,
        input=user_input,
    )
    return response.output_text


if __name__ == "__main__":
    label = run_step(
        "classify",
        "Classify the message as one of: billing, technical, account, other. Reply with the label only.",
        "I was charged twice for my July invoice.",
    )
    print(label)
```

Both scripts in this post use an API key to keep them short. In production I'd use Microsoft Entra ID instead, which the same client supports by passing a token provider in place of the key:

```python
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import OpenAI

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)
client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=token_provider,
)
```

Look at `adjudicate`. It starts on Terra, even though that is the step most people would put on Sol without thinking. It only moves up when the gate below says so.

## The eval gate that decides the tier

A tier decision is a claim that a cheaper model is good enough for this step, so test it like one. For every step, keep a labelled set drawn from real traffic. I wrote about [building eval sets from real user queries](/blog/2026-04-22-how-i-evaluate-llm-changes-building-eval-sets-from-real-user-queries/) separately, and the same approach applies here. Run the candidate tiers over that set and compare quality and cost.

All three tiers are reasoning models, so the tier is only half the setting. Treat the pair (tier, reasoning effort) as the unit under test: Sol at low effort against Terra at high effort is often a more useful comparison than Sol against Terra, and effort moves the output-token count more than most people expect. A gate that only varies the tier can pick the wrong winner.

For narrow steps like classification and extraction, exact-match scoring is enough. This script compares two deployments on a JSONL file of `{"input": ..., "expected": ...}` rows. It then exits non-zero if the cheaper tier falls more than an allowed margin below the more expensive one, so it can sit in a pipeline.

```python
import json
import os
import sys
from openai import OpenAI

client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
)

INSTRUCTIONS = "Classify the message as one of: billing, technical, account, other. Reply with the label only."
CHEAP, EXPENSIVE = "gpt56-luna-gs", "gpt56-terra-gs"
EFFORT = os.environ.get("EFFORT_CLASSIFY", "low")
MAX_ACCURACY_DROP = 0.01  # cheaper tier may be at most 1 percentage point of accuracy worse


def evaluate(deployment: str, rows: list[dict]) -> tuple[float, int, int]:
    correct, tokens_in, tokens_out = 0, 0, 0
    for row in rows:
        r = client.responses.create(
            model=deployment,
            reasoning={"effort": EFFORT},
            instructions=INSTRUCTIONS,
            input=row["input"],
        )
        correct += r.output_text.strip().lower() == row["expected"].lower()
        tokens_in += r.usage.input_tokens
        tokens_out += r.usage.output_tokens
    return correct / len(rows), tokens_in, tokens_out


def main(path: str) -> int:
    with open(path, encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]
    results = {d: evaluate(d, rows) for d in (CHEAP, EXPENSIVE)}
    for d, (acc, tin, tout) in results.items():
        print(f"{d}: accuracy={acc:.3f} input_tokens={tin} output_tokens={tout}")
    drop = results[EXPENSIVE][0] - results[CHEAP][0]
    if drop > MAX_ACCURACY_DROP:
        print(f"FAIL: {CHEAP} is {drop:.3f} below {EXPENSIVE}; keep the more expensive tier")
        return 1
    print(f"PASS: {CHEAP} is within {MAX_ACCURACY_DROP} of {EXPENSIVE}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
```

Report token counts, not dollars. Per-token prices are moving right now, and tokens let you work out the cost against whatever your invoice says this month. Remember that reasoning models can also differ in how many tokens they spend on the same prompt, so a cheaper rate doesn't automatically mean a cheaper call. Measure it.

For open-ended steps such as drafting and adjudication, exact match won't work. You need a rubric scored by a judge model or a human panel, and a margin you agreed on before you saw the numbers. The rule doesn't change: **a step moves up a tier only when the gate shows a gain on that step**. Run the same gate in the other direction every time prices move, because a price change can make a cheaper tier worth retesting on a step you ruled out at launch.

Places where I would not bother tiering:

- **Low-volume internal tools.** If the whole app costs less per month than an hour of your time, use Terra and spend the hour elsewhere.
- **Steps without a labelled set.** Tiering blind is worse than not tiering. Build the eval first.
- **Tightly coupled multi-turn agents** where one model holds the plan across many tool calls. Swapping models mid-conversation can cost more in confused state than it saves in tokens.

## Deployment types are a second, separate decision

The tier answers "which model". The [deployment type](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types) answers "where it runs and how you pay". Keep the two decisions apart, because they are driven by different constraints, but check them against each other, because not every tier is offered on every deployment type yet.

| Deployment type | Choose it when | Watch out for |
|---|---|---|
| Global Standard | Default for most steps; widest availability; pay per token | Processing can happen in any Azure geography |
| Data Zone Standard | Residency matters (EU, US, APAC) | Only Sol in APAC at launch; Terra and Luna are US/EU only |
| Global Provisioned | Steady, predictable volume where reserved throughput beats per-token | Sol and Terra only at launch; paying for idle capacity; sizing effort |
| Global Priority Processing | Latency-critical steps where you will pay for faster service | Sol and Terra only at launch; premium pricing; use it narrowly |

Note what that does to Luna. It is the tier you'd reach for on high-volume, latency-sensitive steps, yet at launch it has neither Priority Processing nor provisioned throughput. If a latency-critical step needs Priority, it runs on Terra or Sol.

The same constraint applies to reserved capacity. At launch only Sol and Terra can be provisioned. If a high-volume step justifies reserved throughput, the choice is Terra on PTU versus Luna on Global Standard, and that is a cost comparison worth running per step. The Sol step is usually spiky and low-volume, which fits pay-per-token anyway. If you do provision, use the [PTU sizing guidance](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/provisioned-throughput-sizing) with the traffic of a single step, not the whole app, or you will size for a mix that no single deployment serves.

### The APAC residency trade-off

This is the part Australian teams need to plan for. If a workload has to keep processing inside APAC, the only GPT-5.6 tier available there at launch is Sol, the most expensive one. Tiering inside the APAC Data Zone isn't possible yet: every residency-bound step runs on Sol.

You have two honest options:

- **Run every residency-bound step on Sol in the APAC Data Zone.** Simple to explain to a risk team, and expensive. Keep reasoning effort low on the narrow steps to limit the damage.
- **Split by data sensitivity.** Keep the steps that see personal or regulated data on Sol in the APAC Data Zone, and move the steps that don't (classifying an already-redacted ticket, checking a draft's format against a rubric) to Terra or Luna on Global Standard. This saves the most, but it only works if you can show which steps see which data, and your residency obligations have to allow it. That is a decision for whoever owns those obligations, not for the engineer tuning costs.

Creating the per-tier deployments is scriptable. Confirm the exact model name and version in the Foundry catalog for your region first:

```bash
az cognitiveservices account deployment create \
  --resource-group <your-resource-group> \
  --name <your-resource-name> \
  --deployment-name gpt56-luna-gs \
  --model-format OpenAI \
  --model-name gpt-5.6-luna \
  --model-version 2026-07-09 \
  --sku-name GlobalStandard \
  --sku-capacity 100

# In the APAC Data Zone only Sol is offered at launch; Terra and Luna Data Zone are US and EU only
az cognitiveservices account deployment create \
  --resource-group <your-resource-group> \
  --name <your-resource-name> \
  --deployment-name gpt56-sol-dz \
  --model-format OpenAI \
  --model-name gpt-5.6-sol \
  --model-version 2026-07-09 \
  --sku-name DataZoneStandard \
  --sku-capacity 100
```

Put deployment type in the deployment name (`-gs`, `-dz`, `-ptu`). When someone reads the step config six months from now, they should see both decisions without opening the portal.

## Where I'd draw the line

Start every new workflow with Terra as the default. Move classification, extraction and verification to Luna as soon as you have a labelled set that says it holds up. Promote a step to Sol only when its eval gate shows a gain you can name, and rerun the gates whenever prices change, which right now means often. Decide on deployment type step by step as well, driven by residency and traffic shape, and check the availability table before you do: at launch, Luna has no Priority or provisioned option, and an APAC residency requirement means Sol or a split by data sensitivity.

If you want more on the cost side, my notes on [cost per query](/blog/2026-01-18-cost-per-query-optimization/) and [where caching actually pays off](/blog/2026-04-15-llm-cost-and-latency-notes-using-caching-where-it-actually-pays-off/) stack well with this. Routing by step is the cheapest optimisation of the lot, because nothing in the model changes. You just stop paying for capability the step doesn't use.
