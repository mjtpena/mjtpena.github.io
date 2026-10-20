---
title: "Model Retirements in Foundry: Choose the Upgrade Policy on Purpose"
description: "Every Foundry model deployment has a version upgrade policy, and the default swaps your model at retirement. How to choose, audit and run model changes safely."
author: Michael John Peña
draft: false
date: 2026-03-30
tags:
  - Microsoft Foundry
  - Azure OpenAI
  - LLMOps
  - Model Deployment
  - Python
---

Tomorrow, 31 March 2026, Standard deployments of `gpt-4o` versions 2024-05-13 and 2024-08-06, and of `gpt-4o-mini` 2024-07-18, reach retirement in Microsoft Foundry, with auto-upgrades scheduled from 9 March. Whether your app changed model this month, or is about to start returning errors, depends on one deployment property most teams never set on purpose: the version upgrade policy. That property is the real model lifecycle control in Foundry, and leaving it on the default is a decision too.

## What Foundry does to a model version over time

The [model retirement page](https://learn.microsoft.com/azure/foundry/openai/concepts/model-retirements) sets out the contract for Azure OpenAI models in Foundry, and it's worth reading slowly:

- A GA model version gets a "not sooner than" retirement date of 365 days from launch. Preview versions get 90 to 120 days.
- After 12 months, a GA version is **deprecated**: no new customers, but existing deployments can keep using it for an additional six months, and sometimes longer when retirement dates move.
- At **retirement**, the version is gone. Deployments still pinned to it return errors.
- You get at least 60 days' notice before a GA retirement, by email to subscription owners and through Azure Service Health. To route those notices to a team, [create a Service Health alert](https://learn.microsoft.com/azure/service-health/alerts-activity-log-service-notifications-portal) for the service **Azure OpenAI Service** with the event type **Health advisories: Upgrade, Deprecation & Retirement Notifications**.
- Retirements roll out region by region, with no published schedule per region.

The current wave shows why dates alone aren't enough to plan with. For `gpt-4o` 2024-05-13 and 2024-08-06, and `gpt-4o-mini` 2024-07-18, only the regional Standard deployment type retires on 31 March. Global Standard, Data Zone Standard and all provisioned deployments of the same versions were moved to 1 October 2026. The same model, the same version, two different end dates depending on the SKU you deployed. Meanwhile `gpt-4.1` stops taking new customers on 14 April and retires on 14 October. With more than a handful of deployments, you need an inventory, not a memory.

## The three upgrade policies, and the one you probably have

Each deployment of a Standard-family deployment type carries a `versionUpgradeOption`. The [model versions article](https://learn.microsoft.com/azure/foundry/foundry-models/concepts/model-versions) and the [working with models guide](https://learn.microsoft.com/azure/foundry/openai/how-to/working-with-models) cover the options. The guide lists the API values; the article uses portal labels:

| Policy | What happens | Who it suits |
|---|---|---|
| `OnceNewDefaultVersionAvailable` | Moves to the new default version within two weeks of it becoming the default | Dev and test, and canaries that should feel changes first |
| `OnceCurrentVersionExpired` | Stays on your version until it retires, then moves to the current default | Production with a fallback, if you also own the migration |
| `NoAutoUpgrade` | Never moves. At retirement the deployment stops working | Workloads where an unvalidated model is worse than an outage |

The detail that catches people: if the property was never set, it's `null`, and `null` behaves like `OnceCurrentVersionExpired`. It doesn't even show in the portal's properties until someone sets it explicitly. The pattern I see most often is a deployment created for a demo and promoted to production by renaming a config value, which leaves it set to swap its model on retirement day with no evaluation, no change ticket and no owner.

Provisioned deployments don't use these policies at all: automatic updates only apply to Standard deployment types. You migrate them yourself, either in place (same deployment name and size, traffic moved over a 20 to 30 minute window) or by standing up a second deployment and moving traffic. The consequence is that a provisioned deployment left on a retiring version has no fallback, so it has to be [migrated before the retirement date](https://learn.microsoft.com/azure/foundry/openai/how-to/working-with-models#managing-models-on-provisioned-deployment-types), and the guide asks you to validate capacity for the target model version or family before you start. That's more work, and also more honest: nobody is surprised by a provisioned model change.

## Which policy I'd choose

My position: neither automatic option is a lifecycle strategy. They're safety nets with different failure modes. `OnceCurrentVersionExpired` trades an outage for a silent behaviour change. `NoAutoUpgrade` trades a silent behaviour change for an outage. Pick the failure you'd rather explain, then make sure neither one ever fires.

In practice that means:

- **Dev and test:** `OnceNewDefaultVersionAvailable`. You want these environments to meet a new default version within two weeks of it being designated, months before a pinned production deployment is forced to move.
- **Most production:** `OnceCurrentVersionExpired`, set explicitly rather than left as `null`, so the choice is visible in reviews. The auto-upgrade is the parachute, not the plan.
- **Regulated or contract-bound outputs:** `NoAutoUpgrade`, but only if retirement dates live in someone's calendar and a Service Health alert routes to a team that acts on it. A deployment that fails loudly is better than one that quietly starts giving answers nobody signed off, but only if the failure can't come as a surprise.

The case against relying on the swap is concrete. A newer version isn't a drop-in: output length, tool-calling behaviour, refusal patterns and formatting all change between versions. The replacement named on the retirement page is often a different model family altogether. The listed replacement for `gpt-4o` is `gpt-5.1`, a reasoning model with different parameters and token economics, and that column is a recommendation you act on yourself, not a promise of where the auto-upgrade moves you. An auto-upgrade at retirement also can't be undone, because the retired version can't be deployed again. The only rollback is a pre-provisioned alternative deployment behind configuration. Only an evaluation run tells you whether your prompts survive the move.

What the docs don't tell you: the policy docs say an auto-upgrade moves a deployment to the current default version, but for `gpt-4o-mini`, which has no other version and no default listed, the retirement page doesn't say what Standard deployments move to. On 30 March the default-versions table still listed `gpt-4o` 2024-08-06 as the current default, and the page didn't name the 9 March target either. Check what each upgraded deployment now reports rather than assuming.

## Audit what you have before you change anything

The first useful step is a list of every deployment, its version, its SKU, its policy and its retirement date. The resource itself can answer most of that. This script uses `azure-mgmt-cognitiveservices` 14.1.0 and only needs Reader on the Foundry resource:

```bash
pip install azure-identity azure-mgmt-cognitiveservices==14.1.0
```

```python
"""List Foundry model deployments with their upgrade policy and retirement date."""
from datetime import date, datetime

from azure.identity import DefaultAzureCredential
from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient

SUBSCRIPTION_ID = "<your-subscription-id>"
RESOURCE_GROUP = "<your-resource-group>"
ACCOUNT_NAME = "<your-foundry-resource-name>"
WARN_DAYS = 90


def as_text(value):
    """Enum members and plain strings both come back from the SDK."""
    return getattr(value, "value", value)


def parse_date(value):
    """SKU deprecation dates arrive as datetime; model-wide dates arrive as strings."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    return datetime.fromisoformat(value[:10]).date()


client = CognitiveServicesManagementClient(DefaultAzureCredential(), SUBSCRIPTION_ID)

# Deprecation/retirement date per (format, model, version, SKU) as the resource reports it;
# confirm against the retirement page.
retirements = {}
for model in client.accounts.list_models(RESOURCE_GROUP, ACCOUNT_NAME):
    model_wide = parse_date(model.deprecation.inference) if model.deprecation else None
    for sku in model.skus or []:
        key = (model.format, model.name, model.version, sku.name)
        retirements[key] = parse_date(sku.deprecation_date) or model_wide

today = date.today()
for deployment in client.deployments.list(RESOURCE_GROUP, ACCOUNT_NAME):
    model = deployment.properties.model
    sku_name = deployment.sku.name if deployment.sku else "unknown"
    if "Provisioned" in sku_name:
        policy = "n/a (provisioned, migrate manually)"
    else:
        policy = as_text(deployment.properties.version_upgrade_option) or "null (OnceCurrentVersionExpired)"
    retires = retirements.get((model.format, model.name, model.version, sku_name))
    days_left = (retires - today).days if retires else None
    if days_left is not None and days_left <= WARN_DAYS:
        flag = "ACT NOW"
    elif retires is None and "Provisioned" not in sku_name:
        flag = "CHECK"  # the account no longer lists this model/version/SKU
    else:
        flag = ""
    model_label = f"{model.name}:{model.version}"
    print(f"{deployment.name:<28} {model_label:<28} {sku_name:<18} {policy:<34} {retires or 'unknown'} {flag}")
```

The lookup is per SKU on purpose, because of the Standard versus Global Standard split above. The Models API calls the per-SKU field `deprecationDate`; for Azure OpenAI SKUs it tracks the per-SKU end date, but confirm it against the retirement table. An `unknown` date flagged `CHECK` means the account no longer lists that model, version and SKU combination; check those deployments first. Dates have moved this year, and the retirement page is the published commitment.

Run it on every Foundry resource you own and the conversation changes. "We use GPT-4o" becomes something like "we have N deployments, some on versions that retire this year, and several Standard deployments still on the `null` policy".

## Set the policy explicitly

The Azure CLI can read `versionUpgradeOption` but can't update it, so use the management REST API (or Azure PowerShell). The PUT replaces the deployment definition, so don't type the body from memory. Leave out `raiPolicyName` and a custom guardrail (content filter) policy can fall back to the default `Microsoft.DefaultV2`; guess the capacity and you've resized the deployment. Instead, GET the deployment, keep `sku`, `model` and any `raiPolicyName` exactly as returned, add only `versionUpgradeOption`, and PUT that back. This snippet requires `jq`:

```bash
URL="https://management.azure.com/subscriptions/<your-subscription-id>/resourceGroups/<your-resource-group>/providers/Microsoft.CognitiveServices/accounts/<your-foundry-resource-name>/deployments/<your-deployment-name>?api-version=2025-06-01"

az rest --method get --url "$URL" \
  | jq '{sku, properties: (.properties | {model, versionUpgradeOption: "OnceCurrentVersionExpired"} + (if .raiPolicyName then {raiPolicyName} else {} end))}' \
  > body.json

# Review body.json before sending it: sku.capacity and raiPolicyName must match what's deployed today.
az rest --method put --url "$URL" --body @body.json
```

The filter keeps only the fields this post relies on, and only copies `raiPolicyName` when the deployment has one, so the PUT never sends a null. If the GET returns other properties you've set deliberately, add them to the `jq` filter too, so the PUT doesn't drop them.

Better still, put the same fields in the Bicep or Terraform that creates the deployment, so a fresh environment can't come up with `null` again.

## Change models like you change code

The policy only decides what happens if you do nothing. The safer lifecycle is the one where you move first. The pattern I use has four steps.

**Deploy the candidate next to the current one.** Use a deployment name that includes the model and version, such as `chat-gpt-51-2025-11-13`, and keep the app pointing at deployments through configuration, not hard-coded names. Rolling back is then a config change, not a redeployment under pressure. The trade-off is a second deployment's quota for the overlap, and on Standard SKUs that's usually affordable for a week or two.

**Evaluate on frozen inputs.** Run the same evaluation set against both deployments and compare row by row. I gate on regressions, not averages, and I've written up [how I count groundedness flips](/blog/2026-03-09-how-i-evaluate-llm-changes-tracking-groundedness-before-celebrating-fluency/) separately. A model swap is exactly the change that set is for.

**Promote by configuration, with a record.** For agents in Foundry Agent Service, pointing an agent at the new deployment creates a new agent version, and earlier versions remain in the agent's version history, so you can point back to one. Tracing for prompt agents is now GA according to the [tracing docs](https://learn.microsoft.com/azure/foundry/observability/how-to/trace-agent-setup), though the tracing page still carries a preview banner alongside a note that tracing is GA for prompt agents only, so read it closely before you depend on it. Tracing for hosted and workflow agents, and the Monitor tab's continuous evaluation, are still preview; I covered [what the 16 March GA covers](/blog/2026-03-19-microsoft-foundry-build-notes-moving-from-model-demos-to-governed-operations/) separately. Either way, watch the scores on live traffic for the first week after promotion, at a higher sampling rate than usual.

**Retire the old deployment deliberately.** Delete it once the new one has held for an agreed window. Orphaned deployments on retiring versions are how the "nobody knew that app still used it" incidents start.

The Foundry portal also has an Ask AI flow, in preview, that flags deprecated deployments and walks you through an evaluation and agent update. I wouldn't make a preview chat assistant the record of why production changed models; keep that in the repository with the evaluation results.

## When this is overkill

A prototype nobody depends on should sit on `OnceNewDefaultVersionAvailable` and be left alone. The full routine earns its cost when another system consumes the output, when the prompt is tuned to a version's quirks, or when a provisioned deployment means a model change is a capacity decision too. For a single internal tool, an explicit policy plus a Service Health alert is enough.

Ownership matters more than tooling here. If your [project boundaries follow teams](/blog/2026-03-08-foundry-decisions-i-stand-behind-how-project-boundaries-change-delivery-speed/), every deployment in the audit output has an obvious owner. If they don't, the retirement email goes to a subscription owner who has never heard of the app.

## The short version

- Run the audit script and find every deployment still on `null`.
- Set `versionUpgradeOption` explicitly, in infrastructure as code: `OnceNewDefaultVersionAvailable` for dev and test, `OnceCurrentVersionExpired` for most production, `NoAutoUpgrade` only with a calendar and an alert behind it.
- Create a Service Health alert for Azure OpenAI Service upgrade, deprecation and retirement advisories, routed to the owning team.
- Move to new versions side by side, behind configuration, with an evaluation run as the gate.

Model retirement isn't an edge case in Foundry. Every GA version you deploy today gets a retirement date no sooner than a year after its launch, and the platform will act on that date whether or not you have.
