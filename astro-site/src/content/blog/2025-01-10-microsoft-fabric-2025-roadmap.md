---
title: "Planning Fabric Work for 2025: What's GA, Preview, and Worth Waiting On"
description: "A January 2025 status check on Microsoft Fabric after Ignite 2024: which features are GA, which are preview, and how to sequence this year's work."
author: Michael John Peña
draft: false
date: 2025-01-10
tags:
  - Microsoft Fabric
  - Data Platform
  - Planning
  - Real-Time Intelligence
  - Copilot
---

Most data teams are writing their 2025 plans this month, and Fabric is on a lot of them. The trouble is that Fabric ships features fast. Some arrive as preview, some as GA, and some only as "coming soon", and a plan that can't tell those apart will commit production workloads to things with no SLA. Here is where things stood in early January 2025, after Ignite 2024, and how I'd sequence the year's work.

If you want the forward-looking feature list, I covered that in [the Fabric roadmap post from October](/blog/2024-10-29-fabric-roadmap/), and the Ignite detail is in [Fabric at Ignite 2024](/blog/2024-11-19-microsoft-fabric-ignite-updates/). This one is narrower: what you can stand behind in a design review today.

## Why release status matters more than the feature list

Preview in Fabric is not a soft label. Preview features usually come with no SLA, can change behaviour or pricing before GA, and sometimes start out with limits on regions, capacity size or tenant settings. None of that makes preview features useless. It means they belong in pilots and in plans with an exit path, not in the critical path of a regulatory report.

My rule of thumb: anything a business process depends on overnight runs on GA features. Preview is fine for proofs of concept, internal tools, and workloads where a breaking change costs you a sprint rather than a compliance incident.

## Where things stand in January 2025

Microsoft's [Ignite 2024 Fabric announcement](https://www.microsoft.com/en-us/microsoft-fabric/blog/2024/11/19/accelerate-app-innovation-with-an-ai-powered-data-platform/) moved several items to GA and introduced a lot of new preview surface. Here is how I'd summarise the state of the features most teams ask about:

| Area | Status in Jan 2025 | What it means for planning |
|---|---|---|
| Real-Time Intelligence (Real-Time hub, Eventstream, Eventhouse, Real-Time Dashboards, Activator) | GA | Safe to design production streaming workloads on |
| OneLake catalog, Explore tab | GA | Use it as the discovery front door; the Govern tab is still to come |
| Mirroring for Azure SQL Database | GA | Viable replacement for hand-built CDC into the lakehouse |
| API for GraphQL | GA | Reasonable for read APIs over lakehouse and warehouse data |
| Workload Development Kit | GA | ISVs and platform teams can build custom Fabric items |
| SQL database in Fabric | Public preview | Pilot it; don't move OLTP systems yet |
| Mirroring for Azure SQL Managed Instance, open mirroring | Preview | Promising for ingestion; keep a fallback |
| AI skill | Public preview | Good for scoped Q&A pilots on curated data |
| Workspace monitoring, surge protection | Preview | Turn them on in non-production first |
| Copilot in Fabric | Mixed: GA for Power BI and Dataflow Gen2, preview for newer experiences; needs F64 or P1+ | Smaller capacities can't use it yet |

Two things stand out. Real-Time Intelligence going GA is the biggest change for platform design, because it was the one major workload many architects were still treating as experimental. And the new Fabric Databases category, starting with SQL database, is the biggest new surface, but it is very early.

## Real-Time Intelligence: now a normal design option

With Real-Time Intelligence at GA, I'd stop treating streaming in Fabric as a special project. Eventstream for ingestion, Eventhouse (KQL databases) for storage and querying, and Activator for alerting now form a supported stack. For teams already on Azure Data Explorer or Stream Analytics, this is the first time a move into Fabric is a reasonable conversation rather than an experiment.

When not to move: if you already have a well-run Azure Data Explorer cluster with tuned ingestion and retention policies, the case for migrating is weaker than the case for using OneLake availability and shortcuts to connect it to the rest of Fabric. Migration should buy you something beyond a single bill. The patterns I'd start with are in [my real-time analytics post](/blog/2025-01-12-real-time-analytics-fabric-patterns/).

## SQL database in Fabric: pilot, don't migrate

SQL database in Fabric is the first of the new Fabric Databases. It's built on the Azure SQL Database engine and automatically replicates its data into OneLake, so operational data shows up for analytics without a pipeline. That's an attractive idea for the small line-of-business apps that currently live in a scattering of Azure SQL databases and Access files.

But it's in public preview, and Microsoft has said compute and storage billing starts on 1 February 2025, with backup billing after that, so the cost profile you see during the free period isn't the one you'll pay. I'd use the first half of the year to pilot it with one low-risk app, measure capacity consumption once billing applies, and only then decide whether it earns a place in the architecture. Anything with strict uptime or recovery requirements stays on Azure SQL Database until GA. The preview gaps that matter are the lack of an SLA and the preview limits on features and regions, so check the [SQL database limitations page](https://learn.microsoft.com/en-us/fabric/database/sql/limitations) against your app before you pilot.

## Copilot and AI skill: plan for the capacity gate

Copilot in Fabric is a mix of release states in January 2025: the Power BI and Dataflow Gen2 experiences are GA, while newer ones, such as Copilot for data pipelines announced at Ignite, are still in preview. All of them need an F64 or larger capacity, or a Power BI Premium P1 or higher. Trial capacities don't qualify. The [Enable Copilot in Fabric](https://learn.microsoft.com/en-us/fabric/fundamentals/copilot-enable-fabric) page lists the capacity requirements and the tenant settings involved. Microsoft also announced at Ignite that you'll be able to point Copilot billing at a separate F64+ capacity, but that was listed as coming soon, not available.

That gate shapes the plan. If most of your workspaces run on F8 or F16, Copilot isn't something you can budget for at the workspace level this quarter. Either you have an F64 somewhere and route Copilot usage there, or you leave it out of the 2025 business case until the licensing changes. Don't build a productivity case on a feature most of your users can't reach.

AI skill, which lets you build a natural-language Q&A experience over lakehouse, warehouse and semantic model data, is in public preview. It's a sensible pilot on a narrow, well-modelled dataset. It is not a replacement for a semantic model with proper definitions, and the quality of its answers depends on how clean that underlying model is. I go deeper on the Copilot experiences in [the Copilot deep dive](/blog/2025-01-11-fabric-ai-features-copilot-deep-dive/).

## Governance and capacity: the unglamorous priorities

The features I'd put first in most 2025 plans are not the headline ones:

- **OneLake catalog** replaces the OneLake data hub as the place people find data. Rolling it out is mostly change management: endorsement, descriptions, and owners on the items people actually use.
- **Workspace monitoring** (preview) gives you diagnostic logs in an Eventhouse inside the workspace. Until it's GA, the Capacity Metrics app remains the source of truth for capacity decisions.
- **Surge protection** (preview) limits how much background work can consume a capacity, which targets a familiar failure mode: a runaway background job throttling interactive reports.
- **Microsoft Purview integration** keeps growing, with protection policies extended to more sources and DLP policies that can restrict access to semantic models with sensitive data, both announced in preview at Ignite.

If you only do one thing from this list, get an inventory of what's actually in your tenant. You can't apply the GA-versus-preview split above until you know how many of your items depend on preview features.

## A quick inventory of preview-dependent items

The Fabric REST API makes the inventory straightforward. This script lists every item in the workspaces you can access and counts them by type, so you can see how much depends on preview items such as SQL databases and mirrored databases. It uses `azure-identity` and `requests`, and the item type names are the ones the [Fabric Items API](https://learn.microsoft.com/en-us/rest/api/fabric/core/items/list-items) returns.

```python
from collections import Counter

import requests
from azure.identity import DefaultAzureCredential

FABRIC_API = "https://api.fabric.microsoft.com/v1"
PREVIEW_TYPES = {"SQLDatabase", "MirroredDatabase"}


def get_all(url: str, headers: dict, key: str) -> list:
    """Follow Fabric API continuation links and return every result."""
    results = []
    while url:
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        body = response.json()
        results.extend(body.get(key, []))
        url = body.get("continuationUri")
    return results


def main() -> None:
    credential = DefaultAzureCredential()
    token = credential.get_token("https://api.fabric.microsoft.com/.default").token
    headers = {"Authorization": f"Bearer {token}"}

    workspaces = get_all(f"{FABRIC_API}/workspaces", headers, "value")
    totals = Counter()

    for workspace in workspaces:
        items = get_all(
            f"{FABRIC_API}/workspaces/{workspace['id']}/items", headers, "value"
        )
        types = Counter(item["type"] for item in items)
        totals.update(types)
        flagged = {t: n for t, n in types.items() if t in PREVIEW_TYPES}
        if flagged:
            print(f"{workspace['displayName']}: {flagged}")

    print("\nItems by type across all workspaces:")
    for item_type, count in totals.most_common():
        marker = "  (preview)" if item_type in PREVIEW_TYPES else ""
        print(f"  {item_type}: {count}{marker}")


if __name__ == "__main__":
    main()
```

Run it as a user or service principal with access to the workspaces you care about. The `PREVIEW_TYPES` set reflects status in January 2025; add other item types you're piloting and remove them as they reach GA. Note that mirroring is GA for Azure SQL Database but not for every source, so a mirrored database flagged here still needs a manual check of its source. A service principal also needs the Fabric tenant setting "Service principals can use Fabric APIs" enabled and at least the Viewer role on each workspace to list its items, and on large tenants you may need retry and backoff on HTTP 429 throttling responses.

## How I'd sequence 2025

For a team already running Fabric in production, my order would be:

1. **Q1:** Inventory and governance. Adopt the OneLake catalog, assign owners, pilot workspace monitoring and surge protection in non-production, and check the Fabric what's new page monthly.
2. **Q1 to Q2:** Move one streaming workload onto Real-Time Intelligence now that it's GA, and replace one hand-built CDC process with Azure SQL Database mirroring.
3. **Q2:** Pilot SQL database in Fabric and AI skill on low-risk data, after billing has started, so the capacity-consumption numbers are real.
4. **Through the year:** Revisit Copilot when the capacity requirements change, rather than buying F64 just for it.

The [Fabric Roadmap](https://aka.ms/FabricRoadmap) is the right place to track what's planned, but treat its quarter estimates as intentions. Microsoft is clear that timelines can shift.

## The takeaway

Fabric in January 2025 is two platforms at once: a stable core (lakehouse, warehouse, pipelines, Power BI and now Real-Time Intelligence) and a fast-moving edge (Fabric Databases, AI skill, open mirroring, the new monitoring and capacity controls). Build production on the core. Pilot the edge on purpose, with a named owner and an exit plan. If you need context on how we got here, [the Fabric year in review](/blog/2024-12-18-fabric-year-review/) covers 2024.
