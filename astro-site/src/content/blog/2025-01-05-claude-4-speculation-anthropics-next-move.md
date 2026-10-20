---
title: "Claude 4 Speculation: What to Plan For While Anthropic Is Quiet"
description: "No Claude 4 is announced yet: what Anthropic actually shipped in late 2024, what it hints at, and how to stay ready without guessing."
author: Michael John Peña
draft: false
date: 2025-01-05
tags:
  - AI
  - Anthropic
  - Claude
  - LLM
  - Predictions
---

As of early January 2025, Anthropic hasn't announced Claude 4, a release date, or even confirmed the name. That hasn't stopped the speculation, and the question I keep getting is whether to hold off on Claude work until "the next one" arrives. My answer is no. The more useful question is what the last six months of Anthropic releases tell us about direction, and how to build so that whatever ships next is a config change rather than a rewrite.

This is the companion to my [GPT-5 predictions post](/blog/2025-01-04-gpt-5-predictions-what-to-expect/). I'll stick to the same rule here: separate what has actually shipped from what I'm guessing, and label the guesses.

## What Anthropic actually shipped in the second half of 2024

Speculation is only as good as its baseline, so start with the record. Everything below comes from Anthropic's [API release notes](https://platform.claude.com/docs/en/release-notes/api) and announcements.

| Date | Release | Status in January 2025 |
|---|---|---|
| 20 June 2024 | Claude 3.5 Sonnet | Generally available |
| 14 Aug 2024 | Prompt caching | Beta, then GA on 17 Dec |
| 8 Oct 2024 | Message Batches API (50% cheaper, asynchronous) | Beta, then GA on 17 Dec |
| 22 Oct 2024 | Upgraded Claude 3.5 Sonnet (`claude-3-5-sonnet-20241022`) | Generally available |
| 22 Oct 2024 | Computer use tool | Public beta, upgraded 3.5 Sonnet only |
| 1 Nov 2024 | PDF support and token counting | Beta, then GA on 17 Dec |
| 4 Nov 2024 | Claude 3.5 Haiku | Available, text-only |
| 25 Nov 2024 | [Model Context Protocol](https://www.anthropic.com/news/model-context-protocol) | Open-source specification and SDKs |
| 17 Dec 2024 | Models API with model aliases | Generally available |

Two things stand out. First, the 3.x family is still the current generation: Claude 3 Opus, Sonnet and Haiku, with Sonnet and Haiku now at 3.5. Every model in it has a 200K-token context window. Second, most of the engineering effort since October has gone into the *platform* rather than raw model size: tools, batching, caching, document handling, and a protocol for connecting models to data.

## The missing Opus

The most telling signal is something that didn't happen. Anthropic's models documentation listed Claude 3.5 Opus as coming "later this year" through early October 2024. By the 22 October launch of the upgraded 3.5 Sonnet and computer use, that line was gone, as [Simon Willison noted at the time](https://simonwillison.net/2024/Oct/22/opus/). Anthropic hasn't explained the docs change, but in November Dario Amodei [told Lex Fridman](https://lexfridman.com/dario-amodei/) that "as far as we know, the plan is still to have a Claude 3.5 Opus", without giving a date. So treat the docs change as a delay signal rather than a cancellation.

I don't read too much into it, but I read something. The upgraded 3.5 Sonnet outperforms Claude 3 Opus on most of Anthropic's published benchmarks at a fifth of the price, so a 3.5 Opus would have needed a clear reason to exist. My guess, and it is only a guess, is that the next big-model release will carry a new version number rather than fill the 3.5 Opus slot. Whether that is called "Claude 4" is anyone's guess, and I wouldn't put the name into any roadmap document.

## What I expect next, labelled as speculation

None of the following is announced. These are my reads of the direction, ranked by how confident I am.

### Higher confidence: agentic work keeps getting the investment

Computer use, the October Sonnet upgrade's strong coding results, MCP, and Anthropic's December essay on [building effective agents](https://www.anthropic.com/engineering/building-effective-agents) all point the same way. Anthropic wants Claude to be the model you hand a multi-step task to. I'd expect the next generation to be measured on long-running coding and tool-use tasks at least as much as on chat benchmarks, and I'd expect computer use to move out of beta at some point.

It's worth reading that agents essay closely, because its core advice cuts against the hype: start with the simplest workflow that works and only add autonomy when you can measure that it helps. That is the right instinct for enterprise teams, too.

### Medium confidence: some answer to reasoning models

OpenAI brought o1 to its API in December, and o3 was previewed on 20 December. Google shipped Gemini 2.0 Flash as an experimental release in the same month. Anthropic has no dedicated reasoning model in its line-up today. I'd be surprised if 2025 passes without Anthropic offering some way to trade more inference-time compute for better answers on hard problems. What I can't predict is the shape: a separate model, a mode on an existing one, or something exposed through the API as a parameter. Don't design around any particular shape yet.

### Lower confidence: a bigger context window

200K tokens has been the standard since Claude 2.1. Competitors advertise more. Anthropic may push this, but its recent work on prompt caching and PDF handling suggests it's focusing on making the existing window cheaper and more useful rather than just bigger. For most retrieval workloads I see, 200K isn't the constraint anyway; retrieval quality is.

### What I don't expect

I don't expect "Constitutional AI" or interpretability to appear as API parameters you configure per request. Constitutional AI is a training method Anthropic described in its research, not a runtime switch. If you read a prediction that shows code with a `constitution=` or `reasoning_trace=` argument on `messages.create`, treat it as fiction. The Messages API you can rely on is the one documented today.

## How to stay ready without guessing

The practical work is the same regardless of what Anthropic ships or when.

**Keep the model ID out of your code.** Put it in configuration, per workload. Anthropic offers aliases like `claude-3-5-sonnet-latest` alongside pinned snapshots like `claude-3-5-sonnet-20241022`. My rule of thumb: aliases in development, pinned snapshots in production, so a model change is a deliberate deployment and not a surprise.

**Own an evaluation set.** When a new model lands, the only question that matters is whether it's better *for your tasks*. Vendor benchmarks won't answer that. Fifty to a few hundred representative prompts with expected outcomes is enough to start.

**Use the Batches API to run those evals cheaply.** Batches went GA on 17 December and cost half the standard price, which makes running a full eval set against two models an easy habit rather than a project. Here's a minimal runner using the `anthropic` Python SDK:

```python
import json
import time

from anthropic import Anthropic

client = Anthropic()  # reads ANTHROPIC_API_KEY from the environment

CANDIDATE_MODELS = ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"]

# Each line: {"id": "case-001", "prompt": "<your prompt>", "expected": "<expected answer>"}
# Case ids must use only letters, digits, '_' and '-', and the full custom_id
# ("m<index>-<case id>") must stay within the API's 64-character limit.
with open("eval_cases.jsonl", encoding="utf-8") as f:
    cases = [json.loads(line) for line in f if line.strip()]

requests = [
    {
        "custom_id": f"m{mi}-{case['id']}",
        "params": {
            "model": model,
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": case["prompt"]}],
        },
    }
    for mi, model in enumerate(CANDIDATE_MODELS)
    for case in cases
]

batch = client.messages.batches.create(requests=requests)

while True:
    batch = client.messages.batches.retrieve(batch.id)
    if batch.processing_status == "ended":
        break
    time.sleep(60)

with open("eval_results.jsonl", "w", encoding="utf-8") as out:
    for entry in client.messages.batches.results(batch.id):
        model_part, case_id = entry.custom_id.split("-", 1)
        model = CANDIDATE_MODELS[int(model_part[1:])]
        if entry.result.type == "succeeded":
            text = "".join(
                block.text
                for block in entry.result.message.content
                if block.type == "text"
            )
        else:
            text = None
        out.write(json.dumps({"model": model, "case": case_id, "output": text}) + "\n")
```

Scoring is deliberately left out, because it depends on your task: exact match, a rubric, or a second model acting as judge. When a new model appears, you add its ID to `CANDIDATE_MODELS` and rerun. Batches can take up to 24 hours to complete, so this is for evaluation and offline work, not anything user-facing.

Once you have scores, decide on the gap, not the headline. My rule of thumb: a few points on a few hundred cases is noise, so I want a consistent gap of ten percentage points or more on the cases that matter before I switch a production workload. And put price in the same table as quality. Claude 3.5 Haiku costs $0.80/$4 per million input/output tokens against $0.25/$1.25 for Claude 3 Haiku (see [pricing](https://platform.claude.com/docs/en/about-claude/pricing)), so "move to the newer small model" is a cost decision as well as a quality one.

**Keep tool definitions and MCP servers model-agnostic.** If your agent's capabilities live in well-described tools rather than in prompt tricks tuned to one model's quirks, a model upgrade tends to be an improvement instead of a regression hunt.

**Check where you can actually run it.** For Azure-centred organisations this matters: Claude is available through Anthropic's API, Amazon Bedrock, and Google Cloud Vertex AI, but not through Azure OpenAI Service. A new Claude generation doesn't change your data residency, networking, or procurement story. Factor that in before you promise a business unit "we'll switch to Claude 4 when it's out".

## When not to wait at all

If you have a workload that the current models handle well, ship it on the current models. Claude 3.5 Sonnet is a strong coding and document-analysis model today, and 3.5 Haiku covers the cheaper, high-volume tier, though at roughly three times the price of Claude 3 Haiku, which is still available if your eval says it is good enough. Waiting for an unannounced model is how projects lose a quarter for nothing.

The case for waiting is narrow: a task where every current model you've evaluated fails your own eval set by a wide margin, and where the failure is the kind more capability might fix (multi-step reasoning, long agentic sequences) rather than the kind it won't (bad retrieval, unclear requirements, missing data).

## The takeaway

Plan for direction, not for a product name. Anthropic's recent releases point towards agents, tool use, and cheaper ways to run large workloads, and a reasoning-style answer to o1 seems likely at some point in 2025. Whatever arrives, the teams that benefit first will be the ones with model IDs in config, an eval set they trust, and a cheap way to run it. That work pays off with or without a Claude 4.
