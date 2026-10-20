---
title: "Raising Groundedness Without Guesswork: Label the Failures First"
description: "Once retrieval is ruled out, ungrounded answers fall into a few repeatable patterns: label them, fix one at a time and track completeness too."
author: Michael John Peña
draft: false
date: 2026-04-11
tags:
  - AI
  - LLM
  - Evaluation
  - RAG
  - Microsoft Foundry
---

A groundedness score tells you that answers drift from their sources. It doesn't tell you why, and that is where most improvement work turns into guesswork: someone tweaks the system prompt, tries a newer model, the answers read more smoothly, and the team calls it progress. Fluency is the easiest thing to improve and the least informative thing to celebrate. If you want groundedness to go up and stay up, you need to know which kind of failure you're fixing before you change anything.

This post picks up where two earlier ones stop. [Rule out retrieval first](/blog/2026-03-10-rag-tradeoffs-i-keep-seeing-fixing-retrieval-before-touching-prompts/) covers the case where the right passage never reached the model. [Gating on groundedness flips](/blog/2026-03-09-how-i-evaluate-llm-changes-tracking-groundedness-before-celebrating-fluency/) covers deciding whether a change can ship. Here the right passage *was* in the context, the answer still says something the context doesn't, and the question is how to make that happen less often.

## Why "fix the prompt" is not a plan

The usual loop is: read three bad answers, add a sentence to the prompt, rerun, look at the average. Three things make that unreliable.

- **The three answers you read are not a sample.** They are the most memorable ones, usually the most embarrassing. The failure that accounts for half your ungrounded rows may look boring and never get read.
- **Different failures need opposite fixes.** "Be thorough" helps an answer that dropped a condition and hurts one that filled a gap from general knowledge. A single prompt edit aimed at both is a coin toss.
- **The cheapest way to raise groundedness is to say less.** A model told to "only use the provided sources" will happily answer "I couldn't find that" to questions the context does answer. The groundedness average rises, and users get less help.

So before touching the prompt, I label the failures, count them, and fix the largest group first.

## The patterns worth labelling

These are the categories I use for ungrounded answers where the supporting passage was present. They're not an official taxonomy; they're the distinctions that change what you'd do next.

| Pattern | What it looks like | First fix to try |
|---|---|---|
| Gap filling | The context answers part of the question; the model completes the rest from general knowledge | Tell it what to do when the context is partial, and give it a sanctioned way to say so |
| Dropped qualifier | "Returns within 30 days" when the source says "within 30 days, unopened, with proof of purchase" | Ask for conditions and exceptions to be stated with the rule; cite the passage per claim |
| Blended sources | Two chunks about different products, plans or regions merged into one answer | Put source title, product and effective date in each chunk's header so the model can tell them apart |
| Derived claim | The answer computes a total, a date or a comparison the context never stated | Do arithmetic and date logic in code or a tool, and pass the result in as context |
| Conflicting context | Two retrieved chunks disagree (old and new policy) and the model picks one | Fix the index: version or retire stale documents. A prompt can't know which one is current |
| Judge error | A person reads the row and finds the answer is supported | Not a model fix. Count it, and recalibrate the judge if it's frequent |

Two of these aren't generation problems at all. Conflicting context is a content problem that surfaces at generation time, and judge error is a measurement problem. Labelling them separately stops you spending a week on prompt edits that can't help.

The judge-error row matters more than it looks. The `GroundednessEvaluator` is an LLM judge, and a derived claim that is arithmetically correct can still be scored as unsupported because the number never appears in the context. Whether that counts as a failure is a product decision, not something the score can settle. My post on [checking the judge before trusting it](/blog/2026-02-07-evaluating-llm-outputs/) covers measuring how often it's wrong.

## Score two things, not one

Because the easiest groundedness gain is an evasive answer, every run I score gets two numbers from the [Azure AI Evaluation SDK](https://learn.microsoft.com/azure/foundry-classic/how-to/develop/evaluate-sdk) (`azure-ai-evaluation`, [1.16.5 on PyPI](https://pypi.org/project/azure-ai-evaluation/#history) as of this post; a stable 1.x package, although Learn still labels local SDK evaluation as preview):

- **Groundedness**, from `GroundednessEvaluator` with `query` supplied. In that mode its 1–5 rubric gives 2 for an answer containing information the context doesn't support, 3 for "nothing to ground" (the rubric names clarifying questions, polite filler and follow-up questions; plain refusals usually land there too, but spot-check them), 4 for correct but incomplete, and 5 for fully grounded and complete. I treat 1–2 as ungrounded and 3 as a non-answer, and count them separately.
- **Completeness**, from `ResponseCompletenessEvaluator`, which compares the response with a ground-truth answer and scores how much of it the response covers. It needs a reference answer per case, and the SDK marks it experimental; the [RAG evaluators reference](https://learn.microsoft.com/azure/foundry-classic/concepts/evaluation-evaluators/rag-evaluators) describes it as the recall counterpart to groundedness's precision.

A fix is only a fix if ungrounded rows go down and non-answers and completeness hold. If ungrounded drops by ten and non-answers rise by ten, you've traded hallucinations for refusals, and whether that's acceptable depends on the domain. For a pricing assistant it might be; for an internal search tool it's usually not.

Fluency doesn't appear on that scoreboard. Most current models write fluent prose, so fluency scores sit near the top and move for reasons unrelated to correctness. I only look at it when choosing between two variants that are already tied on both of the numbers above.

## The scoring script

This scores one variant's responses against frozen inputs, writes every ungrounded or non-answer row to a CSV with the judge's reason, and prints the three counts. Run it once for the baseline and once per variant, always against the same `cases.jsonl` so the context is identical. Keep the SDK version fixed across baseline and variants too: the judge's rubric ships inside the package, so an upgrade between runs can move scores on its own.

```bash
pip install "azure-ai-evaluation==1.16.5" azure-identity
```

```python
from __future__ import annotations

import csv
import json
import math
import sys
from pathlib import Path

from azure.ai.evaluation import (
    AzureOpenAIModelConfiguration,
    GroundednessEvaluator,
    ResponseCompletenessEvaluator,
)
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
judge = AzureOpenAIModelConfiguration(
    azure_endpoint="https://<your-resource-name>.openai.azure.com",
    azure_deployment="<your-judge-deployment>",
)
# Add is_reasoning_model=True to both constructors if the judge is a reasoning model.
groundedness = GroundednessEvaluator(judge, credential=credential)
completeness = ResponseCompletenessEvaluator(judge, credential=credential)


def load(path: str) -> dict[str, dict]:
    rows = (json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip())
    return {row["id"]: row for row in rows}


def main(variant: str) -> int:
    cases = load("cases.jsonl")
    responses = load(f"{variant}_responses.jsonl")
    missing = sorted(set(cases) - set(responses))
    if missing:
        raise ValueError(f"No response for: {missing}")

    ungrounded = non_answers = 0
    completeness_scores: list[float] = []
    with open(f"{variant}_triage.csv", "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["id", "category", "score", "bucket", "judge_reason", "pattern"])
        for cid, case in cases.items():
            response = responses[cid]["response"]
            g = groundedness(query=case["query"], context=case["context"], response=response)
            score = float(g["groundedness"])
            if math.isnan(score):
                raise RuntimeError(f"[{cid}] judge returned no groundedness score: {g}")

            c = float(completeness(ground_truth=case["ground_truth"], response=response)["response_completeness"])
            if not math.isnan(c):
                completeness_scores.append(c)

            if score <= 2:
                ungrounded += 1
                bucket = "ungrounded"
            elif score < 4:
                non_answers += 1
                bucket = "non-answer"
            else:
                continue
            # Leave "pattern" empty: a person fills it in after reading the row.
            writer.writerow([cid, case["category"], score, bucket, g.get("groundedness_reason", ""), ""])

    mean_c = sum(completeness_scores) / len(completeness_scores) if completeness_scores else float("nan")
    print(f"{variant}: cases={len(cases)} ungrounded={ungrounded} non_answers={non_answers} "
          f"mean_completeness={mean_c:.2f} (scored {len(completeness_scores)})")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python triage.py <variant>")
    sys.exit(main(sys.argv[1]))
```

Each line of `cases.jsonl` holds the frozen query, the exact context the generator saw, and a reference answer; `<variant>_responses.jsonl` holds `{"id": ..., "response": ...}` per line:

```json
{"id": "returns-012", "category": "policy", "query": "Can I return headphones I've opened?", "context": "[returns_policy.md | effective 2026-01-01] Items can be returned within 30 days with proof of purchase. Opened audio products can only be exchanged for the same item if faulty.", "ground_truth": "No refund for opened headphones. They can be exchanged for the same item within 30 days, with proof of purchase, only if faulty."}
```

The identity running the script needs the Cognitive Services OpenAI User role on the judge's Azure OpenAI resource. Every case costs two judge calls (groundedness and completeness), and the loop below reruns the whole set, so on a large set I score completeness only on a fixed sample, or only where `ground_truth` exists, and keep groundedness on every row. Pin the judge to a specific model version that differs from the model under test, and keep it fixed across every variant, or you're comparing judges rather than fixes. The `groundedness_reason` column is a hint, not a label. The judge explains what it thinks is unsupported, which speeds up reading, but a person decides the pattern.

## Running the loop

1. **Score the baseline** and label every row in the triage CSV. If your baseline is mostly grounded, a few hundred cases usually yields tens of rows to read; my rule of thumb is to budget an afternoon, not a project.
2. **Count by pattern** with a pivot over the `pattern` column. Pick the largest group that is a generation problem, not conflicting context or judge error.
3. **Make one change** aimed at that pattern. One. If you change the prompt and the model together, you won't know which helped.
4. **Rescore against the same cases** and compare the three numbers, then read the rows that moved. Rescore those rows before counting them, especially with a reasoning-model judge: the rubric runs at temperature 0 for standard models, but reasoning models drop temperature control, so a one-row move can be judge noise (the [gating post](/blog/2026-03-09-how-i-evaluate-llm-changes-tracking-groundedness-before-celebrating-fluency/) covers re-scoring flips). A gap-filling fix that works should shrink that group without growing non-answers.
5. **Route the rest.** Conflicting-context rows go to whoever owns the index. Judge-error rows go into the judge calibration set.

Post-hoc correction is tempting at this point. Azure AI Content Safety [groundedness detection](https://learn.microsoft.com/azure/ai-services/content-safety/concepts/groundedness) (a preview API) has a correction option that uses your own Azure OpenAI deployment to rewrite flagged sentences to match the sources. It can be a reasonable safety net, but it adds a call per response and hides the pattern you should be fixing upstream. I'd add it after the loop above has run out of cheap wins, not instead of it.

## When this is more process than you need

- **Small or new sets.** With thirty cases, one row moving changes every number. Grow the set from [real queries, including unanswerable ones](/blog/2026-03-31-llm-evaluation-journal-reducing-hallucinations-through-better-test-design/), before you trust pattern counts.
- **No reference answers.** Without `ground_truth` you lose the completeness check, and the loop will drift toward evasive answers. Watch the non-answer count instead and read those rows.
- **Retrieval is still the main problem.** If most failures turn out to be "the passage wasn't there", stop labelling generation patterns and fix retrieval first.
- **Deterministic checks will do.** If grounded means "every price matches the price table", compare the numbers in code. It's cheaper and never disagrees with itself.

## What to take from this

Improving groundedness is a sorting problem before it's a prompting problem. Label the ungrounded answers, fix the biggest generation pattern with one change, and judge the result on three numbers: ungrounded, non-answers and completeness. Fluency gets a vote only when everything else is tied.
