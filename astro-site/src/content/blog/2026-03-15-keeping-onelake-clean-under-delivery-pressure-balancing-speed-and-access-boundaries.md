---
title: "Fast Access Without Eroding OneLake Boundaries in Fabric"
description: "Why adding people as Fabric workspace Contributors is the access shortcut that erodes OneLake boundaries, and a faster pattern that keeps them intact."
author: Michael John Peña
draft: false
date: 2026-03-15
tags:
  - Microsoft Fabric
  - OneLake
  - Governance
  - Security
---

The quickest way to unblock someone in Microsoft Fabric is to add them to the workspace as a Contributor: it takes ten seconds and the ticket closes. It also gives that person read and write access to every lakehouse, warehouse and file in the workspace, and in my experience it's the most common way OneLake boundaries erode on a delivery project. The fix is to make the safe path the fast path: decide the boundaries once, in the workspace layout, so that granting access later is a routine change rather than a judgement call.

## Know what each lever actually grants

Fabric gives you four levers for access control over OneLake data: workspace roles, item permissions, SQL permissions and OneLake security. They don't overlap the way people assume.

| Lever | What it grants | Status (March 2026) |
|---|---|---|
| Workspace role: Admin, Member, Contributor | Read and write to all OneLake data in every item in the workspace | GA |
| Workspace role: Viewer | Can see items and query SQL endpoints, but no direct OneLake file access | GA |
| Item sharing: Read, ReadData, ReadAll | Per item: connect, query through the SQL analytics endpoint, or read through Spark and OneLake APIs | GA |
| SQL `GRANT`/`DENY`, row-level and column-level security | Object-level rules on the SQL analytics endpoint or warehouse | GA |
| OneLake security roles | Table and folder access, plus row and column rules, enforced in OneLake itself | Public preview |

Two details in that table drive most of the design.

First, the three higher workspace roles sit above everything else. Microsoft's [workspace roles documentation](https://learn.microsoft.com/fabric/fundamentals/roles-workspaces) is explicit that Admin, Member and Contributor can read and write all data in the workspace. Contributors and above hold CONTROL on the SQL endpoint, so they can remove any `DENY` or security policy, and they can read the files through Spark or OneLake anyway; OneLake security roles don't apply to them at all. If you want a boundary to hold for someone, they can't be a Contributor in that workspace.

Second, SQL permissions only cover the SQL path. If you share a lakehouse with someone and grant the ReadAll permission ("Read all with Apache Spark", which in the lakehouse sharing dialog also covers subscribing to OneLake events), they can read the Delta files directly through Spark or the OneLake APIs, which bypasses any `GRANT` or row-level security you wrote in T-SQL. The [lakehouse sharing documentation](https://learn.microsoft.com/fabric/data-engineering/lakehouse-sharing) describes these permissions, but it's easy to miss what that means in practice: a SQL-only security model plus ReadAll is no security model at all for the tables in that lakehouse.

## Draw the boundary with workspaces, not with permissions

My rule of thumb is that the workspace is the only boundary you can trust without reading the fine print, so I use it as the primary one. On most estates that means at least two workspaces per domain:

- **An engineering workspace** that holds raw and conformed lakehouses, notebooks, pipelines and environments. Only the people and service principals who build the pipelines get Contributor or above here.
- **A consumption workspace** that holds the published layer: a lakehouse or warehouse with the curated tables, semantic models and reports. Consumers are Viewers here, or have item-level access only.

The published tables reach the consumption workspace either through a pipeline or notebook that writes them there, or through OneLake shortcuts pointing back at the engineering lakehouse. Shortcuts avoid a copy, but remember that the shortcut doesn't change who governs the target data, so read access at the target still matters. Which identity is checked at the target depends on the engine: through the SQL analytics endpoint in its default (delegated) identity mode, a shortcut reads with the identity of the item's owner, while through Spark or the OneLake APIs it reads with the caller's own identity. So a consumer who can query a shortcut table in SQL may get nothing from the same table in a notebook, and an owner who leaves the organisation can break the SQL path for everyone. I covered the basics in [OneLake shortcuts](/blog/2023-06-03-onelake-shortcuts/).

This layout is what makes speed possible later. When an analyst asks for access, the answer is always the same: Viewer in the consumption workspace. Viewer implies ReadData on every SQL analytics endpoint and warehouse in that workspace, so if some consumers must not see some tables, either put those tables in a separate consumption workspace or share items with Read only instead of granting Viewer. When a new engineer joins, the answer is always the same: Contributor in engineering, via a group. Nobody has to decide anything on the day.

The [table contracts post](/blog/2026-03-04-keeping-onelake-clean-under-delivery-pressure-why-governance-has-to-be-designed-before-scale/) from earlier this month covers the other half of this: schemas and contracts inside the published lakehouse. Workspace boundaries decide *who* can reach the data; contracts decide *what* they're allowed to depend on.

## Grant through groups, and grant the narrowest item permission

Two habits keep the consumption side clean.

Assign workspace roles and item permissions to Microsoft Entra security groups, never to individuals. Groups make the access reviewable outside Fabric, they let HR-driven joiner and leaver processes do the work, and a group counts as a single entry against the [limit of 1,000 users or groups in workspace roles](https://learn.microsoft.com/fabric/fundamentals/give-access-workspaces), however many members it has.

When you share an item, start with the narrowest permission that does the job:

- A report consumer needs Read on the report, and Build on the semantic model only if they build their own reports.
- An analyst who should see only some tables gets Read on the item (connect only), and you `GRANT` the schemas or tables they need. Give ReadData only when they should see everything, then use `DENY` or row-level security to narrow it.
- Only data scientists who genuinely need Spark access get ReadAll, and they get it on the published lakehouse, not on the engineering one.

The request that breaks this is usually "can I just have access to the lakehouse?" from someone who wants to run a notebook. The temptation is to make them a Contributor so they can create their notebook next to the data. A better answer is a notebook workspace, and ReadAll on the published lakehouse, optionally surfaced in their workspace through a shortcut. That doesn't mean one workspace per person, which is just sprawl by another route: I'd run one shared analyst sandbox workspace per domain, owned by the domain's data lead, with members added through a group and a standing rule that anything unused for a quarter gets deleted. The analyst gets to work the same afternoon, and the published workspace stays read-only for them. ReadAll exposes every table in that lakehouse, so if it holds sensitive tables, publish a separate lakehouse for Spark consumers rather than granting ReadAll on the shared one.

## Use SQL security today; pilot OneLake security

For fine-grained rules on published data, the GA option today is the SQL security model on the SQL analytics endpoint or warehouse: object-level `GRANT` and `DENY`, row-level security through security policies, column-level permissions and dynamic data masking, all described in the [SQL granular permissions documentation](https://learn.microsoft.com/fabric/data-warehouse/sql-granular-permissions). It's familiar and it's scriptable. The thing to get right is the starting point. ReadData ("Read all with SQL analytics endpoint") is the equivalent of `db_datareader`, so a `GRANT` adds nothing for those users and only `DENY` or row-level security can narrow it. For object-level control, share the item with Read only, leave "Read all with SQL analytics endpoint" unticked, and grant objects in T-SQL.

A minimal example of that Read-only pattern on a lakehouse SQL analytics endpoint, run by anyone with Contributor or higher in the workspace (they hold CONTROL on the endpoint):

```sql
-- Assumes the lakehouse was shared with the group with Read only
-- ("Read all with SQL analytics endpoint" unticked), so it can connect but see nothing.
-- Run against the SQL analytics endpoint of the published lakehouse.
-- After this, members can SELECT from tables and views in the sales schema
-- and get nothing outside it, including the dbo schema.
-- The sales schema needs a schema-enabled lakehouse (lakehouse schemas went GA
-- in December 2025); without schemas, grant SELECT on individual dbo tables or
-- views instead.
GRANT SELECT ON SCHEMA::sales TO [<your-entra-security-group-name>];
```

As covered above, this protects only the SQL path.

[OneLake security](https://learn.microsoft.com/fabric/onelake/security/get-started-security) is Microsoft's answer to that gap. It evolved from OneLake data access roles and [reached public preview in October 2025](https://blog.fabric.microsoft.com/blog/onelake-security-is-now-available-in-public-preview). Roles define which tables and folders a group can reach, with optional row and column rules, and the enforcement lives in OneLake so Spark and other engines respect it. Like the SQL model, it applies to Viewers and to users with item-level Read access, not to Contributors and above.

As of this writing it's still preview, so I treat it the way the earlier table contracts post did: pilot it on a non-critical published lakehouse, learn how the default reader role and engine coverage behave on your items, and don't make it the only thing standing between a sensitive table and a broad audience. Pilot on a lakehouse that doesn't rely on T-SQL grants: in user identity mode the SQL analytics endpoint enforces OneLake roles instead of SQL table permissions. Until it's GA, the workspace split is the boundary you rely on.

## Make drift visible

Boundaries erode one exception at a time. Someone gets Contributor "just for the go-live", and six months later nobody remembers why. The fix is a cheap, regular audit rather than a big quarterly review.

The Fabric REST API exposes workspace role assignments, so a short script can flag any individual (not group) with Admin, Member or Contributor in workspaces you've marked as consumption workspaces. This uses `azure-identity` and `requests`. The caller needs Member or higher in each workspace; a user token needs `Workspace.Read.All` (or `Workspace.ReadWrite.All`), and a service principal running it from CI needs the "Service principals can call Fabric public APIs" tenant setting to allow it:

```python
"""Flag individuals with elevated roles in Fabric consumption workspaces."""
import time

import requests
from azure.identity import DefaultAzureCredential

FABRIC_API = "https://api.fabric.microsoft.com/v1"
CONSUMPTION_WORKSPACE_IDS = [
    "<consumption-workspace-id-1>",
    "<consumption-workspace-id-2>",
]
ELEVATED_ROLES = {"Admin", "Member", "Contributor"}
MAX_RETRIES = 5


def get_headers() -> dict:
    credential = DefaultAzureCredential()
    token = credential.get_token("https://api.fabric.microsoft.com/.default")
    return {"Authorization": f"Bearer {token.token}"}


def list_role_assignments(workspace_id: str, headers: dict) -> list:
    url = f"{FABRIC_API}/workspaces/{workspace_id}/roleAssignments"
    assignments = []
    retries = 0
    while url:
        response = requests.get(url, headers=headers, timeout=30)
        if response.status_code == 429 and retries < MAX_RETRIES:
            # Throttled: wait as long as the API asks, then retry the same page.
            retries += 1
            retry_after = response.headers.get("Retry-After", "10")
            time.sleep(int(retry_after) if retry_after.isdigit() else 10)
            continue
        retries = 0
        response.raise_for_status()
        body = response.json()
        assignments.extend(body.get("value", []))
        url = body.get("continuationUri")
    return assignments


def main() -> None:
    headers = get_headers()
    for workspace_id in CONSUMPTION_WORKSPACE_IDS:
        for assignment in list_role_assignments(workspace_id, headers):
            principal = assignment["principal"]
            if assignment["role"] in ELEVATED_ROLES and principal["type"] == "User":
                name = principal.get("displayName", principal["id"])
                print(f"{workspace_id}: {name} has {assignment['role']}")


if __name__ == "__main__":
    main()
```

Run it from a scheduled pipeline or a CI job, and send the output somewhere a human reads it. The [workspace role assignments API](https://learn.microsoft.com/rest/api/fabric/core/workspaces/list-workspace-role-assignments) also returns groups and service principals, so you can extend the same check to "no service principal has Admin in a consumption workspace" without much effort. For tenant-wide controls, such as who can create workspaces at all, see [Fabric tenant settings](/blog/2024-06-13-tenant-settings-fabric/).

## When this is overkill

Not every estate needs two workspaces per domain. If you have one small team building and consuming the same data, with nothing sensitive in it, a single workspace with sensible roles is fine, and splitting it only adds deployment work. The same goes for a proof of concept that will be thrown away.

The split is worth it when any of these are true: consumers outnumber builders, some tables hold personal or commercially sensitive data, or more than one team publishes into the same domain. Most enterprise estates hit at least one of those within the first few months, which is why I'd rather set it up on day one than retrofit it after the first audit finding.

## The trade I'd make

Speed and access boundaries only conflict when every access request is a fresh decision. Put the decision into the workspace layout instead: engineering and consumption separated, groups instead of individuals, the narrowest item permission by default, SQL security for fine-grained rules today, and OneLake security in a pilot until it's GA. Then granting access stays a routine group change, and it lands on the right side of the boundary.
