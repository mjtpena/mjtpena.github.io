---
title: "Where LLM Latency Goes, and Which Token Cuts Actually Help"
description: "Input and output tokens cost and delay answers differently, so split latency into first-token and generation time before trimming anything."
author: Michael John Peña
draft: false
date: 2026-03-24
tags:
  - LLM
  - Azure OpenAI
  - Performance
  - Cost Optimization
---

Most token-reduction work is sold as a cost and latency win at once. It often isn't. Cutting 3,000 tokens of retrieved context can take a real slice off the bill and barely move response time, while cutting 300 tokens of answer can make the reply feel noticeably faster and save comparatively little. If you don't know which kind of token is slowing a request down, you will trim the wrong one and pay for it in answer quality.

For the cost side, start with [a token waste audit](/blog/2026-03-13-cost-discipline-for-llm-apps-reducing-token-waste-without-hurting-answer-quality/) and [cost per query](/blog/2026-01-18-cost-per-query-optimization/). Cost and latency overlap, but they don't share a priority order: the cuts that save the most money are rarely the ones that make answers faster.

## Two clocks, not one

A chat completion has two phases. The model first reads the whole prompt (prefill), then generates the answer one token at a time (decode). That gives you two numbers that matter far more than "the call took 6 seconds":

- **Time to first token (TTFT):** how long before anything comes back. Prompt size, prompt cache hits, queueing on the deployment and, on reasoning models, hidden reasoning all land here.
- **Generation time:** everything after the first token, which is roughly the number of output tokens multiplied by the time per token.

Microsoft's [performance and latency guidance for Azure OpenAI](https://learn.microsoft.com/azure/foundry/openai/how-to/latency) says it plainly: latency depends mostly on the model and the number of tokens generated, and each prompt token adds little time compared with each generated token. Generation is sequential, so 800 output tokens is 800 steps. Prompt tokens are processed together, which is why prompts are cheaper per token in time even when they cost real money.

That gives you an asymmetry I'd keep in mind for every optimisation discussion:

| Token type | Effect on cost | Effect on latency |
|---|---|---|
| Prompt tokens (system prompt, history, retrieved chunks, tool schemas) | Usually the biggest share of the bill in RAG and agent apps | Small per token; shows up in TTFT and grows with very large prompts |
| Cached prompt tokens | Discounted | Reduce TTFT on long, stable prefixes |
| Visible output tokens | Output rate, several times the input rate | The main driver of total response time |
| Reasoning tokens | Billed as output, never shown | Arrive before the first visible token, so they look like TTFT to the user |

Reasoning tokens are the row teams most often overlook. On a reasoning model, a user staring at a spinner for eight seconds is often watching the model think, not watching the network or the prompt. Shortening the prompt won't fix that.

## Measure both clocks before you cut

Azure Monitor gives you [deployment-level metrics](https://learn.microsoft.com/azure/foundry/openai/monitor-openai-reference) for this: **Time to Response** for first-response latency, **Time Between Tokens** for generation speed, and **Generated Completion Tokens** for output volume. They are useful for spotting trends, but they average across every caller of a deployment, and Time to Response and Time Between Tokens are only emitted for provisioned (PTU) deployments, not Standard, which is another reason to measure per request in your own code. To decide what to cut in *your* request, you need per-request numbers next to the token counts.

One distortion to know about before you time anything: with the default streaming content filter mode, completion content arrives in buffered chunks rather than token by token. Compare runs under the same filter configuration and treat per-token timings as approximate (asynchronous filter mode reduces the effect).

This is the harness I'd use. It streams the response, records when the first visible content arrives, and reads the usage block that Chat Completions sends at the end of a stream when you ask for it with `stream_options`. It uses the `openai` Python library against the Azure OpenAI v1 endpoint, so there's no `api-version` to manage. Tested pattern: `openai>=2.8` (`pip install "openai>=2.8"`), the first release whose types include `reasoning_effort="none"`. This uses Chat Completions; on the Responses API the same split works with `response.output_text.delta` events and `usage.output_tokens_details.reasoning_tokens`, and some GPT-5.x variants (pro, codex) are Responses-only.

```python
import os
import time

from openai import OpenAI

client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
)


def timed_call(deployment: str, messages: list[dict], **params) -> dict:
    """Stream one chat completion and split its latency into TTFT and generation."""
    start = time.perf_counter()
    first_token_at = None
    usage = None
    parts = []

    stream = client.chat.completions.create(
        model=deployment,
        messages=messages,
        stream=True,
        stream_options={"include_usage": True},
        **params,
    )
    for chunk in stream:
        if chunk.usage is not None:
            usage = chunk.usage
        if chunk.choices and chunk.choices[0].delta.content:
            if first_token_at is None:
                first_token_at = time.perf_counter()
            parts.append(chunk.choices[0].delta.content)

    end = time.perf_counter()
    first_token_at = first_token_at or end

    details = usage.completion_tokens_details if usage else None
    reasoning = (details.reasoning_tokens or 0) if details else 0
    output = usage.completion_tokens if usage else 0
    visible = max(output - reasoning, 0)
    prompt_details = usage.prompt_tokens_details if usage else None
    cached = (prompt_details.cached_tokens or 0) if prompt_details else 0

    return {
        "ttft_s": round(first_token_at - start, 2),
        "generation_s": round(end - first_token_at, 2),
        "total_s": round(end - start, 2),
        "prompt_tokens": usage.prompt_tokens if usage else 0,
        "cached_tokens": cached,
        "reasoning_tokens": reasoning,
        "visible_output_tokens": visible,
        # Approximate: the first token isn't in the generation window, and buffered
        # content filtering bunches tokens together.
        "ms_per_visible_token": round(1000 * (end - first_token_at) / max(visible - 1, 1), 1),
        "answer": "".join(parts),
    }


if __name__ == "__main__":
    question = [
        {"role": "system", "content": "Answer support questions about invoices in plain English."},
        {"role": "user", "content": "Why does my March invoice show two separate GST lines?"},
    ]
    # "none" is supported on gpt-5.1 and gpt-5.2 (check the reasoning guide for other
    # variants); use ("minimal", "low", "medium") for gpt-5.
    # Drop reasoning_effort for non-reasoning models.
    for effort in ("none", "low", "medium"):
        result = timed_call("<your-gpt-5.x-deployment>", question, reasoning_effort=effort)
        result.pop("answer")
        print(effort, result)
```

Run it over a fixed set of real questions, not one. Single calls vary too much to compare. What you are looking for is which column moves when latency is bad: TTFT with a large `prompt_tokens` and low `cached_tokens`, TTFT with high `reasoning_tokens`, or generation time with a long visible answer.

## Cuts that help latency

### Shorter answers

This is the biggest lever, and it is also the one that most often changes quality, because the length of the answer *is* part of the answer. Ask for the format you need ("three bullet points", "one sentence then a table"), and on GPT-5 family models try the `verbosity` setting. Do not reach for `max_completion_tokens` as the length control. A lower token cap doesn't make the model concise; it truncates the answer. On reasoning models the cap also covers reasoning tokens, so a tight cap can spend the whole budget thinking and return nothing visible. Set the cap close to the longest answer you'd accept (Microsoft notes a lower cap can trim latency on its own), but use it to stop runaways, not to shape length.

### Less reasoning where the task doesn't need it

`reasoning_effort` is a latency control as much as a quality control. The [reasoning models guide](https://learn.microsoft.com/azure/foundry/openai/how-to/reasoning) lists `none` for `gpt-5.1` and `gpt-5.2`, and `gpt-5.1` defaults to `none`. `gpt-5.4` accepts it too, but test it on your deployment. `minimal` exists only on the original GPT-5 models. Classification, extraction and short factual lookups rarely need more than `none` or `low`. Multi-step planning and tool-heavy agents often do. Measure the drop in TTFT against your evaluation set; don't assume.

### Stable prefixes for long prompts

If TTFT is high and the prompt is long, prompt caching is the cut that costs nothing in quality, because you keep every token and simply stop paying to reprocess the same prefix. It only works when the first part of the prompt is byte-identical across calls. I covered the usual reasons it misses in [why your Azure OpenAI prompt cache keeps missing](/blog/2026-02-16-prompt-caching-performance/).

### Predicted outputs for edit-style work

When the response is mostly text you already have, such as a rewritten document with a few changes or a code file with one function fixed, [predicted outputs](https://learn.microsoft.com/azure/foundry/openai/how-to/predicted-outputs) let you pass the expected text in a `prediction` parameter so the model can accept it in bulk instead of generating every token. It is in preview, works on `gpt-4o`, `gpt-4o-mini` and the `gpt-4.1` family rather than GPT-5 models, and can't be combined with tools, `n` greater than 1 or `max_completion_tokens`. On these non-reasoning models the runaway cap is `max_tokens` instead. Rejected prediction tokens are billed like output tokens, so a poor prediction makes the call slower *and* more expensive. Use it only where most of the output really is known in advance.

## Cuts that mostly save money

Trimming retrieved chunks, conversation history and tool schemas is worth doing for cost and for accuracy, since less noise in the context often helps grounding. But on a typical RAG request with a few thousand prompt tokens, removing a third of them will move total response time far less than halving the answer would. If your goal is speed, don't start here, and don't accept a retrieval quality drop in exchange for a latency gain you haven't measured.

The exception is very large prompts. Once a request is tens of thousands of tokens, prefill becomes visible, and context reduction helps both clocks. To find out where you are, run the harness with the full and the trimmed context and compare `ttft_s`: if the difference is smaller than your `ms_per_visible_token` times about 50 output tokens (my rule of thumb: roughly the time it takes to stream one short sentence of answer, which is about the smallest difference a user notices), stop trimming for speed and keep trimming only for cost.

## Latency that isn't about tokens at all

Sometimes neither clock is driven by your tokens. If TTFT rises while prompt size and cache hits stay flat, the deployment is under load. The Azure guidance recommends separating workloads into their own deployments, because short interactive calls get batched with long ones. Content filtering also adds latency to every call; that is a trade-off to accept in most apps, not a knob to turn off casually.

When a user-facing journey needs predictable latency rather than just lower average latency, the options are capacity options: provisioned throughput for steady load, or [priority processing](https://learn.microsoft.com/azure/foundry/openai/concepts/priority-processing), a pay-as-you-go option on Global standard and Data Zone standard (US) deployments with a published latency target per model. Priority processing charges a premium per token. Provisioned throughput is billed per PTU per hour whether you use it or not (reservations lower the rate in exchange for a term commitment), so it only pays off at high, steady utilisation. Prompt trimming won't give you consistency on a busy shared deployment; capacity will.

## When not to bother

- **Batch and background jobs.** If nobody waits on the answer, optimise for cost and throughput. Azure OpenAI batch deployments (Global Batch) or an offline queue will do more than any latency tuning.
- **Answers that are long because they must be.** A report generator or a code-writing agent produces long output by design. Stream it and set expectations in the UI instead of squeezing it.
- **Requests already under your latency budget.** Every cut carries quality risk. If the p95 meets the target, spend the effort on evaluation instead.

## The order I'd follow

Measure TTFT and generation time per request, with token counts beside them. If generation dominates, shorten the answer and check the reasoning effort. If TTFT dominates, check reasoning tokens first, then cache hits, then prompt size, then deployment load. Stream anything a person reads, because it makes the wait feel shorter even when the total time doesn't change. And treat any cut that touches the answer's content as a quality change that has to pass the same evaluation as a prompt change. Speed you get by quietly removing the part of the answer users needed isn't a saving.
