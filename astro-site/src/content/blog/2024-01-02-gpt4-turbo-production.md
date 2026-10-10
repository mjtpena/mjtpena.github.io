---
title: "Shipping on GPT-4 Turbo Preview in Azure OpenAI: A Production Checklist"
description: "GPT-4 Turbo is still a preview model on Azure OpenAI; here's how I'd deploy, budget, retry and test around 1106-preview before real users touch it."
author: Michael John Peña
draft: false
date: 2024-01-02
tags:
  - GPT-4
  - Azure OpenAI
  - Production
  - Python
  - Cost Optimization
---

GPT-4 Turbo has been on Azure OpenAI for about six weeks. It's cheaper than GPT-4, has a much bigger context window and supports JSON mode, so the obvious move is to switch straight away. The catch is in Microsoft's own wording: GPT-4 Turbo is a **preview** model, and the [Azure OpenAI models page](https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models) says preview models aren't recommended for production use. The real question isn't whether Turbo is good enough, but whether you can live with a model whose behaviour may change underneath you, and what to build so you can.

The DevDay features themselves are covered in earlier posts on [JSON mode](/blog/2023-11-07-json-mode-structured-outputs/) and [parallel function calling](/blog/2023-11-09-function-calling-improvements/), and the general deployment patterns in [Azure OpenAI enterprise patterns](/blog/2023-11-01-openai-devday-announcements/). Here the focus is running GPT-4 Turbo specifically on Azure: deployments, quota, API versions, failure handling and cost.

## What you are actually deploying

On Azure you don't deploy a model called "gpt-4-turbo". You deploy model **gpt-4** with model version **1106-preview**. In code you call your deployment by whatever name you gave it. The facts that matter, per that same models page and the [Azure OpenAI pricing page](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/):

| | GPT-4 (0613) | GPT-4 Turbo (1106-preview) |
|---|---|---|
| Status | Stable (non-preview) version | Preview |
| Context window | 8,192 or 32,768 tokens | 128,000 tokens input |
| Max output | Shares the context window | 4,096 tokens |
| Training data | Up to Sep 2021 | Up to Apr 2023 |
| JSON mode, seed, parallel tool calls | No | Yes (API version `2023-12-01-preview`) |
| List price per 1K tokens (input / output) | $0.03 / $0.06 (8K) | $0.01 / $0.03 |

As of this writing, 1106-preview is available to all subscriptions in nine regions: Australia East, Canada East, East US 2, France Central, Norway East, South India, Sweden Central, UK South and West US. For anyone in Australia, Australia East means you don't need to send traffic offshore. That's often the deciding factor for data residency conversations, more than any feature.

Two rows in that table are easy to misread.

**The 4,096 output limit.** The context window is roughly 16 times GPT-4 8K's (4 times GPT-4-32K's), but the model still can't write more than 4,096 tokens per response. Turbo is great at "read 300 pages and answer a question". It won't produce a 300-page answer. If your workload is long-form generation, the 32K GPT-4 deployment can still emit more in one call.

**The status column.** Microsoft says preview models don't follow the normal model lifecycle: all 1106-preview deployments will be upgraded to a future stable version. You don't get to decide when your model's behaviour changes. That shapes most of the advice below.

## Should you ship on a preview model at all?

My position: **yes for internal tools and assistive features with a human in the loop, no for anything where an unexpected behaviour change becomes a customer-facing incident or a compliance finding.**

The preview label is about lifecycle and support, not a statement that the model is worse. The risks are operational:

- **No pinned version.** When the stable release lands, your prompts run against a different model. Output formats, refusal behaviour and verbosity can all shift.
- **Preview API versions.** JSON mode, `seed` and parallel tool calls need `api-version=2023-12-01-preview`. The latest GA API version, `2023-05-15`, doesn't support them. Preview API versions get retired on Microsoft's timetable, not yours.
- **Quota is tight.** The [quotas page](https://learn.microsoft.com/en-us/azure/ai-services/openai/quotas-limits) lists a default of 80K tokens per minute per region per subscription for GPT-4 Turbo in most regions, and 150K in Norway East, South India and Sweden Central. A single 100K-token prompt uses more than an entire minute of an 80K allocation.

If those risks are acceptable, the rest of this post is how to contain them. If they aren't, stay on GPT-4 0613 and run Turbo beside it in a shadow or evaluation path until the stable version ships.

## A client that fails predictably

The `openai` Python package 1.x (1.6.1 as of this writing) has a proper `AzureOpenAI` client with built-in retries. By default it retries twice, with exponential backoff, on 429s, 5xx responses and connection errors, and it respects the `retry-after` header Azure returns when you're throttled. A mistake I see often is wrapping that in a separate `tenacity` decorator as well. The result is nested retries that turn one throttled request into a dozen. Configure the SDK's retries and drop the decorator.

I also authenticate with Microsoft Entra ID instead of API keys. A key in an app setting is one leaked config file away from someone else spending your quota.

```python
import os

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)

client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],  # https://<your-resource-name>.openai.azure.com/
    azure_ad_token_provider=token_provider,
    api_version="2023-12-01-preview",  # needed for JSON mode, seed and tools
    max_retries=4,   # SDK backs off and honours retry-after on 429s
    timeout=60.0,    # large prompts are slow; don't let requests hang forever
)

TURBO_DEPLOYMENT = os.environ.get("AZURE_OPENAI_TURBO_DEPLOYMENT", "gpt4-turbo-1106")
```

This needs `openai>=1.0` (I'm on 1.6.1) and `azure-identity>=1.15`, which added `get_bearer_token_provider`. The identity running the code needs the **Cognitive Services OpenAI User** role on the resource.

For fallback, my rule is to fall back to the *same model in another region* before falling back to a *different model*. A second 1106-preview deployment in another region (each region gets its own quota) gives users the same behaviour. Silently dropping to GPT-3.5 Turbo gives them a noticeably worse answer, and your logs end up mixing two models' outputs. If you do fall back to a different model, record which model answered on every response.

## JSON mode is a format guarantee, not a schema guarantee

JSON mode is the feature that gets most teams excited, and the [Azure JSON mode guide](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/json-mode) has three caveats that matter in production:

1. The messages must contain the word "json", or the request is rejected.
2. The output is valid JSON, but it isn't guaranteed to match the schema you described.
3. If the response hits `max_tokens`, you get truncated JSON. Check `finish_reason` before parsing.

So I still validate every response. Pydantic does the schema check, and the code handles the truncation case explicitly instead of letting `json.loads` throw something unhelpful:

```python
from pydantic import BaseModel, ValidationError


class Entity(BaseModel):
    name: str
    entity_type: str
    confidence: float


class EntityResult(BaseModel):
    entities: list[Entity]


SYSTEM_PROMPT = (
    "Extract named entities from the user's text. Respond in JSON with this shape: "
    '{"entities": [{"name": string, "entity_type": string, "confidence": number between 0 and 1}]}'
)


def extract_entities(text: str) -> EntityResult:
    response = client.chat.completions.create(
        model=TURBO_DEPLOYMENT,  # your deployment name, not the model name
        response_format={"type": "json_object"},
        temperature=0,
        seed=42,
        max_tokens=1000,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
    )
    choice = response.choices[0]
    if choice.finish_reason == "content_filter":
        # Azure's content filter blocked or cut the output: log it separately, don't retry blindly
        raise RuntimeError("Response blocked by content filter (finish_reason=content_filter)")
    if choice.finish_reason == "length":
        raise RuntimeError("Truncated JSON: response hit max_tokens (finish_reason=length)")
    if choice.finish_reason != "stop":
        raise RuntimeError(f"Unexpected finish_reason={choice.finish_reason}")

    try:
        return EntityResult.model_validate_json(choice.message.content)
    except ValidationError as exc:
        raise RuntimeError(f"Response did not match schema: {exc}") from exc
```

`seed` and `temperature=0` make outputs *more* repeatable, not fully deterministic. That's still useful for regression tests. Reproducible output is itself a preview feature on Azure (see the [reproducible output how-to](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/reproducible-output)), so treat `system_fingerprint` changes as expected. I covered the limits in [the seed parameter post](/blog/2023-11-08-seed-parameter-reproducible-outputs/), and the prompt side of JSON mode in [JSON mode: reliable structured outputs](/blog/2023-11-07-json-mode-structured-outputs/).

## 128K tokens is a ceiling, not a target

The bigger context window changes what you *can* do. It doesn't change what you *should* do. At $0.01 per 1K input tokens, a 100K-token prompt costs about a dollar before the model writes a word, and it takes noticeably longer to return. Put that behind a chat UI with a few hundred users and the bill becomes a problem quickly. On an 80K TPM quota, it doesn't even fit.

My rule of thumb: if retrieval can find the relevant 5–10K tokens, use retrieval. Use the long context window for tasks that genuinely need the whole document at once, like comparing two contracts clause by clause, reviewing a full codebase module, or summarising a long transcript. Even then, count tokens before you send the request rather than finding out from a 400 error:

```python
import tiktoken

ENCODING = tiktoken.get_encoding("cl100k_base")  # tokenizer used by GPT-4 and GPT-4 Turbo
CONTEXT_LIMIT = 128_000


def fits_in_context(system_prompt: str, user_content: str, max_output: int = 4096) -> bool:
    # Rough count: ignores the few tokens of per-message overhead, so keep a margin.
    prompt_tokens = len(ENCODING.encode(system_prompt)) + len(ENCODING.encode(user_content))
    return prompt_tokens + max_output + 500 <= CONTEXT_LIMIT
```

When the check fails, use a map-reduce summary or chunked retrieval, which I covered in [context window management strategies](/blog/2023-03-24-context-window-management-strategies/). Don't truncate silently.

## Plan for the upgrade you don't control

Because every 1106-preview deployment will be moved to a stable version, the most valuable thing you can build now is a **regression suite you can run the day that happens**:

- Keep 50–200 real (de-identified) inputs with expected outputs or grading criteria, saved in source control next to your prompts.
- Run them against GPT-4 Turbo today and save the results as a baseline, including `system_fingerprint` from each response. When the fingerprint changes, the backend changed.
- Re-run the suite when the stable version is announced and before you move any API version off `2023-12-01-preview`.
- Log `prompt_tokens`, `completion_tokens`, deployment name and latency on every call. You'll want them for the cost conversation and for spotting behaviour drift.

None of this is specific to Turbo. But a GA model lets you postpone it, and a preview model doesn't.

## My recommendation

Use GPT-4 Turbo for new internal and assistive workloads now. The price and context gains over GPT-4 are real, and Australia East availability removes a common blocker. Put it behind the SDK's retries, Entra ID auth, schema validation and a second-region deployment. Build the regression suite before you go live, not after the forced upgrade. For regulated, customer-facing or long-output workloads, keep GPT-4 0613 as the production model for now and run Turbo in parallel until Microsoft ships a stable version.
