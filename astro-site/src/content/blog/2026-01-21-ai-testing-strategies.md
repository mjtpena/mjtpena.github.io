---
title: "Testing AI Systems: Which Tests Run Where, and Why"
description: "A layered test strategy for LLM apps: stubbed unit tests per commit, pass-rate gates on PRs, nightly evaluator runs and red teaming before release."
author: Michael John Peña
draft: false
date: 2026-01-21
tags:
  - AI
  - Testing
  - LLM
  - Evaluation
  - Engineering
---

Traditional testing assumes the same input gives the same output. LLM-backed systems break that assumption, and most teams respond in one of two bad ways: they skip automated tests entirely and rely on someone "trying a few prompts", or they write exact-match assertions that fail randomly and get disabled within a month. Neither tells you whether the release you're about to ship is worse than the last one.

The fix isn't a single clever technique. It's deciding which kind of test runs where, so that fast, cheap, deterministic checks gate every commit and slow, expensive, probabilistic checks run on a schedule that matches their cost.

## Separate the code from the model

The biggest mistake I see is treating the whole AI feature as one untestable black box. Most of an LLM application is ordinary code: building the prompt, choosing which retrieved chunks to include, parsing the model's output, validating citations, deciding what to do when parsing fails, enforcing token budgets. All of that is deterministic and can be tested the way you'd test any other function.

So the first layer stubs the model out. You're not testing whether the model is smart; you're testing whether your code behaves correctly given what a model could plausibly return, including malformed JSON, a citation to a chunk that was never supplied, or an empty response.

```python
# test_answer_flow.py
import json

import pytest


def build_messages(question: str, chunks: dict[str, str]) -> list[dict]:
    context = "\n".join(f"[{cid}] {text}" for cid, text in chunks.items())
    return [
        {
            "role": "system",
            "content": (
                "Answer only from the context. Reply as JSON with keys "
                "'answer' and 'citations' (a list of chunk ids)."
            ),
        },
        {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"},
    ]


def answer_question(client, question: str, chunks: dict[str, str]) -> dict:
    raw = client.complete(build_messages(question, chunks))
    try:
        parsed = json.loads(raw)
        answer, citations = parsed["answer"], parsed["citations"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return {"answer": "I couldn't produce a reliable answer.", "citations": []}
    if not citations or not set(citations) <= set(chunks):
        return {"answer": "I couldn't find that in the policy documents.", "citations": []}
    return {"answer": answer, "citations": citations}


class FakeClient:
    def __init__(self, reply: str):
        self.reply = reply
        self.last_messages = None

    def complete(self, messages: list[dict]) -> str:
        self.last_messages = messages
        return self.reply


CHUNKS = {"c1": "Refunds are accepted within 30 days with a receipt."}


def test_valid_answer_passes_through():
    client = FakeClient(json.dumps({"answer": "Within 30 days.", "citations": ["c1"]}))
    result = answer_question(client, "What's the refund window?", CHUNKS)
    assert result["citations"] == ["c1"]
    assert "[c1]" in client.last_messages[1]["content"]


@pytest.mark.parametrize(
    "reply",
    [
        "not json at all",
        json.dumps({"answer": "Within 30 days."}),
        json.dumps({"answer": "Within 90 days.", "citations": ["c9"]}),
        json.dumps({"answer": "Within 30 days.", "citations": []}),
    ],
)
def test_untrustworthy_replies_fall_back(reply):
    result = answer_question(FakeClient(reply), "What's the refund window?", CHUNKS)
    assert result["citations"] == []
```

These tests run in milliseconds, cost nothing, and never flake. They belong on every commit. I'd argue they also prevent more user-facing failures than anything model-facing, because the failures that hurt users are usually "we crashed on an unexpected output shape" rather than "the model was slightly less eloquent".

## Gate pull requests on pass rates, not single runs

The second layer calls the real model, and this is where non-determinism bites. A test that asserts on one sample will pass 90% of the time and fail 10% of the time without anything changing. People learn to hit "re-run", and then the test is worthless.

Treat these tests as statistical. Run each case several times and assert on the pass rate. Also stop assuming `temperature=0` gives you determinism: it reduces variance but doesn't eliminate it, and on Azure OpenAI, reasoning models such as the o-series and the GPT-5 reasoning models (gpt-5, gpt-5-mini, gpt-5-nano) reject the temperature parameter entirely.

```python
# test_live_refund.py  (run with: pytest -m live)
import os

import pytest
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import OpenAI

from test_answer_flow import CHUNKS, answer_question

RUNS = 10
REQUIRED_PASSES = 9


class AzureClient:
    def __init__(self):
        token_provider = get_bearer_token_provider(
            DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
        )
        endpoint = os.environ["AZURE_OPENAI_ENDPOINT"].rstrip("/")
        self.client = OpenAI(
            base_url=f"{endpoint}/openai/v1/",
            api_key=token_provider,
        )
        self.deployment = os.environ["AZURE_OPENAI_DEPLOYMENT"]

    def complete(self, messages: list[dict]) -> str:
        response = self.client.chat.completions.create(
            model=self.deployment,
            messages=messages,
            response_format={"type": "json_object"},
        )
        return response.choices[0].message.content


@pytest.mark.live
def test_refund_window_is_answered_and_cited():
    client = AzureClient()
    passes = 0
    for _ in range(RUNS):
        result = answer_question(client, "How long do I have to get a refund?", CHUNKS)
        if "30" in result["answer"] and result["citations"] == ["c1"]:
            passes += 1
    assert passes >= REQUIRED_PASSES, f"{passes}/{RUNS} runs passed"
```

The client uses the Azure OpenAI v1 API, which has been generally available since August 2025 and is Microsoft's recommended path: there's no `api_version` to manage, and it works with reasoning deployments such as gpt-5 as well as older ones like gpt-4.1. Passing the token provider as `api_key` needs `openai` 1.106.0 or later, which added support for a callable key.

The assertions here are deliberately loose: a fact that must appear and a citation that must be correct. Don't assert on wording or tone at this layer; a keyword check for tone is a test that measures nothing. Keep this suite small (a few dozen high-value cases), because ten runs per case adds up in both time and tokens.

Be honest about what a per-case 9-of-10 threshold buys you: it's still a coin with a bias, and it will go red now and then with nothing wrong. A case whose true pass rate is 95% fails this gate about 9% of the time, and a case at 90% fails it about 26% of the time. Across a few dozen cases, that adds up to a red build most weeks. Two ways to keep the false-failure rate down: aggregate the pass rate across the whole live suite (say 300 runs) and gate on that, keeping per-case results as diagnostics, or record the main branch's baseline rate and fail the PR only when it drops by more than a set tolerance. Either way, size the runs so the noise in the number is smaller than the regression you care about catching.

Make sure a plain `pytest` on every commit never calls the model. Register the marker and exclude it by default:

```toml
# pyproject.toml
[tool.pytest.ini_options]
markers = ["live: calls a real model deployment"]
addopts = "-m 'not live'"
```

The PR job then runs `pytest -m live`; a `-m` on the command line overrides the one in `addopts`. Trigger that job on pull requests that touch prompts, retrieval, or model configuration, not on every docs change.

One more thing that matters more than any test: pin the model. On Azure OpenAI, a deployment has a specific model version and a version upgrade policy. If the deployment auto-upgrades when a new default version ships, your PR gate is comparing against a moving target. Pin the version, and make the upgrade itself a change that goes through this pipeline. Pinning stops silent upgrades, not retirement: when a pinned model version retires, the deployment gets moved or stops working regardless. Track the [retirement dates](https://learn.microsoft.com/azure/ai-foundry/openai/concepts/model-retirements) for every model you deploy and schedule the upgrade as a PR that runs through the live and nightly suites well before the deadline.

## Run evaluators nightly, and watch the trend

Pass/fail checks tell you about the cases you thought of. Quality across a few hundred realistic queries needs scored evaluation, which is slower and costs real money, so I run it nightly or on release branches rather than per PR. The [Azure AI Evaluation SDK](https://learn.microsoft.com/azure/ai-foundry/how-to/develop/evaluate-sdk) (`azure-ai-evaluation`, 1.14.0 as of this month on [PyPI](https://pypi.org/project/azure-ai-evaluation/)) ships LLM-judged evaluators such as groundedness, relevance and coherence, and each one returns a score, a reason, and a pass/fail against a threshold you set.

```python
# nightly_groundedness.py
import json
import os
import sys

from azure.ai.evaluation import AzureOpenAIModelConfiguration, GroundednessEvaluator
from azure.identity import DefaultAzureCredential

model_config = AzureOpenAIModelConfiguration(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    azure_deployment=os.environ["JUDGE_DEPLOYMENT"],
    api_version="2024-10-21",  # GA version; use a non-reasoning judge such as gpt-4.1 or gpt-4o
)
groundedness = GroundednessEvaluator(
    model_config, threshold=4, credential=DefaultAzureCredential()
)

# Each line: {"query": ..., "context": ..., "response": ...} captured from the app
with open("nightly_outputs.jsonl", encoding="utf-8") as f:
    rows = [json.loads(line) for line in f if line.strip()]

if not rows:
    sys.exit("No rows captured; failing the nightly run.")

failures = []
for row in rows:
    result = groundedness(query=row["query"], context=row["context"], response=row["response"])
    if result["groundedness_result"] == "fail":
        failures.append((row["query"], result["groundedness"], result["groundedness_reason"]))

pass_rate = 1 - len(failures) / len(rows)
print(f"Groundedness pass rate: {pass_rate:.1%} over {len(rows)} rows")
for query, score, reason in failures[:10]:
    print(f"- [{score}] {query}: {reason}")
sys.exit(0 if pass_rate >= 0.9 else 1)
```

Two warnings about this layer. First, the judge is itself a model, so pin its deployment too, and spot-check its verdicts against human judgement before you trust a threshold. Second, the absolute number matters less than the trend. A groundedness pass rate that drifts from 94% to 88% over two weeks is a signal worth investigating even if 88% is above your bar. If you prefer an open-source route, [Ragas](https://docs.ragas.io/) covers similar RAG metrics; the principle is the same whichever library you use. I wrote about the broader shift from exact-match to behavioural testing in [Testing LLM Applications: Strategies Beyond Traditional Unit Tests](/blog/2025-11-05-november-ai-topic/).

## Red team before releases, not on every commit

Adversarial testing is the layer people most often get wrong. A hard-coded list of five jailbreak strings, run on every commit, gives false confidence: the model provider has almost certainly trained against those exact strings, and attackers don't use them.

Split it in two. At runtime, put a real control in front of the model. [Prompt Shields](https://learn.microsoft.com/azure/ai-services/content-safety/concepts/jailbreak-detection) in Azure AI Content Safety has been generally available since August 2024 and detects both direct jailbreak attempts and indirect injection hidden in documents. Your deterministic tests can verify that your code calls it and handles a positive detection correctly. Then, before a release, run a broader adversarial sweep. The [AI Red Teaming Agent](https://learn.microsoft.com/azure/ai-foundry/concepts/ai-red-teaming-agent) in Microsoft Foundry (still in public preview) builds on Microsoft's open-source PyRIT framework, generates attacks across risk categories and strategies, and reports attack success rates. Because it's preview, I'd treat it as an input to a release decision rather than an automated hard gate.

Don't forget the non-AI attack surface either. If model output ends up in HTML, SQL, or a shell, the usual injection defences apply, and those are deterministic tests that belong in layer one.

## Keep a human in the loop for release decisions

The last layer is people reading output. Before a major release, have someone who knows the domain read a sample of real transcripts: a few dozen drawn from the nightly dataset plus recent production traffic, weighted towards the categories that changed. They're judging what no metric captures well: whether the answer actually helps, whether the tone suits your users, and whether the refusals are sensible rather than lazy. Name a product owner who signs off on the release with the evaluator trends, the red-team report and these notes in front of them. Without a named owner, "human review" turns into nobody reading anything.

## The cadence, side by side

| Layer | What it checks | Runs | Cost | Gate? |
|---|---|---|---|---|
| Stubbed unit tests | Prompt building, parsing, fallbacks, guardrail wiring | Every commit | Free | Hard gate |
| Live pass-rate tests | Critical facts and citations on a small case set | PRs touching prompts, retrieval or model config | Low | Hard gate |
| Nightly evaluators | Groundedness, relevance and coherence trends over hundreds of rows | Nightly and release branches | Moderate | Alert on regression |
| Red teaming | Jailbreaks, indirect injection, harmful content | Before major releases | Higher | Human review |
| Human review | Things no metric captures, like whether answers are actually useful | Before major releases | Highest | Human sign-off |

## When this is overkill

Not every AI feature needs all five layers. If the model is only drafting text that a person always edits before it goes anywhere, stubbed tests plus occasional human review are enough; the human is the evaluator. If you're prototyping and the prompt changes daily, nightly evaluation against a curated dataset will mostly measure churn. Add layers as the blast radius grows: user-facing answers, automated actions, or regulated content each justify the next one.

## What I'd do first

If you have nothing today, start with layer one. Pull the prompt construction and output handling out of the request handler, stub the model, and test every failure path. It's the cheapest layer and the one that removes the most real risk. Then add a small live pass-rate suite for the five or ten answers that would embarrass you if they were wrong, and pin your model version. Evaluator dashboards and red-team sweeps are worth having, but they're the third and fourth investments, not the first.

You can't guarantee an LLM's output the way you can a pure function. You can guarantee that your code handles whatever it returns, that critical answers stay correct at a known rate, and that a regression shows up in a report before it shows up in a customer complaint.
