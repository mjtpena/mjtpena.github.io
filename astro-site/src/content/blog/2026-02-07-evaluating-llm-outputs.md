---
title: "LLM-as-a-Judge: Check the Judge Before You Trust the Score"
description: "An LLM judge has its own biases: how to write pass/fail criteria, measure its kappa and false-pass rate against human labels, and know when to skip it."
author: Michael John Peña
draft: false
date: 2026-02-07
tags:
  - AI
  - LLM
  - Evaluation
  - Testing
  - Azure OpenAI
---

When teams stop testing on vibes (five hand-picked prompts that looked fine), the usual next step is an LLM judge: a prompt that scores every answer from 1 to 5 and a build step that fails if the average drops below 4. That's progress, but the judge has its own failure modes, and until you've measured how often it agrees with a person who knows the domain, its score is decoration. Before a judge gates a release, you need to know how often it waves a bad answer through.

## Why "average score above 4" is the wrong gate

The common pattern asks the judge to rate correctness, relevance, safety and tone on a 1 to 5 scale in one call, then averages each criterion across the dataset. Three things go wrong.

First, the scale is undefined. What separates a 3 from a 4 on "relevance"? Nobody wrote it down, so the judge decides, and it decides slightly differently each time the prompt, the model version or the answer length changes. Second, averages hide the failures you care about. A support assistant that scores 4.6 on average can still tell one user in twenty the wrong refund window, and that's the answer that ends up in a complaint. Third, scoring four criteria in one call lets them bleed into each other: a polite, well-structured answer tends to drag its correctness score up.

My rule of thumb: one criterion per judge call, a pass/fail verdict, and a written definition of what fails. Then gate on the pass rate per category of question, not on a blended average.

## Write criteria a person could apply

If two people on your team couldn't apply the criterion and get the same answer, a model won't either. "Is the answer correct?" is too vague. "Does the answer state the 30-day refund window and the requirement for proof of purchase, and does it state nothing that contradicts the reference facts?" is gradeable.

That means each test case carries its own reference, not just an input and a hint. For the three kinds of questions I'd put in any support assistant's dataset, that looks like this:

| Category | Example input | What the criterion checks |
|---|---|---|
| Factual | "What's the refund policy?" | States the refund timeline and conditions from the reference; adds nothing that contradicts it |
| Adversarial | A threat or abusive message | Stays professional, doesn't engage with the threat, points to the right escalation channel |
| Out of scope | "Can you help me with something unrelated?" | Declines politely and redirects to what the assistant does cover |

There are three ways to ask a judge for a verdict, and they suit different jobs:

| Format | Good for | Watch out for |
|---|---|---|
| Pass/fail per criterion | Release gates and regression checks | Needs a precise criterion and a rule for borderline cases |
| 1 to 5 scale | Tracking a trend over time on a fixed dataset | Drifts with prompt and model changes; averages hide failures |
| Pairwise (A vs B) | Comparing two prompts or two models | Position bias; tells you which is better, not whether either is good enough |

I use pass/fail for gates, pairwise when choosing between two candidate prompts, and the 1 to 5 scores from built-in evaluators only as a trend line.

## The judge has biases, and they're documented

The paper that popularised the approach, [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685) (Zheng et al., NeurIPS 2023), found that a strong judge could reach over 80% agreement with human preferences, about the level at which humans agree with each other. It also documented the biases you have to design around:

- **Position bias.** In pairwise comparisons, judges favour whichever answer appears in a particular position. Run every pairwise comparison twice with the order swapped, and count a win only when both orders agree.
- **Verbosity bias.** Longer answers tend to be preferred even when they add nothing. Tell the judge to ignore length unless the criterion is about length, and keep a few test cases where the correct answer is short.
- **Self-enhancement bias.** A judge can favour answers that read like its own output. Grading a model with the same deployment that generated the answer is the weakest setup. A judge from a different model family, or at least a different model, is a better default.
- **Limited reasoning.** A judge that can't solve the maths problem can't reliably grade the answer to it. Give it the reference answer instead of asking it to work the answer out.

None of these are reasons to drop LLM judges. They're reasons to measure yours.

## Calibrate against human labels

Calibration is cheap. Take 50 to 100 real answers your system produced, ideally mixing the categories above, and have a domain expert label each one pass or fail against the same written criterion the judge will use. Make sure the set contains plenty of failures: a set where everything passes can't tell you whether the judge catches anything. Then run the judge over the same rows and compare.

Two numbers matter. **Cohen's kappa** measures agreement corrected for chance, which raw agreement doesn't: if 90% of your answers pass, a judge that always says "pass" gets 90% agreement and a kappa of zero. And the **false-pass rate**, the share of human-labelled failures the judge waved through, matters more than false fails, because a false pass is a defect that reaches users while a false fail costs someone ten minutes of reading.

Here's a judge and its calibration run, using the `openai` Python SDK ([1.106 or later](https://github.com/openai/openai-python/releases/tag/v1.106.0), including the current 2.x releases, which accept a token provider as `api_key`) against the Azure OpenAI v1 API with Microsoft Entra ID authentication. [Structured outputs](https://learn.microsoft.com/azure/foundry-classic/openai/how-to/structured-outputs) force the verdict into a schema, so you never parse free text. The deployment is a placeholder; I'd use a pinned version of a non-reasoning model such as gpt-4.1, because most reasoning models reject a non-default `temperature`. Install the packages first:

```bash
pip install "openai>=1.106" azure-identity pydantic scikit-learn
```

Your signed-in identity needs the Cognitive Services OpenAI User role on the resource.

```python
import json
from pathlib import Path
from typing import Literal

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import OpenAI
from pydantic import BaseModel
from sklearn.metrics import cohen_kappa_score

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)
client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=token_provider,
)
JUDGE_DEPLOYMENT = "<your-judge-deployment>"

JUDGE_INSTRUCTIONS = """You grade one answer from a customer support assistant against one criterion.
Criterion: {criterion}
Reference facts: {reference}
Judge only the criterion. Ignore length and writing style unless the criterion is about them.
Explain your reasoning in two or three sentences, then give a verdict."""


class Verdict(BaseModel):
    reasoning: str
    verdict: Literal["pass", "fail"]


def judge(question: str, answer: str, criterion: str, reference: str) -> Verdict:
    completion = client.chat.completions.parse(
        model=JUDGE_DEPLOYMENT,
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": JUDGE_INSTRUCTIONS.format(criterion=criterion, reference=reference),
            },
            {"role": "user", "content": f"Question:\n{question}\n\nAnswer:\n{answer}"},
        ],
        response_format=Verdict,
    )
    parsed = completion.choices[0].message.parsed
    if parsed is None:  # the judge refused or returned nothing usable
        raise RuntimeError(f"No verdict returned: {completion.choices[0].message.refusal}")
    return parsed


def calibrate(path: Path) -> None:
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not rows:
        raise ValueError(f"{path} is empty")
    required = {"id", "question", "answer", "criterion", "reference", "human_label"}
    incomplete = [i for i, r in enumerate(rows, start=1) if not required <= r.keys()]
    if incomplete:
        raise ValueError(f"Rows missing required keys (line numbers): {incomplete}")
    bad = [r["id"] for r in rows if r["human_label"] not in ("pass", "fail")]
    if bad:
        raise ValueError(f"Invalid human_label in rows: {bad}")
    if len({r["human_label"] for r in rows}) < 2:
        raise ValueError("Calibration set needs both pass and fail labels")
    human, model = [], []
    for row in rows:
        result = judge(row["question"], row["answer"], row["criterion"], row["reference"])
        human.append(row["human_label"])
        model.append(result.verdict)
        if result.verdict != row["human_label"]:
            print(f"[{row['id']}] human={row['human_label']} judge={result.verdict}: {result.reasoning}")

    human_fails = [m for h, m in zip(human, model) if h == "fail"]
    agreement = sum(h == m for h, m in zip(human, model)) / len(rows)
    print(f"Rows: {len(rows)}  agreement: {agreement:.0%}  kappa: {cohen_kappa_score(human, model):.2f}")
    if human_fails:
        print(f"False-pass rate: {human_fails.count('pass') / len(human_fails):.0%}")


if __name__ == "__main__":
    calibrate(Path("calibration.jsonl"))
```

Each line of `calibration.jsonl` is one labelled row:

```json
{"id": "refund-007", "question": "What's the refund policy?", "answer": "You can return items within 14 days.", "criterion": "States the refund window and proof-of-purchase requirement from the reference, and states nothing that contradicts it.", "reference": "Refunds within 30 days of purchase with proof of purchase.", "human_label": "fail"}
```

The printed disagreements are the useful output, more than the kappa. Read every one. Most will be a criterion that left room for interpretation; tighten the wording and rerun. Some will be a wrong human label. I keep iterating until kappa is above about 0.6 and the false-pass rate is low enough that you'd accept it in production; until then, the judge informs a human decision rather than gating a build.

Treat both numbers as rough at this size. The false-pass rate rests on the count of human-labelled failures, not total rows: with 50 rows and 15 failures, a single judge miss moves it by about 7 points. Aim for at least 30 labelled failures before you trust it, and re-check kappa on a fresh slice of labelled rows rather than the ones you tuned the criterion on, or you're measuring how well you fitted the wording to those examples.

## Built-in evaluators still need checking

You don't have to write every judge yourself. The [Azure AI Evaluation SDK](https://learn.microsoft.com/azure/foundry-classic/how-to/develop/evaluate-sdk) (the `azure-ai-evaluation` package) ships LLM-judged evaluators for groundedness, relevance, coherence and others. Each returns a score, a reason and a pass/fail against a threshold you set. The `azure-ai-evaluation` package has been a stable 1.x release since November 2024 (see its [release history](https://pypi.org/project/azure-ai-evaluation/#history)). Some evaluators and features in the Learn walkthrough are marked preview, so check the status of each one you depend on. The same evaluators can also run as cloud evaluations in a Microsoft Foundry project, so local calibration lines up with what the portal reports. For generic qualities such as "is this answer grounded in the retrieved context?", I'd start there rather than reinvent a groundedness prompt.

But "built in" doesn't mean "calibrated for your domain". A default threshold was chosen by someone who has never read your refund policy. Run the same calibration loop over a built-in evaluator's pass/fail output before you trust its threshold, and write custom criteria for business rules no generic evaluator knows about.

## Operating the judge

A few habits keep the judge honest in the pipeline:

- **Pin the judge's model version** and treat a judge upgrade like any other model change: rerun calibration first. Otherwise a new judge version shifts scores and you chase a regression that isn't there.
- **Gate per category.** A 98% pass rate on factual questions doesn't excuse 80% on adversarial ones. Set the threshold for each category separately.
- **Budget the judge calls.** One criterion per call means cost and latency scale with criteria × rows, and pairwise comparisons double it because each runs in both orders. Four criteria over 500 rows is 2,000 calls before any swaps. I'd run a small, fast subset on each PR and the full calibration and evaluation set nightly.
- **Keep sampling for humans.** Someone should still read a sample of production conversations and every interaction users flagged. New disagreements become calibration rows, so the dataset grows from real traffic.
- **Check the judge against itself.** Even at temperature 0, verdicts on borderline rows can flip between runs. Run the calibration set two or three times and treat any row whose verdict flips as an ambiguous criterion to tighten.

How this fits with unit tests, PR gates and red teaming is covered in [Testing AI Systems: Which Tests Run Where, and Why](/blog/2026-01-21-ai-testing-strategies/), and sampling quality scores in production in [LLM Observability: The Few Signals That Actually Matter](/blog/2026-01-16-llm-observability/).

## When not to use a judge

Reach for code before a model. If the check is "the output is valid JSON", "the answer cites at least one source", "the reply contains no email addresses" or "the classifier picked the right label", a deterministic assertion is faster, free and never disagrees with itself. And if your volume is low enough that a person reviews every output anyway, the person is your evaluator; a judge adds cost without removing work.

LLM judges earn their place for open-ended qualities across hundreds of answers, where human review can't keep up. That's exactly where an uncalibrated judge does the most damage, because nobody is reading closely enough to notice it's wrong.

## The short version

Label 50 to 100 real answers yourself, including at least 30 failures, before you trust any automated score. Write one precise pass/fail criterion per check, measure the judge's kappa and false-pass rate against your labels, fix the criteria until they agree, and only then let the judge gate a release. A judge you've measured is a test. A judge you haven't measured is an opinion with an API bill.
