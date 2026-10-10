---
title: "Findable by Design: Workspace Choices That Shape the OneLake Catalog"
description: "How workspace splits, item names, descriptions, endorsement and domains decide what people find in the OneLake catalog, plus a findability test you can script."
author: Michael John Peña
draft: false
date: 2026-05-09
tags:
  - Microsoft Fabric
  - OneLake
  - Governance
  - Architecture
---

When an analyst can't find the table they need in Fabric, they don't file a ticket. They build their own copy, and six months later you have three "customer" lakehouses with three different answers. Discoverability is usually treated as a cataloguing project that happens after the platform exists. I think that's backwards: what people can find in OneLake is decided by workspace layout, item names and a few metadata fields, and all of those are cheapest to get right the day a workspace is created.

This post is about the consumer's side of the estate. The [workspace lifecycle post](/blog/2026-03-26-keeping-onelake-clean-under-delivery-pressure-why-governance-has-to-be-designed-before-scale/) covers ownership, lifecycle tags and cleanup. This one asks a narrower question: when someone opens the OneLake catalog and types a word, do they land on the right item?

## Design for the list people actually see

Start with what the [OneLake catalog's Explore tab](https://learn.microsoft.com/fabric/governance/onelake-catalog-explore) shows, because that's the interface your design has to work in. The items list shows each item's name, type, owner, last refresh, workspace, endorsement and sensitivity label. You narrow it with a domain selector, an item type selector, a tag selector if tags are enabled, a workspace filter and predefined filters for *My items*, *Endorsed items* and *Favorites*.

Two things follow from that.

First, the **description isn't a column**. It appears in the item details pane, under the item name, once someone has already clicked. In the list itself, people choose between items based on the name, the workspace name and the endorsement badge. If those three don't distinguish your curated customer table from an engineer's scratch copy, the description won't rescue you.

Second, the list shows **every item the user has access to**, plus discoverable semantic models they can request access to (covered below). Domains help people scope the view, but domain assignment doesn't change visibility or access; workspace roles and item permissions do. So the most effective discoverability control is the one most people don't think of as a discoverability control at all: who has a role in which workspace.

## Split workspaces by audience, not only by layer

The usual Fabric layout splits workspaces by medallion layer or by pipeline stage. That's a sensible engineering boundary, and I still draw [the line between ingestion and curation at the landing table](/blog/2026-04-16-fabric-architecture-notes-where-i-separate-ingestion-from-curation/). But if analysts get Viewer on every one of those workspaces "so they can see everything", their catalog fills up with staging lakehouses, notebooks and pipelines that they should never build on.

My preference is a second axis: **who is this workspace for?** I keep three kinds.

| Workspace kind | Who has a role | What lives there | Endorsement |
|---|---|---|---|
| Engineering | Platform and domain engineers | Ingestion, staging, notebooks, pipelines | None |
| Product | Engineers write; consumers read | The curated lakehouses, warehouses and semantic models consumers should use | Promoted at minimum, certified where reviewed |
| Team or sandbox | One team | Reports and experiments built on product items | Optional |

Consumers get access to product workspaces and nothing upstream. Their catalog then lists a small number of items that are meant to be used, plus their own team's work. Engineers still see everything, because they need to.

The product workspace doesn't have to duplicate data. It can expose curated tables from engineering workspaces through shortcuts, which keeps one physical copy while giving consumers a clean front door. That turns shortcuts into cross-team dependencies, so [inventory them](/blog/2026-04-06-onelake-shortcuts-in-practice-why-governance-has-to-be-designed-before-scale/) rather than letting them accumulate.

One catch: OneLake authorises shortcut reads with the caller's identity, so consumers reading through Spark, the OneLake APIs or Direct Lake on OneLake also need read access on the target item. If upstream access is off the table, serve them through the SQL analytics endpoint in delegated identity mode, or materialise the table in the product workspace. Granting consumers read on upstream items partly undoes the audience split, so if they genuinely need Spark or Direct Lake on OneLake, I'd usually materialise into the product workspace and accept the extra copy.

The trade-off is more workspaces, more role assignments and one more hop when you trace lineage. It pays off once consumers outnumber producers.

## Names that survive a list view

Because the list shows the workspace next to the item, don't repeat in the item name what the workspace name already says. I'd encode environment and domain in the **workspace** name (`Sales - Product - Prod`) and keep item names about the business entity (`Customer`, `Daily Store Sales`), not the technology (`lh_cust_v2_final`).

A few rules I'd apply to anything in a product workspace:

- Name for the question, not the source system. People search for "customer", not "dynamics_account_extract".
- No version suffixes. If there's a v2, the v1 should be retiring, not sitting next to it.
- Use the same noun across the estate. If the semantic model says "Store", the lakehouse shouldn't say "Branch".
- Keep technical prefixes in engineering workspaces, where they help the people who read them.

Fabric enforces none of this, so it belongs in the product workspace's definition of done, not a wiki page.

## Treat descriptions as the search index

The description matters more than it looks, because it's searchable. The [Catalog Search REST API](https://learn.microsoft.com/rest/api/fabric/core/catalog/search), in preview since the March 2026 feature drop, matches free text against an entry's display name, its workspace's display name and its description. An item with an empty description can only be found by someone who already knows what it's called.

A description that works in practice answers four things in two or three sentences: what the item contains, at what grain, how fresh it is, and what it's not for. For example: "One row per customer per day, from the CRM and billing systems. Refreshed daily by 6am AEST. Use for churn and retention analysis; not for invoicing."

The catalog can also generate an AI auto-summary for semantic models, currently in preview and dependent on Copilot capacity. It describes structure, not intent: it can't say which of two similar models is authoritative, so it doesn't replace a written description.

## Endorsement is a filter, not decoration

[Endorsement](https://learn.microsoft.com/fabric/governance/endorsement-overview) has three levels. Anyone with write permission can promote an item; certification and the Master data badge are applied by people a Fabric admin authorises, and certification reviewers can be delegated per domain. The *Endorsed items* filter in the Explore tab narrows the list to endorsed items you're allowed to find.

That makes endorsement the cheapest way to give consumers a short list. My rules: everything in a product workspace is at least promoted, certification means a named reviewer checked it against an agreed standard, and Master data is reserved for the one authoritative source of things like customer or product lists. If two items carry Master data for the same entity, the badge has stopped meaning anything.

One more lever is specific to semantic models. A promoted or certified semantic model can be made [discoverable](https://learn.microsoft.com/power-bi/collaborate-share/service-discovery), which lists it in the catalog for people who don't have access yet. They see its metadata and can request access (the owner decides whether to grant Read or Build), but can't see the data. This depends on the *Discover content* and *Make promoted content discoverable* or *Make certified content discoverable* tenant settings, so check them with your Fabric admin first. That's a good fit for models people should find before they ask for access. It's a poor fit where the model's name or description itself is sensitive, because discoverability shows exactly that metadata to a wider audience.

## Domains and tags narrow the view

Assigning product workspaces to the right domain gives each business area its own view of the catalog. The domain selector scopes the whole Explore tab to one domain or subdomain, and the selection persists between sessions. Tags add a second filter, shown as a selector at the top of the list (a newly applied tag can take several hours to show up).

My rule for domains is to assign product workspaces to business domains (Sales, Finance, Operations) and park engineering workspaces in a separate platform domain. A workspace belongs to one domain, so this keeps the Sales view consumer-only: an analyst who picks Sales sees the curated items, not the staging lakehouses behind them. Tags beat domains for concerns that cut across business areas, such as `PII` or `Finance-reviewed`, where an item needs a second label without moving its workspace. If you find yourself wanting a domain per data sensitivity or review status, that's a tag.

## Measure findability, not just coverage

The [Govern tab](https://learn.microsoft.com/fabric/governance/onelake-catalog-govern) in the OneLake catalog reports description and endorsement coverage in its *Discover, trust, and reuse* section (under *View more* in the admin report; data owners get a simplified view of their own items). The Govern tab's admin experience went GA in March 2026; its admin insights refresh once a day, and it isn't available when Private Link is enabled. Coverage is a lagging indicator: a description that exists isn't necessarily one that helps.

So I'd also test findability directly. Collect the phrases people actually type, map each to the item they should land on, and run them through the Catalog Search API. Results are filtered to what the caller can see, so run it as an identity with consumer-level access, not as an admin; a test service principal holding only consumers' workspace roles is the cleanest option (auth details are in the code comments). Tags and endorsement don't feed the text match, so the test measures names and descriptions, which is what people type against.

```python
"""Findability test: do consumers' search phrases land on the intended Fabric item?"""
import os
import time

import requests
from azure.identity import ClientSecretCredential

SEARCH_URL = "https://api.fabric.microsoft.com/v1/catalog/search"
FABRIC_SCOPE = "https://api.fabric.microsoft.com/.default"
PAGE_SIZE = 100
MAX_PAGES = 5
MAX_RETRIES = 5
RETRYABLE = {429, 502, 503, 504}

# A dedicated test service principal with consumer-only workspace roles. It needs the
# "Service principals can call Fabric public APIs" tenant setting; delegated user
# tokens would need the Catalog.Read.All scope instead.
# Don't use DefaultAzureCredential on a laptop: it resolves to your own login,
# which usually sees far more than a consumer does.
TENANT_ID = "<your-tenant-id>"
CLIENT_ID = "<consumer-test-app-client-id>"
# Inject the secret at runtime from your secret store; never paste it into source.
CLIENT_SECRET = os.environ["FABRIC_TEST_CLIENT_SECRET"]

# Phrases people really use, mapped to the item ID they should find.
# Keep expectations to item types the catalog lists; check the Catalog Search reference for current coverage.
EXPECTATIONS = {
    "customer churn": "<expected-item-id-1>",
    "daily store sales": "<expected-item-id-2>",
    "product master": "<expected-item-id-3>",
}


def post(session: requests.Session, credential: ClientSecretCredential, body: dict) -> dict:
    for attempt in range(MAX_RETRIES):
        # azure-identity caches the token and renews it near expiry, so a long run
        # with back-off never sends an expired bearer token.
        token = credential.get_token(FABRIC_SCOPE).token
        headers = {"Authorization": f"Bearer {token}"}
        response = session.post(SEARCH_URL, json=body, headers=headers, timeout=30)
        if response.status_code in RETRYABLE:
            try:
                wait = int(response.headers.get("Retry-After", 2 ** (attempt + 2)))
            except ValueError:
                wait = 2 ** (attempt + 2)
            time.sleep(wait)
            continue
        response.raise_for_status()
        return response.json()
    raise RuntimeError(f"Gave up after {MAX_RETRIES} throttled or transient failures")


def search_all(
    session: requests.Session, credential: ClientSecretCredential, text: str
) -> tuple[list, bool]:
    """Return entries across up to MAX_PAGES pages, and whether more remained."""
    entries = []
    body = {"search": text, "pageSize": PAGE_SIZE}
    for _ in range(MAX_PAGES):
        result = post(session, credential, body)
        entries.extend(result.get("value", []))
        token = result.get("continuationToken")
        if not token:
            return entries, False
        # Request the next page of the same search by passing the continuation token.
        body = {"continuationToken": token}
    return entries, True


def main() -> None:
    credential = ClientSecretCredential(TENANT_ID, CLIENT_ID, CLIENT_SECRET)
    session = requests.Session()

    for phrase, expected_id in EXPECTATIONS.items():
        entries, truncated = search_all(session, credential, phrase)
        found = any(entry["id"] == expected_id for entry in entries)
        more = "+" if truncated else ""
        status = "FOUND " if found else "MISSING"
        print(f"[{status}] '{phrase}': {len(entries)}{more} matches")

        # Competing matches are where duplicates and unclear names show up.
        for entry in entries:
            if entry["id"] == expected_id:
                continue
            # Only item entries are compared; other entry kinds may be added over time.
            if entry.get("catalogEntryType") != "FabricItem":
                continue
            workspace = entry.get("hierarchy", {}).get("workspace", {}).get("displayName", "?")
            print(f"    also: {entry['displayName']} ({entry.get('type')}) in {workspace}")


if __name__ == "__main__":
    main()
```

The script walks the continuation pages (up to a cap) before calling anything missing, because rank order isn't documented. The two signals I care about are whether the intended item appears at all, and what else comes back with it. A "MISSING" usually means a name or description that uses different words from the people searching. A long list of competing matches usually means duplicates, or consumers with roles in workspaces they don't need. Treat it as a non-critical check, not a release gate.

## When this is overkill

If one team builds and consumes its own data, everyone already knows where things are, and a separate product workspace adds role management for no gain. The design here earns its keep when the people consuming data don't sit with the people producing it, which in most organisations happens sooner than the platform team expects.

## What I'd change on the next workspace

Before creating it, decide whether it's an engineering or a product workspace, and give consumers roles only on product workspaces. Name the workspace for its domain and environment, and the items for business entities. Make a description and at least a Promoted badge part of done for anything consumers will use. Then write down five phrases a new analyst would search for and check they land where you expect. It's a small, one-off cost, and much cheaper than reconciling three customer tables later.
