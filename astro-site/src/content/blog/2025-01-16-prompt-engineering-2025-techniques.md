---
title: "Prompting in 2025: What Changes with o1 and Structured Outputs"
description: "Which prompt techniques still earn their place on Azure OpenAI in January 2025, which moved into the API, and which now work against reasoning models like o1."
author: Michael John Peña
draft: false
date: 2025-01-16
tags:
  - AI
  - Prompt Engineering
  - Azure OpenAI
  - Structured Output
  - Reasoning
  - LLM
---

Most prompt engineering advice still reads as if it were written for GPT-3.5: add a persona, say "think step by step", paste three examples, and beg for valid JSON. Two things shipped in the second half of 2024 that change that advice for anyone building on Azure OpenAI. Structured outputs moved JSON compliance out of the prompt and into the API, and o1 brought a model that does its own reasoning and works best when you stop telling it how to think. If your prompt library hasn't changed since 2023, some of it is now dead weight and some of it is actively hurting you.

This isn't a list of ten techniques. It's my sorting of the familiar ones into three buckets: still worth doing, now handled by the platform, and counterproductive on reasoning models.

## What actually changed

Two releases matter here.

**Structured outputs.** With `gpt-4o` (2024-08-06) and `gpt-4o-mini` (2024-07-18), you can pass a JSON Schema and the model is constrained to produce output that matches it. Azure OpenAI first exposed it in the `2024-08-01-preview` API, and it is in the current GA API version, `2024-10-21`. The [Microsoft Learn structured outputs guide](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/structured-outputs) covers the supported models and the schema restrictions: every field must be required and objects must set `additionalProperties: false`, among others. This is different from the older JSON mode, which only promised syntactically valid JSON, not JSON matching your shape.

**o1.** OpenAI's o1 (2024-12-17) arrived in Azure OpenAI in December 2024, following the o1-preview and o1-mini previews from September. It spends hidden reasoning tokens before it answers. The December model added the things o1-preview lacked for production work: developer messages (the reasoning-model replacement for system messages), structured outputs, function calling, image input, and a `reasoning_effort` parameter of `low`, `medium` or `high`, which needs API version `2024-12-01-preview` or later. It also drops parameters you may have hard-coded: `temperature` and `top_p` aren't supported, and you set `max_completion_tokens` rather than `max_tokens` because the budget covers hidden reasoning tokens as well as the visible answer. The [Azure OpenAI reasoning models guide](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/reasoning) lists the details, and access to o1 was gated behind a registration form at launch.

I covered where these models came from in [the evolution of reasoning models](/blog/2025-01-09-reasoning-models-o1-o3-evolution/). This post is about what they mean for the prompts you write.

## Still worth doing

### Context and constraints beat personas

The structure I'd keep for any model is: the task, the context the model can't know, the constraints, and what "done" looks like. "We ingest 10 TB a day from 50 source systems, latency must stay under 15 minutes, and the team has intermediate Spark skills" changes the answer. "You are a senior data engineer with 10+ years of experience" mostly changes the tone.

My view on role prompting is unpopular but simple: personas are cheap and occasionally useful for setting register and audience, but they're a weak substitute for facts. If you spend more words on who the model is than on what the problem is, rebalance.

### Delimiters and clear sections

Separating instructions from data with headings, XML-style tags or triple quotes still pays on every model. It reduces the chance that the model treats pasted content as an instruction, which matters for [prompt injection](/blog/2023-10-15-prompt-injection-defense/), and it makes long prompts easier for humans to review. OpenAI's own [advice for prompting reasoning models](https://platform.openai.com/docs/guides/reasoning) recommends delimiters explicitly, so this is one habit that carries straight over to o1.

### Few-shot examples for style and edge cases

Examples are still the most reliable way to show a format or tone that's hard to describe, such as a house style for commit messages or how to label an ambiguous support ticket. Where I've changed my approach is in what the examples are for. If you're only including them to get the model to emit a particular JSON shape, structured outputs does that job better and with fewer tokens. Keep examples for judgement calls, not for syntax.

### Asking the model to state assumptions and uncertainty

"List the assumptions you made and what information would change your recommendation" is still one of the highest-value lines you can add to an analytical prompt. It doesn't make the model smarter, but it surfaces the guesses you'd otherwise discover in production. It also works on o1, because you're asking for a property of the output, not dictating the reasoning process.

## Now handled by the platform

### "Return valid JSON with exactly this structure"

This was the most fragile pattern in the old playbook: a schema pasted into the prompt, a plea for valid JSON, and a retry loop for when the model added a trailing comment. With structured outputs you define the shape in code and the API enforces it. Here's the pattern with the `openai` Python package (1.58 or later) against a `gpt-4o` 2024-08-06 deployment:

```python
import os
from typing import Literal

from openai import AzureOpenAI
from pydantic import BaseModel


class QualityIssue(BaseModel):
    column: str
    issue_type: Literal["null", "duplicate", "format", "range", "referential"]
    severity: Literal["critical", "high", "medium", "low"]
    recommendation: str
    sql_check: str


class QualityReport(BaseModel):
    summary: str
    issues: list[QualityIssue]
    assumptions: list[str]


client = AzureOpenAI(
    azure_endpoint="https://<your-resource-name>.openai.azure.com",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version="2024-10-21",
)

profile = """<column profile output for the customer table>"""

completion = client.beta.chat.completions.parse(
    model="<your-gpt-4o-deployment>",
    messages=[
        {
            "role": "system",
            "content": "You review data quality profiles for a retail data platform. "
            "Only report issues supported by the profile. List any assumptions.",
        },
        {"role": "user", "content": f"<profile>\n{profile}\n</profile>"},
    ],
    response_format=QualityReport,
)

report = completion.choices[0].message.parsed
if report is None:
    print("Model refused:", completion.choices[0].message.refusal)
else:
    for issue in report.issues:
        print(issue.severity, issue.column, issue.issue_type)
```

Notice what disappeared from the prompt: the schema, the enum values, and the "ensure the JSON is parseable" plea. The prompt is now about the job, and the Pydantic model is the contract. Handle the `refusal` field, though: a constrained model can still decline, and it tells you so there rather than in malformed JSON. I went deeper on this style of contract in [building type-safe AI applications](/blog/2024-09-16-type-safe-ai-applications/).

One caution: structured outputs guarantees shape, not truth. A perfectly valid `sql_check` string can still be wrong SQL. Validate the content the same way you would any other untrusted input.

### Strict function calling

The same mechanism applies to tools. Setting `strict: true` on a function definition means arguments match the schema, so the "please only use these parameter names" paragraphs in tool-heavy prompts can go.

## Counterproductive on reasoning models

### "Think step by step"

Chain-of-thought prompting was the most useful trick of 2022 and 2023 because it made the model write its intermediate reasoning into the output, where later tokens could use it. o1 does that internally. OpenAI's guidance for reasoning models says to keep prompts simple and direct and to avoid chain-of-thought instructions, because the model already reasons and prescribing the steps can get in the way. If you want more thinking, raise `reasoning_effort` rather than adding instructions.

This is the biggest change for teams with a shared prompt library. A template that wraps every request in "First consider X, then evaluate Y, then recommend Z" is helping `gpt-4o` and constraining o1. I made the case for explicit chain-of-thought on non-reasoning models in [chain-of-thought prompting](/blog/2024-09-03-chain-of-thought-in-models/), and that advice still holds for them. It just doesn't transfer.

### Scripted decomposition and self-verification loops

The same logic applies to prompts that force a fixed sequence ("complete step 1 before moving to step 2") or ask the model to work backwards to check itself. On o1 these mostly add tokens. If a task genuinely needs separate stages, for example because a human approves the architecture before implementation starts, make them separate calls in your orchestration code, not paragraphs in one prompt.

### Stuffing the context

OpenAI's advice also recommends limiting extra context in retrieval-augmented prompts to what's relevant, since the model can overthink irrelevant material. With o1 that overthinking costs you directly, because reasoning tokens are billed as output tokens. Retrieve fewer, better chunks.

Here's the same kind of request, reshaped for o1:

```python
import os

from openai import AzureOpenAI

client = AzureOpenAI(
    azure_endpoint="https://<your-resource-name>.openai.azure.com",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version="2024-12-01-preview",
)

response = client.chat.completions.create(
    model="<your-o1-deployment>",
    reasoning_effort="medium",
    max_completion_tokens=8000,
    messages=[
        {
            "role": "developer",
            "content": "Recommend partitioning strategies for Delta tables. "
            "Be concise. State assumptions explicitly.",
        },
        {
            "role": "user",
            "content": (
                "<data>\n"
                "Rows per day: 500 million\n"
                "Common filters: order_date, region\n"
                "Retention: 3 years\n"
                "</data>\n"
                "Recommend a partitioning strategy for the sales table and "
                "explain the trade-off against the main alternative."
            ),
        },
    ],
)

print(response.choices[0].message.content)
print("Reasoning tokens:", response.usage.completion_tokens_details.reasoning_tokens)
```

There's no persona essay, no step list, and no temperature. The facts are delimited, the deliverable is clear, and the effort level is a parameter you can tune. Log the reasoning token count from day one, because it's where the cost surprises come from.

## When not to reach for o1 at all

Most prompts in a production system aren't hard reasoning problems. Classification, extraction, summarisation and chat over retrieved documents are well served by `gpt-4o` or `gpt-4o-mini`, which are faster, cheaper, support `temperature`, and respond well to the classic techniques above. My rule of thumb: if a careful human could do the task without a whiteboard, it doesn't need a reasoning model. Save o1 for multi-step planning, gnarly SQL or code, and analysis where a wrong answer is expensive, and measure it against `gpt-4o` on your own evaluation set before switching.

The practical consequence is that you now maintain two prompt styles. Treat that as a feature of your prompt management, not a nuisance: tag each prompt with the model family it was written for, so nobody silently points a chain-of-thought template at o1 and wonders why it got slower and pricier.

## The short version

| Technique | `gpt-4o` / `gpt-4o-mini` | o1 |
|---|---|---|
| Task, context, constraints | Keep | Keep, and keep it short |
| Personas | Optional, for tone | Optional, in the developer message |
| Delimiters | Keep | Keep |
| Few-shot examples | For style and judgement calls | Use sparingly, test with and without |
| "Think step by step" | Still helps | Drop it, use `reasoning_effort` |
| JSON schema in the prompt | Replace with structured outputs | Replace with structured outputs |
| Large retrieved context | Fine within reason | Trim to what's relevant |

If you change one thing this quarter, move your output contracts out of prompt text and into schemas. If you change two, split your prompt library by model family before o1 makes its way into your stack.
