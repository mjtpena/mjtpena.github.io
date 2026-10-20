---
title: "Assistants API Runs in Production: Polling, Tool Calls and Expiry"
description: "How to drive OpenAI Assistants API runs reliably in January 2024: the run state machine, polling, function calls, expiry, concurrency and cost."
author: Michael John Peña
draft: false
date: 2024-01-03
tags:
  - OpenAI
  - Assistants API
  - Function Calling
  - Python
  - Production
---

Creating an assistant and a thread takes five lines of code. Getting a reliable answer back out of a run is where demos turn into support tickets. The Assistants API is still in beta, it has no streaming and no callbacks, so your application owns a polling loop, a state machine and a tool-call handshake with a deadline. If you get those three wrong, users see hung spinners, duplicate replies and runs that quietly expire.

The run itself is where the reliability work lives; I've covered [threads and messages](/blog/2023-11-25-assistants-threads-messages/) and [file handling](/blog/2023-11-26-assistants-file-handling/) separately, and the wider service architecture is in [Building Production AI Assistants](/blog/2024-01-04-building-ai-assistants/).

## What you are working with in January 2024

It helps to be precise about what exists today, because the surface is moving quickly:

- OpenAI announced the Assistants API as a beta at [DevDay on 6 November 2023](https://openai.com/index/new-models-and-developer-products-announced-at-devday/). Requests carry the `OpenAI-Beta: assistants=v1` header, which the Python SDK adds for you.
- Built-in tools are `code_interpreter`, `retrieval` and `function`. Up to 128 tools and 20 files per assistant, and up to 10 files per message.
- The current Python SDK is [`openai` 1.6.1](https://github.com/openai/openai-python/releases/tag/v1.6.1), released on 22 December 2023. Everything lives under `client.beta`.
- There is no streaming for runs. You create a run and poll it.
- The run object does not report token usage. You can see spend in the OpenAI usage dashboard, but you can't attribute it to a run from the API response.
- This is the OpenAI API only. Azure OpenAI does not offer Assistants at the time of writing (the [Azure OpenAI What's new page](https://learn.microsoft.com/azure/ai-services/openai/whats-new) is where to watch for it), so if your organisation needs data to stay in an Azure region, this API isn't an option yet.

Those last two points shape a lot of the design below.

## The run is a state machine, so treat it like one

A run has eight possible statuses in the v1 API, and the [`Run` type in `openai` 1.6.1](https://github.com/openai/openai-python/blob/v1.6.1/src/openai/types/beta/threads/run.py) lists all of them, along with the two `last_error.code` values. Half of them are terminal, and one of them is easy to miss.

| Status | Terminal? | What your code should do |
|---|---|---|
| `queued` | No | Keep polling |
| `in_progress` | No | Keep polling |
| `requires_action` | No | Execute the requested function calls and submit every output in one request |
| `cancelling` | No | Keep polling until it settles on `cancelled` |
| `completed` | Yes | Read the messages this run created |
| `failed` | Yes | Inspect `last_error.code` (`server_error` or `rate_limit_exceeded`) and decide whether to retry |
| `cancelled` | Yes | Stop. Something (probably you) cancelled it |
| `expired` | Yes | Tool outputs were not submitted in time, or the run overran `expires_at` |

The bug I see most often in sample code is a hand-written enum that omits `cancelling`. Your polling loop then throws a `ValueError` the first time you cancel a slow run, which is exactly the moment you needed it to behave. Compare against the status strings directly, and make an unknown status a logged, non-fatal case (the loop below warns and keeps polling) so a new status in a later API version doesn't take your service down.

The other field that matters is `expires_at`. Each run carries a Unix timestamp after which the platform expires it, and in the API reference examples it sits ten minutes after `created_at`. Don't hardcode ten minutes. Read the field and derive your own deadline from it, with a margin.

## One active run per thread

A thread can only have one active run. While a run is `queued`, `in_progress` or `requires_action`, you can't add a message to that thread or start another run on it; the API returns a 400.

That's a concurrency rule your web tier has to enforce, because users double-click, mobile clients retry, and two browser tabs share one conversation. My rule of thumb:

- Serialise work per thread. A per-thread lock in Redis (or a queue partitioned by thread ID) is enough.
- Before creating a run, check for an active one with `runs.list(thread_id, limit=1)` and either wait for it or reject the request with a clear "still working" response.
- Never retry a run creation blindly after a network timeout. The first request may have succeeded, and a second run would answer the same question twice.

## A polling loop that respects the deadline

The loop below is complete and runs against `openai` 1.6.1. It handles every status, logs any it doesn't recognise, backs off between polls, cancels the run before the platform expires it, dispatches function calls through a registry, and only returns messages created by this run, not whatever happens to be newest on the thread.

```python
import json
import logging
import time
from typing import Callable

import openai
from openai import OpenAI

client = OpenAI()  # reads OPENAI_API_KEY from the environment

TERMINAL = {"completed", "failed", "cancelled", "expired"}
KNOWN = TERMINAL | {"queued", "in_progress", "requires_action", "cancelling"}


def get_order_status(order_id: str) -> dict:
    # Replace with a real lookup. Keep it read-only and fast.
    return {"order_id": order_id, "status": "shipped"}


TOOLS: dict[str, Callable[..., dict]] = {
    "get_order_status": get_order_status,
}


def run_tool(name: str, raw_args: str) -> str:
    """Execute one function call and always return a string for the model."""
    fn = TOOLS.get(name)
    if fn is None:
        return json.dumps({"error": f"unknown tool: {name}"})
    try:
        args = json.loads(raw_args)
        return json.dumps(fn(**args))
    except Exception as exc:  # report the failure to the model, don't crash the run
        return json.dumps({"error": type(exc).__name__, "detail": str(exc)})


def ask(thread_id: str, assistant_id: str, text: str, safety_margin: int = 30) -> list[str]:
    user_msg = client.beta.threads.messages.create(thread_id=thread_id, role="user", content=text)
    run = client.beta.threads.runs.create(thread_id=thread_id, assistant_id=assistant_id)

    delay = 0.5
    while run.status not in TERMINAL:
        if run.status not in KNOWN:
            logging.warning("unexpected run status %s on run %s", run.status, run.id)

        if time.time() > run.expires_at - safety_margin and run.status != "cancelling":
            try:
                run = client.beta.threads.runs.cancel(thread_id=thread_id, run_id=run.id)
            except openai.BadRequestError:
                # The run reached a terminal state after our last retrieve; re-read it.
                run = client.beta.threads.runs.retrieve(thread_id=thread_id, run_id=run.id)

        elif run.status == "requires_action":
            calls = run.required_action.submit_tool_outputs.tool_calls
            outputs = [
                {"tool_call_id": c.id, "output": run_tool(c.function.name, c.function.arguments)}
                for c in calls
            ]
            run = client.beta.threads.runs.submit_tool_outputs(
                thread_id=thread_id, run_id=run.id, tool_outputs=outputs
            )
            delay = 0.5
            continue

        time.sleep(delay)
        delay = min(delay * 1.5, 5.0)
        run = client.beta.threads.runs.retrieve(thread_id=thread_id, run_id=run.id)

    if run.status != "completed":
        reason = run.last_error.message if run.last_error else run.status
        raise RuntimeError(f"run {run.id} ended as {run.status}: {reason}")

    replies = []
    # Iterating the page (not .data) fetches every page after our own message.
    for message in client.beta.threads.messages.list(
        thread_id=thread_id, order="asc", after=user_msg.id
    ):
        if message.run_id != run.id:
            continue
        for part in message.content:
            if part.type == "text":
                replies.append(part.text.value)
    return replies
```

A few decisions in there are deliberate.

**Backoff, not a fixed one-second poll.** Most runs that use retrieval or code interpreter take several seconds. Polling every 500 ms at the start keeps short answers snappy, and stretching to five seconds stops a slow code interpreter session from burning your request rate limit.

**Filter by `run_id`.** Grabbing "the latest assistant message" breaks as soon as a run produces more than one message, or a second run lands on the thread. Every message created by a run carries that run's ID, so use it. The `after` cursor is what makes this work on long threads: listing from the start in ascending order returns only the oldest 20 messages (the default page size), so on a busy thread the run's replies would never appear. Starting after the user's message and iterating the page object, which fetches the next page for you, reads only what came after the question.

**Synchronous on purpose.** If you're in an async web framework, use `AsyncOpenAI` and `await asyncio.sleep`, but don't wrap the sync client in an `async def` and call it done. Every blocking HTTP call would stall your event loop.

## Tool calls are a contract with a deadline

When the model wants your functions, the run moves to `requires_action` and waits. With `gpt-4-1106-preview` it can request several calls at once (parallel function calling), and you must submit outputs for all of them in a single `submit_tool_outputs` request. Submitting half, or submitting late, gets you a 400 or an expired run.

Three rules I'd hold any team to:

1. **Return errors as outputs.** If your function throws, send the error back as JSON. The model can apologise, retry with different arguments or ask the user for missing details. An unhandled exception in your handler just leaves the run hanging until it expires.
2. **Keep functions fast.** The clock on `expires_at` keeps ticking while your code runs. Anything that can take minutes (report generation, a long SQL query, an approval step) should return "accepted, job 123" immediately and let the user ask for the result later.
3. **Treat arguments as untrusted input.** The arguments are model output shaped by user input. A keyword blocklist for `DROP` and `DELETE` is not a security control. If a tool queries a database, give it a read-only login scoped to the views it needs, and validate identifiers against an allow list before they reach the query.

## Cost and context: what you can't see

The Assistants API manages the context window for you. In v1 you get no setting to cap how many thread messages or retrieved chunks go into each run, and the run object doesn't tell you how many tokens it used. Combine that with a 128K-token model and a thread that never ends, and the per-run cost of a conversation creeps up with every turn.

Tool pricing adds to it. At launch OpenAI [listed](https://openai.com/index/new-models-and-developer-products-announced-at-devday/) code interpreter at $0.03 per session and retrieval at $0.20 per GB per assistant per day, on top of model tokens. Retrieval storage was free for an introductory period at launch, with OpenAI's pricing page putting the end of it in January 2024, so budget for it now even if your invoice doesn't show it yet.

What I'd do about it today:

- **Rotate threads deliberately.** Start a fresh thread per task or per session, and carry forward a short summary as the first message if continuity matters. Long-lived "one thread per user forever" designs are the most expensive option.
- **Keep assistants few and files tidy.** Retrieval storage is priced per assistant, so once it is billed, twenty near-identical assistants with the same documents will cost twenty times as much. Delete files you no longer attach.
- **Use `metadata` for attribution.** Runs, threads and messages accept up to 16 metadata key-value pairs. Tag them with tenant and feature so that when usage data does become available per run, you can join it without a migration.
- **Watch the dashboard daily during rollout.** Without per-run usage, the usage page is your only cost signal.

## When not to use the Assistants API

I like the API for internal tools, analyst helpers and prototypes where code interpreter and retrieval save weeks of plumbing. I wouldn't put it in front of customers in these cases:

| Requirement | Better fit right now |
|---|---|
| Token-by-token streaming in the UI | Chat Completions with `stream=True` |
| Data residency or private networking in Azure | Azure OpenAI Chat Completions with your own state store |
| Precise control over context and retrieval quality | Chat Completions plus your own RAG pipeline (Azure AI Search or similar) |
| Per-request cost attribution and hard token budgets | Chat Completions, where every response returns `usage` |
| A stable, GA contract for a regulated workload | Anything not labelled beta |

None of these are permanent; the API is in beta for a reason. But you should choose it for what it does today, not what the roadmap might add.

## The short version

If you adopt the Assistants API now, write the run loop as if it were a payment workflow: an explicit state machine with every status handled, one active run per thread enforced by your own lock, a deadline derived from `expires_at`, and tool handlers that are fast, defensive and never throw. Then plan for cost blind spots by rotating threads and tagging everything with metadata. Do those things and the beta label becomes a manageable risk, not a surprise in production.
