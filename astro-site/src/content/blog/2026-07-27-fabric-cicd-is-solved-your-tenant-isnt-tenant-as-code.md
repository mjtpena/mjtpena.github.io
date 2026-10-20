---
title: "Fabric Item CI/CD Is Mostly Solved. Your Tenant Isn't"
author: Michael John Peña
draft: false
date: 2026-07-27
description: "Git integration and fabric-cicd ship Fabric items well. Workspaces, capacity, domains, roles and tenant settings still need their own source of truth."
tags:
  - Microsoft Fabric
  - CI/CD
  - Governance
  - Infrastructure as Code
  - GitHub Actions
---

Getting notebooks, pipelines and semantic models from Git into a Fabric workspace is mostly a solved problem, with a few sharp edges left. Microsoft documents four workflow patterns for it, and the fabric-cicd Python library [reached 1.0 on 20 April 2026](https://microsoft.github.io/fabric-cicd/latest/changelog/). What most teams still haven't answered is where the tenant itself is defined: who created that workspace, which capacity and domain it sits in, who holds Admin, and which tenant setting someone flipped last quarter. Git integration doesn't manage any of that, and that's where Fabric platforms drift.

I covered the item pipeline itself back in [Fabric CI/CD: Building Deployment Pipelines](/blog/2024-04-07-fabric-cicd/). This post is about the layer around it.

## Four ways to ship items, one gap

Microsoft Learn's [CI/CD workflow options article](https://learn.microsoft.com/en-us/fabric/cicd/manage-deployment) describes four patterns and says real deployments often mix them:

<div style="overflow-x:auto;margin:1.75rem 0;border:1px solid #27272a;border-radius:12px">
<table style="width:100%;border-collapse:collapse;min-width:820px;font-size:0.88rem">
<thead>
<tr style="background:#15151b">
<th style="text-align:left;padding:12px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Option</th>
<th style="text-align:left;padding:12px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Source of truth</th>
<th style="text-align:left;padding:12px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Branching model</th>
<th style="text-align:left;padding:12px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Deployment mechanism</th>
<th style="text-align:left;padding:12px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Per-stage config</th>
<th style="text-align:left;padding:12px 14px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Fits</th>
</tr>
</thead>
<tbody>
<tr>
<td style="padding:12px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600">1 — Git integration</td>
<td style="padding:12px 14px;color:#00B7C3;border-bottom:1px solid #1c1c22;font-weight:600">Git</td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22">Gitflow (a primary branch per stage)</td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><a href="https://learn.microsoft.com/en-us/rest/api/fabric/core/git/update-from-git" style="color:#00B7C3">Fabric Git APIs</a> (<code style="background:#0f151a;color:#7fd8cf;padding:1px 4px;border-radius:4px;font-size:0.82em">update-from-git</code>)</td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22">Separate branches</td>
<td style="padding:12px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Teams who want Git as the only origin and no definition transforms before deploy</td>
</tr>
<tr>
<td style="padding:12px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600">2 — Fabric Items APIs</td>
<td style="padding:12px 14px;color:#00B7C3;border-bottom:1px solid #1c1c22;font-weight:600">Git (single <em>Main</em>)</td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22">Trunk-based</td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><a href="https://learn.microsoft.com/en-us/rest/api/fabric/core/items" style="color:#00B7C3">Fabric Items APIs</a> (fabric-cicd or bulk import)</td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22">Build-environment scripts</td>
<td style="padding:12px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Teams who must rewrite IDs or connections before deploy</td>
</tr>
<tr>
<td style="padding:12px 14px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600">3 — Deployment pipelines</td>
<td style="padding:12px 14px;color:#e0a04a;border-bottom:1px solid #1c1c22;font-weight:600">Fabric workspace <span style="color:#71717a;font-weight:400">(Git only through dev)</span></td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22">Trunk-based</td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><a href="https://learn.microsoft.com/en-us/rest/api/fabric/core/deployment-pipelines" style="color:#00B7C3">Deployment pipelines APIs</a></td>
<td style="padding:12px 14px;color:#d4d4d8;border-bottom:1px solid #1c1c22">Deployment rules and autobinding</td>
<td style="padding:12px 14px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Fabric-native, low-code promotion</td>
</tr>
<tr>
<td style="padding:12px 14px;color:#e4e4e7;font-family:'Space Grotesk',sans-serif;font-weight:600">4 — CI/CD for ISVs</td>
<td style="padding:12px 14px;color:#00B7C3;font-weight:600">Git (single <em>Main</em>)</td>
<td style="padding:12px 14px;color:#d4d4d8">Trunk-based</td>
<td style="padding:12px 14px;color:#d4d4d8"><a href="https://learn.microsoft.com/en-us/rest/api/fabric/core/items" style="color:#00B7C3">Fabric Items APIs</a> (per customer workspace)</td>
<td style="padding:12px 14px;color:#d4d4d8">Per-customer release parameters</td>
<td style="padding:12px 14px;color:#a1a1aa">ISVs with hundreds of customer workspaces</td>
</tr>
</tbody>
</table>
</div>

In option 3 the source of truth after dev is a Fabric workspace, not your repo. The pipeline, its stage assignments and any workspace it creates for an empty stage are tenant-layer objects, so the manifests should own them: pre-create the stage workspaces rather than letting a deploy create them with default settings.

All four options move **item definitions** into workspaces; none of them governs **the workspaces themselves**. Here is what sits outside the item pipeline:

- **Workspace lifecycle.** You connect Git *to* a workspace. Nothing in the repo creates one, enforces a naming convention or retires it.
- **Capacity and domain.** Assigning a workspace to a capacity needs workspace Admin plus contributor rights on the capacity. Assigning it to a domain through the admin Domains APIs needs Fabric Administrator (check each API's supported identities before automating it with a service principal); domain admins and contributors can also do it in the portal.
- **Tenant settings.** Publish to web, service principal access, delegation to capacity admins. These live in the admin portal and admin APIs, not a workspace repo.
- **Connections and gateways.** fabric-cicd's own item type notes say connections aren't source controlled and must be created separately.
- **Workspace roles.** Who is Admin, Member, Contributor or Viewer isn't part of an item definition.

<div class="cl cl-key">
<div class="cl-tag">The boundary</div>
<div class="cl-body">

Git integration versions **item definitions**. Everything that makes those items usable in production — the workspace itself, its capacity and domain, its connections, and who can touch it — lives *outside* Git unless you put it there.

</div>
</div>

Even inside the item layer, Microsoft's page on [cross-workspace dependency binding](https://learn.microsoft.com/en-us/fabric/cicd/cross-workspace-dependency-binding) warns that items which store dependencies as workspace-specific object IDs, rather than logical IDs, stay pointed at the source workspace after deployment, which breaks it. The item pipeline assumes a governed platform around it, and I'd rather that platform be built by pull request than by portal click.

## A reference blueprint for the tenant layer

Microsoft has published a workshop-style repo that takes this on directly: [microsoft/frontier-fabric-governance-rvas](https://github.com/microsoft/frontier-fabric-governance-rvas). Its principle is the one I'd adopt: nothing exists in the tenant unless a YAML manifest for it lives in `main`, was reviewed through a pull request and was provisioned by a service principal through GitHub Actions.

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 308" role="img" aria-label="Governance loop: a YAML manifest in main flows through a pull request and validate gate, then on merge an OIDC token authorises a service principal that provisions Fabric tenant state; a nightly drift job compares live state to the manifests and opens a GitHub issue on divergence, reconciled via a new PR.">
<defs>
<marker id="tcF" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah-flow"/></marker>
<marker id="tcN" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah"/></marker>
<marker id="tcD" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah-dash"/></marker>
</defs>
<rect x="20" y="44" width="860" height="120" rx="16" class="ff-zone ff-zone-flow"/>
<text x="40" y="66" class="ff-zlabel">PR → PROVISION · ON MERGE TO MAIN</text>
<rect x="40" y="80" width="150" height="68" rx="11" class="ff-node"/>
<text x="115" y="112" text-anchor="middle" class="ff-title">Manifest (YAML)</text>
<text x="115" y="130" text-anchor="middle" class="ff-tok">in main</text>
<rect x="208" y="80" width="158" height="68" rx="11" class="ff-node ff-node-cy"/>
<text x="287" y="112" text-anchor="middle" class="ff-title">PR + validate gate</text>
<text x="287" y="130" text-anchor="middle" class="ff-sub">schema + policy</text>
<rect x="384" y="80" width="140" height="68" rx="11" class="ff-node ff-node-cy"/>
<text x="454" y="112" text-anchor="middle" class="ff-title">OIDC &rarr; token</text>
<text x="454" y="130" text-anchor="middle" class="ff-sub">no stored secret</text>
<rect x="542" y="80" width="150" height="68" rx="11" class="ff-node"/>
<text x="617" y="112" text-anchor="middle" class="ff-title">Service principal</text>
<text x="617" y="130" text-anchor="middle" class="ff-sub">provisions</text>
<rect x="710" y="80" width="150" height="68" rx="11" class="ff-node ff-node-az"/>
<image href="/icons/fabric/group_workspace_48_non-item.svg" x="735" y="88" width="22" height="22"/>
<image href="/icons/fabric/lakehouse_48_item.svg" x="761" y="88" width="22" height="22"/>
<image href="/icons/fabric/data_warehouse_48_item.svg" x="787" y="88" width="22" height="22"/>
<image href="/icons/fabric/semantic_model_48_item.svg" x="813" y="88" width="22" height="22"/>
<text x="785" y="128" text-anchor="middle" class="ff-title">Fabric tenant</text>
<text x="785" y="142" text-anchor="middle" class="ff-tok">ws · cap · roles</text>
<line x1="192" y1="114" x2="206" y2="114" class="ff-edge-flow" marker-end="url(#tcF)"/>
<line x1="368" y1="114" x2="382" y2="114" class="ff-edge-flow" marker-end="url(#tcF)"/>
<line x1="526" y1="114" x2="540" y2="114" class="ff-edge-flow" marker-end="url(#tcF)"/>
<line x1="694" y1="114" x2="708" y2="114" class="ff-edge-flow" marker-end="url(#tcF)"/>
<rect x="300" y="212" width="300" height="54" rx="11" class="ff-node"/>
<text x="450" y="236" text-anchor="middle" class="ff-title">Nightly drift job (cron)</text>
<text x="450" y="254" text-anchor="middle" class="ff-sub">opens a GitHub issue on divergence</text>
<path d="M785,148 C 785,196 660,239 602,239" class="ff-edge" marker-end="url(#tcN)"/>
<path d="M300,239 C 160,239 115,196 115,150" class="ff-edge-dash" marker-end="url(#tcD)"/>
<text x="182" y="200" text-anchor="middle" class="ff-lgd" style="fill:#8a939b">reconcile via new PR</text>
<line x1="30" y1="290" x2="58" y2="290" class="ff-edge-flow"/>
<text x="65" y="294" class="ff-lgd">provision on merge</text>
<line x1="182" y1="290" x2="210" y2="290" class="ff-edge-dash"/>
<text x="217" y="294" class="ff-lgd">reconcile via PR</text>
<text x="352" y="294" class="ff-lgd" style="fill:#6f787f">· official Microsoft Fabric icons</text>
</svg>
<figcaption><strong>Figure 1.</strong> The tenant-as-code loop. A manifest change is reviewed and validated, then on merge a federated (secret-free) service principal provisions the tenant. A scheduled drift job reconciles live state against the manifests and raises a tracked issue when they diverge. That closes the loop through another PR. The tenant box shows the target state; the Challenge 01 scripts manage workspaces, capacity and roles.</figcaption>
</figure>

The pieces are worth copying even if you never run the repo:

- **Manifests.** One YAML file per workspace under `workspaces/`, carrying name, capacity, region, domain, sub-domain, sensitivity label, cost centre and an `owners` list of principals and roles.
- **A schema.** A JSON Schema enforces the naming pattern `<country>-<area>-<subject>-<dataProductType>-<env>-<suffix>` and at least two owners.
- **A policy file.** `rules/policy.yaml` holds approved capacities, domains, sensitivity labels, cost centres and per-group quotas, plus rules such as "at least one owner is a Group" and "at least one owner is Admin". Its header says to edit it "to evolve governance without changing scripts", the right separation.
- **An idempotent provisioner.** `provision.py` finds a workspace by display name, creates it if it's missing, sets the description and capacity, and adds any missing role assignments. Domain and sensitivity-label assignment come in a later challenge, not this script. It deliberately never removes assignments it doesn't recognise, with the comment "do NOT remove unknown to avoid locking ourselves out".
- **Three workflows.** `validate.yml` runs on pull requests, `provision.yml` runs on merge to `main` behind a `production` environment approval, and `drift.yml` runs on a schedule to compare live state against the manifests. In Challenge 01, `drift.py` reports only unmanaged workspaces, missing workspaces and description mismatches. Capacity, domain and role drift are checks you add yourself.

That additive role behaviour is a conscious trade-off: safe, but a manifest can't revoke access granted by hand. If you adopt it, make drift detection report unexpected role assignments and remove them through a reviewed change.

### Why not the Terraform provider?

Microsoft's CI/CD overview suggests the Terraform provider for Microsoft Fabric for workspaces and capacities, with fabric-cicd for items. [GA since March 2025](https://registry.terraform.io/providers/microsoft/fabric/latest), it covers `fabric_workspace` (including its `capacity_id`), `fabric_workspace_role_assignment`, `fabric_domain`, `fabric_deployment_pipeline` and, in preview, `fabric_domain_workspace_assignments`.

| | Terraform provider | Scripts and YAML manifests |
|---|---|---|
| Drift detection | Built in: `terraform plan` diffs every resource in state | You write and maintain each check |
| State | A state file to store, lock and protect | None; live tenant is compared to Git each run |
| Unmanaged objects | Invisible to `plan` unless imported | A script can list everything and flag strays |
| Policy | Separate tooling (validation blocks, OPA, Sentinel) | Policy is a reviewed YAML file the same scripts read |
| Reviewer skill needed | HCL plus provider semantics and plan output | YAML plus the policy file |

I'd pick Terraform if your platform team already runs it for Azure: you get plan-based drift and one state model across capacity, Entra groups and workspaces. I'd pick manifests when the people requesting workspaces aren't infrastructure engineers, when governance rules should read as policy rather than code, or when you don't want another state file to protect.

Treat the repo as a blueprint, not a product: adapt the workshop challenges before anything touches production.

## Designing the service principals

### Split read from write

Fabric has two Admin API tenant settings for service principals, each scoped to its own security group ([enable service principal admin APIs](https://learn.microsoft.com/en-us/fabric/admin/enable-service-principal-admin-apis)):

- **Service principals can access read-only admin APIs** covers the read-only admin APIs.
- **Service principals can access admin APIs used for updates** covers Fabric admin APIs that change state, such as Restore Workspace.

The app behind either setting must not have any admin-consent-required Fabric permissions in Entra ID.

My rule of thumb is two identities: a read identity in the first group for inventory, reporting and drift detection, and a write identity in the second group used only by the provisioning job.

The write identity also needs two Developer settings, scoped to its own group: **Service principals can create workspaces, connections, and deployment pipelines** and **Service principals can call Fabric public APIs**. Create Workspace, Assign to Capacity and Add Workspace Role Assignment are non-admin APIs gated by those settings, so without them workspace creation and role grants fail. The item-deploy identity also needs to be in the group for **Service principals can call Fabric public APIs** (it doesn't need the create-workspaces setting or any admin setting).

Be careful with tenant settings as code. Listing tenant settings is a stable admin API, but the [Update Tenant Setting API](https://learn.microsoft.com/en-us/rest/api/fabric/admin/tenants/update-tenant-setting) is still in preview, is rate-limited to 25 requests a minute, and needs the delegated `Tenant.ReadWrite.All` scope for a user caller; a service principal instead needs to be in the group for **Service principals can access admin APIs used for updates**, with no Fabric API permissions on the app. I'd version the desired settings in Git and alert on drift with the list API, and automate writes only once you trust a preview API with your most privileged configuration.

### No stored secret

The blueprint uses one app registration, `gh-fabric-workspace-provisioner`, with three federated credentials matched to GitHub OIDC subjects: `pull_request` for read-only checks, `ref:refs/heads/main` for drift and `environment:production` for writes after approval, all with audience `api://AzureADTokenExchange`. GitHub swaps a short-lived OIDC token for an Entra token at run time, so there's no client secret to rotate or leak.

It also grants that identity Fabric Administrator, Capacity Admin on each in-scope capacity and membership of the sensitivity-label publishing scope, while humans can't push to `main`. That's a lot of power, defensible only because nothing drives it except reviewed merges and an environment gate. If your branch protection is weak, split the identity further.

## Per-stage values without hardcoding

The failure I see most often when a Fabric deployment works in dev and breaks in prod is a hardcoded ID. Fabric gives you three ways to inject them.

**[Variable libraries](https://learn.microsoft.com/en-us/fabric/cicd/variable-library/variable-library-overview)** are generally available. A variable library holds variables with multiple value sets, one of which is active per workspace, and pipelines, notebooks, Dataflow Gen2, Copy job and shortcuts can consume them. This is my default for anything a running item needs to know about its environment.

**Deployment rules** apply to option 3. Data source, parameter and default lakehouse rules are set on the target stage and take effect on the next deployment.

**`parameter.yml`** is fabric-cicd's build-time transform for option 2. fabric-cicd 1.0 made `token_credential` a required, keyword-only argument and dropped the `DefaultAzureCredential` fallback, so pass a credential explicitly. In a GitHub Actions job that's already signed in with `azure/login`, `AzureCliCredential` picks up that session:

<div class="code-title">scripts/publish_items.py</div>

```python
import os

from azure.identity import AzureCliCredential
from fabric_cicd import FabricWorkspace, publish_all_items, unpublish_all_orphan_items

target_workspace = FabricWorkspace(
    workspace_id=os.environ["TARGET_WORKSPACE_ID"],
    repository_directory="src/items",
    item_type_in_scope=["Lakehouse", "Notebook", "DataPipeline", "Environment", "VariableLibrary"],
    environment=os.environ["TARGET_ENVIRONMENT"],
    token_credential=AzureCliCredential(),
)

publish_all_items(target_workspace)
unpublish_all_orphan_items(target_workspace)
```

`item_type_in_scope` accepts fabric-cicd's supported item type names, with exact casing; leave it out to deploy everything. The `environment` value selects which key in `parameter.yml` applies:

<div class="code-title">src/items/parameter.yml</div>

```yaml
find_replace:
  # Dev lakehouse GUID referenced by notebooks
  - find_value: "<dev-lakehouse-guid>"
    replace_value:
      _ALL_: "$items.Lakehouse.Example_LH.$id"
    item_type: "Notebook"

key_value_replace:
  - find_key: $.properties.activities[?(@.name=="Run Notebook")].typeProperties.notebookId
    replace_value:
      _ALL_: "$items.Notebook.Hello World.$id"
    item_type: "DataPipeline"
```

`$items.<type>.<name>.$id` resolves to the item's ID in the target workspace at deploy time, so one value works for every stage, and the `_ALL_` key applies it to whichever `environment` the job passes. Swap `_ALL_` for per-stage keys (`PPE`, `PROD`) once the values need to diverge; `_ALL_` must be the only key when you use it. A few resolution rules are worth knowing:

- **Scope.** The parameterization guide only guarantees resolution for items in `repository_directory`. Current releases also resolve a lakehouse created by a bootstrap step (the blueprint's medallion-bootstrap challenge) when `Lakehouse` isn't in `item_type_in_scope`, but I wouldn't rely on it.
- **Pre-created items.** Keep `Example_LH` in the repo and `Lakehouse` in `item_type_in_scope`, as the script above does, or reference a pre-created item explicitly with `$workspace.<name>.$items.Lakehouse.Example_LH.$id`.
- **Regex.** For a regex `find_value`, set `is_regex: "true"` and wrap the value to replace in a capture group.

By default fabric-cicd runs a full deployment rather than diffing commits (1.0 added `get_changed_items()` for opt-in selective deploys). The full run is what makes it converge, and it's also why a hotfix typed into the prod portal disappears on the next run.

## Wiring it into GitHub Actions

The workflow below validates on every pull request and, on merge, provisions the tenant layer before publishing items. Only the two jobs that sign in get an OIDC grant; the pull request job runs with read-only repository access. `scripts/validate.py` and `scripts/provision.py` stand in for your own manifest checks and idempotent provisioner.

- **provision:** runs as the Fabric Administrator write identity behind the `production` environment approval.
- **deploy:** uses a separate app (`FABRIC_DEPLOY_CLIENT_ID`) with only Contributor on the target workspace and its own federated credential for `environment:prod-items`, then runs the publish script above. The two environments make the double approval deliberate: tenant changes and item releases are signed off separately.
- **PPE:** add a copy of the deploy job with its own environment, `TARGET_ENVIRONMENT: PPE` and the PPE workspace ID, and make the PROD job depend on it.
- **The cost:** because `deploy` needs `provision` and both share one path filter, every item release also re-runs the idempotent provisioner and needs a tenant approval. If that's too much friction, split it into two workflows by path.

<div class="code-title">.github/workflows/fabric-deploy.yml</div>

```yaml
name: fabric-deploy
on:
  pull_request:
    paths: ["workspaces/**", "rules/**", "src/items/**"]
  push:
    branches: [main]
    paths: ["workspaces/**", "rules/**", "src/items/**"]

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
      - run: pip install pyyaml jsonschema
      - name: Validate manifests against schema and policy
        run: python scripts/validate.py

  provision:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    needs: validate
    runs-on: ubuntu-latest
    environment: production   # required reviewers configured on the environment
    permissions:
      id-token: write   # required for OIDC
      contents: read
    steps:
      - uses: actions/checkout@v6
      - uses: azure/login@v3
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          allow-no-subscriptions: true
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
      - run: pip install -r scripts/requirements.txt
      - name: Provision workspaces, capacity and roles from manifests
        run: python scripts/provision.py

  deploy:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    needs: [validate, provision]
    runs-on: ubuntu-latest
    environment: prod-items   # separate approval for item releases
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v6
      - uses: azure/login@v3
        with:
          client-id: ${{ vars.FABRIC_DEPLOY_CLIENT_ID }}   # Contributor on the target workspace only
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          allow-no-subscriptions: true
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
      - run: pip install "fabric-cicd~=1.2" azure-identity
      - name: Publish item definitions
        env:
          TARGET_WORKSPACE_ID: ${{ vars.PROD_WORKSPACE_ID }}
          TARGET_ENVIRONMENT: PROD
        run: python scripts/publish_items.py
```

## Where this isn't worth it

Tenant-as-code costs real effort: schema, policy, provisioner, drift job, separate identities and the discipline to stop clicking in the portal. For a single team with three workspaces and one capacity, I'd skip it; a runbook and the audit log are enough.

It pays off once many teams request workspaces, when naming and ownership rules exist only on paper, or when an auditor asks who approved a tenant setting change. If you're there, start small: manifests and a validate workflow first, provisioning second, drift third, tenant settings last. My earlier post on [Fabric tenant settings](/blog/2024-06-13-tenant-settings-fabric/) is a reasonable list of which settings deserve to be in that repo.

## The test I'd apply

You have tenant-as-code when every workspace, capacity assignment, domain and role grant traces back to a merged pull request; no person holds standing write access to production; the identity that does write has no secret; per-stage values come from variable libraries, deployment rules or `parameter.yml`; and a scheduled job tells you when reality has moved. Item CI/CD gives you repeatable deployments. The tenant layer makes the platform reviewable, and Git integration was never going to do that for you.
