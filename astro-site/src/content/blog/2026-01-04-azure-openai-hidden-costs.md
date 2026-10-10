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

Chat Completions is stateless: every call sends the whole conversation, so every earlier turn is charged as input again. The Responses API doesn't change the maths. Chain turns with `previous_response_id` or a conversation object and the service holds the history, but earlier turns are still billed as input on each new response. Server-side state saves bandwidth, not money.

Take a simple two-turn exchange: the user pastes a 5,000-token document with a 100-token instruction, the model answers in 300 tokens, and the user asks "now translate that into Spanish" (about 10 tokens). The second call costs 5,410 input tokens, not 10: instruction, document, previous answer and new question. Add a 400-token reply and that turn is 5,810 tokens, not 410.

Two things soften this.

**Prompt caching.** On Azure OpenAI models from GPT-4o onward, [prompt caching](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching) is on by default. Once a prompt is at least 1,024 tokens and its first 1,024 tokens match a recent request, the matching prefix is billed at a discounted cached-input rate on Standard deployments, and can be discounted up to 100% against utilisation on Provisioned deployments. The catch is the word *prefix*: a timestamp in the system prompt, a per-user greeting or reordered tools near the top gives you a cache miss. Put static content first (system prompt, tool definitions, reference documents) and variable content last. Caches are typically cleared after 5 to 10 minutes of inactivity, so caching helps busy chat sessions far more than overnight jobs.

**Trimming what you send.** Translating a summary doesn't need the source document. My rule of thumb: keep full history for genuinely conversational turns, and build a fresh, minimal prompt for anything that's really a new task wearing a chat interface.

## Reasoning tokens you never see

GPT-5 and the o-series models think before they answer, and that thinking is billed. Microsoft's [reasoning models guide](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning) describes `reasoning_tokens` as hidden tokens that aren't returned in the response content. They are counted in `completion_tokens`, which is what you pay the output rate on. In the documentation's own o1 sample, 448 of the 1,843 completion tokens are reasoning; in its GPT-5 sample it's 1,792 of 2,919.

Estimates based on visible response length come in low, and the hidden part sits on the output meter, which costs several times more than input.

The controls are `reasoning_effort` and the output cap:

| Model group | `reasoning_effort` values | Default |
|---|---|---|
| `gpt-5`, `gpt-5-mini`, `gpt-5-nano` | `minimal`, `low`, `medium`, `high` | `medium` |
| `gpt-5-codex` | `low`, `medium`, `high` (no `minimal`) | `medium` |
| `gpt-5.1`, `gpt-5.2`, `gpt-5.1-codex` family | adds `none`, which removes reasoning tokens entirely | `none` on `gpt-5.1` |

Azure documents `xhigh` only for `gpt-5.1-codex-max`.

Higher effort generally means more reasoning tokens. For classification, extraction and routing, `none`, `minimal` or `low` is usually enough, and often a non-reasoning model such as `gpt-4.1-mini` is cheaper still. Set `max_completion_tokens` (or `max_output_tokens` on the Responses API) with reasoning in mind. Too low and you pay for reasoning that runs out of budget before producing an answer. Too high and nothing stops a runaway.

## Failures that still cost money

A common belief is that retrying after rate limits means paying for every attempt. That's wrong. The [Azure OpenAI FAQ](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/faq) is explicit: if the service doesn't process the request, you aren't charged. A 429 for exceeding the rate limit and a 401 for bad authentication cost nothing.

What does cost money is a failure *after* processing:

| Response | Billed? | Why it matters |
|---|---|---|
| 429 rate limited | No | Retrying 429s is safe for cost, just slow |
| 401 authentication | No | Fix the identity, not the retry policy |
| 400 content filter or input too long | Yes | Retrying the same prompt pays again for the same rejection |
| 408 timeout | Yes | The model did the work; a retry pays twice |
| 200 with `finish_reason: content_filter` | Yes | The completion was generated, then filtered |

The default retry behaviour matters here. The `openai` Python SDK (2.14.0 at the time of writing) retries twice by default, on 408, 409, 429 and 5xx responses, and on client-side timeouts. Its default timeout is 600 seconds. Lower the timeout but leave a long `max_completion_tokens`, and a slow reasoning call can time out on your side while the service is still generating. The service may finish and bill that generation, and the SDK sends the request again. You risk paying twice while the user still waits.

My recommendation: set the timeout and the output cap together, so one can't silently undercut the other, and never wrap model calls in a generic "retry everything three times" decorator. Content filter rejections and context-length errors aren't transient.

## Fine-tuned models charge by the hour, used or not

This produces the most surprising line item. A deployed fine-tuned model on Standard or Global Standard pays the same per-token rate as the base model *plus* an hourly hosting fee (Global Standard for fine-tuned models is in preview). Microsoft's [fine-tuning cost guide](https://learn.microsoft.com/en-us/azure/foundry/fine-tuning/cost-management) listed that fee at $1.70 per hour at the time of writing. That's about $1,224 for a 30-day month before a single token is processed.

There's a safety net that isn't a strategy: according to the [Azure OpenAI FAQ](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/faq), a fine-tuned deployment with no completions or chat completions calls for 15 consecutive days is deleted automatically. The model itself survives and can be redeployed. Fifteen days of idle hosting before that kicks in is still roughly $610 per deployment.

For evaluating candidates, use the **Developer** deployment type instead: pay-per-token with no hourly hosting fee, no availability SLA or data residency, and removed automatically after 24 hours. That's exactly the shape of "is this fine-tune better than the base model?". Developer deployments are available for a subset of fine-tunable models; check the list before planning on it. Only promote to Standard or Provisioned when the model has earned a production slot.

## Re-embedding is cheap in tokens, expensive everywhere else

Embedding tokens are cheap. A million documents at roughly 1,000 tokens each is a billion tokens: about $100 with `text-embedding-ada-002` and about $20 with `text-embedding-3-small` at list prices. The token line is rarely the problem.

The cost hides in what surrounds it. Every change to chunk size, overlap or embedding model means re-embedding the corpus, re-indexing it in Azure AI Search, and often running two indexes side by side during cutover. Moving to `text-embedding-3-large` at its full 3,072 dimensions doubles vector storage against 1,536 dimensions, and vector storage is what pushes AI Search into a bigger tier. The Batch API's 50% discount doesn't help either, because it doesn't support embeddings models.

The cheapest fix is to never embed the same chunk twice. Key the vector by a hash of the chunk text plus the model and dimensions, not the deployment name: deployment names are arbitrary, and redeploying a different model under the same name would serve stale vectors. Vectors are stored as packed 32-bit floats, about 6 KB each at 1,536 dimensions against roughly 30 KB as JSON, and both paths return the same values:

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


def embed(text: str, deployment: str, model: str, dimensions: int) -> list[float]:
    # model is the underlying model name (e.g. "text-embedding-3-small"),
    # not the deployment name, so a redeploy can't serve stale vectors.
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    key = f"{model}:{dimensions}:{sha}"
    row = db.execute("SELECT vector FROM vectors WHERE key = ?", (key,)).fetchone()
    if row:
        return array("f", row[0]).tolist()

    vector = (
        client.embeddings.create(model=deployment, input=text, dimensions=dimensions)
        .data[0]
        .embedding
    )
    blob = array("f", vector).tobytes()  # 4 bytes per dimension
    db.execute("INSERT INTO vectors (key, vector) VALUES (?, ?)", (key, blob))
    db.commit()
    return array("f", vector).tolist()  # same float32 values as a cache hit
```

Call it as `embed(chunk, "<your-embedding-deployment>", "text-embedding-3-small", 1536)`; `text-embedding-ada-002` doesn't accept `dimensions`. When you re-chunk, unchanged chunks hit the cache and only new boundaries are embedded. At corpus scale I'd keep the cache alongside your source metadata rather than in local SQLite.

## The costs around the model

A few more line items belong to deployment choices, not single requests:

- **Deployment type premiums.** Data Zone and Regional Standard generally cost more per token than Global Standard for the same model. That's the price of data residency: pay it deliberately if the requirement is real, and question it if it's just a default.
- **Provisioned throughput bills by the hour.** PTUs are paid whether you send traffic or not. They pay off for steady, high-utilisation workloads, which I covered in [Azure OpenAI Provisioned Throughput Units](/blog/2024-02-11-azure-openai-ptu/). For spiky traffic, an idle PTU at 3am costs the same as a busy one at 10am.
- **Built-in tools.** Every Code Interpreter session is charged separately, and file search is billed on the vector storage you keep, whether you call them through the Assistants API, the Responses API or Foundry Agent Service. OpenAI has announced the Assistants API will be retired in August 2026, and Microsoft recommends Foundry Agent Service for new builds, so new builds should use Responses or Agent Service. Either way, orphaned threads, containers and vector stores accumulate quietly.
- **Logging.** Diagnostic logs sent to Log Analytics, or an API Management gateway logging full request and response bodies, are billed on ingestion.

## Measure tokens the way the bill does

Azure Cost Management tells you what a resource cost, not which feature or prompt caused it. Log the usage object on every call, including the parts that explain the bill:

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

The `except` branch matters because a billed 400 rejection returns no usage object. Tag each call with its feature, and within a week you'll know your cache hit rate, how much of your output spend is reasoning, and which feature re-sends the most history. Those three numbers explain most of the gap between estimate and invoice.

## Where I'd look first

If the bill is already higher than planned, check in this order: deployed fine-tuned models nobody is using (fastest money back), reasoning token share on high-volume features, cache hit rate on long prompts, and then history growth in chat flows. Retries are worth reviewing for correctness, but 429s aren't where the money goes.

If you're still estimating, multiply the naive number by turns per conversation, add hosting for anything fine-tuned, and treat reasoning models as producing about 1.3x to 2.6x the visible output (per Microsoft's own samples), more at high effort. Then check it against logged usage in your first week of real traffic.

When not to bother: if you're spending a few hundred dollars a month on a prototype, instrument it and move on. Engineering time spent shaving tokens costs more than the tokens. These costs matter once a workload is in production, has many users, or runs fine-tuned or reasoning models at volume.
