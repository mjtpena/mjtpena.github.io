---
title: "Sensitivity Labels in OneLake: Decide Item Boundaries Before Scale"
description: "Fabric sensitivity labels apply per item, not per table, so item boundaries, defaults, inheritance and protection policies need designing before OneLake grows."
author: Michael John Peña
draft: false
date: 2026-04-28
tags:
  - Microsoft Fabric
  - OneLake
  - Governance
  - Sensitivity Labels
  - Microsoft Purview
---

Sensitivity labels usually get switched on in Fabric after the fact, when someone in risk asks which lakehouses hold personal data. By then there are hundreds of items, most unlabelled, and the ones holding sensitive tables sit next to ones that don't. Labelling them properly turns into a redesign, because a label in Fabric attaches to an item, not to a table or a column.

That one fact is why I treat labelling as an architecture decision, not a compliance checkbox. Where you draw item boundaries decides what a label can mean, what a protection policy can block, and how far a label spreads downstream, so make those choices while OneLake is still small.

## Labels and permissions answer different questions

Workspace roles, item permissions, SQL grants and OneLake security roles decide who can open something (I covered that side in [access boundaries](/blog/2026-03-15-keeping-onelake-clean-under-delivery-pressure-balancing-speed-and-access-boundaries/)). A sensitivity label from Microsoft Purview Information Protection says how sensitive the thing is, and several other controls key off it:

- **Exports.** A labelled Power BI item exported to Excel, PowerPoint, PDF or .pbix takes the label and any encryption with it. Other Fabric items only show a warning on export, and CSV or TXT exports aren't covered, so lakehouse data copied out as CSV or Parquet leaves unlabelled.
- **Protection policies.** Purview protection policies for Fabric, [generally available](https://blog.fabric.microsoft.com/en-US/blog/protecting-your-fabric-data-using-purview-is-now-generally-available/) since September 2025, use a label to deny access to everyone except named users and groups.
- **Data loss prevention.** [Purview DLP policies for Fabric](https://learn.microsoft.com/fabric/governance/data-loss-prevention-configure), generally available since September 2025, use labels and sensitive information types as conditions for alerts and policy tips.

So a label isn't decoration in the OneLake catalog. It drives access control on the item and, for Power BI content built on it, protection that survives export, where row-level rules stop helping.

## The item is the unit of classification

A lakehouse carries one label. If it holds a customer table with dates of birth and a reference table of postcodes, the lakehouse gets the higher label, and so does everything downstream of it. Over-labelling has a real cost: people stop trusting labels that say "Highly Confidential" on a calendar dimension, and protection policies on that label lock out analysts who only needed the postcodes.

The fix belongs in the design, not in the labelling:

- **Separate sensitive tables into their own items.** In a medallion layout, I'd keep personal or regulated columns in a dedicated lakehouse per domain (for example `lh_customer_restricted`) and publish a de-identified version into the general curated lakehouse. The restricted one carries the high label; the general one doesn't need it.
- **Decide the label per layer, not per notebook run.** Bronze usually holds everything raw, so it takes the highest label any source deserves. Silver and gold are where you can genuinely lower sensitivity by removing or masking columns, and that's the point to split items.
- **Don't rely on shortcuts to lower the label.** A shortcut lets a second lakehouse read the same data. If the target lakehouse carries a lower label than the source, the label now understates what's reachable through it, so check the target's label yourself whenever you add a shortcut rather than assuming inheritance will raise it. Label the target for the most sensitive thing it exposes; the access side is the same rule I covered in [feeding AI teams through OneLake shortcuts](/blog/2026-04-17-onelake-shortcuts-in-practice-balancing-speed-and-access-boundaries/).

My rule of thumb: if two tables would deserve different labels, they shouldn't live in the same item. That's cheap to follow with ten lakehouses and painful to retrofit with two hundred.

## Choose a short taxonomy the platform can act on

The label taxonomy belongs to your compliance team and usually exists already for email and documents. The data platform team needs a seat at the table, because what matters in Fabric is the action each label drives:

| Label | Typical Fabric content | What it should trigger |
|---|---|---|
| General | Reference data, published aggregates | Nothing beyond normal item permissions |
| Confidential | Curated business data, internal metrics | Labelled exports; DLP policy tips |
| Highly Confidential | Personal or regulated data | Protection policy limiting access to named groups; encryption on Power BI exports built on it |

If a label wouldn't change any behaviour in Fabric, it doesn't need to be a separate choice for data items. Fewer options mean fewer wrong picks.

## Set defaults where items are created

Labels only scale if most of them are applied without anyone thinking about it. Fabric gives you three mechanisms, and their limits matter.

**Default labels.** A Purview label policy can set a default label for Fabric and Power BI content, separate from the default for files and email. Then there are [domain default sensitivity labels](https://learn.microsoft.com/fabric/governance/domain-default-sensitivity-label), generally available since February 2026, which let a domain admin set a default for new or unlabelled items in that domain's workspaces once a tenant admin turns on the delegation setting. That lets a finance domain default to Confidential while reference data defaults to General.

Defaults have a gap that matters at scale. The default label policy doesn't apply to service principals or APIs, and domain defaults don't support deployment pipelines or Git integration, so items created by automation, CI/CD or a Git sync arrive unlabelled. If most of your items are deployed, the coverage report and backfill below aren't optional. Even interactive creation isn't fully covered: the [information protection overview](https://learn.microsoft.com/fabric/governance/information-protection) says a non-Power BI Fabric item only gets the default label when there's "a clear, substantive create dialog", and for changes made in the experience interface, "default labeling isn't currently supported."

**Mandatory labelling.** For lakehouses, pipelines and warehouses, mandatory labelling isn't enforced, so users can save them unlabelled unless the experience itself requires a label. Defaults matter more than mandates for the items that hold OneLake data.

**Inheritance.** Three kinds are [documented](https://learn.microsoft.com/fabric/governance/information-protection#considerations-and-limitations). Inheritance from labelled data sources is currently supported for Power BI semantic models only, so it won't label a lakehouse. Inheritance upon creation gives a new item the label of the item it was created from, such as a notebook or pipeline created from a lakehouse. Downstream inheritance, on by default, pushes a label along lineage from Fabric items to Fabric items and from Fabric to Power BI, but not from Power BI back into Fabric. This rewards good item boundaries: label the restricted lakehouse correctly and the models and reports built on it follow. Put a sensitive table in the general lakehouse and inheritance faithfully spreads the high label everywhere downstream.

## Protection policies need a deliberate allow list

Protection policies are the strongest control here, and the easiest to get wrong. Each is tied to one label. Users and groups named in the policy retain the permissions they already have on items carrying that label, and the **Allow users to retain full control** option lets those with full control keep it; everyone else is blocked. [The protection policies documentation](https://learn.microsoft.com/fabric/governance/protection-policies-overview) covers supported item types and the exceptions, including that the policy doesn't apply to the label issuer, the user who last applied the label.

Three design points before you turn one on:

- **Write the allow list as Entra security groups that already match your workspace design.** If the restricted lakehouse is accessed by the customer data engineering group and one analytics group, those two groups are the policy. Individuals in policies drift the same way individuals in workspace roles do.
- **Check service principals and pipelines.** Service principals can't be added to a policy directly; the documented route is membership of an allowed security group. A scheduled pipeline or a service principal that reads a newly labelled item needs to be covered, or the first sign of the policy will be a failed overnight load.
- **Know the limits before the pilot.** At most 50 policies per tenant and 100 users or groups per policy, no guest or external users, up to 24 hours before a new policy starts protecting items, and no integration with deployment pipelines or Git, which use workspace permissions only.

I'd pilot a policy on one label with one domain, label a handful of items, and confirm who loses access before applying the label more widely.

## Use DLP to find what labels missed

Labels depend on people and defaults getting the classification right. DLP is the check. Purview DLP policies, GA for semantic models, lakehouses, KQL and mirrored databases since September 2025, scan for sensitive information types such as credit card or tax file numbers and raise alerts or policy tips. Restricting access on a match is a separate action, still in preview for OneLake data as of April 2026. I treat DLP as detection first: a DLP hit on an item labelled General is a mislabelled item, and the response is to fix the label or move the table, not just to clear the alert.

OneLake security, still in preview as of April 2026, narrows what a reader sees inside an item; labels and protection policies govern the item as a whole and its exports. You want both, and neither replaces item boundaries.

## Measure label coverage from the API

The Fabric REST API's [List Items](https://learn.microsoft.com/rest/api/fabric/core/items/list-items) response returns a `sensitivityLabel` object with the label's `id` on each item, which is enough to measure coverage per workspace without opening the portal. This script counts unlabelled data-holding items in every workspace the caller can see. It uses `azure-identity` and `requests`; a user token needs `Workspace.Read.All` (or `Workspace.ReadWrite.All`). It waits out 429 throttling and skips workspaces it can't read. Add any other data-holding item types your tenant uses.

```python
"""Report unlabelled Fabric items per workspace.

pip install azure-identity requests
"""
import time
from collections import defaultdict

import requests
from azure.identity import InteractiveBrowserCredential

API = "https://api.fabric.microsoft.com/v1"
SCOPE = "https://api.fabric.microsoft.com/.default"
DATA_ITEM_TYPES = {
    "Lakehouse",
    "Warehouse",
    "SemanticModel",
    "KQLDatabase",
    "Eventhouse",
    "SQLDatabase",
    "MirroredDatabase",
}  # Power BI datamarts were retired in October 2025; their replacement is Warehouse, which is already in the set

credential = InteractiveBrowserCredential()
session = requests.Session()


def get(url: str, max_retries: int = 5) -> requests.Response:
    """GET with a fresh token per call and retries on throttling (429)."""
    for attempt in range(max_retries + 1):
        token = credential.get_token(SCOPE).token  # cached until near expiry
        response = session.get(
            url, headers={"Authorization": f"Bearer {token}"}, timeout=60
        )
        if response.status_code != 429 or attempt == max_retries:
            response.raise_for_status()
            return response
        try:
            delay = int(response.headers.get("Retry-After", "30"))
        except ValueError:  # Retry-After can be an HTTP-date
            delay = 30
        time.sleep(delay)
    raise RuntimeError("unreachable")


def get_all(url: str) -> list[dict]:
    """Follow continuationUri until every page is read."""
    results = []
    while url:
        response = get(url)
        body = response.json()
        results.extend(body.get("value", []))
        url = body.get("continuationUri")
    return results


unlabelled = defaultdict(list)
totals = defaultdict(int)

skipped = {}

for workspace in get_all(f"{API}/workspaces"):
    name = workspace["displayName"]
    try:
        items = get_all(f"{API}/workspaces/{workspace['id']}/items")
    except requests.HTTPError as error:  # e.g. 403 without a role, 404 if deleted mid-run
        skipped[name] = f"skipped (HTTP {error.response.status_code})"
        continue
    for item in items:
        if item["type"] not in DATA_ITEM_TYPES:
            continue
        totals[name] += 1
        label = item.get("sensitivityLabel") or {}
        if not label.get("id"):
            unlabelled[name].append(f"{item['type']}: {item['displayName']}")

for name, reason in sorted(skipped.items()):
    print(f"{name}: {reason}")

for name in sorted(totals):
    missing = unlabelled.get(name, [])
    print(f"{name}: {len(missing)}/{totals[name]} data items unlabelled")
    for entry in missing:
        print(f"    {entry}")
```

Run it weekly and watch the trend, not the absolute number. For backfilling, the admin [Bulk Set Labels API](https://learn.microsoft.com/rest/api/fabric/admin/labels/bulk-set-labels) applies a label to items by ID, limited to 25 requests an hour and 2,000 items per request. The calling admin, or the delegated user, needs the label in their label policy. A blanket bulk "Confidential" just recreates over-labelling at scale. The script only sees workspaces the caller belongs to; for a tenant-wide view, use the Power BI admin scanner APIs, which need admin rights.

## When this is more than you need

If one team owns every workspace, nothing leaves Fabric as an export, and the data isn't regulated, workspace boundaries and item permissions will carry you a long way. Labels also need Purview Information Protection licensing and a label taxonomy someone maintains; if neither exists yet, start with the item boundaries anyway, because they cost nothing and make labelling straightforward later. My [2024 walkthrough of sensitivity labels in Fabric](/blog/2024-06-25-sensitivity-labels-fabric/) covers the basic setup.

## What I'd decide this month

Before OneLake grows further, settle four things: no item mixes tables that deserve different labels; every domain has a default label; one protection policy is piloted on your highest label with a group-based allow list; and a weekly coverage report shows the unlabelled count going down. Labels on well-drawn items scale; labelling whatever exists after the fact just produces the next audit finding.
