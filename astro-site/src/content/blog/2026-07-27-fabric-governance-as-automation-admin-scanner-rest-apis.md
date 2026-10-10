---
title: "Auditing a Fabric Tenant on a Schedule with the Scanner and Admin APIs"
author: Michael John Peña
draft: false
date: 2026-07-27
description: "Use a read-only service principal, the scanner APIs and the Fabric admin APIs to detect governance drift in a Fabric tenant, without handing it write access."
tags:
  - Microsoft Fabric
  - Governance
  - Automation
  - Security
  - Platform Engineering
---

Most Fabric governance still happens by an admin clicking through the admin portal and the OneLake catalog, which means it happens when someone remembers. Everything those screens show comes from REST endpoints a service principal can call on a schedule, so the useful question is not "what does the portal say today" but "what changed since last night, and who should hear about it". The HTTP calls are routine; the design decision is which identity may read the whole tenant and how to guarantee it can never change it.

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 366" role="img" aria-label="Governance-as-automation reconciliation: a read-only service principal reads the Fabric tenant estate (workspaces, lakehouses, warehouses, semantic models, notebooks) via admin, scanner, and ARM APIs into an actual-state store; a Git manifest supplies intended state; drift detection produces a control catalogue; remediation runs through a separate update service principal.">
<defs>
<marker id="ggR" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah-read"/></marker>
<marker id="ggN" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah"/></marker>
<marker id="ggW" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah-write"/></marker>
</defs>
<rect x="22" y="64" width="536" height="272" rx="16" class="ff-zone ff-zone-read"/>
<text x="40" y="86" class="ff-zlabel">READ-ONLY PATH · INVENTORY / SCAN / RECONCILE</text>
<rect x="592" y="150" width="286" height="132" rx="16" class="ff-zone ff-zone-write"/>
<text x="610" y="172" class="ff-zlabel">UPDATE · SEPARATE SPN</text>
<rect x="42" y="100" width="232" height="112" rx="12" class="ff-node"/>
<text x="158" y="124" text-anchor="middle" class="ff-title">Fabric tenant estate</text>
<image href="/icons/fabric/group_workspace_48_non-item.svg" x="54" y="136" width="30" height="30"/>
<image href="/icons/fabric/lakehouse_48_item.svg" x="96" y="136" width="30" height="30"/>
<image href="/icons/fabric/data_warehouse_48_item.svg" x="138" y="136" width="30" height="30"/>
<image href="/icons/fabric/semantic_model_48_item.svg" x="180" y="136" width="30" height="30"/>
<image href="/icons/fabric/notebook_48_item.svg" x="222" y="136" width="30" height="30"/>
<text x="158" y="188" text-anchor="middle" class="ff-sub">workspaces · items · capacities</text>
<text x="158" y="204" text-anchor="middle" class="ff-sub">domains · owners · sensitivity</text>
<rect x="42" y="248" width="232" height="76" rx="12" class="ff-node ff-node-az"/>
<text x="158" y="280" text-anchor="middle" class="ff-title">Git manifest</text>
<text x="158" y="302" text-anchor="middle" class="ff-tok" style="fill:#5aa2ea">intended state</text>
<rect x="330" y="100" width="210" height="94" rx="12" class="ff-node ff-node-cy"/>
<image href="/icons/fabric/lakehouse_48_item.svg" x="346" y="116" width="30" height="30"/>
<text x="448" y="128" text-anchor="middle" class="ff-title">Actual state</text>
<text x="437" y="150" text-anchor="middle" class="ff-sub">inventory · scan · capacity</text>
<text x="437" y="172" text-anchor="middle" class="ff-tok">Lakehouse (raw scan JSON)</text>
<rect x="330" y="228" width="210" height="96" rx="12" class="ff-node"/>
<text x="435" y="258" text-anchor="middle" class="ff-title">Drift detection</text>
<text x="435" y="280" text-anchor="middle" class="ff-sub">actual vs intended</text>
<text x="435" y="302" text-anchor="middle" class="ff-tok">→ control catalogue</text>
<rect x="612" y="186" width="246" height="84" rx="12" class="ff-node ff-node-am"/>
<text x="735" y="216" text-anchor="middle" class="ff-title">Remediation</text>
<text x="735" y="238" text-anchor="middle" class="ff-tok" style="fill:#e0a04a">update SPN</text>
<text x="735" y="258" text-anchor="middle" class="ff-sub">separate group · change-controlled</text>
<path d="M274,156 C 300,150 308,143 330,143" class="ff-edge-read" marker-end="url(#ggR)"/>
<path d="M274,286 C 300,284 308,278 330,278" class="ff-edge" marker-end="url(#ggN)"/>
<path d="M446,194 L446,228" class="ff-edge" marker-end="url(#ggN)"/>
<rect x="452" y="203" width="34" height="15" rx="7" class="ff-elabel-bg"/>
<text x="469" y="214" text-anchor="middle" class="ff-elabel">diff</text>
<path d="M540,276 C 578,276 584,228 612,228" class="ff-edge-write" marker-end="url(#ggW)"/>
<line x1="30" y1="348" x2="58" y2="348" class="ff-edge-read"/>
<text x="65" y="352" class="ff-lgd">read-only path</text>
<line x1="176" y1="348" x2="204" y2="348" class="ff-edge-write"/>
<text x="211" y="352" class="ff-lgd">update path (separate SPN)</text>
<text x="392" y="352" class="ff-lgd" style="fill:#6f787f">· official Microsoft Fabric icons</text>
</svg>
<figcaption><strong>Figure 1.</strong> Governance as a reconciliation loop. A <em>read-only</em> service principal collects actual state through the scanner, Fabric admin and ARM APIs; a Git manifest holds intended state; the diff becomes a list of findings. Anything that changes the tenant runs under a <em>separate</em> identity. The tenant setting can't scope it more finely, so the limit comes from which jobs may use that identity. Icons: official Microsoft Fabric icons.</figcaption>
</figure>

Detection is the half I cover here: collecting actual state, comparing it with what you meant, and raising findings. Provisioning from a manifest is in [Fabric CI/CD Is Solved. Your Tenant Isn't.](/blog/2026-07-27-fabric-cicd-is-solved-your-tenant-isnt-tenant-as-code/).

## Two identities, two tenant settings

Fabric gates service principal access to admin APIs behind two separate tenant settings under **Admin API settings**, and I treat collapsing them as the first governance mistake to avoid.

[**Service principals can access read-only admin APIs**](https://learn.microsoft.com/en-us/fabric/admin/service-admin-portal-admin-api-settings) is the broad one. A service principal in the allowed security group gets read-only access to all the information available through admin APIs, current and future, including user names, emails and detailed semantic model and report metadata. That is a lot of disclosure for one credential, so the group behind it should hold only inventory and scanning identities.

**Service principals can access admin APIs used for updates** is a separate switch with its own security group. It covers Fabric admin APIs that change state; the documented example is [Restore Workspace](https://learn.microsoft.com/en-us/fabric/admin/enable-service-principal-admin-apis).

My rule is two Entra security groups, two service principals, and no principal in both. The scanner identity can read everything and change nothing, so a leaked scanner credential is a disclosure incident rather than a modification incident. The remediation identity lives only in the update group, is used only by named remediation jobs, and its activity in the audit log should be rare enough that every event is worth a look.

<div class="cl cl-warn">
<div class="cl-tag">Blast radius</div>
<div class="cl-body">

An update-capable admin service principal can restore and manipulate workspaces **tenant-wide**. Keep it in a separate Entra group and a separate identity from the read-only scanner SPN, so a compromised inventory credential leaks *disclosure*, never *modification*.

</div>
</div>

Two constraints catch people out:

- An app that calls the read-only admin APIs as a service principal [must not have any admin-consent-required Power BI permissions](https://learn.microsoft.com/en-us/fabric/admin/enable-service-principal-admin-apis) of type Application on its registration. The common trap is reusing a "Power BI integration" app that already has `Tenant.Read.All` granted.
- The developer settings are a different thing again. **Service principals can call Fabric public APIs** governs the non-admin Fabric APIs, and **Service principals can create workspaces, connections, and deployment pipelines** governs those three create operations. The scanner script below needs neither, because it calls only admin endpoints.

## What the scanner APIs give you

The [scanner APIs](https://learn.microsoft.com/en-us/fabric/governance/metadata-scanning-overview) are four Power BI admin endpoints under the `WorkspaceInfo` group: `GetModifiedWorkspaces`, `PostWorkspaceInfo`, `GetScanStatus` and `GetScanResult`. They need no special licence and cover non-Premium workspaces. The flow is fixed:

1. Call `workspaces/modified` without `modifiedSince` once for a full inventory, then with `modifiedSince` set to the start of the previous run for incremental scans. `modifiedSince` must be between 30 minutes and 30 days ago, so a job that misses a month needs a full rescan. Use `excludePersonalWorkspaces=true` unless you govern My Workspaces too.
2. Split the IDs into batches of at most 100 and call `workspaces/getInfo` for each batch. It returns `202 Accepted` and a scan ID.
3. Poll `workspaces/scanStatus/{scanId}` every 30 to 60 seconds until it reports `Succeeded`.
4. Read `workspaces/scanResult/{scanId}`. Results stay available for 24 hours, so persist them promptly.

The query parameters on `getInfo` decide how deep the scan goes: `lineage`, `datasourceDetails`, `datasetSchema`, `datasetExpressions` and `getArtifactUsers`. The schema and expression flags return nothing unless a Fabric admin has also enabled **Enhance admin APIs responses with detailed metadata** (table, column and measure names) and **Enhance admin APIs responses with DAX and mashup expressions** (the second requires the first). Both apply to service principals only when the read-only admin API switch is on. Expect empty `tables` arrays the first time you run against a tenant where nobody flipped these.

Know the gaps before you build controls on top of the output. Semantic models that haven't been refreshed or republished come back with name and lineage but no tables. Models over 1 GB in shared (non-Premium) workspaces return no subartifact metadata. Real-time datasets, models with object-level security, live connections to Analysis Services and Excel full-fidelity datasets explain themselves in a `schemaRetrievalError` field instead. A control that says "no PII columns found" over a model with no schema is a false negative, so I report "schema unavailable" as its own finding.

The rate limits are low: `getInfo` and `scanResult` allow 500 requests per hour (`getInfo` with at most 16 in flight), and `modified` only 30. Microsoft's guidance is to wait for a scan to finish before starting the next `getInfo`, which the script does by running batches sequentially.

### A scheduled scan in Python

This is a complete script for one run. It authenticates with `DefaultAzureCredential` (environment variables, workload identity in CI, or managed identity on Azure), scans every active shared workspace, and flags guests with workspace roles and semantic models that have no sensitivity label or expose columns whose names look like personal data.

Install with `pip install requests azure-identity`; for a service principal set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` (or `AZURE_FEDERATED_TOKEN_FILE` in CI).

<div class="code-title">schedule: scan the tenant (Python)</div>

```python
import time

import requests
from azure.identity import DefaultAzureCredential

BASE = "https://api.powerbi.com/v1.0/myorg/admin/workspaces"
SCOPE = "https://analysis.windows.net/powerbi/api/.default"
PII_HINTS = ("email", "phone", "mobile", "birth", "dob", "tfn", "medicare", "address")


def call(session, method, url, **kwargs):
    for _ in range(5):
        resp = session.request(method, url, timeout=60, **kwargs)
        if resp.status_code == 429:
            try:
                wait = int(resp.headers.get("Retry-After", "60"))
            except ValueError:  # Retry-After can be an HTTP date
                wait = 60
            time.sleep(wait)
            continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError(f"Still throttled after 5 attempts: {url}")


def scan_batch(session, workspace_ids):
    params = {"datasetSchema": "true", "getArtifactUsers": "true"}
    scan = call(session, "POST", f"{BASE}/getInfo", params=params, json={"workspaces": workspace_ids})
    for _ in range(60):  # give up after roughly 30 minutes
        time.sleep(30)
        status = call(session, "GET", f"{BASE}/scanStatus/{scan['id']}")["status"]
        if status == "Succeeded":
            return call(session, "GET", f"{BASE}/scanResult/{scan['id']}")
        if status == "Failed":
            raise RuntimeError(f"Scan {scan['id']} failed")
    raise TimeoutError(f"Scan {scan['id']} still {status} after 30 minutes")


def findings(result):
    for ws in result.get("workspaces", []):
        for user in ws.get("users", []):
            if user.get("userType") == "Guest":
                yield ws.get("name"), f"guest with workspace role: {user.get('emailAddress') or user.get('identifier')}"
        for ds in ws.get("datasets", []):
            where = f"{ws.get('name')} / {ds.get('name')}"
            if ds.get("schemaRetrievalError"):
                yield where, f"schema unavailable: {ds['schemaRetrievalError']}"
            if not (ds.get("sensitivityLabel") or {}).get("labelId"):
                yield where, "no sensitivity label"
            for table in ds.get("tables", []):
                for field in table.get("columns", []) + table.get("measures", []):
                    name = field.get("name", "")
                    if any(h in name.lower() for h in PII_HINTS):
                        yield where, f"possible PII field {table.get('name')}.{name}"


def authorise(session, credential):
    session.headers["Authorization"] = f"Bearer {credential.get_token(SCOPE).token}"


def main():
    credential = DefaultAzureCredential()
    session = requests.Session()
    authorise(session, credential)

    workspaces = call(session, "GET", f"{BASE}/modified", params={"excludePersonalWorkspaces": "true", "excludeInActiveWorkspaces": "true"})
    ids = [w["id"] for w in workspaces]
    for i in range(0, len(ids), 100):
        authorise(session, credential)  # tokens last about an hour; refresh per batch
        for where, issue in findings(scan_batch(session, ids[i:i + 100])):
            print(f"{where}: {issue}")


if __name__ == "__main__":
    main()
```

It leaves out `datasetExpressions` on purpose: it never reads DAX or M, so it shouldn't collect them. In production, write the raw `scanResult` JSON to a Lakehouse before interpreting it, and switch to `modifiedSince` after the first full run. Column-name matching is a cheap heuristic; it finds `CustomerEmail` and misses `Col_17`, which is exactly why the label check sits beside it.

## Inventory from the Fabric admin APIs

The scanner's result lists Fabric items in each workspace, but its deep metadata (tables, columns, measures) is semantic-model shaped. For capacity, domain and item ownership I use two admin endpoints on `api.fabric.microsoft.com`, both callable by a service principal in the read-only group:

- [**List Workspaces**](https://learn.microsoft.com/en-us/rest/api/fabric/admin/workspaces/list-workspaces) (`GET /v1/admin/workspaces`) returns each workspace with `capacityId` and `domainId`, filters by `type`, `state`, `capacityId` and `name`, pages up to 10,000 records with a continuation token, and allows 200 requests per hour. Like List Items, it carries a Preview note in the API reference as of July 2026, so pin your parsing to the fields you use.
- **List Items** (`GET /v1/admin/items`) returns every item with `workspaceId`, `capacityId` and `creatorPrincipal`. It is also marked preview, so expect its shape to change.

For domains, **List Domains** and List Domain Workspaces let you cross-check a workspace's `domainId` against the domain's own assignment list; the release version of List Domains needs `preview=false` on every call, so pass it explicitly.

For guests, you already have the data: the workspace users in the scan result carry `userType`, which is what the script's guest check filters on. `GetGroupsAsAdmin` with `$expand=users` is a slower fallback. The older Power BI admin surface also has endpoints the Fabric APIs don't replace. `GetUnusedArtifactsAsAdmin` (still a preview API), for example, lists datasets, reports and dashboards nobody has used in 30 days, per workspace.

If you'd rather not write a client, the Fabric CLI `api` command calls these endpoints with the CLI's credentials and an `-A` audience switch (`fabric`, `powerbi`, `azure` or `storage`). Responses are wrapped in `text`, so a `-q` JMESPath query starts there.

<div class="code-title">Fabric CLI · authenticate</div>

```bash
fab auth login -u <client-id> --federated-token <token> --tenant <tenant-id>
fab api "admin/workspaces" -P "type=Workspace,state=Active" -q "text.workspaces[].{id:id,capacity:capacityId,domain:domainId}"
fab api -A azure "subscriptions/<subscription-id>/providers/Microsoft.Fabric/capacities?api-version=2023-11-01"
```

The CLI's auth docs require the Fabric APIs service principal switch (now named **Service principals can call Fabric public APIs**) for service principal login, so either add the scanner identity to that setting's group too or run the CLI interactively as a Fabric admin. That group lets it call non-admin Fabric APIs, but it can only act where it holds a workspace role and still can't create workspaces, so the read-only guarantee holds as long as you never give it workspace roles.

The ARM call needs an Azure role such as Reader on the subscription or capacity resources; the Fabric tenant setting doesn't grant it. Keep that role read-only too.

## Turning state into findings

Collection is the easy part; the controls are joins between what the APIs return and a manifest in Git that says what should exist. These are the ones I'd start with, because each has an obvious owner and a clear fix:

<div style="overflow-x:auto;margin:1.75rem 0;border:1px solid #27272a;border-radius:12px">
<table style="width:100%;border-collapse:collapse;min-width:820px;font-size:0.87rem">
<thead>
<tr style="background:#15151b">
<th style="text-align:left;padding:11px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Control</th>
<th style="text-align:left;padding:11px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Signal</th>
<th style="text-align:left;padding:11px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Who acts</th>
</tr>
</thead>
<tbody>
<tr>
<td style="padding:11px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600">Workspace not in manifest</td>
<td style="padding:11px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><a href="https://learn.microsoft.com/en-us/rest/api/fabric/admin/workspaces/list-workspaces" style="color:#00B7C3">List Workspaces</a> ID missing from Git</td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Platform team registers or retires it</td>
</tr>
<tr>
<td style="padding:11px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600">Wrong capacity</td>
<td style="padding:11px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><code style="background:#0f151a;color:#7fd8cf;padding:1px 4px;border-radius:4px;font-size:0.82em">capacityId</code> differs from manifest</td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Capacity owner</td>
</tr>
<tr>
<td style="padding:11px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600"><img src="/icons/fabric/group_workspace_48_non-item.svg" alt="" width="16" height="16" style="vertical-align:-3px;margin-right:7px"/>Wrong or missing domain</td>
<td style="padding:11px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><code style="background:#0f151a;color:#7fd8cf;padding:1px 4px;border-radius:4px;font-size:0.82em">domainId</code> differs from manifest</td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Domain admin</td>
</tr>
<tr>
<td style="padding:11px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600"><img src="/icons/fabric/semantic_model_48_item.svg" alt="" width="16" height="16" style="vertical-align:-3px;margin-right:7px"/>Unlabelled semantic model</td>
<td style="padding:11px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22">Scan result has no <code style="background:#0f151a;color:#7fd8cf;padding:1px 4px;border-radius:4px;font-size:0.82em">sensitivityLabel.labelId</code></td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Item owner applies a label</td>
</tr>
<tr>
<td style="padding:11px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600">Possible PII without a label</td>
<td style="padding:11px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22">Column or measure names match patterns, no label</td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Data owner, then Purview review</td>
</tr>
<tr>
<td style="padding:11px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600">Guest with a workspace role</td>
<td style="padding:11px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22">Scan result users with <code style="background:#0f151a;color:#7fd8cf;padding:1px 4px;border-radius:4px;font-size:0.82em">userType</code> Guest</td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Workspace admin</td>
</tr>
<tr>
<td style="padding:11px 14px;color:#e4e4e7;font-family:'Space Grotesk',sans-serif;font-weight:600">Stale content</td>
<td style="padding:11px 14px;color:#d4d4d8"><a href="https://learn.microsoft.com/en-us/rest/api/power-bi/admin/groups-get-unused-artifacts-as-admin" style="color:#00B7C3">GetUnusedArtifactsAsAdmin</a> result</td>
<td style="padding:11px 14px;color:#a1a1aa">Item owner archives or justifies</td>
</tr>
</tbody>
</table>
</div>

The stale-content check costs one call per workspace and is capped at 200 requests per hour, so a 2,000-workspace tenant needs at least 10 hours per sweep. Run it as a rolling weekly sweep, not in the nightly job.

None of these needs the update identity. Most remediation is a person acting on a finding, and I'd keep it that way until a fix has proven boring and repeatable. Automating a fix with a tenant-wide update credential is a bigger risk than most of the drift it corrects.

For usage context, the admin monitoring workspace (preview) gives you reports out of the box, but it refreshes once a day and its refresh fails if the admin who installed it loses the role or relies on PIM without being active at refresh time. I treat it as a view, not a pipeline. Get Activity Events returns raw activity for the last 28 days, one UTC day per request, so pull it daily and keep your own history.

If you want the collection layer prebuilt, [FUAM (Fabric Unified Admin Monitoring)](https://github.com/microsoft/fabric-toolbox/blob/main/monitoring/fabric-unified-admin-monitoring/README.md) in Microsoft's `fabric-toolbox` repository uses pipelines and notebooks to land tenant settings, activities, workspaces, capacity metrics and scanner metadata into a Lakehouse. It's an open-source accelerator, not a supported product, so own it like your own code, and it needs more than the scanner identity: its service principal must be in both the read-only admin API group and the Fabric public APIs group, and its capacity-metrics notebooks run as a Fabric administrator who owns them, so treat its identity as a separate, broader one.

## Where I'd draw the line

Run governance detection on a schedule with a read-only identity, and keep anything that writes to the tenant on a separate identity, in a separate group, behind change control. Start with the scanner and List Workspaces, because they answer "what exists and who owns it" with almost no setup. Don't build controls on scan fields until the detailed-metadata enhance setting is on and you've handled models that return no schema, or you'll report a clean tenant that you simply can't see.

This approach isn't worth it for a tenant with a handful of workspaces and one admin who knows all of them; the portal is fine there. It pays off once workspaces are created faster than anyone can review them by hand.
