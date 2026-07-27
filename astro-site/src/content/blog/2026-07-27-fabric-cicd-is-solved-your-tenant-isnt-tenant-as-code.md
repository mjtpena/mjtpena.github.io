---
title: "Fabric CI/CD Is Solved. Your Tenant Isn't. — Treating a Microsoft Fabric Tenant as Declarative, Source-Controlled Infrastructure"
author: Michael John Peña
draft: false
date: 2026-07-27
description: "Item-level CI/CD in Microsoft Fabric is a settled capability. The unsolved problem is source of truth and tenant governance as code — the workspaces, capacity, domains, tenant settings, connections, and roles that Git integration does not manage. A blueprint for tenant-as-code."
tags:
  - Microsoft Fabric
  - CI/CD
  - DevOps
  - Infrastructure as Code
  - Platform Engineering
---

Shipping Fabric *items* — notebooks, pipelines, semantic models — through Git and a CI runner is a settled problem. Microsoft documents four workflow patterns, and [fabric-cicd](https://github.com/microsoft/fabric-cicd) has emerged as the de-facto deployment tool. The unsolved problem is upstream and around it: **what is the source of truth for the tenant itself**, and **how is platform governance — workspaces, capacity, domains, tenant settings, connections, roles — expressed as reviewable, source-controlled state**. Git integration does not manage that layer. This article treats the Fabric tenant as declarative infrastructure and shows where the item pipeline ends and tenant-as-code begins.

## The four Fabric CI/CD workflow options

Microsoft's [CI/CD workflow options](https://learn.microsoft.com/en-us/fabric/cicd/manage-deployment) article defines exactly four patterns, with the explicit caveat that real deployments often combine them into hybrids. The differentiators map cleanly onto a table.

<div style="overflow-x:auto;margin:1.75rem 0;border:1px solid #27272a;border-radius:12px">
<table style="width:100%;border-collapse:collapse;min-width:820px;font-size:0.88rem">
<thead>
<tr style="background:#15151b">
<th style="text-align:left;padding:12px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Option</th>
<th style="text-align:left;padding:12px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Source of truth</th>
<th style="text-align:left;padding:12px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Branching model</th>
<th style="text-align:left;padding:12px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Deployment mechanism</th>
<th style="text-align:left;padding:12px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Per-stage config</th>
<th style="text-align:left;padding:12px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">When appropriate</th>
</tr>
</thead>
<tbody>
<tr>
<td style="padding:12px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600">1 — Git integration</td>
<td style="padding:12px 14px;color:#00B7C3;border-bottom:1px solid #1c1c22;font-weight:600">Git</td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22">Gitflow (a primary branch per stage)</td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><a href="https://learn.microsoft.com/en-us/rest/api/fabric/core/git/update-from-git" style="color:#00B7C3">Fabric Git APIs</a> (<code style="background:#0f151a;color:#7fd8cf;padding:1px 4px;border-radius:4px;font-size:0.82em">update-from-git</code>)</td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22">Separate per-stage branches</td>
<td style="padding:12px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Git as single source of truth, Gitflow teams, no build-time transform</td>
</tr>
<tr>
<td style="padding:12px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600">2 — Fabric Items APIs</td>
<td style="padding:12px 14px;color:#00B7C3;border-bottom:1px solid #1c1c22;font-weight:600">Git (single <em>Main</em>)</td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22">Trunk-based</td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><a href="https://learn.microsoft.com/en-us/rest/api/fabric/core/items" style="color:#00B7C3">Fabric Items APIs</a> (fabric-cicd or Bulk Import)</td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22">Build-environment scripts</td>
<td style="padding:12px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Trunk-based teams that must transform item definitions before deploy</td>
</tr>
<tr>
<td style="padding:12px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600">3 — Deployment pipelines</td>
<td style="padding:12px 14px;color:#e0a04a;border-bottom:1px solid #1c1c22;font-weight:600">Fabric workspace <span style="color:#71717a;font-weight:400">(Git only through dev)</span></td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22">Trunk-based</td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><a href="https://learn.microsoft.com/en-us/rest/api/fabric/core/deployment-pipelines" style="color:#00B7C3">Deployment pipelines APIs</a></td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22">Deployment rules + autobinding</td>
<td style="padding:12px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Fabric-native, low-code promotion between workspaces</td>
</tr>
<tr>
<td style="padding:12px 14px;color:#e4e4e7;font-family:'Space Grotesk',sans-serif;font-weight:600">4 — CI/CD for ISVs</td>
<td style="padding:12px 14px;color:#00B7C3;font-weight:600">Git (single <em>Main</em>)</td>
<td style="padding:12px 14px;color:#d4d4d8">Trunk-based</td>
<td style="padding:12px 14px;color:#d4d4d8"><a href="https://learn.microsoft.com/en-us/rest/api/fabric/core/items" style="color:#00B7C3">Fabric Items APIs</a> (per customer workspace)</td>
<td style="padding:12px 14px;color:#d4d4d8">Per-customer release parameters</td>
<td style="padding:12px 14px;color:#a1a1aa">ISVs managing hundreds/thousands of per-customer workspaces</td>
</tr>
</tbody>
</table>
</div>

**Option 1** uploads directly from the repo into the workspace; there is no build environment altering files before deployment, which is why it pairs with Gitflow and a branch per stage.

**Option 2** exists precisely because some teams need a build step. You need it "to alter workspace-specific attributes, such as *connectionId* and *lakehouseId*, before deployment" ([manage-deployment](https://learn.microsoft.com/en-us/fabric/cicd/manage-deployment)). In this option the Test and Prod workspaces are **not** Git-connected — item definitions are pushed to them through the Items APIs from `Main`. This is the fabric-cicd path.

**Option 3** is the one whose source of truth is easy to misstate. It is the **Fabric workspace**, not Git — Git connects only through the dev stage, and promotion from dev happens workspace-to-workspace with deployment rules and autobinding. Deployments are linear and require separate pipeline permissions.

**Option 4** is built on top of Option 2 for ISVs: each customer gets its own release with its own parameters, and releases run in parallel because they are independent.

Microsoft's own recommendation for "the most efficient CI/CD experience" is a hybrid — connect the developer workspace to Git and promote with deployment pipelines from there ([CI/CD overview](https://learn.microsoft.com/en-us/fabric/cicd/cicd-overview)). Treat the four as a design vocabulary, not mutually exclusive products.

## Where item CI/CD ends and platform governance begins

Every option above moves **item definitions**. Git integration operates at the workspace level and "re-creates item definitions only and does not restore item data" ([Git integration process](https://learn.microsoft.com/en-us/fabric/cicd/git-integration/git-integration-process)). That boundary — definitions in, everything else out — is the whole story. Here is the concrete state Git integration does **not** manage by default:

- **Workspace creation and naming.** The Git connection is *to* an existing workspace. Nothing in the repo brings a workspace into existence, names it to a convention, or decommissions it.
- **Capacity and domain assignment.** Which capacity backs a workspace, and which domain it belongs to, are tenant-administrative acts. Assigning a domain "requires tenant-level Fabric Administrator privileges" ([Fabric CLI `assign`](https://microsoft.github.io/fabric-cli/commands/fs/assign/)) — it is not a property Git syncs.
- **Tenant settings.** Publish-to-web toggles, SP-access switches, delegation flags — none of these live in a workspace repo. They are read and written through the [admin tenant-settings APIs](https://learn.microsoft.com/en-us/rest/api/fabric/admin/tenants/list-tenant-settings).
- **Connections and gateways.** References to Connections don't auto-bind on deployment; Microsoft's guidance is to "use Variable Libraries with environment-specific value sets to manage connection references across environments" ([cross-workspace dependency binding](https://learn.microsoft.com/en-us/fabric/cicd/cross-workspace-dependency-binding)). The connection object itself is out-of-band state.
- **Roles and access.** Workspace role assignments — who is Admin, Member, Contributor, Viewer — are not carried in item definitions.

There is a subtler failure mode even within item deployment. Some items store dependencies as **object IDs** (workspace-specific GUIDs) rather than **logical IDs** (portable identifiers in the `.platform` file). Items using logical IDs bind to the target workspace; items using object IDs "remain pointed at the source workspace, which breaks the deployment" ([cross-workspace dependency binding](https://learn.microsoft.com/en-us/fabric/cicd/cross-workspace-dependency-binding)). Even Option 1 warns that some dependencies "require these post-deployment updates" through additional API calls ([manage-deployment](https://learn.microsoft.com/en-us/fabric/cicd/manage-deployment)). The item pipeline is not self-sufficient; it assumes a governed platform already exists around it.

## The declarative model: manifest → PR → service principal → provisioning

The missing layer has a reference implementation: Microsoft's [frontier-fabric-governance-rvas](https://github.com/microsoft/frontier-fabric-governance-rvas) blueprint. Its governing principle is unambiguous:

> Treat the Fabric tenant as **declarative infrastructure**. Nothing exists unless a YAML manifest for it lives in `main`, was reviewed via Pull Request, and was provisioned by a service principal through GitHub Actions.

<figure>
<svg viewBox="0 0 760 268" role="img" aria-label="Governance loop: a YAML manifest in main flows through a pull request and validate gate, then on merge an OIDC token authorizes a service principal that provisions Fabric tenant state; a nightly drift job compares live state to the manifests and opens a GitHub issue on divergence, reconciled via a new PR." style="width:100%;height:auto;background:#0c0c11;border-radius:10px">
<style>
.g-t{fill:#e4e4e7;font-family:'Space Grotesk',system-ui,sans-serif;font-size:12.5px}
.g-tm{fill:#a1a1aa;font-family:'Space Grotesk',system-ui,sans-serif;font-size:10.5px}
.g-mo{fill:#7fd8cf;font-family:'JetBrains Mono',monospace;font-size:10px}
.g-lb{fill:#8a939b;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.03em}
.g-box{fill:#15151b;stroke:#3f3f46;stroke-width:1.3}
.g-cy{fill:#0b2b2e;stroke:#00B7C3;stroke-width:1.4}
.g-az{fill:#0a1f33;stroke:#0078D4;stroke-width:1.4}
.g-ed{stroke:#0078D4;stroke-width:1.6;fill:none}
.g-ef{fill:#0078D4}
.g-dash{stroke:#6d757d;stroke-width:1.4;fill:none;stroke-dasharray:5 5}
</style>
<defs><marker id="gah" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" class="g-ef"/></marker>
<marker id="gahd" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#6d757d"/></marker></defs>
<!-- main pipeline row -->
<rect x="14" y="52" width="142" height="56" rx="9" class="g-box"/>
<text x="85" y="77" text-anchor="middle" class="g-t">Manifest (YAML)</text>
<text x="85" y="93" text-anchor="middle" class="g-mo">in main</text>
<rect x="170" y="52" width="150" height="56" rx="9" class="g-cy"/>
<text x="245" y="77" text-anchor="middle" class="g-t">PR + validate gate</text>
<text x="245" y="93" text-anchor="middle" class="g-tm">schema + policy</text>
<rect x="334" y="52" width="126" height="56" rx="9" class="g-cy"/>
<text x="397" y="77" text-anchor="middle" class="g-t">OIDC &rarr; token</text>
<text x="397" y="93" text-anchor="middle" class="g-tm">no stored secret</text>
<rect x="474" y="52" width="126" height="56" rx="9" class="g-box"/>
<text x="537" y="77" text-anchor="middle" class="g-t">Service principal</text>
<text x="537" y="93" text-anchor="middle" class="g-tm">provisions</text>
<rect x="614" y="52" width="132" height="56" rx="9" class="g-az"/>
<text x="680" y="76" text-anchor="middle" class="g-t">Fabric tenant</text>
<text x="680" y="92" text-anchor="middle" class="g-mo">ws·cap·domain·roles</text>
<!-- arrows -->
<line x1="156" y1="80" x2="168" y2="80" class="g-ed" marker-end="url(#gah)"/>
<line x1="320" y1="80" x2="332" y2="80" class="g-ed" marker-end="url(#gah)"/>
<line x1="460" y1="80" x2="472" y2="80" class="g-ed" marker-end="url(#gah)"/>
<line x1="600" y1="80" x2="612" y2="80" class="g-ed" marker-end="url(#gah)"/>
<text x="397" y="44" text-anchor="middle" class="g-lb">on merge to main</text>
<!-- drift node -->
<rect x="250" y="196" width="270" height="48" rx="9" class="g-box"/>
<text x="385" y="217" text-anchor="middle" class="g-t">Nightly drift job (cron)</text>
<text x="385" y="233" text-anchor="middle" class="g-tm">opens a GitHub issue on divergence</text>
<!-- tenant -> drift -->
<path d="M680,108 C 680,170 590,220 522,220" class="g-ed" marker-end="url(#gah)"/>
<!-- drift -> manifest (dashed reconcile) -->
<path d="M250,220 C 120,220 85,168 85,110" class="g-dash" marker-end="url(#gahd)"/>
<text x="150" y="168" text-anchor="middle" class="g-lb">reconcile via new PR</text>
</svg>
<figcaption><strong>Figure 1.</strong> The tenant-as-code loop. A manifest change is reviewed and validated, then on merge a federated (secret-free) service principal provisions the tenant. A scheduled drift job reconciles live state against the manifests and raises a tracked issue when they diverge — closing the loop through another PR.</figcaption>
</figure>

The change flow is literally `PR → validate → OIDC provision → drift` ([README](https://raw.githubusercontent.com/microsoft/frontier-fabric-governance-rvas/main/README.md)). A workspace manifest is a YAML file with a strict, validated shape — the [sample manifest](https://raw.githubusercontent.com/microsoft/frontier-fabric-governance-rvas/main/workspaces/pt-nlyt-sample-ndf-dev-hello1.yaml) carries `name`, `capacity`, `region`, `domain`, `subDomain`, `sensitivityLabel`, `costCenter`, and an `owners` array with `principalType`/`role`/`groupName`. A [JSON Schema](https://raw.githubusercontent.com/microsoft/frontier-fabric-governance-rvas/main/schemas/workspace.schema.json) enforces a naming pattern (`<country>-<area>-<subject>-<dataProductType>-<env>-<suffix>`) and rules like "at least two owners, at least one Group, at least one Admin." Governance policy — approved capacities, domains, sensitivity labels, cost centers, quotas — lives in a separate `rules/policy.yaml`, designed so "you can evolve governance without changing scripts." Provisioning is idempotent: `provision.py` looks a workspace up by display name, creates it if absent, reconciles capacity and description, and adds missing role assignments **additively** — it deliberately does not remove unknown assignments, to avoid locking the automation out of its own workspaces.

The blueprint spans exactly the state the item pipeline ignores: workspace lifecycle, domains/capacities/sensitivity/endorsement, group-based access with expiring assignments, medallion bootstrap, and cross-environment promotion via deployment pipelines. (Note it is a workshop/blueprint repo; its public workflows are dormant by design until you fork and register a runner.)

**What belongs in Git:** workspace and platform manifests, item definitions, parameter files, policy/rules files, JSON schemas, and pipeline/workflow definitions. **What does not:** secrets, client secrets, tokens, per-stage secret values, and ephemeral runtime state. The provisioner in the blueprint holds **no client secret at all** — credentials are federated, not stored. That is the model to copy.

## Service principal design

Two distinct axes govern SP design: which **admin API surface** the identity can touch, and where its **credential** lives.

### The admin-API surface

Fabric splits read from write with two separate tenant settings, each independently scoped to its own Entra security group:

- **"Service principals can access read-only admin APIs"** governs Power BI read-only admin APIs. An SP used here "**must not** have any admin-consent required permissions for Power BI set on it" ([enable SP admin APIs](https://learn.microsoft.com/en-us/fabric/admin/enable-service-principal-admin-apis)). Membership in the allowed group grants read access to all the information available through admin APIs, current and future.
- **"Service principals can access admin APIs used for updates"** governs Fabric update APIs, "such as the Workspaces - Restore Workspace API" ([enable SP admin APIs](https://learn.microsoft.com/en-us/fabric/admin/enable-service-principal-admin-apis)).

Because each toggle has its own "Specific security groups" scope, least privilege is implemented by **separating identities**: a read-only identity in the read group for inventory, drift detection, and reporting; a write identity in the update group for provisioning. Enabling the settings themselves requires Fabric admin rights, a control point separate from group membership. State one nuance accurately: the API that **modifies tenant settings** — [`POST /v1/admin/tenantsettings/{tenantSettingName}/update`](https://learn.microsoft.com/en-us/rest/api/fabric/admin/tenants/update-tenant-setting) — is explicitly **Preview**, "not recommended for production use," capped at 25 requests/minute, requiring `Tenant.ReadWrite.All`. [Listing](https://learn.microsoft.com/en-us/rest/api/fabric/admin/tenants/list-tenant-settings) tenant settings carries no Preview banner (effectively GA); programmatic *writes* are explicitly Preview.

### The credential

The blueprint's identity model is the pattern to emulate: a single app registration (`gh-fabric-workspace-provisioner`) is "the *only* identity allowed to write to Fabric in production," and "the SPN never holds a client secret; GitHub trades its short-lived OIDC token for a Fabric access token at runtime." It carries **three federated credentials** scoped to distinct GitHub OIDC subject claims — `pull_request` (read-only checks), `ref:refs/heads/main` (drift), and `environment:production` (write, only after environment approval), all with audience `api://AzureADTokenExchange`. Its granted roles are Fabric Administrator, Capacity Admin per in-scope capacity, and MIP label-publishing membership — and humans do not get the Fabric Administrator role, ownership of the SPN, or the ability to push to `main`. Where a stored secret is unavoidable it belongs in Key Vault, never the repo; OIDC/federated credentials eliminate the secret entirely and are the preferred design.

## Environment configuration without hardcoding

Per-stage values must be injected, never committed as literals into item definitions. Fabric gives you three mechanisms, matched to the three Git-based options.

### Variable Library

The Fabric-native, GA approach. It is "a bucket of variables that other items in the workspace can consume," where "each variable can have multiple value-sets… One value-set is designated as 'active' per workspace" and "you can have a different active value set for each stage of a deployment pipeline" ([Variable Library overview](https://learn.microsoft.com/en-us/fabric/cicd/variable-library/variable-library-overview)). Consumers include pipelines, notebooks, Dataflow Gen2, Copy jobs, and lakehouse shortcuts. This is the recommended way to carry connection references across environments.

### Deployment rules

These apply in Option 3. When promoting between stages you "configure deployment rules to change the content while keeping some settings intact" — e.g. pointing a production semantic model at a production database. Rules come in three types (data source, parameter, default lakehouse), "can't be created in the development stage," and "only take effect the next time you deploy" ([create deployment rules](https://learn.microsoft.com/en-us/fabric/cicd/deployment-pipelines/create-rules)).

### fabric-cicd `parameter.yml`

Build-time transforms in Option 2. fabric-cicd performs a full deployment on every run — it "does not inspect commit history or compute diffs," so "the target workspace always reflects the repository and converges to the desired state… preventing environment drift" ([deployment overview](https://microsoft.github.io/fabric-cicd/latest/how_to/deployment_overview/)). The `environment` argument selects which environment key is applied. The library exposes a small, keyword-only API — note `token_credential` is now **required**:

```python
from azure.identity import AzureCliCredential
from fabric_cicd import FabricWorkspace, publish_all_items, unpublish_all_orphan_items

target_workspace = FabricWorkspace(
    workspace_id="your-workspace-guid",
    repository_directory="/path/to/repo",
    item_type_in_scope=["Notebook", "DataPipeline", "Environment", "VariableLibrary"],
    environment="PPE",
    token_credential=AzureCliCredential(),
)

publish_all_items(target_workspace)
unpublish_all_orphan_items(target_workspace)
```

`item_type_in_scope` accepts the [29 supported types](https://microsoft.github.io/fabric-cicd/latest/reference/item_types/) in exact casing: `Notebook`, `DataPipeline`, `Lakehouse`, `Warehouse`, `SemanticModel`, `Report`, `Environment`, `Eventhouse`, `Eventstream`, `KQLDatabase`, `KQLQueryset`, `KQLDashboard`, `Dataflow`, `CopyJob`, `SparkJobDefinition`, `MirroredDatabase`, `GraphQLApi`, `SQLDatabase`, `UserDataFunction`, `VariableLibrary`, `MLExperiment`, `DataAgent`, `ApacheAirflowJob`, `DataBuildToolJob`, `MountedDataFactory`, `Map`, `PaginatedReport`, `Reflex`, and `Ontology`. Omitting the argument defaults to all types.

A `parameter.yml` at the repo root drives the transform. Current fields are `find_value`, `replace_value` (an environment-keyed dict), and optional `is_regex` / `ignore_case` plus `item_type` / `item_name` / `file_path` filters — there is no `input_type` field:

```yaml
find_replace:
  - find_value: "db52be81-c2b2-4261-84fa-840c67f4bbd0"
    replace_value:
      PPE:  "$items.Lakehouse.Example_LH.$id"
      PROD: "$items.Lakehouse.Example_LH.$id"
    is_regex: "true"
    item_type: "Notebook"
    file_path: "**/notebook-content.py"

key_value_replace:
  - find_key: $.properties.activities[?(@.name=="Run Notebook")].typeProperties.notebookId
    replace_value:
      PPE:  "$items.Notebook.Hello World.$id"
      PROD: "$items.Notebook.Hello World.$id"
    item_type: "DataPipeline"
```

`find_replace` does string substitution; `key_value_replace` does JSONPath key replacement. Dynamic tokens like `$workspace.$id` and `$items.<Type>.<Name>.$id` resolve against the target environment.

## A concrete GitHub Actions reference flow

The flow that ties this together: OIDC login (no stored secret), install tooling, a validation gate that fails the PR before anything touches the tenant, and a deploy job gated behind an environment approval on merge to `main`.

```yaml
name: fabric-deploy
on:
  pull_request:
    paths: ["workspaces/**", "src/items/**", "parameter.yml"]
  push:
    branches: [main]
    paths: ["workspaces/**", "src/items/**", "parameter.yml"]

permissions:
  id-token: write        # required for OIDC
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          allow-no-subscriptions: true
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install fabric-cicd ms-fabric-cli
      - name: Validate manifests and item scope (dry run)
        run: python scripts/validate.py --changed-only

  deploy:
    if: github.ref == 'refs/heads/main'
    needs: validate
    runs-on: ubuntu-latest
    environment: production          # manual approval gate
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          allow-no-subscriptions: true
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install fabric-cicd
      - name: Publish item definitions
        env:
          TARGET_WORKSPACE_ID: ${{ vars.PROD_WORKSPACE_ID }}
        run: python scripts/deploy.py --environment PROD
```

The [Fabric CLI](https://microsoft.github.io/fabric-cli/) (`fab`, installed via `pip install ms-fabric-cli`) complements this for platform operations the item libraries don't cover — it authenticates with a federated token (`fab auth login --federated-token <token> --tenant <id>`) and reaches admin surfaces directly (`fab api -X get workspaces`), including workspace creation (`fab mkdir`) and capacity/domain assignment (`fab assign`), the latter requiring Fabric Administrator rights. The blueprint's own workflows follow this shape exactly: `validate.yml` on `pull_request` posts a report as a PR gate, `provision.yml` runs on push to `main` behind `environment: production`, and `drift.yml` runs nightly on cron, opening a GitHub issue when live state diverges from the manifests.

## Anti-patterns

- **Portal-only production changes.** Any change made directly in a production workspace is invisible to Git and will be silently reverted by the next full fabric-cicd run, which "converges to the desired state regardless of what happened in previous runs" ([deployment overview](https://microsoft.github.io/fabric-cicd/latest/how_to/deployment_overview/)). The portal is for the dev workspace, not prod.
- **Manual workspace creation.** Clicking "New workspace" produces an unnamed, unpoliced, untracked object. If it isn't a manifest in `main`, it doesn't exist.
- **Untracked tenant settings.** Toggling SP-access or publish-to-web in the admin portal with no record is unauditable configuration drift at the most privileged layer of the platform.
- **Secrets in the repo.** Client secrets, tokens, and per-stage secret values never belong in Git. Use federated OIDC credentials, or Key Vault where a secret is unavoidable.
- **No per-stage parameterization.** Hardcoding a dev `lakehouseId` or `connectionId` into an item definition guarantees a broken prod deploy. Use Variable Libraries, deployment rules, or `parameter.yml`.
- **Drift with no reconciliation.** Without a scheduled drift job comparing manifests to live tenant state, governance is aspirational. Detection must open a tracked issue, as the blueprint's nightly `drift.yml` does.

## Definition of done for tenant-as-code

You have reached tenant-as-code when: every workspace, capacity assignment, domain, role grant, and governed tenant setting originates from a version-controlled manifest merged through PR review; no human holds standing write access to production Fabric — a federated service principal provisions, and its credential is short-lived and secret-free; per-stage values are injected through Variable Libraries, deployment rules, or `parameter.yml`, never hardcoded; a scheduled job reconciles declared state against live state and raises a tracked issue on drift; and the only thing a portal is used for in production is reading. Item CI/CD gets you a repeatable deployment. Tenant-as-code gets you a platform whose entire configuration is reviewable, auditable, and replayable — which is the part Git integration was never going to give you.

## References

Verified against Microsoft Learn (retrieved July 2026), the `microsoft/fabric-cicd` v1.2.0 docs and source, `microsoft/frontier-fabric-governance-rvas`, and the Fabric CLI docs. Preview features (the tenant-settings write API; the governance blueprint's dormant workflows) should be re-checked against the live product before you rely on them.

1. [CI/CD workflow options in Fabric (Microsoft Learn)](https://learn.microsoft.com/en-us/fabric/cicd/manage-deployment)
2. [Introduction to CI/CD in Microsoft Fabric (Microsoft Learn)](https://learn.microsoft.com/en-us/fabric/cicd/cicd-overview)
3. [Overview of Fabric Git integration](https://learn.microsoft.com/en-us/fabric/cicd/git-integration/intro-to-git-integration) · [Git integration process](https://learn.microsoft.com/en-us/fabric/cicd/git-integration/git-integration-process)
4. [Cross-workspace dependency binding (Microsoft Learn)](https://learn.microsoft.com/en-us/fabric/cicd/cross-workspace-dependency-binding)
5. [Variable Library overview](https://learn.microsoft.com/en-us/fabric/cicd/variable-library/variable-library-overview) · [Create deployment rules](https://learn.microsoft.com/en-us/fabric/cicd/deployment-pipelines/create-rules)
6. [Enable service principals to use admin APIs](https://learn.microsoft.com/en-us/fabric/admin/enable-service-principal-admin-apis) · [List Tenant Settings](https://learn.microsoft.com/en-us/rest/api/fabric/admin/tenants/list-tenant-settings) · [Update Tenant Setting (Preview)](https://learn.microsoft.com/en-us/rest/api/fabric/admin/tenants/update-tenant-setting)
7. [microsoft/fabric-cicd](https://github.com/microsoft/fabric-cicd) · [docs](https://microsoft.github.io/fabric-cicd/) · [supported item types](https://microsoft.github.io/fabric-cicd/latest/reference/item_types/)
8. [microsoft/frontier-fabric-governance-rvas](https://github.com/microsoft/frontier-fabric-governance-rvas)
9. [Microsoft Fabric CLI (`fab`)](https://microsoft.github.io/fabric-cli/)
