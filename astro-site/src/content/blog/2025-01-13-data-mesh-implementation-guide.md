---
title: "Rolling Out a Data Mesh on Fabric: A Phased Plan for 2025"
description: "A phased plan for rolling out data mesh on Microsoft Fabric and Purview in early 2025: what to build first, what's still preview, and when to stop."
author: Michael John Peña
draft: false
date: 2025-01-13
tags:
  - Data Mesh
  - Data Architecture
  - Data Governance
  - Microsoft Fabric
  - Microsoft Purview
---

Most data mesh programmes don't fail on technology. They fail because the organisation tries to switch on all four principles at once, across every business unit, before a single data product has a consumer. By January 2025 Microsoft Fabric and Purview cover enough of the tooling that the platform is rarely the blocker. The order you roll things out in is what matters.

I've written before about [how the four principles map onto Fabric](/blog/2024-06-15-data-mesh-fabric/) and about [Fabric domains specifically](/blog/2023-11-13-fabric-domains-organization/). This post is the sequencing companion: what to build in which phase, which pieces are GA versus preview right now, and the signals that tell you to stop expanding.

## First, decide whether you need a mesh at all

Data mesh is an operating model for organisations where a central data team has become the bottleneck. It costs you duplicated engineering effort, more governance surface, and a platform team that has to behave like a product team. If your data estate is run by eight engineers serving three business units, a well-run central lakehouse with clear ownership of each gold table will beat a mesh on cost and speed.

My rule of thumb: consider a mesh when at least two of these are true.

- The central team's backlog is measured in quarters, not weeks.
- Business domains already have people who understand their data better than the central team does, and they're willing to own it.
- You have several independent consumers of the same domain data and keep rebuilding it.
- Regulatory or organisational boundaries already force separate ownership.

If none of these apply, don't do it. Adopting the vocabulary ("data products", "domains") inside a central model is fine and costs nothing. Adopting the org structure without the need is expensive.

## What the platform gives you in January 2025

Before planning phases, be precise about what exists and what status it's in. Here's how I map the principles to features as of this month.

| Principle | Fabric / Purview feature | Status (Jan 2025) |
|---|---|---|
| Domain ownership | [Fabric domains](https://learn.microsoft.com/fabric/governance/domains) and workspace assignment | Domains available in the admin portal; subdomains in preview |
| Domain ownership (automation) | [Fabric admin Domains REST API](https://learn.microsoft.com/rest/api/fabric/admin/domains) | Preview |
| Data as a product | Lakehouse/warehouse gold tables, endorsement (Promoted, Certified) | GA |
| Data as a product (catalogue) | [Data products in Purview Unified Catalog](https://learn.microsoft.com/purview/unified-catalog-data-products) | GA (new Purview portal); check availability in your region |
| Self-serve platform | Workspaces, Fabric REST APIs, Git integration, deployment pipelines | Core APIs GA |
| Cross-domain consumption | [OneLake shortcuts](https://learn.microsoft.com/fabric/onelake/onelake-shortcuts) | GA |
| Discovery | OneLake catalog (successor to the OneLake data hub) | GA since Q4 2024 |
| Fine-grained access | OneLake data access roles | Preview, opt-in per lakehouse |

Two things in that table shape the plan. First, the automation and fine-grained security pieces are still in preview, so I wouldn't make a production rollout depend on them. Second, Purview's data product and governance domain constructs are separate from Fabric domains. They don't sync automatically, and you'll end up maintaining both. Decide early which one is the source of truth for ownership. I'd make Fabric domains the source of truth for where data lives and who administers it, and Purview the source of truth for business ownership and contracts.

## Phase 1: two domains, one platform team (months 0–3)

Pick two domains: one with a strong data owner and an obvious consumer, and one that consumes from it. You want a producer–consumer pair so the first cross-domain share happens inside the pilot, not a year later.

The platform team's job in this phase is to make domain provisioning boring and repeatable. In practice that's a script that creates a domain, its workspaces (I use separate dev and prod workspaces per domain), and assigns them. The script below uses the Fabric REST API with `azure-identity` and provisions both pilot domains. The domain admin APIs are still preview and only accept a signed-in Fabric administrator (no service principal or managed identity), so run this interactively, e.g. with `AzureCliCredential` after `az login`, rather than from an unattended pipeline. Treat it as platform-team tooling, not something domain teams run themselves.

```python
import requests
from azure.identity import AzureCliCredential

FABRIC_API = "https://api.fabric.microsoft.com/v1"
# Run `az login` as a Fabric administrator first; the domain admin APIs
# don't accept service principals or managed identities.
credential = AzureCliCredential()


def headers() -> dict:
    token = credential.get_token("https://api.fabric.microsoft.com/.default").token
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def create_domain(name: str, description: str) -> str:
    # Admin API (preview): caller must be a signed-in Fabric administrator
    resp = requests.post(
        f"{FABRIC_API}/admin/domains",
        headers=headers(),
        json={"displayName": name, "description": description},
    )
    resp.raise_for_status()
    return resp.json()["id"]


def create_workspace(name: str, capacity_id: str) -> str:
    resp = requests.post(
        f"{FABRIC_API}/workspaces",
        headers=headers(),
        json={"displayName": name, "capacityId": capacity_id},
    )
    resp.raise_for_status()
    return resp.json()["id"]


def assign_workspaces(domain_id: str, workspace_ids: list[str]) -> None:
    resp = requests.post(
        f"{FABRIC_API}/admin/domains/{domain_id}/assignWorkspaces",
        headers=headers(),
        json={"workspacesIds": workspace_ids},
    )
    resp.raise_for_status()


PILOT_DOMAINS = {
    "Sales": "Customer, order and pipeline data products",
    "Marketing": "Campaign and segmentation data products",
}

if __name__ == "__main__":
    capacity_id = "<your-capacity-id>"
    for name, description in PILOT_DOMAINS.items():
        domain_id = create_domain(name, description)
        prefix = name.lower()
        ws_ids = [
            create_workspace(f"{prefix}-dev", capacity_id),
            create_workspace(f"{prefix}-prod", capacity_id),
        ]
        assign_workspaces(domain_id, ws_ids)
        print(f"Domain {name} ({domain_id}) with workspaces {ws_ids}")
```

Workspace role assignments, Git integration, and capacity choices belong in the same script once the basics work. Whether each domain gets its own capacity is a cost-allocation decision, not a mesh requirement. Sharing a capacity in the pilot is fine; split it when a domain's workload starts throttling another.

## Phase 2: the first data product, with a contract (months 2–5)

A data product is not a table with a nice name. It's a table plus an owner, a documented schema, a freshness promise, and checks that fail loudly when the promise is broken. I covered contract formats in [the data contracts post](/blog/2024-06-19-data-contracts/). The minimum I'd ship in phase 2 is a check that runs at the end of the producing pipeline and stops it before bad data reaches the gold table consumers read.

This is a fragment for a Fabric notebook attached to the producing lakehouse, where `spark` is already defined:

```python
from datetime import datetime, timedelta, timezone

from pyspark.sql import functions as F

TABLE = "gold_customer_360"
MAX_AGE = timedelta(hours=25)

# Each rule is a SQL predicate that every row must satisfy.
# A predicate that evaluates to NULL counts as a failure (see coalesce below),
# so a NULL lifetime_value or churn_risk can't slip through.
rules = {
    "customer_id_not_null": "customer_id IS NOT NULL",
    "lifetime_value_non_negative": "lifetime_value >= 0",
    "churn_risk_in_range": "churn_risk BETWEEN 0 AND 1",
}

df = spark.read.table(TABLE)

# One pass over the table: count violations for every rule plus the max timestamp
violation_counts = [
    F.sum(F.when(~F.coalesce(F.expr(p), F.lit(False)), 1).otherwise(0)).alias(n)
    for n, p in rules.items()
]
result = df.agg(*violation_counts, F.max("last_updated").alias("latest")).collect()[0]

failures = {n: result[n] for n in rules if result[n]}

latest = result["latest"]
# Assumes spark.sql.session.timeZone is UTC, the Fabric default
if latest is None or datetime.now(timezone.utc) - latest.replace(tzinfo=timezone.utc) > MAX_AGE:
    failures["freshness"] = str(latest)

if failures:
    raise ValueError(f"{TABLE} broke its contract: {failures}")
print(f"{TABLE} passed {len(rules) + 1} contract checks")
```

Raising an exception is deliberate. A failed notebook activity fails the pipeline run, which is where alerting already lives. Writing a quality score to a dashboard nobody watches is how contracts quietly rot.

Once the product passes its checks consistently, endorse the item as Promoted. Reserve Certified for products that have gone through whatever review your governance group defines. If you're in a region where the new Purview data governance experience is available, register the same product in Unified Catalog with its owner and linked assets, so business users find it without needing a Fabric workspace role.

## Phase 3: consume across domains without copying (months 4–6)

The consuming domain shouldn't get contributor access to the producer's workspace, and it shouldn't copy the data with a pipeline either. A OneLake shortcut makes the producer's Delta table appear in the consumer's lakehouse with no data movement. The producer keeps ownership, and storage is billed once.

```python
import requests
from azure.identity import DefaultAzureCredential

FABRIC_API = "https://api.fabric.microsoft.com/v1"
token = DefaultAzureCredential().get_token("https://api.fabric.microsoft.com/.default").token

consumer_workspace_id = "<marketing-workspace-id>"
consumer_lakehouse_id = "<marketing-lakehouse-id>"

body = {
    "path": "Tables",
    "name": "customer_360",
    "target": {
        "oneLake": {
            "workspaceId": "<sales-prod-workspace-id>",
            "itemId": "<sales-lakehouse-id>",
            "path": "Tables/gold_customer_360",
        }
    },
}

resp = requests.post(
    f"{FABRIC_API}/workspaces/{consumer_workspace_id}/items/{consumer_lakehouse_id}/shortcuts",
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    json=body,
)
resp.raise_for_status()
print(resp.json())
```

The trade-off to understand is that [shortcut security](https://learn.microsoft.com/fabric/onelake/onelake-shortcut-security) depends on the engine. Through Spark and the OneLake APIs, the caller's identity is checked against the target, so consumers need read access to the producer's lakehouse. Through the SQL analytics endpoint and semantic models, the consuming item owner's identity is used instead, so lock down who can read the consumer's SQL endpoint as well. Otherwise anyone with access to the marketing lakehouse's SQL endpoint reads sales data the producer never granted them. The Spark path is the right default for a mesh because the producer stays in control, but it means access requests flow to the producing domain. Plan that workflow before phase 3, not during it. OneLake data access roles can narrow access to specific folders, but they're preview and opt-in, so for now I'd grant read on the producing lakehouse and keep sensitive columns out of shared gold tables entirely.

## Phase 4: federate governance, then expand (month 6 onward)

Only now does a governance council earn its keep, because it has two real domains and at least one real contract to argue about. Keep the global policy list short: sensitivity labelling on anything with personal information, mandatory owner and description on endorsed items, and the contract-check pattern above. Everything else is a domain decision. I go deeper on splitting global and domain policies in [the federated governance post](/blog/2024-06-17-federated-governance/).

Discovery moves from "ask in Teams" to the OneLake catalog for Fabric users and Purview Unified Catalog for the wider business. Expect overlap; that's the cost of two catalogues until the integration story matures.

Add domains one or two at a time. Each new domain should arrive with a named data owner, at least one consumer lined up, and the provisioning script from phase 1, not a bespoke setup.

## How to know it's working

Skip vanity counts like "number of data products". The signals I'd track:

- **Lead time for a new data product**, from request to first consumer query.
- **Cross-domain shortcuts in active use.** If products aren't consumed outside their domain, you've built silos with extra steps.
- **Contract check failures caught before consumers noticed.** This number should be greater than zero; if it's zero, your checks are too weak.
- **Central team backlog.** If the mesh is working, it shrinks.

## The decision

Start with a producer–consumer pair, automate provisioning before adding domains, ship one contract-checked product before writing a governance charter, and use shortcuts instead of copies. Build on the GA pieces (workspaces, shortcuts, endorsement, OneLake catalog) and treat the preview ones (domain admin APIs, subdomains, OneLake data access roles) as accelerators you can swap in later. If after two domains the central backlog hasn't moved and nobody outside the producing domain is querying the product, stop and fix the operating model before scaling it.
