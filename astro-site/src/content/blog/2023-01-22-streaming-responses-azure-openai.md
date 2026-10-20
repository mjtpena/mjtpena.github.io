---
title: "Streaming Azure OpenAI Completions from the API to the Browser"
description: "How stream=True works on the Azure OpenAI 2022-12-01 Completions API, what you give up by streaming, and how to relay tokens to a browser without losing any."
author: Michael John Peña
draft: false
date: 2023-01-22
tags:
  - Azure OpenAI
  - OpenAI
  - Python
  - Streaming
  - UX
---

A 400-token answer from `text-davinci-003` takes long enough that a blank screen feels broken. Streaming fixes the perception: the first words appear quickly and the rest arrive as they are generated. It also changes your error handling, your cost accounting and your content checks, and most of the streaming examples I see only cover the happy path between the model and a `print` statement.

## What you can stream on 22 January 2023

Azure OpenAI Service [became generally available](https://azure.microsoft.com/en-us/blog/general-availability-of-azure-openai-service-expands-access-to-large-advanced-ai-models-with-added-enterprise-benefits/) six days ago, and the GA REST API version is `2022-12-01`. Its inference operations are Completions and Embeddings. There's no chat endpoint yet, so everything here streams a Completions call against a GPT-3 family deployment such as `text-davinci-003`. If you're building a conversational UI, you assemble the transcript into a prompt yourself, as described in [ChatGPT-Style Chat on Azure OpenAI Without a Chat API](/blog/2023-01-05-chatgpt-integration-patterns/).

Streaming is a single request parameter. Set `"stream": true` and the response changes from one JSON document to `text/event-stream`: data-only server-sent events, each carrying a fragment of the completion, terminated by `data: [DONE]`. The [Azure OpenAI REST API reference](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference) documents the parameter alongside the rest of the Completions body, and I covered the surrounding contract in [Calling Azure OpenAI over Plain HTTP](/blog/2023-01-21-azure-openai-rest-api/).

## What arrives on the wire

Each event is a small completion object. The shape looks like this (identifiers shortened):

```text
data: {"id":"cmpl-6abc","object":"text_completion","created":1674345600,"model":"text-davinci-003","choices":[{"text":" Azure","index":0,"logprobs":null,"finish_reason":null}]}

data: {"id":"cmpl-6abc","object":"text_completion","created":1674345600,"model":"text-davinci-003","choices":[{"text":" Key","index":0,"logprobs":null,"finish_reason":null}]}

data: {"id":"cmpl-6abc","object":"text_completion","created":1674345600,"model":"text-davinci-003","choices":[{"text":"","index":0,"logprobs":null,"finish_reason":"stop"}]}

data: [DONE]
```

Three things to notice.

- **The fragment is in `choices[0].text`.** A fragment is usually one token, but don't rely on that. Treat it as an arbitrary string and concatenate. If you ask for `n` greater than 1, chunks for different choices interleave and you have to route each one by its `index`; the code below pins `n=1` so `choices[0]` is always the right one.
- **`finish_reason` arrives once, near the end.** It's `null` on every event until the generation for that choice stops. `stop` means a natural end or a stop sequence, `length` means you hit `max_tokens`, and `content_filter` means the output filter cut it off.
- **There's no `usage` block.** A non-streaming response tells you `prompt_tokens` and `completion_tokens`. A streamed one doesn't, so if you stream, cost accounting becomes your job.

## What streaming costs you

Streaming is a UX feature, not a performance one. Total generation time is roughly the same, and you take on real constraints in exchange for an earlier first token.

| Concern | Non-streaming | Streaming |
|---|---|---|
| Token usage | Returned in `usage` | Count it yourself with `tiktoken` |
| `best_of` | Supported | Not supported; [results can't be streamed](https://platform.openai.com/docs/api-reference/completions/create) |
| Output content filter | You see `finish_reason` before the user sees anything | The user may have read part of the answer before `content_filter` arrives |
| Retries | Retry the whole call | A failure mid-stream leaves a partial answer on screen |
| Post-processing (PII scan, JSON validation) | Run it before display | Only possible after the stream ends, which defeats the point |
| Infrastructure | Any proxy works | Every hop must pass chunks through unbuffered |

The content filter row is the one I'd think hardest about. As covered in [Handling Content Filtering](/blog/2023-01-09-content-filtering-azure-openai/), a filtered output is signalled per choice through `finish_reason`. When you stream, that signal arrives after text that is already on the screen. Your UI needs a way to retract or replace a response, and if your product can't tolerate showing a partial answer that later gets withdrawn, don't stream for that feature.

## Consuming the stream in Python

With `openai` 0.26.1 in Azure mode (configuration covered in [the Python setup post](/blog/2023-01-18-azure-openai-python-sdk/)), `stream=True` turns `Completion.create` into an iterator of chunk objects. The wrapper below yields text as it arrives and records what the stream didn't tell you: time to first token, the finish reason, and a token count from `tiktoken` 0.1.2 using `p50k_base`, the encoding for `text-davinci-003`.

```python
import os
import time
from dataclasses import dataclass
from typing import Iterator, Optional

import openai
import tiktoken

openai.api_type = "azure"
openai.api_base = os.environ["AZURE_OPENAI_ENDPOINT"]  # https://<your-resource-name>.openai.azure.com/
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

ENCODING = tiktoken.get_encoding("p50k_base")  # text-davinci-003


@dataclass
class StreamStats:
    text: str = ""
    finish_reason: Optional[str] = None
    first_token_seconds: Optional[float] = None
    total_seconds: float = 0.0
    prompt_tokens: int = 0
    completion_tokens: int = 0


def stream_completion(
    prompt: str, deployment: str, stats: StreamStats, max_tokens: int = 400
) -> Iterator[str]:
    started = time.monotonic()
    stats.prompt_tokens = len(ENCODING.encode(prompt))
    parts = []
    response = openai.Completion.create(
        engine=deployment,
        prompt=prompt,
        max_tokens=max_tokens,
        n=1,  # one choice, so choices[0] is the only stream
        temperature=0.3,
        stream=True,
        request_timeout=30,
    )
    try:
        for chunk in response:
            choice = chunk["choices"][0]
            text = choice.get("text") or ""
            if text:
                if stats.first_token_seconds is None:
                    stats.first_token_seconds = time.monotonic() - started
                parts.append(text)
                yield text
            if choice.get("finish_reason"):
                stats.finish_reason = choice["finish_reason"]
    finally:
        # Runs on normal completion, on errors, and when the caller stops early.
        stats.text = "".join(parts)
        stats.completion_tokens = len(ENCODING.encode(stats.text))
        stats.total_seconds = time.monotonic() - started


if __name__ == "__main__":
    stats = StreamStats()
    prompt = "Explain in three sentences why Azure Key Vault matters:\n\n"
    for piece in stream_completion(prompt, os.environ["AZURE_OPENAI_DEPLOYMENT"], stats):
        print(piece, end="", flush=True)
    print()
    if stats.finish_reason == "content_filter":
        print("[Output was filtered; discard what was shown]")
    elif stats.finish_reason == "length":
        print("[Truncated at max_tokens]")
    print(
        f"first token {stats.first_token_seconds or 0:.2f}s, total {stats.total_seconds:.2f}s, "
        f"~{stats.prompt_tokens}+{stats.completion_tokens} tokens"
    )
```

A few decisions worth explaining. The token counts are estimates for dashboards and budgets; the invoice remains the source of truth, as discussed in [Counting and Capping Tokens](/blog/2023-01-11-token-management-azure-openai/). The `finally` block matters because a web framework will stop iterating when the browser disconnects, and you still want the partial text and counts logged. And `request_timeout` is worth setting even when streaming: the library's default is 600 seconds, and a stalled stream should fail rather than hold a worker.

Log first-token latency separately from total latency. They answer different questions. First-token time tells you how the deployment and network are behaving; total time mostly tracks `max_tokens`.

## Relaying it to a browser

Your API key must never reach a browser, so the browser talks to your backend, which talks to Azure OpenAI. The backend re-emits each fragment as its own server-sent event. Save the module above as `stream_client.py`; the relay below lives beside it (for example `app.py`):

```python
import json
import os

import openai
import requests
from flask import Flask, Response, request, stream_with_context

from stream_client import StreamStats, stream_completion  # the module above

app = Flask(__name__)


@app.post("/api/complete/stream")
def complete_stream():
    prompt = request.get_json()["prompt"]
    stats = StreamStats()

    def events():
        gen = stream_completion(prompt, os.environ["AZURE_OPENAI_DEPLOYMENT"], stats)
        try:
            for piece in gen:
                yield f"data: {json.dumps({'text': piece})}\n\n"
        except (openai.error.OpenAIError, requests.exceptions.RequestException):
            # APIError, Timeout, or a dropped/timed-out stream: tell the browser it was upstream.
            yield f"data: {json.dumps({'error': 'upstream_failed'})}\n\n"
            return
        finally:
            gen.close()  # close the inner generator promptly so its finally block runs and the upstream response is released
        yield f"data: {json.dumps({'done': True, 'finish_reason': stats.finish_reason})}\n\n"

    return Response(
        stream_with_context(events()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

I send my own final event with the finish reason instead of forwarding Azure's raw chunks. The browser gets a contract you control, and it learns about `content_filter` and `length` in a structured way. The `except` branch matters for the same reason: if Azure sends an error event, the initial request times out, or the connection to Azure stalls or drops mid-stream, the relay says so in an `error` event instead of just ending the response, so the browser can tell an upstream failure from a dropped connection.

On the browser side, the obvious API is the wrong one. `EventSource` only issues GET requests and can't send a JSON body, so prompts would end up in a query string and in every access log along the way. Use `fetch` and read the body stream. The bug I see in most examples is splitting each network chunk on newlines and parsing every line as JSON. A network chunk can end halfway through an event, so you need a buffer that carries the incomplete tail into the next read:

```javascript
async function streamCompletion(prompt, onText, signal) {
  const response = await fetch("/api/complete/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop(); // keep the incomplete event for the next read
    for (const event of events) {
      if (!event.startsWith("data: ")) continue;
      const payload = JSON.parse(event.slice(6));
      if (payload.error) throw new Error(`Upstream error: ${payload.error}`);
      if (payload.text) onText(payload.text);
      if (payload.done) return payload;
    }
  }
  throw new Error("Stream ended without a final event");
}

// Usage: wire a Stop button to controller.abort()
const controller = new AbortController();
const output = document.getElementById("output");
streamCompletion("Explain Azure Key Vault in three sentences:\n\n", (text) => {
  output.textContent += text;
}, controller.signal).then((result) => {
  if (result.finish_reason === "content_filter") {
    output.textContent = "This response was withheld.";
  }
}).catch((err) => {
  // Stop button (AbortError), upstream error or dropped stream
  if (err.name !== "AbortError") output.textContent += " [connection lost]";
});
```

Two details in there are deliberate. `decoder.decode(value, { stream: true })` stops a multi-byte character split across chunks from turning into garbage. And the missing-final-event error lets you tell a clean finish from a dropped connection, which otherwise look identical to a user staring at half a paragraph. The `.catch` keeps a Stop press, which rejects the promise with an `AbortError`, from surfacing as an unhandled rejection.

## The plumbing between the two

Streaming fails silently when something in the middle buffers. Your code works on a laptop, then in a test environment the answer appears all at once after ten seconds. Check every hop:

- **Reverse proxies** such as nginx buffer responses by default. `X-Accel-Buffering: no` turns that off for nginx; other proxies and gateways have their own settings.
- **Compression middleware** often waits for enough bytes to compress. Exclude `text/event-stream` from it.
- **Timeouts on load balancers and gateways**: streaming keeps idle timers alive once tokens flow, but a slow first token on a long prompt or a hard cap on total request duration can still cut a generation short. Keep `max_tokens` sized to the answer you need, not the model's maximum.

Cancellation deserves a test too. When the user presses Stop, `AbortController` closes the browser connection. The WSGI server only notices on its next failed write, and then it closes the outer `events()` generator. Calling `gen.close()` explicitly makes the `finally` block in `stream_completion` run at that moment rather than whenever the generator is collected. In `openai` 0.26.1 that close doesn't call `close()` on the underlying `requests` response; releasing the connection to Azure relies on CPython's reference counting freeing the nested generators and the response they hold. Whether generation on the Azure side stops at that moment, and whether you're billed for tokens nobody read, isn't something I would assume. Measure it against your own deployment before you design around it: send a batch of deliberately aborted requests to a deployment nothing else is using, then compare the completion tokens Azure Monitor and your bill report for that window with the `tiktoken` counts your `finally` block logged. If Azure's number is much higher, generation carried on after the user left.

## When I'd stream and when I wouldn't

Stream when a person is waiting and reading: chat-style assistants, drafting tools, long explanations. Don't stream when a program is the consumer. Classification, extraction into JSON, and anything you validate or transform before use gain nothing from partial output, and they lose `usage`, simple retries and `best_of`. Also don't stream when the answer must pass a check before anyone sees it, whether that's a PII scan, a policy review or your own grounding check.

My rule of thumb: if the answer goes to a human and you can retract it, stream it. If it goes to code, or you can't take it back, wait for the whole response and cover the wait with a progress indicator.
