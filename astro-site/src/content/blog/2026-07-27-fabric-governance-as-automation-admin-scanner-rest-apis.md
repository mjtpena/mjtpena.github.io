---
title: "Fabric Governance as Automation: Building on the Admin, Scanner, and REST APIs"
author: Michael John Peña
draft: false
date: 2026-07-27
description: "The Fabric admin portal is one interface over the governance model, not the model itself. How to build governance-as-automation on the same admin, scanner (WorkspaceInfo), and REST APIs a service principal can call directly — with least-privilege identity separation as a first-class design constraint."
tags:
  - Microsoft Fabric
  - Governance
  - Admin API
  - Metadata Scanning
  - Platform Engineering
---

The Fabric admin portal is one interface over the governance model — not the model itself. Every toggle, workspace listing, and scan result it renders is backed by REST and admin APIs that a service principal can call directly. Governance automation should therefore treat the portal as a human-readable view and operate on the same underlying endpoints: the Power BI/Fabric admin APIs, the scanner (WorkspaceInfo) APIs, and ARM for capacity. This article shows how to build governance-as-automation on those APIs, with least-privilege identity separation as a first-class design constraint.

<figure>
<svg viewBox="0 0 760 300" role="img" aria-label="Governance-as-automation reconciliation: a read-only service principal reads the Fabric tenant estate (workspaces, lakehouses, warehouses, semantic models, notebooks) via admin, scanner, and ARM APIs into an actual-state store; a Git manifest supplies intended state; drift detection produces a control catalogue; remediation runs through a separately scoped update service principal." style="width:100%;height:auto;background:#0c0c11;border-radius:10px">
<style>
.gg-t{fill:#e4e4e7;font-family:'Space Grotesk',system-ui,sans-serif;font-size:12.5px}
.gg-tm{fill:#a1a1aa;font-family:'Space Grotesk',system-ui,sans-serif;font-size:10.5px}
.gg-mo{fill:#7fd8cf;font-family:'JetBrains Mono',monospace;font-size:9.5px}
.gg-cyt{fill:#00B7C3;font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.03em}
.gg-amt{fill:#e0a04a;font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.03em}
.gg-box{fill:#15151b;stroke:#3f3f46;stroke-width:1.3}
.gg-cy{fill:#0b2b2e;stroke:#00B7C3;stroke-width:1.4}
.gg-am{fill:#2a2113;stroke:#e0a04a;stroke-width:1.4}
.gg-ed{stroke:#00B7C3;stroke-width:1.6;fill:none}
.gg-ef{fill:#00B7C3}
.gg-eda{stroke:#e0a04a;stroke-width:1.7;fill:none}
.gg-efa{fill:#e0a04a}
.gg-en{stroke:#6d757d;stroke-width:1.5;fill:none}
.gg-enf{fill:#6d757d}
</style>
<defs>
<marker id="ggc" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" class="gg-ef"/></marker>
<marker id="gga" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" class="gg-efa"/></marker>
<marker id="ggn" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" class="gg-enf"/></marker>
</defs>
<!-- estate -->
<rect x="16" y="36" width="212" height="118" rx="10" class="gg-box"/>
<text x="122" y="58" text-anchor="middle" class="gg-t">Fabric tenant estate</text>
<image href="/icons/fabric/group_workspace_48_non-item.svg" x="24" y="74" width="26" height="26"/>
<image href="/icons/fabric/lakehouse_48_item.svg" x="62" y="74" width="26" height="26"/>
<image href="/icons/fabric/data_warehouse_48_item.svg" x="100" y="74" width="26" height="26"/>
<image href="/icons/fabric/semantic_model_48_item.svg" x="138" y="74" width="26" height="26"/>
<image href="/icons/fabric/notebook_48_item.svg" x="176" y="74" width="26" height="26"/>
<text x="122" y="122" text-anchor="middle" class="gg-tm">workspaces · items · capacities</text>
<text x="122" y="138" text-anchor="middle" class="gg-tm">domains · owners · sensitivity</text>
<!-- manifest -->
<rect x="16" y="200" width="212" height="64" rx="10" class="gg-box"/>
<text x="122" y="226" text-anchor="middle" class="gg-t">Git manifest</text>
<text x="122" y="246" text-anchor="middle" class="gg-cyt">INTENDED STATE</text>
<!-- actual -->
<rect x="300" y="40" width="180" height="82" rx="10" class="gg-cy"/>
<image href="/icons/fabric/lakehouse_48_item.svg" x="312" y="50" width="22" height="22"/>
<text x="398" y="66" text-anchor="middle" class="gg-t">Actual state</text>
<text x="390" y="86" text-anchor="middle" class="gg-tm">inventory · scan · capacity</text>
<text x="390" y="104" text-anchor="middle" class="gg-mo">FUAM Lakehouse</text>
<!-- diff -->
<rect x="300" y="180" width="180" height="84" rx="10" class="gg-box"/>
<text x="390" y="208" text-anchor="middle" class="gg-t">Drift detection</text>
<text x="390" y="228" text-anchor="middle" class="gg-tm">actual vs intended</text>
<text x="390" y="248" text-anchor="middle" class="gg-cyt">→ CONTROL CATALOGUE</text>
<!-- remediation -->
<rect x="552" y="106" width="192" height="92" rx="10" class="gg-am"/>
<text x="648" y="134" text-anchor="middle" class="gg-t">Remediation</text>
<text x="648" y="154" text-anchor="middle" class="gg-amt">SCOPED UPDATE SPN</text>
<text x="648" y="174" text-anchor="middle" class="gg-tm">tightly bounded · audited</text>
<!-- edges -->
<path d="M228,86 C 262,84 268,80 300,80" class="gg-ed" marker-end="url(#ggc)"/>
<text x="264" y="72" text-anchor="middle" class="gg-cyt">read-only SPN</text>
<path d="M228,232 C 262,232 270,224 300,222" class="gg-en" marker-end="url(#ggn)"/>
<path d="M390,122 L390,178" class="gg-en" marker-end="url(#ggn)"/>
<text x="404" y="152" text-anchor="start" class="gg-tm">diff</text>
<path d="M480,222 C 516,222 522,158 552,152" class="gg-eda" marker-end="url(#gga)"/>
</svg>
<figcaption><strong>Figure 1.</strong> Governance as a reconciliation loop. A <em>read-only</em> service principal reads the Fabric estate through the admin, scanner (WorkspaceInfo), and ARM APIs into an actual-state store (here, a FUAM Lakehouse); a Git manifest defines intended state; drift detection yields a control catalogue; and remediation runs through a <em>separately scoped</em> update service principal. Icons: official Microsoft Fabric icons.</figcaption>
</figure>

## Service principal model

Fabric gates programmatic admin access behind tenant settings that map to Entra security groups. There are two distinct toggles under Admin API settings, and treating them as one is the first governance mistake to avoid.

The first is [**Service principals can access read-only admin APIs**](https://learn.microsoft.com/en-us/fabric/admin/service-admin-portal-admin-api-settings). A service principal must be a member of an allowed security group; membership grants read-only access to *all* information available through admin APIs, current and future — user names and emails, semantic model and report detailed metadata included. This is a broad grant, so the group backing it should contain only inventory and scanning identities.

The second is [**Service principals can access admin APIs used for updates**](https://learn.microsoft.com/en-us/fabric/admin/service-admin-portal-admin-api-settings), a separate toggle scoped to a separate security group. It applies to Fabric admin APIs that mutate state — the documented example is the Restore Workspace API ([per the enablement docs](https://learn.microsoft.com/en-us/fabric/admin/enable-service-principal-admin-apis)). Note the naming: the portal heading reads "Service principals can access read-only admin APIs," but the same page's notes and older enterprise articles still use the legacy label "Allow service principals to use read-only admin APIs." They are the same setting.

Each toggle is configured with a **Specific security groups** radio button and an explicit group [added under it](https://learn.microsoft.com/en-us/fabric/admin/enable-service-principal-admin-apis). Fabric admin rights are required to change either setting, and — importantly — an app used for service principal authentication against read-only admin APIs [must not have any admin-consent-required Power BI permissions](https://learn.microsoft.com/en-us/fabric/admin/enable-service-principal-admin-apis) set on it in the Azure portal. Both service-principal settings' notes add that each is also required to run Fabric data risk assessments in Microsoft Purview DSPM for AI.

The design principle follows directly: create **two distinct Entra security groups**, one per toggle, and put different service principals in each. A read-only inventory/scanner SPN never belongs in the update group. An update-capable SPN — which can restore (and by extension manipulate) workspaces tenant-wide — is a far larger blast radius and should be tightly scoped, separately credentialed, and used only by the specific remediation jobs that need it. The read-only grant is already broad ("all information … current and future"); the update grant is the one that changes the world.

Separately, calling *Fabric* APIs (as opposed to the Power BI admin surface) via the CLI requires the [**Allow service principals to use Fabric APIs**](https://microsoft.github.io/fabric-cli/commands/auth/) tenant switch. Keep this distinct from the two admin-API toggles above.

## Metadata scanning (Scanner API)

The scanner APIs — collectively the [WorkspaceInfo APIs](https://learn.microsoft.com/en-us/fabric/governance/metadata-scanning-overview) — are the tenant-wide metadata extraction surface. They require no special license, work across non-Premium workspaces, and support both public and sovereign clouds. There are four: `GetModifiedWorkspaces`, `PostWorkspaceInfo`, `GetScanStatus`, and `GetScanResult`. The scan flow chains them.

### Step 1 — Enumerate

Call `GetModifiedWorkspaces` with no `modifiedSince` to get every workspace ID; with `modifiedSince` (constrained to a window of 30 minutes to 30 days prior, ISO 8601 UTC) to get only [changed workspaces](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-get-modified-workspaces) for incremental scans.

```http
GET https://api.powerbi.com/v1.0/myorg/admin/workspaces/modified?excludePersonalWorkspaces=True
Authorization: Bearer <token>
```

### Step 2 — Trigger

Divide the IDs into chunks and call `PostWorkspaceInfo`. The `workspaces` array [supports 1 to 100 workspace IDs](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-post-workspace-info) per call — so batch in groups of at most 100. The five boolean query params control depth: `lineage`, `datasourceDetails`, `datasetSchema` (tables, columns, measures), `datasetExpressions` (DAX and Mashup/M queries), and `getArtifactUsers`.

```http
POST https://api.powerbi.com/v1.0/myorg/admin/workspaces/getInfo?lineage=true&datasourceDetails=true&datasetSchema=true&datasetExpressions=true&getArtifactUsers=true
Authorization: Bearer <token>
Content-Type: application/json

{
  "workspaces": [
    "b2f2b2e0-0000-0000-0000-000000000001",
    "b2f2b2e0-0000-0000-0000-000000000002"
  ]
}
```

The call returns `202 Accepted` with a `ScanRequest` `{ "id": "<scanId>", "createdDateTime": "...", "status": "NotStarted" }`. Critically, `datasetSchema` and `datasetExpressions` only return data if metadata scanning is [fully enabled at the tenant level](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-post-workspace-info) — set them true against a tenant without the enhance settings and the fields come back empty.

### Step 3 — Poll

Poll `GetScanStatus` (recommended interval 30–60 seconds) until status is `Succeeded`.

```http
GET https://api.powerbi.com/v1.0/myorg/admin/workspaces/scanStatus/<scanId>
```

### Step 4 — Read

Call `GetScanResult` only [after a successful status](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-get-scan-result); the result remains available for 24 hours. The top-level `WorkspaceInfoResponse` contains `workspaces`, `datasourceInstances`, and `misconfiguredDatasourceInstances`. Each `WorkspaceInfo` carries reports, dashboards, datasets, dataflows, datamarts, users, tags, plus capacity and storage-format info. A `WorkspaceInfoDataset` exposes `tables` (with `columns`, `measures`, and an M `source`), `expressions`, RLS `roles`, `endorsementDetails`, and a `sensitivityLabel` with its `labelId`.

### The two enhance settings

Table and column names appear in `GetScanResult` only when [**Enhance admin APIs responses with detailed metadata**](https://learn.microsoft.com/en-us/fabric/admin/service-admin-portal-admin-api-settings) is on; DAX and mashup expressions appear only when [**Enhance admin APIs responses with DAX and mashup expressions**](https://learn.microsoft.com/en-us/fabric/admin/service-admin-portal-admin-api-settings) is on. Both carry the same dependency note: for the setting to apply to a service principal, the read-only admin API setting must also be enabled. Enabling metadata scanning end-to-end is also a prerequisite for [Fabric data risk assessments in Microsoft Purview DSPM for AI](https://learn.microsoft.com/en-us/fabric/admin/service-admin-portal-admin-api-settings).

### Governance use and limits

With detailed metadata and expressions enabled, the scan result is a tenant-wide index of where sensitive data lives: locate semantic models whose column names or DAX measures reference PII, read each model's `sensitivityLabel`, and feed the inventory to Purview DSPM. This is the automation-native path to the same signal the portal surfaces.

Mind the gaps. Subartifact metadata is not returned for semantic models over 1 GB in shared (non-Premium) workspaces; Premium/Fabric-capacity workspaces have no such size cap. Models not refreshed or republished return name and lineage but no subartifact detail, and unsupported dataset types report the reason in a `schemaRetrievalError` field. Rate limits are real (all figures below as of July 2026 and subject to Microsoft revision): `getInfo` is capped at 500 requests/hour and 16 simultaneous, `scanStatus` at 10,000/hour, `scanResult` at 500/hour, and `modified` at 30/hour — wait for a succeed/failed status before issuing the next `getInfo`.

## Inventory automation

Beyond the scanner, the admin REST surface gives you the actual-state inventory to reconcile against intended state. Two Fabric admin endpoints are the backbone.

[**List Workspaces**](https://learn.microsoft.com/en-us/rest/api/fabric/admin/workspaces/list-workspaces) returns every workspace with both `capacityId` and `domainId` in a single call, so capacity assignment and domain assignment are enumerable together. It supports filtering by `capacityId`, `name`, `state` (active/deleted), and `type` (personal, workspace, adminworkspace), and paginates up to 10,000 records per request via continuation token.

```http
GET https://api.fabric.microsoft.com/v1/admin/workspaces?type=Workspace&state=active
```

[**List Items**](https://learn.microsoft.com/en-us/rest/api/fabric/admin/items/list-items) returns all active Fabric and Power BI items tenant-wide, each carrying `workspaceId`, `capacityId`, and `creatorPrincipal` — the owner. That ownership signal is the core of drift detection.

```http
GET https://api.fabric.microsoft.com/v1/admin/items?type=SemanticModel&state=active
```

For domain reconciliation, [**List Domains**](https://learn.microsoft.com/en-us/rest/api/fabric/admin/domains/list-domains) returns every domain with its `parentDomainId` hierarchy, and [**List Domain Workspaces**](https://learn.microsoft.com/en-us/rest/api/fabric/admin/domains/list-domain-workspaces) returns which workspaces are assigned to a given domain — letting you cross-check the workspace-level `domainId` against the domain-level assignment. Note that List Domains is a release version of a preview API; the preview form is [deprecated on March 31, 2026](https://learn.microsoft.com/en-us/rest/api/fabric/admin/domains/list-domains), and callers must pass `preview=false`.

The older Power BI admin surface remains the workhorse for expanded ownership and content auditing. [**GetGroupsAsAdmin**](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/groups-get-groups-as-admin) returns workspaces org-wide and can `$expand` users, reports, datasets, dashboards, dataflows, and workbooks inline; each `AdminGroup` exposes `capacityId`, `isOnDedicatedCapacity`, and `pipelineId` (deployment-pipeline linkage). It is heavily rate-limited — 50 requests/hour or 15/minute per tenant — so page deliberately.

**Drift detection** is the join. Pull actual state from these endpoints, compare against a Git-defined intended state (a manifest of expected workspaces, their capacities, domains, and owners), and emit deltas: workspaces present in the tenant but absent from the manifest, capacity or domain assignments that disagree with the manifest, or items owned by a `creatorPrincipal` outside the approved set. List Workspaces and List Items are Preview/pre-GA and rate-limited, so drift scripts must paginate and back off on 429/`Retry-After`.

## Fabric CLI / REST usage

The [Fabric CLI](https://microsoft.github.io/fabric-cli/commands/api/) (`fab`) makes authenticated requests to Fabric REST APIs for automation. Its `api` command takes an endpoint and an `-A/--audience` flag selecting the base URL: `fabric` → `api.fabric.microsoft.com` (default), `powerbi` → `api.powerbi.com`, `azure` → `management.azure.com` (ARM), and `storage` → OneLake DFS. Other flags: `-X` (method), `-i` (JSON body, inline or file), `-P` (query params), `-q` (JMESPath filter), and `--show_headers`.

### Authenticating without a signed-in user

In CI (for example GitHub Actions), prefer an OIDC [federated token](https://microsoft.github.io/fabric-cli/examples/auth_examples/) over a stored secret:

```bash
# Federated credential (no secret at rest)
fab auth login -u <client_id> --federated-token <token> --tenant <tenant_id>

# Certificate
fab auth login -u <client_id> --certificate /path/to/cert.pem --tenant <tenant_id>

# Managed identity (user-assigned)
fab auth login --identity -u <client_id>
```

### Inventory and capacity calls

```bash
# List all workspaces
fab api workspaces

# Filter to true workspaces via JMESPath
fab api workspaces -q "value[?type=='Workspace']"

# Tenant-wide admin item scan, filtered by type and name
fab api "admin/items" -P "type=SemanticModel" -q "itemEntities[?contains(name, 'Sales')]"
```

Capacity listing via ARM — the `azure` audience against the `Microsoft.Fabric` provider requires the `api-version` query param:

```bash
fab api -A azure \
  subscriptions/<sub-id>/providers/Microsoft.Fabric/capacities?api-version=2023-11-01
```

The core Fabric surface also lists capacities directly at `GET https://api.fabric.microsoft.com/v1/capacities` (scope `Capacity.Read.All`). The Power BI audience remains available for workspace detail:

```bash
fab api -A powerbi groups
fab api -A powerbi groups/<workspaceId>
```

### Scheduling governance scans

The scan flow above is what you schedule — a recurring job (Fabric Pipeline/Notebook, or an external scheduler) that runs `GetModifiedWorkspaces` incrementally with `modifiedSince` set to the last run, chunks into 100-workspace batches, triggers `getInfo`, polls, and persists each `GetScanResult` within its 24-hour availability window. Raw REST for the trigger, if you are not using the CLI:

```bash
curl -X POST \
  "https://api.powerbi.com/v1.0/myorg/admin/workspaces/getInfo?datasetSchema=true&datasetExpressions=true" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"workspaces": ["b2f2b2e0-0000-0000-0000-000000000001"]}'
```

## Governance control catalogue

Each control is a scheduled join between an API-collected signal and the Git-defined manifest. Detection is automated; remediation is separated by whether it needs the read-only or update identity.

<div style="overflow-x:auto;margin:1.75rem 0;border:1px solid #27272a;border-radius:12px">
<table style="width:100%;border-collapse:collapse;min-width:820px;font-size:0.87rem">
<thead>
<tr style="background:#15151b">
<th style="text-align:left;padding:11px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Control</th>
<th style="text-align:left;padding:11px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Data source / API</th>
<th style="text-align:left;padding:11px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Detection logic</th>
<th style="text-align:left;padding:11px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Remediation</th>
</tr>
</thead>
<tbody>
<tr>
<td style="padding:11px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600">Workspace not in manifest</td>
<td style="padding:11px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><a href="https://learn.microsoft.com/en-us/rest/api/fabric/admin/workspaces/list-workspaces" style="color:#00B7C3">List Workspaces</a></td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Workspace ID present in tenant, absent from Git manifest</td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Alert governance owner; register or schedule removal <span style="color:#e0a04a">(update SPN)</span></td>
</tr>
<tr>
<td style="padding:11px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600">Workspace on wrong capacity</td>
<td style="padding:11px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><a href="https://learn.microsoft.com/en-us/rest/api/fabric/admin/workspaces/list-workspaces" style="color:#00B7C3">List Workspaces</a> (<code style="background:#0f151a;color:#7fd8cf;padding:1px 4px;border-radius:4px;font-size:0.82em">capacityId</code>)</td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22"><code style="background:#0f151a;color:#7fd8cf;padding:1px 4px;border-radius:4px;font-size:0.82em">capacityId</code> ≠ manifest expected capacity</td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Flag for reassignment; ticket to capacity owner</td>
</tr>
<tr>
<td style="padding:11px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600"><img src="/icons/fabric/semantic_model_48_item.svg" alt="" width="16" height="16" style="vertical-align:-3px;margin-right:7px"/>Semantic model DAX exposing PII</td>
<td style="padding:11px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><a href="https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-get-scan-result" style="color:#00B7C3">GetScanResult</a> + <code style="background:#0f151a;color:#7fd8cf;padding:1px 4px;border-radius:4px;font-size:0.82em">datasetExpressions</code></td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Measure <code style="background:#0f151a;color:#7fd8cf;padding:1px 4px;border-radius:4px;font-size:0.82em">expression</code> / column name matches PII patterns; <code style="background:#0f151a;color:#7fd8cf;padding:1px 4px;border-radius:4px;font-size:0.82em">sensitivityLabel</code> missing</td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Apply sensitivity label; feed to Purview DSPM</td>
</tr>
<tr>
<td style="padding:11px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600">Orphaned / unused item</td>
<td style="padding:11px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><a href="https://learn.microsoft.com/en-us/rest/api/power-bi/admin/groups-get-unused-artifacts-as-admin" style="color:#00B7C3">GetUnusedArtifactsAsAdmin</a></td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22"><code style="background:#0f151a;color:#7fd8cf;padding:1px 4px;border-radius:4px;font-size:0.82em">lastAccessedDateTime</code> &gt; 30 days</td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Notify owner; archive or delete on policy</td>
</tr>
<tr>
<td style="padding:11px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600">Guest / external user with access</td>
<td style="padding:11px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><a href="https://learn.microsoft.com/en-us/rest/api/power-bi/admin/groups-get-groups-as-admin" style="color:#00B7C3">GetGroupsAsAdmin</a> <code style="background:#0f151a;color:#7fd8cf;padding:1px 4px;border-radius:4px;font-size:0.82em">$expand=users</code></td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">User principal is external/guest, not on allowlist</td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Review and remove access</td>
</tr>
<tr>
<td style="padding:11px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600">Missing sensitivity label</td>
<td style="padding:11px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><a href="https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-get-scan-result" style="color:#00B7C3">GetScanResult</a> (<code style="background:#0f151a;color:#7fd8cf;padding:1px 4px;border-radius:4px;font-size:0.82em">sensitivityLabel.labelId</code>)</td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22"><code style="background:#0f151a;color:#7fd8cf;padding:1px 4px;border-radius:4px;font-size:0.82em">labelId</code> absent on a dataset in scope</td>
<td style="padding:11px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Apply label via <a href="https://learn.microsoft.com/en-us/fabric/governance/governance-compliance-overview" style="color:#00B7C3">sensitivity labeling</a></td>
</tr>
<tr>
<td style="padding:11px 14px;color:#e4e4e7;font-family:'Space Grotesk',sans-serif;font-weight:600"><img src="/icons/fabric/group_workspace_48_non-item.svg" alt="" width="16" height="16" style="vertical-align:-3px;margin-right:7px"/>Workspace in wrong domain</td>
<td style="padding:11px 14px;color:#d4d4d8"><a href="https://learn.microsoft.com/en-us/rest/api/fabric/admin/domains/list-domain-workspaces" style="color:#00B7C3">List Domain Workspaces</a></td>
<td style="padding:11px 14px;color:#a1a1aa"><code style="background:#0f151a;color:#7fd8cf;padding:1px 4px;border-radius:4px;font-size:0.82em">domainId</code> ≠ manifest domain</td>
<td style="padding:11px 14px;color:#a1a1aa">Reassign domain; alert domain admin</td>
</tr>
</tbody>
</table>
</div>

## Closing the loop

Drift detection is a three-way reconciliation: **actual state** collected from the admin, scanner, and ARM APIs; **intended state** defined in Git; and **usage/audit context** from monitoring. The APIs above supply actual state on a schedule. The Git manifest is authoritative for what *should* exist. The delta is your control output.

Context comes from Fabric's monitoring surfaces. The built-in [admin monitoring workspace](https://learn.microsoft.com/en-us/fabric/admin/monitoring-workspace) provides out-of-the-box reports on user activity, sharing, and capacity performance — but it is read-only, refreshes once daily, and can silently stop refreshing if the installing admin loses admin rights or relies on PIM without active elevation during the refresh window. Treat it as a convenience view, not a monitoring pipeline. For audit history, [Get Activity Events](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/get-activity-events) returns tenant activity, but each call must fall within a single UTC day inside the last 28 days, so long-range pulls chunk day-by-day. All Fabric user activities are also logged to the [Purview audit log](https://learn.microsoft.com/en-us/fabric/governance/microsoft-purview-fabric).

For a holistic pipeline, [**FUAM (Fabric Unified Admin Monitoring)**](https://github.com/microsoft/fabric-toolbox/blob/main/monitoring/fabric-unified-admin-monitoring/README.md) is an open-source solution accelerator in Microsoft's public `fabric-toolbox` repo — explicitly *not* an official Microsoft product. It is built entirely with Fabric capabilities: Pipelines and Notebooks extract tenant settings, delegated tenant settings, activities, workspaces, capacities, capacity metrics, tenant metadata via the Scanner API, capacity refreshables, and Git connections into a Lakehouse, transform with PySpark, and serve Power BI reports over the SQL endpoint. That data model is precisely the cross-reference substrate this article's controls need — actual inventory, capacity, and scanner metadata unified in one place to diff against intended state.

## Least privilege and security boundary

The identity design is not incidental to governance automation — it *is* the governance boundary, because an update-capable admin SPN is one of the most powerful principals in the tenant.

### Separate read from update

Maintain two Entra security groups mapped to the two admin-API toggles, and two service principals. The inventory/scanner SPN lives only in the read-only group; it can read all admin metadata but cannot mutate. The remediation SPN lives only in the update group. Never collapse them: the read-only grant already covers "all information … current and future," and the update grant can restore and manipulate workspaces tenant-wide. Keeping them apart bounds the blast radius of a compromised inventory credential to *disclosure* rather than *modification*.

### Credential storage

Prefer OIDC federated credentials (workload identity) so no secret sits at rest — the CLI's `--federated-token` path supports exactly this in CI. Where a secret or certificate is unavoidable, store it in Key Vault and reference it at runtime; certificates are preferable to client secrets. Managed identity is available for Azure-hosted jobs. Remember the hard constraint: an app authenticating a service principal against read-only admin APIs must have **no admin-consent-required Power BI permissions** configured in Azure, and scanner calls under service principal auth send no `Tenant.Read.All`/`Tenant.ReadWrite.All` scope at all — those scopes apply only to delegated admin tokens.

### Blast radius, network, and audit controls

Scope the update SPN to only the specific remediation jobs that require it, and gate those jobs behind change control. Because every Fabric user (and service principal) activity is captured in the Purview audit log and via Get Activity Events, treat the update SPN's actions as high-signal events: alert on any activity it performs outside a scheduled remediation window. Run automation from controlled network egress, page through admin APIs with continuation tokens, and back off on 429/`Retry-After` — rate limits are low enough (GetGroupsAsAdmin at 50/hour, modified at 30/hour) that a poorly-bounded script both fails and looks like abuse. The portal will show you the same posture; automation, built on the same APIs with these boundaries, enforces it continuously.

## References

Verified against Microsoft Learn (retrieved July 2026), the Microsoft Fabric CLI docs, and Microsoft's `fabric-toolbox` (FUAM). Preview APIs (List Workspaces/Items, List Domains) and rate limits are subject to change — re-check before relying on them.

1. [Admin API settings — service principals & metadata (Microsoft Learn)](https://learn.microsoft.com/en-us/fabric/admin/service-admin-portal-admin-api-settings) · [Enable service principals to use admin APIs](https://learn.microsoft.com/en-us/fabric/admin/enable-service-principal-admin-apis)
2. [Metadata scanning overview](https://learn.microsoft.com/en-us/fabric/governance/metadata-scanning-overview) · [PostWorkspaceInfo](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-post-workspace-info) · [GetScanStatus](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-get-scan-status) · [GetScanResult](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-get-scan-result) · [GetModifiedWorkspaces](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/workspace-info-get-modified-workspaces)
3. [List Workspaces](https://learn.microsoft.com/en-us/rest/api/fabric/admin/workspaces/list-workspaces) · [List Items](https://learn.microsoft.com/en-us/rest/api/fabric/admin/items/list-items) · [List Domains](https://learn.microsoft.com/en-us/rest/api/fabric/admin/domains/list-domains) · [List Domain Workspaces](https://learn.microsoft.com/en-us/rest/api/fabric/admin/domains/list-domain-workspaces)
4. [GetGroupsAsAdmin](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/groups-get-groups-as-admin) · [GetUnusedArtifactsAsAdmin](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/groups-get-unused-artifacts-as-admin) · [Get Activity Events](https://learn.microsoft.com/en-us/rest/api/power-bi/admin/get-activity-events)
5. [Fabric CLI — api command](https://microsoft.github.io/fabric-cli/commands/api/) · [auth](https://microsoft.github.io/fabric-cli/commands/auth/) · [auth examples](https://microsoft.github.io/fabric-cli/examples/auth_examples/)
6. [Governance & compliance overview](https://learn.microsoft.com/en-us/fabric/governance/governance-compliance-overview) · [Admin monitoring workspace](https://learn.microsoft.com/en-us/fabric/admin/monitoring-workspace) · [Purview + Fabric](https://learn.microsoft.com/en-us/fabric/governance/microsoft-purview-fabric)
7. [FUAM — Fabric Unified Admin Monitoring (microsoft/fabric-toolbox)](https://github.com/microsoft/fabric-toolbox/blob/main/monitoring/fabric-unified-admin-monitoring/README.md)
8. [Microsoft Fabric icons (official)](https://learn.microsoft.com/en-us/fabric/fundamentals/icons)
