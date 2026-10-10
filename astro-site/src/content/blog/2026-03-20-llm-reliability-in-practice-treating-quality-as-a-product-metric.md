---
title: "Quality SLOs for LLM Features: An Error Budget for Bad Answers"
description: "Treat answer quality like availability: define a good answer, agree a target with the product owner, and let the error budget decide when changes stop."
author: Michael John Peña
draft: false
date: 2026-03-20
tags:
  - AI
  - LLM
  - Evaluation
  - LLMOps
  - Microsoft Foundry
---

Most teams running an LLM feature can tell you its availability to two decimal places and its p95 latency to the millisecond. Ask them what share of answers last week were good enough and you get a groundedness chart, a thumbs-down count and a shrug. Quality ends up as an engineering curiosity instead of a number the product owner signs up to, so nobody can say whether a regression is tolerable or whether the next prompt change should ship.

My fix is to borrow what SRE teams already do for uptime: a service level indicator, a target, and an error budget with a policy attached. It works for answer quality with a few adjustments, and those adjustments are where most of the thinking goes.

## Why averages don't work as a product metric

The default quality metric is an average evaluator score: "groundedness is 4.3 out of 5". It looks precise and means almost nothing to the person who owns the product. An average hides the distribution. A drop from 4.3 to 4.2 could be every answer getting slightly worse, or 3% of answers going from fine to fabricated. Those are very different problems, and only one of them generates complaints.

Averages also can't carry a commitment. Nobody can tell a business owner what "4.3" promises a user. "At least 97% of sampled answers are grounded, relevant and correctly formatted" is something they can argue with, which is the point.

So the unit I want is the same one an availability SLO uses: a count of good events divided by valid events.

## Step one: define a good answer

This is the hard part and it is a product conversation, not an engineering one. A good answer is a binary judgement made of a few checks that all have to pass. For a grounded internal assistant I'd typically start with:

- **Grounded:** it doesn't state anything the retrieved context doesn't support.
- **Relevant:** it addresses the question that was asked.
- **Well formed:** it parses, cites its sources if the product promises citations, and stays within length limits.
- **Appropriate refusal:** if the context doesn't contain the answer, it says so rather than guessing.

Deterministic checks (parsing, citation presence, length) cost nothing and should run on every response. The judgement checks need an evaluator. The `azure-ai-evaluation` Python SDK already returns a binary verdict for its AI-assisted evaluators: `GroundednessEvaluator`, for example, produces a 1 to 5 score plus a `groundedness_result` of `pass` or `fail` against a threshold that defaults to 3 (the [RAG evaluators reference](https://learn.microsoft.com/azure/foundry-classic/concepts/evaluation-evaluators/rag-evaluators) shows the output, including `groundedness_threshold`). Use the pass/fail field, and set the threshold on purpose. A default of 3 on a 1 to 5 scale is generous for anything customer facing.

Before that verdict counts towards an SLO, check the judge against people who know the domain. An evaluator that waves through one bad answer in ten undercounts your bad answers, and overstates your remaining budget, by roughly that margin. I covered how to measure that in [LLM-as-a-Judge: Check the Judge Before You Trust the Score](/blog/2026-02-07-evaluating-llm-outputs/).

### What counts as a valid event

Decide what's excluded before you calculate anything, or the arguments start after the first bad week. I exclude requests that never reached the model (rejected by input validation or blocked by the content filter on the prompt side) and infrastructure failures, because those belong to the availability SLO. Counting a 5xx as both an outage and a bad answer double-charges the same incident. Output-side filter blocks are different: the model generated something, the filter cut it, and the user saw a truncated or empty answer (`finish_reason` of `content_filter`). I count those as bad answers, because from the user's side that's exactly what they were. If they're frequent enough to drown out the quality signal, split them into a separate safety SLI rather than excluding them, so they stay visible. Off-topic questions the assistant correctly declines stay in, and count as good.

## Step two: pick a sample and a window

You can't run an LLM judge on every production answer without roughly doubling your inference spend, and you don't need to. A consistent random sample is enough, provided it's big enough for the target you choose.

| Target | Budget (bad answers per 1,000) | Rough weekly sample I'd want |
|---|---|---|
| 90% | 100 | 200 to 300 |
| 95% | 50 | 400 to 600 |
| 97% | 30 | 700 to 1,000 |
| 99% | 10 | 2,000+, or don't bother |

The logic: with only a few dozen bad answers expected in a window, sampling noise swamps real movement and the budget flaps week to week. The same applies to burn rate, so the script below refuses to report one until the week has enough samples to expect about 20 bad answers at the target (roughly 670 at 97%), and flags the 28-day SLI as low confidence below four times that. That's why I'm wary of 99% quality targets. Unless the feature has the traffic and the evaluation budget to back it, a 99% target is a slogan, not a measurement.

I use a rolling 28-day window for the SLO and look at weekly numbers for burn. Shorter windows react to every prompt tweak; longer ones let a bad change sit for a month before the budget notices.

If you're building agents in Microsoft Foundry, continuous evaluation can score a sample of live runs and link the results to traces in Application Insights. The new Foundry portal sets it up from the [agent monitoring dashboard](https://learn.microsoft.com/azure/foundry/observability/how-to/how-to-monitor-agents-dashboard#set-up-continuous-evaluation); Foundry (classic) agents configure it through the SDK, as described in [continuous evaluation for agents (classic)](https://learn.microsoft.com/azure/foundry-classic/how-to/continuous-evaluation-agents), with a configurable sampling percentage and an hourly cap on evaluated runs. That's the same sampling argument as above, built into the product. It's in preview, so I'd use it as a feed into the SLI rather than the system of record. Export the per-row verdicts somewhere you control, because the SLO is a commitment, and commitments need data you can reproduce.

## Step three: calculate the SLI and the budget

Once every sampled answer has a set of pass/fail verdicts, the calculation is deliberately boring. Here's a complete script that reads evaluated rows from a JSONL file and reports the SLI, budget remaining and burn rate for a 28-day window. It needs Python 3.10 or later (it normalises the trailing `Z` that Application Insights exports use, which `datetime.fromisoformat` only accepts natively from 3.11) and nothing outside the standard library, so it runs the same whether the verdicts came from `azure-ai-evaluation`, Foundry continuous evaluation, or a human review queue.

```python
"""Quality SLO report from evaluated answer samples.

Each JSONL row is one sampled answer, for example:
{"timestamp": "2026-03-18T02:14:00+00:00", "excluded": false,
 "groundedness_result": "pass", "relevance_result": "pass", "format_ok": true}

Timestamps should be ISO 8601. A trailing "Z" is accepted, and a timestamp
without an offset is treated as UTC. Rows without a timestamp are skipped
and counted.

Usage: python quality_slo.py evaluated.jsonl
"""
import json
import math
import sys
from datetime import datetime, timedelta, timezone

TARGET = 0.97            # agreed with the product owner
WINDOW_DAYS = 28
MIN_EXPECTED_BAD = 20    # fewer expected bad answers than this is noise
MIN_WEEK_SAMPLES = math.ceil(MIN_EXPECTED_BAD / (1 - TARGET))  # 667 at 97%
MIN_WINDOW_SAMPLES = MIN_WEEK_SAMPLES * WINDOW_DAYS // 7
REQUIRED_RESULTS = ("groundedness_result", "relevance_result")


def is_good(row: dict) -> bool:
    verdicts_pass = all(row.get(key) == "pass" for key in REQUIRED_RESULTS)
    return verdicts_pass and row.get("format_ok") is True


def parse_timestamp(value: str) -> datetime:
    if value.endswith(("Z", "z")):
        value = value[:-1] + "+00:00"
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def load_rows(path: str, since: datetime) -> tuple[list[dict], int]:
    rows = []
    missing_timestamp = 0
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("excluded"):
                continue
            if not row.get("timestamp"):
                missing_timestamp += 1
                continue
            row["_ts"] = parse_timestamp(row["timestamp"])
            if row["_ts"] >= since:
                rows.append(row)
    return rows, missing_timestamp


def main(path: str) -> None:
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(days=WINDOW_DAYS)
    week_start = now - timedelta(days=7)

    rows, missing_timestamp = load_rows(path, window_start)
    if missing_timestamp:
        print(f"Skipped {missing_timestamp} rows with no timestamp")
    if not rows:
        print("No valid samples in the window.")
        return

    bad = sum(1 for row in rows if not is_good(row))
    sli = 1 - bad / len(rows)
    allowed_bad = (1 - TARGET) * len(rows)
    budget_left = 1 - bad / allowed_bad if allowed_bad else 0.0

    week = [r for r in rows if r["_ts"] >= week_start]

    print(f"Samples in window: {len(rows)}  bad: {bad}")
    confidence = ""
    if len(rows) < MIN_WINDOW_SAMPLES:
        confidence = f"  (low confidence: under {MIN_WINDOW_SAMPLES} samples)"
    print(f"SLI: {sli:.2%}  target: {TARGET:.0%}{confidence}")
    if budget_left < 0:
        print(f"Error budget exhausted (overspent by {-budget_left:.0%})")
    else:
        print(f"Error budget remaining: {budget_left:.0%}")

    if len(week) < MIN_WEEK_SAMPLES:
        print(f"Last 7 days burn rate: insufficient samples "
              f"({len(week)} of {MIN_WEEK_SAMPLES})")
    else:
        week_bad_rate = sum(1 for r in week if not is_good(r)) / len(week)
        burn_rate = week_bad_rate / (1 - TARGET)
        print(f"Last 7 days burn rate: {burn_rate:.1f}x")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: quality_slo.py <evaluated.jsonl>")
    main(sys.argv[1])
```

Burn rate is the number I watch most. A burn rate of 1.0 means you're spending budget exactly as fast as the target allows. Anything held above 1.0 ends the window in breach. I alert above 2x, because at that rate the 28-day budget is gone in two weeks, and you find out in week one instead of week four. Until the week has enough samples to expect about 20 bad answers at the target, I don't act on burn at all; the script says so instead of printing a number that looks precise. That floor sits just under the table's range on purpose: it's the least I'd accept, not what I'd aim for.

## Step four: write the policy before you need it

An error budget without a policy is a dashboard. The policy is what turns quality into a product metric, because it says in advance what the team gives up when quality slips. Mine is short:

- **Budget healthy (above 50% remaining):** ship prompt, retrieval and model changes through the normal evaluation gate.
- **Budget under 50%, or burn above 2x for a week:** changes that touch answer generation need a side-by-side comparison on frozen context before release (the approach in [Gating LLM Changes on Groundedness Flips, Not Fluency Averages](/blog/2026-03-09-how-i-evaluate-llm-changes-tracking-groundedness-before-celebrating-fluency/)), and the weekly review reads every failed sample.
- **Budget exhausted:** feature work on the assistant stops. The only changes that ship are ones aimed at fixing quality, plus rollbacks. The product owner can override this, in writing.

The override is important. A policy that can't bend gets ignored the first time a launch date collides with it. One that requires the owner to put their name on an exception gets followed, because now the trade-off is visible.

Make sure the policy covers changes you didn't make. An Azure OpenAI deployment can move to a new model version under its upgrade policy, and a re-indexed search corpus changes answers without a single line of code. Both should be recorded against the samples (the tagging approach in [Monitoring AI in Production](/blog/2026-02-13-monitoring-ai-production/)) so a budget drop points at a cause.

## When a quality SLO is the wrong tool

Don't do this for a prototype. Until the product has settled on what a good answer is, you'll redefine the SLI every fortnight and the budget will mean nothing.

Don't do it if you can't afford the sample. A quality SLO calculated from 40 judged answers a week is noise with a percentage sign. Spend the money on a fixed regression set and a human reading 30 conversations instead.

And don't let it replace reading answers. The SLI tells you that 3.4% of answers failed. It doesn't tell you that most of them were the same question about leave policy hitting a stale document. Someone still has to look.

## What changes when quality has a budget

The real benefit isn't the number. It's that the conversation about quality moves from "the model feels worse" to "we've spent 70% of this month's budget, so do we ship the new prompt or fix retrieval first?" That's a product decision, made by the person who owns the product, with data both sides agree on.

If you want to start small: pick two evaluator verdicts and one deterministic check, define good as all three passing, sample a few hundred answers a week, and agree a target with the product owner that's slightly below what you measure today. Then write down what happens when it's breached. The [Well-Architected guidance for AI workloads](https://learn.microsoft.com/azure/well-architected/ai/) covers continuous evaluation as part of operating AI workloads; the error budget is what gives that evaluation consequences.
