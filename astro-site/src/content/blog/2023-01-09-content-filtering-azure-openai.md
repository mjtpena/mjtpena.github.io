---
title: "Handling Content Filtering in the Azure OpenAI Completions API"
description: "How Azure OpenAI's preview content filter shows up in code: HTTP 400 prompts, content_filter finish reasons, and why you still need your own guardrails."
author: Michael John Peña
draft: false
date: 2023-01-09
tags:
  - Azure OpenAI
  - Content Safety
  - Responsible AI
  - Python
  - Security
---

Azure OpenAI Service runs every prompt and every completion through a content management system, and that system can reject your request or quietly empty a response. If your code only expects a 200 with text in `choices[0]`, a filtered call becomes a crash, a blank chat bubble, or a retry loop that burns quota. The filter is part of your API contract, so it needs handling as deliberate as rate limits or timeouts.

This post sticks to what the service documents today, in the limited-access preview, on the `2022-12-01` API version. For the wider governance side (use case review, human oversight, transparency), see my post on [responsible AI with Azure OpenAI](/blog/2023-01-08-responsible-ai-azure-openai/).

## What the filter actually is right now

Microsoft describes it as an ensemble of classification models that evaluates both the input prompt and the generated output for misuse. The [service overview](https://learn.microsoft.com/azure/ai-services/openai/overview) sums up the policy in one line: prompts and completions are evaluated against the content policy, and high severity content is filtered.

Three details matter more than that summary:

- **Blocking is currently switched off by default.** The [content filtering documentation](https://learn.microsoft.com/azure/ai-foundry/openai/concepts/content-filter) carries a note that the system is temporarily turned off while Microsoft makes improvements. It is still annotating harmful content, but the models won't block. If you want blocking on before it comes back, you open an Azure support request.
- **You don't get a category breakdown.** The completions API tells you *that* something was filtered, not *why*. There is no per-category score or severity in the response for you to inspect.
- **There is no self-service configuration.** You can't tune thresholds in the portal or per deployment. The filter is a platform behaviour, not a setting.

The first point catches people out. A team prototypes in the Azure OpenAI Studio playground, sees nothing blocked, and assumes their use case never trips the filter. Then blocking is reactivated and the production app starts returning errors it never handled. Write the handling code now, while nothing is firing, because you can't rely on testing to surface it.

## The four behaviours to design for

The documentation lists the scenarios, and they reduce to four outcomes your code has to recognise.

| What happened | HTTP status | How you detect it |
|---|---|---|
| Prompt judged inappropriate | 400 | Error object with `code: "content_filter"` and `param: "prompt"` |
| Generated output filtered | 200 | That choice's `finish_reason` is `content_filter` |
| Filter couldn't run in time | 200 | Choice contains `content_filter_result` with an `error` object |
| Everything passed | 200 | `finish_reason` is `stop` or `length` |

A few nuances sit inside that table.

**Prompt rejections fail the whole call**, streaming or not. The documented error message is just "The response was filtered", so there's nothing useful to parse. Don't build logic that string-matches error text looking for "hate" or "violence". Those words aren't there, and you'd be coupling your app to an error message that could change in any release.

**Output filtering is per choice.** If you ask for `n=3`, one generation can come back with `finish_reason: "content_filter"` while the other two are fine. In rare cases with long responses the service can return a partial result before the filter cuts in. My rule is to treat any filtered choice as unusable, even if it has some text, because you don't know what the rest of it would have said.

**Streaming changes the timing.** Segments are sent as they're completed, so the user may already have seen part of a response before the final chunk for that index arrives with `finish_reason: "content_filter"`. If you stream straight to a UI, you need a way to retract or replace what's on screen. If you can't do that, don't stream for that use case.

**Fail-open is the default.** If the filtering system is down or too slow, your request still succeeds and you'll find an error inside `content_filter_result`. For most internal tools that's the right trade-off: availability beats a moderation pass that didn't happen. For a public chatbot in a regulated industry it might not be. You get to decide, but only if you check for it.

## A guarded completion helper

Here's the pattern I'd put between application code and the service. It uses the `openai` Python package (0.26.x at the time of writing) with the Azure settings from the [Microsoft quickstart](https://learn.microsoft.com/azure/ai-services/openai/quickstart), and it returns an explicit outcome instead of raising for content decisions.

```python
import hashlib
import os
from dataclasses import dataclass
from typing import Optional

import openai

openai.api_type = "azure"
openai.api_base = os.environ["AZURE_OPENAI_ENDPOINT"]  # https://<your-resource-name>.openai.azure.com/
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT", "<your-deployment-name>")


@dataclass
class GuardedResult:
    outcome: str                # "ok", "prompt_filtered", "output_filtered", "unfiltered"
    text: Optional[str] = None


def pseudonymous_user(user_id: str) -> str:
    """Stable, non-reversible ID for the `user` parameter. Never send PII."""
    return hashlib.sha256(f"<your-salt>:{user_id}".encode()).hexdigest()[:32]


def guarded_completion(prompt: str, user_id: str, max_tokens: int = 200) -> GuardedResult:
    try:
        response = openai.Completion.create(
            engine=DEPLOYMENT,
            prompt=prompt,
            max_tokens=max_tokens,
            temperature=0.2,
            user=pseudonymous_user(user_id),
        )
    except openai.error.InvalidRequestError as err:
        # Prompt rejected: HTTP 400 with error.code == "content_filter"
        if err.code == "content_filter":
            return GuardedResult(outcome="prompt_filtered")
        raise

    choice = response["choices"][0]

    # Completion withheld (or cut short) by the filter
    if choice.get("finish_reason") == "content_filter":
        return GuardedResult(outcome="output_filtered")

    # The filter could not run in time; the request still succeeded
    filter_result = choice.get("content_filter_result") or {}
    if "error" in filter_result:
        return GuardedResult(outcome="unfiltered", text=choice["text"].strip())

    return GuardedResult(outcome="ok", text=choice["text"].strip())


if __name__ == "__main__":
    result = guarded_completion("Explain cloud computing in one sentence.", user_id="user-123")
    print(result)
```

Some design choices worth calling out.

**Check `err.code`, not the message.** The 0.x `openai` library puts the error code from the response body on the exception, so `content_filter` is a stable value to branch on. Any other `InvalidRequestError` (bad parameters, a prompt over the context length) is still raised, because those are bugs, not content decisions.

**Return outcomes, don't raise them.** A filtered prompt is an expected business event, not an exception. Returning a typed outcome makes the caller choose what the user sees, and it keeps filtered requests out of your error-rate alerts. Otherwise those alerts end up triggered by users rather than by your system.

**Send a pseudonymous `user`.** The content filtering guidance asks multi-user applications to pass a unique end-user identifier with each call to help Microsoft detect misuse, and the [REST reference](https://learn.microsoft.com/azure/ai-services/openai/reference) is explicit: no PII, use pseudonymised values such as GUIDs. A salted hash of your internal ID gives you a stable value without leaking an email address. It also means that if Microsoft raises an abuse concern, you can trace it back to an account in your own system.

**Pass the `unfiltered` outcome up.** The helper still returns the text, but the caller can decide whether to show it, hold it for review, or swap in a fallback. That's where the fail-open versus fail-closed decision lives, and it should be a conscious, per-feature choice.

## What to show the user

For `prompt_filtered`, tell people plainly that the request couldn't be processed and ask them to rephrase. Don't guess at a reason. You don't know which category fired, and a wrong guess ("your message contained hate speech") is worse than a neutral message. For `output_filtered`, the user did nothing wrong, so say something closer to "I couldn't generate a response to that". Offer a retry only if the prompt is likely to produce something different. At low temperature it usually won't.

Log every outcome with the pseudonymous user ID, the deployment, and a hash of the prompt rather than the prompt itself. That gives you the signal you need (which feature, which users, what rate) without building a second store of potentially harmful text that someone then has to secure and govern.

## The filter is a floor, not your safety design

I'd push back on the idea that the platform filter is the safety layer. It's built for clearly harmful content at high severity, it's generic across every customer, and at the moment it isn't even blocking by default. It knows nothing about your domain. It won't stop a customer service bot from inventing a refund policy, leaking another customer's details through a badly designed prompt, or giving financial advice you're not licensed to give.

Those risks belong to you, and Microsoft's own [transparency note for Azure OpenAI](https://learn.microsoft.com/legal/cognitive-services/openai/transparency-note) frames them that way: evaluate the harms for your scenario and add scenario-specific mitigations. In practice that means:

- Constraining the task in the prompt and limiting `max_tokens` so the model has less room to wander.
- Validating input before it reaches the model (length, format, and topic checks for narrow use cases).
- Checking output against your own rules before display, especially for anything that looks like advice, personal data, or a commitment on behalf of the business.
- Keeping a human in the loop for high-impact outputs.

This is also why the access process matters. Azure OpenAI is a [Limited Access](https://learn.microsoft.com/legal/cognitive-services/openai/limited-access) service, and solutions go through a use case review before production. The review will ask what mitigations you have beyond the platform defaults. "The content filter handles it" is not a good answer.

## When not to lean on it

Don't use the content filter as a moderation service for user-generated content that never goes to a model. It's not exposed as a standalone API, it gives you no categories, and you'd be paying for completions to get a yes/no. Use a purpose-built moderation tool for that.

Don't depend on it for compliance evidence either. You can't configure it, you can't see its scores, and it fails open. If an auditor asks how you prevent a specific class of output, point to controls you own and can test.

## The short version

Treat content filtering as four documented outcomes in your API contract: a 400 with `content_filter`, a `finish_reason` of `content_filter`, a `content_filter_result` error, or success. Branch on codes, not message strings. Return outcomes instead of throwing. Send a pseudonymous `user`. And because blocking is currently switched off pending improvements, write and test this handling now rather than discovering the gaps when it comes back on. The platform filter sets the minimum standard. Responsibility for your use case's risks stays with you.
