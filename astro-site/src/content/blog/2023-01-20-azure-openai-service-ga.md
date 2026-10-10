---
title: "Azure OpenAI Is GA: What Changed on 16 January and What Didn't"
description: "Azure OpenAI Service reached GA on 16 January 2023: what that changes for production plans, what still needs an approved application, and how to proceed."
author: Michael John Peña
draft: false
date: 2023-01-20
tags:
  - Azure OpenAI
  - Azure
  - OpenAI
  - Architecture
  - Python
---

On 16 January, Microsoft [announced general availability of Azure OpenAI Service](https://azure.microsoft.com/en-us/blog/general-availability-of-azure-openai-service-expands-access-to-large-advanced-ai-models-with-added-enterprise-benefits/). The news tends to get read two ways: either "anyone can use it now" or "nothing has changed, it's still gated". Both are wrong, and the gap between them matters if you're the person deciding whether a pilot can become a production service this quarter.

A few weeks ago I wrote about [what to sort out before GA](/blog/2023-01-01-azure-openai-service-ga-announcement/). This post is the follow-up: what the announcement actually changed, what it didn't, and how I'd adjust a plan in light of it.

## What GA actually changed

General availability is a commercial and support statement, not a feature release. GA didn't add new model families or API operations. What changes is the footing you're standing on.

- **It's a production service.** Preview terms are the usual reason architecture boards won't sign off on a customer-facing workload. GA removes that objection. GA brings the service under Microsoft's SLA for Online Services and the standard Product Terms rather than preview terms; check the current SLA document for the specific Azure OpenAI commitment before you quote a number. Name those two instruments when your risk and procurement teams ask what changed; that answers the question most of them are asking.
- **The REST API has a GA version.** `2022-12-01` is the GA data-plane API version, and the `openai` Python library defaults to it when `OPENAI_API_TYPE` is set to `azure` before import. Setting `openai.api_type = "azure"` in code, as the sample below does, leaves the version unset, so pin it explicitly in code anyway; I covered the setup in [the openai 0.26 Python post](/blog/2023-01-18-azure-openai-python-sdk/).
- **Access is broader.** The announcement frames GA as opening the service to more businesses. In practice that means the queue moves, not that the gate is gone. Because approval is per use case (see below), write the registration narrowly: a named scenario, who the users are, and where a human reviews the output before it reaches anyone.

## What GA didn't change

**You still apply.** Azure OpenAI remains a [Limited Access](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/limited-access) service. You submit a registration describing your use case, Microsoft reviews it, and only approved subscriptions can create resources. The approval is tied to the use cases you described, so a second, different use case can mean another application. Build that lead time into project plans, and don't promise a stakeholder a start date before you have the approval email.

**ChatGPT isn't there yet.** The GA announcement says customers "will also be able to access ChatGPT" through Azure OpenAI Service "soon", and describes it as a fine-tuned version of GPT-3.5. Until it lands there is no chat endpoint. Everything you build today goes through completions (and embeddings), using a prompt you construct yourself. If you're designing for chat, read [Completions Now, Chat Later](/blog/2023-01-17-completion-vs-chat-apis/) before you write the prompt layer.

**No new model families.** GPT-3.5 (`text-davinci-003` and `text-davinci-002`), the smaller GPT-3 models (Curie, Babbage, Ada), the embeddings models and Codex (`code-davinci-002`, `code-cushman-001`) are what most teams will actually work with. DALL-E 2 is named in the announcement, but it still sits behind its own invitation, and the `2022-12-01` API has no image-generation operation. Don't plan an image feature on the assumption that GA means you can call it.

**Regions are few.** Resources are available in East US, South Central US and West Europe. Model availability varies by region: in January 2023 `text-davinci-003` is only deployable in East US, with other regions on `text-davinci-002`. Check the models page for your region before you pick a deployment target. For those of us in Australia, that means prompts and completions are processed outside the country. That's a data residency conversation you need to have with your privacy and legal teams *before* you build, not after.

**Throttling is still per deployment.** The [quotas and limits page](https://learn.microsoft.com/en-us/azure/ai-services/openai/quotas-limits) expresses limits as requests per second per deployment, and they're tight enough that a batch job will hit 429s. I covered pacing in [Throttling in the Azure OpenAI Preview](/blog/2023-01-10-rate-limiting-azure-openai/); nothing in that post changed with GA.

## What you get that the public OpenAI API doesn't give you

The reason to wait for Azure OpenAI rather than sign up at openai.com isn't the models. It's the controls around them. I did the full comparison in [Azure OpenAI vs OpenAI API](/blog/2023-01-07-azure-openai-vs-openai-api/), but the short version:

| Concern | Azure OpenAI Service |
|---|---|
| Identity | Azure AD authentication and Azure RBAC on the resource, so you can disable keys |
| Network | Private endpoints and resource firewall rules, like other Cognitive Services resources |
| Data use | Per Microsoft's [data, privacy and security page](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy), prompts and completions aren't used to train OpenAI's models |
| Content safety | Content filtering on by default for prompts and completions |
| Billing | On your Azure subscription and existing agreement |

Two caveats. First, data isn't used for training, but it *is* retained for a limited period for abuse monitoring, and authorised Microsoft staff can review flagged content. Customers with sensitive workloads can apply to modify that. "Not used for training" and "never stored" are different statements, so don't conflate them in a privacy impact assessment. Second, the content filter isn't a dial you turn yourself. It's on, and changing its behaviour is another conversation with Microsoft. Design your application to handle a filtered response, as described in [the content filtering post](/blog/2023-01-09-content-filtering-azure-openai/).

## Deploy first, then call by deployment name

If you're coming from OpenAI's API, the one structural difference to absorb is that you don't call a model. You create a resource, deploy a model to it under a name you choose, and call that name. With the Azure CLI, deploying `text-davinci-003` to an existing resource looks like this. This assumes the resource is in East US; `text-davinci-003` isn't in every region yet, so elsewhere swap in `text-davinci-002`.

```bash
az cognitiveservices account deployment create \
  --resource-group <your-resource-group> \
  --name <your-resource-name> \
  --deployment-name davinci-003-summaries \
  --model-name text-davinci-003 \
  --model-version "1" \
  --model-format OpenAI \
  --scale-settings-scale-type "Standard"
```

I name deployments after their *purpose*, not just the model. A deployment is the unit that gets throttled, so separating a batch summarisation workload from an interactive one means one can't starve the other. It also means swapping the underlying model later is a change to one deployment, not a search-and-replace across every service.

The call itself, with the `openai` 0.26 library. Pin the version, because later releases change this API:

```bash
pip install openai==0.26.4
```

```python
import os

import openai

openai.api_type = "azure"
openai.api_base = os.environ["AZURE_OPENAI_ENDPOINT"]  # https://<your-resource-name>.openai.azure.com/
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

response = openai.Completion.create(
    engine="davinci-003-summaries",  # the deployment name, not the model name
    prompt="Summarise for an executive in two sentences:\n\n"
    "Azure OpenAI Service became generally available on 16 January 2023. "
    "Access still requires an approved application.\n\nSummary:",
    max_tokens=80,
    temperature=0.2,
)

print(response["choices"][0]["text"].strip())
print(response["usage"]["total_tokens"], "tokens used")
```

Use a key for a quick test like this one. For anything shared, switch to Azure AD tokens from a managed identity and turn local authentication off on the resource.

## Cost: per token, and the model choice dominates

Billing is per 1,000 tokens, prompt plus completion, with the price set by the model family. The Davinci models sit at $0.02 per 1,000 tokens, ten times Curie, and Ada is cheaper again. Check current rates on the Azure OpenAI pricing page for your region before you put numbers in a business case.

The practical consequence: retrieval-heavy prompts get expensive quickly on Davinci, because you pay for every token of context you stuff in, on every call. Before you default to `text-davinci-003`, try Curie for classification and extraction tasks; it's often good enough at a tenth of the price. Log `usage.total_tokens` per call from day one, as above. It's the only way to know what a feature costs once it has real users.

## When I'd hold off

GA doesn't make Azure OpenAI the right answer for every team right now:

- **You need data processed in Australia** (or anywhere outside the three regions). Wait, or get explicit sign-off for cross-border processing.
- **Your design depends on a chat model.** You can build chat on completions today, but if the product *is* the chat experience, prototype now and plan to rework the prompt layer when ChatGPT arrives.
- **The use case is high-stakes and unreviewed.** If a wrong answer causes real harm and there's no human in the loop, that's a design problem GA doesn't solve. Microsoft's use-case review will likely ask the same question.
- **You just want to experiment this week.** If your organisation's policies allow it and the data is non-sensitive, OpenAI's own API has no approval queue. Move to Azure when the workload needs Azure's controls.

## Where this leaves your plan

If you have an approved subscription and a pilot running in one of the three regions, GA is the green light to start the production conversation with your risk and architecture teams: Azure AD authentication, private endpoints, per-purpose deployments, token logging and a filtered-response path. If you don't have approval yet, submit the application today with the use case written as precisely as you can, because that queue is now the longest item on your critical path. And whatever you build, keep the prompt construction behind one function, because the chat model is coming and you'll want to swap it in without touching the rest of the system.
