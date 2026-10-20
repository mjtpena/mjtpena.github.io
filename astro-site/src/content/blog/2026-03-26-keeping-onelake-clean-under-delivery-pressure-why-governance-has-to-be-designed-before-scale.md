---
title: "Keeping OneLake Clean: Design the Workspace Lifecycle Before Scale"
description: "How to stop Fabric workspace and item sprawl before it starts: lifecycle states, domains, tags, endorsement, retention settings and a weekly hygiene audit."
author: Michael John Peña
draft: false
date: 2026-03-26
tags:
  - Microsoft Fabric
  - OneLake
  - Governance
  - Data Engineering
---

OneLake rarely gets messy because of one bad decision. It gets messy because creating a workspace, a lakehouse or a "quick test" notebook costs nothing, and deleting one feels risky, so under delivery pressure everything gets created and nothing gets removed. A year in, it's easy to be running hundreds of workspaces with no clear owners, and then every governance exercise starts with an archaeology project.

My position: the cheapest point to govern a Fabric estate is the moment a workspace is born. If every workspace starts with an owner, a purpose, a lifecycle state and an end condition, cleaning up later is routine. If it doesn't, cleaning up later is a negotiation.

This is the third piece in a short series, after [OneLake table contracts](/blog/2026-03-04-keeping-onelake-clean-under-delivery-pressure-why-governance-has-to-be-designed-before-scale/) and [OneLake access boundaries](/blog/2026-03-15-keeping-onelake-clean-under-delivery-pressure-balancing-speed-and-access-boundaries/). This one covers the containers themselves: how workspaces and items are created, labelled and removed.

## Sprawl is a lifecycle problem, not a permissions problem

In an untidy tenant, the access model is usually reasonable; what's missing is any notion of *state*. A developer's scratch workspace from last year sits next to production finance, and nothing tells you which is which except a naming convention people followed for a month.

So before talking about tools, decide on a small set of lifecycle states that every workspace must be in. The ones I use:

| State | What it's for | Expected lifetime | Who can create it |
|---|---|---|---|
| Sandbox | Personal exploration, proofs of concept | Weeks | Anyone allowed to create workspaces |
| Feature | A Git branch under active development | Days to weeks | Developers, via branch-out |
| Shared dev / test | Integration and testing | Life of the product | Platform team |
| Production | Published data and reports | Life of the product | Platform team, through deployment |
| Retiring | Scheduled for deletion, members moved to Viewer | One retention cycle | Platform team |

The specific names don't matter. What matters is that "sandbox" and "feature" workspaces are *expected* to die, and that the estate has a way to see which state each workspace is in without reading its name.

## Put structure in the tenant, not in a naming convention

Naming conventions are worth having, but they're the weakest control in Fabric because nothing enforces them. There are three better places to record ownership and state, and they complement each other.

### Domains for ownership

Domains group workspaces by business area, with subdomains for finer splits. The useful part for hygiene is the role model: a domain admin, ideally a business owner, manages the workspaces in their domain, and domain contributors are workspace admins allowed to assign their own workspaces to it. You can also set a default domain for specific users or security groups, so new workspaces created by the finance engineering group land in Finance without anyone remembering to assign them.

A workspace with no domain is the first thing I'd flag. It usually means nobody outside the creator knows it exists.

### Tags for state and cost

[Tags](https://learn.microsoft.com/fabric/governance/tags-overview) are admin-defined labels, at tenant or domain level, that you apply to items and, since workspace tags reached general availability this month, to workspaces as well. The limits are generous: 10 tags per item, 10 per workspace (counted separately), and up to 10,000 unique tags per tenant. Only workspace admins can tag a workspace; anyone with Write or Contributor permission can tag items.

That makes tags the right home for the lifecycle state. I'd define a small, fixed set of tenant-level tags such as `env-sandbox`, `env-feature`, `env-dev`, `env-test`, `env-prod` and `retiring`, plus a cost-centre tag or two. Because tags are defined centrally, people pick from a list rather than inventing spellings, which is the main failure of naming conventions.

Two cautions. Tags can take several hours to show up in item lists and global search, so don't build a check that runs straight after tagging. And the workspace tag REST API (`applyTags` on a workspace) only reached the API reference this week and is marked preview, so tag workspaces through the UI or treat any automation around it as experimental. Applying tags to items through the Apply Tags API is the more established path.

### Endorsement for "this is the real one"

Tags say what state something is in; endorsement says whether consumers should trust it. Promoted is self-service, Certified requires an authorised reviewer (and certification reviewers can be delegated per domain), and Master data marks the authoritative source for things like customer or product lists. My rule: in a production workspace, anything consumers are meant to use is at least promoted, and anything that isn't endorsed is either internal plumbing or a candidate for removal.

## Make feature workspaces cheap to create and cheap to delete

The biggest source of junk I see is developers working directly in shared workspaces, then copying items into a new workspace "to try something", then never deleting it. Git integration solves this properly. With [branch-out](https://learn.microsoft.com/fabric/cicd/git-integration/manage-branches), a developer creates a new branch from the shared workspace's branch and Fabric creates (or reuses) a workspace connected to it. The option to select only some items when branching out is in preview, and it's worth trying on large workspaces because it shortens the time to a working copy.

The hygiene benefit is that the workspace becomes disposable: the work lives in the branch, so once the pull request merges, the workspace has no reason to exist. Tag it `env-feature` at creation and delete it on merge. To avoid creating workspaces at all, branch-out can instead target a fixed per-developer workspace and swap its connected branch; commit first, because anything not saved to Git can be lost in the switch.

Two things make this harder than it sounds. Not every item type supports Git integration, and several are still preview, so check the supported items list before promising a fully Git-driven workflow. And branch-out copies item definitions, not data, so a feature workspace's lakehouse starts without table data; any shortcuts committed in the source lakehouse definition come across, otherwise add shortcuts to shared data yourself.

## Decide your safety net before you start deleting

People hesitate to delete because they don't know what's recoverable. Fabric's [retention and recovery](https://learn.microsoft.com/fabric/admin/retention-recovery) settings answer that, and it's worth setting them deliberately rather than leaving the defaults:

- **Collaborative workspaces** go into a retention period when deleted, seven days by default and configurable from 7 to 90 days in the tenant settings. A Fabric admin can restore them during that window.
- **My workspaces** have a fixed 30-day retention period.
- **Individual items** can be soft-deleted and recovered, but this is a preview capability, turned off by default, and only covers supported item types. When enabled, its retention period is also 7 to 90 days.
- **OneLake data** from a permanently deleted item is kept for an additional seven days, which is a last resort rather than a plan.

I'd set workspace retention to something like 30 days and say so publicly: "deleted workspaces can be restored for a month" turns cleanup into a reversible act. Pair it with a `retiring` tag: move everyone except the platform team to the Viewer role, tag it, wait a cycle for anyone to object, then delete.

Keep an eye on the hard limit too. A workspace can hold a maximum of 1,000 Fabric and Power BI items, parent and child items included, as the [Fabric workspace management documentation](https://learn.microsoft.com/fabric/admin/portal-workspaces) states. Shared dev workspaces that collect every experiment get there faster than you'd think. The audit below warns at 900; List Items may not count child items, so treat that as an early warning, not exact headroom.

## Watch for drift every week

Structure decays: a sandbox outlives its project, a production lakehouse never gets a description. Two tools catch most of it.

The first is the Govern tab in the [OneLake catalog](https://learn.microsoft.com/fabric/governance/onelake-catalog-govern). As of March 2026 its admin view is generally available, while the data-owner view is still in preview. Fabric admins see tenant-wide insights with recommended actions; data owners get a simplified report covering only the items they own, refreshed each time they open the tab. The admin view is built on admin monitoring data that refreshes once a day and doesn't cover subitems such as tables, and the Govern tab as a whole isn't available when Private Link is enabled, so it complements an audit rather than replacing one.

The second is a small script against the Fabric REST API that checks *your* rules, which the Govern tab can't know. This one lists every workspace the caller can see and flags the ones with no domain or no lifecycle tag, plus production items with no description. It uses `azure-identity` and `requests`, and if it's a service principal, a Fabric admin must allow service principals to use Fabric APIs and the principal needs at least Viewer on each workspace:

```python
"""Weekly Fabric hygiene check: domains, lifecycle tags and item descriptions."""
import time

import requests
from azure.identity import DefaultAzureCredential

FABRIC_API = "https://api.fabric.microsoft.com/v1"
LIFECYCLE_TAGS = {"env-sandbox", "env-feature", "env-dev", "env-test", "env-prod", "retiring"}
ITEM_LIMIT_WARNING = 900  # cap is 1,000 incl. child items; List Items may not count those


FABRIC_SCOPE = "https://api.fabric.microsoft.com/.default"
MAX_RETRIES = 5

credential = DefaultAzureCredential()
_token = None


def get_headers() -> dict:
    """Return auth headers, refreshing the token when it's within 5 minutes of expiry."""
    global _token
    if _token is None or _token.expires_on - time.time() < 300:
        _token = credential.get_token(FABRIC_SCOPE)
    return {"Authorization": f"Bearer {_token.token}"}


def get_all(url: str) -> list:
    results = []
    attempts = 0
    while url:
        response = requests.get(url, headers=get_headers(), timeout=30)
        if response.status_code == 429:  # throttled: wait as instructed, then retry
            attempts += 1
            if attempts > MAX_RETRIES:
                # Give up: after MAX_RETRIES consecutive 429s on one page, the run stops here.
                response.raise_for_status()
            try:
                wait = int(response.headers.get("Retry-After", 30))
            except ValueError:  # Retry-After can also be an HTTP-date
                wait = 30
            time.sleep(wait)
            continue
        response.raise_for_status()
        attempts = 0  # reset after each successful page
        body = response.json()
        results.extend(body.get("value", []))
        url = body.get("continuationUri")
    return results


def main() -> None:
    for ws in get_all(f"{FABRIC_API}/workspaces"):
        if ws.get("type") != "Workspace":
            continue  # skip My workspaces and the admin monitoring workspace
        name = ws["displayName"]
        tag_names = {t["displayName"] for t in ws.get("tags", [])}
        lifecycle = tag_names & LIFECYCLE_TAGS

        if not ws.get("domainId"):
            print(f"[no-domain]    {name}")
        if not lifecycle:
            print(f"[no-lifecycle] {name}")

        items = get_all(f"{FABRIC_API}/workspaces/{ws['id']}/items")
        if len(items) >= ITEM_LIMIT_WARNING:
            print(f"[near-limit]   {name}: {len(items)} items")
        if "env-prod" in lifecycle:
            for item in items:
                if not (item.get("description") or "").strip():
                    print(f"[no-desc]      {name} / {item['displayName']} ({item['type']})")


if __name__ == "__main__":
    main()
```

Run it on a schedule and send the output to a channel the platform team actually reads. Because it calls List Items once per workspace, a large tenant will hit Fabric API throttling, so `get_all` waits for the `Retry-After` interval on an HTTP 429 and retries up to five times per page before stopping the run, and `get_headers` refreshes the token before it expires so a long run doesn't hit a 401. Workspace tags are new to the API, so if `tags` comes back empty for workspaces you know are tagged, treat the lifecycle check as advisory for now. For tenant-wide inventory beyond what one identity can see, the admin and scanner APIs are the next step.

## When this is too much

A single team with three workspaces, or a time-boxed proof of concept that will be deleted wholesale, doesn't need lifecycle tags, a retirement process or a weekly audit; a naming convention and a calendar reminder will do.

The structure earns its keep once more than one team creates workspaces, once developers start branching out, or once anyone outside the platform team has workspace-creation rights. My rule of thumb is that it arrives early, usually as soon as a second team gets workspace-creation rights, and retrofitting tags and domains onto 300 unlabelled workspaces is far more painful than applying them to the first 20.

## Where I'd start this week

Pick your lifecycle tags (the six above, or your own equivalents) and have a Fabric admin define them as tenant-level tags. Create domains for your two or three biggest business areas and set default domains for the groups that create workspaces. Set workspace retention to a period you're comfortable announcing. Then run the audit once, fix what it finds, and schedule it. None of that slows delivery, and it makes the next cleanup a list of deletions rather than an investigation.
