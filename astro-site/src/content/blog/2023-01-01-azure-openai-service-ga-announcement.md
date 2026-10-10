---
title: "Azure OpenAI Service in Preview: What to Sort Out Before GA"
description: "Azure OpenAI is still a limited-access preview as 2023 starts. Here is what to settle now on access, identity, data handling and code so you're ready for GA."
author: Michael John Peña
draft: false
date: 2023-01-01
tags:
  - Azure
  - Azure OpenAI
  - OpenAI
  - Enterprise
  - Governance
---

A month after ChatGPT launched, the request I expect to hear most this year is "that, but inside our tenant". The honest answer on New Year's Day 2023 is that Azure OpenAI Service exists, works, and is still a limited-access preview. That gap between demand and status is the part teams should be planning around now, because the paperwork, identity design and cost controls take longer than writing the first prompt.

## Where things actually stand

Azure OpenAI Service was first announced at Ignite in November 2021 as an invitation-only preview. At Build in May 2022 Microsoft moved it from invitation-only to a limited-access preview you can apply for, and at [Ignite in October 2022](https://news.microsoft.com/ignite-2022-book-of-news/) it announced DALL-E 2 as an invitation-only addition. It is still a preview: you apply, Microsoft reviews your intended use case, and only then can you create a resource.

What you get once approved is the OpenAI model families hosted in Azure: the GPT-3/GPT-3.5 completion models (`text-davinci-002`; `text-davinci-003` is on the OpenAI API and only starting to reach Azure regions, so check your resource's model list before you plan around it, per the [What's new notes](https://learn.microsoft.com/en-us/azure/ai-services/openai/whats-new)), the Codex models for code, and embeddings models. It runs in three regions: East US, South Central US and West Europe. You deploy a model into your own resource and call it through an Azure endpoint, authenticated with Azure keys or Azure Active Directory.

What you don't get yet is ChatGPT. The chat model that triggered all of this interest is a consumer research preview on chat.openai.com, not an API on either OpenAI's platform or Azure. Anyone promising a "ChatGPT integration" this month is promising something that has no supported API behind it. Build on the completion models and keep your prompt layer swappable.

GA looks close: December brought a non-preview REST API version, `2022-12-01`, and the next `openai` Python release is expected to make it the default Azure API version. Microsoft hasn't announced a GA date, though, so I wouldn't put one in a project plan.

## Why preview status matters more than the model

My position is that the model quality is the least risky part of an Azure OpenAI project right now. The risks are elsewhere:

- **Access is gated per use case.** Microsoft's [Limited Access policy](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/limited-access) means approval is tied to the scenarios you describe. If your pilot is "internal knowledge assistant" and you later pivot to "customer-facing content generation", expect to go through review again. Write the application as if a risk officer will read it, because one effectively will.
- **Preview terms apply.** Preview services carry no SLA. That's fine for a pilot with five users. It isn't fine for a call-centre workflow with no fallback.
- **The API surface is still moving.** `2022-12-01` changed the API surface compared with the earlier preview versions (see the December 2022 entry on the [What's new page](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/whats-new)), so older samples may not work unchanged. Pin the API version explicitly in config rather than relying on a library default.
- **Rate limits are low for production.** The December 2022 [quotas](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/quotas-limits) are 20 requests per second for Davinci models and 50 for the others, per deployment. A pilot won't hit that, but a batch job or a popular internal app will. Handle HTTP 429 with retries and exponential backoff from the first line of code.

None of this is a reason to wait. Use the next few months to settle governance and plumbing, so the only change at GA is the support terms.

## Azure OpenAI or OpenAI's own API?

Both expose the same model families, and the request bodies are nearly identical. The differences that matter to an enterprise architect are around the edges.

| Concern | OpenAI API | Azure OpenAI Service (preview) |
|---|---|---|
| Getting access | Sign up with a credit card | Application and use-case review |
| Authentication | Organisation API keys | Resource keys or Azure Active Directory tokens |
| Billing | Separate OpenAI account | Your Azure subscription and enterprise agreement |
| Calling a model | By model name | By your own deployment name |
| Network controls | Public endpoint | Cognitive Services resource firewall (IP rules), virtual network rules and private endpoints; confirm each against the preview docs for your region |
| Content filtering | Moderation endpoint you call yourself | Content filters are built into the service but temporarily off by default since the December 2022 update; ask Azure Support to turn them on |

For most organisations already on Azure, the billing and identity rows decide it. Procurement doesn't need a new vendor, and access can be governed with the same role assignments and Conditional Access policies as everything else. When would I *not* pick Azure? If you're a small team prototyping something outside a corporate tenant and the approval queue would cost you weeks, OpenAI's API is the faster path. Write the client so the endpoint is configuration and you can move later.

## Understand the data handling before legal asks

The first question from any security review will be "what happens to our prompts?". Read Microsoft's [data, privacy and security page for Azure OpenAI](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy) before that meeting. The short version: your prompts and completions aren't used to train OpenAI's models, but the service stores them for up to 30 days for abuse monitoring, and authorised Microsoft reviewers can look at flagged content. Per the December 2022 What's new notes, customers who meet additional Limited Access eligibility criteria can apply (via `aka.ms/oai/modifiedaccess`) to modify abuse monitoring and content filtering.

That retention detail is the one that surprises people. If you're in financial services, healthcare or government, put it in front of your privacy team early. It's far easier to get an exemption or a design change approved before a pilot than after users are relying on it.

For Australian organisations there's a bigger blocker: there's no Australian region. Prompts and completions are processed and stored in the US or West Europe, so any workload with a data residency requirement is a non-starter until that changes, and anything else needs an explicit sign-off on offshore processing.

## Get identity right on day one

Most Azure OpenAI samples start with a resource key pasted into an environment variable. That's fine for a notebook and wrong for anything shared. Keys are long-lived, unattributable, and end up in screenshots.

The resource supports Azure Active Directory authentication, with one prerequisite: tokens only work against the resource's custom subdomain endpoint (`https://<your-resource-name>.openai.azure.com/`), not a shared regional endpoint, so set the custom domain when you create the resource. The `openai` Python library (0.25.0 is current) handles it with `api_type = "azure_ad"`. Grant your app's managed identity, or your own account during development, the **Cognitive Services User** role on the resource, then pass a token instead of a key:

```python
import os

import openai
from azure.identity import DefaultAzureCredential

# Requires: pip install "openai==0.25.0" azure-identity
# Assign "Cognitive Services User" on the Azure OpenAI resource to the identity running this.
credential = DefaultAzureCredential()
token = credential.get_token("https://cognitiveservices.azure.com/.default")

openai.api_type = "azure_ad"
openai.api_base = os.environ["AZURE_OPENAI_ENDPOINT"]  # https://<your-resource-name>.openai.azure.com/
openai.api_version = "2022-12-01"  # pin explicitly; the 0.25.0 default is still a preview version
# This token lasts about 60 minutes. Long-running code must refresh it, e.g. re-call
# credential.get_token() when token.expires_on - time.time() < 300.
openai.api_key = token.token

response = openai.Completion.create(
    engine=os.environ["AZURE_OPENAI_DEPLOYMENT"],  # your deployment name, e.g. <your-davinci-deployment>
    prompt="List three risks of deploying a language model to internal users without review:",
    max_tokens=200,
    temperature=0.2,
)

print(response["choices"][0]["text"].strip())

usage = response["usage"]
print(
    f"prompt={usage['prompt_tokens']} "
    f"completion={usage['completion_tokens']} "
    f"total={usage['total_tokens']}"
)
```

Three things in that sample are deliberate:

1. **`engine` is your deployment name, not the model name.** In Azure you deploy a model such as `text-davinci-002` under a name you choose. Name deployments by purpose (`summarise-prod`) rather than by model, so you can swap the model behind them without touching application code.
2. **The API version is pinned.** Treat it like any other dependency version.
3. **Usage is captured from every response.** You pay per token, and the response already tells you how many you used. Log it with a caller identifier from the first pilot so you can answer "who's spending what" without guessing.

Azure AD tokens expire after roughly an hour, so a long-running service must refresh them, as the comment in the sample says. With a managed identity the credential caches tokens, so re-calling `get_token` is cheap.

Switching your code to Azure AD doesn't stop anyone else using the keys. The control for that is the resource's `disableLocalAuth` property: set it to `true` and the resource rejects key authentication entirely.

## A pre-GA checklist

If you're approved, or waiting on approval, here's how I'd use the time:

1. **Write the use-case application carefully.** Describe the users, the data, and the human review step.
2. **Create the resource in a dedicated resource group** with its own budget alert. Token costs scale with prompt length, and few-shot prompts get long quickly. The Azure CLI creates it once your subscription is approved; the `--custom-domain` flag gives you the subdomain endpoint Azure AD auth needs:

   ```bash
   az group create --name rg-openai-pilot --location eastus

   az cognitiveservices account create \
     --name <your-resource-name> \
     --resource-group rg-openai-pilot \
     --kind OpenAI \
     --sku S0 \
     --location eastus \
     --custom-domain <your-resource-name>
   ```

3. **Use Azure AD from the start and disable keys on the resource.** Set `disableLocalAuth` to `true` once your apps use tokens, and re-enable keys only for a documented break-glass case.
4. **Confirm the region against your residency rules.** East US, South Central US and West Europe are the only options today. Record the decision and who approved offshore processing.
5. **Lock down the network.** The Cognitive Services options are resource firewall IP rules, virtual network rules and private endpoints. Check which ones the Azure OpenAI preview supports in your region before you design around them, and document what is reachable from the public internet.
6. **Get the data handling page signed off** by privacy and security before real data goes in.
7. **Plan for content filtering.** It's off by default right now and Microsoft says it will come back on in Q1 2023. Ask support to enable it for your subscription now, so your app already handles filtered requests and responses with a sensible user message.
8. **Decide who reviews outputs.** For anything customer-facing, a human reviews before publishing. That's both good practice and what the access review expects to see.

## The takeaway

Azure OpenAI Service is the right home for most enterprise experiments with large language models, but it's still a preview on 1 January 2023 and ChatGPT isn't part of it. Spend the time before GA on work that doesn't depend on GA: access approval, Azure AD auth, data handling sign-off, cost tracking and an output review process. Skip it entirely for classification or extraction over structured documents, where Azure Cognitive Services (Language, Form Recognizer) are cheaper, deterministic and generally available, and for anything that needs an SLA with no fallback path. My decision rule: if you can't tick items 1, 3 and 6 by GA, don't promise a production date. I covered what changed at [Ignite 2022](/blog/2022-11-08-azure-openai-service-ignite/) and [why ChatGPT changed the conversation](/blog/2022-11-30-chatgpt-launches-ai-revolution/) in earlier posts.
