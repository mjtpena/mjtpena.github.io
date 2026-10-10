---
title: "Azure AI Foundry Is Now Microsoft Foundry: Hubs, Projects, Choices"
description: "What the Microsoft Foundry rename means in early 2026: Foundry projects vs hubs, the preview portal, prompt flow's place, and how I'd decide."
author: Michael John Peña
draft: false
date: 2026-02-23
tags:
  - Microsoft Foundry
  - Azure
  - Architecture
  - Agents
  - Governance
---

Three months after Ignite 2025, I still see architecture diagrams with an "Azure AI Foundry hub" in the middle and prompt flow hanging off it. That picture is two moves out of date: the product is called Microsoft Foundry, the default project type no longer needs a hub, and the portal most of the Ignite demos used is still in preview. If you are designing a platform this quarter, which project model you pick decides your networking, your RBAC boundaries and which features you can use, so get it right before anyone deploys a model.

I covered the original launch in [Azure AI Foundry: Microsoft's Unified Platform for Enterprise AI](/blog/2024-11-22-azure-ai-foundry-ignite-2024/). This post is the practical follow-up: what exists as of late February 2026, and how I'd choose.

## Three names in two years

The naming history explains a lot of the confusion in older docs and internal wikis:

| Period | Name | Default container |
|---|---|---|
| Up to November 2024 | Azure AI Studio | Hub + project (Azure Machine Learning based) |
| November 2024 to November 2025 | Azure AI Foundry | Hub + project; Foundry projects added in 2025 |
| From Ignite 2025 (18 November 2025) | Microsoft Foundry | Foundry project on a Foundry resource |

The portal address stayed at `ai.azure.com` through all of it. What changed underneath is more important than the name: the recommended building block moved from an Azure Machine Learning style hub to a project that lives directly under a Foundry resource (the resource that started life as Azure AI services). Microsoft's [What is Microsoft Foundry](https://learn.microsoft.com/en-us/azure/foundry/what-is-foundry) page now says that in most cases you want a Foundry project.

## Foundry projects vs hub-based projects

This is the decision that matters, and it is not cosmetic.

A **Foundry project** sits under a Foundry resource. Models, agents, evaluations and connections are managed through that resource, and the project endpoint looks like `https://<resource>.services.ai.azure.com/api/projects/<project>`. Fewer moving parts: no linked storage account and Key Vault to provision before anyone can start, and the agent service and models are first-class.

A **hub-based project** is the older model, now documented under Foundry (classic). The hub is an Azure Machine Learning workspace in disguise, with its own storage, Key Vault, managed network and compute. Projects inherit shared connections and settings from the hub.

| Question | Foundry project | Hub-based project |
|---|---|---|
| Building agents or calling models | Recommended | Agents preview only; GA Agent Service needs a Foundry project |
| Prompt flow | Not available | Available |
| Azure Machine Learning compute, jobs, pipelines | No | Yes |
| New Foundry portal (preview) | Yes | No, classic portal only |
| Infrastructure to manage | Foundry resource and projects | Hub, storage, Key Vault, compute, projects |

My position: start new workloads on Foundry projects. The hub model made sense when the portal was a skin over Azure Machine Learning, but it puts a lot of infrastructure in front of teams who only want a model deployment and an agent. The [migration guide](https://learn.microsoft.com/en-us/azure/foundry-classic/how-to/migrate-project) is explicit that Foundry projects don't yet have full parity with hubs, and the honest reading of that is: if you depend on the missing pieces, stay on a hub for now and plan the move.

### When I'd still pick a hub

- You have production prompt flows. They don't migrate to a Foundry project because there is nothing on the other side to receive them. Rebuilding them as code is the real cost, so budget for it rather than discovering it mid-migration.
- Your data science team already runs training jobs and pipelines in Azure Machine Learning and wants the generative work in the same workspace.
- You deploy open-weight models (for example from Hugging Face) to managed compute. That deployment type still needs a hub.
- You've invested in the hub's managed virtual network design and haven't validated the Foundry resource's private networking against your landing zone.

If none of those apply, a hub is overhead you don't need.

Networking is where the two models differ most. A hub can run inside a Microsoft-managed virtual network: you pick an isolation mode and outbound rules, and Azure provisions private endpoints for the hub's dependencies. A Foundry resource has no managed network. You lock it down with private endpoints like any Azure AI services resource, and to keep agent traffic private you use the Agent Service Standard setup, which injects agents into a subnet of your own virtual network and stores their state in storage, Cosmos DB and Search resources you own. That is more landing-zone work up front (subnets, DNS zones, a private endpoint per dependency), but it's work your platform team already knows how to build and audit.

## The portal: new vs classic

The Microsoft Foundry portal now has a toggle between the new experience and the classic one. The new portal shows Foundry projects only; anything on a hub opens in classic. As of today the new portal and the new agent experience behind it are **in preview**, while the classic Foundry Agent Service has been GA since Build 2025; the [Foundry Agent Service overview](https://learn.microsoft.com/en-us/azure/foundry/agents/overview) sets out which agent surface is which.

Because the Ignite keynote showed the new portal, it's easy to assume it is the production path. It isn't yet. Preview means no SLA and APIs that can still change. For a workload going live this quarter, I'd keep production agents on the GA surface and use the preview for prototypes, with someone tracking the GA announcement.

Know what that choice costs later. Classic agents use the Assistants-style threads and runs model; the new Foundry agents are built on the Responses API, with conversations and responses in place of threads and runs. There is no in-place upgrade: moving means re-creating agents against the Responses-based API, with Microsoft's migration guidance to help.

The Python SDK mirrors the split: `azure-ai-projects` 1.0.0 is the stable release for the GA surface, and the 2.x SDK for the new experience is still in beta (2.0.0b3 at the time of writing). Keep agent logic in your own code, behind a thin interface, so the hosting can be swapped, and budget the migration for when the new service reaches GA.

## What sits inside a project

It's easy to treat the project as the boundary for everything, and it isn't. Model deployments and content-filter policies live on the Foundry resource and are shared by every project under it; connections can sit on either level; evaluation results, files and agents are isolated per project. Granting access on a project doesn't fence off the resource's deployments, so if two teams need separate deployments or filters, give them separate Foundry resources.

**One inventory of model deployments.** Azure OpenAI models (now branded Azure OpenAI in Foundry Models) and other models from the catalogue deploy against the same resource. The question "which model versions are deployed on each Foundry resource" has an answer you can query. Deployments belong to the resource, so projects mostly see the same list. Deployments reached through a project-scoped connection to another AI Services or Azure OpenAI resource show up only in that project (check `connection_name`), so run this per project if you use project-level connections:

```python
# pip install azure-ai-projects==1.0.0 azure-identity
# The caller needs the Azure AI User role on the project.
from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import ModelDeployment
from azure.identity import DefaultAzureCredential

endpoint = "https://<your-resource-name>.services.ai.azure.com/api/projects/<your-project-name>"

project = AIProjectClient(endpoint=endpoint, credential=DefaultAzureCredential())

print("Model deployments:")
for deployment in project.deployments.list():
    if isinstance(deployment, ModelDeployment):
        source = deployment.connection_name or "this resource"
        print(f"  {deployment.name}: {deployment.model_publisher} "
              f"{deployment.model_name} {deployment.model_version} (via {source})")

print("Connections:")
for connection in project.connections.list():
    print(f"  {connection.name} ({getattr(connection.type, 'value', connection.type)})")
```

Run this in a scheduled pipeline and diff the output. Model version drift is cheap to catch and expensive to miss.

**Connections.** Azure AI Search, storage and external APIs are registered on the project, or once on the Foundry resource and shared by all its projects, with Entra ID authentication where the target supports it. Prefer keyless connections; a connection holding an API key is still a secret, just one stored somewhere tidier.

**Evaluation.** [The `azure-ai-evaluation` SDK](https://learn.microsoft.com/en-us/azure/foundry-classic/how-to/develop/evaluate-sdk) runs AI-assisted evaluators such as relevance and groundedness against a dataset, and can log the run to the project so results sit next to the deployment they describe. Project-level evaluation on Foundry projects is still in preview, although the `azure-ai-evaluation` package itself ships 1.x releases.

**Safety controls.** Azure OpenAI and other Foundry-hosted deployments get default content filters that you can tune per deployment. Don't assume that covers everything: an open-weight model you host on managed compute or your own infrastructure doesn't inherit those filters, and filtering is not a substitute for red-teaming your actual prompts. Because filter policies attach to deployments on the shared resource, a team that needs a stricter policy needs its own deployment, and often its own resource.

## Gate model changes on evaluation

The habit I push hardest is simple: no model version change or prompt change reaches production without an evaluation run against a fixed dataset of real queries. Here is a minimal version that scores pre-computed responses, which keeps the evaluation independent of the application code:

```python
# pip install azure-ai-evaluation==1.15.1 azure-identity
# The caller needs Azure AI User on the project and Cognitive Services OpenAI User
# on the resource that hosts the judge model.
# eval_dataset.jsonl has one object per line with "query", "context" and "response" fields.
from azure.ai.evaluation import GroundednessEvaluator, RelevanceEvaluator, evaluate
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()

model_config = {
    "azure_endpoint": "https://<your-resource-name>.openai.azure.com",
    "azure_deployment": "<your-judge-deployment>",
    "api_version": "2024-10-21",
}

result = evaluate(
    data="eval_dataset.jsonl",
    evaluators={
        "relevance": RelevanceEvaluator(model_config, credential=credential),
        "groundedness": GroundednessEvaluator(model_config, credential=credential),
    },
    azure_ai_project="https://<your-resource-name>.services.ai.azure.com/api/projects/<your-project-name>",
    output_path="./eval_results.json",
)

for metric, value in result["metrics"].items():
    print(f"{metric}: {value}")
```

Wire the metrics into your release pipeline with a threshold, and fail the build when groundedness drops. The judge model is itself a dependency, so pin its deployment and version too; changing the judge silently changes your baseline. I go deeper on dataset design in [AI testing strategies](/blog/2026-01-21-ai-testing-strategies/).

## Agents: platform vs framework

Two things share the word "agent", and they are easy to conflate. [Microsoft Agent Framework](https://github.com/microsoft/agent-framework) is the open-source SDK, the successor to Semantic Kernel and AutoGen, and it reached its first release candidate a few days ago (1.0.0rc1 on PyPI, 20 February 2026). Foundry Agent Service is the hosted runtime that runs and governs agents. You can use the framework without Foundry and Foundry agents without the framework.

My guidance for this quarter: write agent logic in Agent Framework if you're starting fresh, because that's where Microsoft's agent investment is going. Semantic Kernel is still supported, so there's no need to rewrite a working system. Be clear about the status, though: right now Agent Framework is a release candidate with no GA support commitment. Production systems that need a GA SDK should stay on Semantic Kernel or the `azure-ai-agents` SDK until 1.0 ships; the RC is fine for new builds that won't go live before then. Run your agents on the GA Agent Service when you need managed threads, tools and tracing, and only put the new Foundry agents and hosted agents (preview) on non-critical workloads.

## What Foundry doesn't do for you

- **Application observability.** Foundry tracing writes model and agent spans to an Application Insights resource you connect to the project. You still need to instrument the rest of the request path (API, retrieval, downstream calls), for example with the Azure Monitor OpenTelemetry distro, which I covered in [LLM observability](/blog/2026-01-16-llm-observability/).
- **Cost allocation.** One Foundry resource shared by many teams makes chargeback harder, not easier. Shared resource-level connections blur it further, because several projects draw on the same Search index and storage. Decide your resource-per-team or resource-per-environment boundary up front, and scope connections to projects where a team's usage needs to be billed separately.
- **Data governance.** Connections make access convenient. They don't decide whether a team should have access to that index in the first place.

## How I'd decide this quarter

- **New workload, agents or model calls only:** Foundry project, GA agent surface, evaluation gate from day one.
- **Existing hub with prompt flows in production:** stay on the hub, inventory the flows, and plan their rewrite as code before migrating.
- **Solo prototype:** a Foundry project, but skip the governance ceremony until something real depends on it.

The rename is the least interesting part of the change; the shift from hub to Foundry project is what shapes your platform for years. Pick the project type before the first model deployment, because moving a team off a hub later costs more than the rename ever will.
