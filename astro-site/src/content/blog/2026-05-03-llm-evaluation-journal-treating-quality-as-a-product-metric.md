---
title: "Does Your LLM Eval Score Predict Anything the Business Cares About?"
description: "Before an eval score becomes a product metric, join its verdicts to real outcomes like escalations and re-asks, and check whether failing answers do worse."
author: Michael John Peña
draft: false
date: 2026-05-03
tags:
  - AI
  - LLM
  - Evaluation
  - LLMOps
  - Data Engineering
---

Most LLM teams now have an evaluation score they report every week. Very few have checked whether that score moves with anything the business measures. If answers the groundedness judge fails don't lead to more escalations, more repeat questions or more reopened tickets than answers it passes, then the score is an engineering signal, not a product metric. Putting it in front of a product owner as one is a promise you can't keep.

I've written about turning a quality score into a [service level objective with an error budget](/blog/2026-03-20-llm-reliability-in-practice-treating-quality-as-a-product-metric/). This post is about the step before that: proving the score deserves the job. It's also the step most teams skip, because the evidence sits on the boundary between the AI team, which owns the verdicts, and the data engineering team, which owns the outcome data.

## An eval score is a proxy, so test it like one

Every offline quality metric is a proxy for something you can't measure directly at release time: did the user get what they needed? Proxies are fine. Untested proxies are how teams spend a quarter tuning prompts to raise a number that turns out to have no relationship with complaints.

There are three ways a proxy fails:

- **It measures the wrong thing.** Groundedness is high because the assistant quotes the policy document accurately, but users needed the exception process, which the document doesn't cover. The answer is grounded and useless.
- **It measures the right thing badly.** The judge is too lenient, so failing answers are rare and the ones it does catch are the obvious ones. I covered how to check that in [LLM-as-a-Judge: Check the Judge Before You Trust the Score](/blog/2026-02-07-evaluating-llm-outputs/).
- **It measures the right thing on the wrong traffic.** The eval set over-represents easy questions, so a high score says little about the questions that actually generate support load. [Building eval sets from real user queries](/blog/2026-04-22-how-i-evaluate-llm-changes-building-eval-sets-from-real-user-queries/) is the fix for that one.

Judge calibration catches the second failure. Only outcome data catches the first.

## Pick an outcome the product owner already watches

The test is simple in principle: take production answers that were scored by your evaluators, attach what happened next, and compare outcomes for answers that passed against answers that failed. The work is choosing the outcome.

| Outcome signal | Strength | Weakness |
|---|---|---|
| Escalation to a human within the session | Direct cost the business already tracks | Some users escalate regardless of answer quality |
| Same question re-asked within 10 minutes | Cheap to compute from logs, high volume | Needs a similarity rule; noisy for short queries |
| Support ticket reopened within 7 days | Strong signal for resolution | Slow, and only exists for ticketed workflows |
| Thumbs down | Explicit | Sparse and biased towards angry users |
| Copy, accept or apply action | Good for drafting and code assistants | Absence doesn't mean failure |

My rule of thumb is to use the outcome the product owner already has on a dashboard. If escalation rate is in their monthly report, use escalation. You want the conversation to end with "answers our evaluators fail escalate at twice the rate of answers they pass", in units the owner already cares about.

I'd avoid thumbs-down as the primary outcome. It's worth logging against the same response ID as everything else, but only a small and unrepresentative share of users ever press it. Treat it as a second check, not the test.

## The join is a data contract, not a notebook

This is where the handoff between teams matters. The AI team can produce per-response verdicts from the `azure-ai-evaluation` SDK or from continuous evaluation over sampled traffic, which Microsoft lists alongside tracing and monitoring in [Foundry observability](https://learn.microsoft.com/azure/foundry/concepts/observability). Evaluations, monitoring and tracing are generally available in Foundry, though agent evaluation and continuous evaluation of agents are still in preview, so I'd export the verdicts somewhere you control either way. The outcome events usually live in the data platform: contact centre tables, ticketing exports, product analytics.

The first version of this analysis is always a notebook that joins on whatever ID happened to be lying around. It works once and breaks the next time someone renames a column. I'd write down a small contract instead, owned by data engineering and agreed with the AI team:

- **Join key:** the response ID the application already logs with each model call, carried into the outcome event. Not a session ID, because one session holds several answers.
- **Outcome definition:** in writing, including the time window ("escalated within 30 minutes of the response").
- **Latency:** when the outcome is final. Reopened tickets need 7 days to settle; don't count a response as a non-reopen on day two.
- **Coverage:** what share of evaluated responses should have an outcome row, and an alert when the join rate drops.

The last point earns its keep. A silent drop in join coverage looks exactly like an improvement in outcomes, because the missing rows are usually the bad ones. A lightweight integration test that runs the join on yesterday's data and fails below the agreed coverage catches that before anyone draws a conclusion.

## The analysis script

Here's a complete script that does the comparison. It reads per-response verdicts and outcome events from two JSONL files, joins them on response ID, and reports the bad-outcome rate for answers that passed and failed each evaluator, with 95% Wilson intervals so small samples don't look more certain than they are. It needs Python 3.10 or later and nothing outside the standard library.

```python
"""Check whether evaluator verdicts predict a business outcome.

verdicts.jsonl, one row per evaluated response:
{"response_id": "resp_01", "groundedness_result": "pass",
 "relevance_result": "fail"}

outcomes.jsonl, one row per response whose outcome is final:
{"response_id": "resp_01", "bad_outcome": true}

Usage: python proxy_check.py verdicts.jsonl outcomes.jsonl
"""
import json
import math
import sys

EVALUATORS = ("groundedness_result", "relevance_result")
MIN_COVERAGE = 0.90   # agreed with data engineering in the contract
MIN_GROUP = 50        # smaller groups are reported but not judged
Z = 1.96              # 95% interval


def read_jsonl(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def wilson(bad: int, total: int) -> tuple[float, float]:
    if total == 0:
        return 0.0, 1.0
    p = bad / total
    denom = 1 + Z**2 / total
    centre = (p + Z**2 / (2 * total)) / denom
    half = Z * math.sqrt(p * (1 - p) / total + Z**2 / (4 * total**2)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def describe(label: str, bad: int, total: int) -> tuple[float, float]:
    low, high = wilson(bad, total)
    rate = bad / total if total else 0.0
    print(f"  {label:<5} n={total:<6} bad outcome {rate:6.1%}  "
          f"(95% CI {low:.1%} to {high:.1%})")
    return low, high


def main(verdict_path: str, outcome_path: str) -> None:
    verdicts = read_jsonl(verdict_path)
    outcome_rows = read_jsonl(outcome_path)
    for label, rows in (("verdicts", verdicts), ("outcomes", outcome_rows)):
        ids = [row["response_id"] for row in rows]
        if len(ids) != len(set(ids)):
            sys.exit(f"Duplicate response_id in {label}: fix the export first.")
    outcomes = {row["response_id"]: bool(row["bad_outcome"])
                for row in outcome_rows}

    joined = [(v, outcomes[v["response_id"]])
              for v in verdicts if v["response_id"] in outcomes]
    coverage = len(joined) / len(verdicts) if verdicts else 0.0
    print(f"Evaluated: {len(verdicts)}  joined: {len(joined)}  "
          f"coverage: {coverage:.1%}")
    if coverage < MIN_COVERAGE:
        sys.exit(f"Coverage below {MIN_COVERAGE:.0%}: fix the join first.")

    for name in EVALUATORS:
        groups = {"pass": [0, 0], "fail": [0, 0]}
        for verdict, bad in joined:
            result = verdict.get(name)
            if result in groups:
                groups[result][0] += int(bad)
                groups[result][1] += 1

        print(f"\n{name}")
        pass_low, pass_high = describe("pass", *groups["pass"])
        fail_low, fail_high = describe("fail", *groups["fail"])

        if min(groups["pass"][1], groups["fail"][1]) < MIN_GROUP:
            print("  Verdict: not enough samples in one group to judge.")
        elif fail_low > pass_high:
            print("  Verdict: failing answers do measurably worse. "
                  "Usable as a product proxy.")
        elif fail_high < pass_low:
            print("  Verdict: failing answers do better. "
                  "The evaluator is measuring something else.")
        else:
            print("  Verdict: no clear difference. "
                  "Don't report this as a product metric yet.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: proxy_check.py <verdicts.jsonl> <outcomes.jsonl>")
    main(sys.argv[1], sys.argv[2])
```

The non-overlapping interval test is conservative on purpose. Two intervals can overlap while the difference between the rates is still real, so "no clear difference" means "not proven", not "proven useless". I prefer that bias here. The cost of a false positive is a product owner who trusts a number that doesn't mean anything, and that's harder to undo than waiting another fortnight for more data.

## Reading the result honestly

Three things trip people up once the numbers come back.

**Difficulty confounds everything.** Hard questions fail evaluators more often and escalate more often, whether or not the answer was the cause. A strong relationship might just mean both are tracking question difficulty. If the data allows it, run the comparison within each intent or topic (the strata you already use for your eval set) and check the gap holds inside them. If it disappears within strata, the evaluator is a difficulty detector, which is useful for routing but not for judging releases.

**"No clear difference" may be the threshold, not the evaluator.** The pass/fail verdict from `azure-ai-evaluation` is a 1–5 score cut at a threshold (3 by default, returned as `groundedness_threshold` next to `groundedness_result`). If the threshold sits in the wrong place, the pass and fail groups blur together even when the score itself tracks outcomes. Before dropping an evaluator, rerun the comparison on the raw score bands (1–2, 3, 4–5) and see whether the bad-outcome rate steps down across them.

**A weak relationship is still information.** If failing groundedness barely moves escalations but failing relevance doubles them, that tells you where users actually feel the pain. I'd weight the release gate towards the evaluator that predicts outcomes, and keep the other as a diagnostic.

**The relationship drifts.** A new document set, a new user group or a UI change that makes escalation easier can all shift it. I'd rerun the check quarterly and after any change to the outcome definition, and treat it as part of the contract rather than a one-off study.

## When this is the wrong exercise

Don't do this before you have production traffic. Pilot users behave differently, and a few hundred responses won't give you groups big enough to judge.

Don't do it when there's no outcome worth the name. An internal brainstorming assistant has no escalation path and no ticket to reopen. Inventing a proxy for the proxy, such as session length, usually creates more arguments than it settles. In that case, reading a sample of conversations each week is the better use of time.

And don't do it if you can't get a stable join key into the outcome data. Matching on timestamps and user IDs produces a join that looks plausible and is wrong often enough to make the analysis worthless. Fix the logging first.

## Earn the label "product metric"

The decision I'd push for is this: an evaluator only goes on a product dashboard, or into an error budget, after you've shown that failing it predicts a worse outcome the business already tracks. Until then it's an engineering metric, and that's fine. Engineering metrics are how you debug.

If you want a starting point, pick one outcome the product owner already reports, agree the response-ID join and coverage threshold with data engineering, and run the comparison on a month of evaluated traffic. The [RAG design and evaluation guide](https://learn.microsoft.com/azure/architecture/ai-ml/guide/rag/rag-solution-design-and-evaluation-guide) and the [Well-Architected guidance for AI workloads](https://learn.microsoft.com/azure/well-architected/ai/) both treat evaluation as continuous. My decision rule: if the failing group's interval sits clearly above the passing group's on that month of data, with coverage at or above the agreed threshold, the evaluator goes on the product dashboard; otherwise it stays on the engineering one and you check again next quarter.
