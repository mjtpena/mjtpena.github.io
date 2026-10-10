---
title: "GraphRAG 1.x: When Global Search Justifies the Indexing Bill"
description: "How Microsoft's GraphRAG 1.x builds a knowledge graph, what local, global and DRIFT search do, and when its indexing cost is worth paying over vector RAG."
author: Michael John Peña
draft: false
date: 2025-01-18
tags:
  - GraphRAG
  - RAG
  - Knowledge Graphs
  - Azure OpenAI
  - Architecture
---

Vector RAG answers "what does the document say about X?" well and "what are the main themes across these 5,000 documents?" badly. Top-k similarity search returns a handful of chunks, so any question whose answer is spread thinly across the whole corpus gets a confident answer built from a small, arbitrary sample. GraphRAG is Microsoft Research's answer to that gap, and with the library past 1.0 it is now stable enough to evaluate seriously. The question I keep getting is not "how does it work?" but "is it worth the indexing bill?"

## What changed between the paper and now

The approach was published in April 2024 as [From Local to Global: A Graph RAG Approach to Query-Focused Summarization](https://arxiv.org/abs/2404.16130) and open-sourced as the `graphrag` Python package in July 2024. The 0.x releases broke things often. Since then:

- **1.0.0** shipped on PyPI on 11 December 2024 ([changelog](https://github.com/microsoft/graphrag/blob/main/CHANGELOG.md)), with a cleaned-up data model and a migration notebook for older indexes.
- **1.1.0** (7 January 2025) added Cosmos DB as a storage option for the cache and the output tables.
- **1.2.0** (15 January 2025) added a Cosmos DB vector store alongside LanceDB (the default) and Azure AI Search, plus a reduce step and streaming for DRIFT search.

Microsoft Research also published two query-side improvements in late 2024: [dynamic community selection](https://www.microsoft.com/en-us/research/blog/graphrag-improving-global-search-via-dynamic-community-selection/) for global search (15 November), and [LazyGraphRAG](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/) (25 November). Dynamic selection is in the library today behind a CLI flag. LazyGraphRAG is a research announcement, not something you can `pip install`, so don't plan a project around it yet.

## What the indexer actually builds

It helps to be precise here, because "GraphRAG" gets used for any pipeline that touches a graph. Microsoft's implementation does six things during `graphrag index`:

1. **Chunks** the input into text units (1,200 tokens with 100 tokens of overlap by default).
2. **Extracts entities and relationships** from every chunk with an LLM call, then runs a "gleaning" pass (one by default) that asks the model whether it missed anything. Default entity types are `organization`, `person`, `geo` and `event`.
3. **Summarises descriptions**: when the same entity appears in 40 chunks, its 40 descriptions are merged into one by another LLM call.
4. **Clusters the graph** with hierarchical Leiden community detection, producing nested communities from broad (level 0) to narrow.
5. **Writes a community report** for every community at every level: an LLM-generated title, summary, findings and an importance rating.
6. **Embeds** entity descriptions, text units and report content into the vector store, which is one more batch of model calls to pay for.

Everything lands as Parquet tables (`create_final_entities`, `create_final_relationships`, `create_final_communities`, `create_final_community_reports`, `create_final_text_units` and so on), with the embeddings in the configured vector store.

Steps 2, 3 and 5 are the bill. Extraction is at least two LLM calls per chunk, description merging scales with entity count, and reports scale with community count across every level. That is why the [project README](https://github.com/microsoft/graphrag#readme) carries a blunt warning: *"GraphRAG indexing can be an expensive operation, please read all of the documentation to understand the process and costs involved, and start small."* Take it literally. You can size the bill before a full run: documents × average tokens per document ÷ roughly 1,100 effective tokens per chunk gives the chunk count, multiply that by at least two extraction calls, then add description-merge and report calls on top. Easier still, read the token usage from your pilot's indexing run and scale it linearly by corpus size; that estimate is close enough to decide whether the full run is affordable.

## Four query modes, four different jobs

The 1.x CLI exposes four methods through `graphrag query --method`:

| Method | What it reads | Good for | Weak at |
|---|---|---|---|
| `global` | Community reports at a chosen level (or a pruned set with dynamic selection), map-reduced | "What are the main themes / risks / disputes across the corpus?" | Specific facts about one entity |
| `local` | Entities matched to the question, their neighbours, relationships, related reports and source chunks | "What is Contoso's relationship with Fabrikam?" | Corpus-wide sensemaking |
| `drift` | Starts from community reports, generates follow-up questions, then drills into local search | Questions that need both breadth and specifics | Latency and token predictability |
| `basic` | Plain vector search over text units | A baseline to compare against | Anything multi-hop |

Global search is the genuinely new capability, and it is the one the paper's evaluation focused on. Local search is useful, but a well-built hybrid retriever with good chunking covers a lot of the same ground for much less money. I covered that baseline in [yesterday's post on advanced retrieval patterns](/blog/2025-01-17-rag-2-0-advanced-retrieval-patterns/), and I would build it first.

Global search has its own cost problem: static global search at a given community level sends every report at that level through the map step. Dynamic community selection fixes the worst of it by having a cheaper model rate reports top-down and prune irrelevant branches. Microsoft reports an average 77% reduction in total token cost versus static search at level 1, using GPT-4o-mini for the rating and GPT-4o for map-reduce. If you evaluate global search, turn this on.

## A minimal evaluation run on Azure OpenAI

The quickest honest evaluation is the CLI against a small, representative slice of your corpus: a few hundred documents, not your whole SharePoint.

```bash
# graphrag 1.2 needs Python 3.10–3.12; it won't install on 3.13
python3.12 -m venv .venv
source .venv/bin/activate
pip install "graphrag==1.2.0"

mkdir -p ./ragtest/input
cp ./sample-docs/*.txt ./ragtest/input/

graphrag init --root ./ragtest
```

`init` writes `settings.yaml`, a `.env` file containing `GRAPHRAG_API_KEY`, and a `prompts/` folder. Put your Azure OpenAI key in `.env`, then point the two model sections at your deployments. This is a fragment of the generated file with the Azure fields filled in. One default does need changing: the template sets `encoding_model: cl100k_base`, but the GPT-4o family uses the `o200k_base` tokenizer, so set it to match or chunk sizes and token budgets will be counted wrongly. Leave the rest of the defaults alone for a first run.

```yaml
encoding_model: o200k_base

llm:
  api_key: ${GRAPHRAG_API_KEY}
  type: azure_openai_chat
  model: gpt-4o-mini
  model_supports_json: true
  api_base: https://<your-resource-name>.openai.azure.com
  api_version: 2024-10-21
  deployment_name: <your-gpt-4o-mini-deployment>

embeddings:
  async_mode: threaded
  vector_store:
    type: lancedb
    db_uri: 'output/lancedb'
    collection_name: default
    overwrite: true
  llm:
    api_key: ${GRAPHRAG_API_KEY}
    type: azure_openai_embedding
    model: text-embedding-3-small
    api_base: https://<your-resource-name>.openai.azure.com
    api_version: 2024-10-21
    deployment_name: <your-embedding-deployment>
```

I start with GPT-4o-mini for indexing. Extraction quality is lower than GPT-4o, but the cost difference is large, and on a pilot you want to learn whether the *shape* of the graph is useful before paying for the best possible version of it.

Before indexing, run auto prompt tuning. The default extraction prompt is generic, and the entity types (`organization`, `person`, `geo`, `event`) are often wrong for enterprise content where you care about systems, policies, contracts or products.

```bash
graphrag prompt-tune --root ./ragtest --config ./ragtest/settings.yaml \
  --domain "enterprise IT policies and vendor contracts"

graphrag index --root ./ragtest
```

Then ask the same questions through each method, so you can compare like for like:

```bash
graphrag query --root ./ragtest --method basic \
  --query "What are the recurring risks raised across these vendor contracts?"

graphrag query --root ./ragtest --method global --dynamic-community-selection \
  --query "What are the recurring risks raised across these vendor contracts?"

graphrag query --root ./ragtest --method local \
  --query "Which systems depend on the Contoso support agreement?"
```

Finally, look at what was extracted before trusting any answer. This reads the output tables directly:

```python
from pathlib import Path

import pandas as pd

output = Path("./ragtest/output")

entities = pd.read_parquet(output / "create_final_entities.parquet")
relationships = pd.read_parquet(output / "create_final_relationships.parquet")
reports = pd.read_parquet(output / "create_final_community_reports.parquet")

print(f"{len(entities)} entities, {len(relationships)} relationships, {len(reports)} reports")
print(entities["type"].value_counts().head(10))

# Near-duplicate entities are the most common quality problem.
names = entities["title"].str.upper().str.replace(r"[^A-Z0-9]", "", regex=True)
dupes = entities[names.duplicated(keep=False)].sort_values("title")
print(dupes[["title", "type"]].head(20))

# Top-level communities: do these titles look like the themes of your corpus?
print(reports[reports["level"] == 0].sort_values("rank", ascending=False)[["title", "rank"]].head(10))
```

If the level-0 report titles read like a sensible table of contents for your corpus, global search has something to work with. If they read like noise, no query-time tuning will save it, and you need better prompts or different entity types.

## When not to use it

I'd skip GraphRAG when:

- **Questions are mostly lookups.** "What is the leave policy for contractors?" needs one good chunk. Hybrid search with semantic ranking is cheaper, faster and easier to explain.
- **The corpus changes daily.** `graphrag update` supports incremental indexing, but entity merging and community re-clustering still cost LLM calls on every refresh. Fast-moving content makes the bill recurring.
- **You need document-level security trimming.** Community reports blend content from many source documents into one summary. If users are only allowed to see some of those documents, you have a leakage problem that a per-chunk ACL filter doesn't solve. That alone rules it out for a lot of enterprise intranet scenarios.
- **You can't audit extraction.** Every relationship is an LLM claim. In regulated domains, someone has to own the quality of that graph, the same way someone owns a data model.

And I'd reach for it when the core questions are about patterns across a large, fairly stable corpus: incident post-mortems, research archives, audit findings, customer feedback. Those are the "what keeps happening?" questions where vector RAG's top-k sample is structurally wrong.

## How I'd decide

Run the three commands above on a few hundred representative documents with a mini model and dynamic community selection. Compare `global` with `basic` on ten real sensemaking questions from the people who will use it. If global search isn't clearly better on those, stop there: you have saved yourself a production indexing bill. If it is, the next decision is whether the security and refresh constraints let you ship it, and that is an architecture conversation, not a prompt-engineering one. The [microsoft/graphrag repository](https://github.com/microsoft/graphrag) has the configuration reference and the release notes to plan against.
