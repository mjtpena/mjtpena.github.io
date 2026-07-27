---
title: "OneLake Shortcuts Are an Authorization Boundary, Not a Storage Convenience — A Security Model for Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2026-07-27
description: "A shortcut splices two independently governed permission domains together. Treating it as an access-control and identity problem: two-layer permissions, pass-through vs delegated auth, the Direct Lake / SQL identity-passthrough exception, and where enforcement silently changes hands."
tags:
  - Microsoft Fabric
  - OneLake
  - Data Security
  - Data Architecture
  - Direct Lake
  - Entra ID
---

OneLake shortcuts look like a storage convenience — a pointer that makes data in one location appear in another without copying. That framing is wrong for anyone responsible for access control. A shortcut is a federated identity and authorization construct: it splices two independently governed permission domains together and forces you to reason about *which identity reaches the target*, *which security model enforces the target*, and *where the two disagree*.

This article treats shortcuts as an identity-and-authorization boundary, traces how identity flows across it, and maps where enforcement silently changes hands between OneLake security, SQL security, KQL RBAC, and semantic-model security. It assumes you already know OneLake, lakehouses, the SQL analytics endpoint, Direct Lake, and Entra identities.

### What you'll learn

- Why every shortcut is evaluated at *two* permission layers, and how most-restrictive-wins actually resolves
- How identity flows to the target under pass-through vs delegated authentication
- The Direct Lake over SQL / T-SQL exception where the caller's identity is *not* passed through — verified against current docs
- Which engine enforces which security model, as a data-location → model table
- The concrete failure modes, and the blast radius of each

## 1. The two-layer permission model

Every shortcut has two paths. The **shortcut path** is where the shortcut appears (the consumer-side lakehouse); the **target path** is what it points to. Authorization is evaluated at both, and OneLake applies the most restrictive of the two:

> A combination of the permissions in the shortcut path and the target path governs the permissions for shortcuts. When a user accesses a shortcut, the most restrictive permission of the two locations is applied.

That intersection cuts both ways. A user with read+write in the consumer lakehouse but only read at the target cannot write to the target; a user with only read at the shortcut path but read+write at the target also cannot write ([Secure and manage OneLake shortcuts](https://learn.microsoft.com/en-us/fabric/onelake/onelake-shortcut-security#accessing-shortcuts)). Neither path can grant more than it holds, and neither can rescue a deficiency in the other.

```text
effective(user, shortcut) = min(
    onelake_perm(user, shortcut.path),     # layer 1 — where the shortcut lives
    onelake_perm(user, shortcut.target)    # layer 2 — what it points to
)
# write requires ReadWrite on BOTH sides;
# a Read-only target caps the result at Read, whatever the shortcut path grants.
```

The permission required is not uniform across operations. Note the asymmetry: create and delete accept item Write on the shortcut side, delete needs nothing at the target, but writing *through* a shortcut demands a ReadWrite-equivalent on **both** sides.

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
<td style="padding:12px 16px;color:#d4d4d8;border-bottom:1px solid #1c1c22;font-family:'JetBrains Mono',monospace;font-size:0.78rem">OneLake security Read</td>
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

Matrix source: [Secure and manage OneLake shortcuts](https://learn.microsoft.com/en-us/fabric/onelake/onelake-shortcut-security#accessing-shortcuts); cloud-connection binding: [OneLake shortcuts](https://learn.microsoft.com/en-us/fabric/onelake/onelake-shortcuts#how-shortcuts-use-cloud-connections). A second, more granular table on the same page frames the shortcut-path requirement for OneLake-security-managed operations as `Fabric Read and OneLake security ReadWrite` (Create/Update/Delete) or `Fabric Read and OneLake security Read` for listing shortcuts. When you cite exact permission strings, distinguish the two tables — they describe the same operations at different granularity.

One escape hatch: workspace Admin, Member, and Contributor roles read all shortcut data regardless of OneLake data-access roles — but they still need access on both the shortcut path and the target path. OneLake data-access roles only bind Viewers and item Read-permission users ([OneLake security](https://learn.microsoft.com/en-us/fabric/onelake/security/get-started-security)).

## 2. Authentication models: pass-through vs delegated

Shortcuts use two authentication models, and which one applies depends on shortcut type. Internal OneLake-to-OneLake shortcuts default to pass-through and may opt into delegated; external (multicloud) shortcuts are delegated only ([Secure and manage OneLake shortcuts](https://learn.microsoft.com/en-us/fabric/onelake/onelake-shortcut-security#shortcut-authentication-models)).

### Pass-through

The shortcut carries the *calling user's* Entra identity to the target:

> When a user accesses data from another OneLake location through a shortcut, OneLake uses the identity of the calling user to authorize access to the data. This user must have permissions in the target location to read the data.

Each consumer is evaluated individually against the target. The producer keeps full control and never replicates its access model ([OneLake shortcuts](https://learn.microsoft.com/en-us/fabric/onelake/onelake-shortcuts#internal-onelake-shortcuts)). This is the correct model when you want the source system to remain the single source of authorization truth.

### Delegated

The shortcut reaches the target using an intermediate credential "such as another user's identity, a service principal, or an account key" instead of the caller's ([Secure and manage OneLake shortcuts](https://learn.microsoft.com/en-us/fabric/onelake/onelake-shortcut-security#delegated-authentication)). External shortcuts to S3 or GCS always work this way. For internal shortcuts, delegated must be chosen explicitly at creation time, and switching an existing shortcut between the two modes requires deleting and recreating it — there is no in-place toggle ([Create a OneLake shortcut](https://learn.microsoft.com/en-us/fabric/onelake/shortcuts/create-onelake-shortcut)).

Which identities can back a delegated internal shortcut? The security page names *another user's identity, a service principal, or an account key*. The Delegated OneLake Shortcuts announcement (a Preview feature) states the configurable connection identity "can be an organizational account, a service principal, or a workspace identity" ([Fabric Community](https://community.fabric.microsoft.com/t5/Fabric-Updates-Blog/Simplifying-secure-data-access-with-Delegated-OneLake-Shortcuts/ba-p/5254632)). The current Create-shortcut UI walkthrough exposes only Organizational account and Service principal as authentication kinds — treat workspace identity as a rolling/preview addition to verify against the live product. External S3/ADLS connections additionally support credentials such as account keys, with SAS and other secret types documented on the per-source connection pages.

The permission consequence is the crux. Under pass-through, **each caller needs their own permission at the target path**. Under delegation, the *configured connection identity* needs target access, not each user; the caller instead sees "the intersection of their security and the security that applies to the delegated identity" ([Delegated OneLake shortcuts](https://learn.microsoft.com/en-us/fabric/onelake/onelake-shortcut-security#delegated-onelake-shortcuts)). Row-level security is enforceable on the producer side of a delegated shortcut but cannot be set on the consumer side; column-level security is supported on both sides.

<figure>
<svg viewBox="0 0 760 524" role="img" aria-label="Decision flow: a caller passes the shortcut-path gate, then branches into pass-through (caller identity reaches target) or delegated (connection identity reaches target); a Direct Lake over SQL delegated-mode exception overrides the default." style="width:100%;height:auto;background:#0c0c11;border-radius:10px">
<style>
.o-t{fill:#e4e4e7;font-family:'Space Grotesk',system-ui,sans-serif;font-size:13px}
.o-tm{fill:#a1a1aa;font-family:'Space Grotesk',system-ui,sans-serif;font-size:11.5px}
.o-mo{fill:#e4e4e7;font-family:'JetBrains Mono',monospace;font-size:12.5px}
.o-ac{fill:#00B7C3;font-family:'JetBrains Mono',monospace;font-size:11.5px;font-weight:600;letter-spacing:.04em}
.o-dg{fill:#f87171;font-family:'Space Grotesk',system-ui,sans-serif;font-size:12.5px;font-weight:600}
.o-lb{fill:#71717a;font-family:'JetBrains Mono',monospace;font-size:10.5px;letter-spacing:.12em}
.o-box{fill:#15151b;stroke:#3f3f46;stroke-width:1.4}
.o-bar{fill:#101014;stroke:#27272a;stroke-width:1.2}
.o-cy{fill:#0b2b2e;stroke:#00B7C3;stroke-width:1.4}
.o-az{fill:#0a1f33;stroke:#0078D4;stroke-width:1.4}
.o-dn{fill:#2a1315;stroke:#ef4444;stroke-width:1.4}
.o-ed{stroke:#52525b;stroke-width:1.6;fill:none}
.o-ef{fill:#52525b}
</style>
<defs><marker id="oah1" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" class="o-ef"/></marker></defs>
<rect x="300" y="12" width="160" height="40" rx="9" class="o-box"/>
<text x="380" y="37" text-anchor="middle" class="o-t">Calling user</text>
<line x1="380" y1="52" x2="380" y2="72" class="o-ed" marker-end="url(#oah1)"/>
<rect x="70" y="78" width="620" height="48" rx="9" class="o-bar"/>
<text x="380" y="99" text-anchor="middle" class="o-t">Layer 1 · Shortcut-path gate (OneLake security)</text>
<text x="380" y="116" text-anchor="middle" class="o-tm">Denies here if the caller lacks Read on the shortcut path</text>
<line x1="380" y1="126" x2="380" y2="146" class="o-ed" marker-end="url(#oah1)"/>
<rect x="70" y="150" width="620" height="38" rx="9" class="o-bar"/>
<text x="380" y="174" text-anchor="middle" class="o-tm">Layer 2 · Authentication model selects the identity that reaches the target</text>
<path d="M320,188 C 300,200 250,202 228,212" class="o-ed" marker-end="url(#oah1)"/>
<path d="M440,188 C 460,200 510,202 532,212" class="o-ed" marker-end="url(#oah1)"/>
<rect x="108" y="212" width="234" height="28" rx="14" class="o-cy"/>
<text x="225" y="230" text-anchor="middle" class="o-ac">PASS-THROUGH · INTERNAL DEFAULT</text>
<rect x="418" y="212" width="234" height="28" rx="14" class="o-cy"/>
<text x="535" y="230" text-anchor="middle" class="o-ac">DELEGATED · EXTERNAL ALWAYS</text>
<rect x="110" y="256" width="230" height="46" rx="9" class="o-box"/>
<text x="225" y="284" text-anchor="middle" class="o-t">Caller's identity → target</text>
<line x1="225" y1="302" x2="225" y2="320" class="o-ed" marker-end="url(#oah1)"/>
<rect x="110" y="324" width="230" height="52" rx="9" class="o-box"/>
<text x="225" y="347" text-anchor="middle" class="o-t">Target-path permissions</text>
<text x="225" y="364" text-anchor="middle" class="o-t">checked for the caller</text>
<line x1="225" y1="376" x2="225" y2="394" class="o-ed" marker-end="url(#oah1)"/>
<rect x="110" y="398" width="230" height="52" rx="9" class="o-az"/>
<text x="225" y="420" text-anchor="middle" class="o-tm">Effective access =</text>
<text x="225" y="438" text-anchor="middle" class="o-mo">min(shortcut, target)</text>
<rect x="420" y="256" width="230" height="46" rx="9" class="o-box"/>
<text x="535" y="284" text-anchor="middle" class="o-t">Connection identity → target</text>
<line x1="535" y1="302" x2="535" y2="320" class="o-ed" marker-end="url(#oah1)"/>
<rect x="420" y="324" width="230" height="52" rx="9" class="o-box"/>
<text x="535" y="347" text-anchor="middle" class="o-t">Target permissions checked</text>
<text x="535" y="364" text-anchor="middle" class="o-t">for the connection identity</text>
<line x1="535" y1="376" x2="535" y2="394" class="o-ed" marker-end="url(#oah1)"/>
<rect x="420" y="398" width="230" height="52" rx="9" class="o-az"/>
<text x="535" y="420" text-anchor="middle" class="o-tm">Caller sees</text>
<text x="535" y="438" text-anchor="middle" class="o-mo">own ∩ delegated security</text>
<rect x="70" y="464" width="620" height="48" rx="9" class="o-dn"/>
<text x="380" y="485" text-anchor="middle" class="o-dg">Exception — Direct Lake over SQL / T-SQL in Delegated identity mode</text>
<text x="380" y="502" text-anchor="middle" class="o-tm">the item owner's identity replaces the caller's; OneLake roles still filter the result</text>
</svg>
<figcaption><strong>Figure 1.</strong> Two-layer evaluation and the identity branch. The shortcut-path gate always applies; the authentication model decides whether the caller's identity or a fixed connection identity reaches the target. The delegated-mode query-engine exception (§3) overrides the pass-through default.</figcaption>
</figure>

## 3. Identity-passthrough exceptions

Pass-through is the default rule, not a universal one. Certain query engines substitute a different identity before reaching the target, and this is where a naive mental model breaks.

The documented exception:

> When users access shortcuts through Power BI semantic models using Direct Lake over SQL or T-SQL engines in Delegated identity mode, the calling user's identity isn't passed through to the shortcut target. Instead, the calling item's owner's identity is passed.

The concrete consequences: the target is accessed with the item owner's permissions (not the end user's), OneLake security roles still filter what the end user reads, and "any permissions configured directly at the shortcut target path for the end user are bypassed" ([Secure and manage OneLake shortcuts](https://learn.microsoft.com/en-us/fabric/onelake/onelake-shortcut-security#accessing-shortcuts)).

Be precise about the trigger. This is **not** a blanket property of "Direct Lake over SQL." It is conditional on the SQL analytics endpoint's *access mode*. In **User identity mode**, the endpoint passes the signed-in user's Entra identity to OneLake and read access is governed by OneLake rules. In **Delegated identity mode**, the endpoint "connects to OneLake using the identity of the workspace or item owner" — the item account, not the signed-in user ([OneLake security for the SQL analytics endpoint](https://learn.microsoft.com/en-us/fabric/onelake/security/sql-analytics-endpoint-onelake-security)). Newly created items with a SQL endpoint start in User identity mode by default, and Admins or Members can change the mode at any time in the endpoint settings. Because the mode is a per-endpoint setting an administrator can flip — and older endpoints may predate that default — treat the current mode as something to verify, not assume.

The security implication is a delegation of the item owner's reach to every downstream caller. If the owner has broad access at the target and the endpoint is in Delegated mode, the querying user's *own* permissions on the target are never consulted — only OneLake security roles filter the result. There is a matching failure in the other direction: in Delegated mode, shortcuts whose source carries OneLake RLS/CLS are blocked entirely through the SQL endpoint rather than silently over-exposed. Microsoft's remedies are explicit: use Direct Lake over OneLake mode, or set the endpoint to User identity mode. Direct Lake over OneLake reads OneLake directly and preserves the caller's identity at the target; Direct Lake over SQL inherits whatever mode the endpoint is set to.

## 4. Security-model boundaries

OneLake security "is the data plane security model for data in OneLake" and enforces consistently across compute engines ([OneLake security](https://learn.microsoft.com/en-us/fabric/onelake/security/get-started-security)) — but it is not the enforcing model for every location in Fabric. As James Serra puts it, "OneLake security is not the native security model for every data location in Fabric. Some data stores use SQL security, some use KQL/Kusto RBAC, some use Power BI semantic model security" ([jamesserra.com](https://www.jamesserra.com/archive/2026/07/understanding-microsoft-fabric-onelake-security/)). Which engine enforces which model is the single most consequential thing to get right, because a shortcut can move data across an enforcement boundary without moving the policy.

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
<td style="padding:12px 16px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600"><img src="/icons/fabric/lakehouse_48_item.svg" alt="" width="18" height="18" style="vertical-align:-4px;margin-right:8px"/>Lakehouse Delta tables via Spark / OneLake API</td>
<td style="padding:12px 16px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><strong style="color:#00B7C3">OneLake security</strong> (table/folder, RLS, CLS)</td>
<td style="padding:12px 16px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Enforced consistently across engines; roles bind Viewers / Read-permission users, not Admin/Member/Contributor.</td>
</tr>
<tr>
<td style="padding:12px 16px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600"><img src="/icons/fabric/lakehouse_48_item.svg" alt="" width="18" height="18" style="vertical-align:-4px;margin-right:8px"/>Lakehouse via SQL analytics endpoint</td>
<td style="padding:12px 16px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><strong style="color:#00B7C3">OneLake security</strong> (User identity mode) <strong style="color:#fff">or</strong> <strong style="color:#0aa5d6">SQL permissions</strong> (Delegated identity mode)</td>
<td style="padding:12px 16px;color:#a1a1aa;border-bottom:1px solid #1c1c22">User mode enforces OneLake roles natively and ignores table GRANT/REVOKE; Delegated mode governs by SQL alone and does <em>not</em> carry OneLake roles for table data.</td>
</tr>
<tr>
<td style="padding:12px 16px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600"><img src="/icons/fabric/data_warehouse_48_item.svg" alt="" width="18" height="18" style="vertical-align:-4px;margin-right:8px"/>Warehouse (native tables)</td>
<td style="padding:12px 16px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><strong style="color:#0aa5d6">SQL security</strong> (GRANT/DENY, OLS, RLS, CLS, DDM)</td>
<td style="padding:12px 16px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Enforced only within the SQL/TDS execution context; <strong style="color:#f0a49d">not</strong> translated into OneLake policies. Warehouse is not among the items that support OneLake security roles.</td>
</tr>
<tr>
<td style="padding:12px 16px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600"><img src="/icons/fabric/event_house_48_item.svg" alt="" width="18" height="18" style="vertical-align:-4px;margin-right:8px"/>KQL / Eventhouse database</td>
<td style="padding:12px 16px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><strong style="color:#744EC2">KQL / Kusto RBAC</strong> (hybrid Fabric + Kusto roles)</td>
<td style="padding:12px 16px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Union of Fabric-granted and Kusto-command-granted roles, inherited top-down; roles include Admin, User, Viewer, Unrestrictedviewer, Ingestor, Monitor.</td>
</tr>
<tr>
<td style="padding:12px 16px;color:#e4e4e7;border-bottom:1px solid #1c1c22;font-family:'Space Grotesk',sans-serif;font-weight:600"><img src="/icons/fabric/semantic_model_48_item.svg" alt="" width="18" height="18" style="vertical-align:-4px;margin-right:8px"/>Power BI semantic model (Import)</td>
<td style="padding:12px 16px;color:#d4d4d8;border-bottom:1px solid #1c1c22"><strong style="color:#744EC2">Semantic-model security</strong> (DAX RLS/OLS)</td>
<td style="padding:12px 16px;color:#a1a1aa;border-bottom:1px solid #1c1c22">Data is imported into the model; DAX RLS applies to Viewers only, not Admin/Member/Contributor.</td>
</tr>
<tr>
<td style="padding:12px 16px;color:#e4e4e7;font-family:'Space Grotesk',sans-serif;font-weight:600"><img src="/icons/fabric/semantic_model_48_item.svg" alt="" width="18" height="18" style="vertical-align:-4px;margin-right:8px"/>Direct Lake</td>
<td style="padding:12px 16px;color:#d4d4d8"><strong style="color:#00B7C3">OneLake security</strong> (over OneLake) <strong style="color:#fff">or</strong> <strong style="color:#0aa5d6">SQL-endpoint model</strong> (over SQL) + model-level DAX</td>
<td style="padding:12px 16px;color:#a1a1aa">Direct Lake on OneLake checks permissions via OneLake APIs; Direct Lake on SQL checks via the SQL endpoint and can fall back to DirectQuery under RLS, whereas Direct Lake on OneLake errors instead of falling back.</td>
</tr>
</tbody>
</table>
</div>

Sources: OneLake security model ([Learn](https://learn.microsoft.com/en-us/fabric/onelake/security/get-started-security)); SQL endpoint modes and Warehouse non-translation ([Learn](https://learn.microsoft.com/en-us/fabric/onelake/security/sql-analytics-endpoint-onelake-security)); Kusto RBAC ([Learn](https://learn.microsoft.com/en-us/kusto/access-control/role-based-access-control?view=microsoft-fabric)); Power BI RLS ([Learn](https://learn.microsoft.com/en-us/fabric/security/service-admin-row-level-security)); Direct Lake ([Learn](https://learn.microsoft.com/en-us/fabric/fundamentals/direct-lake-security-integration)); location → model mapping ([jamesserra.com](https://www.jamesserra.com/archive/2026/07/understanding-microsoft-fabric-onelake-security/)).

Two cross-cutting rules matter. First, rules defined only inside a Direct Lake semantic model apply only within that model's scope — other engines reading the same data do not honor them, so a user with OneLake access can still retrieve data the model would restrict. Second, engines that cannot enforce OneLake RLS/CLS are *blocked* from that data rather than served unfiltered rows ([OneLake security integrations](https://learn.microsoft.com/en-us/fabric/onelake/security/onelake-security-integrations-overview)). Microsoft's guidance is to enforce data-access rules in OneLake security, since it is the only layer that applies uniformly across engines ([Direct Lake security integration](https://learn.microsoft.com/en-us/fabric/fundamentals/direct-lake-security-integration)).

## 5. Architecture patterns

The durable pattern is a **domain-owned curated lakehouse** as producer, with **shortcut-only consumer workspaces** that hold no copy of the data and no direct grant on the source.

<figure>
<svg viewBox="0 0 760 348" role="img" aria-label="A domain-owned producer workspace containing a curated lakehouse governed by OneLake security fans out shortcuts across an authorization boundary to consumer workspaces A, B, and N, each holding only a shortcut with no copy and no direct grant." style="width:100%;height:auto;background:#0c0c11;border-radius:10px">
<style>
.p-t{fill:#e4e4e7;font-family:'Space Grotesk',system-ui,sans-serif;font-size:13px}
.p-tm{fill:#a1a1aa;font-family:'Space Grotesk',system-ui,sans-serif;font-size:11.5px}
.p-mo{fill:#e4e4e7;font-family:'JetBrains Mono',monospace;font-size:11.5px}
.p-lb{fill:#71717a;font-family:'JetBrains Mono',monospace;font-size:10.5px;letter-spacing:.12em}
.p-box{fill:#15151b;stroke:#3f3f46;stroke-width:1.4}
.p-cy{fill:#0b2b2e;stroke:#00B7C3;stroke-width:1.4}
.p-ed{stroke:#0078D4;stroke-width:1.7;fill:none}
.p-ef{fill:#0078D4}
.p-bd{stroke:#52525b;stroke-width:1.3;stroke-dasharray:5 5;opacity:.7;fill:none}
</style>
<defs><marker id="pah2" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" class="p-ef"/></marker></defs>
<line x1="398" y1="34" x2="398" y2="330" class="p-bd"/>
<text x="398" y="24" text-anchor="middle" class="p-lb">AUTHORIZATION BOUNDARY</text>
<rect x="28" y="62" width="266" height="228" rx="12" class="p-box"/>
<text x="161" y="86" text-anchor="middle" class="p-lb">PRODUCER · DOMAIN-OWNED</text>
<rect x="50" y="104" width="222" height="166" rx="10" class="p-cy"/>
<image href="/icons/fabric/lakehouse_48_item.svg" x="147" y="111" width="28" height="28"/>
<text x="161" y="158" text-anchor="middle" class="p-t" style="font-size:15px;font-weight:700;fill:#fff">Curated Lakehouse</text>
<text x="161" y="176" text-anchor="middle" class="p-tm">OneLake security</text>
<text x="161" y="188" text-anchor="middle" class="p-mo" style="fill:#00B7C3">OLS · RLS · CLS</text>
<line x1="76" y1="208" x2="246" y2="208" stroke="#00B7C3" stroke-width="1" opacity="0.4"/>
<text x="161" y="230" text-anchor="middle" class="p-tm">Single source of</text>
<text x="161" y="248" text-anchor="middle" class="p-tm">authorization truth</text>
<rect x="512" y="40" width="220" height="72" rx="10" class="p-box"/>
<image href="/icons/fabric/group_workspace_48_non-item.svg" x="524" y="53" width="24" height="24"/>
<text x="632" y="70" text-anchor="middle" class="p-t">Consumer workspace A</text>
<text x="622" y="90" text-anchor="middle" class="p-tm">shortcut only — no copy, no grant</text>
<rect x="512" y="144" width="220" height="72" rx="10" class="p-box"/>
<image href="/icons/fabric/group_workspace_48_non-item.svg" x="524" y="157" width="24" height="24"/>
<text x="632" y="174" text-anchor="middle" class="p-t">Consumer workspace B</text>
<text x="622" y="194" text-anchor="middle" class="p-tm">shortcut only — no copy, no grant</text>
<rect x="512" y="248" width="220" height="72" rx="10" class="p-box"/>
<image href="/icons/fabric/group_workspace_48_non-item.svg" x="524" y="261" width="24" height="24"/>
<text x="632" y="278" text-anchor="middle" class="p-t">Consumer workspace N</text>
<text x="622" y="298" text-anchor="middle" class="p-tm">shortcut only — no copy, no grant</text>
<path d="M272,168 C 360,120 440,86 510,78" class="p-ed" marker-end="url(#pah2)"/>
<path d="M272,186 C 380,184 430,182 510,180" class="p-ed" marker-end="url(#pah2)"/>
<path d="M272,204 C 360,252 440,278 510,284" class="p-ed" marker-end="url(#pah2)"/>
<text x="360" y="112" text-anchor="middle" class="p-lb">shortcut</text>
<text x="360" y="176" text-anchor="middle" class="p-lb">shortcut</text>
<text x="360" y="266" text-anchor="middle" class="p-lb">shortcut</text>
</svg>
<figcaption><strong>Figure 2.</strong> Producer / consumer fan-out. Policy lives once, at the producer, in OneLake security. Consumers hold only shortcuts — no replicated data and no independent grant to keep in sync. The choice of pass-through vs delegated for these shortcuts turns on the consumer topology below.</figcaption>
</figure>

### When pass-through is correct

The producer wants each consumer evaluated individually against source authorization, the consumer population is bounded, and every consumer is a resolvable Entra principal in the producer's tenant. Pass-through keeps the source as the authorization system of record and requires no credential to store or rotate.

### When delegated is correct

Fan-out to many consumers, where "when a curated dataset must be served to thousands of downstream users across multiple teams, the data owner becomes responsible for granting and maintaining every individual user's permission on the source" ([Fabric Community](https://community.fabric.microsoft.com/t5/Fabric-Updates-Blog/Simplifying-secure-data-access-with-Delegated-OneLake-Shortcuts/ba-p/5254632)). Delegation collapses that N-grant problem to a single connection identity, with the producer defining RLS/CLS at the source and consumers seeing the intersection of their own security and the delegated identity's. Cross-tenant and multicloud targets force delegation regardless — external shortcuts are delegated-only, and the binding user must hold permission on the cloud connection.

The cross-tenant caution: with delegation you must treat the connection identity as a shared, standing credential whose blast radius is every consumer of the shortcut. Scope it to exactly the source data the shortcut exposes, and enforce differentiation through producer-side OneLake RLS/CLS rather than assuming the delegated identity is narrow.

## 6. Where this breaks

**Source authorization not aligned with OneLake permissions.** A shortcut to a Warehouse table inherits none of the Warehouse's SQL security. "Warehouse SQL RLS/CLS/OLS is enforced in the Warehouse SQL execution context and is not automatically translated into OneLake security policies" ([jamesserra.com](https://www.jamesserra.com/archive/2026/07/understanding-microsoft-fabric-onelake-security/)) — reconfirmed in the Learn docs: when warehouse data is reached through OneLake shortcuts, "these SQL security semantics are not translated into OneLake security policies." *Blast radius:* RLS that hid rows in the warehouse silently disappears for anyone reading the shortcut through OneLake or Spark.

**Inconsistent enforcement across access paths.** The same lakehouse table can enforce OneLake roles through Spark and Direct Lake over OneLake, yet enforce a completely different SQL model through a SQL endpoint in Delegated mode — where "any security rules defined in OneLake … will not apply when the same data is queried through the SQL analytics endpoint" ([Learn](https://learn.microsoft.com/en-us/fabric/onelake/security/sql-analytics-endpoint-onelake-security)). A user blocked in one tool sees everything in another. Model-only DAX rules have the same gap: they do not extend beyond the model. *Blast radius:* the same identity gets different row/column visibility depending on which engine it happens to use.

**Shortcuts to unmanaged external targets.** An external shortcut may require "source-system authorization plus OneLake security on the shortcut path" ([jamesserra.com](https://www.jamesserra.com/archive/2026/07/understanding-microsoft-fabric-onelake-security/)). If the S3 or ADLS bucket's own IAM is coarse, the delegated connection inherits that coarseness — and a write through the shortcut can delete target directories in the external account. *Blast radius:* Fabric-side permissions become a facade over whatever the external ACL actually allows.

**Delegated identity over-privilege.** The Direct-Lake-over-SQL-in-Delegated-mode exception means the item owner's identity, not the caller's, reaches the target, bypassing any target-path grant set for the end user. *Blast radius:* a broadly privileged owner delegates that breadth to every report consumer, filtered only by whatever OneLake roles happen to exist.

**Stale connection credentials.** A delegated shortcut is only as trustworthy as its stored connection identity. Because you cannot toggle a shortcut's auth model in place — it must be deleted and recreated — an over-scoped or unrotated service principal or account key persists as a standing grant behind every consumer until someone rebuilds the shortcut. *Blast radius:* credential lifetime is decoupled from access reviews; nobody notices the standing grant.

## Design checklist

- **Enforce at the OneLake layer** for lakehouse data — it is the only model that applies across every engine; treat model-only DAX rules as scoping, not security.
- **Pin the SQL analytics endpoint's access mode deliberately.** Use User identity mode wherever callers must be evaluated at the shortcut target; know that Delegated mode substitutes the item owner's identity.
- **Prefer Direct Lake over OneLake** when caller-identity passthrough at shortcut targets is required; Direct Lake over SQL inherits the endpoint's mode.
- **Choose pass-through for bounded, same-tenant consumers**; choose delegated for fan-out, and expect it as mandatory for external / cross-tenant targets.
- **Scope every delegated connection identity to least privilege** and enforce differentiation with producer-side RLS/CLS; audit that no consumer inherits more than intended.
- **Never assume Warehouse or KQL security carries into OneLake** — a shortcut crosses the enforcement boundary and drops the source policy.
- **Verify both paths** on every shortcut — shortcut path and target path — remembering most-restrictive-wins and that Admin/Member/Contributor bypass OneLake data-access roles.
- **Track connection-credential lifecycle** — rotate secrets, and remember that changing a shortcut's auth model means delete-and-recreate.
- **Treat delegated-shortcut and third-party-engine features as evolving** (both are Preview) and re-verify behavior against the live product before relying on it.

## References

Verified against Microsoft Learn documentation current as of July 2026 (Secure and manage OneLake shortcuts, last updated 2026-07-23), the Fabric Community announcement of Delegated OneLake Shortcuts (Preview), and James Serra's overview. Preview features and rolling capabilities should be re-checked against the live product before you rely on them.

1. [Secure and manage OneLake shortcuts — Microsoft Fabric (Microsoft Learn)](https://learn.microsoft.com/en-us/fabric/onelake/onelake-shortcut-security)
2. [OneLake shortcuts overview — internal shortcuts & cloud connections (Microsoft Learn)](https://learn.microsoft.com/en-us/fabric/onelake/onelake-shortcuts)
3. [OneLake security](https://learn.microsoft.com/en-us/fabric/onelake/security/get-started-security) and [Get started with OneLake security (Microsoft Learn)](https://learn.microsoft.com/en-us/fabric/onelake/security/get-started-onelake-security)
4. [OneLake security for the SQL analytics endpoint — user vs delegated identity mode (Microsoft Learn)](https://learn.microsoft.com/en-us/fabric/onelake/security/sql-analytics-endpoint-onelake-security)
5. [Direct Lake and OneLake security integration (Microsoft Learn)](https://learn.microsoft.com/en-us/fabric/fundamentals/direct-lake-security-integration)
6. [Create a OneLake shortcut — authentication kinds (Microsoft Learn)](https://learn.microsoft.com/en-us/fabric/onelake/shortcuts/create-onelake-shortcut)
7. [Kusto role-based access control (Microsoft Learn)](https://learn.microsoft.com/en-us/kusto/access-control/role-based-access-control?view=microsoft-fabric)
8. [Row-level security with Power BI semantic models (Microsoft Learn)](https://learn.microsoft.com/en-us/fabric/security/service-admin-row-level-security)
9. [Simplifying secure data access with Delegated OneLake Shortcuts, Preview (Fabric Community)](https://community.fabric.microsoft.com/t5/Fabric-Updates-Blog/Simplifying-secure-data-access-with-Delegated-OneLake-Shortcuts/ba-p/5254632)
10. [Understanding Microsoft Fabric OneLake Security — James Serra](https://www.jamesserra.com/archive/2026/07/understanding-microsoft-fabric-onelake-security/)
