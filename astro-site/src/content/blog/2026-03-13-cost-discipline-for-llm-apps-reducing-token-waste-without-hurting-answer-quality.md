---
title: "A Token Waste Audit: Cut What the Answer Doesn't Use"
description: "Profile each LLM request by segment, rank the cuts by quality risk, and keep only the token savings that survive a paired evaluation against the baseline."
author: Michael John Peña
draft: false
date: 2026-03-13
tags:
  - LLM
  - Azure OpenAI
  - Cost Optimization
  - Evaluation
---

Every LLM app carries tokens that don't change the answer: a system prompt section nobody remembers adding, three copies of the same paragraph from three retrieved chunks, tool schemas for tools the request will never call, a 600-word reply to a yes/no question. That waste is real money at volume, but the usual fix of "make the prompt shorter" is how teams quietly break answer quality. The discipline I want is narrower: find the tokens the answer doesn't depend on, cut those, and prove it.

[Measuring cost per query](/blog/2026-01-18-cost-per-query-optimization/), [hidden costs](/blog/2026-01-04-azure-openai-hidden-costs/) and [cache misses](/blog/2026-02-16-prompt-caching-performance/) are covered elsewhere; what matters here is which tokens are safe to remove.

## Waste is defined by the answer, not the token count

A token is waste only if removing it leaves the answer just as good. That sounds obvious, but it rules out the most common shortcut, which is to sort segments by size and trim the biggest. The biggest segment in a grounded assistant is usually the retrieved context, and it's also the segment the answer depends on most. Cutting `top_k` from 10 to 4 looks like a 60% cut to the context segment on paper and turns into a groundedness regression on the questions that needed chunk seven.

So I treat every segment of a request as a hypothesis: "this part is load-bearing". The audit is a set of experiments that try to disprove it, one segment at a time.

## Profile the request by segment

You can't reason about waste from a single `prompt_tokens` number. Split each logged request into the parts you control: system prompt, tool definitions, conversation history, retrieved context, and the user message. Then look at the output side separately, because output is priced several times higher than input and reasoning tokens hide inside it. The [reasoning models guide](https://learn.microsoft.com/azure/foundry/openai/how-to/reasoning) is explicit that reasoning tokens are billed as output tokens and reported in `completion_tokens_details.reasoning_tokens` (Chat Completions) or `output_tokens_details.reasoning_tokens` (Responses).

The script below is a local profiler for a sample of logged requests. It counts tokens per segment with `tiktoken` (0.12.0, using `o200k_base`, the encoding for the GPT-4o, GPT-4.1 and GPT-5 families) and flags retrieved chunks that are duplicates or near-duplicates of one another. Counts are estimates: the service adds a few tokens of message framing and serialises tool schemas in its own format, so reconcile the totals against `usage.prompt_tokens` from real responses before trusting the percentages.

It expects a JSONL file where each line has `system` (string), `tools` (list of tool definitions), `history` (list of `{role, content}`), `context` (list of chunk strings) and `user` (string). Run it with `pip install tiktoken==0.12.0` and `python profile_tokens.py requests.jsonl`. On first use `tiktoken` downloads the encoding file, so a locked-down build agent needs that cached in advance.

```python
import json
import re
import sys
from collections import Counter

import tiktoken

enc = tiktoken.get_encoding("o200k_base")


def count(text: str) -> int:
    return len(enc.encode(text))


def shingles(text: str, n: int = 8) -> set:
    words = re.findall(r"\w+", text.lower())
    return {" ".join(words[i : i + n]) for i in range(max(len(words) - n + 1, 1))}


def duplicate_indices(chunks: list, threshold: float = 0.6) -> list:
    """Indices of chunks that mostly repeat an earlier chunk (Jaccard on 8-word shingles)."""
    seen, dupes = [], []
    for i, chunk in enumerate(chunks):
        s = shingles(chunk)
        if any(len(s & prev) / len(s | prev) >= threshold for prev in seen):
            dupes.append(i)
        seen.append(s)
    return dupes


totals, dupe_tokens, requests = Counter(), 0, 0
with open(sys.argv[1], encoding="utf-8") as f:
    for line in f:
        req = json.loads(line)
        requests += 1
        totals["system"] += count(req["system"])
        totals["tools"] += count(json.dumps(req["tools"]))
        # Assistant tool-call turns can have null or list content; count only text.
        totals["history"] += sum(
            count(m.get("content")) for m in req["history"] if isinstance(m.get("content"), str)
        )
        totals["context"] += sum(count(c) for c in req["context"])
        totals["user"] += count(req["user"])
        dupe_tokens += sum(count(req["context"][i]) for i in duplicate_indices(req["context"]))

if requests == 0:
    sys.exit("No requests found in the input file.")

grand = sum(totals.values())
print(f"{requests} requests, {grand / requests:,.0f} input tokens per request (estimate)")
for segment, tokens in totals.most_common():
    print(f"  {segment:<8} {tokens / requests:>8,.0f}  {tokens / grand:6.1%}")
print(f"  near-duplicate context: {dupe_tokens / requests:,.0f} tokens per request")
```

Two numbers from this usually matter more than the rest: how much of the context is duplicated, and how big the tool block is relative to the system prompt. Tool definitions are sent with every call and billed as input, and in agent-style apps that register every tool on every request they can outweigh the instructions.

## Rank the cuts by quality risk

Once you know where the tokens are, the order of attack is set by risk, not size. This is the table I work from:

| Segment | Typical waste | Cut | Quality risk |
|---|---|---|---|
| Retrieved context | Duplicate or overlapping chunks | Deduplicate before the prompt is built | Low |
| Tool definitions | Tools irrelevant to this request; verbose descriptions | Register tools per route; tighten descriptions | Low to medium |
| Output | Preamble, restated question, unrequested caveats | Format instructions, `verbosity`, structured output | Medium |
| Reasoning | Deep reasoning on easy requests | Lower `reasoning_effort` per route | Medium |
| History | Full transcripts for turns that are really new tasks | Window or summarise; start fresh for new tasks | Medium to high |
| Retrieved context | Marginal chunks at the bottom of the ranking | Lower `top_k`, tighter score threshold | High |
| System prompt | Rules that seem redundant | Remove sections | High, and often low payoff |

### Low risk: duplicates and unused tools

Deduplicating context is the closest thing to a free saving. Overlapping chunking windows and the same policy paragraph copied across many documents mean the model often reads one passage two or three times. Remove exact and near duplicates after ranking, keeping the highest-ranked copy, and the answer sees the same evidence for fewer tokens. If the profiler shows almost no duplication, move on; there's nothing to win.

Tools are similar. If your router already knows a request is a billing question, it doesn't need the schema for the calendar tool. Fewer tools also tends to mean fewer wrong tool calls, so this is one of the rare cuts that can improve quality as well as cost.

The catch is caching. Tool definitions sit at the front of the cacheable prefix, so a different tool set per route splits one shared cached prefix into several, and each is hit less often. Keep the per-route tool sets few and stable, keep tool order fixed, and compare `cached_tokens` before and after: a scoping change that saves 2,000 uncached tokens but loses a cache hit on 6,000 can cost more than it saves. That's why I rate it low to medium, on cost as well as quality.

### Medium risk: output and reasoning

Output tokens are where the per-token price is highest, and most verbose answers aren't verbose because the user needed it. GPT-5 family models on Azure OpenAI accept a `verbosity` setting (`low`, `medium`, `high`; `text.verbosity` on the Responses API), and `reasoning_effort` controls how much hidden thinking you pay for. The values vary by model: `minimal` exists only on the original GPT-5 models, while `gpt-5.1` and `gpt-5.2` accept `none` and both default to it, so reasoning is off unless you ask for it. Check the table in the reasoning guide for the model you actually deploy.

Don't confuse a ceiling with a lever. Lowering `max_completion_tokens` or `max_output_tokens` doesn't make the model concise; it truncates it, and on reasoning models the cap covers reasoning tokens too, so a tight cap can spend the whole budget thinking and return nothing useful. Use the cap to stop runaways and use instructions, `verbosity` and effort to shape length.

### High risk: history, top-k and the system prompt

These are the cuts that look best on a spreadsheet and fail most often. Summarising history loses the exact figure the user quoted three turns ago. Lowering `top_k` removes the chunk that answered the long-tail question. Deleting a "redundant" system prompt rule removes the one guarding an edge case nobody tested. I don't rule them out, but each one goes through the full evaluation, not a spot check.

## Prove quality held, one cut at a time

The gate is the same one I use for any prompt or model change, described in [gating LLM changes on groundedness flips](/blog/2026-03-09-how-i-evaluate-llm-changes-tracking-groundedness-before-celebrating-fluency/): a fixed evaluation set, baseline and candidate run on the same inputs, and a count of rows that went from passing to failing rather than a comparison of averages. Three adjustments make it work for token cuts.

First, change one segment per run. If you deduplicate context, drop two tools and lower reasoning effort together, a regression tells you nothing about which change caused it, and a pass hides the fact that one cut was harmful and another was compensating.

Second, set a noise floor. Generation is nondeterministic and so is an LLM judge, so run the baseline against itself two or three times before testing any cut, and treat flip counts at or below what that produces as noise.

Third, record token usage alongside the scores. Each candidate should produce a pair of numbers: tokens saved per query and quality rows lost. A cut that saves 8% with zero flips ships. A cut that saves 30% with three flips above the noise floor on high-stakes questions needs a human decision, and I'd usually rather keep those tokens. The [Azure AI Evaluation SDK](https://learn.microsoft.com/azure/foundry-classic/how-to/develop/evaluate-sdk) gives you groundedness and relevance evaluators to score the rows, and the response's `usage` block gives you the token side, so there's no reason to judge the trade-off on one number alone.

## When not to bother

- **Cached tokens are already discounted.** On Azure OpenAI, a stable prefix of at least 1,024 tokens is billed at the cached rate (a discount on input price for Standard deployments, up to 100% on Provisioned) once it hits the [prompt cache](https://learn.microsoft.com/azure/foundry/openai/how-to/prompt-caching). Trimming a well-cached system prompt saves far less than its token count suggests, and trimming it below 1,024 tokens can lose the discount altogether.
- **Low volume.** If the app serves a few hundred queries a day, the evaluation runs cost more engineering time than the tokens they save. Fix duplicates and move on.
- **The cost isn't in the tokens.** If most of the bill is the hourly hosting fee on an idle fine-tuned deployment, or provisioned throughput sized far above actual use, an audit of prompt segments optimises the wrong line.
- **Model choice dwarfs everything.** Routing easy questions to a smaller model often saves more than every segment cut combined. Do that first, then audit what the remaining traffic sends.

## The order I'd follow

Profile a real sample, not a hand-written example. Deduplicate context and scope tools per route, because those rarely cost quality. Shape output with format instructions, `verbosity` and reasoning effort, and evaluate each change. Treat history, `top_k` and system prompt cuts as product decisions, each gated on zero or explicitly accepted regressions. Token waste is worth removing, but the answer is the product: any saving that shows up as a worse answer was never waste.
