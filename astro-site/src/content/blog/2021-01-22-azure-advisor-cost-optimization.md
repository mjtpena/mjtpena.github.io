---
title: "Triaging Azure Advisor Cost Recommendations Before You Act"
description: "Which Azure Advisor cost recommendations are safe to act on, which need judgement, and how to pull, tune and suppress them with the CLI and Python SDK."
author: Michael John Pena
draft: false
date: 2021-01-22
url: /blog/azure-advisor-cost-optimization/
tags:
  - Azure
  - Advisor
  - Cost Optimization
  - FinOps
  - Python
---

Azure Advisor's Cost tab is free, and most teams either act on it blindly or ignore it. Advisor reads your resource configuration and usage telemetry and tells you which VMs look oversized, which ones look idle, and where a reservation would pay for itself. Treating the list as gospel or as noise are both mistakes: each recommendation carries a different level of risk, and the useful skill is knowing which ones you can act on today and which ones need a conversation first. Here I'm only looking at the Cost category.

## What Advisor actually looks at

Advisor's cost recommendations come from a handful of rules, documented in the [Advisor cost recommendations](https://learn.microsoft.com/en-us/azure/advisor/advisor-cost-recommendations) page. The ones that show up most often are:

- **Right-size or shut down underutilised virtual machines.** Advisor looks at the last seven days of usage and flags VMs whose CPU and network utilisation over that window suggest either a smaller size or no need to run at all.
- **Buy reservations.** Advisor analyses your pay-as-you-go consumption and suggests reserved VM instances (and reserved capacity for several PaaS services) with an estimated saving.
- **Idle network resources.** ExpressRoute circuits that have been provisioned on the Azure side but never connected by the provider, and virtual network gateways that have sat idle.
- **Storage hygiene.** For example, keeping managed disk snapshots on Standard storage rather than Premium.

Two things matter about that list. First, the evidence window for VM recommendations is seven days and it isn't configurable. A month-end batch job, a payroll run or a quarterly reporting workload can look idle for seven days and then fall over when it's needed. Second, for shutdown and resize recommendations the savings figure is an estimate based on retail pay-as-you-go rates. It doesn't account for your Enterprise Agreement discount, Azure Hybrid Benefit choices, or the fact that the VM is a warm standby on purpose. Reservation recommendations do use your own usage and pricing, but they assume today's usage continues for the whole term.

## A triage table, not a to-do list

My rule of thumb is to sort cost recommendations by how reversible the action is and how much context it needs, not by the savings figure Advisor puts next to them.

| Recommendation | Reversible? | Context needed | What I'd do |
|---|---|---|---|
| Unprovisioned ExpressRoute circuit | Yes | Low: confirm the provider order is dead | Delete once the network team confirms |
| Idle virtual network gateway | Mostly (recreate takes time, IPs may change) | Medium | Check for planned VPN or DR use, then delete |
| Shut down underutilised VM | Yes, but someone notices | High | Ask the owner. Often it's a forgotten dev box; sometimes it's DR |
| Right-size VM | Yes, needs a restart | High | Load test or watch a full business cycle first |
| Buy reservation | Limited (exchanges and refunds have rules) | High | Only after right-sizing; commit only to what you'll still run for the full reservation term (one or three years) |

The order of operations in that last row is the mistake I see most often. Right-size first, let the usage settle, then look at reservations. How much a premature purchase hurts depends on two settings you choose when you buy:

- **Instance size flexibility.** On by default for VM reservations, it lets a reservation apply across sizes in the same [instance size flexibility group](https://learn.microsoft.com/en-us/azure/virtual-machines/reserved-vm-instance-size-flexibility). A reservation for one D8s_v3 covers two D4s_v3 VMs, so if you right-size a fleet of D8s_v3 VMs to D4s_v3 and keep roughly the same total capacity, the reservation still applies. If you halve the capacity, or move to a different series (say, from Dsv3 to B-series or Esv3), the reservation goes partly or wholly unused and you've locked in the waste until you exchange it.
- **Scope.** A single-subscription scope only discounts VMs in that subscription; a shared scope applies across every eligible subscription in the billing context. Shared scope is more forgiving when right-sizing or migration shrinks one workload, because the spare capacity can land on VMs elsewhere. Single scope makes chargeback simpler but turns every resize in that subscription into a utilisation risk. My default is shared scope with size flexibility on, unless finance needs a reservation tied to one cost centre.

Exchanges and refunds exist, but they have rules and limits, so treat them as a safety net rather than a plan.

## Tune the CPU threshold before you trust the list

The low-utilisation rule uses an average CPU threshold that defaults to 5%. You can raise it to 10, 15 or 20% per subscription. A higher threshold produces more recommendations; a lower one produces fewer but more confident ones.

I'd leave production subscriptions at 5% and raise dev/test subscriptions to 15% or 20%. Non-production estates are where oversized VMs pile up, and the cost of being wrong there is a developer asking for a bigger box again. With the Azure CLI:

```bash
# Raise the low-CPU threshold for the current subscription (valid values: 5, 10, 15, 20)
az advisor configuration update --low-cpu-threshold 20

# Confirm the setting
az advisor configuration show
```

Advisor regenerates recommendations on its own schedule, so give it a day before judging the effect. If you need the list refreshed sooner, `az advisor recommendation list --refresh` triggers regeneration first.

## Pull the cost recommendations into something you can sort

The portal is fine for browsing, but triage needs a spreadsheet you can sort by owner, resource group and saving. The track-2 Python management SDK, [`azure-mgmt-advisor` 9.0.0](https://pypi.org/project/azure-mgmt-advisor/9.0.0/), went GA on 4 January 2021 and works with `DefaultAzureCredential` from `azure-identity`, so this is a good time to move any older scripts across.

```python
import csv
import os
import sys

from azure.identity import DefaultAzureCredential
from azure.mgmt.advisor import AdvisorManagementClient
from azure.mgmt.core.tools import parse_resource_id

subscription_id = os.environ["AZURE_SUBSCRIPTION_ID"]
client = AdvisorManagementClient(DefaultAzureCredential(), subscription_id)


def to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


rows = []
for rec in client.recommendations.list(filter="Category eq 'Cost'"):
    props = rec.extended_properties or {}
    resource_id = rec.resource_metadata.resource_id if rec.resource_metadata else ""
    rows.append({
        "problem": rec.short_description.problem if rec.short_description else "",
        "impact": rec.impact,
        "impacted_type": rec.impacted_field,
        "impacted_resource": rec.impacted_value,
        "resource_group": parse_resource_id(resource_id).get("resource_group", "") if resource_id else "",
        "annual_savings": to_float(props.get("annualSavingsAmount")),
        "currency": props.get("savingsCurrency", ""),
        "recommendation_type_id": rec.recommendation_type_id,
        "last_updated": rec.last_updated.isoformat() if rec.last_updated else "",
        "resource_id": resource_id,
    })

if not rows:
    print("No cost recommendations")
    sys.exit(0)

rows.sort(key=lambda r: r["annual_savings"], reverse=True)

with open("advisor-cost.csv", "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)

total = sum(r["annual_savings"] for r in rows)
print(f"{len(rows)} cost recommendations, estimated annual savings {total:,.2f}")
```

Install with `pip install azure-identity azure-mgmt-advisor==9.0.0` (it pulls in `azure-mgmt-core`, which provides `parse_resource_id`). A few notes on the shape of the data:

- `impacted_value` is the **name of the resource**, not a money figure. The savings estimate lives in `extended_properties`, which is a loose dictionary of strings whose keys differ by recommendation type. `annualSavingsAmount` and `savingsCurrency` are common on cost recommendations, but read the dictionary for the types you care about rather than assuming every key exists.
- `recommendation_type_id` is a GUID per rule. Group by it rather than by the problem text, which can change.
- The SDK calls the REST API version `2020-01-01`. If you'd rather use the CLI, `az advisor recommendation list --category Cost --output json` returns the same objects.

Once it's in a CSV, add an "owner" column from your tags and send each owner their slice. That one step does more for follow-through than any dashboard.

## Suppress deliberately, and say why

Some recommendations are correct by Advisor's rules and wrong for your business: a DR VM that is meant to idle, or a gateway reserved for a failover site. Leaving those in the list trains people to ignore the Cost tab. Dismiss or postpone them instead:

```bash
# Postpone a recommendation for 30 days
az advisor recommendation disable \
  --ids "<recommendation-resource-id>" \
  --days 30

# Dismiss it until re-enabled (omit --days)
az advisor recommendation disable --ids "<recommendation-resource-id>"

# Bring it back
az advisor recommendation enable --ids "<recommendation-resource-id>"
```

My rule: postpone by default, dismiss only when there's a documented reason, and keep that reason somewhere outside Advisor (a tag on the resource or a line in the runbook). Suppressions are invisible to the next person who opens the portal, and a dismissed recommendation for a DR VM that was decommissioned six months ago is just hidden waste.

## Get told when something new appears

Advisor writes an Activity Log event when a new recommendation is created, so you can raise an [Advisor alert](https://learn.microsoft.com/en-us/azure/advisor/advisor-alerts-portal) through a normal action group. Filtering on Cost and High impact keeps the noise down:

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "actionGroupId": {
      "type": "string",
      "metadata": { "description": "Resource ID of an existing action group" }
    }
  },
  "resources": [
    {
      "type": "Microsoft.Insights/activityLogAlerts",
      "apiVersion": "2017-04-01",
      "name": "advisor-high-impact-cost",
      "location": "Global",
      "properties": {
        "enabled": true,
        "scopes": ["[subscription().id]"],
        "condition": {
          "allOf": [
            { "field": "category", "equals": "Recommendation" },
            { "field": "properties.recommendationCategory", "equals": "Cost" },
            { "field": "properties.recommendationImpact", "equals": "High" },
            { "field": "operationName", "equals": "Microsoft.Advisor/recommendations/available/action" }
          ]
        },
        "actions": {
          "actionGroups": [{ "actionGroupId": "[parameters('actionGroupId')]" }]
        }
      }
    }
  ]
}
```

Deploy it at subscription scope with `az deployment sub create --location <region> --template-file advisor-alert.json --parameters actionGroupId=<action-group-resource-id>`.

## What I wouldn't automate

It's tempting to wire a timer-triggered Function straight from the recommendations API to `deallocate` and `resize` calls. I wouldn't, for anything except the narrowest cases. Advisor tells you a VM *looked* idle for seven days; it doesn't tell you who depends on it. Automated resizing also restarts VMs, and an unannounced restart in the middle of a business day costs more goodwill than the saving is worth.

What I'm comfortable automating is the boring, reversible stuff with a clear owner: deallocating tagged dev/test VMs outside business hours (VM auto-shutdown already does this per VM), and sending each owner their weekly list. Everything else goes through a human with context.

Also be honest about Advisor's gaps. It won't tell you about an over-provisioned SQL elastic pool that your team sized for a launch that never happened, or a storage account full of logs nobody reads. Pair it with [Azure Cost Management](/blog/2020-11-07-azure-cost-management/) cost analysis and budgets so you can see where the spend actually concentrates; Advisor tells you what's cheap to fix, Cost Management tells you what's big.

## The short version

Treat Advisor's Cost tab as a triage queue. Tune the CPU threshold per environment, export the list with owners attached, act on the reversible items quickly, put right-sizing in front of reservations, and suppress with a written reason rather than letting stale items pile up. Advisor Score, [in preview since September 2020](https://learn.microsoft.com/en-us/azure/advisor/advisor-score), gives you a single number to track progress, but the number only moves if someone owns each item on the list.
