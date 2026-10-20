---
title: "Azure OpenAI vs OpenAI API: What Differs in January 2023"
description: "Azure OpenAI or OpenAI's own API in January 2023? Access, models, data use, cost and code compared, plus one Python client that can target either."
author: Michael John Peña
draft: false
date: 2023-01-07
tags:
  - Azure OpenAI
  - OpenAI
  - Azure
  - Architecture
  - Python
---

Since ChatGPT arrived, the same question keeps coming up: should we build on OpenAI's API or on Azure OpenAI Service? Both serve the same GPT-3 model families with nearly identical request bodies, so it looks like a coin toss. It isn't. The two differ in how you get access, which models you can use this week, what happens to your prompts, and who you're buying from, and those differences decide more about a project than the model does.

I covered what to sort out while Azure OpenAI is still in preview in [an earlier post](/blog/2023-01-01-azure-openai-service-ga-announcement/), and the security controls in [Enterprise AI with Azure OpenAI](/blog/2023-01-06-enterprise-ai-azure-openai/). This one is the side-by-side, plus a way to write code that doesn't force you to choose permanently.

## What each one is on 7 January 2023

**OpenAI's API** is a self-service platform. You sign up, add a card, and get an API key. The catalogue is the GPT-3 family (with `text-davinci-003` as the newest Davinci model since late November), the Codex models in limited beta, the [DALL-E image API in public beta since November](https://openai.com/index/dall-e-api-now-available-in-public-beta), embeddings (including `text-embedding-ada-002`, released on 15 December), fine-tuning, and a free moderation endpoint.

**Azure OpenAI Service** is the same model families hosted by Microsoft inside Azure, and it is still a preview. Under Microsoft's [Limited Access policy](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/limited-access) you apply, describe your use case, and wait for approval before you can create a resource. Once approved you deploy models into your own resource and call them through your own endpoint. DALL-E 2 is invitation-only within that preview.

Neither offers ChatGPT as an API. If someone has promised you a "ChatGPT integration" this month, the closest thing either platform supports is a well-designed prompt against a Davinci completion model.

## The comparison

| Concern | OpenAI API | Azure OpenAI Service (preview) |
|---|---|---|
| Getting access | Self-service sign-up | Application and use-case review |
| New models | Released here first | Arrive later, region by region |
| Calling a model | By model name (`model=`) | By your deployment name (`engine=`) |
| Authentication | API keys, optional organisation header | Resource keys or Azure Active Directory tokens |
| Your data and training | Can be used to improve models unless you opt out | Not used to train OpenAI's models |
| Content filtering | Moderation endpoint you call yourself | Built into the service, but temporarily off by default since December 2022 (Microsoft plans to re-enable it in Q1 2023) |
| Billing | Separate OpenAI account | Your Azure subscription |
| Rate limits and quota | Per-organisation rate limits and a monthly usage limit | Requests-per-second limits per deployment (20/s for Davinci, 50/s for other models) |
| Access controls | API keys on an organisation | Azure resource-level controls (keys, Azure AD RBAC, customer-managed keys) |
| Regions | Not selectable | A small set of US and European regions |
| SLA | None published | None while in preview |

Don't rely on Azure's content filter yet. Microsoft's [What's new page](https://learn.microsoft.com/en-us/azure/ai-services/openai/whats-new) lists the December 2022 changes: API version `2022-12-01`, higher rate limits, content filtering off by default, and a process for requesting modified abuse monitoring. Until the filter is back on, call OpenAI's moderation endpoint or your own filter on both platforms.

A few of those rows deserve more than a table cell. On quota specifically: OpenAI raises rate limits and the monthly usage limit when you request an increase for your organisation, while Azure's preview limits are set per deployment and raising them means opening a support request. Neither is instant, so ask before a launch date, not on it.

### Data use is the row legal will ask about

OpenAI's [API data usage policy](https://openai.com/policies/api-data-usage-policies) as of January 2023 (it changes on 1 March 2023) allows it to use content submitted through the API to improve its services, and organisations that don't want that have to request an opt-out. For a consumer side project that's an acceptable trade. For anything that touches customer records, it's a conversation with your privacy team before a single real prompt is sent.

Azure's position is different. Microsoft's [data, privacy and security page for Azure OpenAI](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy) states that your prompts and completions aren't used to train OpenAI models. The detail people miss is that the service still retains them for a limited period for abuse monitoring, and authorised Microsoft staff can review flagged content. You can apply for modified monitoring if that's a problem for your workload. Neither platform is "your data never leaves your control". Azure's terms are simply the easier ones to get past a risk committee.

### Region is a residency question, not a latency one

Azure OpenAI is only in a handful of US and European regions, with no Australian region. If your data residency policy says "Australia only", Azure doesn't solve it yet. What Azure does give you is a named region, a contract you already have, and an audit trail in your own subscription. OpenAI's API gives you none of those. For most Australian organisations I'd rather have a documented exception for a known Azure region than an undocumented dependency on someone else's.

### The model gap runs one way

New models land on OpenAI's API first. As of 7 January, the Azure preview catalogue is `text-davinci-002`, with `text-davinci-003` rolling out to East US and West Europe, plus `code-davinci-002`, the smaller GPT-3 models, and the earlier first-generation embeddings models. `text-embedding-ada-002`, which OpenAI shipped on 15 December and which is both cheaper and better than the models it replaces, isn't on Azure yet. In practice the lag is weeks, and region by region. If your project depends on the newest model on release day, Azure will frustrate you. If it depends on a model being there in eighteen months with a support contract behind it, that lag matters much less.

### Cost is closer than the debate suggests

Pay-as-you-go token rates for the base GPT-3 models are in the same range on both: Davinci-class models are $0.02 per 1,000 tokens on [OpenAI's price list](https://openai.com/api/pricing/), and Azure's preview price for Davinci is also $0.02 per 1,000 tokens. The differences are elsewhere. Codex is free on OpenAI while it's in limited beta, but you can't build a production commitment on a free beta. Fine-tuned models on Azure carry an hourly hosting charge for each deployment on top of token usage (about $3 per hour for a fine-tuned Davinci deployment), while OpenAI charges a higher per-token rate for fine-tuned models instead. If you fine-tune Davinci and then leave the deployment idle on Azure, that's roughly $2,000 a month for nothing. The bigger saving for most enterprises is administrative: Azure usage lands on an existing invoice and enterprise agreement instead of a new vendor and a corporate credit card.

## Write once, point at either

The `openai` Python library (0.26.0, released 6 January) speaks to both. Most samples configure it through module-level globals (`openai.api_type = "azure"` and so on), which is fine for a notebook and fragile in a service. The library also accepts `api_key`, `api_base`, `api_type` and `api_version` on each call, so you can keep the provider in configuration and keep the global module state clean.

```python
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Optional

import openai

# Requires: pip install "openai==0.26.0" azure-identity
AZURE_API_VERSION = "2022-12-01"


@dataclass(frozen=True)
class CompletionTarget:
    provider: str  # "openai", "azure" (key) or "azure_ad" (Azure AD token)
    name: str  # a model name on OpenAI, your deployment name on Azure
    api_base: Optional[str] = None
    api_version: Optional[str] = None


def load_target() -> CompletionTarget:
    provider = os.environ.get("LLM_PROVIDER", "openai")
    if provider == "openai":
        return CompletionTarget(
            provider="openai",
            name=os.environ.get("OPENAI_MODEL", "text-davinci-003"),
            api_base="https://api.openai.com/v1",
        )
    if provider in ("azure", "azure_ad"):
        return CompletionTarget(
            provider=provider,
            name=os.environ["AZURE_OPENAI_DEPLOYMENT"],  # e.g. <your-deployment-name>
            api_base=os.environ["AZURE_OPENAI_ENDPOINT"].rstrip("/"),  # https://<your-resource-name>.openai.azure.com
            api_version=AZURE_API_VERSION,
        )
    raise ValueError(f"Unknown LLM_PROVIDER: {provider}")


@lru_cache(maxsize=1)
def _credential():
    # One credential per process; it caches and refreshes tokens itself.
    from azure.identity import DefaultAzureCredential

    return DefaultAzureCredential()


def get_api_key(target: CompletionTarget) -> str:
    if target.provider == "openai":
        return os.environ["OPENAI_API_KEY"]
    if target.provider == "azure":
        return os.environ["AZURE_OPENAI_KEY"]
    # Azure AD: the identity needs "Cognitive Services User" on the resource.
    # get_token is cheap after the first call: the credential returns its
    # cached token until it nears expiry.
    token = _credential().get_token("https://cognitiveservices.azure.com/.default")
    return token.token


def complete(target: CompletionTarget, prompt: str, **params) -> dict:
    request = {
        "api_key": get_api_key(target),
        "api_base": target.api_base,
        "api_type": "open_ai" if target.provider == "openai" else target.provider,
        "prompt": prompt,
        **params,
    }
    if target.provider == "openai":
        request["model"] = target.name
    else:
        request["engine"] = target.name
        request["api_version"] = target.api_version

    response = openai.Completion.create(**request)
    return {
        "text": response["choices"][0]["text"].strip(),
        "finish_reason": response["choices"][0]["finish_reason"],
        "total_tokens": response["usage"]["total_tokens"],
        "provider": target.provider,
    }


if __name__ == "__main__":
    target = load_target()
    result = complete(
        target,
        "Summarise the main risk of storing API keys in source control in one sentence:",
        max_tokens=60,
        temperature=0.2,
    )
    print(result)
```

Switching providers is now an environment change: `LLM_PROVIDER=azure_ad` plus the endpoint and deployment name. Three things in there are deliberate.

1. **`engine` versus `model` is the only call-site difference.** On Azure you call a deployment you named, not a model. Name deployments by purpose (`summarise-prod`) and you can swap the model behind them without a code change by deleting and recreating the deployment under the same name (plan for a short outage), which you can't do on OpenAI's side.
2. **The API version is passed explicitly.** The library only defaults Azure calls to `2022-12-01` when `OPENAI_API_TYPE` is set in the environment before import. Set the type in code instead and the version stays empty, so the call fails (in 0.26.0 with a confusing `TypeError` rather than a clear message). Pin it yourself.
3. **Azure AD is a first-class option.** Keys are long-lived and unattributable. The credential is created once and cached, and each request asks it for a token, which it serves from its own cache until the token is close to expiry.

## When to pick which

**Pick OpenAI's API when** you're prototyping outside a corporate tenant, the data is public or synthetic, and waiting weeks for approval would kill the idea. It's also the place to evaluate a new model before it reaches Azure. Just don't let the prototype quietly become production with someone's personal API key in it.

**Pick Azure OpenAI when** the data is customer or employee data, you need Azure AD, role assignments and encryption keys you already govern, or procurement won't onboard a new vendor. For most organisations already on Azure that's the default, even with preview terms.

**Don't pick either yet when** the task is extraction or classification over structured documents that Azure Cognitive Services such as Form Recognizer or Language already handle, or when you need a contractual SLA today. Preview means no SLA on Azure, and OpenAI doesn't publish one.

## My take

Treat this as a hosting decision, not a model decision. The models are the same; the access process, data terms, billing and identity are not. If you're an enterprise on Azure, apply for Azure OpenAI now and start the paperwork. Prototype on whichever platform you can get into this week and keep the provider in configuration, but stop the abstraction there. The models are the same family on both sides, so a provider hierarchy with routing rules and fallbacks buys little and is a second thing to maintain.
