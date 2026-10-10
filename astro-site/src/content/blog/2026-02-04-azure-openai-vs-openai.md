---
title: "Azure OpenAI vs OpenAI in 2026: Same Code, Different Contract"
description: "With the Azure OpenAI v1 API one OpenAI client works on both, so the choice rests on data processing location, identity, networking, capacity and model timing."
author: Michael John Peña
draft: false
date: 2026-02-04
tags:
  - Azure OpenAI
  - OpenAI
  - Microsoft Foundry
  - Architecture
  - Security
---

The usual Azure OpenAI vs OpenAI comparison is a list of features, and most of those lists are out of date. Since the Azure OpenAI v1 API became generally available in August 2025, the same `OpenAI()` client and the same Responses API calls work against both platforms. What differs now is the contract around the code: where your prompts are processed, who can call the endpoint, how capacity is bought, and when new models arrive.

I wrote a broader feature comparison in [Azure OpenAI vs OpenAI Direct: A 2025 Comparison Guide](/blog/2025-12-02-december-ai-topic/). This post is narrower. It covers the five questions that actually decide the platform, and a few common beliefs that stopped being true in 2025.

## What the v1 API changed

Before the v1 API, Azure needed its own `AzureOpenAI` client and a dated `api-version` that changed every month or two. Code moved between the two platforms with friction, and every Azure upgrade meant chasing a new version string.

The [Azure OpenAI v1 API](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle) removes both. You point the standard `OpenAI()` client at `https://<your-resource-name>.openai.azure.com/openai/v1/` and drop `api-version` entirely. Since `openai` 1.106.0 (September 2025), `api_key` also accepts a callable, so the same client can take a Microsoft Entra ID token provider and refresh tokens itself. The same endpoint works on a Microsoft Foundry resource, where Azure OpenAI now ships as Azure OpenAI in Foundry Models, so the code below doesn't care which of the two you provisioned.

Here is a provider switch that works on both. It needs `openai` 1.106.0 or later and, for the Azure path, `azure-identity`. Set `LLM_PROVIDER=azure`, `AZURE_OPENAI_RESOURCE=<your-resource-name>` and `LLM_MODEL=<your-deployment-name>` for Azure (or `OPENAI_API_KEY` and `LLM_MODEL=<model-id>` for OpenAI), and give the calling identity the Cognitive Services OpenAI User role on the resource:

```python
import os

from openai import OpenAI


def make_client() -> OpenAI:
    """Return an OpenAI client for either OpenAI or Azure OpenAI (v1 API)."""
    if os.getenv("LLM_PROVIDER") == "azure":
        from azure.identity import DefaultAzureCredential, get_bearer_token_provider

        token_provider = get_bearer_token_provider(
            DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
        )
        return OpenAI(
            base_url=f"https://{os.environ['AZURE_OPENAI_RESOURCE']}.openai.azure.com/openai/v1/",
            api_key=token_provider,  # Entra ID token, refreshed automatically
        )
    return OpenAI()  # uses OPENAI_API_KEY


client = make_client()

response = client.responses.create(
    # On Azure this is your deployment name; on OpenAI it's the model ID.
    model=os.environ["LLM_MODEL"],
    input="Summarise our leave policy in three bullet points.",
)
print(response.output_text)
```

The one real difference left in the code is `model`. On OpenAI it's a model ID such as `gpt-5.2`. On Azure it's the name of a deployment you created, which may or may not match the model name. Name your deployments after the model and that difference disappears too.

So "switching is easy" is now true for the request path. It isn't true for everything around it, which is where the decision lives.

## Five questions that decide it

### 1. Where must prompts be processed?

This is the question I'd ask first, and most comparisons get it wrong.

Microsoft's [data, privacy, and security documentation](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy) is clear that prompts and completions are not available to OpenAI and are not used to train foundation models. That part of the old "your data stays in Azure" claim holds. The part that doesn't hold is location. It depends on the deployment type you choose:

- **Global** deployments can process prompts in any geography where the model is deployed. Data at rest, including the abuse monitoring store, stays in your resource's geography.
- **Data Zone** deployments process within a Microsoft-defined zone. Right now that means the United States or the European Union.
- **Regional (Standard or Provisioned)** deployments process within the resource's Azure geography.

From Sydney, that matters. There's no Australian data zone, so if a policy says inference must happen in Australia, the only Azure option is a regional deployment in an Australian region, provided the model you want is offered there. New models typically land on Global first and reach regional deployment types later, if at all.

OpenAI has moved here too. It added data residency regions through 2025 and on 25 November 2025 expanded the list to include Australia, but only for eligible enterprise API customers on new projects. More importantly, residency and processing are separate columns in [OpenAI's data controls documentation](https://developers.openai.com/api/docs/guides/your-data): only some regions keep inference in-region, while others cover storage at rest only. Check the row for the region you need before you treat it as equivalent to an Azure regional deployment.

### 2. Who is allowed to call the model?

Azure OpenAI uses Entra ID, managed identities and Azure RBAC. Your app's managed identity gets the Cognitive Services OpenAI User role and nobody handles a key. You can disable key authentication on the resource altogether, put it behind a private endpoint, and audit access the same way you audit the rest of the subscription.

OpenAI uses API keys scoped to projects and service accounts. That works, but it's a secret you have to store, rotate and keep out of repos, reached over the public internet. OpenAI does offer IP allowlisting at organisation or project level, which narrows where a stolen key can be used, but there's no private endpoint or workload-identity equivalent. If your security team already has a rule that says "no long-lived secrets, no public endpoints for data services", Azure OpenAI meets it and OpenAI doesn't.

### 3. How do you buy capacity?

Both platforms let you pay per token, and both offer Batch at half price for work that can wait up to 24 hours. The difference is how guaranteed throughput works.

On Azure, quota is tokens per minute assigned to deployments within a subscription and region. Provisioned Throughput Units buy reserved capacity, and spillover (GA since August 2025, per the [Azure OpenAI What's new page](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/whats-new)) routes overflow from a provisioned deployment to a standard one. On OpenAI, your rate limits rise with your usage tier, and reserved capacity with an uptime SLA comes through Scale Tier, sold to enterprise customers.

That last point corrects a common belief: OpenAI does offer an SLA, just not on default pay-as-you-go traffic. Azure OpenAI is covered by Microsoft's standard online services SLA, which is easier to get approved by procurement teams who already have a Microsoft agreement. Azure spend also typically counts towards an existing Azure consumption commitment, which is often the deciding factor in larger organisations.

### 4. How soon do you need new models?

The "Azure gets models weeks later" rule is mostly stale for flagship text models. GPT-5 arrived on Azure in August 2025 alongside OpenAI's launch, and the Azure `gpt-5.2` model version is dated 2025-12-11, the day OpenAI released it.

Three caveats remain. Some flagship models are gated on Azure at launch: the What's new page records that the full `gpt-5` required registration, while `gpt-5-mini`, `gpt-5-nano` and `gpt-5-chat` didn't. Day-one availability usually means Global Standard, sometimes Data Zone (US/EU), and almost never regional, which may conflict with your answer to question 1. And quota for a brand-new model is often tight for the first few weeks.

### 5. Which API features do you depend on?

OpenAI ships platform features on its own API first, and the [Azure OpenAI Responses API page](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses) lists what Azure doesn't support yet. As of early 2026 that list includes compaction through `/responses/compact` and referencing an uploaded image file as input, and file uploads can't use the `user_data` purpose (the workaround is `assistants`). Before you commit, list the specific tools and parameters you use (built-in tools, file inputs, background mode, image generation) and check each one against that page.

Also note the direction of travel. OpenAI has deprecated the Assistants API in favour of Responses, so whichever platform you choose, build new work on Responses, not Assistants.

## Side by side

| Question | Azure OpenAI | OpenAI |
|---|---|---|
| Training on your data | No | Not by default for API data |
| Processing location | Global, Data Zone (US, EU) or regional | Residency options for approved enterprise projects |
| Authentication | Entra ID, managed identity, RBAC, or keys | API keys per project or service account, plus IP allowlisting |
| Network | Private endpoints available | Public internet |
| Reserved capacity | Provisioned Throughput Units | Scale Tier |
| Uptime SLA | Microsoft online services SLA | Scale Tier only |
| New models | Usually Global Standard first, sometimes gated | First |
| Safety filtering | Configurable content filters on by default | Built-in model safety plus an optional, free Moderation endpoint; no per-deployment filter configuration |

## Common beliefs that no longer hold

**"Azure is more expensive."** Not at list price. Global Standard pricing generally tracks OpenAI's per-token prices. You pay more for the constraints: Data Zone and regional deployments cost more than Global, and provisioned capacity is billed whether you use it or not. I covered where Azure bills drift in [Azure OpenAI Hidden Costs](/blog/2026-01-04-azure-openai-hidden-costs/).

**"The content filter is free safety."** It's useful, but it's on by default and it rejects requests. A filtered prompt returns an HTTP 400 error. A filtered completion comes back with `finish_reason` set to `content_filter`, and the [Azure OpenAI FAQ](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/faq) is explicit that you're still charged for it. Test it against your real inputs, especially in domains such as healthcare or security, where legitimate text can trip the default thresholds.

**"You have to pick one."** Not for code. You do have to pick one per workload, because the data and identity answers are per workload.

## How I decide

For client work, I default to Azure OpenAI. If your organisation already runs on Azure, Entra ID, private endpoints, a familiar SLA and existing Azure commitments settle the question before features come up. For personal projects and quick prototypes, I use OpenAI directly: a key, a credit card and the newest model on day one. Production side projects are the exception: they go on Azure OpenAI too, because I've been burned by rate limits at 2 AM, and on Azure the quota and any provisioned capacity are mine to size rather than a usage tier I wait to grow into.

Don't use Azure OpenAI when you have no Azure footprint and no regulatory reason to build one, when you need an OpenAI feature Azure doesn't support yet, or when you need a model in a region Azure doesn't offer. Don't use OpenAI directly when inference must stay in a specific geography, when long-lived API keys are against policy, or when the model must sit behind a private endpoint.

Answer the processing location question first. It's the one answer that can rule a platform out outright, and the v1 API means the code will follow whichever way you go.
