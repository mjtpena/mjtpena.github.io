---
title: "Eight Prompt Engineering Myths to Drop in 2026"
description: "Eight prompt engineering myths worth dropping in 2026, from verbose prompts to reflexive chain-of-thought and temperature rules, and what to measure instead."
author: Michael John Peña
draft: false
date: 2026-01-09
tags:
  - Prompt Engineering
  - LLM
  - Azure OpenAI
  - Best Practices
  - Evaluation
---

Most prompt advice still in circulation was written for GPT-3.5-era chat models. Since then reasoning models (the o-series and the GPT-5 family) have become the default choice for many new Azure OpenAI workloads, and several of those old habits now waste tokens, add latency, or make requests fail outright. Teams copy them into production because they sound authoritative, then blame the model when quality stalls.

Some of these myths were always shaky; reasoning models just made the cost more visible. These are the eight I'd retire this year, and what I'd put in their place.

## Myth 1: Longer prompts are better

The belief is that detail equals quality, so prompts grow into paragraphs of polite, repetitive instructions. What the model needs is clarity, and verbosity often works against it: the actual task gets buried, and contradictory phrasing creeps in as different people append "just one more thing".

Compare these two:

```text
I want you to please help me analyse this data. The data contains information about sales transactions from our e-commerce platform. Each row represents a sale. I need you to look at this data very carefully and tell me what patterns you can find. Please be thorough and detailed. Look at things like which products sell the most, when people buy things, where customers are from, and any other interesting things you notice. Please format your response in a clear and organised way. Thank you!
```

```text
Analyse the attached sales data and report:
1. Top 10 products by revenue
2. Weekly sales trend and any week more than 20% off the trend
3. Revenue by customer state
4. Rows with missing or negative values

Return Markdown with one ## section per item.
```

The second prompt is shorter, but the important difference is that it defines what "done" looks like. Length is not the variable to optimise; specificity is.

There is one place where length legitimately matters: context. Reference documents, schemas and examples can be long, and that is fine. Put the stable parts first and the variable parts last, because Azure OpenAI's [prompt caching](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching) only applies to identical prompt prefixes of 1,024 tokens or more. I covered the mechanics in [prompt caching strategies](/blog/2025-03-17-prompt-caching-strategies/).

## Myth 2: You need a course to be good at this

Prompting is mostly specification writing. If you can write a clear ticket, a good API contract, or documentation a new starter can follow, you already have the core skill. What courses rarely teach, and what actually separates working systems from demos, is:

- Knowing exactly what a good output looks like for your use case
- Building a set of test inputs that represent real traffic, including the ugly cases
- Changing one thing at a time and measuring it
- Knowing where your model is weak (arithmetic, long-tail facts, very long inputs)

That doesn't make formal training worthless. It earns its place when a team is new to LLMs and has never designed an evaluation set, or when people need to understand prompt injection and data exposure before they wire a model to internal documents and tools. Those are engineering and security skills, not phrasing tricks, and they are hard to pick up by trial and error. What I'd skip is any course whose main promise is a library of magic phrases: those age with each model release, and the specification skills above don't.

## Myth 3: There is a perfect prompt waiting to be found

The mistake I see most often is spending weeks polishing wording for marginal gains while the real problems sit elsewhere: poor retrieval, messy source data, the wrong model for the job, or a user experience that asked people for the wrong input. A prompt cannot compensate for a retriever that returns the wrong chunks.

My rule of thumb: if two reasonable prompt variants score within a couple of points of each other on your evaluation set, stop tuning wording and go look at the inputs. In a RAG system that usually means retrieval quality first: measure retrieval recall (did the right chunk make the top results?) and groundedness on the same test set before touching the wording again. I walk through the common retrieval failures and their fixes in [seven RAG failure modes](/blog/2026-01-07-rag-patterns-production/).

## Myth 4: Few-shot examples always help

Examples cost tokens on every call and they anchor the model, sometimes too hard. A model given three examples of short summaries will produce short summaries even when the input deserves more.

| Examples tend to help | Examples tend to hurt or waste money |
|---|---|
| Unusual output formats | Simple, well-defined classification |
| Domain-specific labelling conventions | Tasks the model already does well zero-shot |
| Ambiguous tasks where a rule is hard to state | Open-ended generation where variety matters |

With reasoning models, start zero-shot. Add examples only when a specific failure shows up in your tests, and keep them if the measured result improves. Test with and without; don't assume.

## Myth 5: "Let's think step by step" always improves answers

Chain-of-thought prompting earned its reputation on older chat models, where asking for intermediate steps genuinely improved maths and multi-step reasoning. It became cargo-cult advice and ended up in prompts for tasks like sentiment classification.

Reasoning models change the calculation. Unless effort is set to none, they already reason internally before answering, and you pay for those reasoning tokens. Telling them to reason step by step on top of that rarely helps and often just adds output tokens. The lever on these models is the `reasoning_effort` parameter described in the [Azure OpenAI reasoning models guide](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning), not the wording. `gpt-5.1` defaults to `reasoning_effort` none (and `gpt-5.2` also accepts none), so check the effort setting on your deployment before deciding whether a step-by-step instruction is redundant.

On a non-reasoning model such as GPT-4.1 or GPT-4o, explicit step-by-step instructions can still help on genuinely multi-step problems. For classification, summarisation and extraction they mostly add latency and cost. If you need auditability, ask for a short justification field in the output, not a full monologue.

## Myth 6: Temperature 0 for facts, 0.7 for creativity

This rule oversimplifies on any model: temperature changes how deterministic sampling is, not how factual the model is. A temperature-0 model will confidently repeat the same wrong answer every time. Low temperature buys consistency, which is useful for extraction and classification, but it is not a hallucination control. Grounding, retrieval and output validation are.

The rule has also gone stale. Azure's reasoning guide lists `temperature`, `top_p`, `presence_penalty` and `frequency_penalty` as unsupported on reasoning models, so copying `temperature=0` from an old notebook into one of those calls gets you an error rather than a better answer. OpenAI's own [GPT-5.2 guidance](https://platform.openai.com/docs/guides/latest-model) allows sampling parameters only when reasoning effort is none, so test your deployment before relying on that. Whether a sampling parameter is valid now depends on model and effort, which is another reason to keep it out of shared defaults and set it per deployment.

## Myth 7: Everything important belongs in the system message

System messages (or developer messages, which the reasoning guide treats as functionally equivalent on reasoning models; don't send both in one request) are the right home for stable behaviour: role, tone, safety rules and output contract. But a long system prompt with a short, vague user turn tends to drift, especially in multi-turn conversations where the system message sits further and further back.

The pattern I prefer is to keep durable rules in the system or developer message and put task-specific instructions next to the data they apply to:

```python
messages = [
    {
        "role": "system",
        "content": "You extract entities from business documents. "
                   "Only report entities that appear in the text. Never guess.",
    },
    {
        "role": "user",
        "content": (
            "Extract every person name, date and location from the text below.\n\n"
            "<text>\n" + document_text + "\n</text>"
        ),
    },
]
```

This is a fragment; `document_text` comes from your pipeline. The delimiters also make it harder for content inside the document to masquerade as instructions, which matters for [prompt injection defence](/blog/2025-03-21-prompt-injection-defense/). For more on what belongs where, see [system prompts that actually work](/blog/2025-09-22-september-ai-topic/).

## Myth 8: Prompts should be conversational

Pleasantries don't change output quality in any way I'd bet on, and on high-volume workloads they are pure token cost. "Summarise this text in two sentences for an executive audience" beats a paragraph of "if it's not too much trouble".

The related myth is asking for JSON in prose ("please respond in valid JSON"). If the output feeds code, use [structured outputs](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs) with a strict JSON schema. The model is then constrained to the schema instead of being politely asked to follow it, and you can delete a whole category of parsing retries.

## What actually moves quality

Strip the myths away and the work is unglamorous:

1. **Define success.** Write down what a correct output is, with examples of good and bad, before writing the prompt.
2. **Constrain the format.** Use a schema where code consumes the result.
3. **State constraints explicitly.** "Do not include opinions" is more reliable than hoping.
4. **Curate context.** Include what's needed, remove what isn't, and order it for caching.
5. **Measure.** Keep a test set and compare variants against it.

The last point is the one most teams skip, so here is a minimal harness. It runs two prompt variants over a labelled set using structured outputs and reports accuracy. It deliberately sets no temperature, so it works against reasoning and non-reasoning deployments alike.

```python
import json
import os

from openai import OpenAI

client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
)
DEPLOYMENT = "<your-deployment-name>"

SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "ticket_label",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "category": {"type": "string", "enum": ["billing", "access", "bug", "other"]}
            },
            "required": ["category"],
            "additionalProperties": False,
        },
    },
}

PROMPTS = {
    "short": "Classify the support ticket into billing, access, bug or other.",
    "with_rules": (
        "Classify the support ticket.\n"
        "billing: invoices, charges, refunds.\n"
        "access: sign-in, permissions, MFA.\n"
        "bug: something that used to work and now errors.\n"
        "other: anything else."
    ),
}

TEST_CASES = [
    {"text": "I was charged twice for March.", "expected": "billing"},
    {"text": "MFA prompt loops and I can't get in.", "expected": "access"},
    {"text": "Export to CSV has thrown a 500 since Tuesday.", "expected": "bug"},
    {"text": "Do you have an office in Melbourne?", "expected": "other"},
]


def classify(instructions: str, text: str) -> str:
    response = client.chat.completions.create(
        model=DEPLOYMENT,
        messages=[
            {"role": "system", "content": instructions},
            {"role": "user", "content": f"<ticket>\n{text}\n</ticket>"},
        ],
        response_format=SCHEMA,
    )
    message = response.choices[0].message
    if message.content is None:
        # Refusals arrive in message.refusal with no content; count them as wrong.
        return "refused"
    return json.loads(message.content)["category"]


for name, instructions in PROMPTS.items():
    correct = sum(classify(instructions, case["text"]) == case["expected"] for case in TEST_CASES)
    print(f"{name}: {correct}/{len(TEST_CASES)} correct")
```

Four cases prove nothing; a real set needs dozens to hundreds drawn from production traffic. Once you outgrow a script, the [Azure AI Evaluation SDK (preview) in Microsoft Foundry](https://learn.microsoft.com/en-us/azure/foundry-classic/how-to/develop/evaluate-sdk) gives you the same idea with built-in evaluators and run history.

## When prompt tuning is worth it

Prompt optimisation pays off when you have an evaluation set and a baseline, when the workload runs at a volume where a few points of accuracy or a few hundred tokens per call add up, and when retrieval and data quality are already in decent shape.

It isn't worth it while you're still prototyping, when you have no baseline to compare against, or when the failures you're seeing trace back to inputs rather than instructions.

A plain template covers most tasks. It's a fill-in template, not code:

```text
Task: what you want done
Context: the background the model needs, and nothing else
Format: the output contract (or a JSON schema via structured outputs)
Constraints: what to avoid
Examples: only if testing shows they help

Input: <your input>
```

Your first clear prompt usually gets you most of the way. Write it, measure it against real cases, fix what the measurements show is broken, and spend the time you save on the parts of the system where most failures actually start.
