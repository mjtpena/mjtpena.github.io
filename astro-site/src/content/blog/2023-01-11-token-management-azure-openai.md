---
title: "Counting and Capping Tokens in the Azure OpenAI Preview"
description: "How to count tokens with tiktoken, size max_tokens, log real usage and cap spend for Azure OpenAI completion models in the January 2023 preview."
author: Michael John Peña
draft: false
date: 2023-01-11
tags:
  - Azure OpenAI
  - Token Management
  - Cost Optimization
  - Python
---

Every Azure OpenAI call is measured in tokens, and the token count decides three things: whether the request fits the model at all, how long it takes, and what it costs. The mistake I see most often in proofs of concept is counting nothing until the first invoice arrives or a long document fails with a context-length error. Both problems are cheap to prevent if you count tokens before the request goes out and record what came back. Azure OpenAI is still a limited-access preview with no chat API, so everything here uses the Completions API and the `openai` Python library.

## A token is not a word, and the model decides how it's split

Models read text as tokens: chunks produced by a byte-pair encoding. OpenAI's own rule of thumb is that one token is roughly four characters of common English, or about three quarters of a word. That's fine for a back-of-envelope estimate. It's not fine for deciding whether a 3,900-token prompt fits, because the ratio moves a lot with content. Code, JSON, URLs, numbers and non-English text all produce more tokens per character than plain prose.

The split also depends on the model family. The GPT-3 models (`text-curie-001`, `text-babbage-001`, `text-ada-001`) use one encoding, and the GPT-3.5 and Codex models use another that adds tokens for runs of whitespace, which matters for indented code. Counting a prompt with the wrong encoding gives you a number that looks precise and isn't.

OpenAI released [`tiktoken`](https://github.com/openai/tiktoken) in December, and it's the tool I'd use for this. Version 0.1.2 (3 January) ships the encodings by name. It has no lookup from model name to encoding yet, so you pick the encoding yourself:

| Model on Azure OpenAI | Encoding | Max tokens per request (prompt + completion) | Price per 1K tokens |
|---|---|---|---|
| `text-davinci-002` | `p50k_base` | 4,097 | $0.02 |
| `text-curie-001` | `r50k_base` | 2,049 | $0.002 |
| `text-babbage-001` | `r50k_base` | 2,049 | $0.0005 |
| `text-ada-001` | `r50k_base` | 2,049 | $0.0004 |

OpenAI publishes these limits in its [model index for researchers](https://platform.openai.com/docs/model-index-for-researchers) for the same model versions, and Azure serves them unchanged. (All of these models have since been retired; Microsoft Learn's [retired models page](https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/legacy-models) records the dates.) The Codex models are in the preview too and also use `p50k_base`: `code-davinci-002` allows 8,001 tokens per request and `code-cushman-001` allows 2,048. The prices are the Azure preview pay-as-you-go rates. Check the [pricing page](https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/) before you quote them to anyone, because preview pricing is not a commitment. `text-davinci-003` is not in every Azure OpenAI region or subscription yet, so check the Models list in Azure OpenAI Studio for your resource; I covered how to design for its arrival in [GPT-3.5 on Azure OpenAI](/blog/2023-01-02-gpt-35-on-azure/).

## The limit covers the prompt and the answer together

The number that catches people out is that the context limit is shared. A `text-davinci-002` request with a 3,900-token prompt has 197 tokens left for the completion, and if you ask for `max_tokens=500` the service rejects the whole request rather than giving you a shorter answer. Without a token check, a feature that works in every demo returns HTTP 400 the first time someone pastes in a long contract.

So the job before each call is:

1. Count the fixed parts of the prompt: instructions, few-shot examples, output format.
2. Decide how many tokens the answer genuinely needs and reserve them.
3. Give whatever is left to the variable input, and truncate or split that input when it doesn't fit.

Here's a complete version of that for `tiktoken` 0.1.2:

```python
import tiktoken

# model: (encoding, max tokens for prompt + completion)
MODELS = {
    "text-davinci-002": ("p50k_base", 4097),
    "code-davinci-002": ("p50k_base", 8001),
    "text-curie-001": ("r50k_base", 2049),
}


def count_tokens(model: str, text: str) -> int:
    encoding = tiktoken.get_encoding(MODELS[model][0])
    # encode_ordinary treats "<|endoftext|>" in user text as plain text instead of raising.
    return len(encoding.encode_ordinary(text))


def fit_prompt(model: str, template: str, document: str, reserve_for_answer: int) -> str:
    """Fill {document} in the template, truncating the document so the answer still fits."""
    encoding_name, limit = MODELS[model]
    encoding = tiktoken.get_encoding(encoding_name)

    fixed = count_tokens(model, template.replace("{document}", ""))
    # Keep 8 tokens spare: re-encoding the joined string can merge or split tokens at the
    # joins, and decoding a cut token list can leave a partial character.
    available = limit - fixed - reserve_for_answer - 8
    if available <= 0:
        raise ValueError(f"{model}: template and answer reservation leave no room for the document")

    doc_tokens = encoding.encode_ordinary(document)
    if len(doc_tokens) > available:
        document = encoding.decode(doc_tokens[:available], errors="replace")
    prompt = template.replace("{document}", document)

    # Re-count the final prompt and trim further in the rare case it still doesn't fit.
    budget = limit - reserve_for_answer
    while count_tokens(model, prompt) > budget and document:
        doc_tokens = encoding.encode_ordinary(document)
        document = encoding.decode(doc_tokens[:-8], errors="replace")
        prompt = template.replace("{document}", document)
    return prompt


if __name__ == "__main__":
    template = (
        "Summarise the incident report below in three bullet points "
        "for an executive audience.\n\nReport:\n{document}\n\nSummary:\n"
    )
    report = "The storage account in Australia East returned errors for 40 minutes. " * 400

    for model in MODELS:
        prompt = fit_prompt(model, template, report, reserve_for_answer=300)
        print(f"{model}: prompt is {count_tokens(model, prompt)} tokens, 300 reserved for the answer")
```

Two choices in there are deliberate. I reserve answer tokens first and let the document absorb the squeeze, because a truncated input still produces a useful summary while a truncated answer usually doesn't. And I truncate from the end, which is right for reports that front-load the important part and wrong for, say, email threads where the latest reply is at the bottom. If the input is much larger than the window, stop truncating and split it into chunks with a summary per chunk. That's a different design, and it's where costs multiply quickly.

## What you're actually billed for

Azure bills completion models per 1,000 tokens, with prompt and completion tokens charged at the same rate for a given model. A few consequences are worth stating plainly:

- **You pay for tokens generated, not for `max_tokens`.** A generous `max_tokens` doesn't cost money by itself, but it does let a rambling answer cost money. A `stop` sequence and a tight `max_tokens` are the cheapest controls you have.
- **The prompt is usually the bigger half.** Long instructions and five few-shot examples are sent on every single call. Shaving 500 tokens off a template saves more than any amount of fiddling with the answer length.
- **`n` and `best_of` multiply the completion side.** `best_of=5` generates five completions on the server and bills for all of them, even though you receive one.
- **`echo=True` returns your prompt in the response.** Useful for debugging, wasteful in production.
- **Codex is not free on Azure.** OpenAI's Codex models are a free beta on its own API, but on Azure `code-davinci-002` and `code-cushman-001` are billed like everything else, and at a higher rate than the Davinci text models. Cost code-heavy workloads separately rather than assuming they cost what `text-davinci-002` does.

On the throttling side, the quotas page at the time listed limits as requests per second per deployment (20 for the Davinci and Codex models, 50 for the rest), not tokens. A huge prompt doesn't use up more of your rate limit than a tiny one; it just costs more and responds more slowly. I went through those limits and how to pace against them in [Throttling in the Azure OpenAI Preview](/blog/2023-01-10-rate-limiting-azure-openai/).

To make the numbers concrete: a summarisation call with a 2,000-token prompt and a 300-token answer is 2,300 tokens. On a Davinci model that's about $0.046 per call, or $460 a day at 10,000 calls. The same call on Curie is about $46 a day, if Curie can do the job and the input fits its 2,049-token window, which this one doesn't. Model choice and prompt length are the two levers that move the bill by an order of magnitude.

## Record what the service says you used

Client-side counts are for planning. For accounting, use what the service returns. A non-streaming completion response from API version `2022-12-01` includes a `usage` block with `prompt_tokens`, `completion_tokens` and `total_tokens`. Log it on every call, with enough context to answer "which feature spent this?".

This uses `openai` 0.26.0, released on 6 January, and enforces a simple daily cap per feature from a local ledger:

```python
import json
import os
from datetime import datetime, timezone

import openai

openai.api_type = "azure"
openai.api_base = os.environ["AZURE_OPENAI_ENDPOINT"]  # https://<your-resource-name>.openai.azure.com/
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

# Deployment name -> model it serves, so the price always matches the deployment called.
DEPLOYMENTS = {
    "<your-davinci-002-deployment>": "text-davinci-002",
    "<your-curie-001-deployment>": "text-curie-001",
}
PRICE_PER_1K = {"text-davinci-002": 0.02, "text-curie-001": 0.002}
DAILY_CAP_USD = {"summarise": 25.0, "classify": 5.0}
LEDGER = "token-ledger.jsonl"


class BudgetExceeded(Exception):
    pass


def spent_today(feature: str) -> float:
    today = datetime.now(timezone.utc).date().isoformat()
    total = 0.0
    if not os.path.exists(LEDGER):
        return total
    with open(LEDGER) as f:
        for line in f:
            entry = json.loads(line)
            if entry["feature"] == feature and entry["timestamp"].startswith(today):
                total += entry["cost_usd"]
    return total


def complete(feature: str, deployment: str, prompt: str, max_tokens: int) -> str:
    model = DEPLOYMENTS[deployment]
    if spent_today(feature) >= DAILY_CAP_USD[feature]:
        raise BudgetExceeded(f"{feature} has reached its daily cap of ${DAILY_CAP_USD[feature]}")

    response = openai.Completion.create(
        engine=deployment,
        prompt=prompt,
        max_tokens=max_tokens,
        temperature=0.2,
        stop=["\n\n\n"],
    )
    usage = response["usage"]
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "feature": feature,
        "deployment": deployment,
        "model": model,
        "prompt_tokens": usage["prompt_tokens"],
        "completion_tokens": usage["completion_tokens"],
        "cost_usd": usage["total_tokens"] / 1000 * PRICE_PER_1K[model],
    }
    with open(LEDGER, "a") as f:
        f.write(json.dumps(entry) + "\n")
    return response["choices"][0]["text"].strip()


if __name__ == "__main__":
    answer = complete(
        feature="classify",
        deployment="<your-davinci-002-deployment>",
        prompt="Classify the ticket as Billing, Technical or Account.\n\n"
        "Ticket: I was charged twice in December.\nCategory:",
        max_tokens=5,
    )
    print(answer)
```

Mapping each deployment to its model in one place means a call can't be priced against the wrong model, which is easy to do once you have several deployments with names you chose yourself. The JSON-lines file is a stand-in, and rescanning it on every call is for illustration only. In a real service, send the same fields to Application Insights or a table you can query, and keep the cap check in shared storage so every instance sees the same total. Be clear that this cap is soft by one call: the check happens before the request, so the last call of the day can push spend past the cap, and two instances can pass the check at the same moment. A hard cap needs an estimate of (prompt tokens + `max_tokens`) × price checked before the call, with an atomic increment in shared storage. The fields are what matter: feature, deployment, prompt tokens, completion tokens, cost.

One gap to know about: when you stream with `stream=True`, the chunks don't include a `usage` block. If you stream, count the prompt with `tiktoken` before sending and count the assembled completion text afterwards. That gives you a close figure, and the invoice remains the source of truth.

## Budgets in Azure are alerts, not brakes

Azure Cost Management lets you [create a budget](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets) on the subscription or resource group that holds the Azure OpenAI resource, with email alerts at thresholds such as 50%, 80% and 100%. Do it. Put Azure OpenAI in its own resource group so the budget isn't diluted by everything else.

But understand what it is. Cost data arrives with a delay of hours, and a budget alert doesn't stop anything. A runaway batch job can spend a day's worth of money before anyone reads the email. That's why I put the cap in the application, per feature, where it's checked before the call. The Azure budget is the backstop that catches what the application didn't anticipate.

## What I wouldn't bother with

There's a style of "prompt optimisation" that rewrites prompts mechanically: swapping "for example" for "e.g.", stripping "please", collapsing whitespace. The savings are a handful of tokens, and you risk changing the meaning of a carefully tested prompt. Edit prompts by hand, test the shorter version against the same examples, and measure the change with `tiktoken`.

I also wouldn't build a ledger and caps for a prototype that a few people call a few hundred times. Count tokens so requests don't fail, log `usage` so you know what a call costs, and stop there. The caps earn their keep once a feature is exposed to users or a scheduled job, because that's when spend stops being proportional to how much someone is paying attention.

## The short version

Count tokens with the right encoding before every request, reserve the answer's tokens first, and truncate or split the input to fit. Log the `usage` block from every response against a feature name. Cap spend in the application and use an Azure budget as the safety net, not the control. And remember that the biggest savings come from choosing a smaller model for narrow tasks and trimming the fixed part of the prompt, not from clever compression.
