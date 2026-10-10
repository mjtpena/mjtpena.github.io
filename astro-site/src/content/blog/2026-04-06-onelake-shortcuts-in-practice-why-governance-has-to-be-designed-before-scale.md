---
title: "OneLake Shortcuts Are Dependencies: Inventory Them Before Scale"
description: "Treat every OneLake shortcut as a cross-team dependency: placement, identity, write paths, environment variables and a REST inventory of what points where."
author: Michael John Peña
draft: false
date: 2026-04-06
tags:
  - Microsoft Fabric
  - OneLake
  - Governance
  - Data Engineering
---

A OneLake shortcut takes thirty seconds and no storage to create, so teams create them freely. Each one is still a dependency between two owners: the team that publishes the target and the team that reads through the pointer. At a few hundred, spread across workspaces, nobody can say what breaks when a producer renames a folder, so the rules have to exist before the hundredth shortcut.

The mechanics are in my [2023 post](/blog/2023-06-03-onelake-shortcuts/) and access boundaries in [keeping OneLake clean](/blog/2026-03-15-keeping-onelake-clean-under-delivery-pressure-balancing-speed-and-access-boundaries/). What's missing is the dependency side: the decisions to make up front and an inventory that keeps them honest.

## Why shortcuts fail quietly

The [OneLake shortcuts documentation](https://learn.microsoft.com/fabric/onelake/onelake-shortcuts) is clear on behaviour, and each of these points becomes a governance question once shortcuts cross team boundaries:

- **Shortcuts behave like symbolic links.** If you move, rename or delete the target path, the shortcut can break. The producer gets no warning that someone downstream depended on that path.
- **Deleting through a shortcut deletes the target.** Deleting the shortcut itself leaves the target untouched. Deleting a file or folder *inside* the shortcut deletes it in the target, if the caller has write permission there. A clean-up script pointed at the wrong level can remove a producer's data.
- **Lineage only goes so far.** The workspace lineage view shows shortcut relationships, but it's scoped to a single workspace, and lineage for shortcuts to warehouses and semantic models isn't available. Cross-workspace shortcuts, the ones that matter most for governance, are exactly the ones the lineage view can't show.
- **Chains are allowed.** A shortcut can point at another shortcut, up to a limit of five direct shortcut-to-shortcut links. Every hop adds another owner who can break the path.

None of these are bugs. They are the price of a pointer instead of a copy, worth paying if someone owns each dependency.

## Four decisions to make before scale

### 1. Who owns the shortcut, and where it lives

My rule is that **consumers own shortcuts and producers own targets**. A shortcut lives in the consuming team's workspace, in a lakehouse that team owns, and the producer doesn't have to know the consumer's internals. That gives every edge a clear owner to call.

Placement also matters inside a lakehouse. In the **Tables** folder you can only create shortcuts at the top level, they can point to a single Delta table or a schema folder, and the lakehouse registers Delta targets as tables automatically. In **Files** there are no placement restrictions and no table discovery. I use that split as a policy:

| Location | What may go there | Why |
|---|---|---|
| `Tables` | Shortcuts to curated Delta tables or schemas published by another team (schema shortcuts require a schema-enabled lakehouse) | Readable from Spark, the SQL analytics endpoint and Direct Lake with no extra work |
| `Files` | Raw external sources (ADLS Gen2, S3, GCS, SharePoint) that still need processing | No table semantics implied; the consumer owns turning it into a table |
| Neither | Shortcuts to another team's bronze or staging areas | Those paths aren't a contract and will move |

The last row is the important one. If a path isn't published as a product, nobody should be pointing at it. That ties straight back to the [table contracts](/blog/2026-03-04-keeping-onelake-clean-under-delivery-pressure-why-governance-has-to-be-designed-before-scale/) idea: a shortcut is only as stable as the contract on its target.

### 2. Which identity the shortcut uses

The [shortcut security model](https://learn.microsoft.com/fabric/onelake/onelake-shortcut-security) has two modes, and the choice decides who controls access:

- **OneLake-to-OneLake shortcuts are passthrough.** OneLake authorises the calling user against the target, so the producer keeps control. You can't loosen access from the downstream item.
- **External shortcuts are delegated.** ADLS, S3, GCS and the other external types reach the source through a cloud connection, so whoever can read the shortcut reads with that connection's credential.

One exception catches people out: Power BI semantic models using Direct Lake over SQL, and T-SQL in delegated identity mode, reach the target with the *item owner's* identity rather than the caller's. If your access design assumes passthrough everywhere, check which engines your consumers actually use.

For delegated shortcuts, the connection is the real governance object. Binding a connection to a shortcut needs permission on the connection, and when its owner leaves the organisation, every shortcut that uses it is at risk. Lakehouse settings has a **Shortcut connections** page that shows broken connections and lets you replace a connection across every shortcut that uses it. I'd rather never need it: create connections with a service principal or workspace identity instead of a person's account. [Microsoft Entra service principal support for Amazon S3 shortcuts](https://learn.microsoft.com/fabric/onelake/amazon-storage-shortcut-entra-integration), in preview since July 2025, became generally available in March 2026, which removes the main reason to keep long-lived AWS access keys on new Amazon S3 shortcuts. It supports service principals only, not workspace identity or OAuth, and S3-compatible and GCS shortcuts still need access keys.

### 3. Whether anyone can write through it

Effective permission through a shortcut is the more restrictive of the shortcut path and the target path. A consumer with Contributor on their own workspace and only read on the target can't write through the shortcut, which is what you want. The risk is the reverse: an engineer who happens to have write access on both sides can delete producer data from a consumer lakehouse.

My default is that **shortcuts are read-only by convention and by permission**. Producers grant consumers read access on published targets, not workspace roles that carry write. If a consumer needs to land data, they land it in their own item and the producer pulls it in. Two-way shortcuts make sense in a few places, but I want each one to be a deliberate exception that's written down.

### 4. How shortcuts move between environments

A shortcut that points at the production lakehouse from a dev workspace is a quiet way to leak production data into development. You can assign variables from a variable library to shortcut properties such as the target location or connection ID, so the same shortcut resolves to test data in test and production data in production after a deployment. Assignment is done through the **Manage shortcut** experience; the docs note that REST API assignment isn't supported. Variable libraries have been generally available since September 2025, lakehouse shortcuts are one of their supported items, and as of April 2026 the shortcut integration carries no preview label. I'd make variables mandatory for any shortcut in a workspace that's part of a deployment pipeline or Git-connected flow.

## Build an inventory, not a wiki page

Rules only hold if you can see drift. The [OneLake shortcuts REST API](https://learn.microsoft.com/rest/api/fabric/core/onelake-shortcuts/list-shortcuts) lists every shortcut in an item, including subfolders. It requires the `OneLake.Read.All` (or `OneLake.ReadWrite.All`) delegated scope for users, and also supports service principals and managed identities. Combined with List Items, that's enough to build a cross-workspace edge list for every workspace your identity can see. Admin APIs can enumerate every workspace and lakehouse in the tenant, but there is no admin shortcuts endpoint, so a tenant-wide inventory still needs the identity added to each workspace.

This script uses `azure-identity` and `requests`. Viewer is enough for List Items; List Shortcuts also needs read access to the item's OneLake data (ReadAll, Contributor or higher, or a OneLake security role that grants Read). Anything less shows up as an inaccessible row. If you use a service principal, the Fabric admin setting that allows service principals to call Fabric APIs must be enabled for it, and it must be added to each workspace (Viewer or higher).

```python
import csv
import time
from collections import Counter

import requests
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

API = "https://api.fabric.microsoft.com/v1"
SCOPE = "https://api.fabric.microsoft.com/.default"
ITEM_TYPES = ("Lakehouse", "KQLDatabase")  # item types that can hold shortcuts

credential = DefaultAzureCredential()
# Caches the token and refreshes it before expiry, whatever the credential type
token_provider = get_bearer_token_provider(credential, SCOPE)
session = requests.Session()


def get(url, params=None, max_attempts=5):
    """GET with a cached bearer token and back-off on HTTP 429."""
    for _ in range(max_attempts):
        response = session.get(
            url,
            params=params,
            headers={"Authorization": f"Bearer {token_provider()}"},
            timeout=60,
        )
        if response.status_code == 429:
            time.sleep(int(response.headers.get("Retry-After", 30)))
            continue
        response.raise_for_status()
        return response.json()
    raise RuntimeError(f"Still throttled after {max_attempts} attempts: {url}")


def paged(url, params=None):
    """Yield every element across Fabric's continuationUri pages."""
    while url:
        body = get(url, params)
        yield from body.get("value", [])
        url, params = body.get("continuationUri"), None


EMPTY_ROW = {
    "target_type": "",
    "target_workspace_id": "",
    "target_item_id": "",
    "target_location": "",
    "target_path": "",
    "target_key": "",
    "connection_id": "",
    "cross_workspace": False,
    "target_visible": False,
}


def inaccessible(workspace_name, item_name, error):
    """Record a workspace or item the identity can't read instead of stopping."""
    return {
        "workspace": workspace_name,
        "item": item_name,
        "shortcut": "",
        **EMPTY_ROW,
        "target_type": f"inaccessible ({error.response.status_code})",
    }


def shortcut_row(workspace, item, shortcut):
    target = shortcut["target"]
    detail_key = target["type"][0].lower() + target["type"][1:]
    detail = target.get(detail_key, {})  # empty for a type this code doesn't know
    target_workspace_id = detail.get("workspaceId", "")
    target_item_id = detail.get("itemId", "")
    target_location = detail.get("location") or detail.get("environmentDomain", "")
    target_path = detail.get("path") or detail.get("subpath", "")
    if target_item_id:  # OneLake target: workspace + item + path
        target_key = f"{target_workspace_id}/{target_item_id}/{target_path}"
    else:  # external: location, bucket, subpath or table; else connection
        parts = [
            target_location,
            detail.get("bucket", ""),
            target_path or detail.get("tableName", ""),
        ]
        target_key = "/".join(filter(None, parts)) or detail.get("connectionId", "")
    return {
        "workspace": workspace["displayName"],
        "item": item["displayName"],
        "shortcut": f"{shortcut['path']}/{shortcut['name']}",
        "target_type": target["type"],
        "target_workspace_id": target_workspace_id,
        "target_item_id": target_item_id,
        "target_location": target_location,
        "target_path": target_path,
        "target_key": target_key if detail else "",
        "connection_id": detail.get("connectionId", ""),
        "cross_workspace": bool(target_workspace_id)
        and target_workspace_id != workspace["id"],
        "target_visible": bool(detail),
    }


rows = []
for workspace in paged(f"{API}/workspaces"):
    items_url = f"{API}/workspaces/{workspace['id']}/items"
    try:
        # One List Items call per workspace, filtered locally
        items = [item for item in paged(items_url) if item["type"] in ITEM_TYPES]
    except requests.HTTPError as error:  # workspace deleted or access removed mid-run
        rows.append(inaccessible(workspace["displayName"], "", error))
        continue
    for item in items:
        try:
            for shortcut in paged(f"{items_url}/{item['id']}/shortcuts"):
                rows.append(shortcut_row(workspace, item, shortcut))
        except requests.HTTPError as error:  # 403 without OneLake read, 404 if deleted
            rows.append(inaccessible(workspace["displayName"], item["displayName"], error))

with open("shortcut_inventory.csv", "w", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=list(rows[0]) if rows else ["workspace"])
    writer.writeheader()
    writer.writerows(rows)

print(f"{len(rows)} rows written to shortcut_inventory.csv")
inbound = Counter(row["target_key"] for row in rows if row["target_key"])
for target_key, count in inbound.most_common(10):
    print(f"{count:4d}  {target_key}")
```

A few details are worth knowing:

- **`detail_key`:** the response's target object carries the type plus a property named after it (`oneLake`, `adlsGen2`, `amazonS3` and so on), and that line maps one to the other.
- **`target_key`:** OneLake targets are grouped by workspace, item and path, so `Tables/sales` in two lakehouses stays two targets. External targets are grouped by location (or Dataverse environment), bucket where the type has a separate one, and subpath or table name, falling back to the connection ID for types such as external data shares that carry no location.
- **Tokens and throttling:** `get_bearer_token_provider` caches the token and refreshes it before expiry, which matters when a credential in the `DefaultAzureCredential` chain, such as the Azure CLI one, is slow to call. Throttled calls honour the `Retry-After` header, and a workspace or item that returns 403 or 404 is recorded as `inaccessible` instead of stopping the run. List Items runs once per workspace and is filtered locally to save calls.
- **`target_visible`:** the defensive `.get` keeps the script running if the API returns a target type it doesn't recognise, such as one added after the code was written. `False` means the script needs updating, not that the shortcut is broken.

With the CSV in hand, I'd review three questions every month:

1. **Which targets have the most inbound shortcuts?** Those are your de facto data products. If they aren't endorsed and contracted, fix that first.
2. **Which cross-workspace shortcuts point at paths that aren't published products?** Those are the edges that break on the next refactor.
3. **Which connection IDs back the most shortcuts?** Check that each one runs as a service principal or workspace identity, not a person.

## Cost and network guardrails

Two more settings belong in the up-front design rather than a later review. Shortcut caching, set per workspace on the OneLake tab of workspace settings, keeps files read through GCS, S3, S3-compatible and on-premises gateway shortcuts for a retention period of 1 to 28 days, which cuts repeat cross-cloud egress. Files over 1 GB are never cached, so it won't help with very large Parquet files. And [Workspace Outbound Access Protection](https://learn.microsoft.com/fabric/onelake/onelake-manage-outbound-access), which has been in preview for OneLake since the second half of 2025 and gained data connection rules for shortcuts in January 2026, blocks outbound shortcuts to other workspaces and external storage by default, and workspace admins allow-list approved destinations with data connection rules or managed private endpoints. For workspaces that hold sensitive data, I'd rather decide where shortcuts may point than find out from the inventory.

## When this is too much

If one team owns a single workspace and a handful of shortcuts, the lineage view and a naming convention are enough. The inventory starts to pay off once shortcuts cross workspace or team boundaries, or once external connections appear, because that's where the owner of the pointer and the owner of the data are different people.

## The rule I'd adopt this week

Every shortcut gets a consumer owner, a published target, a non-personal identity and, if it crosses environments, a variable. Then run the inventory and check it against those rules. Shortcuts are still the best way to share data in Fabric without copying it. Just don't confuse "no copy" with "no dependency".
