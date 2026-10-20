---
title: "LLMs on an Event Hubs Stream: Tiered Triage with Azure Functions"
description: "How to put Azure OpenAI inside an Event Hubs pipeline without stalling partitions: batch triggers, a cheap triage tier, structured outputs, fail-closed errors."
author: Michael John Peña
draft: false
date: 2025-01-31
tags:
  - Azure OpenAI
  - Azure Functions
  - Event Hubs
  - Streaming
  - Event-Driven
---

Calling a large language model once per event looks easy in a demo and falls over in production. An Event Hubs partition is an ordered log that only moves forward, a model call takes hundreds of milliseconds to seconds, and your Azure OpenAI deployment has a token quota that a busy stream will exhaust in minutes. The hard parts are batching, back-pressure, and what happens when the model is slow, throttled, or wrong; the prompt is the easy bit.

A note on terms, because "real-time AI" has become overloaded. This post is not about token streaming to a chat UI (I covered that in [streaming responses with Azure OpenAI](/blog/2023-03-11-streaming-responses-azure-openai/)), and it is not about the `gpt-4o-realtime-preview` audio model, which has been in public preview in Azure OpenAI since October 2024. It is about *stream processing*: events arriving continuously, and an LLM as one stage in the pipeline.

## The shape that works: triage, then escalate

The pattern I recommend is two tiers, decoupled by a second event hub:

1. A **triage function** reads the main stream in batches, sends each event to a small, cheap model (a `gpt-4o-mini` deployment), and gets back a constrained verdict.
2. Anything flagged goes to a **review hub**. A separate function consumes that hub and does the expensive work: a `gpt-4o` call with customer history, retrieval, or a human hand-off.

The decoupling is the important part. If the expensive tier sat inline, one slow call would hold up every event behind it on that partition, because the Functions Event Hubs trigger processes a partition's batches in order. With a second hub, the triage tier keeps pace with the source and the review tier can lag, scale and retry on its own schedule.

A single function that calls both models inline is simpler, and it's fine at a few events per second. Above that, it becomes a liability.

## How the trigger actually behaves

Three facts about the Event Hubs trigger drive most of the design. All are in Microsoft's guide to [reliable event processing with Functions and Event Hubs](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reliable-event-processing):

- **The checkpoint advances whether your function succeeds or throws.** Functions does this deliberately to avoid poison-message deadlocks. If your code catches nothing and the model call fails, those events are gone from this consumer group's point of view.
- **Delivery is at-least-once.** If an instance crashes or times out mid-batch, the checkpoint is not written and the batch is replayed. Every side effect needs to be idempotent, keyed on something like the transaction ID.
- **Retry policies hold the partition.** With the Event Hubs extension 5.x you can attach a retry policy; the checkpoint is not written until retries finish, so a long backoff pauses that partition. That is what you want for transient throttling and what you don't want for a permanently bad event.

Batching is controlled in `host.json`. In the 5.x extension that the v4 extension bundle uses, the defaults are `maxEventBatchSize: 10`, `prefetchCount: 300` and `batchCheckpointFrequency: 1` ([6.x raised `maxEventBatchSize` to 100](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-event-hubs#hostjson-settings)). For LLM work, size the batch deliberately rather than taking the default: larger batches mean fewer invocations but a bigger burst against requests-per-minute and a larger replay on retry. I use 16 here, which is two rounds through the eight concurrency slots in the code below, so a batch finishes in roughly two model-call latencies and a replay costs at most 16 calls:

```json
{
  "version": "2.0",
  "extensions": {
    "eventHubs": {
      "maxEventBatchSize": 16,
      "prefetchCount": 128,
      "batchCheckpointFrequency": 1
    }
  }
}
```

Leave `batchCheckpointFrequency` at 1. Raising it saves a few storage writes but widens the replay window, and every replayed event is another paid model call.

## The triage function

This uses the Python v2 programming model (`azure-functions` 1.21), the `openai` 1.x SDK's `AsyncAzureOpenAI` client with Microsoft Entra ID authentication, and the GA Azure OpenAI API version `2024-10-21`, which supports [structured outputs](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs). Structured outputs work with `gpt-4o-mini` version `2024-07-18` and `gpt-4o` version `2024-08-06`, so the verdict is schema-valid JSON rather than "JSON, probably".

```python
import asyncio
import json
import logging
import os
from typing import List, Literal

import azure.functions as func
from azure.eventhub import EventData
from azure.eventhub.aio import EventHubProducerClient
from azure.identity.aio import DefaultAzureCredential, get_bearer_token_provider
from openai import AsyncAzureOpenAI, RateLimitError
from pydantic import BaseModel, Field

app = func.FunctionApp()

credential = DefaultAzureCredential()

aoai = AsyncAzureOpenAI(
    # e.g. https://<your-resource-name>.openai.azure.com/
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    azure_ad_token_provider=get_bearer_token_provider(
        credential, "https://cognitiveservices.azure.com/.default"
    ),
    api_version="2024-10-21",
    timeout=10.0,
    max_retries=1,
)

review_producer = EventHubProducerClient(
    # e.g. <your-namespace>.servicebus.windows.net
    fully_qualified_namespace=os.environ["EVENTHUB_NAMESPACE"],
    eventhub_name="transactions-review",
    credential=credential,
)

# Caps concurrent model calls per instance, independent of batch size.
model_slots = asyncio.Semaphore(8)

SYSTEM_PROMPT = (
    "You triage card transactions for fraud review. "
    "Classify risk as low, medium or high and give a one-sentence reason. "
    "Do not repeat card numbers or personal details in the reason."
)


class RiskVerdict(BaseModel):
    risk: Literal["low", "medium", "high"]
    reason: str = Field(description="One sentence, no personal data")


async def classify(txn: dict) -> RiskVerdict:
    async with model_slots:
        completion = await aoai.beta.chat.completions.parse(
            model=os.environ["TRIAGE_DEPLOYMENT"],  # a gpt-4o-mini 2024-07-18 deployment
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(txn)},
            ],
            response_format=RiskVerdict,
            temperature=0,
            max_tokens=80,
        )
    verdict = completion.choices[0].message.parsed
    if verdict is None:  # the model refused
        raise ValueError(completion.choices[0].message.refusal or "no verdict")
    return verdict


async def publish_for_review(items: List[dict]) -> None:
    batch = await review_producer.create_batch()
    for item in items:
        event = EventData(json.dumps(item))
        try:
            batch.add(event)
        except ValueError:  # batch is full: send it and start another
            await review_producer.send_batch(batch)
            batch = await review_producer.create_batch()
            batch.add(event)
    if len(batch) > 0:
        await review_producer.send_batch(batch)


@app.retry(
    strategy="exponential_backoff",
    max_retry_count="4",
    minimum_interval="00:00:02",
    maximum_interval="00:00:30",
)
@app.event_hub_message_trigger(
    arg_name="events",
    event_hub_name="transactions",
    connection="EventHubConnection",
    consumer_group="llm-triage",
    cardinality=func.Cardinality.MANY,
)
async def triage(events: List[func.EventHubEvent], context: func.Context) -> None:
    to_review = []
    txns = []
    for e in events:
        try:
            txns.append(json.loads(e.get_body()))
        except ValueError:
            # Permanent failure: retrying won't fix a malformed body,
            # so route it to review instead of raising.
            logging.error("Unparseable event at sequence %s", e.sequence_number)
            to_review.append({
                "raw": e.get_body().decode("utf-8", errors="replace"),
                "sequence_number": e.sequence_number,
                "risk": "unknown",
                "reason": "unparseable",
            })

    results = await asyncio.gather(
        *(classify(t) for t in txns), return_exceptions=True
    )

    throttled = [t for t, r in zip(txns, results) if isinstance(r, RateLimitError)]
    if throttled:
        retry = context.retry_context
        if retry.retry_count < retry.max_retry_count:
            # Throttling is transient: fail the whole batch so the retry
            # policy replays it before the checkpoint moves.
            raise RuntimeError("Azure OpenAI throttled this batch; retrying")
        # Final attempt: the checkpoint advances after this, so fail closed.
        logging.warning("Retries exhausted; sending %d throttled events to review", len(throttled))

    for txn, result in zip(txns, results):
        if isinstance(result, RateLimitError):
            to_review.append({"txn": txn, "risk": "unknown", "reason": "triage throttled"})
        elif isinstance(result, Exception):
            # Timeout, refusal or other failure: fail closed, send to review.
            logging.warning("Triage failed for %s: %s", txn.get("id"), result)
            to_review.append({"txn": txn, "risk": "unknown", "reason": "triage failed"})
        elif result.risk != "low":
            to_review.append({"txn": txn, "risk": result.risk, "reason": result.reason})

    if to_review:
        await publish_for_review(to_review)
```

The app needs `EventHubConnection__fullyQualifiedNamespace`, `EVENTHUB_NAMESPACE`, `AZURE_OPENAI_ENDPOINT` and `TRIAGE_DEPLOYMENT` as app settings, plus `azure-functions`, `azure-eventhub`, `azure-identity`, `openai` and `pydantic` in `requirements.txt`. The function app's managed identity needs the *Cognitive Services OpenAI User* role on the Azure OpenAI resource and *Azure Event Hubs Data Receiver* and *Data Sender* on the namespace, plus *Storage Blob Data Owner* on the host storage account if `AzureWebJobsStorage` uses identity, because that account holds the trigger's checkpoints. No keys anywhere.

Malformed bodies go to the review hub with reason `unparseable` rather than raising. That is deliberate: a permanent failure must never raise into the retry policy, because it will fail identically on every attempt, hold the partition for the full backoff, and then be dropped when the checkpoint moves anyway.

## Decisions worth explaining

**Why a dedicated consumer group.** `llm-triage` gets its own checkpoints, so this pipeline can replay or fall behind without affecting the consumers that land raw events in storage or a database. Keep the LLM tier off the consumer group your system of record depends on.

**Why a semaphore as well as a batch size.** Batch size controls how many events arrive per invocation; the semaphore controls how many model calls are in flight. Azure OpenAI enforces both tokens-per-minute and requests-per-minute, and requests are evaluated over short windows, so a burst can be throttled even when your per-minute average looks fine. The [quotas and limits page](https://learn.microsoft.com/en-us/azure/foundry/openai/quotas-limits) explains how request limits are derived from your TPM allocation. Size the semaphore so `instances × slots` stays under what the deployment can sustain.

**Why fail closed.** A triage model that times out has told you nothing, and "nothing" should not mean "low risk". Sending unknowns to review costs a few extra downstream calls; silently passing them costs you the case the pipeline was built to catch. If your review tier can't absorb that, the fix is more triage capacity, not a quieter failure mode.

**Why the whole batch retries on a 429.** It is blunt: events that already succeeded get classified again. But it is the only way to keep the checkpoint from advancing past throttled events, and the replay cost is bounded by your batch size. That is another reason to keep batches small. The retry policy is finite, though, and the checkpoint advances once it is exhausted, so on the final attempt (`retry_count` equal to `max_retry_count`) the function stops raising and sends the still-throttled transactions to review with risk `unknown` and reason `triage throttled`. Without that fallback, "fail closed" would quietly become "drop after 30 seconds". Make the review consumer idempotent on transaction ID so a replay doesn't create duplicate cases.

**Why `max_retries=1` on the client.** The SDK's own retries are useful for a blip, but long in-function retries hold the invocation open with no visibility. I'd rather let one quick retry happen in the SDK and leave anything longer to the Functions retry policy, which shows up in logs and metrics.

## Latency and cost

Don't publish a latency number for this pipeline until you've measured it on your deployment, region and prompt. What I can say structurally: end-to-end latency is Event Hubs ingestion, plus batch wait, plus roughly (batch size / concurrency slots) rounds of model calls, each as slow as its slowest call, because `gather` waits for all of them and the semaphore queues the rest, plus the publish to the review hub. The model rounds dominate, which is another argument for a small model, a short prompt and a low `max_tokens` in the triage tier.

Cost scales with event volume, not with how interesting the events are. Before putting an LLM on the hot path, estimate events per day multiplied by tokens per call, and price it against the [Azure OpenAI pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/) for your deployment type. At high volume that number is often the argument for the next section.

## When not to do this

Most streaming "AI" doesn't need a language model, and I'd push back on any design that reaches for one first.

| Signal | Better first choice | When an LLM earns its place |
|---|---|---|
| Numeric spikes and drift in metrics | Stream Analytics [built-in anomaly detection](https://learn.microsoft.com/en-us/azure/stream-analytics/stream-analytics-machine-learning-anomaly-detection) or a z-score in your own code | Explaining an anomaly to a person after it's detected |
| Known fraud rules (velocity, geography, amount) | Rules or a trained classifier with a feature store | Free-text fields (merchant descriptors, notes) that rules can't parse |
| High-volume, low-value events (telemetry, clickstream) | Aggregate first, then infer on windows | Summarising a window, not every event |
| Hard sub-100 ms decision budgets | A model hosted in-process or on a managed online endpoint | Rarely; keep the LLM off the synchronous path |

A common variant runs an LLM on every metric value that crosses a z-score threshold. Detecting the anomaly with statistics and asking a model to explain it is a reasonable split; asking the model whether a number is anomalous is paying for a worse version of arithmetic.

If you are already on Microsoft Fabric, the same triage-then-escalate split applies to Eventstreams and Real-Time Intelligence, which I covered in [real-time AI patterns in Fabric](/blog/2024-11-24-real-time-ai/). For the routing side of the problem, choosing a model by latency budget, see [latency-based LLM routing](/blog/2024-07-09-latency-based-llm-routing/).

## The short version

Put a cheap, schema-constrained model on the stream, push anything interesting to a second hub, and do the expensive reasoning off the hot path. Keep batches small, cap concurrency below your quota, retry throttling at the batch level, treat failures as "needs review", and make every consumer idempotent because Event Hubs will replay. If the decision can be made with arithmetic or a rule, make it that way and save the model for the parts that are actually language.
