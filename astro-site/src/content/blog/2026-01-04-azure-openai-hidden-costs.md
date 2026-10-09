---
title: "Azure OpenAI Hidden Costs: What Your Token Estimate Misses"
description: "Re-sent history, hidden reasoning tokens, billed failures, idle fine-tuned deployments and re-embedding: where Azure OpenAI bills drift from the estimate."
author: Michael John Peña
draft: false
date: 2026-01-04
tags:
  - Azure OpenAI
  - Cost Optimization
  - FinOps
  - Microsoft Foundry
---

Most Azure OpenAI cost estimates are one line of arithmetic: expected requests, times average tokens, times the price per million. The bill is rarely that tidy, because the estimate models the request you designed while the meter counts the requests your application actually sends. The gap is predictable, and almost all of it comes from a handful of places teams don't look until finance asks.

This isn't a general optimisation checklist. I covered model selection and caching in [Cost Optimization Strategies for Azure OpenAI Deployments](/blog/2025-10-22-october-ai-topic/). This is about the costs that never made it into the spreadsheet.

## Conversation history is billed again on every turn

Chat Completions is stateless. Every call sends the whole conversation, so every earlier turn is charged as input again. The Responses API doesn't change the maths: when you chain turns with `previous_response_id` or a conversation object, the service holds the history for you, but the earlier turns are still billed as input tokens on each new response. Server-side state saves you bandwidth, not money.

Take a simple two-turn exchange: the user pastes a 5,000-token document with a 100-token instruction, the model answers in 300 tokens, and the user asks "now translate that into Spanish" (about 10 tokens). The second call doesn't cost 10 input tokens. It costs 5,410: the original instruction, the document, the previous answer and the new question. Add a 400-token reply and that turn is 5,810 tokens, not 410.

Two things soften this, and you should design for both.

**Prompt caching.** On Azure OpenAI models from GPT-4o onward, [prompt caching](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching) is on by default. Once a prompt is at least 1,024 tokens and its first 1,024 tokens match a recent request, the matching prefix is billed at a discounted cached-input rate on Standard deployments, and can be discounted up to 100% against utilisation on Provisioned deployments. The catch is the word *prefix*. A single changed character near the top, such as a timestamp in the system prompt, a per-user greeting, or tools listed in a different order, gives you a cache miss. Put static content first (system prompt, tool definitions, reference documents) and variable content last. Caches are typically cleared after 5 to 10 minutes of inactivity, so caching helps busy chat sessions far more than overnight jobs.

**Trimming what you send.** For follow-ups that only need the last answer, send the last answer. Translating a summary doesn't need the source document. My rule of thumb: keep full history for genuinely conversational turns, and build a fresh, minimal prompt for anything that's really a new task wearing a chat interface.

## Reasoning tokens you never see

GPT-5 and the o-series models think before they answer, and that thinking is billed. Microsoft's [reasoning models guide](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning) describes `reasoning_tokens` as hidden tokens that aren't returned in the response content. They are counted in `completion_tokens`, which is what you pay the output rate on. In the documentation's own o1 sample, 448 of the 1,843 completion tokens are reasoning; in its GPT-5 sample it's 1,792 of 2,919.

The visible answer looks short, so estimates based on response length come in low, and the hidden part sits on the output meter, which costs several times more than input.

The controls are `reasoning_effort` and the output cap. `gpt-5`, `gpt-5-mini` and `gpt-5-nano` accept `minimal`, `low`, `medium` or `high`; the 5.1 and 5.2 models, including `gpt-5.2` and the `gpt-5.1-codex` family, drop `minimal` and add `none` (the default on `gpt-5.1`), which removes reasoning tokens entirely; `gpt-5-codex` doesn't accept `minimal`; and Azure documents `xhigh` only for `gpt-5.1-codex-max`. Higher effort generally means more reasoning tokens. For classification, extraction and routing, `minimal` or `low` is usually enough, and in many of those cases a non-reasoning model such as `gpt-4.1-mini` is the cheaper answer. Set `max_completion_tokens` (or `max_output_tokens` on the Responses API) with reasoning in mind. Too low and you pay for reasoning that runs out of budget before producing an answer. Too high and nothing stops a runaway.

## Failures that still cost money

A common belief is that retrying after rate limits means paying for every attempt. That's wrong, and the real picture is more useful. The [Azure OpenAI FAQ](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/faq) is explicit: if the service doesn't process the request, you aren't charged. A 429 for exceeding the rate limit and a 401 for bad authentication cost nothing.

What does cost money is a failure *after* processing:

| Response | Billed? | Why it matters |
|---|---|---|
| 429 rate limited | No | Retrying 429s is safe for cost, just slow |
| 401 authentication | No | Fix the identity, not the retry policy |
| 400 content filter or input too long | Yes | Retrying the same prompt pays again for the same rejection |
| 408 timeout | Yes | The model did the work; a retry pays twice |
| 200 with `finish_reason: content_filter` | Yes | The completion was generated, then filtered |

The default retry behaviour matters here. The `openai` Python SDK (2.14.0 at the time of writing) retries twice by default, on 408, 409, 429 and 5xx responses, and on client-side timeouts. Its default timeout is 600 seconds. If you lower the timeout to protect your API's latency but leave a long `max_completion_tokens`, a slow reasoning call can time out on your side while the service is still generating. The service may finish and bill that generation even though your client gave up, and the SDK then sends the request again. You risk paying for the work twice while the user still waits.

My recommendation: set the timeout and the output cap together, so one can't silently undercut the other, and never wrap model calls in a generic "retry everything three times" decorator. Content filter rejections and context-length errors aren't transient.

## Fine-tuned models charge by the hour, used or not

This is the one that produces the most surprising line item. A deployed fine-tuned model on Standard or Global Standard pays the same per-token rate as the base model *plus* an hourly hosting fee, listed in Microsoft's [fine-tuning cost guide](https://learn.microsoft.com/en-us/azure/foundry/fine-tuning/cost-management) at $1.70 per hour. That's about $1,224 for a 30-day month before a single token is processed.

There's a safety net that isn't a strategy: according to the [fine-tuned model deployment docs](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/fine-tuning-deploy), a fine-tuned deployment with no completions or chat completions calls for 15 consecutive days is deleted automatically. The model itself survives and can be redeployed. Fifteen days of idle hosting before that kicks in is still roughly $610 per deployment.

For evaluating candidates, use the **Developer** deployment type instead. The [cost guide](https://learn.microsoft.com/en-us/azure/foundry/fine-tuning/cost-management) lists it as pay-per-token with no hourly hosting fee; it comes with no availability SLA or data residency, and is removed automatically after 24 hours. That's exactly the shape of "let me test whether this fine-tune is better than the base model". Only promote to Standard or Provisioned when the model has earned a production slot.

## Re-embedding is cheap in tokens, expensive everywhere else

Embedding tokens are cheap. A million documents at roughly 1,000 tokens each is a billion tokens: about $100 with `text-embedding-ada-002` and about $20 with `text-embedding-3-small` at list prices. The token line is rarely the problem.

The cost hides in what surrounds it. Every change to chunk size, overlap or embedding model means re-embedding the whole corpus, re-indexing it in Azure AI Search, and often running two indexes side by side during cutover. Moving to `text-embedding-3-large` at its full 3,072 dimensions doubles vector storage compared with 1,536-dimension vectors, and vector storage is what pushes AI Search into a bigger tier or more partitions. Don't plan on the Batch API's discount for this either: [Global Batch](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/batch) gives 50% off Global Standard for chat workloads, but embeddings models aren't supported.

The cheapest fix is to never embed the same chunk twice. Key the vector by a hash of the chunk text *and* the model identity, and skip anything you've already seen. Use the model and dimension setting, not just the deployment name: deployment names are arbitrary, and redeploying a different model under the same name would otherwise serve stale vectors. The cache also stores 32-bit floats on purpose, so both paths return the same rounded values:

```python
import hashlib
import sqlite3
from array import array

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import OpenAI

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)
client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=token_provider,  # keyless Entra ID auth; needs openai>=1.106
)
db = sqlite3.connect("embedding_cache.db")
db.execute("CREATE TABLE IF NOT EXISTS vectors (key TEXT PRIMARY KEY, vector BLOB)")


def embed(
    text: str,
    deployment: str = "<your-embedding-deployment>",
    model_id: str = "text-embedding-3-small:1536",  # model name and dimensions
) -> list[float]:
    key = f"{model_id}:{hashlib.sha256(text.encode('utf-8')).hexdigest()}"
    row = db.execute("SELECT vector FROM vectors WHERE key = ?", (key,)).fetchone()
    if row:
        return array("f", row[0]).tolist()

    vector = client.embeddings.create(model=deployment, input=text).data[0].embedding
    blob = array("f", vector).tobytes()  # 4 bytes per dimension, about 6 KB at 1,536
    db.execute("INSERT INTO vectors (key, vector) VALUES (?, ?)", (key, blob))
    db.commit()
    return array("f", vector).tolist()  # same float32 values as a cache hit
```

Storing vectors as packed 32-bit floats rather than JSON text matters more than it looks: a 1,536-dimension vector as JSON is around 30 KB, so a million-document cache would be about 30 GB, against roughly 6 GB as binary. When you re-chunk, unchanged chunks hit the cache and only new boundaries are embedded. At corpus scale I'd keep the cache alongside your source metadata rather than in local SQLite.

## The costs around the model

A few more line items belong to the deployment choices rather than to any single request:

- **Deployment type premiums.** Global Standard is usually the cheapest per token. Data Zone and Regional Standard [deployment types](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types) generally cost more for the same model, which is the price of data residency. If your residency requirement is real, pay it deliberately. If it's a default nobody questioned, compare the deployment type prices for your model before you accept the premium.
- **Provisioned throughput bills by the hour.** PTUs are paid whether you send traffic or not. They pay off for steady, high-utilisation workloads, which I covered in [Azure OpenAI Provisioned Throughput Units](/blog/2024-02-11-azure-openai-ptu/). For spiky traffic, an idle PTU at 3am costs the same as a busy one at 10am.
- **Built-in tools.** On the Assistants API, every Code Interpreter session is charged separately, and file search is billed on the vector storage you keep. The same tool charges apply when you use Code Interpreter and file search through the Responses API or Foundry Agent Service, which is where most new agent builds are heading. The Assistants API is on a deprecation path, so new builds should use Responses or Foundry Agent Service. Either way, orphaned threads, containers and vector stores accumulate quietly.
- **Logging.** Diagnostic logs sent to Log Analytics, or an API Management gateway logging full request and response bodies, are billed on ingestion.

## Measure tokens the way the bill does

You can't manage any of this from the Azure Cost Management view alone, because it tells you what a resource cost, not which feature or prompt caused it. Log the usage object on every call, including the parts that explain the bill:

```python
import logging

import openai
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import OpenAI

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("aoai.usage")

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)
client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=token_provider,
    timeout=120,      # seconds; keep it consistent with the output cap below
    max_retries=2,
)


def ask(feature: str, messages: list[dict]) -> str:
    try:
        response = client.chat.completions.create(
            model="<your-gpt-5-mini-deployment>",
            messages=messages,
            reasoning_effort="low",
            max_completion_tokens=4000,
        )
    except openai.BadRequestError as err:
        # Content filter and context-length rejections are billed; record them too.
        logger.warning("feature=%s rejected status=%d code=%s", feature, err.status_code, err.code)
        raise
    usage = response.usage
    prompt_details = usage.prompt_tokens_details
    completion_details = usage.completion_tokens_details
    logger.info(
        "feature=%s prompt=%d cached=%d completion=%d reasoning=%d finish=%s",
        feature,
        usage.prompt_tokens,
        (prompt_details.cached_tokens or 0) if prompt_details else 0,
        usage.completion_tokens,
        (completion_details.reasoning_tokens or 0) if completion_details else 0,
        response.choices[0].finish_reason,
    )
    return response.choices[0].message.content or ""
```

The `except` branch matters because a billed 400 rejection returns no usage object. Tag each call with the feature that made it. Within a week you'll know your cache hit rate, how much of your output spend is reasoning, and which feature re-sends the most history. Those three numbers explain most of the gap between estimate and invoice.

## Where I'd look first

If the bill is already higher than planned, check in this order: deployed fine-tuned models nobody is using (fastest money back), reasoning token share on high-volume features, cache hit rate on long prompts, and then history growth in chat flows. Retries are worth reviewing for correctness, but 429s aren't where the money goes.

If you're still estimating, multiply the naive number by the turns per conversation, add hosting for anything fine-tuned, and treat reasoning models as producing more output than you can see: anywhere from about 1.3x to 2.6x the visible output in Microsoft's own samples, and more at high effort. Then validate that against the logged usage in your first week of real traffic.

When not to bother: if you're spending a few hundred dollars a month on a prototype, instrument it and move on. Engineering time spent shaving tokens is more expensive than the tokens. The hidden costs above matter once a workload is in production, has many users, or is running fine-tuned or reasoning models at volume.
