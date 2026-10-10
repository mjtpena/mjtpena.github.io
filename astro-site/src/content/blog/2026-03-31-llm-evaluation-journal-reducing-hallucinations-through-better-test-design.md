---
title: "Designing LLM Test Cases That Catch Hallucinations"
description: "Most eval sets only ask questions the documents can answer. Add unanswerable, false-premise and stale-context cases, each with an expected behaviour."
author: Michael John Peña
draft: false
date: 2026-03-31
tags:
  - AI
  - LLM
  - Evaluation
  - RAG
  - Testing
---

Most evaluation sets for grounded assistants test only one thing: questions the documents can answer. That set can show you whether the system finds and repeats the right facts. It can't show you whether the system makes things up when the facts aren't there, and that's where most hallucinations happen. If every test case has an answer in the corpus, a model that never says "I don't know" gets a perfect score. The fix is to make every case state what the system should *do*, not just what a good answer looks like.

## Why answerable-only eval sets reward hallucination

Think about what a typical golden dataset rewards. Someone writes 200 question-and-answer pairs from the documentation, the team scores groundedness and relevance, and the numbers look healthy. Every one of those questions has an answer in the index. So the only behaviour you're measuring is "retrieve and restate". A prompt change that makes the model more willing to fill gaps from its own knowledge will often *improve* those scores, because answers get fuller and more confident.

Real traffic doesn't look like that. Users ask about products you don't document, policies that changed last quarter, and features that don't exist. Some of their questions assume something false ("Why was my refund rejected after 60 days?" when the policy is 30). A test set without those cases says nothing about how the system behaves when it should hold back.

## Four case types, each with an expected behaviour

I'd build every eval set from four case types. The key change is that each case records an **expected behaviour**, not just a reference answer:

| Case type | What it probes | Expected behaviour | Failure looks like |
|---|---|---|---|
| Answerable | Retrieval and faithful restatement | Answer, using the facts in context | Wrong or missing facts, or an unnecessary refusal |
| Unanswerable | Willingness to stop | Say the documents don't cover it | A confident answer built from general knowledge |
| False premise | Whether the model corrects the user | Correct the premise using the context | Accepting the premise and explaining it |
| Stale or conflicting context | Which source wins | Use the current source; don't restate the superseded value | Quoting the superseded value |

The unanswerable cases need care. The best ones are *near misses*: questions close enough to the corpus that retrieval returns something plausible. "What's the warranty on the X200?" when you only document the X100 and X300 is a far better test than "What's the capital of France?" A near miss is when the model is most tempted to blend nearby facts into an answer.

For false-premise cases, take a real answerable question and change one detail so it contradicts the documents: a wrong number, a product the company doesn't sell, a step that isn't in the process. The expected response must contain the correct value from the context. Being polite about the wrong one isn't enough.

Stale-context cases matter most in corpora with versioned policies. Put both the old and new versions of a document into the frozen context on purpose and check which value the response uses. I'd ask for the current value only, rather than "mention the conflict", because a forbidden-value check can't tell "$15 is the old rate" from "$15 is the rate", and a simple rule you can score beats a nuanced one you can't. The next section shows why the judge alone misses this case.

Also include cases where only the old version is in context. The expected behaviour is to answer with it but say it may be out of date. If your index should never serve superseded documents, treat those cases as a retrieval and index-hygiene test rather than a generation test.

Partially answerable questions don't fit neatly into one type, and they're a common source of hallucination: "What's the return window and restocking fee?" when the corpus covers only the window. Multi-turn follow-ups often land here too. The expected behaviour is to answer the covered part and state the gap, so check the covered fact with `must_include` and any invented value for the gap with `must_not_include`.

## What the groundedness judge can and can't see

I score these sets with the `GroundednessEvaluator` from the [Azure AI Evaluation SDK](https://learn.microsoft.com/azure/foundry-classic/concepts/evaluation-evaluators/rag-evaluators) (`azure-ai-evaluation`, GA; [1.16.2](https://pypi.org/project/azure-ai-evaluation/#history) is the latest release at the time of writing). That's the local SDK path, documented under Foundry (classic); the new Foundry portal runs cloud evaluations through `azure-ai-projects`, but the groundedness rubric limits below apply either way. It's a good judge for one question: did the response stay inside its context? The rubric ships as open prompt files in the [SDK source](https://github.com/Azure/azure-sdk-for-python/tree/azure-ai-evaluation_1.16.2/sdk/evaluation/azure-ai-evaluation), and reading it shows three blind spots that make test design matter.

**A refusal will usually pass, whatever the case type.** When you pass `query`, a refusal fits the rubric's level 3 ("Nothing to be Grounded": clarifications, polite filler, follow-up questions), and the default pass threshold is 3. So a refusal on an unanswerable case passes, and a wrong refusal on an answerable case can also score 3 and pass, unless the judge decides it doesn't respond to the query and puts it at level 1. On pass rate alone, an over-cautious model and a well-calibrated one look the same.

**Groundedness is faithfulness to the context, not truth.** One of the rubric's own level-5 examples has the context "Cairo is the capital of Japan" and rewards the response that repeats it. That's the right design for a groundedness metric. But it means a stale-context case where the model quotes the superseded policy can score 5, because the old document was in the context. Only a check against the expected value catches it.

**It doesn't know what you expected.** The judge has no idea whether a case should be answered or refused. That information has to live in the test case. Switching to `GroundednessProEvaluator`, the service-based check that returns a pass/fail label through your Foundry project, doesn't change this: it judges whether the response is supported by the context, not whether the case should have been answered, so the deterministic expected-behaviour checks are still needed.

So I don't use one score for everything. The judge flags responses that add unsupported claims (level 2) or ignore the question entirely (level 1). Deterministic checks against each case's expected behaviour handle everything else. My post on [gating changes on groundedness flips](/blog/2026-03-09-how-i-evaluate-llm-changes-tracking-groundedness-before-celebrating-fluency/) covers the baseline-versus-candidate comparison. This post is about what goes *into* the set.

## The test case format

Each line of the JSONL file is a case with a frozen context, the recorded response from the system under test, and the expectation:

```jsonl
{"id": "ans-014", "type": "answerable", "expect": "answer", "query": "How long do I have to return an unopened item?", "context": "returns-policy-v3.md: Unopened items can be returned within 30 days of delivery.", "response": "You can return unopened items within 30 days of delivery.", "must_include": ["30 days"], "must_not_include": []}
{"id": "una-003", "type": "unanswerable", "expect": "abstain", "query": "What is the warranty period for the X200?", "context": "warranty.md: The X100 has a 12-month warranty. The X300 has a 24-month warranty.", "response": "I can't find that in the provided documents.", "must_include": [], "must_not_include": ["12-month", "24-month", "18-month"]}
{"id": "fp-007", "type": "false_premise", "expect": "answer", "query": "Why was my refund rejected after 60 days if the policy allows 90?", "context": "returns-policy-v3.md: Refunds are available within 30 days of delivery.", "response": "The refund window is 30 days from delivery, not 90, so a request at 60 days falls outside it.", "must_include": ["30 days"], "must_not_include": []}
{"id": "stale-002", "type": "stale_context", "expect": "answer", "query": "What is the express shipping fee?", "context": "shipping-2025.md (superseded): Express shipping is $15. shipping-2026.md (current): Express shipping is $12.", "response": "Express shipping is $12 under the current policy.", "must_include": ["$12"], "must_not_include": ["$15"]}
```

The script assumes the system prompt tells the model to use one fixed sentence when the documents don't cover a question. A fixed refusal string makes abstention easy to detect deterministically. If your system can't promise that, have it return a structured `answerable` flag, or classify refusals with a separate judge. Don't let the groundedness score stand in for it.

## The scoring script

This scores each case against its expected behaviour. It reports hallucination rate (answered when it should have abstained, used a forbidden value, or scored 1 or 2 on groundedness) separately from over-refusal rate (abstained when it should have answered), broken down by case type. It exits non-zero when either goes over budget, so it can fail a pipeline.

```bash
pip install "azure-ai-evaluation>=1.16" azure-identity
```

The identity running it needs the Cognitive Services OpenAI User role on the judge's Azure OpenAI resource. Use a judge deployment that is not the model under test.

```python
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

from azure.ai.evaluation import GroundednessEvaluator
from azure.identity import DefaultAzureCredential

REFUSAL = "i can't find that in the provided documents"
MAX_HALLUCINATION_RATE = 0.02
MAX_OVER_REFUSAL_RATE = 0.10

model_config = {
    "azure_endpoint": "https://<your-resource-name>.openai.azure.com",
    "azure_deployment": "<your-judge-deployment>",
    "api_version": "2024-10-21",
}
judge = GroundednessEvaluator(model_config, credential=DefaultAzureCredential())


def contains(text: str, phrase: str) -> bool:
    # Whole-value match: "$15" must not match "$150" or "$15.00".
    pattern = rf"(?<![\w.]){re.escape(phrase.lower())}(?!\.?\d)"
    return re.search(pattern, text) is not None


def score_case(case: dict) -> dict:
    text = case["response"].replace("’", "'").lower()
    abstained = REFUSAL in text
    forbidden = [s for s in case["must_not_include"] if contains(text, s)]
    missing = [s for s in case["must_include"] if not contains(text, s)]

    hallucinated = bool(forbidden)
    over_refused = False

    if case["expect"] == "abstain":
        hallucinated = hallucinated or not abstained
    elif abstained:
        over_refused = True
    else:
        result = judge(query=case["query"], context=case["context"], response=case["response"])
        score = result.get("groundedness")
        # An unparseable judge output comes back as NaN, and nan <= 2 is False.
        if score is None or math.isnan(score) or score <= 2:
            hallucinated = True
        if missing:
            hallucinated = True

    return {
        "id": case["id"],
        "type": case["type"],
        "expect": case["expect"],
        "hallucinated": hallucinated,
        "over_refused": over_refused,
        "forbidden": forbidden,
        "missing": missing,
    }


def main(path: str) -> int:
    cases = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
    if not cases:
        print("no cases")
        return 1
    results = [score_case(c) for c in cases]

    by_type = defaultdict(list)
    for r in results:
        by_type[r["type"]].append(r)
    for case_type, rows in sorted(by_type.items()):
        bad = sum(r["hallucinated"] for r in rows)
        refused = sum(r["over_refused"] for r in rows)
        print(f"{case_type:15} n={len(rows):4} hallucinated={bad} over_refused={refused}")

    hallucination_rate = sum(r["hallucinated"] for r in results) / len(results)
    should_answer = [r for r in results if r["expect"] == "answer"]
    over_refusal_rate = (
        sum(r["over_refused"] for r in should_answer) / len(should_answer) if should_answer else 0.0
    )
    print(f"hallucination rate: {hallucination_rate:.1%}")
    print(f"over-refusal rate:  {over_refusal_rate:.1%}")

    for r in results:
        if r["hallucinated"] or r["over_refused"]:
            print(json.dumps(r))

    failed = hallucination_rate > MAX_HALLUCINATION_RATE or over_refusal_rate > MAX_OVER_REFUSAL_RATE
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
```

A missing required fact counts as a hallucination here, not as incompleteness. That's deliberate. In false-premise and stale-context cases, a missing correct value usually means the model went with the user's number or the old document. If your answerable cases have long reference answers, split `must_include` into a separate "incomplete" count so it doesn't swamp the hallucination rate.

The judge runs one case at a time, which is fine for a few hundred cases. For larger sets, pass the evaluator to `azure.ai.evaluation.evaluate()`, which batches the calls, or wrap the judge calls in a `ThreadPoolExecutor`.

The budget values are placeholders. Agree them with whoever owns the product. Mind the sample size: with 200 cases, 2% is four failures, so one flaky case can move you across the line. Size each case type so a single case can't flip the gate, or gate on failure counts per type instead of one overall rate. Treat the two rates as a pair: you can always push hallucination rate down by refusing more, and that's why over-refusal gets its own budget.

## How I'd build the set

- **Start from production, then perturb.** Take real answerable questions and derive the other three types from them. Remove the source document to make an unanswerable case. Change a number to make a false premise. Add the superseded version of the document to make a stale-context case. Derived cases stay realistic in a way invented ones rarely do.
- **Weight towards near misses.** I'd aim for roughly a third of the set to be non-answerable or false-premise cases. If 95% of your cases are answerable, the hallucination rate is mostly measuring retrieval.
- **Freeze the context.** Record the exact context string for each case so generation is tested separately from retrieval, a split the [RAG design and evaluation guide](https://learn.microsoft.com/azure/architecture/ai-ml/guide/rag/rag-solution-design-and-evaluation-guide) also makes. Otherwise an index refresh can quietly turn an unanswerable case into an answerable one.
- **Hand-label a slice before trusting the judge.** The groundedness judge is still an LLM. Check its agreement with people on a sample first, as covered in [checking the judge before you trust the score](/blog/2026-02-07-evaluating-llm-outputs/).

## When this is overkill

If your assistant isn't grounded (a writing aid, a brainstorming tool), there's no context to be faithful to. Unanswerable and stale-context cases don't apply, and you'd evaluate it on task-specific criteria. If your corpus is small, static and unversioned, skip the stale-context type. And if your product decision is that the model *should* answer from general knowledge when the documents run out, then an abstain expectation is wrong for those cases. Write that decision into the test cases rather than leaving it implied.

## Two numbers, two budgets

Adding more answerable questions to your eval set won't reduce hallucinations. What helps is giving the set cases where the right answer is "no", "that's not correct" or "that changed", and recording that expectation in each case. Score invented content and unnecessary refusals as two separate numbers, each with its own budget. A model that does well on both is one I'd trust in production. One that only does well on the first has probably learned to refuse.
