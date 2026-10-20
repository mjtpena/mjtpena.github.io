---
title: "Turning Production Queries into an LLM Eval Set You Can Trust"
description: "How I sample real user queries by stratum, redact PII before anyone reads them, split off a holdout and keep the eval set current as the product changes."
author: Michael John Peña
draft: false
date: 2026-04-22
tags:
  - LLM
  - Evaluation
  - LLMOps
  - Privacy
  - Python
---

Every gate I trust for an LLM change, whether it's a groundedness check, a retrieval regression test or a quality SLO, is only as good as the questions behind it. Most teams write those questions themselves, and that's where the eval goes wrong: the people who wrote the documents write questions the documents answer neatly. Users don't. They abbreviate, ask three things at once, paste error messages and ask about things the system was never meant to handle. If the eval set doesn't look like that traffic, a passing score tells you how the system treats your team, not your users.

The fix is to build the set from real queries. Doing that well is less about tooling and more about four decisions: what to sample, how to handle the personal data in it, how to stop yourself overfitting to it, and how to keep it current.

## Why a random sample of logs is the wrong start

The obvious approach is to pull 200 random queries from last month's logs. Production traffic is heavily skewed, so a random sample mostly gives you the head: dozens of variations of "how do I reset my password" and almost none of the rare questions where a wrong answer is expensive. It also under-represents failures, because most conversations go fine.

I sample by stratum instead, with an explicit quota for each:

| Stratum | What it is | Why it's in the set |
|---|---|---|
| Head | The most frequent distinct queries per intent | Regressions here hit the most users |
| Tail | A random draw from the rest of each intent | Catches phrasing and edge cases the head never shows |
| Failures | Queries with a thumbs-down, an escalation or an immediate rephrasing | Where the current system is already wrong |
| Out of scope | Queries the system should decline or redirect | Tests refusal behaviour, which a happy-path set never does |

"Intent" can come from whatever you already have: a router's classification, a topic tag from the conversation log, or a one-off clustering pass. It doesn't need to be perfect. Its job is to stop one popular topic from crowding out everything else.

Failures deserve a cap, not free entry. If a third of the set is last month's complaints, you'll tune the system to last month's problems and the set stops reflecting normal use.

## Redact before anyone reads a query

Real queries contain real people's names, emails, account numbers and occasionally medical details. The moment you copy them into a labelling spreadsheet, you've created a new copy of personal data with weaker access controls than the system it came from. So the rule I follow is that redaction happens in the pipeline, before a human or a judge model sees the text.

### Questions to settle before any code

Three things need an answer from whoever owns privacy for the product:

- Do the terms users accepted allow their queries to be used for quality testing?
- Where may the redacted set live, and who can read it?
- How long is it kept?

If the answer to the first is no, stop here and see [When real queries are the wrong source](#when-real-queries-are-the-wrong-source).

### How the redaction works

For the redaction itself I use PII detection in [Azure Language](https://learn.microsoft.com/azure/ai-services/language-service/personally-identifiable-information/overview), now branded Azure Language in Foundry Tools. It recognises entity categories such as person names, phone numbers, email addresses and government ID numbers, and returns each entity's category and offset. I replace each span with its category label rather than asterisks, because `[Person] wants to move their [DateTime] booking` is still a readable, labellable question, while a row of stars isn't.

Treat automated redaction as a strong filter, not a guarantee. It misses things: internal customer numbers in your own format, names it doesn't recognise, identifiers in languages or locales it doesn't cover. I add a regex pass for the organisation's own ID formats and have a person spot-check a sample of redacted rows before the set is shared more widely.

## The sampling script

This takes an export of queries from an access-controlled conversation log, deduplicates them, samples each stratum with a fixed seed, redacts PII and writes a labelling queue with a deterministic dev or holdout split. It uses `azure-ai-textanalytics` 5.4.0, the current stable release, with Microsoft Entra ID authentication, on Python 3.9 or later. The identity running it needs the Cognitive Services User role on the Language resource, and the endpoint must be the resource's custom subdomain.

```bash
pip install "azure-ai-textanalytics==5.4.0" "azure-identity==1.25.3"
```

Each input line looks like `{"query": "...", "intent": "billing", "feedback": "down"}`, where `feedback` is `"down"`, `"escalated"`, `"rephrased"` or `null`. Derive those values upstream from the conversation log; a rephrase is the user asking the same thing again straight after an answer. Intents with the value `out_of_scope` are treated as their own stratum by the quota below.

The quotas are per intent, so set them from the number of intents you have and the total you can afford to label. With eight intents, 5 head, 4 tail and up to 2 failures give at most 88 cases, which lands inside the 50 to 100 I'd aim for. With twenty intents, cut them further or merge small intents first.

```python
import hashlib
import json
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from azure.ai.textanalytics import TextAnalyticsClient
from azure.identity import DefaultAzureCredential

ENDPOINT = "https://<your-language-resource>.cognitiveservices.azure.com/"
HEAD_PER_INTENT, TAIL_PER_INTENT, FAILURES_PER_INTENT = 5, 4, 2
HOLDOUT_PERCENT = 20
SEED = 20260422
# Organisation-specific identifiers the PII model won't know about.
CUSTOM_PATTERNS = {"CustomerNumber": re.compile(r"\bCUS-\d{6}\b")}


def normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def split_for(norm: str) -> str:
    bucket = int(hashlib.sha256(norm.encode("utf-8")).hexdigest(), 16) % 100
    return "holdout" if bucket < HOLDOUT_PERCENT else "dev"


def sample(rows: list[dict], rng: random.Random) -> list[dict]:
    by_intent = defaultdict(list)
    for row in rows:
        by_intent[row["intent"]].append(row)

    picked, seen = [], set()
    for intent, items in sorted(by_intent.items()):
        counts = Counter(normalise(r["query"]) for r in items)
        first_seen = {}
        for r in items:
            first_seen.setdefault(normalise(r["query"]), r)

        head = [q for q, _ in counts.most_common(HEAD_PER_INTENT)]
        rest = sorted(q for q in counts if q not in head)
        tail = rng.sample(rest, min(TAIL_PER_INTENT, len(rest)))
        failed = sorted({normalise(r["query"]) for r in items if r.get("feedback")} - set(head) - set(tail))
        failures = rng.sample(failed, min(FAILURES_PER_INTENT, len(failed)))

        for stratum, queries in (("head", head), ("tail", tail), ("failure", failures)):
            for q in queries:
                if q in seen:  # same query logged under two intents: keep the first
                    continue
                seen.add(q)
                picked.append({
                    "intent": intent,
                    "stratum": "out_of_scope" if intent == "out_of_scope" else stratum,
                    "frequency": counts[q],
                    "query": first_seen[q]["query"],
                    "norm": q,
                })
    return picked


def redact(client: TextAnalyticsClient, rows: list[dict]) -> list[dict]:
    kept = []
    for start in range(0, len(rows), 5):  # PII detection accepts up to 5 documents per sync request
        batch = rows[start:start + 5]
        docs = [{"id": str(i), "text": r["query"], "language": "en"} for i, r in enumerate(batch)]
        results = client.recognize_pii_entities(docs, disable_service_logs=True)
        for row, result in zip(batch, results):
            if result.is_error:
                print(f"Dropped a row: {result.error.code}", file=sys.stderr)
                continue  # never keep an unredacted query
            text = row["query"]
            spans = []  # merge overlapping entities so offsets stay valid
            for entity in sorted(result.entities, key=lambda e: e.offset):
                end = entity.offset + entity.length
                if spans and entity.offset < spans[-1][1]:
                    spans[-1][1] = max(spans[-1][1], end)
                else:
                    spans.append([entity.offset, end, entity.category])
            for begin, end, category in reversed(spans):
                text = text[:begin] + f"[{category}]" + text[end:]
            for label, pattern in CUSTOM_PATTERNS.items():
                text = pattern.sub(f"[{label}]", text)
            kept.append({**row, "query": text})
    return kept


def main(source: str, target: str) -> None:
    lines = Path(source).read_text(encoding="utf-8").splitlines()
    rows = [json.loads(line) for line in lines if line.strip()]
    picked = sample(rows, random.Random(SEED))

    client = TextAnalyticsClient(ENDPOINT, DefaultAzureCredential())
    redacted = redact(client, picked)

    with open(target, "w", encoding="utf-8") as out:
        for row in redacted:
            case_id = hashlib.sha256(row["norm"].encode("utf-8")).hexdigest()[:12]
            out.write(json.dumps({
                "id": case_id,
                "split": split_for(row["norm"]),
                "intent": row["intent"],
                "stratum": row["stratum"],
                "frequency": row["frequency"],
                "query": row["query"],
                "expected_behaviour": None,
                "source_doc_ids": [],
            }) + "\n")
    print(f"Wrote {len(redacted)} cases from {len(rows)} logged queries to {target}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
```

Run it as `python build_eval_set.py queries.jsonl label_queue.jsonl`. A few choices are deliberate. The 5-document batch matches the per-request limit for synchronous PII calls in the [Language data limits](https://learn.microsoft.com/azure/ai-services/language-service/concepts/data-limits). `disable_service_logs=True` is already the default for PII calls; I set it explicitly so nobody flips it later without noticing, since the other Language features log input for 48 hours by default. Overlapping entities are merged into one span before replacement, so a nested match can't shift the offsets of the next one. A row that errors is dropped, not passed through, because the failure mode I'm guarding against is one unredacted query landing in a shared sheet. And the case ID and split both come from a hash of the normalised query, so the same question keeps the same ID and the same split every time the set is rebuilt.

## Label behaviour, not prose

The queue comes out with `expected_behaviour` empty, and a person who knows the domain fills it in. I don't ask for a model answer. I ask for the behaviour: answer from these source documents, decline and point to this channel, ask which product the user means. Expected behaviour survives a rewrite of the prompt; a gold paragraph gets stale the moment the tone changes. The case types I use, including unanswerable and false-premise cases derived from real queries, are in [Designing LLM Test Cases That Catch Hallucinations](/blog/2026-03-31-llm-evaluation-journal-reducing-hallucinations-through-better-test-design/), and the case for a named owner of the set is in [the retrieval regression gate post](/blog/2026-04-01-rag-engineering-log-fixing-retrieval-before-touching-prompts/).

For RAG systems, record the source document IDs at labelling time, then freeze the retrieved context for each case, as I describe in the [groundedness gate](/blog/2026-03-09-how-i-evaluate-llm-changes-tracking-groundedness-before-celebrating-fluency/) post. That's what lets the gate separate a generation regression from a retrieval one. The [RAG design and evaluation guide](https://learn.microsoft.com/azure/architecture/ai-ml/guide/rag/rag-solution-design-and-evaluation-guide) covers gathering test queries, including ones your documents don't cover, which is exactly what the out-of-scope stratum gives you from real traffic.

## Keep a holdout you don't look at

The moment a set drives prompt changes, people start tuning to it. Someone reads the failing rows, adjusts the prompt until those exact rows pass, and the score climbs while real quality barely moves. That's overfitting, and an eval set built from real queries is just as exposed to it as any training set.

So the script splits about a fifth of the cases into a holdout. The dev split is what engineers iterate against and read freely. The holdout is scored only at release, by the pipeline, and nobody reads its failing rows to tune a prompt. If the dev score rises and the holdout doesn't, the change fitted the set rather than improving the product.

Be honest about how little a small holdout can tell you. A fifth of 88 cases is under 20 rows, so one or two flipped rows move the holdout score by 5 to 10 points. Below roughly 30 cases, a holdout only shows large regressions. Read it as a list of rows that flipped, not a percentage, or pool it across several releases before drawing a conclusion from the trend.

## Refresh on a schedule, and version the set

Queries drift. A pricing change, a new feature or a product recall changes what users ask within days. I'd rebuild monthly from the latest window and treat the set like code: new version, reviewed diff, retired cases removed when their source documents are.

Two rules keep the numbers honest. First, never compare scores across set versions. When the set changes, re-score the current production version against the new set so the baseline and the candidate are always measured on the same questions. Second, keep a small pinned core of critical cases that only changes when the underlying policy does, so you can still see long-run trends.

## When real queries are the wrong source

- **Before launch.** There are no users yet. Hand-write a seed set with the domain owner, and if you need volume, the [simulator in the Azure AI Evaluation SDK](https://learn.microsoft.com/azure/foundry-classic/how-to/develop/simulator-interaction-data) can generate query-response pairs from your content. It's in preview, it works only with hub-based (classic) projects, and its questions are synthetic, so replace them with real ones as traffic arrives.
- **You can't lawfully keep the text.** If the product's terms or a regulator rule out retaining queries, redaction doesn't fix that. Use the logs only for aggregate signals such as intent counts and write the cases by hand to match that distribution.
- **Very low volume.** With a few hundred queries a month, the strata are too thin to sample. Read them all and pick by hand.
- **Highly sensitive domains.** For health or legal content, automated redaction plus a spot-check may not meet your obligations. That decision belongs to your privacy and legal teams, not the engineering backlog.

## Where I'd start

Pull one month of queries, sample by intent with a quota for head, tail, failures and out of scope, redact in the pipeline, and hold out a fifth that nobody tunes against. I'd trust fifty to a hundred cases built this way over five hundred drafted in a workshop, because each one started as something a user typed. The work is in the quotas, the redaction and the discipline around the holdout, not in the volume.
