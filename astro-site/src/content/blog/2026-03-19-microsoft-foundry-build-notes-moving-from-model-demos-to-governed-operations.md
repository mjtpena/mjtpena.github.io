---
title: "Foundry After the March GA: What's Governed and What's Still Preview"
description: "Foundry Agent Service went GA in mid-March 2026, but monitoring and tracing are still preview. What's governed now, and the controls I'd add first."
author: Michael John Peña
draft: false
date: 2026-03-19
tags:
  - Microsoft Foundry
  - Governance
  - AI Agents
  - Observability
  - Responsible AI
---

A demo needs one deployment and a prompt. A governed operation needs someone to know which agents exist, what each one can call, which version is live, and how a quality regression gets caught before it reaches the systems and people downstream. In mid-March 2026 Microsoft closed part of that gap by making the next-generation [Foundry Agent Service generally available](https://learn.microsoft.com/azure/foundry/agents/concepts/limits-quotas-regions). Only part of the stack went GA, and that line decides what you can put in front of an auditor. Here's how I'd separate what Foundry now governs from what you still build.

## What reached GA in March

The [general availability overview](https://learn.microsoft.com/azure/foundry/concepts/general-availability) is the page to read before believing any slide. The headline items:

- **Foundry Agent Service (next generation).** The agent runtime built on Foundry projects, not the hub-based classic setup. If you're still deciding between the two project types, I covered that in [the post on the Foundry rename](/blog/2026-02-23-azure-ai-foundry/).
- **The refreshed Foundry portal.** GA for the core scenarios across model deployment, agent development and operations, with a readiness table that still marks some capabilities preview.
- **Evaluations.** "Build | Evaluations | GA" on the readiness table, with built-in evaluators writing to the Application Insights resource connected to your project.

Read the observability rows carefully. The same page lists evaluations, tracing and monitoring among the core agent development scenarios at GA, but on 19 March the readiness table still shows "Build | Monitoring | Preview" and "Build | Tracing and tracing VNet | Preview", the tracing docs carry "(preview)" in their titles, and the Monitor dashboard page that documents continuous evaluation carries the preview banner. Until those agree, check the readiness table row for each feature you depend on rather than the scenario summary.

And what did *not* move to GA in the same breath:

| Capability | Status on 19 March 2026 | What it means for production |
|---|---|---|
| Tracing (all agent types) | Preview on the readiness table | Useful, but don't make it your only record |
| Hosted agents and workflow agents | Preview | Keep production agents on prompt agents for now |
| Voice Live, Memory, Knowledge | Preview | Prototype with them; don't put them on a critical path |
| Monitor tab, continuous evaluation settings, Alerts (preview) | Preview | Pilot them; keep alert rules you own in Azure Monitor |
| Custom evaluators | Preview | Keep a fallback in your own pipeline |
| Agent-level guardrails, tool call and tool response controls | Preview | An agent guardrail replaces the deployment guardrail, so configure it completely |
| Operate > Overview and Assets (fleet inventory) | Preview | Turn it on for visibility; don't treat it as your system of record |
| Operate > Compliance and its remediation flow | Preview | Manage the underlying Azure Policy assignments as code |
| AI Gateway (API Management) in Foundry | Preview | Keep the APIM policies (quota, auth, logging) defined as code in your own APIM, and don't rely on the Foundry-managed configuration flow while it's preview |
| Microsoft Entra Agent ID | Preview | Already provisioned for you; review the roles it holds |

Every preview row carries the standard terms: no SLA, and not recommended for production. That doesn't mean "don't use it". It means don't let it be the *only* control between a bad change and a customer.

## Move the quality check to the boundary

Quality regressions are expensive because they are discovered too late. Picture a prompt edit that ships on a Tuesday, a downstream report that starts quoting wrong policy numbers on the Thursday, and nobody able to say which agent version produced which answer.

Tracing, preview or not, helps with the "which version" half. Traces tie a response to the agent version, model deployment, tool calls and retrieved content, and continuous evaluation scores sampled live responses with the same evaluators you used before release. What it doesn't do is stop the release. Continuous evaluation tells you after the fact; the gate has to sit in front of the deployment.

So I put two checks at two boundaries:

1. **Before promotion.** A fixed evaluation set runs against the candidate agent version in CI, and the release fails on regressions, not on averages. I wrote up the [comparison approach I use for groundedness](/blog/2026-03-09-how-i-evaluate-llm-changes-tracking-groundedness-before-celebrating-fluency/) separately; the point here is where it runs, not how it scores.
2. **After promotion, before consumption.** A [continuous evaluation rule](https://learn.microsoft.com/azure/foundry/observability/how-to/how-to-monitor-agents-dashboard) on live traffic, with an alert that pages the owning team when results fall below the threshold you set at release.

Two settings control what continuous evaluation costs and covers. In the portal, the Monitor settings panel has a **sample rate** for continuous evaluation. In the SDK (`azure-ai-projects` 2.0), the rule's `ContinuousEvaluationRuleAction` takes `max_hourly_runs`, which defaults to 100; once a rule hits that cap, further responses in the hour are skipped, not queued. Size the cap from your traffic: an agent handling 2,000 responses an hour with the default cap is scoring at most 5% of them. That's usually enough to catch drift. I'd raise it for the week after each release, accepting that LLM-judged evaluators consume judge-deployment tokens.

The results land in the project's Application Insights as `gen_ai.evaluation.result` events, following the OpenTelemetry GenAI conventions; the [classic continuous evaluation doc](https://learn.microsoft.com/azure/foundry-classic/how-to/continuous-evaluation-agents) queries them with `traces | where message == "gen_ai.evaluation.result"`. Continuous evaluation covers agents built in Foundry. An agent built elsewhere and onboarded through AI Gateway is only covered, by both the evaluation rule and the alert below, once it sends its traces to the same Application Insights resource. Because the Foundry alert experience is preview, I'd put the paging alert in an Azure Monitor log search alert that you own, so it survives portal changes. A fragment for the alert query, to adjust once you've confirmed in your workspace which table the events land in:

```kusto
// Fragment: log search alert query over continuous evaluation results.
// Evaluation events can appear in traces (message) or customEvents (name).
// In a workspace-scoped query these are AppTraces (Message) and AppEvents (Name), with Properties.
// Confirm the customDimensions key names and the label values your evaluators emit before relying on this filter.
union isfuzzy=true traces, customEvents
| where timestamp > ago(1h)
| where message == "gen_ai.evaluation.result" or name == "gen_ai.evaluation.result"
| extend evaluator = tostring(customDimensions["gen_ai.evaluation.name"]),
         label = tostring(customDimensions["gen_ai.evaluation.score.label"])
| summarize total = count(), failed = countif(label == "fail") by evaluator
| extend fail_rate = todouble(failed) / total
| where total >= 20 and fail_rate > 0.10
```

Alert when this returns any rows. The `total >= 20` floor stops a single bad score in a quiet hour from paging someone at 2am; tune both numbers to the threshold you set at release.

## Guardrails: an agent guardrail replaces, it doesn't add

What used to be called content filters are now [guardrails and controls](https://learn.microsoft.com/azure/foundry/guardrails/guardrails-overview). On a model deployment they're GA: filtering for hate, sexual, self-harm and violence content, prompt shields for user prompt attacks and indirect attacks, and protected material detection.

The newer part is guardrails assigned per agent, with intervention points on tool calls and tool responses. That's the control I actually want for agents, because the risky moment is rarely the user's message. It's the agent passing a scraped web page into a tool, or a tool returning something the model then treats as instructions. Two limits matter on this date: it's preview, and it applies only to agents built in Foundry Agent Service, not to other agents registered in Control Plane.

The behaviour that catches people out is the override. An agent with no custom guardrail inherits the guardrail of its model deployment. Assign a guardrail to the agent and it fully overrides the deployment guardrail for that agent. So an agent guardrail has to restate every deployment-level control (hate, sexual, self-harm, violence, user prompt attacks, indirect attacks, protected material, and PII detection if you use it at the deployment) and then add the tool call and tool response controls on top. Spotlighting and Groundedness aren't supported for agents yet, so if you rely on either at the deployment, assigning an agent guardrail quietly drops it for that agent. Agent guardrails also only support Annotate and block, so any deployment control you run in annotate-only mode becomes a blocking control when you copy it to the agent. Decide that on purpose.

My rule of thumb: one guardrail per agent, built by copying the deployment configuration and adding the tool controls, and reviewed whenever the deployment guardrail changes, because nothing keeps the two in sync for you. The clean unit of governance is the agent version: one guardrail, one evaluation rule, one alert, one owner, with the promotion rule written down in the repository next to the evaluation set. If a tool's output can carry untrusted text, the [tool surface itself](/blog/2026-03-11-building-useful-ai-agents-tool-access-policies-that-improve-reliability/) should be narrowed before you rely on a filter to catch what comes back.

## Control Plane: inventory first, policy as code

[Foundry Control Plane](https://learn.microsoft.com/azure/foundry/control-plane/overview) gives you one place to see agents, models and compliance across projects, and integrates with Microsoft Defender, Microsoft Purview and Microsoft Entra. Admins can define guardrail policies across the fleet and bulk-remediate deployments that don't comply. Those guardrail policies are Azure Policy assignments underneath, which is why creating or editing one needs Owner or Resource Policy Contributor at subscription or resource group scope. The Operate Overview, Assets and Compliance experiences are all preview on this date, Compliance's remediation flow included, and they exist only in the new portal.

I'd use it now for the question nobody can answer in a demo-heavy organisation: *what agents do we actually have?* The Assets inventory is worth turning on, as long as it isn't your system of record. For enforcement, I'd manage the policy assignments as code through Azure Policy, in the same pipeline as the rest of your landing zone, and use Control Plane for visibility.

This is also where your project layout pays off or hurts. If projects map to teams and environments, the Control Plane view maps to owners. If every demo got its own project, the inventory is a list of orphans. I covered [drawing project boundaries around teams](/blog/2026-03-08-foundry-decisions-i-stand-behind-how-project-boundaries-change-delivery-speed/) earlier this month.

## Identity: agent identities are already there

Foundry [automatically provisions agent identities](https://learn.microsoft.com/azure/foundry/agents/concepts/agent-identity) in Microsoft Entra; you don't opt in. Creating the first agent in a project provisions a default agent identity blueprint and a shared project agent identity, and publishing an agent creates a dedicated identity for it. A2A tools (preview) can authenticate as that identity, and so can MCP tools, through agent identity authentication (preview) on an AgenticIdentityToken connection. It's the right long-term model: a published agent shows up as its own principal in Entra sign-in and audit logs and in RBAC assignments.

Entra Agent ID is preview on this date, so the work is review rather than adoption. Check which RBAC roles you grant the shared project identity, because every unpublished agent in the project acts through it. Plan to reassign RBAC when an agent is published, since the dedicated identity doesn't inherit the shared identity's roles. And for MCP, prefer key-based or OAuth connection auth that your access reviews already cover; project managed identity authentication for MCP is also preview.

## When this is too much

Not every Foundry workload needs this stack. A single internal prompt agent used by a handful of people, with no tools that write anywhere, can run on its inherited deployment guardrail, tracing and a monthly look at the evaluation dashboard. The full setup earns its cost when an agent's output is consumed by another system, when it calls tools with side effects, or when more than one team ships to the same project. Agents built elsewhere and registered in Control Plane get no Foundry guardrails, so they need their own filtering, such as Azure AI Content Safety in front of the tool layer.

## What I'd do this week

- Read the GA overview's readiness table and mark every feature you depend on as GA or preview, including the Monitor surface.
- Put the evaluation gate in CI before promotion; let continuous evaluation, with a deliberate `max_hourly_runs`, watch what CI can't.
- If you assign an agent guardrail, restate every deployment control in it (deciding which annotate-only ones become blocking) before adding tool call and tool response controls.
- Manage guardrail policy assignments as Azure Policy code; use Control Plane for the inventory.
- Audit the roles on each project's shared agent identity, and add RBAC reassignment to your publish checklist.

The March GA makes Foundry a credible place to run agents. It doesn't make governance automatic. The teams that get value from it will be the ones who know exactly which of their controls carry an SLA, and which ones quietly replace each other.
