---
title: "Foundry Project Boundaries: Draw Them Around Use Cases, Not Demos"
description: "How I split Microsoft Foundry resources and projects by environment and use case so RBAC, quota and agent data line up with ownership and delivery speeds up."
author: Michael John Peña
draft: false
date: 2026-03-08
tags:
  - Microsoft Foundry
  - Architecture
  - Governance
  - Platform Engineering
  - Security
---

Slow AI delivery is often not a model problem or a tooling problem. It's a boundary problem: nobody can say who owns a deployment, which team can change a connection, or why a prompt change in one use case broke another. In Microsoft Foundry, the resource and project layout you choose on day one decides those answers for you, so it's worth choosing on purpose.

If you haven't yet decided between Foundry projects and hub-based projects, start with my earlier post on [the Microsoft Foundry rename, hubs and projects](/blog/2026-02-23-azure-ai-foundry/). This one assumes you've picked Foundry projects and asks the next question: how many, and where do the lines go?

## What the boundaries actually are

There are two scopes in a Foundry project setup, and they don't isolate the same things.

| Lives on the Foundry resource (shared) | Lives on the project (isolated) |
|---|---|
| Model deployments and their quota | Agents and their conversations, files and vector stores |
| Guardrail (content filter) definitions; each one is assigned per deployment or, in preview, per agent | Evaluation runs and results |
| Networking: public access, private endpoints | Project-scoped connections |
| Customer-managed keys | Project managed identity and its role assignments |
| Resource-level connections shared by all projects | Data plane access via the project endpoint, for agents, evaluations and project connections |

Microsoft's [Foundry planning guide](https://learn.microsoft.com/en-us/azure/foundry/concepts/planning) describes the resource as the governance scope and projects as the containers for work. That framing matters, because the common mistake is to treat a project as a security boundary for everything. It isn't. Model deployments live on the resource, so every project under it can call them; a project can't own or hide a deployment. Guardrails (content filters) are defined on the resource too, and a change to one affects every deployment and agent it's assigned to, across projects.

The Agent Service makes the project boundary stronger than it first looks. With the [standard agent setup](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/standard-agent-setup), you bring your own Azure Storage, Azure AI Search and Azure Cosmos DB, and Foundry provisions separate containers per project for files and conversation state. Two projects on the same resource don't see each other's agent conversations. The capability host that wires those resources in can't be changed once it's set, which is another reason to settle the layout before the first agent goes live.

## The layout I'd start with

My default for an organisation with more than one AI use case in production:

- **One Foundry resource per environment per business group.** Dev, test and prod are separate resources, ideally in separate resource groups or subscriptions. Prod networking and keys are not something a dev experiment should be able to touch.
- **One project per use case, not per person and not per team.** A use case has a product owner, an evaluation dataset and a release cadence. That's the unit you want access, agents and evaluation results grouped by.
- **Shared services as resource-level connections; use-case-specific data as project connections.** The enterprise search index everyone reads is a resource-level connection. The HR policy index only the HR assistant should touch is a project connection.

This lines up with the planning guide's own advice to establish distinct environments for development, testing and production, and to associate projects with use cases. My policy split: production defaults to isolation unless a documented exception allows colocation; exploration defaults to colocation unless compliance says otherwise. Write it down and get it signed off before anyone opens the portal.

### Why one project per use case speeds delivery up

The boundary becomes the contract. When a project maps to one use case, three things get simpler:

1. **Ownership is visible.** The people with project-level roles are the people who ship that use case. When something breaks, the access list is the escalation list.
2. **Evaluation results stay attached to what they measure.** If you gate releases on evaluation, and you should, the runs sit in the project next to the agents they describe. No one has to filter a shared project by naming convention to find last week's baseline.
3. **The handoff from data engineering is explicit.** The data team owns the index or table; the AI team gets a connection to it in their project. Changing the shape of that data now means changing something another team depends on, which is exactly when you want a contract and an integration test to fire.

That third point comes from work I did smoothing the handoff between data engineering and AI teams, where the integration test that mattered simply checked that the index still exposed the fields and types the AI side's contract named. A connection is a seam you can test across. A shared notebook with a hard-coded key isn't.

## Access: give out the narrowest role at the narrowest scope

Microsoft's Foundry RBAC guide centres on four built-in roles, and three of them map cleanly onto this layout. They're documented in [role-based access control for Microsoft Foundry](https://learn.microsoft.com/en-us/azure/foundry/concepts/rbac-foundry):

| Role | What it's for | Where I assign it |
|---|---|---|
| Azure AI Account Owner | Create and manage Foundry resources and projects; can assign Azure AI User | Platform team, on the resource |
| Azure AI Project Manager | Manage a project and build in it; can assign Azure AI User | Use-case lead, on that project |
| Azure AI User | Build and call things in a project (data actions) | Developers (plus Reader on the resource) and the app's managed identity, on that project |

The fourth, Azure AI Owner, is the self-serve role that combines managing resources and projects with building in them. That's convenient for a solo developer, but in an enterprise estate it collapses exactly the separation between platform and use-case teams that this layout is trying to create, so I keep it out of the assignment plan.

The Account Owner can't build in a project by default, which I like: the platform team runs the estate without becoming an accidental contributor to every use case. The Project Manager role lets a use-case lead onboard their own developers without a ticket to the platform team, and that alone takes the platform team off the critical path for onboarding. Developers also get Reader on the Foundry resource, as in Microsoft's sample mapping, so they can see the shared deployments and resource-level connections their project depends on, which a project-scope assignment alone doesn't reach.

There's a trade-off in where I put Project Manager. Microsoft's sample mapping assigns it at resource scope so leads can create their own projects. I prefer project scope, so the platform team creates each project: one ticket per use case, which keeps the definition of a use case with the people who agreed it. It doesn't slow the lead afterwards, because [publishing an agent](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/publish-agent) needs Azure AI Project Manager on the project, not the resource.

One scope caveat for the app's managed identity: a project-scope Azure AI User grant covers calls through the project endpoint (agents, evaluations and the project-scoped OpenAI client), but an app calling a deployment directly on the resource's inference endpoint needs the role on the resource, or a narrower custom role there.

Assigning Azure AI User at project scope looks like this:

```bash
# Grant a developer group build access to one Foundry project only.
az role assignment create \
  --role "Azure AI User" \
  --assignee-object-id "<entra-group-object-id>" \
  --assignee-principal-type Group \
  --scope "/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.CognitiveServices/accounts/<foundry-resource-name>/projects/<project-name>"
```

Assign to groups, not individuals, and put the assignment in your infrastructure code rather than the portal. Passing the object ID and principal type explicitly stops the CLI from looking the principal up in Microsoft Graph, which fails for pipeline identities without Graph read permissions. A role granted by hand in a hurry is the one nobody remembers to remove.

## Quota is the boundary people forget

Azure OpenAI quota is assigned per subscription, per region, per model and per deployment type (Standard, Global Standard, Data Zone and so on), in tokens per minute, and every deployment draws from it. Projects don't get their own quota; they share the deployments on their resource. So if two use cases share a resource and one runs a batch job against a shared deployment, the other one feels it.

My rule of thumb:

- **Dev and test:** share deployments. The waste of one deployment per project outweighs the occasional throttle.
- **Prod:** give latency-sensitive use cases their own deployment, and size it deliberately. If a use case justifies provisioned throughput, it almost certainly justifies its own resource too.

The [quota management guide](https://learn.microsoft.com/en-us/azure/foundry/how-to/quota) shows where to see TPM allocations per deployment; you rebalance by editing each deployment's rate limit. Put it on your monthly review; quota drifts as quickly as cost does.

## When not to split

Boundaries cost something. Each extra resource is another private endpoint, another set of diagnostic settings, another key policy and another place where a deployment needs to exist. I wouldn't split when:

- **You have one use case and one team.** One resource per environment and one project is fine. Add the second project when the second use case arrives, not before.
- **You're running a time-boxed proof of concept.** Colocate in a sandbox resource. The point is to learn whether the idea works, not to model your org chart.
- **The capability you need doesn't honour project isolation.** Not every Foundry Tools API (formerly Azure AI services) is exposed through the project endpoint; Translator, for example, is called on the resource endpoint, so access has to be granted on the resource. If isolation is a hard requirement for one of those, give it its own resource; a project boundary won't save you.

Guardrails are the subtler case. Per-agent guardrails (preview) let use cases differ inside one resource, and an agent's guardrail overrides its model deployment's. Because that's still preview, I keep strict prod differences on separate deployments with their own guardrails, owned by the platform team, and I don't give use-case leads the permission to reassign guardrails in prod.

And I'd go further than a project, to a separate resource, when guardrail changes need different owners or approval paths, or two teams need different network rules or different customer-managed keys. Those settings live on the resource, so no amount of project design will separate them.

## What I'd decide before the first deployment

Write down four things and get them agreed:

1. Which environments get their own resource, and in which subscriptions.
2. What counts as a use case, since that's your project boundary.
3. Which connections are shared at resource level and which are owned by a project.
4. Who holds Account Owner, Project Manager and User, assigned to groups through code.

It's a short document. It's also the one that stops the "who owns this?" conversation from happening in the middle of an incident, and that conversation is an expensive place to discover your boundaries.
