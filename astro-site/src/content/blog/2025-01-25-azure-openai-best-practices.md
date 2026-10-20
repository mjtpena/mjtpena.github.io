---
title: "Azure OpenAI in Production, January 2025: Let the Platform Do the Work"
description: "Deployment types, keyless auth, SDK retries, APIM token limits and Global Batch: what to build on Azure OpenAI in January 2025, and what to stop building."
author: Michael John Peña
draft: false
date: 2025-01-25
tags:
  - Azure OpenAI
  - Azure
  - Best Practices
  - API Management
  - Production
---

A lot of Azure OpenAI production code written in 2023 is now solving problems the platform already solves: hand-rolled multi-region routers, client-side token buckets, and response caches keyed on the whole prompt. Through 2024 Microsoft shipped Global and Data Zone deployment types, hourly provisioned pricing, Global Batch, prompt caching and a set of API Management policies built for LLM traffic. If your production checklist hasn't changed since GPT-4 launched, you are carrying code you don't need and probably missing controls you do.

This is the checklist I'd use for a new Azure OpenAI workload as of late January 2025, in the order the decisions should be made.

## Start with the deployment type, not the code

The single most important production decision is now the deployment type, because it decides your quota, your latency behaviour and where your prompts are processed. The [deployment types guide](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/deployment-types) lists eight options, and they reduce to two questions: where may data be processed, and how steady is your traffic?

| Deployment type | Data processing | Billing | When I'd pick it |
|---|---|---|---|
| Global Standard | Any region where the model is deployed | Per token | Default for most workloads with no processing-location constraint |
| Data Zone Standard | Within the US or EU data zone | Per token | EU or US residency requirements with spiky traffic |
| Standard | The resource's Azure geography | Per token | Strict in-country processing, accepting lower quota |
| Global / Data Zone / regional Provisioned | Same split as above | Hourly per PTU, with optional Azure Reservations | Steady, latency-sensitive traffic |
| Global Batch / Data Zone Batch | Global or data zone | Per token, 50% below the matching Standard type | Anything that can wait up to 24 hours |

A few details matter more than the table suggests:

- **Data at rest stays put.** For Global and Data Zone types, only inference processing moves. Uploaded files and stored data stay in the resource's geography. Security reviews care about that distinction, so put it in writing early, then enforce it: the deployment types guide includes an Azure Policy definition that denies deployments by SKU name (its example blocks `GlobalStandard`).
- **Data Zone is US and EU only.** Data Zone Standard arrived in October 2024 and Data Zone Provisioned in December 2024. For an Australian organisation that needs in-country processing, the options are still regional Standard or regional Provisioned, so check model availability in Australia East before promising a model version.
- **Standard has a soft ceiling.** The quotas and limits page defines usage tiers: above 12 billion tokens a month for `gpt-4o` (counted across your whole tenant), Standard, Data Zone Standard and Global Standard traffic may see more latency variability. That is the signal to look at provisioned throughput, not a hard limit.
- **Provisioned pricing changed in December 2024.** Global, Data Zone and regional provisioned now have different hourly prices, and each has its own Azure Reservation that is not interchangeable with the others. Buy the reservation that matches the deployment type, or the deployment silently bills at the hourly rate. I covered the PTU sizing basics in [an earlier post](/blog/2024-02-11-azure-openai-ptu/).

My rule of thumb: start on Global Standard unless a compliance requirement says otherwise, measure for a month, and only then decide whether a baseline of provisioned capacity is worth it.

## Make the client boring

Once the deployment exists, the client code should be short. Two changes do most of the work: authenticate with Microsoft Entra ID instead of keys, and let the SDK handle retries.

```python
import os

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(),
    "https://cognitiveservices.azure.com/.default",
)

client = AzureOpenAI(
    # e.g. https://<your-resource-name>.openai.azure.com/
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    azure_ad_token_provider=token_provider,
    api_version="2024-10-21",  # latest GA data plane version as of January 2025
    max_retries=3,
    timeout=30.0,
)
```

The identity calling this needs the **Cognitive Services OpenAI User** role on the resource and nothing more. Once every caller uses Entra ID, disable local (key) authentication on the resource so a leaked key is worthless.

Pin the GA API version, `2024-10-21`, unless you need a preview-only feature. Preview versions ship roughly monthly and are retired on a schedule; GA versions give you a stable contract.

On retries: the `openai` Python library (1.60 at the time of writing) already retries 408, 409, 429 and 5xx responses, twice by default, with exponential backoff and jitter. On a 429 it honours the `retry-after-ms` and `retry-after` headers Azure OpenAI returns, as long as the requested wait is 60 seconds or less. Another retry decorator on top multiplies attempts and hides capacity problems. Raise `max_retries` slightly, set an explicit timeout (the default is 10 minutes, far too long for an interactive app), and stop there.

What the client should *not* do is guess your rate limit. A per-process token bucket only knows about its own traffic; with three replicas it is wrong by a factor of three. Rate limiting belongs at a shared choke point, which is the next section.

## Put a gateway in front once you have more than one consumer

For a single app talking to a single deployment, a gateway is overhead. As soon as several teams or apps share capacity, put Azure API Management in front. Microsoft's business continuity guidance for Azure OpenAI recommended a GenAI gateway such as APIM at the time, and the [GenAI gateway capabilities](https://learn.microsoft.com/en-us/azure/api-management/genai-gateway-capabilities) cover what the client-side code used to do:

- **`azure-openai-token-limit`** enforces tokens per minute per key (subscription, app ID, IP, whatever you choose) and returns 429 with `Retry-After` when exceeded.
- **`azure-openai-emit-token-metric`** sends prompt, completion and total token counts to Application Insights with dimensions you choose, which gives you chargeback per team without parsing logs.
- **Backend pools** load-balance across deployments with round-robin, weighted or priority routing, and the **circuit breaker** takes a backend out of rotation using the backend's own `Retry-After` value. Priority routing is how you spill from a PTU deployment to a Standard one. Both are configured on the backend resource (via a preview management API version at the time of writing) and the circuit breaker isn't available in the Consumption tier.
- **Semantic caching** (`azure-openai-semantic-cache-lookup`) exists but is still in preview.

A minimal inbound policy that limits each subscription and tags token metrics with it looks like this:

```xml
<policies>
    <inbound>
        <base />
        <authentication-managed-identity resource="https://cognitiveservices.azure.com" />
        <set-backend-service backend-id="aoai-pool" />
        <azure-openai-token-limit
            counter-key="@(context.Subscription.Id)"
            tokens-per-minute="20000"
            estimate-prompt-tokens="false"
            remaining-tokens-header-name="x-remaining-tokens" />
        <azure-openai-emit-token-metric namespace="aoai">
            <dimension name="Subscription ID" />
            <dimension name="API ID" />
        </azure-openai-emit-token-metric>
    </inbound>
    <backend>
        <base />
    </backend>
    <outbound>
        <base />
    </outbound>
    <on-error>
        <base />
    </on-error>
</policies>
```

APIM authenticates to Azure OpenAI with its own managed identity here, so application teams never hold an Azure OpenAI credential at all. `aoai-pool` is a backend pool you define separately.

When not to bother: a single internal app with one deployment and no chargeback requirement. A gateway adds a hop, a cost line and another thing to patch. Add it when the second consumer arrives, not before.

## Handle content filtering as a normal outcome

Content filtering is on by default, and since mid-2024 new deployments get the `DefaultV2` policy, which adds Prompt Shields for jailbreak attempts and protected material detection. There are two ways a request gets filtered, and code needs to treat them differently, as the [content filtering documentation](https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/content-filter) describes: a filtered *prompt* fails with HTTP 400 and error code `content_filter`, while a filtered *completion* returns 200 with `finish_reason` set to `content_filter` and partial or empty content. With `stream=True`, the usual case for chat apps, a filtered completion arrives as a chunk whose `finish_reason` is `content_filter`, and the default streaming mode buffers output and releases it in filtered chunks rather than token by token. Check `finish_reason` on every chunk.

```python
import logging

from openai import AzureOpenAI, BadRequestError

log = logging.getLogger("aoai")


def ask(client: AzureOpenAI, deployment: str, messages: list[dict]) -> str | None:
    """Non-streaming call; see the note above for stream=True."""
    try:
        response = client.chat.completions.create(model=deployment, messages=messages)
    except BadRequestError as e:
        if e.code == "content_filter":
            detail = (e.body or {}).get("innererror", {}).get("content_filter_result")
            log.warning("prompt filtered: %s", detail)
            return None
        raise

    choice = response.choices[0]
    usage = response.usage
    if usage:
        details = usage.prompt_tokens_details
        cached = details.cached_tokens if details else None
        log.info(
            "deployment=%s prompt=%s completion=%s cached=%s",
            deployment, usage.prompt_tokens, usage.completion_tokens, cached,
        )

    if choice.finish_reason == "content_filter":
        results = (choice.model_extra or {}).get("content_filter_results")
        log.warning("completion filtered: %s", results)
        return None
    return choice.message.content
```

Azure-specific fields such as `content_filter_results` aren't part of the OpenAI schema, so the SDK keeps them in `model_extra` as plain dictionaries rather than typed attributes. Log the category and severity, return a clear message to the user, and never retry a filtered request unchanged; it will be filtered again and you pay for it.

## Spend less without writing a cache

Two 2024 features cut cost with almost no code.

Prompt caching is on by default for `gpt-4o` (2024-08-06 and 2024-11-20), `gpt-4o-mini` and the o1 family. When a prompt of at least 1,024 tokens opens identically to a recent request, the cached input tokens are billed at a discount on Standard deployment types and at up to a 100% discount on Provisioned ones, according to the [prompt caching guide](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/prompt-caching). That second point belongs in the PTU decision above: long, stable system prompts stretch each PTU further. Caches usually clear after 5 to 10 minutes of inactivity. The practical change is to put static content (system prompt, tool definitions, few-shot examples) first and per-request content last. One catch for the code above: as of January 2025 only the o1 models return `cached_tokens` (from API version `2024-10-01-preview`), so on `gpt-4o` you'll see the discount on the invoice, not in the response. Log it anyway and treat `None` as unknown, not zero.

Global Batch is GA and costs 50% less than Global Standard, with a 24-hour target turnaround and its own enqueued-token quota, so it doesn't eat into your online capacity. Nightly classification, document enrichment and evaluation runs belong there.

I'd still avoid a home-grown exact-match response cache for chat. Hit rates on free-text conversation are low, cached answers go stale when your grounding data changes, and you now own a data store full of user prompts. If you genuinely have repeated identical requests, cache at the application layer where you know the data's lifetime.

## Observe tokens, not just requests

Platform metrics are collected automatically: **Azure OpenAI Requests**, **Processed Prompt Tokens**, **Generated Completion Tokens**, and for provisioned deployments **Provisioned-managed Utilization V2**, all splittable by deployment. Request logs are not: they aren't collected until you create a diagnostic setting, as [Monitor Azure OpenAI](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/monitor-openai) explains, so add one when you create the resource, not after the first incident. Add per-request logging of deployment, token counts and finish reason in the app, and token metrics by consumer at the gateway.

The three alerts I'd set first: sustained 429 rate above a few percent, Provisioned-managed Utilization V2 above 90%, and a week-on-week jump in tokens per request, which usually means someone changed a prompt or a retrieval step started returning more context. Don't alert on every 429, though. A PTU deployment returns 429 once utilisation passes 100%, and if APIM spills that traffic to a Standard deployment, those 429s are the design working. Alert on 429s that reach the client instead.

## The short version

If I were reviewing an Azure OpenAI design today, these are the questions I'd ask:

1. Is the deployment type chosen from data processing requirements and traffic shape, rather than defaulting to regional Standard?
2. Is every caller on Entra ID with key authentication disabled?
3. Is the client pinned to API version `2024-10-21`, with the SDK's retries and an explicit timeout, and no second retry layer?
4. With more than one consumer, are rate limits and token metrics enforced in APIM rather than in each app?
5. Does the code handle both kinds of content filter outcome without retrying?
6. Is anything that can wait running on Global Batch, and are prompts ordered to benefit from prompt caching?

Most of the "production-ready" code that used to fill posts like this is now configuration. If you can only fix one item this sprint, make it the second: moving every caller to Entra ID and disabling key authentication closes the one gap you can't repair after the fact. Deployment types, gateways and batch jobs can all change later. For quota mechanics in more depth, see [Azure OpenAI quotas](/blog/2023-08-22-azure-openai-quotas/), and for the late-2024 model and feature releases that led here, see the [November 2024 updates](/blog/2024-11-01-azure-openai-november-updates/).
