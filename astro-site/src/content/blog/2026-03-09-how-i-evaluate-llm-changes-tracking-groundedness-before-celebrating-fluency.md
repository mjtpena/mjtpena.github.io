---
title: "Gating LLM Changes on Groundedness Flips, Not Fluency Averages"
description: "How I compare a baseline and a candidate prompt or model on frozen context, count groundedness regressions per row, and treat fluency as a tie-breaker."
author: Michael John Peña
draft: false
date: 2026-03-09
tags:
  - AI
  - LLM
  - Evaluation
  - RAG
  - Microsoft Foundry
---

The usual evidence offered for a model upgrade or prompt rewrite is that the new answers read better: smoother, better structured, more confident. That is exactly the problem, because a fluent answer that adds a fact the retrieved documents never stated is worse than a clumsy answer that sticks to them, and it's harder for a reviewer to spot. So before I celebrate any change to a grounded assistant, I check one thing with a row-by-row release gate: did any answer that used to stay inside its sources stop doing so? Fluency only gets consulted once that's settled.

## Why averages and fluency hide the regressions that matter

A typical "eval" for a change is two dashboards side by side: average groundedness 4.3 before, 4.4 after, fluency up from 4.1 to 4.6, ship it. Three things are wrong with that.

First, an average can rise while individual answers get worse. If the candidate improves twenty vague answers from 4 to 5 and breaks two answers from 5 to 2, the mean goes up and two users now get a wrong refund window or a made-up policy clause. Those two rows are the release decision; the other twenty are a nice-to-have.

Second, fluency judges are close to their ceiling with current models. Most capable models write grammatical, well-organised prose, so fluency scores cluster at the top and differences between candidates are small and noisy. A fluency gain is easy to get and tells you little about whether the answer is right.

Third, fluency and groundedness can pull in opposite directions. A prompt that asks the model to be "helpful and complete" often produces richer, more fluent answers by filling gaps from the model's general knowledge. That's the exact behaviour a retrieval-augmented system is meant to avoid.

My rule of thumb: groundedness is a gate, fluency is a tie-breaker. If the candidate introduces a confirmed groundedness regression on any row in a category you care about, it doesn't ship, no matter how much better it reads.

## Isolate the change before you score it

If you rerun the whole pipeline for the baseline and the candidate, retrieval can return different chunks on each run (index updates, embedding model changes, ties in ranking). Then a groundedness difference might come from retrieval, not from the change you're testing.

So I split the comparison in two:

| Run | What's held fixed | What it tells you |
|---|---|---|
| Frozen-context comparison | Query and retrieved context recorded once and replayed to both baseline and candidate | Whether the prompt or model change itself made answers less grounded |
| End-to-end run | Nothing; live retrieval for both | Whether the system as a whole still behaves, including retrieval drift |

The frozen-context run is the gate for prompt and model changes. Record each test query with the exact context string the generator saw, store it alongside the case, and feed that same string to both versions. The end-to-end run still matters, but when it disagrees with the frozen run you know to look at retrieval first. That ordering mirrors the advice in my post on [why LLM judges need calibrating](/blog/2026-02-07-evaluating-llm-outputs/): narrow what a score can mean before you act on it.

## Read the groundedness rubric before you pick a threshold

I use the `GroundednessEvaluator` from the [Azure AI Evaluation SDK](https://learn.microsoft.com/azure/foundry-classic/how-to/develop/evaluate-sdk) (`azure-ai-evaluation`, a stable 1.x package on PyPI, although Microsoft Learn still labels local evaluation with the SDK as preview; [1.15.3](https://pypi.org/project/azure-ai-evaluation/#history) was the latest release at the time of writing). It's an LLM judge that scores 1 to 5 and adds a pass/fail result against a threshold that defaults to 3. The default is where people get caught, and the reason is in the rubric itself, which ships as open prompt files in the [SDK source for 1.15.3](https://github.com/Azure/azure-sdk-for-python/tree/azure-ai-evaluation_1.15.3/sdk/evaluation/azure-ai-evaluation/azure/ai/evaluation/_evaluators/_groundedness).

When you pass `query`, the evaluator uses a different prompt from the response-and-context-only version, and the levels mean:

| Score | Meaning when `query` is supplied |
|---|---|
| 1 | Unrelated to the question and the context |
| 2 | Attempts an answer but includes information the context doesn't support |
| 3 | Nothing to ground: clarifying questions, polite filler, follow-ups |
| 4 | Correct but incomplete; omits details the context contained |
| 5 | Fully grounded and complete |

Two consequences follow. A score of 2 is the hallucination signal, and with the default threshold of 3, a candidate that answers "Could you clarify what you mean?" to everything passes. A model change that makes the assistant evasive looks fine on a pass rate. So I don't treat this as one pass/fail number. I bucket each row: 1–2 is **ungrounded**, 3 is a **non-answer**, 4 is **partial**, 5 is **grounded**, and I track movement between buckets in both directions.

The second consequence: without `query`, level 3 means "accurate but vague", a different definition. Pick one mode and use it for both baseline and candidate, or you're comparing two rubrics.

There's also a `GroundednessProEvaluator`, which returns a true/false verdict from the Azure AI Content Safety service rather than an LLM judge you configure. The [RAG evaluators reference](https://learn.microsoft.com/azure/foundry-classic/concepts/evaluation-evaluators/rag-evaluators) lists it as preview, and the SDK marks it experimental. It needs a Foundry project (`azure_ai_project`) and a credential rather than a model config, and only runs in regions that support the service-based evaluators, so check availability before wiring it into the gate. It's a useful second opinion on rows that flip, but I wouldn't make a preview evaluator the only gate.

## The comparison script

This runs both versions' responses through the same judge, buckets each row, re-scores any row that newly became ungrounded, and exits non-zero on a confirmed regression in a high-stakes category so it can fail a pipeline. It's a sketch of the gate, not a framework: sequential calls, no retries.

The re-score is weaker than it looks. With a non-reasoning judge the built-in groundedness prompt runs at temperature 0, so a second call mostly repeats the first verdict. With `is_reasoning_model=True` the SDK drops temperature, so the re-score catches more run-to-run variance, but it is still the same judge and still not a second opinion. Either way it can't catch a judge that is consistently wrong. For a real second opinion, re-score flipped rows with a different judge deployment, or with `GroundednessProEvaluator`, or send them to human review.

Install the packages:

```bash
pip install "azure-ai-evaluation>=1.14" azure-identity
```

The script runs on Python 3.9 or later (the `from __future__ import annotations` line keeps the newer type hints valid on 3.9). I use 1.14 or later because that release fixed `GroundednessEvaluator` ignoring `is_reasoning_model` and the credential when `query` is supplied. The identity running the script needs the Cognitive Services OpenAI User role on the judge's resource. If the judge deployment is a reasoning model (for example o3, o4-mini or gpt-5, but not gpt-5-chat), pass `is_reasoning_model=True` to both evaluators, as the comments in the constructors show. Pin the judge to a specific model version that is different from the model under test, and keep it the same for both runs.

```python
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from azure.ai.evaluation import (
    AzureOpenAIModelConfiguration,
    FluencyEvaluator,
    GroundednessEvaluator,
)
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
judge_config = AzureOpenAIModelConfiguration(
    azure_endpoint="https://<your-resource-name>.openai.azure.com",
    azure_deployment="<your-judge-deployment>",
)
# Add is_reasoning_model=True to both constructors when the judge is a reasoning model.
groundedness = GroundednessEvaluator(judge_config, credential=credential)
fluency = FluencyEvaluator(judge_config, credential=credential)

BLOCKING_CATEGORIES = {"policy", "pricing", "safety"}
BUCKETS = {1: "ungrounded", 2: "ungrounded", 3: "non-answer", 4: "partial", 5: "grounded"}


def load(path: str) -> dict[str, dict]:
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    return {row["id"]: row for row in (json.loads(line) for line in lines if line.strip())}


def grounded_score(case: dict, response: str) -> float:
    result = groundedness(query=case["query"], context=case["context"], response=response)
    score = float(result["groundedness"])
    if math.isnan(score):
        raise RuntimeError(f"[{case['id']}] judge returned no score: {result}")
    return score


def fluency_score(response: str) -> float | None:
    score = float(fluency(response=response)["fluency"])
    return None if math.isnan(score) else score


def bucket(score: float) -> str:
    return BUCKETS[min(5, max(1, round(score)))]


def main() -> int:
    cases = load("cases.jsonl")
    baseline = load("baseline_responses.jsonl")
    candidate = load("candidate_responses.jsonl")
    missing = [cid for cid in cases if cid not in baseline or cid not in candidate]
    if missing:
        raise ValueError(f"Cases without both responses: {missing}")

    regressions, unstable, non_answers_added, moved, ties, persistent = [], [], [], [], [], []
    for cid, case in cases.items():
        before = bucket(grounded_score(case, baseline[cid]["response"]))
        after = bucket(grounded_score(case, candidate[cid]["response"]))

        if after == "ungrounded" and before != "ungrounded":
            # Re-score once to absorb residual non-determinism; this is not a second opinion.
            if bucket(grounded_score(case, candidate[cid]["response"])) == "ungrounded":
                regressions.append((cid, case["category"], before))
            else:
                unstable.append(cid)
        elif after == "non-answer" and before in ("partial", "grounded"):
            non_answers_added.append(cid)
        elif after == "ungrounded":
            persistent.append(cid)
        elif after != before:
            moved.append((cid, before, after))
        elif after in ("partial", "grounded"):
            ties.append(cid)

    blocking = [r for r in regressions if r[1] in BLOCKING_CATEGORIES]
    review = [r for r in regressions if r[1] not in BLOCKING_CATEGORIES]
    print(f"Cases: {len(cases)}  blocking regressions: {len(blocking)}  "
          f"regressions to review: {len(review)}  new non-answers: {len(non_answers_added)}")
    for cid, category, before in blocking:
        print(f"  REGRESSION [{category}] {cid}: {before} -> ungrounded")
    for cid, category, before in review:
        print(f"  REVIEW [{category}] {cid}: {before} -> ungrounded; read before shipping")
    for cid in non_answers_added:
        print(f"  NON-ANSWER {cid}: candidate stopped answering")
    for cid in unstable:
        print(f"  UNSTABLE {cid}: judge disagreed with itself; send to human review")
    for cid, before, after in moved:
        print(f"  MOVED {cid}: {before} -> {after}")
    for cid in persistent:
        print(f"  STILL UNGROUNDED {cid}")

    if blocking:
        return 1

    # Groundedness is settled; only now look at fluency, and only on rows grounded or partial in both.
    if ties:
        deltas, dropped = [], 0
        for cid in ties:
            after_f = fluency_score(candidate[cid]["response"])
            before_f = fluency_score(baseline[cid]["response"])
            if after_f is None or before_f is None:
                dropped += 1
                continue
            deltas.append(after_f - before_f)
        if deltas:
            print(f"Mean fluency change on {len(deltas)} tied rows: {sum(deltas) / len(deltas):+.2f}")
        if dropped:
            print(f"  WARNING: {dropped} tied rows skipped because the fluency judge returned no score")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Each line of `cases.jsonl` holds the frozen inputs, and the two response files hold `{"id": ..., "response": ...}` per line:

```json
{"id": "refund-007", "category": "policy", "query": "How long do I have to return an item?", "context": "returns_policy.md: Items can be returned within 30 days of purchase with proof of purchase."}
```

A few design choices are deliberate. A regression is a row that moved *into* ungrounded, not a drop in average, and only regressions in `BLOCKING_CATEGORIES` fail the build; the rest print as REVIEW rows for a person to read. A row whose re-score disagrees with the first verdict is reported as unstable rather than silently dropped, because judge wobble on a flipped row is exactly what a human should look at. New non-answers are reported but don't fail the build on their own, because sometimes the candidate is right to ask for clarification; someone should read them. Rows that were already ungrounded in the baseline are listed as still ungrounded but don't block the change, because the candidate didn't cause them; they belong in the backlog, not the release decision. Every other bucket change, up or down, is printed as a move. And fluency only runs on rows that sat in the same partial or grounded bucket in both versions, so a fluency gain can never compensate for a groundedness loss, and two hallucinating answers never get compared on style.

## What I do with the result

A confirmed regression on a policy, pricing or safety category blocks the change outright; that's the exit code. On low-stakes categories the script only prints REVIEW rows, and I read them and decide, but my default is still no. When the gate passes, I read every row the script lists as moved, unstable or a new non-answer, not just the failures; improvements that look too good are often the judge rewarding a longer answer.

Treat the judge as an instrument with error bars. Before this gate is trusted to block releases on its own, its ungrounded verdicts need checking against human labels, which is the calibration loop from the [LLM-as-a-judge post](/blog/2026-02-07-evaluating-llm-outputs/). And remember what groundedness doesn't measure: an answer can be perfectly grounded in the wrong chunk. Retrieval quality needs its own checks.

## When this gate is the wrong tool

- **No retrieved context.** If the assistant answers from the model's own knowledge or from tool calls that aren't captured as context, there's nothing to ground against. Use reference answers and a correctness criterion instead.
- **Creative or drafting tasks.** For marketing copy or summaries meant to rephrase freely, fluency and tone are the product, and a strict groundedness gate will fight you.
- **Deterministic checks will do.** If "grounded" means "every figure in the answer appears in the source table", a string or number match in code is cheaper, faster and never disagrees with itself.
- **Tiny datasets.** With twenty cases, one flip is 5% of the category and one judge wobble decides the release. My rule of thumb, not a measured result, is at least 50 real queries in each high-stakes category before a single confirmed flip, checked by a second judge or a human, is allowed to block a release on its own. Below that, I treat flips as prompts for human review and build the set up from real queries first.

## The decision rule

Freeze the context, score baseline and candidate with the same pinned judge and the same rubric mode, and count rows that newly fall to a groundedness score of 2 or below. Any confirmed regression in a category that matters blocks the change. Watch for answers that quietly become non-answers, since the default threshold lets them pass. Only when groundedness holds does fluency get a vote, and then only to choose between two versions that are already equally faithful to their sources.
