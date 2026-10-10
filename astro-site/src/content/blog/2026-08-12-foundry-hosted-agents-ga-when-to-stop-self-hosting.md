---
title: "Foundry Hosted Agents Are GA: When to Stop Running Your Own Containers"
description: "Hosted agents in Foundry Agent Service are GA. How they compare with Agent Framework on Container Apps or AKS on identity, networking, cold starts and tracing."
author: Michael John Peña
draft: false
date: 2026-08-12
tags:
  - Microsoft Foundry
  - AI Agents
  - Architecture
  - Entra ID
  - Observability
---

Most teams that shipped a code-first agent in the last year built the same platform underneath it: a container image, Azure Container Apps or AKS, a managed identity, a VNet, an OpenTelemetry exporter and some way to keep conversation state alive between requests. None of that is the agent. On 9 July 2026 Microsoft made hosted agents in Foundry Agent Service generally available, and the question every team running its own agent containers should now ask is which parts of that platform they still want to own.

My short answer: for most single-purpose business agents, stop building the runtime yourself. The cases for self-hosting are real but narrower than "we already have AKS".

## What went GA on 9 July

Hosted agents are a managed runtime for agent code you write yourself, in Microsoft Agent Framework, LangGraph, the GitHub Copilot SDK or your own loop. You package it as a container image and Foundry runs it. The [hosted agents concept page](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/hosted-agents) covers the model; the important parts are these:

- **Per-session sandboxes.** Each session runs in its own hypervisor-isolated sandbox, not a shared container. The [April launch post](https://devblogs.microsoft.com/foundry/introducing-the-new-hosted-agents-in-foundry-agent-service-secure-scalable-compute-built-for-agents/) is explicit that this is neither process isolation nor a code-execution-only sandbox.
- **A persistent file system.** `$HOME` and `/files` survive when a session goes idle. The platform deprovisions compute after 15 minutes without a request, persists the session state and restores it on resume. Sessions inactive for 30 days are deleted.
- **Fixed sizes.** You choose 0.5 vCPU / 1 GiB, 1 vCPU / 2 GiB or 2 vCPU / 4 GiB per agent version. Billing follows the vCPU and memory of active sessions, so oversizing multiplies by your concurrency. Disk is budgeted too: up to 20 GiB per session at 1 vCPU or larger, with about 20% reserved, shared between your image and `$HOME`.
- **Standard protocols.** Clients call a dedicated agent endpoint over the Responses or Invocations protocols (including a WebSocket variant), authenticated with Microsoft Entra ID, and the platform bridges Responses to the Activity protocol when you publish to Teams or Microsoft 365.
- **Identity and tracing built in.** Each agent gets an Entra Agent ID, and the container ships OpenTelemetry traces to Application Insights without extra wiring.

Toolboxes, which manage reusable tools outside the agent, went GA in the same release. On the SDK side, `azure-ai-projects` 2.3.0 for Python (1 July) stopped requiring `allow_preview=True` for hosted agent methods, moved the session, session-file and agent-code methods from `.beta.agents` to `.agents` and the toolbox methods from `.beta.toolboxes` to `.toolboxes`, and renamed `agent_session_id` to `session_id` and `patch_agent_details` to `update_details`. If you prototyped against the preview SDK, those renames are the real migration cost: mechanical, but breaking.

Not everything around it is GA: Voice Live, memory, routines and the A2A endpoint were still preview at GA time, and the agent optimizer is in limited preview. Check each feature you depend on.

## The comparison that matters: what you own

Operational ownership settles this: who gets paged when each layer breaks.

| Concern | Hosted agents | Agent Framework on Container Apps | Agent Framework on AKS |
|---|---|---|---|
| Session isolation | Hypervisor sandbox per session, by default | Shared replicas unless you add dynamic sessions | Shared pods unless you add sandboxed runtimes |
| Session state and files | Persistent `$HOME` and `/files` per session | You build it (storage, Cosmos DB, Redis) | You build it |
| Identity | Entra Agent ID provisioned per agent | Managed identity you assign | Workload identity you configure |
| Networking | Managed VNet or a delegated subnet in your VNet | VNet-integrated environment you design | Everything is yours |
| Inbound endpoint | Public (Entra-authenticated) | Internal ingress possible | Private ingress possible |
| Scale to zero | Per session, with idle timeout | Per app, through KEDA rules | Possible, with extra components |
| Tracing | App Insights injected, OTLP optional | You wire the exporter | You wire the exporter |
| Compute ceiling | 2 vCPU / 4 GiB per session | Up to the workload profile | Up to the node pool, GPUs included |
| Image constraints | linux/amd64 only | Your choice | Your choice |

I'd weigh the first two rows most heavily. Per-session isolation and per-session durable files are the hardest things to build properly on Container Apps or AKS, and they are what an agent that writes and runs code actually needs. Container Apps dynamic sessions give you Hyper-V isolated sandboxes, but then your agent runtime and its sandbox live in two places, and you write the session lifecycle glue yourself. Hosted agents make the sandbox the runtime.

## Identity: better defaults, same responsibility

When you deploy a hosted agent, Foundry provisions an agent identity blueprint and an agent identity in Entra ID. Your code authenticates as that identity. By default it can reach model inference and its session storage, nothing more. Anything else, such as your Storage account, your Azure SQL database or your Key Vault, needs an explicit role assignment against the agent's principal ID, as the [agent identity concepts](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/agent-identity) page describes.

```bash
# Grant the hosted agent's Entra identity read access to one container, not the account
az role assignment create \
  --assignee-object-id "<agent-identity-principal-id>" \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Reader" \
  --scope "/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.Storage/storageAccounts/<storage-account>/blobServices/default/containers/<container-name>"
```

Compared with a user-assigned managed identity on Container Apps, this is an agent identity: it shows up in Entra as an agent, sits under a blueprint you can govern as a class, and supports the attended on-behalf-of flow, in which Agent Service exchanges the user's token for one that carries both the agent identity and the user's delegated permissions. That helps audit.

What it doesn't do is decide what the agent should be allowed to touch. The platform issues the identity, not the permission boundary. I'd treat the agent identity exactly like any other workload principal: scope assignments to the narrowest resource, never at subscription level, and review them as part of the agent's release. The [tool access policies post](/blog/2026-04-13-where-agent-systems-break-tool-access-policies-that-improve-reliability/) covers the application-side half of that boundary.

One friction point: end-to-end user delegation to your own MCP server or API needs its own configuration, either agent identity auth or OAuth identity passthrough on a project connection, as the [MCP authentication guide](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/mcp-authentication) explains. Prototype that path before you commit.

## Networking: managed VNet or bring your own

Read the [networking deep dive](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/agents-networking-deep-dive) in full: hosted agent traffic takes two paths. The agent's own outbound calls leave through the sandbox's network interface. Tool calls go through a per-project data proxy that reaches your Storage, databases and Key Vault over private endpoints, so your Private DNS zones have to be right for both paths.

You then pick between two isolation models.

**Bring your own VNet** injects agent compute into a subnet you delegate. You control address ranges, peering, routing and your own firewall. The costs are subnet planning (a /24 is recommended, it must use private address space, and it can't be shared between Foundry resources), the Foundry resource and VNet in the same region, and your own Storage, AI Search and Cosmos DB for full isolation. Delegated subnets are IPv4.

**Managed virtual network** has Microsoft run the network. You choose internet outbound, approved outbound only, or disabled. Approved-only uses service tags, private endpoints and FQDN rules on ports 80 and 443, and FQDN rules provision a managed Azure Firewall that you pay for. You can't bring your own firewall, and once enabled it can't be turned off or converted to a custom VNet. The `az cognitiveservices account managed-network` command group is still preview, and managed VNet for the new Agent Service is limited to a listed set of regions, so read the [managed network page](https://learn.microsoft.com/en-us/azure/foundry/how-to/managed-virtual-network) for current region and agent-type coverage before designing around it.

Neither model makes the agent endpoint private. The [virtual networks page](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/virtual-networks) says it stays public, authenticated with Entra ID; per-user isolation comes from session isolation, not network privacy. Against an internal-only Container Apps environment, that is the gap to raise with your security team.

My rule of thumb: if your organisation already routes all egress through a central firewall with logging, take BYO VNet. Managed VNet suits teams without a hub network, or with overlapping address space, who accept Microsoft's firewall and its gaps. Neither option is less work than Container Apps if you already have a well-run landing zone; the saving is in everything else on the table.

On images: since 25 June 2026, new projects can pull the agent image from a network-secured private Azure Container Registry. Older projects need the registry's public endpoint. Images must be linux/amd64, which catches anyone building on Apple Silicon:

```bash
docker buildx build --platform linux/amd64 \
  -t <your-registry>.azurecr.io/<agent-name>:1.0.0 \
  --push .
```

## Cold starts and quotas

An idle session must be restored before it can answer: compute is reprovisioned and `$HOME` and `/files` come back. I'd measure resume latency for your own image size before setting a [latency budget](/blog/2026-04-26-practical-ai-performance-tuning-setting-latency-budgets-per-user-journey/) for a user-facing journey. The 15-minute idle timeout is fixed, so an agent that users visit sporadically will pay the resume cost on most first requests. Design the first response of a journey to tolerate it.

Capacity is the other surprise. The number of concurrent sessions per subscription varies by region. With BYO VNet, sessions map 1:1 to usable subnet IPs by default, so a /26 gives roughly 50 concurrent sessions; a support request can raise that to 10 sessions per IP. A Container Apps environment scales to whatever you configure; a hosted agent fleet needs that ceiling in your capacity plan.

## Observability without the exporter boilerplate

Foundry injects the Application Insights connection string into the container, and agents built on the Responses or Invocations protocol libraries emit traces with no extra code. You can also export to an OTLP endpoint or your own OpenTelemetry Collector, alongside App Insights or instead of it, as the [telemetry configuration guide](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/configure-hosted-agent-telemetry) shows. Two details matter. The App Insights connection string is reserved, so you can't override it in `agent.yaml`. And export settings are environment variables fixed per agent version, so changing a destination means a new version.

That's a sensible trade. On Container Apps you'd hand-wire the same exporter, which is fine if you already run a shared Collector. If you use the [Agent Framework Harness](/blog/2026-07-29-agent-framework-harness-vs-plain-agent/), its telemetry lands in the same place.

## When self-hosting is still the right call

I'd keep running my own containers when any of these is true:

- **The workload outgrows 2 vCPU / 4 GiB.** Agents that run local models, process large files in memory or need GPUs belong on AKS or GPU workload profiles.
- **The agent is a long-running worker, not a session.** Batch pipelines and queue consumers that run for hours suit Container Apps jobs better.
- **You need network behaviour hosted agents don't offer.** Your own firewall under a managed VNet, IPv6 egress, sidecars or service mesh policy all point to self-hosting.
- **Inbound traffic must be private-only.** The hosted agent endpoint is public with Entra authentication. If policy forbids that, keep the agent behind internal ingress.
- **Region or sovereignty constraints.** Hosted agents run in a fixed set of regions; if yours isn't on the list, that settles it.
- **Portability is a hard requirement.** If the same agent must run on another cloud or on-premises, a plain container on Kubernetes is the honest lowest common denominator.
- **Your platform already does all of this well.** Per-session sandboxes, workload identity and a shared Collector already in place mean migration buys little.

## The decision

If you're starting a new code-first agent on Azure today, default to hosted agents and make the self-hosting case prove itself against the list above. Per-session isolation, durable session files, an agent-native identity and tracing out of the box are the parts teams most often build badly, and they now come with the runtime. Spend the saved effort on what it leaves to you: identity scope, egress design and resume latency.

If you're already running agents on Container Apps or AKS, don't migrate for the sake of it. Migrate the agents that run untrusted or generated code, or that hand-roll session state, first. Those gain the most from a sandbox they didn't have to build.
