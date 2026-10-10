---
title: "Output Contracts: Catch a Model Swap Before Downstream Systems Do"
description: "Structured outputs fix the shape of a model's answer, not its meaning: a two-layer contract between a Foundry model and the systems that consume it."
author: Michael John Peña
draft: false
date: 2026-05-02
tags:
  - Microsoft Foundry
  - Azure OpenAI
  - LLMOps
  - Structured Output
  - Python
  - Testing
---

Most model regressions don't show up as errors. A new model version returns a confident answer with a slightly different category label, a missing order number or a refund amount in the wrong field, and the ticketing system, data pipeline or workflow downstream accepts it because nothing told it not to. By the time someone notices, bad records have been written and the model swap is days old. The fix I keep coming back to is boring: put an explicit contract at the boundary between the model and whatever consumes its output, check it on every call, and run the same contract against a candidate model before it gets any traffic.

This sits alongside the earlier posts in this series. The [upgrade policy post](/blog/2026-03-30-operating-ai-apps-with-foundry-using-foundry-for-safer-model-lifecycle-management/) covers when Foundry changes your model for you, and the [canary post](/blog/2026-04-21-foundry-decisions-i-stand-behind-using-foundry-for-safer-model-lifecycle-management/) covers moving live traffic. This one is about the boundary itself: what a model is allowed to hand to the next system.

## Structured outputs solve half the problem

[Structured outputs](https://learn.microsoft.com/azure/foundry/openai/how-to/structured-outputs) in Azure OpenAI make the model follow a JSON Schema you send with the request. It works on both the Chat Completions and Responses APIs, on the GA `v1` endpoint, and on the models most teams are running now, including gpt-4.1 2025-04-14 and gpt-5.1 2025-11-13. Compared with the older JSON mode, which only guaranteed valid JSON, this is a real improvement: the shape of the answer is no longer something you hope for.

But the schema subset is deliberately narrow. Every field must be required, every object needs `additionalProperties: false`, and a schema can have up to 100 object properties with five levels of nesting. More importantly, the keywords that carry business rules aren't supported: `pattern`, `format`, `minLength` and `maxLength` on strings; `minimum`, `maximum` and `multipleOf` on numbers; `minItems` and `maxItems` on arrays.

That leaves a gap. The service can guarantee that `order_id` is a string. It can't guarantee that the string looks like an order number, that a refund amount is positive, or that a summary fits in the 280-character column your ticketing system has. Those are exactly the rules a new model version is most likely to break, because they live in your prompt and the model's habits, not in the schema.

So I treat the contract as two layers:

| Layer | Enforced by | Catches | Misses |
|---|---|---|---|
| Shape | The service, via strict JSON Schema | Missing fields, wrong types, labels outside an enum, extra keys | Anything about values |
| Semantics | Your code, after parsing | Malformed IDs, out-of-range numbers, overlong text, contradictions between fields | Answers that are valid but wrong |

The last cell is the honest limit. A contract tells you the output is safe to consume, not that it's correct. Correctness still needs evaluation, which is why the same contract runs in a test suite as well as at runtime.

## The runtime boundary

The pattern is: parse into a typed object, apply business rules, and on any failure quarantine the input instead of passing something half-right downstream. Every outcome is logged as either accepted or quarantined with a problem code, and whenever the model produced an answer the line carries the `model` value the service returned, so a spike in contract failures can be tied to a specific model version.

The example is ticket triage. It uses the v1 endpoint with Microsoft Entra ID, the Responses API and `openai` 2.33.0 (28 April 2026). Note that the Pydantic model has no `Field(ge=0)` or `max_length` constraints: those would generate the unsupported keywords above, so the business rules live in a separate function.

```bash
pip install "openai==2.33.0" "pydantic==2.13.3" "azure-identity==1.25.3" "pytest==9.0.3"
```

```python
"""triage.py: a model call with a two-layer output contract."""
import functools
import json
import logging
import os
import re
from typing import Literal, Optional

import openai
import pydantic
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import OpenAI
from pydantic import BaseModel, Field

log = logging.getLogger("triage-contract")

CONTRACT_VERSION = "triage-v3"
ORDER_ID = re.compile(r"ORD-\d{8}")
MAX_SUMMARY_CHARS = 280
MAX_REFUND_AUD = 5000.0

INSTRUCTIONS = (
    "Classify the customer message. Use null for order_id and refund_amount_aud "
    "when the message doesn't state them. Order IDs look like ORD-12345678. "
    "Keep the summary under 280 characters."
)


# Layer 1: shape. Only keywords the structured outputs schema subset supports.
class Triage(BaseModel):
    category: Literal["billing", "delivery", "product_fault", "account", "other"]
    priority: Literal["low", "normal", "urgent"]
    order_id: Optional[str] = Field(description="Order ID such as ORD-12345678, or null")
    refund_amount_aud: Optional[float] = Field(description="Refund requested in AUD, or null")
    summary: str


# Layer 2: semantics. The rules the schema can't express.
def contract_violations(t: Triage) -> list[str]:
    problems = []
    if t.order_id is not None and not ORDER_ID.fullmatch(t.order_id):
        problems.append("order_id_format")
    if t.refund_amount_aud is not None and not 0 < t.refund_amount_aud <= MAX_REFUND_AUD:
        problems.append("refund_out_of_range")
    if t.refund_amount_aud is not None and t.category != "billing":
        problems.append("refund_outside_billing")
    if len(t.summary) > MAX_SUMMARY_CHARS:
        problems.append("summary_too_long")
    return problems


@functools.lru_cache(maxsize=1)
def get_client() -> OpenAI:
    """Build the client on first use, so importing this module needs no configuration."""
    resource = os.environ.get("AZURE_OPENAI_RESOURCE")
    if not resource:
        raise RuntimeError("Set AZURE_OPENAI_RESOURCE to your resource name, e.g. <your-resource-name>")
    token_provider = get_bearer_token_provider(DefaultAzureCredential(), "https://ai.azure.com/.default")
    return OpenAI(base_url=f"https://{resource}.openai.azure.com/openai/v1/", api_key=token_provider)


def triage(message: str, deployment: str) -> Optional[Triage]:
    """Return a Triage that passed both layers, or None if the input was quarantined."""
    outcome = {"contract": CONTRACT_VERSION, "deployment": deployment}
    try:
        response = get_client().responses.parse(
            model=deployment,
            instructions=INSTRUCTIONS,
            input=message,
            text_format=Triage,
            max_output_tokens=2000,
            store=False,
        )
    except openai.BadRequestError as err:
        # Azure returns a 400 with code "content_filter" when the prompt is blocked.
        # Any other 400 is a configuration fault (schema, parameter, deployment), so fail loudly.
        if err.code != "content_filter":
            raise
        log.warning(json.dumps({**outcome, "result": "quarantined", "problems": ["content_filtered"]}))
        return None
    except pydantic.ValidationError:
        # Output that isn't valid JSON for the schema, typically cut off by max_output_tokens.
        log.warning(json.dumps({**outcome, "result": "quarantined", "problems": ["unparseable"]}))
        return None

    outcome["model"] = response.model  # the model and version that actually answered
    parsed = response.output_parsed
    if parsed is None:
        # A refusal, or no text output at all.
        log.warning(json.dumps({**outcome, "result": "quarantined", "problems": ["no_parsed_output"]}))
        return None

    problems = contract_violations(parsed)
    if problems:
        log.warning(json.dumps({**outcome, "result": "quarantined", "problems": problems}))
        return None

    log.info(json.dumps({**outcome, "result": "accepted"}))
    return parsed


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    result = triage(
        "I was charged twice for ORD-20260417 and need $89.95 back.",
        os.environ.get("TRIAGE_DEPLOYMENT", "triage-gpt-41-2025-04-14"),
    )
    print(result.model_dump_json(indent=2) if result else "quarantined")
```

A few decisions in there are worth defending.

**Quarantine, don't repair.** It's tempting to retry with "your last answer was invalid, fix it", or to truncate the summary and move on. For a one-off failure a single retry is reasonable. As a default it hides the signal you most need: a rising failure rate after a model change. I'd rather route the message to a human queue or a dead-letter store, count it, and let the count decide whether something is wrong.

**The contract has a version.** `CONTRACT_VERSION` goes into every log line. When the schema or a rule changes, you can separate "the model got worse" from "we tightened the rules" without reading commit history.

**Problems are codes, not prose.** `order_id_format` and `refund_outside_billing` can be counted per model in a dashboard. Free-text error messages can't.

**Transient failures aren't contract failures.** A rate limit (429) or a timeout says nothing about the input, so the code lets `openai.RateLimitError` and `openai.APIConnectionError` propagate after the SDK's built-in retries. The caller should retry the message later, not quarantine it. A content-filter rejection is different: retrying the same input gets the same answer, so it gets a problem code like any other failure. Every other 400 is re-raised on purpose. An unsupported schema keyword, a deployment that doesn't support structured outputs or a parameter the new model rejects would fail every request, and quarantining those would make a configuration fault look like a model regression. Configuration errors should break the build or page someone, not fill the quarantine queue.

**Prompts and answers stay out of the log.** The outcome line is metadata. If you need examples of failures to debug, capture them through a separate, approved path with the data handling your organisation requires.

The caller needs the Cognitive Services OpenAI User role on the Foundry resource. Requests use `store=False` because the Responses API otherwise [keeps responses for 30 days](https://learn.microsoft.com/azure/foundry/openai/how-to/responses), and a triage call has no use for stored state.

## The same contract, before the swap

At runtime the contract limits the damage. The bigger win is running it before a candidate model gets any traffic. The test below takes a deployment name from the environment and runs a fixed set of messages through `triage()`. Run it against the current deployment to set a baseline, then against the candidate in CI.

```python
"""test_triage_contract.py: run with TRIAGE_DEPLOYMENT set to the deployment under test."""
import os

import pytest

from triage import triage

DEPLOYMENT = os.environ.get("TRIAGE_DEPLOYMENT")

# Each case: message, expected category, expected order_id (None means none stated).
CASES = [
    ("I was charged twice for ORD-20260417 and need $89.95 back.", "billing", "ORD-20260417"),
    ("Parcel for order ORD-20260388 says delivered but nothing arrived.", "delivery", "ORD-20260388"),
    ("The kettle I bought last week trips the safety switch.", "product_fault", None),
    ("I can't reset my password, the email never comes through.", "account", None),
    ("Do you have a store in Parramatta?", "other", None),
]


# Pass rate the current deployment scored on this suite; update it when the baseline changes.
BASELINE_PASS_RATE = float(os.environ.get("TRIAGE_BASELINE_PASS_RATE", "0.8"))

needs_deployment = pytest.mark.skipif(not DEPLOYMENT, reason="TRIAGE_DEPLOYMENT not set")


@pytest.fixture(scope="module")
def results():
    """Call the deployment once per case and share the results between tests."""
    return [(case, triage(case[0], DEPLOYMENT)) for case in CASES]


@needs_deployment
def test_contract_holds_for_every_case(results):
    # Strict: any quarantined output fails the build.
    quarantined = [case[0] for case, result in results if result is None]
    assert not quarantined, f"quarantined by the contract: {quarantined}"


@needs_deployment
def test_expectations_meet_baseline(results):
    # Aggregate: the candidate may miss individual cases, but not more often than the baseline.
    passed = sum(
        1
        for (_, category, order_id), result in results
        if result is not None and result.category == category and result.order_id == order_id
    )
    pass_rate = passed / len(results)
    assert pass_rate >= BASELINE_PASS_RATE, f"pass rate {pass_rate:.0%} is below baseline {BASELINE_PASS_RATE:.0%}"
```

Five cases is a sketch. A useful suite has a few dozen messages per category, including the awkward ones that have caused incidents: two order numbers in one message, a refund request with no amount, a message in another language. That's why the test is split in two. The contract test is strict: one quarantined output fails the build. The category and `order_id` checks are closer to an evaluation, so they're scored as a pass rate over the whole suite and compared with the rate the current model achieved, set through `TRIAGE_BASELINE_PASS_RATE`. The pipeline fails only when the candidate does worse than the model it replaces.

Running the candidate needs its own deployment, for example `triage-gpt-51-2025-11-13`. That matters more than usual right now: on the [model retirement schedule](https://learn.microsoft.com/azure/foundry/openai/concepts/model-retirement-schedule), gpt-4.1 2025-04-14 retires on 14 October 2026. [Standard, Global Standard and Data Zone deployments](https://learn.microsoft.com/azure/foundry/openai/concepts/model-retirements) set to auto-update are moved to the replacement Microsoft names before retirement; if none is named, or the deployment is set to no auto-upgrade, it stops serving requests on the retirement date. Provisioned deployments are never auto-upgraded. As of this writing the schedule lists no replacement for gpt-4.1, and either way the outcome doesn't wait for this suite to run. Running it in May means you choose the replacement instead of finding out from the quarantine count in October.

Model families also differ in how they handle request parameters. gpt-5.1 is a reasoning model and [defaults to a reasoning effort of `none`](https://learn.microsoft.com/azure/foundry/openai/how-to/reasoning), and, like other reasoning models, it rejects sampling parameters such as `temperature` and `top_p`, which gpt-4.1 accepts. The example sets neither, so the same call works on both. If you tune them, keep the settings next to each deployment name and run the suite against each combination.

## When this is more than you need

If a person reads every answer before anything happens, as with a chat assistant or a drafting tool, the person is the contract. Structured outputs alone are fine there, and a semantic layer adds code without protecting anything.

If the output is free text by design, such as a summary emailed to a human, there's no schema worth enforcing. Spend the effort on evaluation instead.

And if the schema is so loose that every field is an optional string, the contract will pass everything. That's usually a sign the model is doing a job that should be split: extract the fields you can define strictly, and leave the rest as free text with a person in the loop.

## What I'd put in place first

For any model output that another system writes, routes or acts on, I'd add three things this week: a strict schema on the call, a semantics function that encodes the rules the schema can't, and a quarantine path that logs problem codes with the `model` value attached. Then point the same function at a test suite and run it against the replacement for whatever model you're on before its retirement date. Structured outputs made the shape of a model's answer reliable. What the values mean is still your code's job.
