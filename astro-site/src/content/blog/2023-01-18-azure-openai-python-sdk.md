---
title: "Azure OpenAI from Python: Setting Up the openai 0.26 Library Properly"
description: "How to configure the openai 0.26 Python library for Azure OpenAI in January 2023: API keys or Azure AD tokens, deployment names, timeouts, retries and async."
author: Michael John Peña
draft: false
date: 2023-01-18
tags:
  - Azure OpenAI
  - OpenAI
  - Python
  - SDK
  - Azure AD
---

There is no Azure-branded Python SDK for Azure OpenAI Service. You use OpenAI's own `openai` package and switch it into Azure mode with a handful of module-level settings. That works, but the library's defaults suit someone experimenting in a notebook, not a service that has to survive throttling, token expiry and a hung connection. Get the configuration right once and every call after it is simple.

## Where things stand on 18 January 2023

Microsoft [announced general availability](https://azure.microsoft.com/en-us/blog/general-availability-of-azure-openai-service-expands-access-to-large-advanced-ai-models-with-added-enterprise-benefits/) of Azure OpenAI Service two days ago, on 16 January, and the [What's new page](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/whats-new) lists it under January 2023. GA doesn't mean open sign-up: you still apply for access, and once approved you create a resource, deploy a model to it, and call that deployment by name.

On the Python side, the current release is `openai` [0.26.1](https://pypi.org/project/openai/0.26.1/), published on 13 January. Azure support is built in. The library knows three API types (`open_ai`, `azure` and `azure_ad`). It only fills in the `2022-12-01` API version (the GA version of the REST API) when `OPENAI_API_TYPE` is set in the environment before import. If you configure it in code, `api_version` is required.

What you can call is narrower than on OpenAI's own API. For text, Azure OpenAI exposes completions and embeddings against GPT-3 and GPT-3.5 models (including `text-davinci-003`), Codex, and the embeddings models (DALL·E 2 is invite-only). There is no chat endpoint yet; Microsoft has said ChatGPT is coming soon. The `2022-12-01` API also covers fine-tunes, files and deployments (`openai.Deployment`), but I'll stick to inference here. I covered what that means for design in [Completion vs Chat APIs](/blog/2023-01-17-completion-vs-chat-apis/). Everything below targets `openai.Completion`, and the same patterns apply to `openai.Embedding`.

Pin the version. The library is moving quickly (0.26.0 shipped on 6 January), and a pre-1.0 package doesn't promise a stable surface:

```bash
pip install "openai==0.26.1" "azure-identity>=1.12.0"
```

## The three things Azure mode changes

If you've used the OpenAI API, three differences catch people out.

1. **The endpoint is yours.** `api_base` is your resource's endpoint, `https://<your-resource-name>.openai.azure.com/`, not `api.openai.com`.
2. **You address a deployment, not a model.** You pass `engine="<your-deployment-name>"` (or `deployment_id`, which the library treats the same way). The `model` parameter is ignored for routing. If you named your deployment after the model, it looks like it works by model name, but only until someone creates a second deployment of the same model.
3. **Authentication uses a different header.** With `api_type="azure"` the key goes in an `api-key` header. With `api_type="azure_ad"` the library sends `Authorization: Bearer <token>`, and the "key" you set is an Azure AD access token.

## Option 1: API keys

The quickest setup is a resource key from the portal:

```python
import os

import openai

openai.api_type = "azure"
openai.api_base = os.environ["AZURE_OPENAI_ENDPOINT"]  # https://<your-resource-name>.openai.azure.com/
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

response = openai.Completion.create(
    engine=os.environ["AZURE_OPENAI_DEPLOYMENT"],  # your deployment name
    prompt="Summarise in one sentence: Azure OpenAI is billed per 1,000 tokens.",
    max_tokens=60,
    temperature=0,
)
print(response["choices"][0]["text"].strip())
print(response["usage"])
```

Set `api_version` explicitly. If you configure the library in code, the call fails without it: `openai.error.InvalidRequestError: An API version is required for the Azure API type.` Even when the environment variable supplies a default, a new API version should be a decision you make in a pull request, not a side effect of upgrading the library.

Keys are fine for a prototype. For anything shared, I don't like them. A key grants full data-plane access to every deployment on the resource, it ends up copied into pipeline variables and laptops, and rotating it means coordinating every consumer. If you do use keys, keep them in Key Vault, use the two-key rotation the resource gives you, and don't hand the same key to more than one application.

## Option 2: Azure AD tokens

The better default for anything running in Azure is an Azure AD token from a managed identity, using `azure-identity`. Grant the identity a data-plane role on the resource (at the time of writing the documented role is Cognitive Services User, which covers inference) and request a token for the Cognitive Services scope. Microsoft Learn documents the setup in [How to configure Azure OpenAI with managed identities](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/managed-identity).

The catch is that `openai.api_key` is a plain string set once, and Azure AD access tokens expire (around an hour for a developer sign-in, longer for managed identities, and the lifetime isn't guaranteed). A long-running worker that sets the token at startup will start failing with `AuthenticationError` partway through the day. Refresh it before each call, with a margin:

```python
import os
import threading
import time

import openai
from azure.identity import DefaultAzureCredential

SCOPE = "https://cognitiveservices.azure.com/.default"
_credential = DefaultAzureCredential()
_token = None
_lock = threading.Lock()


def ensure_token() -> None:
    """Refresh the Azure AD token if it expires within five minutes."""
    global _token
    with _lock:
        if _token is None or _token.expires_on - time.time() < 300:
            _token = _credential.get_token(SCOPE)
            openai.api_key = _token.token


openai.api_type = "azure_ad"
openai.api_base = os.environ["AZURE_OPENAI_ENDPOINT"]
openai.api_version = "2022-12-01"

ensure_token()
response = openai.Completion.create(
    engine=os.environ["AZURE_OPENAI_DEPLOYMENT"],
    prompt="List three Azure regions in Australia:",
    max_tokens=40,
    temperature=0,
)
print(response["choices"][0]["text"].strip())
```

`DefaultAzureCredential` uses the managed identity in Azure and your `az login` session on a laptop, so the same code runs in both places. With this setup you can disable local (key) authentication on the resource and take keys out of the picture entirely.

Be aware that `ensure_token()` mutates the global `openai.api_key`. The lock stops two threads in one worker from refreshing at the same time, but if different callers use different credentials, don't share the global at all. On the async path (below), I'd keep the token in your own variable and pass `api_key=_token.token` and `api_type="azure_ad"` on each `acreate` call instead of mutating the module state from inside coroutines.

## When global configuration bites

Both options above rely on module-level state. That's fine for a single-resource app, but it breaks down as soon as one process talks to two Azure OpenAI resources (say, a second region for capacity) or mixes Azure and OpenAI. `create()` accepts `api_key`, `api_base`, `api_type` and `api_version` as per-call arguments, so in multi-resource code I pass them explicitly and never touch the globals:

```python
import os

import openai

response = openai.Completion.create(
    engine=os.environ["SECONDARY_DEPLOYMENT"],
    api_type="azure",
    api_base="https://<your-second-resource>.openai.azure.com/",
    api_version="2022-12-01",
    api_key=os.environ["SECONDARY_OPENAI_KEY"],
    prompt="Say hello from the second region.",
    max_tokens=20,
)
print(response["choices"][0]["text"].strip())
```

It's more verbose, but you can see where each request goes, and a second resource can't silently inherit the first one's key or API version.

## Timeouts, retries and content filtering

This is where the defaults hurt most. In 0.26.1 the synchronous client retries failed connections twice (the async client doesn't retry at all), but neither retries HTTP 429 or 5xx responses, and its default request timeout is 600 seconds. A busy deployment returns 429 when you exceed its rate limit, and a web request that waits ten minutes for a completion has already failed from the user's point of view.

The library also raises a content-filter rejection as `openai.error.InvalidRequestError` with `code == "content_filter"`. Retrying that is pointless: the same prompt gets the same answer. Your wrapper has to tell the cases apart:

```python
import os
import random
import time

import openai

openai.api_type = "azure"
openai.api_base = os.environ["AZURE_OPENAI_ENDPOINT"]
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]  # or call ensure_token() before each attempt

RETRYABLE = (
    openai.error.RateLimitError,
    openai.error.ServiceUnavailableError,
    openai.error.APIError,
    openai.error.APIConnectionError,
    openai.error.Timeout,
)


class PromptFiltered(Exception):
    """The prompt was rejected by the Azure OpenAI content filter."""


def complete(prompt: str, max_tokens: int = 256, attempts: int = 4) -> str:
    for attempt in range(1, attempts + 1):
        try:
            response = openai.Completion.create(
                engine=os.environ["AZURE_OPENAI_DEPLOYMENT"],
                prompt=prompt,
                max_tokens=max_tokens,
                temperature=0.2,
                request_timeout=30,  # seconds; the library default is 600
            )
            return response["choices"][0]["text"].strip()
        except openai.error.InvalidRequestError as err:
            if err.code == "content_filter":
                raise PromptFiltered(str(err)) from err
            raise  # a bad request won't get better on retry
        except RETRYABLE as err:
            if isinstance(err, openai.error.APIError) and (err.http_status or 500) < 500:
                raise  # APIError also covers unexpected 4xx; only retry server errors
            if attempt == attempts:
                raise
            retry_after = (err.headers or {}).get("retry-after")
            delay = float(retry_after) if retry_after else min(2 ** attempt, 20)
            time.sleep(delay + random.uniform(0, 1))
    raise RuntimeError("unreachable")


if __name__ == "__main__":
    print(complete("Write a one-line description of Azure Key Vault:"))
```

Three choices in there are deliberate. The timeout is short, so a stuck call fails fast and gets retried instead of holding a worker. The backoff honours a `Retry-After` header when the service sends one and falls back to capped exponential delay with jitter when it doesn't. And `AuthenticationError` and `PermissionError` aren't in the retry list, because retrying a wrong key or a missing role assignment only delays the alert. `APIError` needs the extra status check because 0.26.1 raises it for any status it doesn't map elsewhere, including odd 4xx codes, not just 5xx. One case you don't need to handle: `Completion.create` already loops on HTTP 409 (`TryAgain`, the "model is warming up" response) internally, with no limit unless you pass a `timeout` argument. Note that the loop has no delay, so if you see `TryAgain` in logs, pass `timeout=` to bound it. I've gone deeper on [pacing requests per deployment](/blog/2023-01-10-rate-limiting-azure-openai/) and [handling filtered prompts and completions](/blog/2023-01-09-content-filtering-azure-openai/) in earlier posts.

Also check `finish_reason` on each choice: `"length"` means you hit `max_tokens` and the text is truncated, and `"content_filter"` means the output was filtered. Neither raises an exception, so both are easy to miss when you only read `text`.

The example uses a key so it runs on its own. With the Azure AD setup from Option 2, set `openai.api_type = "azure_ad"`, drop the `api_key` line, and call `ensure_token()` as the first line inside the `try` block so every attempt has a fresh token.

## Async: `acreate` and a concurrency cap

Version 0.26.1 also ships async variants (`openai.Completion.acreate`, `openai.Embedding.acreate`) on top of `aiohttp`, which it installs as a dependency. Use them in an async web framework or a batch job. Don't fire hundreds of calls with an unbounded `gather`: you'll hit the deployment's rate limit almost at once and spend the run in backoff. A semaphore keeps you under it:

```python
import asyncio
import os

import openai

openai.api_type = "azure"
openai.api_base = os.environ["AZURE_OPENAI_ENDPOINT"]
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

DEPLOYMENT = os.environ["AZURE_OPENAI_DEPLOYMENT"]


async def classify(ticket: str, limit: asyncio.Semaphore) -> str:
    async with limit:
        response = await openai.Completion.acreate(
            engine=DEPLOYMENT,
            prompt=f"Classify this support ticket as billing, outage or other.\n\nTicket: {ticket}\nCategory:",
            max_tokens=5,
            temperature=0,
            request_timeout=30,
        )
        return response["choices"][0]["text"].strip()


async def main() -> None:
    tickets = [
        "I was charged twice this month.",
        "The portal has been down since 9am.",
        "How do I change my email address?",
    ]
    limit = asyncio.Semaphore(4)  # tune to your deployment's rate limit
    results = await asyncio.gather(*(classify(t, limit) for t in tickets))
    for ticket, category in zip(tickets, results):
        print(f"{category:<8} {ticket}")


asyncio.run(main())
```

The retry wrapper from the previous section ports directly: swap `time.sleep` for `await asyncio.sleep`. Each `acreate` call opens its own `aiohttp` session by default, which is fine at this scale. If you're pushing high volume, create one `aiohttp.ClientSession`, register it with `openai.aiosession.set(session)`, and close it when you're done.

## When not to use the library

The `openai` package is the right choice for most Python work on Azure OpenAI today, but not every time:

| Situation | What I'd use |
|---|---|
| Python app or notebook calling completions or embeddings | `openai` 0.26.x, pinned, with the wrapper above |
| One process calling several resources or providers | `openai` with per-call settings, as shown earlier |
| A runtime where you can't take the dependency, or you need full control of the HTTP client | Plain REST with `requests` or `httpx` against the [REST API reference](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/reference), covered in my [REST API post](/blog/2023-01-21-azure-openai-rest-api/) |
| Deploying models or managing the resource | The library can create deployments (`openai.Deployment`), but I'd keep that in Bicep or the CLI so it is versioned with the rest of the resource |

The library's Azure support is solid, but its global configuration and pre-1.0 versioning mean you should expect breaking changes in minor releases. Keep all your Azure OpenAI calls behind one small module of your own. When the library changes, you update that module, not every call site.

## What I'd set up on day one

Pin `openai==0.26.1` and `api_version="2022-12-01"`. Use Azure AD tokens with a refresh check rather than keys. Set a `request_timeout` on every call. Retry 429s and 5xx with backoff, and never retry content-filter rejections. Cap concurrency on the async path. That's around fifty lines of code, and it's the difference between a demo that works and a service that keeps working when the deployment is busy.
