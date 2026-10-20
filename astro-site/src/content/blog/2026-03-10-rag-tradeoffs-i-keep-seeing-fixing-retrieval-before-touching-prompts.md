---
title: "Wrong RAG Answer? Rule Out Retrieval Before You Edit the Prompt"
description: "Most wrong RAG answers start with the passages, not the prompt. A labelled question set and a retrieval-only triage on Azure AI Search show which one to fix."
author: Michael John Peña
draft: false
date: 2026-03-10
tags:
  - RAG
  - Azure AI Search
  - Evaluation
  - Python
---

A RAG assistant gives a wrong answer, someone opens the system prompt and adds another instruction. It's the cheapest edit in the stack and it feels like progress. Most of the time it's the wrong layer: the model never saw the passage that held the answer, and no instruction can make it quote text it wasn't given. Every prompt patch applied to a retrieval failure hides the failure and makes the next one harder to find.

This post is about the order of investigation, not about which retrieval patterns to add. For that, see [Seven RAG Failure Modes and the Pattern That Fixes Each](/blog/2026-01-07-rag-patterns-production/). Examples use Azure AI Search and the Azure AI Evaluation SDK as they stood in March 2026.

## Four places a wrong answer comes from

When an answer is wrong, the passage that should have produced it is in one of four places. Only one of them is a prompt problem.

| Where the answer was | What you see | What fixes it |
|---|---|---|
| Not in the corpus | Nothing relevant anywhere in the top 50 for any phrasing | Content, or a refusal path. Not retrieval, not the prompt |
| In the index, not retrieved | Absent from the top 50 candidates | Chunking, hybrid search, query rewriting, metadata filters |
| Retrieved, ranked out | In the top 50, but below the passages you actually send | Reranking, a different context budget |
| In the context, misused | Sent to the model, answer still wrong or unsupported | Prompt, model choice, output format |

The first three are retrieval and content problems. The fourth is the only one where editing the prompt is the right move, and you can't tell which one you have by reading the answer. You have to look at what retrieval returned.

## Why prompt-first goes wrong

Prompt edits are tempting because they're fast, they need no re-indexing, and they usually fix the one example in front of you. The cost shows up later.

- **The model fills the gap.** Instructions like "be thorough" or "answer as completely as possible" push a model with poor context to stitch an answer from loosely related passages. You've turned a missing answer into a confident wrong one.
- **Each patch is tuned to one example.** Five patches in, the prompt is a list of special cases and nobody knows which line is holding up which answer. A change for one question quietly breaks another.
- **The real fault stays hidden.** If a chunking problem splits a table from its heading, the prompt can't fix it, but it can make the symptom rarer on the questions you tested. The fault is still there for the questions you didn't.

My rule is simple: no prompt change for a correctness bug until someone has shown the right passage was in the context the model received.

## Build a small labelled set first

You can't triage without knowing what the right passage is. That means a labelled question set, and it's the part teams skip because it's tedious.

It doesn't need to be large. Fifty to a hundred real questions from logs or from subject-matter experts is enough to see patterns. For each, record which source documents answer it, with a graded label: 3 if the document answers it fully, 2 if it answers it partly, 1 if it's related but not useful, and 0 or no label if it's irrelevant. Include questions the corpus can't answer, labelled with nothing, so you can test the refusal path too.

Two decisions matter more than the size.

**Label documents, not chunks.** Chunk IDs change every time you change chunking, which is exactly the experiment you'll want to run. Label the parent document (or a stable section ID) and map chunks back to it at query time. If your index uses index projections from integrated vectorisation, each chunk already carries its parent's key.

**Get the labels from people who know the content.** An LLM can draft candidate labels, but if the same family of model judges relevance and generates answers, its blind spots will agree with each other. Have a human confirm the 2s and 3s.

## Measure retrieval on its own

With labels in hand, run only the retrieval step for each question and record where the first relevant document lands. Leave the LLM out entirely. This is fast, cheap and repeatable, and it sorts every question into one of the buckets in the table above.

The script below does that against an Azure AI Search index with hybrid search and the semantic ranker, using `azure-search-documents` 11.6.0 (GA, October 2025). It also scores each question with `DocumentRetrievalEvaluator` from `azure-ai-evaluation`, a ground-truth evaluator that reports NDCG@3, XDCG@3, fidelity and "holes". The [Foundry RAG evaluators page](https://learn.microsoft.com/azure/foundry-classic/concepts/evaluation-evaluators/rag-evaluators) lists it as preview. It assumes an index with a vectoriser on `content_vector`, a semantic configuration named `default`, and a `parent_id` field holding the source document key. Rename those to match your schema.

```python
# retrieval_triage.py
# pip install azure-search-documents==11.6.0 azure-identity azure-ai-evaluation==1.15.3
# golden_set.jsonl, one line per question:
# {"question": "Who approves leave exceptions in NZ?", "labels": {"hr-policy-nz": 3, "hr-faq": 1}}
import json
from collections import Counter
from statistics import mean

from azure.ai.evaluation import DocumentRetrievalEvaluator
from azure.identity import DefaultAzureCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizableTextQuery

SEARCH_ENDPOINT = "https://<your-search-service>.search.windows.net"
INDEX_NAME = "<your-index-name>"
CANDIDATES = 50      # the semantic ranker reranks up to 50 results
CONTEXT_SIZE = 5     # chunks your app actually sends to the model
ANSWERS_IT = 2       # label at or above this counts as "contains the answer"

search_client = SearchClient(SEARCH_ENDPOINT, INDEX_NAME, DefaultAzureCredential())
doc_eval = DocumentRetrievalEvaluator(ground_truth_label_min=0, ground_truth_label_max=3)


def retrieve(question: str) -> list[dict]:
    """Same retrieval call as production, minus generation. Returns chunks in rank order."""
    results = search_client.search(
        search_text=question,
        vector_queries=[
            VectorizableTextQuery(text=question, k_nearest_neighbors=CANDIDATES, fields="content_vector")
        ],
        query_type="semantic",
        semantic_configuration_name="default",
        semantic_error_mode="fail",  # a ranker failure should stop the run, not skew it
        select=["parent_id"],
        top=CANDIDATES,
    )
    return [{"parent_id": r["parent_id"], "score": r["@search.reranker_score"]} for r in results]


def bucket(chunks: list[dict], answer_ids: set[str]) -> str:
    if not answer_ids:
        return "unanswerable"
    ranks = [i for i, c in enumerate(chunks, start=1) if c["parent_id"] in answer_ids]
    if not ranks:
        return "not retrieved"
    return "in context" if ranks[0] <= CONTEXT_SIZE else "ranked out"


def to_documents(chunks: list[dict]) -> list[dict]:
    """Collapse chunks to one entry per parent document, keeping its best score."""
    best: dict[str, float] = {}
    for c in chunks:
        best[c["parent_id"]] = max(best.get(c["parent_id"], 0.0), c["score"])
    return [{"document_id": d, "relevance_score": s} for d, s in best.items()]


buckets, ndcg, holes = Counter(), [], []
with open("golden_set.jsonl", encoding="utf-8") as f:
    for line in f:
        item = json.loads(line)
        labels = item["labels"]
        chunks = retrieve(item["question"])
        answer_ids = {doc for doc, label in labels.items() if label >= ANSWERS_IT}
        result = bucket(chunks, answer_ids)
        buckets[result] += 1
        if result == "unanswerable":
            top = chunks[0]["score"] if chunks else 0.0
            print(f"[unanswerable] top reranker score {top:.2f}: {item['question']}")
            continue
        if result != "in context":
            print(f"[{result}] {item['question']}")
        metrics = doc_eval(
            retrieval_ground_truth=[
                {"document_id": doc, "query_relevance_label": label} for doc, label in labels.items()
            ],
            retrieved_documents=to_documents(chunks),
        )
        ndcg.append(metrics["ndcg@3"])
        holes.append(metrics["holes_ratio"])

print(dict(buckets))
if ndcg:
    print(f"mean NDCG@3 {mean(ndcg):.3f}, mean holes ratio {mean(holes):.3f}")
```

Two details in there are easy to miss. `semantic_error_mode="fail"` makes a semantic ranker outage raise an error, instead of quietly returning unranked results that would make your retrieval look worse than it is. And the bucket is computed on the chunk ranking, before collapsing to documents, because `CONTEXT_SIZE` counts chunks. A document whose fifth-best chunk is the useful one is not "in context" just because a weaker chunk from it ranked first.

## Read the numbers before changing anything

The bucket counts tell you where to spend the next week.

**Lots of "not retrieved".** Candidate generation is missing the document entirely. Look at the failing questions: identifiers and codes point to the keyword leg (hybrid search with [Reciprocal Rank Fusion](https://learn.microsoft.com/azure/search/hybrid-search-ranking) if you aren't already), vocabulary mismatch points to query rewriting, and answers spread across a table and its heading point to chunking. None of these are prompt problems.

**Lots of "ranked out".** The right document is in the top 50 but not in the top five chunks. That's the case the [semantic ranker](https://learn.microsoft.com/azure/search/semantic-search-overview) was built for, since it reranks the top 50 with a cross-encoder. If it's already on, try a larger context budget before anything cleverer, and measure the token cost of doing so.

**High holes ratio.** Holes are retrieved documents that have no label at all. A high ratio doesn't mean retrieval is bad. It means your labels are incomplete, and retrieval may be finding relevant documents you didn't know about. Label a sample of the holes before trusting NDCG.

**High top scores on unanswerable questions.** The ranker thinks something in the corpus answers a question nobody can answer from it. Your grounding gate will let these through, so either raise the threshold or accept that the model has to do the refusing.

**Mostly "in context".** Now, and only now, the prompt is a legitimate suspect.

## When it really is the prompt

If the right passage was in the context and the answer is still wrong, you're debugging generation. Do it with retrieval frozen: save the exact passages each question received and replay them against each prompt variant. Otherwise a re-index or a ranker change lands in the middle of your prompt experiment and you can't tell which change moved the result.

For scoring the generated answers, the same SDK has LLM-judged evaluators: `GroundednessEvaluator` for whether claims are supported by the supplied context, `RelevanceEvaluator` for whether the answer addresses the question, and `ResponseCompletenessEvaluator` (preview) for whether it covers what a ground-truth answer covers. The [Azure Architecture Center RAG evaluation guide](https://learn.microsoft.com/azure/architecture/ai-ml/guide/rag/rag-solution-design-and-evaluation-guide) is a solid reference on separating these concerns. Treat LLM-judge scores as a trend line across a run, not a verdict on one answer.

If prompt changes don't move a misuse problem, check whether you need a different model or a constrained output format before reaching for fine-tuning. [Fine-Tuning or RAG? Decide by the Failure You're Fixing](/blog/2026-02-20-fine-tuning-vs-rag-2026/) covers that decision.

## When this is overkill

There are cases where I wouldn't build the labelled set yet.

- **The corpus fits in the context window.** If you're sending all twenty pages of a policy every time, there's no retrieval to debug. Everything is a prompt or model problem.
- **You're still deciding whether to build it at all.** A throwaway prototype doesn't need ground truth. Anything with real users does.
- **You've handed retrieval to the platform.** With Azure AI Search agentic retrieval (preview), query planning is out of your hands, so the useful question becomes whether its results beat your pipeline on your labelled set, which still needs the set. I compared the two in [Agentic Retrieval or a Hand-Built RAG Pipeline?](/blog/2026-02-02-rag-systems-that-work/)

## The order I'd work in

When a RAG answer is wrong: check the corpus has the answer, check retrieval found it, check it ranked high enough to be sent, and only then open the prompt. Build the fifty-question labelled set before you need it, keep it in source control next to the index definition, and rerun the retrieval-only script on every chunking, embedding or ranking change. It costs a few search queries per question and no model tokens, and it turns "the bot got it wrong" into a bucket you can act on.
