---
title: "Model Router Already Routes to Claude and Open Models: Govern the Pool"
description: "Foundry Model Router picks from OpenAI, Anthropic, DeepSeek, xAI and Meta models. Treat subsets, policy and model logging as governance, not tuning knobs."
author: Michael John Peña
draft: false
date: 2026-08-05
tags:
  - Microsoft Foundry
  - Governance
  - AI Agents
  - Evaluation
  - Anthropic
---

It's easy to still think of Foundry Model Router as "the thing that picks the cheaper GPT for easy prompts". That was roughly true when it launched in preview in May 2025. It isn't true now. The default pool for version `2025-11-18` spans five publishers, Anthropic included once you deploy Claude yourself, and the router decides per request which one handles your user's data.

When a router makes that choice for you, model choice stops being a cost-tuning question. It becomes a question about data residency, about which safety system screened the output, and about whether last month's eval still describes what production is running. My argument is simple: custom subsets, Azure Policy and logging of the served model are governance controls. Configure them as deliberately as you would network rules, not as optional knobs for later.

## What the pool looks like in early August 2026

The [supported models table](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-router#supported-models) for `2025-11-18` currently lists 28 models:

- **OpenAI:** the GPT-4o, GPT-4.1 and GPT-5 families through `gpt-5.5`, plus `o4-mini` and `gpt-oss-120b` (router support for `gpt-oss-120b` is in preview).
- **Anthropic:** `claude-haiku-4-5`, `claude-sonnet-4-5`, `claude-opus-4-1`, `claude-opus-4-6` and `claude-opus-4-7`. Router support for all of these is in preview.
- **DeepSeek, xAI and Meta:** DeepSeek-V3.1 and V3.2, two Grok 4 models, and Llama 4 Maverick. These are also in preview.

Three details in the docs matter more than the list itself.

First, `2025-11-18` is a rolling version. Microsoft's versioning notes say that new models and features are added to it "without changing the version identifier". The May 2026 refresh added seven models, including `claude-opus-4-7` and `gpt-5.5`, and the deployment version string didn't change. The older `2025-05-19` and `2025-08-07` versions are frozen, and the retirement schedule has them retiring on 30 August 2026, so pinning an old version won't hold the pool still for long.

Second, the Claude models work differently from the rest. The router only uses a Claude model if you have deployed it yourself in the same Foundry resource, and the router then calls your deployment. Every other model is used without a deployment of your own.

Third, agents with tools are still OpenAI-only. The agents guide says plainly: "If you use Agent service tools in your flows, only OpenAI models are used for routing." So an Agent Service agent that calls functions, MCP servers or file search stays on OpenAI models today. Requests that don't use Agent Service tools can already land on Claude, DeepSeek, Grok or Llama. I'd plan as if the agent restriction will loosen, because the docs already list Claude, DeepSeek and Grok in the same pool, and the only thing keeping tool-using agents on OpenAI is a single IMPORTANT note, not a design limit.

The pool is also moving on the regional side. In July the router added Australia East, South India and West US 3, with both Global Standard and Data Zone Standard. For Australian teams, that's the first time the router can be deployed in an Australian region, though Data Zone there means APAC, not Australia.

## Residency follows the model, not the router

The router's own data handling is easy to explain. Microsoft's documentation says it analyses prompts without storing them, and that it routes only to eligible models, honouring data zone boundaries. But "eligible" depends on what you have deployed.

When the router picks Claude, your prompt goes to your own Claude deployment, and the [Claude hosting comparison](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/claude-models-hosting-comparison) shows how much that deployment's settings matter:

| | Claude hosted on Azure | Claude hosted on Anthropic infrastructure |
|---|---|---|
| Data processor | Anthropic | Anthropic |
| Where processing happens | Azure, scoped to Global or Data Zone | May be outside Azure and outside your region |
| Deployment types | Global Standard, Data Zone Standard (US) | Global Standard only |
| Governing terms | Anthropic DPA and commercial terms | Anthropic DPA and commercial terms |

Check which of these applies to the router's own Claude models: only `claude-haiku-4-5` has an Azure-hosted version, and `claude-sonnet-4-5`, `claude-opus-4-6` and `claude-opus-4-7` run on Anthropic infrastructure only. Because Claude deployments must match the router's SKU and none of these is offered as Data Zone Standard, a Data Zone router can't include Claude at all.

For either hosting option, Anthropic is the seller and an independent data processor. The router doesn't change that. Suppose someone in your organisation deployed Claude to this resource for a prototype before the Azure-hosted option arrived in late June 2026. That deployment runs on Anthropic infrastructure, and a router deployment in the same resource that includes Claude can now send production prompts there.

The mistake I see most often is people treating the router's own deployment type as the residency answer for everything behind it. It isn't. The router's SKU sets the boundary for the models Microsoft hosts. For Claude, your Claude deployment sets it. If you've told a regulator or a customer that data stays in Australia, the router can't make that promise: its narrowest option in Australia East is Data Zone Standard, and the APAC data zone covers Australia, Japan, Korea, Singapore and India, according to the [deployment types page](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types). If APAC processing is acceptable, use an Australia East Data Zone router with an explicit subset. If it has to be Australia only, deploy a regional Standard model directly and skip the router. A default pool on a Global router matches neither promise.

## Content safety is no longer one system

When you deploy the router, you pick one content filter. The [deployment guide](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/model-router) says that filter "applies to all content passed to and from the model router", and that you shouldn't set filters on each underlying chat model.

Microsoft's [data and privacy page for Claude in Foundry](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/claude-models/data-privacy) describes another layer on top: Claude models "use Anthropic safety systems and safeguards", and even for Azure-hosted Claude, automatic safeguards can flag content for review by Anthropic's Trust & Safety team on an exceptions-only basis. That means a request routed to Claude goes through a different safety stack and a different review regime than one routed to `gpt-5.4-mini`. Your risk assessment probably described one of those.

What I'd do:

- Write down, for each router deployment, which publishers it can reach and which safety and review terms apply to each one.
- Test your red-team and jailbreak prompt sets against every model in the subset, not only against the router endpoint. If the router never happens to pick Claude during your test run, you haven't tested Claude.
- If a workload's risk assessment was approved for one publisher, give it a router whose subset contains only that publisher. Don't share a general-purpose router with it.

## Your eval is a snapshot of a pool that keeps changing

An eval of a single-model deployment tells you about that model. An eval of a router deployment tells you about one routing distribution, over one pool, on one day.

Several things can change that distribution without anyone touching your code:

- **In-place pool updates.** New models join the default pool under the same version string. A custom subset doesn't have this problem: the docs say new models aren't included "unless you explicitly add them to your deployment's inclusion list". Turning off auto-update doesn't freeze the default pool. Only a subset does.
- **Retirements.** The retirement schedule shows the router's versions of `gpt-5-chat`, `gpt-5.2-chat` and `gpt-5.3-chat` retired in May and June, DeepSeek-V3.1 on 13 July, and `claude-opus-4-1` today, 5 August. As I write this, the router's supported models table still lists all of them. If your subset names any of these, check what the router is actually serving. The docs don't say how a subset that contains a retired model behaves.
- **Failover.** Since March, when a model's endpoint is unstable the router sends the request to the next most suitable model. Within a custom subset, failover stays inside the subset. That's good for compliance, but it means one bad hour on one provider can shift your quality numbers.
- **Prompt caching.** The cache only helps when the same model handles requests with matching prefixes, so routing changes also change latency and cost.

The deployment guide says plainly that the Foundry Evaluations service doesn't integrate with model router directly, and points to the [Model Router Auto Evaluation toolkit](https://github.com/microsoft-foundry/Model-Router-Auto-Evaluation) for comparing the router with a baseline on quality, cost and latency. That toolkit doesn't make a result reproducible unless you record which model answered each row. My rule of thumb: an eval result for a router deployment has to report the subset, the routing mode, the date, and how many rows each served model handled. Without those four, the score tells you nothing next month. I've written about [building eval sets from real user queries](/blog/2026-04-22-how-i-evaluate-llm-changes-building-eval-sets-from-real-user-queries/), and the same discipline applies here, with one more column.

## The controls, and why each one is governance

### Pin the pool with a subset

The deployment API takes a `routing` block that sets the mode and the list of models. This example creates a Data Zone router in Australia East, which means the APAC data zone, with a fixed set of OpenAI models. The format, name and version values come from the supported models table.

```bash
# DataZoneStandard in Australia East = APAC data zone (AU, JP, KR, SG, IN), not Australia only.
curl -X PUT "https://management.azure.com/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.CognitiveServices/accounts/<foundry-account-name>/deployments/router-au-datazone?api-version=2025-10-01-preview" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(az account get-access-token --query accessToken -o tsv)" \
  -d '{
    "sku": {"name": "DataZoneStandard", "capacity": 10},
    "properties": {
      "model": {"format": "OpenAI", "name": "model-router", "version": "2025-11-18"},
      "routing": {
        "mode": "balanced",
        "models": [
          {"format": "OpenAI", "name": "gpt-5.4-mini", "version": "2026-03-17"},
          {"format": "OpenAI", "name": "gpt-5.4", "version": "2026-03-05"},
          {"format": "OpenAI", "name": "gpt-5.5", "version": "2026-04-24"}
        ]
      }
    }
  }'
```

Keep it in source control. When you add a model to the subset, treat it like a firewall rule change: it needs a reason, an eval run and a reviewer. Use at least two models, because a single-model subset turns off failover. If you want Claude in a subset, you have to deploy Claude to the same account with a matching SKU first, or the request fails with `InvalidResourceProperties`. For every router-supported Claude model except Haiku 4.5, the only hosting option is Anthropic infrastructure, so treat adding Claude as a cross-border transfer decision.

### Enforce it with Azure Policy

A subset is a developer's choice. Policy is the organisation's. The router honours the built-in **Foundry model deployments should only use approved models** policy at deploy time in the portal, REST, CLI and ARM. Existing deployments that break the policy show up on the Compliance dashboard. Since late July, dedicated model router policy definitions are in public preview and cover deployment regions, required routing rules and logging configuration. Start with Audit to see where you stand, then move to Deny. Note that the allowed-publishers list has to include `Microsoft` for the router itself and `Anthropic` if you allow Claude.

### Log the served model on every call

Every response's `model` field tells you which underlying model answered. Azure Monitor can split metrics by underlying model, but aggregate charts don't help much in an incident review or an eval reconciliation. Log the field for each request, next to your own request ID, and flag anything outside the approved set.

```python
import json
import logging
import os
import re

from openai import APIStatusError, OpenAI

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("model-router-audit")

ROUTER_DEPLOYMENT = os.environ.get("ROUTER_DEPLOYMENT", "router-au-datazone")
# Must match the routing subset on the deployment. Review both together.
APPROVED_MODELS = {"gpt-5.4-mini", "gpt-5.4", "gpt-5.5"}
DATE_SUFFIX = re.compile(r"-\d{4}-\d{2}-\d{2}$")

client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    timeout=60.0,
)


def ask(prompt: str, request_id: str) -> str:
    try:
        response = client.chat.completions.create(
            model=ROUTER_DEPLOYMENT,
            messages=[{"role": "user", "content": prompt}],
        )
    except APIStatusError as err:
        # Content-filter and policy rejections land here; log them too.
        log.error(json.dumps({
            "request_id": request_id,
            "router_deployment": ROUTER_DEPLOYMENT,
            "status_code": err.status_code,
            "error": str(err),
        }))
        raise
    served_by = response.model  # for example "gpt-5.4-mini-2026-03-17"
    base_model = DATE_SUFFIX.sub("", served_by)
    approved = base_model in APPROVED_MODELS

    record = {
        "request_id": request_id,
        "router_deployment": ROUTER_DEPLOYMENT,
        "served_by": served_by,
        "approved": approved,
        "prompt_tokens": response.usage.prompt_tokens,
        "completion_tokens": response.usage.completion_tokens,
    }
    if approved:
        log.info(json.dumps(record))
    else:
        log.warning(json.dumps(record))
    return response.choices[0].message.content


if __name__ == "__main__":
    print(ask("Summarise our leave policy in two sentences.", request_id="<your-request-id>"))
```

Send those records to the same place as your other audit logs. They answer "which model handled this customer on Tuesday?" and let you break eval results down by served model.

## When to skip the router

The router is the wrong tool when a workflow needs the same model on every request. That includes regulated decisions you must be able to reproduce, prompts tuned closely to one model's behaviour, and steps where you've already chosen a tier on purpose. In those cases, deploy the model directly. That's what the [GPT-5.6 Sol, Terra and Luna post](/blog/2026-08-01-gpt-5-6-sol-terra-luna-tiering/) argues for. GPT-5.6 isn't in the router's documented pool yet anyway.

If you do use it, change what you're asking. Don't ask "which routing mode saves the most money?". Ask "which publishers am I willing to let this workload reach, under which terms, in which geography, and how will I prove it afterwards?" Encode the answer in a subset, enforce it with policy, and log the served model on every call. Do that before the agent restriction loosens, and new models joining the pool become a decision you make, not a surprise.
