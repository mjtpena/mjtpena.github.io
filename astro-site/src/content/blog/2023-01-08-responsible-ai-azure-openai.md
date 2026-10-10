---
title: "Responsible AI on Azure OpenAI: What the Platform Covers and What You Own"
description: "Azure OpenAI's preview ships with use-case review, content filtering and abuse monitoring. Here is where those controls stop and your application's begin."
author: Michael John Peña
draft: false
date: 2023-01-08
tags:
  - Azure OpenAI
  - Responsible AI
  - Governance
  - Azure
  - Python
---

A common assumption about Azure OpenAI right now goes like this: "Microsoft filters the content, so we're covered on responsible AI, right?" No. The service gives you a set of platform controls, and they're genuinely useful, but they were designed to stop the worst misuse across every customer. They know nothing about your users, your data or what a harmful answer looks like in your domain. If you don't draw a clear line between what the platform does and what your application must do, the gap becomes nobody's job.

This post maps that line for Azure OpenAI Service as it stands on 8 January 2023: a limited-access preview serving the GPT-3, Codex and embeddings model families. For the mechanics of the filter itself, see [content filtering in Azure OpenAI](/blog/2023-01-09-content-filtering-azure-openai/).

## The principles are the easy part

Microsoft's six [responsible AI principles](https://www.microsoft.com/en-us/ai/responsible-ai) are fairness, reliability and safety, privacy and security, inclusiveness, transparency, and accountability. Since June 2022 they've been backed by version 2 of the Microsoft Responsible AI Standard, which is the internal rulebook that drove decisions like restricting Custom Neural Voice and retiring emotion inference in Azure Face.

It's hard to find anyone who disagrees with any of the six. That's the problem: a list everyone agrees with doesn't tell you what to build. The useful exercise is to take each principle and ask two questions. What does the platform already do here? And what is left over for us?

## What the platform does for you

Four controls come with the preview, and none of them needs a line of your code.

**Use-case review.** Under the [Limited Access policy for Azure OpenAI](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/limited-access), you apply for access and describe your intended scenarios before you can create a resource, and Microsoft reviews those use cases against what the service is approved for. Check the policy page for what's required before a solution goes to production. The review is the most underrated control in the service, because it forces you to write down who the users are and what the system is for, which is exactly the document most AI projects never produce.

**Content filtering.** The service runs prompts and completions through an ensemble of classification models aimed at high-severity harmful content. Whether it blocks or only annotates on your resource is worth confirming against the [content filtering documentation](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/content-filter) and your own testing rather than assuming (the linked page has changed a lot since early January 2023, so don't expect it to match this paragraph). When a request is blocked, a flagged prompt fails with HTTP 400 and code `content_filter`, and a flagged completion comes back with `finish_reason` set to `content_filter`, with the text usually empty (rarely partial). Either way, the response doesn't tell you which category of harm fired.

**Abuse monitoring.** Per the [data, privacy and security page](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy), prompts and completions are kept for a limited period so Microsoft can detect patterns of misuse, and authorised Microsoft staff can review flagged content. If that's a problem for a sensitive workload, check the data privacy page for options. Your data isn't used to train OpenAI's models.

**Documentation.** The [Transparency Note for Azure OpenAI](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/transparency-note) describes what the models are good at, where they fail, and which scenarios Microsoft considers risky. Read it before you write your use-case application, not after.

## What's left for you

Here's how I split the work. The right-hand column is the part teams tend to skip.

| Principle | Platform side | What your application still owns |
|---|---|---|
| Fairness | Model-level mitigations | Testing outputs on your own scenarios and user groups |
| Reliability and safety | Content filter (above) | Domain-specific failure handling, fallbacks, scope limits |
| Privacy and security | No training on your data, Azure AD auth, network controls | What data goes into prompts, retention of your own logs |
| Inclusiveness | Nothing specific | Accessible UX, language coverage, a path for people who can't use the AI feature |
| Transparency | Transparency Note (above) | Telling users they're dealing with AI, and what it can't do |
| Accountability | Use-case review, abuse monitoring (above) | A named owner, human review of consequential outputs, an audit trail |

Two rows deserve more attention than they usually get.

**Reliability and safety is mostly your problem.** Even when it blocks, the content filter targets hate speech and similar high-severity content. It won't block a confident, polite, completely wrong answer about your refund policy, and in most enterprise scenarios that's the more likely harm. A Davinci model will invent a policy clause with the same fluency it uses for a real one. The mitigation isn't a better filter. It's narrowing the task: ground the prompt in your own content, keep the model to drafting rather than deciding, and put a person between the draft and anyone who acts on it.

**Accountability needs a name, not a committee.** "The AI Ethics Team" isn't an owner. Someone specific should be able to answer "why did the system say this on Tuesday?", and that requires logging enough to reconstruct the call without storing more personal data than you need.

## A thin wrapper that enforces the split

Most of what the right-hand column asks for can live in one place: the function that calls the model. Below is the shape I'd start from, using the `openai` Python library 0.26.0 (released on 6 January) against the `2022-12-01` API version (the newest version available to preview resources; older ones are `2022-06-01-preview` and `2022-03-01-preview`). It does four things: handles a filtered prompt as an expected outcome rather than a crash, detects filtered completions and hands them to the scenario owner, attributes each call to a pseudonymous user, and holds drafts in high-stakes scenarios in a review queue so the caller can't show them directly. If your resource isn't blocking anything today, the filtered paths won't fire yet, but build them now so a change in filter behaviour doesn't become an unhandled error.

```python
import hashlib
import json
import logging
import os
import queue

import openai

# Requires: pip install "openai==0.26.0"
openai.api_type = "azure"
openai.api_base = os.environ["AZURE_OPENAI_ENDPOINT"]  # https://<your-resource-name>.openai.azure.com/
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

DEPLOYMENT = os.environ["AZURE_OPENAI_DEPLOYMENT"]  # e.g. <your-davinci-003-deployment>

PROMPT_TEMPLATE_VERSION = "v1"  # bump whenever the prompt template changes

# Scenarios covered by your access application and use-case review.
# The value says whether a person must check the output before anyone sees it.
SCENARIO_NEEDS_REVIEW = {"draft_support_reply": True, "summarise_ticket": False}

logging.basicConfig(level=logging.INFO)
audit_log = logging.getLogger("ai_audit")

# In-process stand-ins. In production these would be a durable queue or ticketing system.
review_queue: "queue.Queue[dict]" = queue.Queue()
escalation_queue: "queue.Queue[dict]" = queue.Queue()


def pseudonymise(user_id: str) -> str:
    """Stable, non-reversible identifier for attribution without storing the raw ID."""
    salt = os.environ["AUDIT_SALT"]
    return hashlib.sha256(f"{salt}:{user_id}".encode()).hexdigest()[:16]


def generate(scenario: str, prompt: str, user_id: str) -> dict:
    if scenario not in SCENARIO_NEEDS_REVIEW:
        raise ValueError(f"Scenario '{scenario}' is not in the approved use cases")

    user_ref = pseudonymise(user_id)
    record = {
        "scenario": scenario,
        "deployment": DEPLOYMENT,
        "template_version": PROMPT_TEMPLATE_VERSION,
        "prompt_hash": hashlib.sha256(prompt.encode()).hexdigest()[:12],
        "user": user_ref,
        "prompt_chars": len(prompt),
    }

    try:
        response = openai.Completion.create(
            engine=DEPLOYMENT,
            prompt=prompt,
            max_tokens=300,
            temperature=0.2,
            user=user_ref,
        )
    except openai.error.InvalidRequestError as err:
        if getattr(err, "code", None) == "content_filter":
            record["outcome"] = "prompt_filtered"
            audit_log.info(json.dumps(record))
            return {
                "status": "blocked",
                "message": "That request can't be processed. Please rephrase it or contact support.",
            }
        raise

    choice = response["choices"][0]
    record["completion_tokens"] = response["usage"]["completion_tokens"]

    if choice["finish_reason"] == "content_filter":
        record["outcome"] = "completion_filtered"
        audit_log.info(json.dumps(record))
        escalation_queue.put(record)  # the scenario owner sees every filtered completion
        return {
            "status": "blocked",
            "message": "No suitable answer was produced. Please rephrase or contact support.",
        }

    text = choice["text"].strip()
    disclosure = "Drafted by an AI model. Check before relying on it."

    if SCENARIO_NEEDS_REVIEW[scenario]:
        record["outcome"] = "pending_review"
        audit_log.info(json.dumps(record))
        review_queue.put({"record": record, "text": text, "disclosure": disclosure})
        return {"status": "pending_review", "message": "A person will review this before it is sent."}

    record["outcome"] = "returned"
    audit_log.info(json.dumps(record))
    return {"status": "ok", "text": text, "disclosure": disclosure}


if __name__ == "__main__":
    result = generate(
        "draft_support_reply",
        "Write a polite reply to a customer asking how to reset their password on our portal.",
        user_id="customer-12345",
    )
    print(json.dumps(result, indent=2))
    print(f"Items waiting for review: {review_queue.qsize()}")
```

A few deliberate choices in there:

- **The scenario allow-list mirrors the use-case review.** Every entry should trace back to a scenario you described when applying for access and that Microsoft approved. If a developer wants a new scenario, they have to add it here, and that's the moment to ask whether it's covered by what Microsoft approved. Scope creep is the most common way a well-reviewed pilot drifts into something nobody signed off.
- **The audit record holds metadata, not content.** Scenario, deployment, template version, a prompt hash, pseudonymous user, sizes, token counts and outcome let you reconstruct which configuration produced a response. Microsoft's abuse-monitoring copy isn't available to you, so decide deliberately: log the deployment name and a prompt-template version on every call, and keep full prompt/completion text only for a sampled or flagged subset under a stated retention period.
- **Review is a property of the scenario, not a guess about the text.** Keyword-based "risk scoring", such as flagging any answer containing the word "legal", misses everything that matters and buries reviewers with false positives. Decide up front which scenarios need a person, and queue all of them. The caller only ever gets the text back for scenarios that don't need review.
- **The disclosure travels with the response.** Where your UI renders it is a design decision, but the data shouldn't leave the function without it.

The `user` value is an optional field on the Completions request, meant to identify the end user so that abuse signals can be tied to a caller without you handing over a real identifier. Use key authentication only for experiments; for anything shared, switch to Azure AD as described in [my earlier post on preparing for GA](/blog/2023-01-01-azure-openai-service-ga-announcement/).

## Fairness testing without pretending to measure it

Bias in a generative model doesn't reduce neatly to a parity ratio. Counting positive words across demographic groups produces a number, but not one I'd put in front of a risk committee. What works better at this stage is plain and manual: build a small set of test prompts that differ only in names, genders, locations or other attributes relevant to your users, run them against your deployment, and have two people read the outputs side by side. Repeat when you change the prompt template or the model behind the deployment.

It's slow, and it's the right amount of rigour for a preview-stage pilot. Write down what you tested and what you found, in the same place you keep your [model card](/blog/2022-12-08-model-cards-ai-transparency/).

## When this is overkill, and when it isn't enough

For an internal prototype where a handful of engineers paste prompts into Azure OpenAI Studio, the platform controls plus a written use case are proportionate. Don't build a review queue for five people.

Once real users are involved, the wrapper above is the minimum. And if the output feeds a decision about a person, such as credit, employment, insurance or health, a completion model on a preview service isn't the place to start at all. Those are the scenarios the Transparency Note flags as high risk, and they need a formal impact assessment before any prompt is written.

## The takeaway

Azure OpenAI's preview gives you more responsible AI infrastructure than most teams realise: an access application with a use-case review, a content filter, abuse monitoring and decent documentation. It doesn't give you scope control, domain-specific safety, human review, disclosure or an accountable owner. Write those down as requirements next to your use-case application, and put the enforceable ones in the single function every call goes through. That's where the principles turn into something an auditor can check.
