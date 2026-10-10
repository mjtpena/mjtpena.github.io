---
title: "o1 Is GA, o3 Is Announced: Reasoning Models in January 2025"
description: "What changed from o1-preview to o1 (2024-12-17), what o3 actually is today, and how I'd use reasoning_effort and developer messages right now."
author: Michael John Peña
draft: false
date: 2025-01-09
tags:
  - AI
  - OpenAI
  - Azure OpenAI
  - Reasoning
  - LLM
---

In four months, OpenAI's reasoning models went from a curiosity with half the API switched off to something you can put behind a production endpoint. Then, on 20 December, OpenAI showed benchmark numbers for o3 that made o1 look like a stepping stone. If you're planning work for 2025, you need to separate what you can build on today from what has only been announced. Teams that blur the two either wait for a model they can't call yet or build on assumptions that only held for o1-preview.

The useful split is three-way: what changed between o1-preview and the December o1 release, what o3 is (and isn't) as of early January 2025, and how I'd approach these models on OpenAI and Azure OpenAI right now. For the basics of how hidden reasoning works, see my earlier post on [thinking tokens](/blog/2024-09-06-thinking-tokens-explained/).

## Where we started: o1-preview and o1-mini

o1-preview and o1-mini arrived in September 2024 with a deliberately stripped-down API. You got 128K context and user and assistant messages, and not much else: no system messages, no function calling, no structured outputs, no image input, and no control over `temperature` or `top_p`. You also had to switch from `max_tokens` to `max_completion_tokens`, because the budget now had to cover the hidden reasoning tokens as well as the visible answer.

Those limits shaped how people used the models. With no tools and no system prompt, o1-preview ended up as something you consulted on the side. It solved hard problems well, but it was awkward to wire into an application. I argued at the time that it suited [a narrow set of tasks](/blog/2024-09-05-when-to-use-o1/), and later wrote up [how o1-preview's reasoning tokens work in practice](/blog/2024-11-03-openai-o1-reasoning-models/); that still holds. What's different now is that the API no longer gets in the way.

## What o1 (2024-12-17) changed

On 17 December 2024, OpenAI released the full [o1 model to the API](https://openai.com/index/o1-and-new-tools-for-developers/) as snapshot `o1-2024-12-17`, rolling out first to usage tier 5 accounts. The changes that matter for builders:

| Capability | o1-preview / o1-mini | o1 (2024-12-17) |
|---|---|---|
| Context window | 128K | 200K |
| Max output (incl. reasoning) | 32,768 / 65,536 | 100,000 |
| Function calling | No | Yes |
| Structured Outputs | No | Yes |
| Image input | No | Yes |
| System-style instructions | No | Developer messages |
| `reasoning_effort` | No | `low`, `medium`, `high` |

According to OpenAI, o1 also uses about 60% fewer reasoning tokens than o1-preview for a given request. Reasoning tokens are billed as output tokens, and o1 is priced at US$15 per million input tokens and US$60 per million output tokens, the same as o1-preview. In practice, the cost of a call depends far more on how long the model thinks than on the length of your prompt.

### Developer messages, not system messages

o1 accepts a `developer` role, which plays the part a system message plays for GPT-4o. OpenAI's framing is about the instruction hierarchy, but the practical point is simpler: you finally have a supported place for output format, tone and constraints. Keep these instructions short. Reasoning models do better with a clear goal and constraints than with the step-by-step coaching we used to write for GPT-4. If you tell o1 how to think, you're usually just spending tokens on a worse version of what it already does.

### `reasoning_effort` is the real control

`reasoning_effort` is the most useful thing in this release. It sets how many reasoning tokens the model is encouraged to spend, which gives you one parameter that trades cost and latency against depth. The default is `medium`. My rule of thumb: start at `low`, measure quality against a fixed evaluation set, and raise it only when the evaluation says you need to. Defaulting everything to `high` is the reasoning-model version of defaulting every VM to the biggest SKU.

Here is a minimal call with the `openai` Python package. `reasoning_effort` arrived in version 1.58.0, released the same day as the model.

```python
# pip install "openai>=1.58.0"
from openai import OpenAI

client = OpenAI()  # reads OPENAI_API_KEY from the environment

response = client.chat.completions.create(
    model="o1-2024-12-17",
    reasoning_effort="low",
    max_completion_tokens=8000,  # covers reasoning + visible output
    messages=[
        {
            "role": "developer",
            "content": "You are reviewing data platform designs. Answer in Markdown "
                       "with a short verdict first, then numbered risks.",
        },
        {
            "role": "user",
            "content": "We load 2 TB/day into a single Azure SQL Database with nightly "
                       "full reloads and a 6-hour batch window. What breaks first as "
                       "volume doubles, and what would you change?",
        },
    ],
)

print(response.choices[0].message.content)

usage = response.usage
reasoning = usage.completion_tokens_details.reasoning_tokens
print(f"prompt={usage.prompt_tokens} reasoning={reasoning} "
      f"visible={usage.completion_tokens - reasoning}")
```

Log the `reasoning_tokens` figure from day one. You don't see the reasoning itself, but you're paying for it, and it's the number that will surprise you on the monthly bill. If `max_completion_tokens` is too tight, the model can use the whole budget thinking and return an empty answer with `finish_reason` set to `length`. Size the budget generously and alert on that case.

### On Azure OpenAI

Azure OpenAI offers the same `o1` (2024-12-17) model, still behind a registration form. To use `reasoning_effort` and developer messages, you need API version `2024-12-01-preview` or later, as described in Microsoft's [reasoning models guide](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning). I'd use Entra ID authentication rather than keys:

```python
# pip install "openai>=1.58.0" azure-identity
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)

client = AzureOpenAI(
    azure_endpoint="https://<your-resource-name>.openai.azure.com/",
    azure_ad_token_provider=token_provider,
    api_version="2024-12-01-preview",
)

response = client.chat.completions.create(
    model="<your-o1-deployment-name>",
    reasoning_effort="medium",
    max_completion_tokens=8000,
    messages=[
        {"role": "developer", "content": "Respond with a numbered list only."},
        {"role": "user", "content": "List the failure modes of a CDC pipeline that "
                                    "uses a watermark column instead of a change feed."},
    ],
)

print(response.choices[0].message.content)
```

Remember that `model` here is your deployment name, not the model ID. Also check that every parameter you send is supported. Reasoning models reject `temperature`, `top_p`, `presence_penalty`, `frequency_penalty` and `max_tokens`, so shared client wrappers that always set `temperature=0` will fail with a 400 error.

## What o3 actually is right now

On 20 December 2024, the last day of OpenAI's "12 Days" announcements, OpenAI previewed o3 and o3-mini. The headline numbers are hard to ignore:

- **ARC-AGI:** 75.7% on the semi-private evaluation set within the public compute limit, and 87.5% in a high-compute configuration, according to the [ARC Prize write-up](https://arcprize.org/blog/oai-o3-pub-breakthrough). That write-up also makes clear how expensive the high-compute run was per task.
- **SWE-bench Verified:** 71.7%, against 48.9% for o1, as OpenAI presented in the 20 December "12 Days" livestream.
- **Competitive programming and maths:** a Codeforces rating of 2727 and 96.7% on AIME 2024, from the same livestream. These are OpenAI's own figures for a model nobody outside its testers can call yet.

What you can do with o3 today: nothing in production. Neither model is in the OpenAI API or Azure OpenAI. OpenAI opened early access to safety and security researchers and said it plans to release o3-mini first, early this year, with o3 after that. OpenAI has said o3-mini will support the same low, medium and high reasoning effort settings, which is a good sign that the `reasoning_effort` pattern above will carry over.

My advice is to plan for o3 without waiting for it:

1. **Put the model name and reasoning effort in configuration**, not code, so a new model is a config change plus an evaluation run.
2. **Build the evaluation set now.** The teams that can adopt o3-mini in a day will be the ones that can already score o1 against GPT-4o on their own tasks.
3. **Don't budget from the ARC-AGI numbers.** The high-compute result says what's possible, not what a production request will cost. Wait for real pricing.

## Where reasoning models don't fit

The gap between "can reason" and "should reason" is where money goes to waste. I'd keep o1 out of:

- **High-volume, low-ambiguity work** such as classification, extraction and routing. GPT-4o mini is cheaper, faster and just as accurate on tasks that need no planning.
- **Latency-sensitive user interfaces.** Even at `low` effort, an o1 call takes noticeably longer than GPT-4o, and users don't care that the wait was spent thinking.
- **Retrieval-heavy Q&A.** If the answer is in the retrieved documents, the bottleneck is retrieval quality, not reasoning. Fix the index first.
- **Tasks you can't evaluate.** If you can't tell whether o1's answer beat GPT-4o's, you can't justify paying several times more for it.

They do fit multi-step problems where a wrong answer is expensive and hard to spot: design reviews, tricky SQL and Spark debugging, reconciling contradictory requirements, and planning steps in agent workflows where the plan then runs on cheaper models. That last pattern, a reasoning model to plan and GPT-4o-class models to carry out the steps, is the architecture I'd bet on for 2025. o1's function calling and structured outputs make it practical in a way it wasn't in September.

## The decision for this quarter

If you tried o1-preview and gave up because of the API limits, try again with `o1-2024-12-17`. The objections that ruled it out, such as no tools, no instructions and no output schema, are gone. Start at `low` reasoning effort, log reasoning tokens, and send it only the requests that a cheaper model demonstrably gets wrong. Treat o3 as a reason to invest in model-agnostic evaluation and configuration, not as a reason to pause. When o3-mini ships, the teams with an evaluation harness will switch in an afternoon, and everyone else will be arguing about benchmarks.
