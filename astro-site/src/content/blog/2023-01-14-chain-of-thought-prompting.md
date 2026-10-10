---
title: "Chain-of-Thought Prompting on Azure OpenAI: Gains, Costs and Limits"
description: "What the 2022 chain-of-thought papers show, how to apply zero-shot CoT and self-consistency on Azure OpenAI completions, and when the extra tokens don't pay."
author: Michael John Peña
draft: false
date: 2023-01-14
tags:
  - Azure OpenAI
  - Prompt Engineering
  - OpenAI
  - GPT-3
  - Azure
---

Ask a GPT-3 model a word problem with three or four steps and it will often give a confident, wrong number. The model isn't bad at arithmetic so much as it's asked to jump straight to the answer. Chain-of-thought (CoT) prompting gets the model to write out the intermediate steps first, and on the right tasks that alone changes the error rate a lot. It also costs more tokens and more latency, and it does nothing for tasks that don't need reasoning, so it's worth knowing exactly what it buys you before you put it in front of users.

This builds on the four rules in [Prompts Are Production Code](/blog/2023-01-12-prompt-engineering-fundamentals/). If you haven't used worked examples in a prompt yet, read [few-shot learning with Azure OpenAI](/blog/2023-01-13-few-shot-learning-azure-openai/) first, because few-shot CoT is the same technique with reasoning in the examples.

## What the research actually shows

Three papers from 2022 are worth reading in full, and they make more modest claims than the blog posts summarising them.

**Few-shot CoT.** Wei et al., [Chain-of-Thought Prompting Elicits Reasoning in Large Language Models](https://arxiv.org/abs/2201.11903), put worked reasoning into the few-shot examples instead of bare question-and-answer pairs. With eight such examples, PaLM 540B reached state-of-the-art accuracy on the GSM8K grade-school maths benchmark. The finding that matters for practitioners is that the benefit appears with scale. Smaller models produced fluent but illogical reasoning and often did worse with CoT than without it.

**Zero-shot CoT.** Kojima et al., [Large Language Models are Zero-Shot Reasoners](https://arxiv.org/abs/2205.11916), showed you don't always need hand-written examples. Adding "Let's think step by step." after the question took `text-davinci-002` from 17.7% to 78.7% on MultiArith and from 10.4% to 40.7% on GSM8K. That's the strongest completions model most Azure OpenAI resources can deploy as of mid-January 2023, which makes these numbers unusually relevant. The paper is also clear that zero-shot CoT still trails carefully written few-shot CoT examples.

**Self-consistency.** Wang et al., [Self-Consistency Improves Chain of Thought Reasoning in Language Models](https://arxiv.org/abs/2203.11171), sample several reasoning paths at a non-zero temperature and take the majority answer. It improves on single greedy CoT across arithmetic and commonsense benchmarks. Wang et al.'s intuition is that a correct answer can be reached by several routes, while wrong answers tend to scatter. In an Azure workload I'd reserve it for numbers a person would otherwise check by hand, such as invoice totals or cost estimates, where paying for five paths is cheaper than a reviewer's time.

Two caveats before you generalise. These are benchmark results on maths, symbolic and commonsense puzzles with a single checkable answer. And the gains came from large models. If your deployment is `text-curie-001` because it's cheaper, don't expect the same behaviour.

## Where this sits on Azure OpenAI today

As of mid-January 2023, Azure OpenAI Service is a limited-access preview. You call GPT-3 family models such as `text-davinci-002` through the [completions endpoint](https://learn.microsoft.com/azure/ai-services/openai/how-to/completions), addressed by deployment name. There's no chat endpoint and no system message, so a CoT prompt is plain text: instructions, any examples, the question, and the trigger phrase at the point where the model should start writing. `text-davinci-003` is on OpenAI's own API and is only starting to reach Azure regions ([What's new](https://learn.microsoft.com/azure/ai-foundry/openai/whats-new)), so check what your resource can actually deploy before building around it.

The context window for `text-davinci-002` is 4,097 tokens, shared between prompt and completion (older davinci models have about 2,000). CoT eats into that from both sides. Few-shot examples with reasoning are three or four times longer than bare examples, and the completion is now a paragraph instead of a number, so set `max_tokens` with room for the reasoning or you'll truncate it before the answer appears.

## Zero-shot CoT, done properly

The common version appends "Let's think step by step." and reads the whole completion. That works for a human reading the output, but code then has to dig the answer out of free text. Kojima et al. used a two-stage approach that's worth copying: the first call generates the reasoning, and the second call appends that reasoning plus an answer-extraction phrase so the model emits only the answer.

The code uses the `openai` Python package (0.26.x) with the `2022-12-01` API version.

```python
from __future__ import annotations

import os

import openai

openai.api_type = "azure"
openai.api_base = "https://<your-resource-name>.openai.azure.com/"
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

DEPLOYMENT = "<your-deployment-name>"  # e.g. a text-davinci-002 deployment


def complete(
    prompt: str,
    max_tokens: int,
    temperature: float = 0,
    stop: list[str] | None = None,
) -> str:
    response = openai.Completion.create(
        engine=DEPLOYMENT,
        prompt=prompt,
        max_tokens=max_tokens,
        temperature=temperature,
        stop=stop,
    )
    return response["choices"][0]["text"].strip()


def zero_shot_cot(question: str) -> dict:
    # Stage 1: generate the reasoning.
    reasoning_prompt = f"Q: {question}\nA: Let's think step by step."
    # Stop before the model invents a new "Q:" block that would leak into stage 2.
    reasoning = complete(reasoning_prompt, max_tokens=300, stop=["\nQ:"])

    # Stage 2: extract only the final answer from that reasoning.
    answer_prompt = (
        f"{reasoning_prompt} {reasoning}\n"
        "Therefore, the answer (arabic numerals) is"
    )
    answer = complete(answer_prompt, max_tokens=10)
    return {"reasoning": reasoning, "answer": answer.rstrip(".")}


if __name__ == "__main__":
    result = zero_shot_cot(
        "A data centre has 5 racks with 8 servers each. Each server has 64 GB of RAM. "
        "Two servers are taken offline for maintenance. How many GB of RAM are still online?"
    )
    print(result["reasoning"])
    print("Answer:", result["answer"])
```

The extraction phrase depends on the answer format. Kojima et al. used a different one for multiple choice ("Therefore, among A through E, the answer is") and for yes/no questions, so match it to the field you need to parse.

Two calls cost more than one. The second call's completion is only a few tokens, but its prompt includes all the reasoning from stage 1, so you pay for those tokens twice. In return you get a field you can validate. Keep `temperature` at 0 for both, because a single CoT path should be the model's most likely reasoning, not a creative one. Log the reasoning alongside the answer. When the answer is wrong, the reasoning usually shows where it went off the rails, which is far more useful for fixing the prompt than a wrong number on its own.

## Few-shot CoT when the task has a shape

Zero-shot CoT lets the model choose how to reason. When your task has a known procedure, such as working out an Azure cost from a meter rate, a quantity and a duration, few-shot CoT works better because the examples show the steps you want. Write two or three examples whose reasoning follows the same order every time and ends with the same answer line, for example `The answer is 1080.` Consistent endings make extraction trivial and help the model stop at the right place.

One example in that shape looks like this, followed by the open question the model should complete:

```text
Q: A virtual machine meter is billed at $0.30 per hour. We run 3 VMs for 1,200 hours each. What is the total cost in dollars?
A: The rate is $0.30 per hour. 3 VMs x 1,200 hours = 3,600 VM-hours. 3,600 x 0.30 = 1080. The answer is 1080.

Q: A storage meter is billed at $0.05 per GB per month. We keep 400 GB for 6 months. What is the total cost in dollars?
A:
```

The rate, quantity and duration are illustrative, not real Azure prices. What matters is that every example walks the same three steps in the same order.

Keep the example reasoning short and literal. Long, chatty reasoning in the examples produces long, chatty completions, and you pay for every token. Use quantities and steps that resemble your real inputs, but make sure the arithmetic in the examples is correct. A model copies the pattern of your examples faithfully, including your mistakes.

## Self-consistency without extra round trips

Self-consistency sounds expensive because it needs several reasoning paths. On the completions API, the `n` parameter returns several completions from one request, so you don't need a loop of separate calls. You still pay for every completion token generated, so five samples cost roughly five times the completion tokens of one.

The paper samples few-shot CoT prompts; this uses a zero-shot instruction to keep the sample short, so put your few-shot examples in `prompt` for production.

```python
import os
import re
from collections import Counter
from decimal import Decimal

import openai

openai.api_type = "azure"
openai.api_base = "https://<your-resource-name>.openai.azure.com/"
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

DEPLOYMENT = "<your-deployment-name>"  # e.g. a text-davinci-002 deployment

ANSWER_PATTERN = re.compile(r"The answer is\s*\$?(-?\d[\d,]*(?:\.\d+)?)", re.IGNORECASE)


def normalise(number: str) -> str:
    # "840", "840.0" and "840.00" must count as the same vote.
    return format(Decimal(number.replace(",", "")).normalize(), "f")


def self_consistent_answer(question: str, samples: int = 5) -> dict:
    prompt = (
        f"Q: {question}\n"
        "A: Let's think step by step, then finish with 'The answer is <number>.'\n"
    )
    response = openai.Completion.create(
        engine=DEPLOYMENT,
        prompt=prompt,
        max_tokens=300,
        stop=["\nQ:"],
        temperature=0.7,  # diversity between paths is the point
        n=samples,
    )

    answers = []
    for choice in response["choices"]:
        match = ANSWER_PATTERN.search(choice["text"])
        if match:
            answers.append(normalise(match.group(1)))

    if not answers:
        return {"answer": None, "agreement": 0.0, "votes": {}}

    votes = Counter(answers)
    answer, count = votes.most_common(1)[0]
    return {"answer": answer, "agreement": count / samples, "votes": dict(votes)}


if __name__ == "__main__":
    print(self_consistent_answer(
        "We run 3 databases at $30 per month each. One is deleted after 4 months. "
        "What is the total cost for the year in dollars?"
    ))
```

The `agreement` value is the useful by-product. Three out of five paths agreeing is a different situation from five out of five, and you can route low-agreement answers to a person instead of returning them. Note that the denominator is the number of samples, not the number of parseable answers, so completions that never reached an answer count against confidence rather than being silently dropped.

## What it costs, and when not to use it

To put numbers on it for the data centre question above: a direct answer is about 5 completion tokens. A 300-token max reasoning path is up to 60 times that, and self-consistency with n=5 multiplies it again, to as many as 1,500 completion tokens for one answer.

| Approach | Calls | Relative completion tokens | Good for |
|---|---|---|---|
| Direct answer | 1 | Lowest | Lookup, classification, extraction, rewriting |
| Zero-shot CoT (two-stage) | 2 | Up to ~60x direct, plus the reasoning resent as prompt | Ad hoc multi-step questions |
| Few-shot CoT | 1 | Similar to zero-shot CoT, plus a longer prompt | Repeated tasks with a known procedure |
| Self-consistency (n=5) | 1 | Roughly n times single-path CoT (up to ~300x direct at n=5) | High-value answers where a wrong number is expensive |

The mistake I see most often is applying CoT everywhere because it helped on one maths question. My rule of thumb is to skip it when:

- **The task isn't multi-step.** Sentiment, categorisation and summarisation don't get better because the model narrates. You pay more for the same output.
- **The model is small.** Wei et al. found CoT hurt smaller models. Test on the deployment you'll actually run, not on davinci in the playground.
- **Latency matters more than accuracy.** Reasoning text takes time to generate. For an interactive feature, a slower but more accurate answer can still be the wrong trade.
- **The answer can be computed.** If the question is arithmetic over known values, have the model extract the values and let your code do the maths. Deterministic code beats a well-prompted model at multiplication every time.
- **You plan to show the reasoning as an explanation.** The written steps are text the model generated, not a trace of how it reached the answer. They can read well and still be wrong, or reach a right answer by a wrong route. Treat them as a debugging aid, not as an audit trail.

## The decision in one paragraph

Use chain-of-thought when the task genuinely has several dependent steps, you're on a large model such as `text-davinci-002`, and a wrong answer costs more than the extra tokens. Start with two-stage zero-shot CoT because it needs no examples, move to few-shot CoT once you know the procedure you want, and add self-consistency only for answers valuable enough to pay several times over. For everything else, a direct prompt with a strict output format is cheaper, faster and just as accurate. Whatever you choose, measure it against your own test set rather than the benchmark numbers, because your questions aren't GSM8K.
