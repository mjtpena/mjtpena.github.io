---
title: "LLM Observability: The Few Signals That Actually Matter"
description: "Which LLM signals deserve a dashboard or a page: tokens by feature, latency split by phase, throttling, and sampled quality, using OpenTelemetry on Azure."
author: Michael John Peña
draft: false
date: 2026-01-16
tags:
  - Observability
  - LLM
  - OpenTelemetry
  - Azure Monitor
  - LLMOps
---

Most LLM telemetry I review has the same problem: plenty of data and no answers. Teams log every prompt, every response and a dozen custom counters, then still can't say why last Tuesday's bill doubled or whether the assistant got worse after a prompt change. Observability for a model-backed feature is only useful if it can answer a short list of questions quickly, so start from those questions, not from what the SDK can emit.

This post is about choosing that short list. If you want the wiring for OpenTelemetry itself, I covered that in [Implementing Observability for AI Applications with OpenTelemetry](/blog/2025-12-13-december-ai-topic/), and the vendor landscape in [LLM Observability Tools: Comparing the Landscape](/blog/2024-10-14-llm-observability-tools/).

## The four questions

Every LLM feature in production eventually gets asked four things:

1. **What is it costing, and who is spending it?** Not the total, the breakdown by feature, tenant and model.
2. **Is it slow, and where?** Waiting for the first token, generating a long answer, or retrieval before the model call even starts.
3. **Is it failing or being throttled?** Errors, 429s, content filter blocks and timeouts behave very differently and need separating.
4. **Is it still any good?** Whether the answers are grounded and useful, which no latency chart will tell you.

Everything below maps to one of these. If a metric doesn't help answer one of them, I don't collect it until someone asks a question it would answer.

## Tokens, attributed properly

Token counts are the closest thing an LLM system has to a unit cost, and the raw count is the least useful version of them. What matters is attribution: tokens per feature, per tenant (if you're multi-tenant), per model deployment, split into input and output.

That split matters more than it used to. Input tokens dominate in retrieval-heavy features because of the stuffed context; output tokens dominate in drafting features; and reasoning models bill their hidden reasoning tokens as output, which the OpenAI SDK exposes as `usage.completion_tokens_details.reasoning_tokens`. Prompt caching muddies it further, since `usage.prompt_tokens_details.cached_tokens` are billed at a discount. A single "total tokens" number hides all of that.

I'd record tokens rather than dollars at the point of the call. Prices change and differ by deployment type, and converting at query time from a price table you control is easier than rewriting historical telemetry. Keep the dollar conversion in your dashboard or a nightly job.

## Latency, split by phase

A P95 for "the LLM call" is a blunt instrument. For a streaming chat experience, the user perceives time to first token; for a batch summariser, total duration matters and first token is irrelevant. Azure OpenAI's own guidance on [latency](https://learn.microsoft.com/azure/foundry/openai/how-to/latency) makes the point that total time is usually explained by output length, so a latency regression that coincides with longer answers isn't a platform problem.

So I track at least:

- **End-to-end request duration** for the user-facing operation, including retrieval and tool calls.
- **Model call duration**, per deployment.
- **Time to first token** for streaming features, measured client-side.
- **Output tokens alongside duration**, so you can tell "slower" from "longer".

Where the model call is a small fraction of end-to-end time, the fix is usually in retrieval or orchestration, and you only see that if each phase is its own span.

## Failures, separated by kind

Lumping every non-200 into one "error rate" is the fastest way to build an alert nobody trusts. The categories I keep distinct:

| Failure | What it usually means | What to do |
|---|---|---|
| 429 throttling | Quota or provisioned capacity exhausted | Capacity planning, retries with backoff, load spreading |
| Content filter blocks | Input or output tripped a safety filter | Review samples; often a product or prompt issue, not an outage |
| Timeouts | Long generations or a struggling deployment | Check output length first, then the deployment |
| 5xx from the service | Genuine service-side errors | Retry, fail over, raise a support case if sustained |
| Malformed output | Model returned JSON or a tool call your code couldn't parse | Prompt or schema fix; this is a quality signal disguised as an error |

Azure OpenAI returns rate limit headers such as `x-ratelimit-remaining-tokens` and, on a 429, a `retry-after-ms` value. The OpenAI Python SDK honours those headers in its built-in retries, which hides throttling from your own code; the instrumentation section below covers where to count it instead.

## Quality, sampled not exhaustive

Quality is the signal teams most want and least often measure. You can't run an LLM-as-judge evaluation on every production request without roughly doubling your inference bill, and you shouldn't try. What works is sampling: score a small, consistent slice of traffic (and every request that got negative user feedback) for groundedness and relevance, offline, and track the trend.

The [Azure AI Evaluation SDK](https://learn.microsoft.com/azure/foundry-classic/how-to/develop/evaluate-sdk) has built-in evaluators for this (its how-to page sits under the Foundry classic docs, unlike the other Foundry links in this post), and Microsoft Foundry (the new name for Azure AI Foundry since Ignite in November 2025) can show evaluation results next to traces when the project is connected to Application Insights. The tooling is less important than the discipline: a fixed sample, the same evaluators, and a chart you look at after every prompt or model change.

Explicit user feedback (thumbs up or down) is cheap and worth capturing as an attribute on the trace. It's noisy and biased towards annoyed users, so treat it as a pointer to samples worth reading, not as a score.

## Instrumenting it with OpenTelemetry

The OpenTelemetry [semantic conventions for generative AI](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/) define a client metric `gen_ai.client.token.usage` (with a `gen_ai.token.type` attribute of `input` or `output`) and `gen_ai.client.operation.duration`, plus span attributes like `gen_ai.request.model` and `gen_ai.provider.name`. They are still marked Development rather than stable, and attribute names have already changed once (`gen_ai.system` became `gen_ai.provider.name` in v1.37), so expect some churn. I still use them: they're the names the instrumentation libraries and backends are converging on. Adoption is uneven, though: the OpenAI auto-instrumentation still emits `gen_ai.system` (see below).

The fragment below shows the shape of a wrapper that emits those signals plus the attribution attributes that make them useful. It uses the `openai` 2.x Python SDK against the Azure OpenAI v1 endpoint with Entra ID auth, and the [Azure Monitor OpenTelemetry Distro](https://learn.microsoft.com/azure/azure-monitor/app/opentelemetry-enable) to export to Application Insights. One Azure-specific wrinkle: the conventions define `gen_ai.request.model` as the model name, but on Azure the "model" you send is your deployment name, so that's what lands in the attribute, while `gen_ai.response.model` carries the actual model version the service ran.

```python
import time

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from azure.monitor.opentelemetry import configure_azure_monitor
from openai import APIConnectionError, APIStatusError, APITimeoutError, OpenAI
from opentelemetry import metrics, trace
from opentelemetry.trace import SpanKind, Status, StatusCode

# Reads APPLICATIONINSIGHTS_CONNECTION_STRING from the environment.
configure_azure_monitor()

tracer = trace.get_tracer("chat-service")
meter = metrics.get_meter("chat-service")

token_usage = meter.create_histogram(
    "gen_ai.client.token.usage", unit="{token}", description="Input and output tokens used"
)
op_duration = meter.create_histogram(
    "gen_ai.client.operation.duration", unit="s", description="GenAI operation duration"
)
content_filtered = meter.create_counter(
    "app.content_filter.completions", description="Responses truncated by the content filter"
)

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)
client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=token_provider,
    max_retries=2,  # the default; duration below includes any 429 back-off
)


def _record_failure(span, attrs: dict, start: float, error_type: str) -> None:
    op_duration.record(time.perf_counter() - start, {**attrs, "error.type": error_type})
    span.set_attribute("error.type", error_type)
    span.set_status(Status(StatusCode.ERROR))


def chat(deployment: str, messages: list[dict], feature: str, tenant: str) -> str:
    base_attrs = {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": "azure.ai.openai",
        "gen_ai.request.model": deployment,
        "app.feature": feature,
    }
    # Tenant goes on the span only; on metrics it multiplies time series.
    with tracer.start_as_current_span(
        f"chat {deployment}",
        kind=SpanKind.CLIENT,
        attributes={**base_attrs, "app.tenant": tenant},
    ) as span:
        start = time.perf_counter()
        try:
            response = client.chat.completions.create(model=deployment, messages=messages)
        except APIStatusError as exc:
            # A prompt-side content filter block is a 400 with code "content_filter".
            error_type = (
                "content_filter"
                if exc.status_code == 400 and getattr(exc, "code", None) == "content_filter"
                else str(exc.status_code)
            )
            _record_failure(span, base_attrs, start, error_type)
            raise
        except (APITimeoutError, APIConnectionError) as exc:
            # No HTTP status for these, so use the exception class name.
            _record_failure(span, base_attrs, start, type(exc).__qualname__)
            raise

        elapsed = time.perf_counter() - start
        usage = response.usage
        attrs = {**base_attrs, "gen_ai.response.model": response.model}

        op_duration.record(elapsed, attrs)
        token_usage.record(usage.prompt_tokens, {**attrs, "gen_ai.token.type": "input"})
        token_usage.record(usage.completion_tokens, {**attrs, "gen_ai.token.type": "output"})

        span.set_attribute("gen_ai.usage.input_tokens", usage.prompt_tokens)
        span.set_attribute("gen_ai.usage.output_tokens", usage.completion_tokens)
        if usage.prompt_tokens_details:
            span.set_attribute("app.usage.cached_tokens", usage.prompt_tokens_details.cached_tokens or 0)
        if usage.completion_tokens_details:
            span.set_attribute("app.usage.reasoning_tokens", usage.completion_tokens_details.reasoning_tokens or 0)
        finish_reasons = [c.finish_reason for c in response.choices]
        span.set_attribute("gen_ai.response.finish_reasons", finish_reasons)
        if "content_filter" in finish_reasons:
            # Completion-side filter: HTTP 200, but the output was cut off.
            content_filtered.add(1, attrs)
            span.set_attribute("app.content_filtered", True)

        return response.choices[0].message.content or ""
```

Two deliberate choices in there. First, the prompt and response text are not recorded. Content capture is the most expensive and riskiest part of LLM telemetry (it's personal data in most organisations), so I keep it off by default and turn it on for sampled or debug traffic only. Second, `app.feature` and `app.tenant` are custom attributes outside the semantic conventions; they're what turn a token chart into a cost report, and they're worth more than any standard attribute.

That's also why `app.tenant` sits on the span and not the metrics. Every distinct combination of metric attribute values is its own time series. The OpenTelemetry metrics specification recommends a default cap of 2,000 attribute sets per metric, beyond which SDKs fold new series into a single overflow series, but as of version 1.39 the Python SDK doesn't enforce a cap, so you simply pay for every series in Application Insights. Add tenant to the metric attributes only when the tenant list is bounded and small; otherwise aggregate per-tenant cost from the `gen_ai.usage.*` attributes in `dependencies`.

The wrapper also can't see throttling. With `max_retries` at its default of 2, the SDK retries a 429 internally (honouring `retry-after-ms`), so the span records only the final outcome and its duration silently includes the back-off. That's fine, because the throttle count belongs on the platform side: the Azure OpenAI Requests metric, split by `StatusCode`, counts every 429 the service returned, retried or not, and that's where my 429 alert comes from. If you need per-feature throttling, set `max_retries=0` and retry in your own loop, adding a span event or counter for each 429 before you back off.

If you'd rather not hand-write the spans, the `opentelemetry-instrumentation-openai-v2` package (2.3b0, still beta) instruments the OpenAI client automatically, though you'll still want to add the attribution attributes yourself. It also still emits the older `gen_ai.system` attribute, so pick one approach per client rather than running both; combining it with a wrapper like the one above gives you two attribute names for the provider and duplicate `gen_ai.client.*` metrics.

In Application Insights, the custom metrics land in `customMetrics` and the client spans in `dependencies`, so the daily cost question becomes a short query:

```kusto
customMetrics
| where timestamp > ago(7d) and name == "gen_ai.client.token.usage"
| extend feature = tostring(customDimensions["app.feature"]),
         deployment = tostring(customDimensions["gen_ai.request.model"]),
         tokenType = tostring(customDimensions["gen_ai.token.type"])
| summarize tokens = sum(valueSum) by bin(timestamp, 1d), feature, deployment, tokenType
| order by timestamp asc
```

## Don't forget the platform metrics

You don't have to instrument everything client-side. Azure OpenAI publishes platform metrics to Azure Monitor, including Azure OpenAI Requests (split by `StatusCode` for 429s), Processed Prompt Tokens, Generated Completion Tokens, Time to Response and Provisioned-managed Utilization V2, listed in the [monitoring data reference](https://learn.microsoft.com/azure/foundry/openai/monitor-openai-reference). They can't tell you which feature or tenant spent the tokens, which is why the client-side attributes matter, but they're the authoritative view of deployment health and the right source for capacity alerts on provisioned throughput.

## What I'd alert on

Fixed thresholds like "P95 over five seconds" are easy to write and usually wrong, because acceptable latency depends entirely on the feature. My starting set:

- **Sustained 429 rate** per deployment, from the platform's Azure OpenAI Requests metric.
- **Daily token spend per feature** against a budget, as an alert to the owning team rather than a page.
- **Time to first token or end-to-end P95** for interactive features, relative to that feature's own baseline.
- **5xx and timeout rate** above baseline for more than a few minutes.
- **Quality trend** from the sampled evaluations, reviewed after every deployment rather than paged on.

Content filter blocks and malformed output go to a dashboard and a weekly review, not an on-call rotation. Nobody should be woken at 3 am because a user typed something the filter didn't like.

## When this is overkill

If you're running an internal prototype with a handful of users, the platform metrics plus a log line with token counts are enough. Per-tenant attribution and sampled evaluation pay off once there's a budget owner asking questions, or more than one feature sharing a deployment. Build the four questions into your design from the start, but only instrument as deeply as the questions people are actually asking.
