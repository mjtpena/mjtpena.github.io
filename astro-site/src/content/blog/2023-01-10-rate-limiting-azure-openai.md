---
title: "Throttling in the Azure OpenAI Preview: Pacing Per-Deployment Requests"
description: "Azure OpenAI preview limits are requests per second per deployment. How to pace calls, retry 429s properly and scale out with the openai 0.26 Python library."
author: Michael John Peña
draft: false
date: 2023-01-10
tags:
  - Azure OpenAI
  - Rate Limiting
  - Python
  - Resilience
  - Architecture
---

The first time an Azure OpenAI prototype meets real traffic, it usually fails the same way: a burst of parallel calls, a wall of HTTP 429 responses, and a retry loop that makes the problem worse. Azure OpenAI is still a limited-access preview as I write this, and its throttling model is simple but strict. If you design for it up front, a batch job or chat backend behaves predictably instead of falling over the moment someone runs it with eight threads.

## What the limits actually are right now

As of early January 2023, the [Azure OpenAI quotas and limits page](https://learn.microsoft.com/azure/ai-services/openai/quotas-limits) describes throttling as **requests per second per deployment**, not tokens. The values listed at the time:

| Limit | Value (January 2023 preview) |
|---|---|
| Requests per second per deployment | 20 for text-davinci-002, text-davinci-fine-tune-002, code-cushman-002, code-davinci-002 and code-davinci-fine-tune-002; 50 for all other text models |
| Azure OpenAI resources per region | 2 |
| Deploying the same model to multiple deployments in one resource | Not allowed |
| Max fine-tuned model deployments | 2 |

Three things follow from that table, and they shape everything else in this post.

First, the unit is **requests**, not tokens. A 20-token classification call and a 2,000-token summarisation call cost the same against the limit. That's different from what you may be used to on OpenAI's own API, and it means request count is the number to manage. Token count still matters for latency and your bill, but not for throttling.

Second, the limit is **per deployment**. Every process, container and notebook calling the same deployment shares one budget. A rate limiter that lives inside a single Python process only protects you if that process is the only caller.

Third, you can't scale up inside a resource by deploying the same model twice. The documented way to get more headroom is a support request to raise the limit, or another Azure OpenAI resource in the same or a different region with the load spread across them. Microsoft's own guidance on that page is short and sensible: implement retry logic, avoid sharp changes in workload, ramp up gradually, and distribute across resources.

The exact numbers have changed several times since the preview opened, so treat the table as a snapshot and check the page before you size anything.

## Retrying is necessary but not sufficient

Every client needs retry logic for 429s. The `openai` Python library (0.26.0 shipped on 6 January) raises `openai.error.RateLimitError` for a 429 and `openai.error.ServiceUnavailableError` for a 503, and both errors carry the response headers in `err.headers`. It doesn't retry them for you.

The mistake I see most often is retrying with a fixed sleep. Ten workers get throttled at the same moment, all sleep one second, and all come back at the same moment to be throttled again. The fix is well known: exponential backoff with jitter, so retries spread out. If the service sends a `Retry-After` header, honour it rather than guessing. The [Retry pattern](https://learn.microsoft.com/azure/architecture/patterns/retry) in the Azure Architecture Center covers the reasoning.

But retries alone treat the symptom. Each 429 is a wasted round trip, and under sustained load a retry-only client spends a large share of its time being rejected. If you know the limit, the cheaper approach is to not exceed it in the first place.

## Pace requests before they leave

Because the limit is requests per second, a token bucket that counts requests is the right shape for a client-side limiter. It allows a small burst, then refills at a steady rate. Put one bucket in front of each deployment and have every worker acquire from it before calling the API.

The script below is complete for `openai==0.26.0` against the `2022-12-01` API version. It defines two deployments in two resources, paces each one, retries throttled calls with jittered backoff, and spreads work across both.

```python
import os
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from itertools import cycle

import openai

RETRYABLE = (
    openai.error.RateLimitError,
    openai.error.ServiceUnavailableError,
    openai.error.Timeout,
    openai.error.APIConnectionError,
)


class RequestPacer:
    """Thread-safe token bucket that counts requests, not tokens."""

    def __init__(self, requests_per_second: float, burst: int = 2):
        self.rate = requests_per_second
        self.capacity = burst
        self.tokens = float(burst)
        self.updated = time.monotonic()
        self.lock = threading.Lock()

    def acquire(self) -> None:
        while True:
            with self.lock:
                now = time.monotonic()
                elapsed = now - self.updated
                self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
                self.updated = now
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                wait = (1 - self.tokens) / self.rate
            time.sleep(wait)


@dataclass
class Deployment:
    endpoint: str
    key: str
    name: str
    pacer: RequestPacer = field(repr=False)


def retry_delay(err: Exception, attempt: int, base: float = 1.0, cap: float = 30.0) -> float:
    headers = getattr(err, "headers", None) or {}
    # Azure may not send Retry-After at all; when it does, honour it but never wait past the cap.
    retry_after = headers.get("Retry-After")
    if retry_after is not None:
        try:
            return min(cap, float(retry_after))
        except ValueError:
            pass
    # Full jitter: a random delay between 0 and the exponential ceiling.
    return random.uniform(0, min(cap, base * 2 ** attempt))


def complete(deployment: Deployment, prompt: str, max_tokens: int = 200, max_attempts: int = 6) -> str:
    for attempt in range(max_attempts):
        deployment.pacer.acquire()
        try:
            response = openai.Completion.create(
                api_type="azure",
                api_base=deployment.endpoint,
                api_version="2022-12-01",
                api_key=deployment.key,
                engine=deployment.name,
                prompt=prompt,
                max_tokens=max_tokens,
                temperature=0,
            )
            return response["choices"][0]["text"].strip()
        except RETRYABLE as err:
            if attempt == max_attempts - 1:
                raise
            delay = retry_delay(err, attempt)
            print(f"{deployment.name}: {type(err).__name__}, retrying in {delay:.1f}s")
            time.sleep(delay)


if __name__ == "__main__":
    deployments = [
        Deployment(
            endpoint="https://<your-resource-name-1>.openai.azure.com/",
            key=os.environ["AZURE_OPENAI_KEY_1"],
            name="<your-davinci-002-deployment>",
            pacer=RequestPacer(requests_per_second=10),
        ),
        Deployment(
            endpoint="https://<your-resource-name-2>.openai.azure.com/",
            key=os.environ["AZURE_OPENAI_KEY_2"],
            name="<your-davinci-002-deployment>",
            pacer=RequestPacer(requests_per_second=10),
        ),
    ]

    tickets = [f"Ticket {i}: customer cannot reset their password." for i in range(100)]
    prompts = [f"Classify this support ticket as billing, access or other.\n\n{t}\n\nCategory:" for t in tickets]

    targets = cycle(deployments)
    jobs = [(next(targets), p) for p in prompts]

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda job: complete(job[0], job[1], max_tokens=5), jobs))

    for ticket, label in zip(tickets[:5], results[:5]):
        print(f"{label:<8} {ticket}")
```

A few decisions in there are worth explaining.

**Pace at half the documented limit.** I set 10 requests per second against the documented 20 for text-davinci-002 because the bucket only sees this process. Your colleague's notebook, a test run in CI and the playground in Azure OpenAI Studio all draw from the same deployment. Start with generous headroom and raise it once you've watched real 429 counts.

**Keep the burst small.** A large bucket capacity lets a cold client fire a dozen requests in the first instant, which is exactly the sharp change in workload the docs warn about. Two is plenty.

**Size the worker pool to the rate.** Concurrency caps throughput too. With 8 workers and roughly a second of latency per completion, the pool tops out near 8 requests per second in total, below the 20 the two pacers allow, so the pacer never engages. Size `max_workers` to roughly the target rate multiplied by typical latency.

**Acquire before every attempt, including retries.** A retry is a request. If retries bypass the pacer, a throttling event turns into a bigger burst.

**Pass connection settings per call.** The 0.x library defaults to module-level globals (`openai.api_base`, `openai.api_key`). Module-level globals can describe only one resource; mutating them per request from several threads is a race, so pass `api_base`, `api_key`, `api_type` and `api_version` on each `create` call instead.

**Round-robin is deliberately dumb.** A smarter router would prefer whichever deployment has spare capacity, or fail over when one region is degraded. For a batch job, even distribution across identical deployments is enough. For an interactive app, I'd invest in failover before I'd invest in clever balancing.

## When the limiter belongs somewhere else

An in-process bucket works when one process owns the workload: a nightly enrichment job, a backfill, a script. It stops being enough when several app instances share a deployment, because each instance paces itself without knowing about the others.

At that point you have two reasonable options:

- **A shared limiter.** Put the bucket's state in Azure Cache for Redis so all instances draw from one budget. It's more moving parts, and the limiter itself becomes something you have to keep available.
- **A gateway in front of the deployments.** Azure API Management can sit in front of Azure OpenAI and enforce a request rate centrally with the [`rate-limit-by-key` policy](https://learn.microsoft.com/azure/api-management/rate-limit-by-key-policy), keyed on the calling app or user. That also gives you one place to hold the Azure OpenAI keys, log usage per consumer and route to more than one backend. I lean this way for anything with more than one consuming team, because per-consumer limits stop one noisy app from starving the rest.

The gateway is overkill for a single internal tool with one caller. Don't build it on day one of a proof of concept.

## Queue the work that can wait

The other lever is to stop treating every call as synchronous. If a request doesn't need an answer in the next second (document summaries, ticket classification, nightly enrichment), put it on a queue such as Azure Service Bus or a Storage queue and let a fixed pool of workers drain it at the paced rate. Throttling then shows up as queue depth, which is easy to monitor and explain, rather than as errors in front of users. The [Queue-Based Load Leveling pattern](https://learn.microsoft.com/azure/architecture/patterns/queue-based-load-leveling) describes this well.

Keep the interactive path separate. A chat feature and a bulk backfill should not share a deployment if you can avoid it, because the backfill will happily consume the whole budget. With the current rule of one deployment per model per resource, that separation usually means a second resource.

## What to measure

You can't tune pacing without numbers. At minimum, log every throttled call with the deployment name, the HTTP status and how long you waited, and count successful calls per deployment per minute. If 429s stay near zero at your current pace, you have room to raise it. If they climb as soon as other workloads start, that's your evidence for a limit increase request or a second resource, and support will ask for exactly that resource ID, region and deployment name.

## My take

For January 2023, the practical rule is short: the limit is requests per second per deployment, so count requests and pace them. Every client gets jittered backoff that respects `Retry-After`. Any batch workload gets a pacer set well under the documented limit. Once several apps share a deployment, move the limit out of the process and into a shared limiter or an API Management gateway. And don't expect a single deployment to absorb unlimited growth. More resources across regions, plus a queue for anything that can wait, is how you scale today.

If you're still deciding between Azure OpenAI and OpenAI's own API, the throttling model is one more difference to weigh. I compared the two in [Azure OpenAI vs OpenAI API](/blog/2023-01-07-azure-openai-vs-openai-api/).
