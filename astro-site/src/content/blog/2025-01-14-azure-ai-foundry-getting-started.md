---
title: "Azure AI Foundry from Python: A Data Team's First Project"
description: "A practical first project in Azure AI Foundry for data teams: hubs and projects, the preview azure-ai-projects SDK, and an evaluation loop from day one."
author: Michael John Peña
draft: false
date: 2025-01-14
tags:
  - Azure
  - Azure AI Foundry
  - Python
  - Evaluation
  - Data Engineering
---

A common brief for data teams right now is "we have Azure AI Foundry, build something useful with it". Foundry is two months old as a name, half the documentation still says Azure AI Studio, and the Python SDK is in beta. That combination makes it easy to burn a sprint on setup and still not know whether the thing you built is any good.

This is the first project I'd set up as a data professional: a hub and project you can reason about, code that connects through the project rather than hard-coded endpoints, and an evaluation run before anyone writes a second prompt. If you want the platform tour first, I covered what was announced at Ignite in [Azure AI Foundry: Microsoft's Unified Platform for Enterprise AI](/blog/2024-11-22-azure-ai-foundry-ignite-2024/). This post is about the first week of actual work.

## What you are actually provisioning

Azure AI Foundry was announced at Microsoft Ignite on 19 November 2024 as the new name for Azure AI Studio. The portal stays at ai.azure.com and the resource model underneath didn't change. That model is worth understanding before you click "Create".

A **hub** is the shared, governed layer. It owns networking, the managed identity, the storage account and key vault, and the connections to services such as Azure OpenAI or Azure AI services. A **project** sits under a hub and is where people work: deployments are used from it, evaluation runs land in it, and access is granted on it. Microsoft documents the split in its [hubs overview](https://learn.microsoft.com/azure/ai-foundry/concepts/ai-resources).

For a data team this maps neatly onto something you already do. The hub is your platform boundary, like a shared Synapse or Databricks workspace where the platform team sets network and identity rules. Projects are your use cases. My rule of thumb:

| Decision | My default | When I'd change it |
|---|---|---|
| Hubs per environment | One hub for dev/test, one for production | Separate hubs per business unit if they need different network or data residency rules |
| Projects per hub | One per use case, not one per person | A shared "sandbox" project for prompt experiments that never ship |
| Connections | Defined on the hub, shared by projects | Project-scoped connections when a data source must not leak to other teams |
| Authentication | Microsoft Entra ID through `DefaultAzureCredential` | Keys only for a quick local spike, then removed |

The mistake I see most often is a project per developer. You end up with ten copies of the same connections, no shared evaluation history and nobody able to say which prompt is in production.

## The SDK as it stands in January 2025

Ignite also announced the "Azure AI Foundry SDK". In practice, for Python today, that means a handful of packages with very different maturity:

| Package | Version today | Status | What it's for |
|---|---|---|---|
| `azure-ai-projects` | 1.0.0b4 | Preview | Connect to a project, read its connections, hand you authenticated clients, agents |
| `azure-ai-inference` | 1.0.0b6 | Preview | Model-agnostic chat and embeddings client |
| `azure-ai-evaluation` | 1.1.0 | GA | Quality and safety evaluators, `evaluate()` |
| `openai` | 1.x | GA | The client most Azure OpenAI code already uses |

You can confirm the release history on PyPI for [azure-ai-projects](https://pypi.org/project/azure-ai-projects/#history) and [azure-ai-evaluation](https://pypi.org/project/azure-ai-evaluation/#history). The projects package went from 1.0.0b1 in mid-November to 1.0.0b4 just before Christmas, so expect breaking changes. Pin exact versions and read the changelog before every upgrade.

`azure-ai-projects` has no call that creates a hub or project, and no `deployments.create()` for models. Provisioning lives in the portal, Bicep, the Azure CLI or the `azure-ai-ml` management SDK. I think that's the right split: infrastructure belongs in infrastructure-as-code, and the application SDK should only consume it.

```bash
python -m venv .venv
source .venv/bin/activate
pip install "azure-ai-projects==1.0.0b4" "azure-ai-evaluation==1.1.0" "azure-identity" "openai"
az login
```

## Connect through the project, not the endpoint

Every project shows a **project connection string** on its overview page. The SDK uses it to find the project, and from there it discovers the connections the hub has defined. That means your code no longer carries an Azure OpenAI endpoint, key or resource name. Change the connection on the hub and the code follows.

```python
import os

from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

project = AIProjectClient.from_connection_string(
    credential=DefaultAzureCredential(),
    conn_str=os.environ["PROJECT_CONNECTION_STRING"],
)

for connection in project.connections.list():
    print(connection.name, connection.connection_type, connection.authentication_type)
```

Run this first. If it fails, the problem is identity or RBAC, not your prompt. Your account needs access to the project and, for Entra ID calls to models, a data-plane role such as Cognitive Services OpenAI User on the underlying resource. Sorting that out now saves a confusing afternoon later.

### Pick the right client

`azure-ai-projects` gives you two ways to call a model, and they talk to different connections:

- `project.inference.get_azure_openai_client(api_version=...)` returns an `openai.AzureOpenAI` client bound to the project's default **Azure OpenAI** connection. Use it for GPT-4o and embeddings deployed in Azure OpenAI.
- `project.inference.get_chat_completions_client()` returns an `azure-ai-inference` `ChatCompletionsClient` bound to the default **Azure AI services** connection and its `/models` route, the preview Azure AI model inference endpoint. Use it when you want one client across Mistral, Llama, Phi and OpenAI models deployed to that resource.

I'd start with the Azure OpenAI client. Most teams already have OpenAI-shaped code, it's the GA path, and you can move to the model-agnostic client when you genuinely need to compare models from different providers. Switching means installing `azure-ai-inference` (1.0.0b6 at the time of writing) and having an Azure AI services connection on the hub; without them the client raises `ModuleNotFoundError` or `ResourceNotFoundError`. The [azure-ai-projects README](https://learn.microsoft.com/python/api/overview/azure/ai-projects-readme) shows both.

## Evaluate before you iterate

Here is where data people have an advantage. You already think in test datasets, expected results and regression checks. Apply the same habits to prompts: write ten real questions your users will ask before you tune anything, then score every change against them.

The script below is complete. It builds a small dataset, answers each question with a deployed model through the project, and scores relevance with an AI-assisted evaluator from `azure-ai-evaluation`. Replace the placeholders with your deployment name and the Azure OpenAI API version you've standardised on.

```python
import json
import os

from azure.ai.evaluation import RelevanceEvaluator, evaluate
from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import ConnectionType
from azure.identity import DefaultAzureCredential

DEPLOYMENT = "<your-chat-deployment>"
API_VERSION = "2024-10-21"

project = AIProjectClient.from_connection_string(
    credential=DefaultAzureCredential(),
    conn_str=os.environ["PROJECT_CONNECTION_STRING"],
)
client = project.inference.get_azure_openai_client(api_version=API_VERSION)

questions = [
    "What is the difference between a data lake and a data warehouse?",
    "When should I use a star schema instead of a flat table?",
    "How do I handle late-arriving dimension records?",
]
with open("eval_questions.jsonl", "w", encoding="utf-8") as f:
    for q in questions:
        f.write(json.dumps({"query": q}) + "\n")


def answer(query: str) -> dict:
    completion = client.chat.completions.create(
        model=DEPLOYMENT,
        messages=[
            {"role": "system", "content": "You are a concise data engineering assistant."},
            {"role": "user", "content": query},
        ],
        temperature=0.2,
    )
    return {"response": completion.choices[0].message.content}


aoai = project.connections.get_default(connection_type=ConnectionType.AZURE_OPEN_AI)
model_config = {
    "azure_endpoint": aoai.endpoint_url,
    "azure_deployment": DEPLOYMENT,
    "api_version": API_VERSION,
}

result = evaluate(
    data="eval_questions.jsonl",
    target=answer,
    evaluators={"relevance": RelevanceEvaluator(model_config)},
    evaluator_config={
        "relevance": {
            "column_mapping": {
                "query": "${data.query}",
                "response": "${target.response}",
            }
        }
    },
    output_path="eval_results.json",
)

print(json.dumps(result["metrics"], indent=2))
```

A few things worth calling out. The model config has no `api_key`; the evaluation SDK falls back to `DefaultAzureCredential`, so the same identity rules apply. The judge model here is the same deployment that answers the questions, which is fine for a first baseline but biased; in a real project I'd use a separate, stronger deployment as the judge. And three questions is a smoke test, not an evaluation. Grow it to 30 to 50 real questions with a `ground_truth` column, and add `GroundednessEvaluator` as soon as retrieval is involved. The [local evaluation guide](https://learn.microsoft.com/azure/ai-foundry/how-to/develop/evaluate-sdk) lists the built-in quality and safety evaluators.

You can also pass an `azure_ai_project` (subscription, resource group and project name) to `evaluate()` so runs show up in the project's evaluation tab. Do that once the dataset is stable; a shared history of scores per prompt version is the closest thing to a test report your stakeholders will read.

## What I'd leave alone for now

- **Agents.** The Azure AI Agent Service announced at Ignite is reachable through `project.agents`, but it is preview and the API surface is moving. Build the single-call version of your use case first. If it can't pass an evaluation, an agent loop won't save it.
- **Prompt management tooling.** Keep prompts in your repository next to the code and the evaluation dataset. Version control already solves this problem.
- **Fine-tuning.** Not before you have an evaluation set that proves prompting and retrieval have run out of road.

## Is Foundry the right starting point?

Not always. If your team has one Azure OpenAI deployment, one app and no need to compare models, the `openai` package pointed directly at Azure OpenAI is simpler and fully GA. Adding a preview SDK for the sake of it is a cost.

Foundry earns its place when you have more than one use case, more than one model, or a governance team that wants connections, network rules and evaluation history in one place. For most data platform teams heading into 2025 that is exactly the situation, which is why I'd set up the hub and project properly now, pin the beta SDK, and make the evaluation script the first thing in the repository rather than the last.
