---
title: "Calling Azure OpenAI over Plain HTTP: The 2022-12-01 REST Contract"
description: "What the GA 2022-12-01 Azure OpenAI REST API looks like on the wire: URLs, auth headers, completions, embeddings, errors and when to skip the SDK."
author: Michael John Peña
draft: false
date: 2023-01-21
tags:
  - Azure OpenAI
  - OpenAI
  - REST API
  - Python
  - Azure AD
---

Most Azure OpenAI examples start with `pip install openai`. That's fine if your service is written in Python, but plenty of the systems that need a completion aren't: a Java integration layer, a Go worker, a Logic App, an API Management policy, a PowerShell runbook. For those, the honest client is HTTP, and knowing the wire contract also makes you better at debugging the SDK when it misbehaves.

This week Azure OpenAI Service [reached general availability](https://azure.microsoft.com/en-us/blog/general-availability-of-azure-openai-service-expands-access-to-large-advanced-ai-models-with-added-enterprise-benefits/), and with it the data-plane API has a GA version: `2022-12-01`.

## What the API covers on 21 January 2023

Keep expectations narrow. The `2022-12-01` API exposes two inference operations:

| Operation | Path | Typical deployment |
|---|---|---|
| Completions | `/openai/deployments/{deployment-id}/completions` | `text-davinci-003`, `text-davinci-002`, Curie, Babbage, Ada, Codex |
| Embeddings | `/openai/deployments/{deployment-id}/embeddings` | `text-embedding-ada-002` and the older similarity/search models |

There is no chat endpoint. ChatGPT has been announced as "coming soon" to the service, but until it lands, a conversational experience is a completions prompt you assemble yourself, as covered in [Completions Now, Chat Later](/blog/2023-01-17-completion-vs-chat-apis/). There is no image-generation operation in this API version either, whatever you read about DALL-E 2 in the GA announcement.

Every call follows the same shape:

```text
POST https://<your-resource-name>.openai.azure.com/openai/deployments/<your-deployment-name>/completions?api-version=2022-12-01
```

Three parts of that URL deserve attention.

- **The host is your resource.** Each Azure OpenAI resource gets its own subdomain. There's no shared global endpoint, so a second region means a second base URL in your configuration.
- **You address a deployment, not a model.** You choose the deployment name when you deploy a model to the resource. The model name never appears in the URL, which means you can delete the deployment and recreate it with a different model under the same name, and callers don't change.
- **`api-version` is mandatory.** Leave it off and the request fails. I treat it as a configuration value, not a constant buried in code, because the next version will arrive and the upgrade should be a deliberate change.

The [Azure OpenAI REST API reference](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference) documents each operation and links to the Swagger definition for `2022-12-01`, which is the document I'd generate a typed client from if your language has a decent OpenAPI generator.

## Authentication: two headers, one recommendation

The API accepts two credentials.

**API keys** go in an `api-key` header. Note the header name: it's not `Authorization`, and it's not OpenAI's `Bearer sk-...` format. Copying an OpenAI example and changing only the URL produces a 401.

```bash
curl -sS "https://<your-resource-name>.openai.azure.com/openai/deployments/<your-deployment-name>/completions?api-version=2022-12-01" \
  -H "Content-Type: application/json" \
  -H "api-key: $AZURE_OPENAI_KEY" \
  -d '{
    "prompt": "Write a one-line description of Azure Key Vault:",
    "max_tokens": 40,
    "temperature": 0
  }'
```

**Azure AD tokens** go in a standard `Authorization: Bearer <token>` header. The token is requested for the Cognitive Services scope, `https://cognitiveservices.azure.com/.default`, and the calling identity needs a data-plane role on the resource such as Cognitive Services User. Note that this role can also list the resource's keys, so scope it to the resource and audit who holds it. With the Azure CLI you can test it in two lines:

```bash
TOKEN=$(az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv)

curl -sS "https://<your-resource-name>.openai.azure.com/openai/deployments/<your-deployment-name>/completions?api-version=2022-12-01" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"prompt": "Say hello in French:", "max_tokens": 10}'
```

My recommendation is the same as for any Azure data-plane service: keys for a first test, Azure AD with a managed identity for anything shared. A key grants full access to every deployment on the resource and tends to end up in pipeline variables and laptops. Microsoft Learn walks through the role assignments in [configuring Azure OpenAI with managed identities](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/managed-identity). Once every caller uses tokens, you can disable local authentication on the resource. The trade-off is that you now own token caching and refresh, because an access token expires after roughly an hour. The client below handles that.

## Completions: the request that matters

The completions body is close to OpenAI's own API, minus the `model` field doing any routing. The parameters I use routinely:

| Parameter | What it does | My default |
|---|---|---|
| `prompt` | The text to complete; a string or an array of strings | Always a string, built by one function |
| `max_tokens` | Cap on generated tokens; the default is only 16 | Always set explicitly |
| `temperature` / `top_p` | Sampling randomness; change one, not both | `temperature` 0 to 0.3 for extraction |
| `stop` | Up to four sequences that end generation | Set whenever the prompt has a structure |
| `n` / `best_of` | Multiple candidates per request | Avoid; each multiplies token cost |
| `stream` | Return tokens as server-sent events | Only for interactive UIs |
| `user` | An identifier for the end user | Set it; it helps abuse investigations |

The `max_tokens` default of 16 catches everyone once. A request that "works" but returns half a sentence with `"finish_reason": "length"` is almost always this. I covered budgeting in [Counting and Capping Tokens](/blog/2023-01-11-token-management-azure-openai/), and the sampling parameters in [Temperature and Top-P](/blog/2023-01-16-temperature-top-p-parameters/).

The response returns `choices[].text`, a `finish_reason` per choice, and a `usage` block with `prompt_tokens`, `completion_tokens` and `total_tokens`. Log `usage` on every call. It's the only per-request cost signal you get, and you can't reconstruct it later from the Azure bill.

Setting `"stream": true` changes the response to `text/event-stream`: a series of `data: {...}` lines, each carrying a fragment in `choices[0].text`, terminated by `data: [DONE]`. If you consume it, parse each `data:` line until `data: [DONE]`, and keep a non-streaming fallback for callers that can't handle partial output.

## Embeddings: one input per call

The embeddings operation takes an `input` and returns `data[0].embedding`, a list of floats (1,536 of them for `text-embedding-ada-002`). The trap here is batching. OpenAI's own API accepts an array of inputs per request; in Azure OpenAI, plan on sending one input per request for now. That turns a bulk indexing job into a lot of calls against the resource's per-model request limit, which is why the [throttling post](/blog/2023-01-10-rate-limiting-azure-openai/) matters more for embeddings than for completions. Store each vector alongside the source text it came from, and compare vectors with cosine similarity.

## A small client that handles the real failure modes

Here is a complete Python client using `requests` and `azure-identity`, no `openai` package. It caches the Azure AD token, sets a timeout, retries what is worth retrying and refuses to retry what isn't. Install it with `pip install "requests>=2.28" "azure-identity>=1.12.0"`.

```python
import os
import random
import time

import requests
from azure.identity import DefaultAzureCredential

API_VERSION = "2022-12-01"
SCOPE = "https://cognitiveservices.azure.com/.default"
RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class ContentFiltered(Exception):
    """The request was rejected by the Azure OpenAI content filter."""


class AzureOpenAIRest:
    def __init__(self, endpoint: str, timeout: float = 30.0, max_attempts: int = 4):
        self.endpoint = endpoint.rstrip("/")
        self.timeout = timeout
        self.max_attempts = max_attempts
        self.credential = DefaultAzureCredential()
        self.session = requests.Session()
        self._token = None

    def _auth_header(self) -> dict:
        # Refresh the Azure AD token when it is within five minutes of expiry.
        if self._token is None or self._token.expires_on - time.time() < 300:
            self._token = self.credential.get_token(SCOPE)
        return {"Authorization": f"Bearer {self._token.token}"}

    def _post(self, deployment: str, operation: str, body: dict) -> dict:
        url = f"{self.endpoint}/openai/deployments/{deployment}/{operation}"
        for attempt in range(1, self.max_attempts + 1):
            try:
                response = self.session.post(
                    url,
                    params={"api-version": API_VERSION},
                    headers=self._auth_header(),
                    json=body,
                    timeout=self.timeout,
                )
            except (requests.ConnectionError, requests.Timeout):
                if attempt == self.max_attempts:
                    raise
                time.sleep(min(2 ** attempt, 20) + random.random())
                continue

            if response.ok:
                return response.json()

            try:
                error = response.json().get("error", {})
            except ValueError:
                error = {}
            if response.status_code == 400 and error.get("code") == "content_filter":
                raise ContentFiltered(error.get("message", "Filtered"))
            if response.status_code in RETRYABLE_STATUS and attempt < self.max_attempts:
                retry_after = response.headers.get("Retry-After", "")
                # Cap Retry-After so one large value can't stall a worker indefinitely.
                delay = min(float(retry_after), 60) if retry_after.isdigit() else min(2 ** attempt, 20)
                time.sleep(delay + random.random())
                continue
            # Any non-2xx status that isn't retried raises here, so the loop never falls through.
            response.raise_for_status()

    def complete(self, deployment: str, prompt: str, **params) -> dict:
        body = {"prompt": prompt, "max_tokens": 256, "temperature": 0.2, **params}
        return self._post(deployment, "completions", body)

    def embed(self, deployment: str, text: str) -> list:
        result = self._post(deployment, "embeddings", {"input": text})
        return result["data"][0]["embedding"]


if __name__ == "__main__":
    client = AzureOpenAIRest(os.environ["AZURE_OPENAI_ENDPOINT"])

    result = client.complete(
        os.environ["AZURE_OPENAI_COMPLETIONS_DEPLOYMENT"],
        "Summarise in one sentence: Azure OpenAI bills per 1,000 tokens.\n\nSummary:",
        max_tokens=60,
        stop=["\n\n"],
    )
    print(result["choices"][0]["text"].strip())
    print(result["usage"])

    vector = client.embed(os.environ["AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT"], "Azure Key Vault")
    print(len(vector), "dimensions")
```

A few decisions in there are worth explaining.

**The content filter is a 400, not a 5xx.** When a prompt trips the filter, the service returns HTTP 400 with `"code": "content_filter"` in the error body. Retrying sends the same prompt and gets the same answer, so the client raises a distinct exception your application can turn into a sensible message. The [content filtering post](/blog/2023-01-09-content-filtering-azure-openai/) covers the other case, where the *completion* is filtered and the choice comes back with `"finish_reason": "content_filter"` instead of `stop` or `length`.

**Backoff has jitter and honours `Retry-After`.** Fixed sleeps make parallel workers retry in lockstep and get throttled again together. If the service tells you how long to wait, use it, but cap it at 60 seconds so one oversized value can't park a worker. The reasoning is in the Azure Architecture Center's [Retry pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/retry).

**The timeout is short.** A completion request with no timeout can hang far longer than any user will wait. Thirty seconds is generous for a few hundred tokens from Davinci; tune it to your `max_tokens`.

**Other 4xx errors fail fast.** A 401, 404 (usually a wrong deployment name) or a 400 for an invalid parameter won't fix itself on retry, and retrying hides the bug.

## When I wouldn't go SDK-free

Raw HTTP isn't automatically the better engineering choice.

- **If you're already in Python, use the library.** `openai` 0.26 handles Azure mode, request formatting and error types, and [the openai 0.26 setup post](/blog/2023-01-18-azure-openai-python-sdk/) walks through it. Writing your own client to avoid one dependency is a poor trade.
- **If you need many operations,** generate a client from the Swagger file rather than hand-writing one per language. Hand-written clients drift.
- **If several services call the same deployment,** the retry and pacing logic belongs in one place. I'd put Azure API Management in front of the resource so that throttling, keys and logging are handled once, rather than re-implementing this client in four languages.

Where plain HTTP earns its place is in the gaps: languages without a maintained client, low-code tools with an HTTP action, gateways and policies, and debugging. Even if you never ship a hand-written client, being able to reproduce a failing SDK call with `curl` and an explicit `api-version` will save you an afternoon.

## The short version

Pin `api-version=2022-12-01`, address deployments rather than models, authenticate with Azure AD tokens and cache them, always set `max_tokens`, log `usage`, and treat a `content_filter` 400 differently from a 429. Build to completions and embeddings only, because those are the only inference operations the GA API offers today, and keep prompt construction behind one function so the chat model can slot in when it arrives.
