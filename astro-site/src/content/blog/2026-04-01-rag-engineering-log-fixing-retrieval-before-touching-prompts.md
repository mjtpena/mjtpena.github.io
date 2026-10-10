---
title: "Treat Retrieval Changes Like Schema Changes: A RAG Regression Gate"
description: "Make retrieval-first a team rule: an owned question set, a side-by-side index comparison on Azure AI Search, and a gate that fails on lost answers."
author: Michael John Peña
draft: false
date: 2026-04-01
tags:
  - RAG
  - Azure AI Search
  - Evaluation
  - Python
  - DevOps
---

"Fix retrieval before you touch the prompt" is advice most RAG teams agree with and few actually follow. It stays a habit of whoever is most careful, so a chunking tweak or an embedding swap ships on a Friday because the demo questions still looked fine, and three weeks later someone patches the prompt to cover an answer that quietly fell out of the top five. The fix is an operating rule rather than more tooling: retrieval changes get an owner, an acceptance test and a runbook, the same way database schema changes do.

I covered the diagnostic side, sorting a wrong answer into "not retrieved", "ranked out" or "misused", in [Wrong RAG Answer? Rule Out Retrieval Before You Edit the Prompt](/blog/2026-03-10-rag-tradeoffs-i-keep-seeing-fixing-retrieval-before-touching-prompts/). This post is about the process around it: what counts as a retrieval change, how to compare two indexes side by side, and what the gate should fail on. Examples use Azure AI Search and `azure-search-documents` 11.6.0, the current GA Python library as of April 2026.

## What counts as a retrieval change

The first operating rule is a definition, because teams argue about it later if it isn't written down. I treat any of these as a retrieval change that needs the gate:

- **Chunking:** size, overlap, splitting strategy, or what metadata gets prepended to a chunk.
- **Embeddings:** a new embedding model, new dimensions, or a vectoriser change that alters which model embeds the query. A new model or new dimensions means a full re-index, so there is no such thing as a small embedding change.
- **Index schema:** analysers, searchable and filterable fields, scoring profiles, the semantic configuration's title and content fields.
- **Query shape:** keyword versus vector versus hybrid, `k` and `top`, filters, query rewriting, how many chunks the app sends to the model.
- **Content:** a bulk load, a new source system, or a de-duplication pass. Content changes move rankings as much as config changes do.

What's deliberately not on the list: prompt edits, model version changes and output format changes. Those belong to a separate generation gate on frozen context, which I described in [Gating LLM Changes on Groundedness Flips, Not Fluency Averages](/blog/2026-03-09-how-i-evaluate-llm-changes-tracking-groundedness-before-celebrating-fluency/). Keeping the two gates apart is the point. If a pull request touches both chunking and the system prompt, split it, otherwise you can't tell which half moved the result.

## Give the question set an owner

The gate is only as good as the labelled questions behind it, and question sets rot. Documents get retired, policies get rewritten, and a question whose answer document was deleted will fail every run until someone notices the failure isn't real.

So the second rule is ownership. One named person, usually whoever owns the content domain rather than an engineer, is accountable for the question set. In practice that means:

- The set lives in source control next to the index definition, as JSONL, and changes to it go through review like code.
- Every question carries the parent document IDs that answer it. Label documents, not chunks, because chunk IDs change with every chunking experiment, which is exactly what the gate exists to test.
- Some questions are marked `critical`. These are the ones where a wrong answer has a real cost: a leave entitlement, a safety procedure, a pricing rule. Losing one of them fails the gate on its own.
- When the content changes, the owner updates the labels in the same release. A question set that's three months behind the corpus produces false alarms, and false alarms teach people to override the gate.

Fifty to a hundred questions is enough. I'd rather have sixty current, owner-reviewed questions than five hundred generated ones nobody has read.

## Compare two indexes, not one index against a threshold

The tempting design is a single number: "hit rate at 5 must stay above 0.85". I don't like it as the primary gate. A change can lift ten easy questions and drop three important ones and still raise the average. The number goes up and the users who asked those three questions get worse answers.

The more useful comparison is per question, between the index production uses today (the baseline) and the index built from the change (the candidate). Build the candidate as a separate index, run the same queries against both, and count flips: questions whose answer document was in the context before and isn't now, and the reverse. Build the candidate from the same source snapshot as the baseline, or rebuild the baseline alongside it, unless the content load is itself the change. Otherwise the flips measure content drift, not the change under test.

This is the blue-green pattern applied to an index. It costs storage for a second copy while the comparison runs, and on a large corpus it costs the time to re-index, but a retrieval change that needs a re-index is going to pay that cost anyway. Azure AI Search also has [index aliases](https://learn.microsoft.com/azure/search/search-how-to-alias), which let the app query a stable name you repoint at the new index after the gate passes. When I wrote this, aliases were still a preview feature available only through preview REST API versions, and `azure-search-documents` 11.6.0 has no alias operations. If you want to stay on GA APIs, keep the live index name in app configuration and change it there. Check the alias docs for current status before you rely on either route.

## The gate script

The retrieval call and the "first chunk whose parent is an answer document" logic are the same as the `retrieve` and `bucket` functions in [the March triage script](/blog/2026-03-10-rag-tradeoffs-i-keep-seeing-fixing-retrieval-before-touching-prompts/). The script below queries both indexes with the same hybrid query plus the [semantic ranker](https://learn.microsoft.com/azure/search/semantic-search-overview), finds where the answer documents land in the chunk ranking, and exits non-zero if the change loses a critical question or loses more questions than it gains. It assumes each index has a vectoriser on `content_vector`, a semantic configuration named `default`, and a `parent_id` field holding the source document key. Rename those to match your schema.

```python
# retrieval_gate.py
# Requires Python 3.10+
# pip install azure-search-documents==11.6.0 azure-identity
# Usage: python retrieval_gate.py <baseline-index> <candidate-index> golden_set.jsonl
# golden_set.jsonl, one line per question:
# {"id": "q017", "question": "Who approves leave exceptions in NZ?", "answers": ["hr-policy-nz"], "critical": true}
# {"id": "q031", "question": "How much parental leave do NZ staff get?", "answers": ["hr-leave-policy", "hr-leave-nz-exceptions"], "require_all": true}
import json
import sys

from azure.identity import DefaultAzureCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizableTextQuery

SEARCH_ENDPOINT = "https://<your-search-service>.search.windows.net"
CANDIDATES = 50     # the semantic ranker reranks up to 50 results
CONTEXT_SIZE = 5    # chunks the app actually sends to the model
MAX_NET_LOSS = 0    # lost minus gained; tune per team, but write the number down

credential = DefaultAzureCredential()


def answer_rank(client: SearchClient, question: str, answers: set[str], require_all: bool) -> int | None:
    """Rank (1-based) at which the answer is in hand, or None.

    By default that's the first chunk whose parent is any answer document. With
    require_all, it's the rank where the last of the answer documents first appears.
    """
    results = client.search(
        search_text=question,
        vector_queries=[
            VectorizableTextQuery(text=question, k_nearest_neighbors=CANDIDATES, fields="content_vector")
        ],
        query_type="semantic",
        semantic_configuration_name="default",
        semantic_error_mode="fail",  # a ranker failure should stop the gate, not skew it
        select=["parent_id"],
        top=CANDIDATES,
    )
    missing = set(answers)
    for rank, result in enumerate(results, start=1):
        if result["parent_id"] in missing:
            if not require_all:
                return rank
            missing.discard(result["parent_id"])
            if not missing:
                return rank
    return None


def in_context(rank: int | None) -> bool:
    return rank is not None and rank <= CONTEXT_SIZE


def main(baseline_index: str, candidate_index: str, golden_path: str) -> int:
    lost, gained, critical_lost = [], [], []
    with (
        SearchClient(SEARCH_ENDPOINT, baseline_index, credential) as baseline,
        SearchClient(SEARCH_ENDPOINT, candidate_index, credential) as candidate,
        open(golden_path, encoding="utf-8") as f,
    ):
        for line in f:
            if not line.strip():
                continue  # tolerate blank or trailing empty lines
            item = json.loads(line)
            answers = set(item["answers"])
            if not answers:
                continue  # unanswerable questions belong to the refusal tests, not this gate
            require_all = bool(item.get("require_all"))
            before = answer_rank(baseline, item["question"], answers, require_all)
            after = answer_rank(candidate, item["question"], answers, require_all)
            print(f"{'':7}{item['id']}: rank {before} -> {after}")
            if in_context(before) and not in_context(after):
                lost.append((item["id"], before, after))
                if item.get("critical"):
                    critical_lost.append(item["id"])
            elif in_context(after) and not in_context(before):
                gained.append((item["id"], before, after))

    for qid, before, after in lost:
        print(f"LOST   {qid}: rank {before} -> {after}")
    for qid, before, after in gained:
        print(f"GAINED {qid}: rank {before} -> {after}")
    print(f"lost {len(lost)}, gained {len(gained)}, critical lost {len(critical_lost)}")

    if critical_lost:
        print(f"FAIL: critical questions lost: {', '.join(critical_lost)}")
        return 1
    if len(lost) - len(gained) > MAX_NET_LOSS:
        print("FAIL: the change loses more answers than it gains")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("usage: python retrieval_gate.py <baseline-index> <candidate-index> <golden_set.jsonl>")
    sys.exit(main(*sys.argv[1:]))
```

A few choices in there are deliberate. The rank is measured on chunks, not documents, because `CONTEXT_SIZE` counts chunks and that's what the model receives. `semantic_error_mode="fail"` means a ranker outage fails the run loudly instead of comparing unranked results to ranked ones. The gate only counts crossings of the context boundary, on purpose. Ranks that move inside the top five, or sink further outside it, don't fail the gate, but the script prints every question's before and after rank, so the drift is visible; watch for questions that hover at rank five, because they're the next ones to fall out. Run baseline against itself once; any flips there are noise, and those questions shouldn't count toward the net-loss rule. HNSW vector search is approximate and semantic reranking can vary slightly between replicas, so with `MAX_NET_LOSS = 0` one noisy question can fail an innocent change. Questions that need more than one document, such as a policy plus its regional exception, carry `"require_all": true`, and only count as in context when every listed document has a chunk in the top `CONTEXT_SIZE`. And unanswerable questions are skipped, because "the right answer is nothing" needs a different test, usually a reranker score threshold, which belongs with the grounding checks.

Run it from the pipeline that builds the candidate index, with a service principal or workload identity that has the Search Index Data Reader role on both indexes, and the search service's API access control set to role-based or both, because the key-only default rejects Entra tokens. `DefaultAzureCredential` picks that up without a key in the repo. Each run costs two hybrid semantic queries per question: two semantic ranker requests and two small embedding calls through the vectoriser, but no chat-model tokens. On the free [semantic ranker plan](https://learn.microsoft.com/azure/search/semantic-how-to-enable-disable) (1,000 requests a month) a 100-question set uses the quota in about five runs, so switch the service to the standard plan, which bills per 1,000 requests, before wiring this into every pull request.

## The runbook when it fails

A gate without a runbook just gets overridden. Mine has four steps:

1. **Read the lost list first, not the counts.** Open each lost question and look at what took its place in the top five. Most of the time the cause is obvious: a table split from its heading, a near-duplicate document crowding out the right one, an analyser that stopped matching a product code.
2. **Ask the question set owner whether the label is still right.** If the content changed and the old answer document is genuinely superseded, the fix is a label update, reviewed by the owner, not a gate override.
3. **Fix forward or revert.** If the loss is real, either adjust the change and rebuild the candidate, or drop it. Don't ship it with a prompt patch to cover the lost answers. That's the exact habit the gate exists to stop.
4. **Record overrides.** If the team decides a loss is acceptable because the gains matter more, say so in the pull request with the question IDs. An override with a reason is a decision. An override without one is drift.

## When this is too much process

I wouldn't set this up for every RAG project. If the corpus fits in the context window and the app sends the whole document every time, there's no ranking to regress. If it's a prototype with no real users, build the question set when someone depends on the answers, not before.

The one that catches teams out is ownership. If nobody will own the questions, a gate on a stale set fails for the wrong reasons and teaches the team to ignore it. If you can't name an owner, start with the one-off triage from the March post and come back to the gate later.

The last case is when you've handed retrieval to the platform. With Azure AI Search agentic retrieval (preview), you can still run the same questions before and after a configuration change, but you're gating the service's behaviour rather than your own pipeline. I compared that trade-off in [Agentic Retrieval or a Hand-Built RAG Pipeline?](/blog/2026-02-02-rag-systems-that-work/)

## What makes it stick

The script is the easy part. What changes behaviour is the three things around it: a written definition of a retrieval change, a named owner for the questions, and a gate that fails on lost answers rather than a moving average. With those in place, "fix retrieval first" stops depending on who reviewed the pull request. The [Azure Architecture Center RAG evaluation guide](https://learn.microsoft.com/azure/architecture/ai-ml/guide/rag/rag-solution-design-and-evaluation-guide) covers the wider evaluation picture. If you're starting from nothing, I'd begin with sixty owned questions and the side-by-side comparison, and add thresholds only once you've seen a few months of flips.
