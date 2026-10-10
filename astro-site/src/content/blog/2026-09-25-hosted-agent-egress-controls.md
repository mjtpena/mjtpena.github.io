---
title: "Egress Policy Belongs on the Agent, Not in Its Code"
description: "Foundry's preview egress controls attach ordered destination rules to a hosted agent. Why that limits prompt-injection damage, and how to roll it out safely."
author: Michael John Peña
draft: false
date: 2026-09-25
tags:
  - Microsoft Foundry
  - AI Agents
  - Security
  - Governance
  - Architecture
---

Every prompt-injection defence I've seen in agent code has the same weakness: it runs inside the process the attacker is trying to steer. If a poisoned web page or document convinces the model to post your customer data to a URL it controls, the only question that matters is whether that request can leave the sandbox. Network egress controls for hosted agents in Foundry Agent Service have been documented as a preview since mid-2026, and on 24 September 2026 Microsoft published an [end-to-end walkthrough](https://devblogs.microsoft.com/foundry/egress-controls-hosted-agent/). The feature answers that question in the right place: on the agent's definition, enforced by the platform, outside the code the model can influence.

It is a preview with no SLA, and Microsoft says plainly that it isn't intended for production use yet. I still think it's the most important agent security control in Foundry's 2026 previews, and the right time to learn its shape is before it goes GA.

## How the preview works

Egress rules live in the `egressPolicy` property of a Responsible AI policy (`Microsoft.CognitiveServices/accounts/raiPolicies`, API version `2026-05-15-preview`), the same resource that already carries a hosted agent's content filters. In the portal it appears as a **Network** section on a guardrail. You attach the policy to a hosted agent version, as described in [Add guardrails to a hosted agent](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/add-hosted-agent-guardrails), and the platform evaluates every outbound HTTP request the agent makes against it.

The model is simple:

- **Ordered rules, first match wins.** Rules are evaluated top to bottom. If none match, the policy's default action applies. A default of `Deny` with allow rules gives you an allowlist; a default of `Allow` with deny rules gives you a blocklist.
- **Four actions.** `Allow` and `Deny` do what they say. `Transform` allows the request but changes its headers. `Rewrite` sends the request to a different destination.
- **Host and path matching.** Rules match on host, and a leading `*.` matches subdomains. Through the API a rule can also match a path; the portal exposes host matching only. Service tag and IP range rule types are planned, not in the preview.
- **Up to 480 rules per policy.**
- **Two modes.** `Audit` lets traffic through and logs what would have been denied. `Enforced` blocks it, and the caller gets an HTTP 403 from the platform's proxy.
- **Platform dependencies stay open.** Microsoft allows the foundational domains the runtime needs, so a `Deny` default doesn't break the agent itself.
- **Fail-closed.** If the policy can't be evaluated, the request is denied.

A minimal allowlist looks like this. It's the policy's `properties` object, not a complete resource: `mode` and `basePolicyName` are the content filter settings every custom RAI policy carries, and `egressPolicy` sits beside them.

```json
{
  "mode": "Blocking",
  "basePolicyName": "Microsoft.DefaultV2",
  "egressPolicy": {
    "mode": "Audit",
    "defaultAction": "Deny",
    "rules": [
      {
        "name": "allow-contoso-apis",
        "ruleType": "Fqdn",
        "match": { "host": "*.contoso.com" },
        "action": { "actionType": "Allow" }
      }
    ]
  }
}
```

Two scope limits matter. It applies to hosted agents only, not prompt agents or model deployments. And it isn't private networking: it decides *where* traffic may go, not *how* it gets there. The official [egress control sample](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/python/hosted-agents/agent-framework/responses/18-egress-control) is worth running before you write your own rules, because it exercises the Audit, Transform, Rewrite and rule-ordering scenarios this post discusses.

## Why egress is the control that bounds blast radius

Prompt injection isn't a bug you patch once. Any agent that reads content it didn't write (web pages, emails, tickets, PDFs, tool results) can be handed instructions by whoever wrote that content. Input filters, system prompt hardening and output classifiers all lower the odds, and I'd keep every one of them. None of them changes what a successfully injected agent *can do*.

Damage comes from two things: what the agent can reach with its identity, and where it can send what it finds. The [tool access policies post](/blog/2026-04-13-where-agent-systems-break-tool-access-policies-that-improve-reliability/) covers the first half. Egress covers the second. An agent that can read your CRM but can only talk to your CRM, your model endpoint and one internal API has nowhere to exfiltrate to. The injection still happens; the data just doesn't leave.

That's also why I care about *where* the rule lives. If the allowlist is a Python list checked before `httpx.get`, then any code path that doesn't call your wrapper (a library making its own requests, a code interpreter tool, a dependency with telemetry) goes around it. A model that can write and run code can certainly go around it. A policy enforced by the platform's egress proxy, attached to the agent version and stored as an Azure resource, has three properties in-code checks can't match:

1. **The agent can't change it.** Nothing the model generates edits an ARM resource it has no rights to.
2. **It's reviewable on its own.** A security reviewer reads a list of hosts, not a diff of tool code.
3. **It's referenced per agent version.** The agent version stores the policy's name. The policy itself is a shared, mutable resource, so editing it in place changes it for every version that points at it. If you want real versioning, create a new policy name per change (for example `invoice-agent-egress-v3`) and point the new agent version at it.

The trade-off is granularity. In-code checks can reason about request bodies and user context; host and path rules can't. I'd still keep application-level checks for business rules (this user may only query their own region's records) and leave "which hosts exist at all" to the platform.

## How it layers with VNets and firewalls

Egress controls don't replace the [networking choices](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/networking-options) you already make for hosted agents. They sit on a different layer.

| Layer | Where it's enforced | What it decides | Who owns it |
|---|---|---|---|
| Agent egress policy | Inside the Foundry-managed sandbox, per agent version | Which hosts this agent may call | Agent team, reviewed by security |
| Managed VNet outbound rules | Microsoft-managed network for the Foundry resource | Which destinations the resource's network allows | Platform team |
| BYO VNet with your firewall | Your delegated subnet, routing and firewall | What leaves your network at all, logged centrally | Network team |
| Private endpoints | Inbound to Foundry and your data stores | Who can reach the service privately | Platform team |

The useful way to think about it: the network layer sets the ceiling for everything in the Foundry resource, and the agent policy narrows it for one agent. With [bring your own VNet](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/virtual-networks), your firewall might allow a dozen SaaS APIs because several agents need them. The egress policy lets the invoice agent reach only the two it needs, without the network team keeping per-agent firewall rules for workloads they don't own.

The [hosted agents GA post](/blog/2026-08-12-foundry-hosted-agents-ga-when-to-stop-self-hosting/) covers the managed VNet versus BYO VNet decision in detail. Neither model gives you per-agent destination control on its own, and that gap is what this feature fills. Microsoft positions the feature as a complement to Azure Firewall, not a replacement, and during the preview Azure Policy doesn't enforce it centrally. So nothing stops a team from deploying an agent with no egress policy at all. Your network controls are the only backstop that applies whether or not anyone remembered.

## Observe first, then enforce

The recommended rollout is the one I'd follow anyway: deploy in `Audit`, look at what the agent actually calls, refine the rules, then switch to `Enforced`.

Each decision is written to the project's Application Insights, so connect it before you start or you'll have nothing to review. The walkthrough queries the `traces` table:

```kusto
traces
| where timestamp > ago(1h)
| where message == "Network egress decision"
```

I wouldn't hard-code the column names inside `customDimensions` from documentation alone. Look at real rows from your own agent first.

A few things to get right during the audit window:

- **Exercise every tool.** An audit period where nobody triggers the rarely used tool produces an allowlist that breaks it on day one of enforcement. Run your evaluation set, not just the happy path.
- **Expect surprises from SDKs.** Client libraries call token endpoints, telemetry endpoints and CDNs you didn't think about. Those calls are the point of the audit.
- **Watch `Transform` and `Rewrite`.** `Audit` only softens `Deny`. Header transforms and rewrites apply in both modes, so test them with harmless values.
- **Plan for the 403.** Under enforcement a blocked tool call fails. Make sure the agent reports that clearly rather than retrying or improvising, which is a [fallback design](/blog/2026-05-05-agent-design-notes-designing-fallback-behavior-before-launch/) question.
- **Check TLS clients use the runtime CA bundle.** To inspect HTTPS, the proxy injects its own certificate authority into the sandbox trust bundle, and that CA differs by cluster and region and rotates about every 30 days. Clients that pin certificates or ship their own bundle will fail. Point them at `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `NODE_EXTRA_CA_CERTS` or `GRPC_DEFAULT_SSL_ROOTS_FILE_PATH`. Never pin or copy the proxy CA.
- **Don't trust a 403 alone.** A destination can return 403 too. When you test enforcement, confirm the decision record, not just the status code.

Keep the audit and enforced versions of the policy identical except for the mode, so the switch changes one thing. Switching mode means a new agent version, and running sandboxes keep the old policy until a new session starts.

## Why preview means keeping the network controls

The preview label isn't a formality here. No SLA means no commitment about how the proxy behaves under load or failure. Because evaluation is fail-closed, proxy trouble shows up as blocked calls rather than open ones, which is the right failure for security and a real availability risk for production. There are no IP-range or service-tag rule types yet, so a dependency reached only by IP can't be allowlisted; under a `Deny` default it's simply blocked. Secret references aren't supported as header values yet. Managed identity token injection is supported, but it widens what the agent's identity can reach, so treat it as part of the tool access review. And anything the agent hands off, such as a call to another agent running elsewhere, is outside this agent's sandbox and its policy.

The documentation also describes decisions on HTTP(S) requests. It says nothing about DNS lookups or non-HTTP protocols, so I wouldn't assume the policy closes DNS exfiltration. That's another job for the VNet and firewall layer.

So my position for now is layered, not either-or:

- Keep your managed VNet outbound rules or your BYO VNet firewall exactly as strict as they are. They're the established, centrally owned control, and BYO VNet with your own firewall is the GA backstop.
- Add egress policies to non-production hosted agents now, in `Audit`, to build the per-agent allowlists while the cost of a mistake is low.
- Move to `Enforced` in dev and test environments once the audit data is stable.
- Revisit production when the feature reaches GA with an SLA and the rule types you need.

## Where the data could go

The question to ask of any agent that reads untrusted content is "where could the data go if the model were fully compromised?" Before this feature, the honest answer for most Foundry hosted agents was "anywhere the VNet allows", and that's sized for every agent in the resource. A destination policy attached to the agent version, enforced outside its code, narrows that to the hosts this one agent needs, and that's the right shape for the control. Start building those allowlists in `Audit` now. Just don't take down the firewall underneath until the preview label comes off.
