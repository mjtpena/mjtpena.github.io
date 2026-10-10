---
title: "Monitoring AI in Production: Layers, Owners and a Review Rhythm"
description: "Run AI monitoring as an operating rhythm: four layers with owners, what pages versus what waits, and tagging every change so regressions are traceable."
author: Michael John Peña
draft: false
date: 2026-02-13
tags:
  - AI
  - Azure OpenAI
  - Monitoring
  - Observability
  - LLMOps
---

A traditional service fails loudly: a 500, a timeout, a queue that stops draining. An LLM feature can return a 200 in 800 milliseconds with an answer that is wrong, off-policy or useless, and nothing in a standard dashboard turns red. There's no status code for "bad answer", so monitoring an AI application is less about collecting more telemetry and more about deciding who looks at which signal, how often, and what they compare it against.

I covered which signals are worth collecting, and how to emit them with OpenTelemetry, in [LLM Observability: The Few Signals That Actually Matter](/blog/2026-01-16-llm-observability/). This post is the operating side: how to split monitoring into layers with owners, what deserves a page versus a weekly review, and why the most useful thing you can record is what changed.

## Four layers, four different owners

Most AI monitoring I see is either pure infrastructure (uptime, latency, errors) or a pile of token counters. Both are necessary and neither answers whether the feature is working. I split it into four layers, and the split matters because each layer has a different owner and a different natural cadence.

| Layer | Example signals | Where it comes from | Who owns it | Natural cadence |
|---|---|---|---|---|
| Infrastructure | Availability, end-to-end latency, 5xx, timeouts | Application Insights, platform metrics | Platform or on-call team | Real time |
| Model calls | Tokens by feature, 429s, content filter blocks, model version served | Client telemetry plus Azure OpenAI metrics | Engineering team for the feature | Daily (429s on interactive traffic: real time) |
| Quality | Groundedness and relevance on a sample, user feedback, refusal rate | Evaluations and feedback capture | Product owner with the engineers | Weekly, and after every change |
| Business | Task completion, suggestion acceptance, deflection, rework | Product analytics, not the model | Business owner | Monthly |

The infrastructure layer is no different from any other service, and if the app is down nothing else matters, so do it first. The model-call layer is where AI starts to diverge: costs scale with usage in a way most teams haven't budgeted for, and Azure OpenAI publishes request, token and content safety metrics such as Blocked Volume to Azure Monitor that you get without writing code (the [monitoring data reference](https://learn.microsoft.com/azure/foundry/openai/monitor-openai-reference) lists them).

The quality layer is the one teams skip, because it has no free metric. Automated checks catch the obvious failures: empty answers, refusals where there shouldn't be any, malformed JSON, answers that ignore the retrieved context. User feedback catches the subtle ones, though it's noisy and skews towards annoyed users. Sampled evaluation sits between the two. If you're building agents in the Foundry (classic) portal, [continuous evaluation](https://learn.microsoft.com/azure/foundry-classic/how-to/continuous-evaluation-agents) will score a sample of live agent runs (up to 1,000 per hour) and put the results next to the traces in Application Insights; it's marked preview, so I'd treat it as a convenience rather than the only place your quality numbers live.

The business layer is the one people forget to define until someone asks whether the project was worth it. Acceptance rate of suggestions, tickets resolved without escalation, time to complete a task with and without the assistant: none of these can be derived from token counts, and they have to be instrumented in the product, not the model call. Decide what the number is before launch. If the AI isn't moving it, a perfect latency chart is irrelevant.

## What pages someone, what waits

The first alerting setup most teams build pages on everything with a threshold: error rate over 5%, latency over 30 seconds, more than ten safety filter triggers in an hour, cost up 200% on the daily average. Some of that is right and some of it trains people to ignore the pager.

My split:

**Page someone** only for things that mean users can't get an answer right now:

- Sustained 5xx or timeout rate above the feature's own baseline.
- Sustained 429 throttling on a deployment that serves interactive traffic.
- Availability test failures on the user-facing endpoint.

**Daily digest** for things that need a decision today but not at 3 am:

- Token spend per feature against budget. A cost spike is real money, but it's a conversation with the feature owner, not an outage. Per-feature spend is your own telemetry, not a platform metric, so emit tokens per feature as a custom metric (or alert with a log search rule) and use [dynamic thresholds](https://learn.microsoft.com/azure/azure-monitor/alerts/alerts-dynamic-thresholds) rather than a fixed percentage, because usage has a weekly shape. Route it to email or a ticket, not the pager.
- Content filter blocks by deployment. A jump usually means a new user population or a prompt change, which is a product question.
- Top failed or refused queries.

**Weekly review** for things that only make sense as trends:

- Sampled quality scores and the feedback ratio, broken down by what changed (next section).
- A small random sample of conversations read by a person.
- Drift in what users are asking, which tells you when the retrieval corpus or the prompt no longer fits the traffic.

Safety filter triggers are the one I'd argue about most. Paging on them sounds responsible, but a filter block is the system working. What needs a human is the pattern, so it belongs in the digest and the review.

## Record what changed, not just what happened

When quality drops in an AI feature, the cause is rarely the infrastructure. It's a change: someone edited the system prompt, the search index was rebuilt with a new chunking strategy, a content filter configuration was tightened, or the model version underneath the deployment moved.

That last one surprises people. An Azure OpenAI deployment has a version upgrade policy, and depending on how it was created it may move to a new default model version within about two weeks of that version becoming the default (`OnceNewDefaultVersionAvailable`), only when the current version retires (`OnceCurrentVersionExpired`), or never (`NoAutoUpgrade`, which means it stops working at retirement). A deployment with no policy set behaves as `OnceCurrentVersionExpired`. Microsoft's [guide to working with models](https://learn.microsoft.com/azure/foundry/openai/how-to/working-with-models) explains the options and their API values. Whichever you choose, record the model version the service actually ran, because the deployment name you send in the request won't tell you.

So every model call should carry the versions of the things that shape the answer. A fragment, using the `openai` 2.x Python SDK against the Azure OpenAI v1 endpoint with Entra ID auth, and the Azure Monitor OpenTelemetry Distro:

```python
import uuid

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from azure.monitor.opentelemetry import configure_azure_monitor
from openai import OpenAI
from opentelemetry import trace

# Reads APPLICATIONINSIGHTS_CONNECTION_STRING from the environment.
configure_azure_monitor()
tracer = trace.get_tracer("support-assistant")

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)
client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=token_provider,
)

PROMPT_VERSION = "answer-v14"       # bump on every prompt edit
INDEX_VERSION = "kb-2026-02-09"     # bump on every index rebuild


def answer(question: str, context: str) -> dict:
    with tracer.start_as_current_span("answer_question") as span:
        span.set_attribute("app.prompt_version", PROMPT_VERSION)
        span.set_attribute("app.index_version", INDEX_VERSION)

        response = client.chat.completions.create(
            model="<your-deployment-name>",
            messages=[
                {"role": "system", "content": "Answer only from the context provided."},
                {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"},
            ],
        )

        # The model version the service ran, e.g. a dated version string,
        # not the deployment name sent in the request.
        span.set_attribute("app.response_model", response.model)
        answer_id = str(uuid.uuid4())
        span.set_attribute("app.answer_id", answer_id)

        return {"answer_id": answer_id, "text": response.choices[0].message.content}


def record_feedback(answer_id: str, rating: str) -> None:
    # Called by the feedback endpoint with what the client sent: an ID and a rating.
    # The versions are joined from the answer_question span at query time.
    with tracer.start_as_current_span("user_feedback") as span:
        span.set_attribute("app.answer_id", answer_id)
        span.set_attribute("app.feedback", rating)  # "positive" or "negative"
```

I deliberately don't let the client send the prompt or model version back with the rating: anything the browser echoes can be spoofed, and it goes stale the moment a cached page outlives a deployment. The feedback span carries only the answer ID and the rating, and the query joins it to the answer that produced it.

With no web framework in front of it, these internal spans land in the Application Insights `dependencies` table with their attributes in `customDimensions`. The weekly review query then becomes a comparison across versions rather than a single trend line:

```kusto
let answers = dependencies
    | where timestamp > ago(21d) and name == "answer_question"
    | project answerId = tostring(customDimensions["app.answer_id"]),
              answeredAt = timestamp,
              promptVersion = tostring(customDimensions["app.prompt_version"]),
              modelVersion = tostring(customDimensions["app.response_model"]);
dependencies
| where timestamp > ago(14d) and name == "user_feedback"
| project answerId = tostring(customDimensions["app.answer_id"]),
          rating = tostring(customDimensions["app.feedback"]),
          itemCount
| join kind=leftouter answers on answerId
| summarize ratings = sum(itemCount), negative = sumif(itemCount, rating == "negative"),
            firstSeen = min(answeredAt)
    by promptVersion, modelVersion
| extend negativePct = round(100.0 * negative / ratings, 1)
| order by firstSeen desc
```

Rows are ordered by when each prompt and model combination first answered a question, so the newest is at the top; sorting the version strings would put `answer-v9` above `answer-v14`.

The `sum(itemCount)` matters. Since version 1.8.6 (released on 5 February 2026), the Azure Monitor OpenTelemetry Distro defaults to a rate-limited sampler of five traces per second, so under load each stored span stands in for several, and `count()` would undercount. Sampling also means some feedback won't find its answer, which shows up as a blank version row rather than disappearing. That's fine for spotting a trend; feedback you need to count exactly belongs in a store you control, not in sampled telemetry.

The same attributes work for sampled evaluation scores. What matters is that "quality dropped on Tuesday" becomes "quality dropped for prompt v14 on the new model version", which an engineer can act on. For deployments of the app itself, [release annotations](https://learn.microsoft.com/azure/azure-monitor/app/failures-performance-transactions#release-annotations) in Application Insights mark the change on the charts.

## Reading conversations without creating a privacy problem

The weekly human review is the most valuable thing on the list and the easiest to get wrong. You can't review conversations you didn't keep, and you shouldn't keep conversations you can't protect.

The OpenTelemetry instrumentation for OpenAI doesn't capture prompt and completion content by default, which is the right default. If you turn content capture on, decide first where it goes, who can read it and how long it's retained. My preference is to keep content capture off in the main telemetry stream and write a separate, sampled, redacted conversation log to storage with tighter access, tied back to traces by the answer ID. That keeps engineers' everyday dashboards free of customer text while still giving the review something to read.

## When not to build all of this

An internal prototype with a dozen users doesn't need four layers and a weekly review. Platform metrics, a log line with token counts and a feedback button are enough until someone with a budget starts asking questions. The business layer in particular needs a product that has settled on what it's for; instrumenting acceptance rate on something that changes shape every sprint is wasted effort.

Equally, don't let tooling stand in for the rhythm. A dashboard nobody opens on a schedule is decoration.

## If you only do three things

1. **Track cost daily, by feature.** Know what you're spending before the invoice tells you.
2. **Tag every answer with what produced it.** Prompt version, index version and the model version actually served. Without that, quality trends can't be explained.
3. **Keep a sampled, redacted record of conversations and read it weekly.** Automated scores tell you something moved; reading the answers tells you why.

You can't monitor an AI feature the way you monitor uptime, because there's no binary working or broken. What you can do is make every change visible and put a person in front of the trend on a fixed schedule. That's most of the job.
