---
title: "Whose Identity Reaches the Target? OneLake Shortcut Security"
author: Michael John Peña
draft: false
date: 2026-07-27
description: "How identity flows through OneLake shortcuts: passthrough vs delegated, SQL endpoint access modes, the Direct Lake over SQL exception, and lost policy."
tags:
  - Microsoft Fabric
  - OneLake
  - Security
  - Direct Lake
  - Governance
---

Most conversations about OneLake shortcuts are about storage: no copies, less pipeline code. For anyone accountable for access control, that framing misses the point. A shortcut joins two separately governed permission domains, and every read through it answers a question nobody wrote down: *whose identity reaches the target, and which security model judges it?* Get that wrong and row-level security you carefully defined at the source is either bypassed or blocks the report everyone depends on.

I've covered the operational side before: [treating shortcuts as dependencies you inventory](/blog/2026-04-06-onelake-shortcuts-in-practice-why-governance-has-to-be-designed-before-scale/) and [handing features to AI teams without over-sharing](/blog/2026-04-17-onelake-shortcuts-in-practice-balancing-speed-and-access-boundaries/). This post is the security model underneath both, updated for where Fabric stands at the end of July 2026. [Microsoft said at FabCon 2026](https://blog.fabric.microsoft.com/en-us/blog/fabcon-and-sqlcon-2026-whats-new-in-microsoft-onelake/) in March that OneLake security would reach general availability within weeks. It went GA in April, with the automatic rollout to supported items finishing by the end of May, and delegated OneLake-to-OneLake shortcuts are now in preview.

## Two paths, most restrictive wins

Every shortcut has a **shortcut path** (where it appears, usually the consumer's lakehouse) and a **target path** (what it points to). OneLake evaluates both and applies the more restrictive result. A user with read and write in the consumer lakehouse but only read at the target can't write through the shortcut; a user with read-only on the consumer side can't write either, even with full rights at the target ([Secure and manage OneLake shortcuts](https://learn.microsoft.com/en-us/fabric/onelake/onelake-shortcut-security)).

<div class="code-title">most-restrictive-wins · conceptual</div>

```text
effective(user, shortcut) = min(
    onelake_perm(user, shortcut.path),     # layer 1 — where the shortcut lives
    onelake_perm(user, shortcut.target)    # layer 2 — what it points to
)
# write requires ReadWrite on BOTH sides;
# a Read-only target caps the result at Read, whatever the shortcut path grants.
```

<div style="overflow-x:auto;margin:1.75rem 0;border:1px solid #27272a;border-radius:12px">
<table style="width:100%;border-collapse:collapse;min-width:680px;font-size:0.9rem">
<caption style="text-align:left;padding:12px 16px 0;color:#71717a;font-family:'JetBrains Mono',monospace;font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase">Table (a) — Shortcut permission matrix</caption>
<thead>
<tr style="background:#15151b">
<th style="text-align:left;padding:12px 16px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Operation</th>
<th style="text-align:left;padding:12px 16px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Shortcut path</th>
<th style="text-align:left;padding:12px 16px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Target path</th>
<th style="text-align:left;padding:12px 16px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Notes</th>
</tr>
</thead>
<tbody>
<tr>
<td style="padding:12px 16px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600;white-space:nowrap">Create shortcut</td>
<td style="padding:12px 16px;color:#d4d4d8;border-bottom:1px solid #1c1c22;font-family:'JetBrains Mono',monospace;font-size:0.78rem">Item Write <span style="color:#71717a">or</span> OneLake security ReadWrite</td>
<td style="padding:12px 16px;color:#d4d4d8;border-bottom:1px solid #1c1c22;font-family:'JetBrains Mono',monospace;font-size:0.78rem">OneLake security Read <span style="color:#71717a">(ReadAll for items without OneLake security)</span></td>
<td style="padding:12px 16px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Internal: caller needs Read at the target. External (S3/ADLS): target read is delegated via a cloud connection — only a user with permission on the connection can bind it.</td>
</tr>
<tr>
<td style="padding:12px 16px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600;white-space:nowrap">Delete shortcut</td>
<td style="padding:12px 16px;color:#d4d4d8;border-bottom:1px solid #1c1c22;font-family:'JetBrains Mono',monospace;font-size:0.78rem">Item Write <span style="color:#71717a">or</span> OneLake security ReadWrite</td>
<td style="padding:12px 16px;color:#71717a;border-bottom:1px solid #1c1c22;font-family:'JetBrains Mono',monospace;font-size:0.78rem">N/A</td>
<td style="padding:12px 16px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Deleting the shortcut object does not touch the target. A <em>write/delete through</em> the shortcut is a different operation and can delete target data.</td>
</tr>
<tr>
<td style="padding:12px 16px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600;white-space:nowrap">Read through shortcut</td>
<td style="padding:12px 16px;color:#d4d4d8;border-bottom:1px solid #1c1c22;font-family:'JetBrains Mono',monospace;font-size:0.78rem">OneLake security Read</td>
<td style="padding:12px 16px;color:#d4d4d8;border-bottom:1px solid #1c1c22;font-family:'JetBrains Mono',monospace;font-size:0.78rem">OneLake security Read</td>
<td style="padding:12px 16px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Both sides. External reads via Spark/API also require Read on the item holding the shortcut path.</td>
</tr>
<tr>
<td style="padding:12px 16px;color:#e4e4e7;font-family:'Space Grotesk',sans-serif;font-weight:600;white-space:nowrap">Write through shortcut</td>
<td style="padding:12px 16px;color:#d4d4d8;font-family:'JetBrains Mono',monospace;font-size:0.78rem">Item Write <span style="color:#71717a">or</span> OneLake security ReadWrite</td>
<td style="padding:12px 16px;color:#d4d4d8;font-family:'JetBrains Mono',monospace;font-size:0.78rem">Item Write <span style="color:#71717a">or</span> OneLake security ReadWrite</td>
<td style="padding:12px 16px;color:#a1a1aa">Both sides. For external targets this is gated on write permission in the external system, not blocked categorically.</td>
</tr>
</tbody>
</table>
</div>

Two details matter more than they look. Deleting the shortcut never touches the target, but deleting a *folder inside* the shortcut deletes it at the target if you have write permission there, including in an external ADLS or S3 account.

The second detail is about who the roles bind. If your restricted consumers are Contributors in the producer workspace, OneLake roles won't contain them. The roles bind Viewers and people the item was shared with; Admins, Members and Contributors read through Spark and direct OneLake access unfiltered. The main exception is a SQL analytics endpoint in user identity mode, which applies OneLake RLS to every caller, and even unfiltered, those roles still need access on both the shortcut and target paths. Restricted readers belong in the Viewer role or on item sharing.

## Passthrough and delegated: the identity decision

Shortcuts authenticate one of two ways, and the type of shortcut decides which options you have. Same-tenant OneLake-to-OneLake shortcuts default to passthrough and can now opt into delegated (preview). Cross-tenant OneLake shortcuts (also preview) are always delegated, through a connection identity in the producer's tenant. External shortcuts to ADLS, S3, GCS and the rest are always delegated too, through the cloud connection's credential.

**Passthrough** carries the caller's Entra identity to the target. Each consumer is evaluated against the source's rules, and there's no credential to store or rotate. The cost is that the producer must grant every consumer, or every consumer group, read at the target.

**Delegated** reaches the target with an intermediate credential: an organisational account or service principal on a connection, or a key for some external sources. The [Delegated OneLake Shortcuts preview](https://community.fabric.microsoft.com/t5/Fabric-Updates-Blog/Simplifying-secure-data-access-with-Delegated-OneLake-Shortcuts/ba-p/5254632) brings this to internal shortcuts. The caller sees the intersection of their own OneLake security on the consumer side and whatever the delegated identity can see at the producer. The security rules split by side:

- Column-level security works on both the producer and consumer side.
- Row-level security can only be set on the producer side.
- If the producer has RLS, each consumer can sit in only one CLS role on the consumer side.

Two constraints shape how I'd use it. You choose the model when you create the shortcut, and switching later means deleting and recreating it. And the connection identity becomes a standing grant whose blast radius is every consumer of every shortcut that uses it.

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 800 542" role="img" aria-label="Decision flow: a caller passes the shortcut-path gate, then branches into pass-through (caller identity reaches target) or delegated (connection identity reaches target); a Direct Lake over SQL or delegated-mode T-SQL exception overrides the default.">
<defs><marker id="olN" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah"/></marker></defs>
<rect x="320" y="16" width="160" height="44" rx="10" class="ff-node"/>
<text x="400" y="43" text-anchor="middle" class="ff-title">Calling user</text>
<line x1="400" y1="60" x2="400" y2="80" class="ff-edge" marker-end="url(#olN)"/>
<rect x="60" y="84" width="680" height="54" rx="11" class="ff-node"/>
<image href="/icons/fabric/one_lake_48_color.svg" x="78" y="97" width="30" height="30"/>
<text x="408" y="110" text-anchor="middle" class="ff-title">Layer 1 · Shortcut-path gate (OneLake security)</text>
<text x="408" y="128" text-anchor="middle" class="ff-sub">Denies here if the caller lacks Read on the shortcut path</text>
<line x1="400" y1="138" x2="400" y2="152" class="ff-edge" marker-end="url(#olN)"/>
<rect x="60" y="156" width="680" height="40" rx="11" class="ff-node"/>
<text x="400" y="181" text-anchor="middle" class="ff-title" style="font-size:12.5px">Layer 2 · Authentication model selects the identity that reaches the target</text>
<path d="M360,196 C 320,206 250,208 225,222" class="ff-edge" marker-end="url(#olN)"/>
<path d="M440,196 C 480,206 550,208 575,222" class="ff-edge" marker-end="url(#olN)"/>
<rect x="78" y="214" width="294" height="248" rx="16" class="ff-zone ff-zone-read"/>
<rect x="428" y="214" width="294" height="248" rx="16" class="ff-zone ff-zone-flow"/>
<rect x="100" y="222" width="250" height="28" rx="14" class="ff-node ff-node-cy"/>
<text x="225" y="240" text-anchor="middle" class="ff-tok" style="font-weight:600;letter-spacing:.03em">PASS-THROUGH · INTERNAL DEFAULT</text>
<rect x="450" y="222" width="250" height="28" rx="14" class="ff-node ff-node-cy"/>
<text x="575" y="240" text-anchor="middle" class="ff-tok" style="font-weight:600;letter-spacing:.03em">DELEGATED · EXTERNAL ALWAYS</text>
<rect x="100" y="266" width="250" height="44" rx="10" class="ff-node"/>
<text x="225" y="292" text-anchor="middle" class="ff-title">Caller's identity → target</text>
<line x1="225" y1="310" x2="225" y2="325" class="ff-edge" marker-end="url(#olN)"/>
<rect x="100" y="326" width="250" height="50" rx="10" class="ff-node"/>
<text x="225" y="350" text-anchor="middle" class="ff-title">Target-path permissions</text>
<text x="225" y="367" text-anchor="middle" class="ff-title">checked for the caller</text>
<line x1="225" y1="376" x2="225" y2="391" class="ff-edge" marker-end="url(#olN)"/>
<rect x="100" y="392" width="250" height="52" rx="10" class="ff-node ff-node-az"/>
<text x="225" y="414" text-anchor="middle" class="ff-sub">Effective access =</text>
<text x="225" y="433" text-anchor="middle" class="ff-tok">min(shortcut, target)</text>
<rect x="450" y="266" width="250" height="44" rx="10" class="ff-node"/>
<text x="575" y="292" text-anchor="middle" class="ff-title">Connection identity → target</text>
<line x1="575" y1="310" x2="575" y2="325" class="ff-edge" marker-end="url(#olN)"/>
<rect x="450" y="326" width="250" height="50" rx="10" class="ff-node"/>
<text x="575" y="350" text-anchor="middle" class="ff-title">Target permissions checked</text>
<text x="575" y="367" text-anchor="middle" class="ff-title">for the connection identity</text>
<line x1="575" y1="376" x2="575" y2="391" class="ff-edge" marker-end="url(#olN)"/>
<rect x="450" y="392" width="250" height="52" rx="10" class="ff-node ff-node-az"/>
<text x="575" y="414" text-anchor="middle" class="ff-sub">Caller sees</text>
<text x="575" y="433" text-anchor="middle" class="ff-tok">own ∩ delegated security</text>
<rect x="60" y="478" width="680" height="52" rx="11" class="ff-node ff-node-dn"/>
<text x="400" y="500" text-anchor="middle" class="ff-title" style="fill:#f0a49d">Exception — Direct Lake over SQL, or T-SQL in delegated identity mode</text>
<text x="400" y="518" text-anchor="middle" class="ff-sub">the item owner's identity replaces the caller's; OneLake roles still filter the result</text>
</svg>
<figcaption><strong>Figure 1.</strong> Two-layer evaluation and the identity branch. The shortcut-path gate always applies; the authentication model decides whether the caller's identity or a fixed connection identity reaches the target. The owner-identity exception for Direct Lake over SQL and delegated-mode T-SQL (next section) overrides the pass-through default.</figcaption>
</figure>

## The exception that breaks the mental model

Passthrough is the default rule, not a universal one. The shortcut security page buries this in a footnote: when shortcut data is read through **Power BI semantic models using Direct Lake over SQL**, or through **T-SQL engines in delegated identity mode**, the caller's identity is not passed to the target. The engine reads with the **item owner's** identity, then applies OneLake security roles to filter what the caller sees. Any permission set for the end user directly at the target path is bypassed.

<div class="cl cl-warn">
<div class="cl-tag">Watch</div>
<div class="cl-body">

Through **Direct Lake over SQL**, and through T-SQL in **delegated identity mode**, the querying user's *own* permissions on the shortcut target are never consulted: the item owner's identity reaches the data and only OneLake security roles filter the result. Use **user identity mode** for T-SQL, and **Direct Lake on OneLake** for semantic models, when callers must be evaluated at the target.

</div>
</div>

Those are two separate triggers, and it's worth being exact about each.

### The SQL analytics endpoint access mode

Every SQL analytics endpoint runs in one of two modes ([OneLake security for SQL analytics endpoints](https://learn.microsoft.com/en-us/fabric/onelake/security/sql-analytics-endpoint-onelake-security)):

| Aspect | User identity mode | Delegated identity mode |
|---|---|---|
| Identity used against OneLake | The signed-in user | The workspace or item owner |
| Table access governed by | OneLake security roles | SQL `GRANT`/`REVOKE` only |
| RLS and CLS defined in | OneLake security roles | SQL security policies and column grants |
| Dynamic data masking | Not supported | Supported |
| Shortcuts to tables with OneLake RLS or CLS | Work, evaluated as the caller on both sides | Blocked |

New SQL analytics endpoints start in delegated identity mode, and an Admin or Member has to switch each one to user identity mode once before OneLake security roles apply. The switch briefly takes every SQL analytics endpoint in the workspace offline and cancels running queries. In user identity mode, table-level `GRANT`/`REVOKE` is ignored and SQL RLS and CLS on tables no longer govern access. User identity mode is an action you take on every endpoint, not a default you inherit.

Delegated mode fails closed for shortcuts: if the source table has OneLake RLS or CLS, the endpoint blocks the shortcut rather than serving unfiltered rows through the owner's identity. For source tables *without* OneLake rules, though, the owner's reach is what every SQL user inherits, governed only by whatever SQL grants exist in the consumer endpoint.

### Direct Lake over SQL

The owner-identity behaviour here isn't a side effect of the endpoint's mode. The [Direct Lake security integration](https://learn.microsoft.com/en-us/fabric/fundamentals/direct-lake-security-integration) docs describe it directly: Direct Lake first checks that the effective identity (the user under SSO, or a fixed identity on the connection) can access the table through the SQL endpoint, then, for internal shortcuts, reads the Delta table through the shortcut with the **data source owner's** identity. For external shortcuts the owner also needs Use permission on the cloud connection. So the owner's access at the target is the ceiling for every report reader.

There's a second cost. Once the endpoint is in user identity mode, OneLake security roles become SQL access rules and Direct Lake on SQL falls back to DirectQuery for every query, so each read goes through the SQL endpoint and you lose Direct Lake performance. Any query touching a table with SQL endpoint RLS, or a view, falls back too. That is a second reason to move semantic models to Direct Lake on OneLake.

Direct Lake on OneLake behaves differently. It skips the SQL endpoint, resolves OneLake security roles for the effective identity, and for an internal shortcut requires that identity to have read at the target. If you need caller identity honoured at the shortcut target in a semantic model, Direct Lake on OneLake (GA since FabCon 2026 in March) is the option that does it.

## Which engine enforces what

OneLake security is the data-plane model for lakehouses and mirrored items, enforced across Spark, the SQL endpoint in user identity mode, and Direct Lake on OneLake. It isn't the native model everywhere, and shortcuts move data across those borders without moving the policy.

<div style="overflow-x:auto;margin:1.75rem 0;border:1px solid #27272a;border-radius:12px">
<table style="width:100%;border-collapse:collapse;min-width:680px;font-size:0.9rem">
<caption style="text-align:left;padding:12px 16px 0;color:#71717a;font-family:'JetBrains Mono',monospace;font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase">Table (b) — Data location → enforcing security model</caption>
<thead>
<tr style="background:#15151b">
<th style="text-align:left;padding:12px 16px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Data location / access path</th>
<th style="text-align:left;padding:12px 16px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Enforcing security model</th>
<th style="text-align:left;padding:12px 16px;color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:600;border-bottom:1px solid #27272a">Notes</th>
</tr>
</thead>
<tbody>
<tr>
<td style="padding:12px 16px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600"><img src="/icons/fabric/lakehouse_48_item.svg" alt="" width="18" height="18" style="vertical-align:-4px;margin-right:8px"/>Lakehouse via Spark</td>
<td style="padding:12px 16px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><strong style="color:#00B7C3">OneLake security</strong> roles, RLS/CLS filtered</td>
<td style="padding:12px 16px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Roles bind Viewers / Read-permission users, not Admin/Member/Contributor.</td>
</tr>
<tr>
<td style="padding:12px 16px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600"><img src="/icons/fabric/lakehouse_48_item.svg" alt="" width="18" height="18" style="vertical-align:-4px;margin-right:8px"/>Direct OneLake API or file access</td>
<td style="padding:12px 16px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><strong style="color:#00B7C3">OneLake security</strong> roles</td>
<td style="padding:12px 16px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Tables with RLS/CLS are <em>blocked</em> rather than served unfiltered.</td>
</tr>
<tr>
<td style="padding:12px 16px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600"><img src="/icons/fabric/lakehouse_48_item.svg" alt="" width="18" height="18" style="vertical-align:-4px;margin-right:8px"/>Lakehouse via SQL endpoint, user identity mode</td>
<td style="padding:12px 16px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><strong style="color:#00B7C3">OneLake security</strong> roles</td>
<td style="padding:12px 16px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Enforces OneLake roles natively and ignores table GRANT/REVOKE.</td>
</tr>
<tr>
<td style="padding:12px 16px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600"><img src="/icons/fabric/lakehouse_48_item.svg" alt="" width="18" height="18" style="vertical-align:-4px;margin-right:8px"/>Lakehouse via SQL endpoint, delegated identity mode</td>
<td style="padding:12px 16px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><strong style="color:#0aa5d6">SQL permissions</strong> only</td>
<td style="padding:12px 16px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Governs by SQL alone and does <em>not</em> carry OneLake roles for table data; shortcuts to tables with OneLake RLS or CLS are blocked.</td>
</tr>
<tr>
<td style="padding:12px 16px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600"><img src="/icons/fabric/data_warehouse_48_item.svg" alt="" width="18" height="18" style="vertical-align:-4px;margin-right:8px"/>Warehouse</td>
<td style="padding:12px 16px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><strong style="color:#0aa5d6">SQL security</strong>, within the SQL engine only</td>
<td style="padding:12px 16px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Enforced only within the SQL/TDS execution context; <strong style="color:#f0a49d">not</strong> translated into OneLake policies. Warehouse is not among the items that support OneLake security roles.</td>
</tr>
<tr>
<td style="padding:12px 16px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600"><img src="/icons/fabric/semantic_model_48_item.svg" alt="" width="18" height="18" style="vertical-align:-4px;margin-right:8px"/>Direct Lake on SQL</td>
<td style="padding:12px 16px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><strong style="color:#0aa5d6">SQL endpoint permissions</strong>, then owner identity at shortcut targets</td>
<td style="padding:12px 16px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Internal shortcut targets are read with the data source owner's identity whatever the endpoint mode; falls back to DirectQuery under SQL endpoint RLS, views, or user identity mode.</td>
</tr>
<tr>
<td style="padding:12px 16px;color:#e4e4e7;font-family:'Space Grotesk',sans-serif;font-weight:600"><img src="/icons/fabric/semantic_model_48_item.svg" alt="" width="18" height="18" style="vertical-align:-4px;margin-right:8px"/>Direct Lake on OneLake</td>
<td style="padding:12px 16px;color:#d4d4d8"><strong style="color:#00B7C3">OneLake security</strong> roles, then the model's own roles</td>
<td style="padding:12px 16px;color:#a1a1aa">Resolves OneLake roles for the effective identity, which needs Read at internal shortcut targets; errors instead of falling back to DirectQuery.</td>
</tr>
</tbody>
</table>
</div>

Two rules fall out of that table.

First, warehouse security doesn't travel. Warehouse RLS, CLS and object permissions live in the SQL engine's execution context, and nothing translates them into OneLake roles. A shortcut reads the Delta files underneath, so I assume a reader through a shortcut sees the full table unless OneLake itself restricts it. Secure that data in a lakehouse with OneLake security, or keep consumers on the warehouse's SQL surface. Lakehouses, mirrored databases and Azure Databricks mirrored catalogs support OneLake security roles; Eventhouse support (RLS only) arrived in preview at FabCon 2026; Warehouse does not yet.

Second, rules defined only inside a semantic model stay inside that model. Anyone with OneLake access can read the same data through Spark and skip them. Engines that can't enforce OneLake RLS or CLS are blocked rather than handed unfiltered rows. That's the right default, but it shows up as a failing third-party query.

## Where it goes wrong

- **Same user, different rows.** A table enforces OneLake roles in Spark, but a consumer endpoint left in delegated mode applies only SQL grants. The user blocked in a notebook sees everything in SSMS. Standardise on user identity mode unless you need SQL-only features like dynamic data masking, and accept that any Direct Lake on SQL models over that endpoint will then run as DirectQuery.
- **An over-privileged owner behind Direct Lake over SQL.** The lakehouse owner is a platform admin with broad reach, so every Direct Lake over SQL report inherits that reach at shortcut targets, filtered only by OneLake roles that may not exist. Own items with scoped identities, or use Direct Lake on OneLake.
- **External targets with coarse IAM.** A delegated connection to an ADLS account is only as narrow as that account's own permissions, and a delete through the shortcut deletes in the external account. Scope the connection credential to the exact container or prefix.
- **Standing connection credentials.** Delegated shortcuts decouple credential lifetime from access reviews. Track connections as first-class assets with owners and rotation dates.
- **Group mismatch across the boundary.** Until late July 2026 the docs required the exact group named in the producer role to hold Fabric Read on the consumer, because nested membership wasn't resolved, and queries failed closed with an access error. The SQL endpoint page now says effective group membership is evaluated, but the troubleshooting guide still describes the literal-match rule, so I'd still grant the same groups on both sides and test with a nested member before relying on it.

## How I'd decide

My default for same-tenant consumers is passthrough, with OneLake security roles on the producer lakehouse assigned to Entra groups, SQL endpoints pinned to user identity mode, and semantic models on Direct Lake on OneLake, because user identity mode pushes Direct Lake on SQL models into DirectQuery anyway. The safest discipline is granting Fabric Read on each consumer item to the exact groups named in the producer's roles, not to their members or parent groups. That keeps one authorisation system of record and evaluates every reader as themselves.

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 388" role="img" aria-label="A domain-owned producer workspace containing a curated lakehouse governed by OneLake security fans out shortcuts across an authorization boundary to shortcut-only consumer workspaces A, B, and N, each holding no copy and no direct grant.">
<defs><marker id="l2read" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah-read"/></marker></defs>
<rect x="24" y="54" width="340" height="290" rx="16" class="ff-zone ff-zone-flow"/>
<text x="44" y="80" class="ff-zlabel">PRODUCER · DOMAIN-OWNED</text>
<rect x="424" y="54" width="452" height="290" rx="16" class="ff-zone ff-zone-read"/>
<text x="446" y="80" class="ff-zlabel">SHORTCUT-ONLY CONSUMERS</text>
<line x1="394" y1="58" x2="394" y2="340" class="ff-edge-dash"/>
<rect x="54" y="100" width="280" height="196" rx="14" class="ff-node ff-node-cy"/>
<image href="/icons/fabric/lakehouse_48_item.svg" x="170" y="116" width="48" height="48"/>
<text x="194" y="192" text-anchor="middle" class="ff-title" style="font-size:16px;fill:#ffffff">Curated Lakehouse</text>
<text x="194" y="213" text-anchor="middle" class="ff-sub">OneLake security</text>
<text x="194" y="233" text-anchor="middle" class="ff-tok">OLS · RLS · CLS</text>
<line x1="88" y1="251" x2="300" y2="251" stroke="#00B7C3" stroke-width="1" opacity="0.28"/>
<text x="194" y="273" text-anchor="middle" class="ff-sub">Single source of</text>
<text x="194" y="289" text-anchor="middle" class="ff-sub">authorization truth</text>
<rect x="448" y="88" width="404" height="70" rx="12" class="ff-node"/>
<image href="/icons/fabric/group_workspace_48_non-item.svg" x="466" y="103" width="40" height="40"/>
<text x="522" y="119" class="ff-title">Consumer workspace A</text>
<text x="522" y="139" class="ff-sub">shortcut only — no copy, no grant</text>
<rect x="448" y="174" width="404" height="70" rx="12" class="ff-node"/>
<image href="/icons/fabric/group_workspace_48_non-item.svg" x="466" y="189" width="40" height="40"/>
<text x="522" y="205" class="ff-title">Consumer workspace B</text>
<text x="522" y="225" class="ff-sub">shortcut only — no copy, no grant</text>
<rect x="448" y="260" width="404" height="70" rx="12" class="ff-node"/>
<image href="/icons/fabric/group_workspace_48_non-item.svg" x="466" y="275" width="40" height="40"/>
<text x="522" y="291" class="ff-title">Consumer workspace N</text>
<text x="522" y="311" class="ff-sub">shortcut only — no copy, no grant</text>
<path d="M334,176 C 392,150 402,123 448,123" class="ff-edge-read" marker-end="url(#l2read)"/>
<path d="M334,198 C 392,203 402,209 448,209" class="ff-edge-read" marker-end="url(#l2read)"/>
<path d="M334,220 C 392,250 402,295 448,295" class="ff-edge-read" marker-end="url(#l2read)"/>
<rect x="379" y="115" width="56" height="16" rx="8" class="ff-elabel-bg"/>
<text x="407" y="127" text-anchor="middle" class="ff-elabel">shortcut</text>
<rect x="379" y="201" width="56" height="16" rx="8" class="ff-elabel-bg"/>
<text x="407" y="213" text-anchor="middle" class="ff-elabel">shortcut</text>
<rect x="379" y="287" width="56" height="16" rx="8" class="ff-elabel-bg"/>
<text x="407" y="299" text-anchor="middle" class="ff-elabel">shortcut</text>
<line x1="30" y1="366" x2="58" y2="366" class="ff-edge-read"/>
<text x="65" y="370" class="ff-lgd">shortcut path</text>
<line x1="168" y1="366" x2="196" y2="366" class="ff-edge-dash"/>
<text x="203" y="370" class="ff-lgd">authorization boundary</text>
<text x="372" y="370" class="ff-lgd" style="fill:#6f787f">· official Microsoft Fabric icons</text>
</svg>
<figcaption><strong>Figure 2.</strong> Producer / consumer fan-out. Policy lives once, at the producer, in OneLake security; consumers hold only shortcuts — no replicated data and no independent grant to keep in sync. Every read crosses the authorization boundary, and whether it carries the caller's identity or a connection identity is exactly the pass-through vs delegated choice below.</figcaption>
</figure>

I'd reach for delegated shortcuts when the grant count is the real problem: a curated dataset served to many teams who should manage their own readers, or a cross-tenant source where passthrough isn't an option. In those cases, scope the connection identity to exactly what the shortcut exposes, put RLS on the producer side because the consumer side can't hold it, and remember delegated OneLake shortcuts, same-tenant and cross-tenant, are still in preview, so I'd pilot it before it fronts anything sensitive.

When not to bother with any of this: one team producing and consuming in the same workspace, with Contributors on both sides. Workspace roles already decide everything there, and OneLake roles would only add sync lag and configuration to maintain. The model above earns its keep the moment the producer and the reader are different people.
