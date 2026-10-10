---
title: "Fabric IQ Goes GA in Copilot: Your Semantic Model Is Now an Agent API"
description: "Fabric IQ is GA in Copilot Chat, Cowork and MCP. Treat each semantic model as an agent endpoint: RLS, OLS, metadata contracts and default-on access."
author: Michael John Peña
draft: false
date: 2026-10-01
tags:
  - Microsoft Fabric
  - Power BI
  - Copilot
  - MCP
  - Governance
  - Semantic Models
---

At FabCon Europe in Barcelona this week, Microsoft made Fabric IQ generally available in Microsoft 365 Copilot Chat and Copilot Cowork, and shipped the Fabric IQ MCP server as GA. Taken together, that means almost any Power BI semantic model a user can read (outside Power BI-only regions and sovereign clouds) is now something an agent can find, inspect and query with DAX on that user's behalf. Most Power BI estates were governed on the assumption that a human opens a report and looks at curated visuals, and the governance work has to catch up before the rollout does.

## What actually shipped

The [Fabric analytics announcement from FabCon Europe](https://community.fabric.microsoft.com/blog/fbc_fabricupdatesblogs/bringing-governed-analytics-into-the-flow-of-work-fabric-analytics-at-fabcon-eur/5368918) covers a lot of ground. Three items matter for this argument:

| Surface | Status | What it does |
| --- | --- | --- |
| Fabric IQ in Microsoft 365 Copilot Chat | GA | Copilot finds a relevant report and semantic model and answers business questions from it, alongside files, chats and email. Needs a Microsoft 365 Copilot licence; models on Embedded (A or EM SKU) capacities aren't supported |
| Fabric IQ in Copilot Cowork | GA | Power BI answers feed into Cowork workflows such as drafting emails, documents, meeting agendas or recurring summaries |
| Fabric IQ MCP server | GA | A remote, read-only MCP server any compatible client can call to discover reports and models, read schemas and run DAX |

All three run as the signed-in user, and all three are reachable by default.

## Why "agent API" is the right mental model

The [Fabric IQ MCP server documentation](https://learn.microsoft.com/en-us/fabric/iq/connectors/fabric-iq-mcp) reads like an API reference, because that's what it is. Six tools: `DiscoverArtifacts`, `ResolveFabricItem`, `GetReportMetadata`, `GetSemanticModelSchema`, `ValueSearch` and `ExecuteQuery`. A versioned tool contract, selected with an `X-Variants` header (currently `Fabric.Routing.FabricIQ.V1`), and guidance to call `tools/list` at runtime and tolerate additive fields. There's no natural-language answering tool: the calling agent reads your schema, writes its own DAX, runs it and explains the result.

Connecting a client is a few lines of configuration. This is the GitHub Copilot CLI setup from the docs, saved as `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "FabricIQ": {
      "type": "http",
      "url": "https://fabriciq.svc.cloud.microsoft/v1/mcp/fabriciq",
      "tools": ["*"]
    }
  }
}
```

Two prerequisites on that page change the risk picture more than the GA label does.

First, **the server doesn't need a workspace role or Build permission on the semantic model**. Read access to a report or model is enough to discover it and run DAX against it. Build permission used to separate "can view the reports" from "can write queries against the model". Now an agent acting for a Read-only user can compose arbitrary DAX against everything the model exposes to them. RLS and OLS still apply, so the data boundary hasn't moved, but the *query surface* has grown from curated visuals to the whole model.

Second, **authentication is delegated only**: Microsoft Entra ID OAuth with the Power BI Service `Item.Read.All`, `Item.Execute.All` and `Dataset.Read.All` permissions. Service principals, app-only tokens and admin impersonation aren't supported. That's the right design, because every call is attributable to a person, but your security is now exactly as good as your per-user permissions.

## RLS and OLS under delegated identity

Both the [Copilot Chat documentation](https://learn.microsoft.com/en-us/fabric/iq/connectors/microsoft-365-copilot-overview) and the MCP documentation say the same thing: queries run as the signed-in user, and row-level and object-level security on the model still restrict what comes back. That's reassuring, and it's where I'd look for gaps first.

**RLS only filters viewers.** RLS restricts users with Viewer permission; workspace Admins, Members and Contributors see unfiltered data. Delegated identity carries that rule straight into Copilot and MCP. The analyst who is a Member of the workspace "just to help with refreshes" now has an agent that can query every row, in a chat window, with the result carried into an email draft. If your RLS design relied on people not bothering to open the dataset directly, it was never a control. Agents remove the bother.

**OLS is now load-bearing.** Hiding a column in a report or setting it hidden in the model was always cosmetic, and with agents reading the schema it's worse than cosmetic. Prep data for AI features such as AI data schemas shape what Copilot *focuses on*; they aren't an access control. If a column such as salary, health status or a customer identifier must not reach a group of users, it needs [object-level security](/blog/2022-04-23-power-bi-object-level-security/) on a role those users belong to. Anything short of that is a suggestion.

**Test as the agent would.** "Test as role" in the service checks visuals. It doesn't check what someone can extract with handwritten DAX against the full model. Before a sensitive model is exposed, I'd have someone in each role connect through the MCP server and try to break out: summarise across the RLS key, ask for the hidden columns by name, use `ValueSearch` for a value they shouldn't know exists. A query like this, run through `ExecuteQuery` as a test user, tells you quickly whether the row filter holds:

```dax
EVALUATE
SUMMARIZECOLUMNS (
    'Region'[Region Name],
    "Rows visible", COUNTROWS ( 'Sales' )
)
```

If a Viewer in the APAC role gets more than APAC back, your [RLS design](/blog/2022-04-22-power-bi-row-level-security/) has a hole, and an agent will find it faster than a person would.

## Descriptions and synonyms are part of the contract

When an agent calls `GetSemanticModelSchema` and then writes DAX, the names, descriptions and synonyms stop being documentation and become the interface. The MCP documentation warns that a result can be incomplete or fail if the model doesn't expose the fields, measures, relationships or values needed for the question. The worse failure is a confident wrong answer, which happens when the agent picks `Revenue` over `Net Revenue (Excl. Returns)` because nothing told it which one finance actually reports.

My rule of thumb is to treat a model exposed to Copilot the way you'd treat a published REST API:

- **Every measure people will ask about has a description** in business language, including the grain and the exclusions. "Net revenue after returns and rebates, in AUD, by invoice date" beats "Revenue calc v2".
- **Synonyms reflect how people ask, not how the warehouse is named.** If sales call it "bookings" and finance calls it "revenue", both need to resolve to the right measure.
- **Technical columns are hidden, and sensitive columns are secured.** Hidden reduces noise in the schema; only OLS removes access.
- **Ambiguity is removed, not documented.** Three similar date tables or two "customer count" measures with different logic will produce inconsistent answers. Consolidate them.
- **Renames are breaking changes.** If a measure name or meaning changes, the questions people saved and the Cowork workflows built on top of it may behave differently. Version and announce changes as you would for an endpoint.

Microsoft's [Prep data for AI](https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai) features (AI data schemas, AI instructions and verified answers) add another layer on top of this. They help, but they're not a substitute for a clean model, and Microsoft says plainly they can't guarantee a specific output.

This is also where [endorsement](/blog/2023-11-14-fabric-endorsement-certification/) earns its keep. A certified model should now mean "this model's metadata is fit for an agent to reason over, and its security has been tested through the agent path." If your certification criteria don't include that, update them before you lean on the badge.

## Cowork raises the stakes

The [Cowork documentation](https://learn.microsoft.com/en-us/fabric/iq/connectors/cowork-overview) is candid about two gaps. Purview DLP isn't currently supported in Cowork, unlike Copilot Chat, where DLP policies can stop Copilot using content with a given sensitivity label. And Cowork's data answers carry no citations back to the source report or model, so the person reading the email Cowork drafted has no way to trace the number. Because Cowork chains a result straight into the next skill, a sensitive number can reach an outgoing email before anyone checks it. Until DLP lands there, I'd treat any model with a sensitive label as unsuitable for broad Read access, because Cowork users will reach it.

## Default-on is a decision, so make it yours

Every switch on these paths starts open. In the Microsoft 365 admin center, *Fabric data available in M365 Copilot* is on by default and covers both Copilot Chat and Cowork; the docs describe it as a tenant-wide on/off. In the Fabric admin portal, *Share Fabric data with your Microsoft 365 services* only controls proactive metadata sharing for search and the attachment menu. With it off, users can still paste a report link or name a report. For the MCP path, the tenant-level gate is Entra consent: the three Power BI Service delegated permissions don't need admin consent by default, but an admin can restrict user consent or require the admin approval workflow. That gate is all-or-nothing per user. It decides *who* can connect, not *which models* they can query.

I understand the defaults: a feature that's off everywhere never gets used. But none of these switches sits at the granularity of the data. The Fabric IQ docs don't describe a per-model opt-out for these surfaces, so the model-level control you can rely on today is the one you already have: who holds Read, and what RLS and OLS do to them. Default-on means every model any Read-only user can open is an agent endpoint, including the forgotten departmental model shared with a whole security group years ago. Nobody made that decision; the default did.

So make it an explicit decision before rollout:

1. **Inventory first.** Use the [admin scanner APIs](/blog/2026-07-27-fabric-governance-as-automation-admin-scanner-rest-apis/) to list models, their endorsement, sensitivity labels and who has Read through sharing, apps and security groups. Broad Read grants are the exposure.
2. **Decide the policy by tier.** My starting point: certified models with tested RLS/OLS keep their audience; models with sensitive labels or untested security get their Read grants narrowed until reviewed; uncertified personal or departmental models lose broad security-group grants.
3. **Give model owners the job, with a deadline.** Read grants and roles live with them, so the rollout plan has to name owners and a date, not just a tenant toggle.
4. **Decide consent deliberately.** If MCP clients should be limited to a pilot group, route the three Power BI permissions through admin approval before announcing the server, not after.
5. **Re-check after publishing.** Make Read grants and role membership part of your model release checklist, so a new model doesn't silently ship to a broad group, and confirm roles and permissions survive a redeploy from Desktop or a deployment pipeline.

## Where I land

This GA is good news: governed semantic models are exactly what agents should answer from, far better than last quarter's CSV export. But it changes what a semantic model is. It's no longer a backend for reports; it's a published, queryable interface with a versioned contract, delegated callers and a security model that has to hold under arbitrary DAX.

If you already run tight RLS and OLS, clean metadata, narrow Read grants and real certification criteria, you're most of the way there. Decide on consent and the tenant switch deliberately and move on. If you don't, the honest move is to narrow access now and open models up as each one passes the agent-path tests. Letting the defaults pick the scope for you is the option I'd avoid.
