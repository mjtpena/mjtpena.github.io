---
title: "RAG Beyond Top-K: Retrieval Upgrades Worth Making in January 2025"
description: "Which RAG retrieval upgrades Azure AI Search gives you as GA or preview in January 2025, which you build yourself, and the order I'd add them in."
author: Michael John Peña
draft: false
date: 2025-01-17
tags:
  - RAG
  - Azure AI Search
  - Vector Search
  - Azure OpenAI
  - LLM
---

Most RAG systems that disappoint in production weren't let down by the model. The retriever handed it the wrong five chunks, and the model wrote a confident answer from them. "Embed the question, take the top-k nearest chunks, stuff the prompt" is a fine demo. It breaks on product codes, acronyms, multi-part questions and anything the user phrases differently from the source document.

There is now a long menu of fixes: hybrid search, rerankers, query rewriting, HyDE, decomposition, compression, self-reflective loops. Contextual AI coined "RAG 2.0" in March 2024 for retriever and generator models trained end to end; most people now use it loosely for this bundle of retrieval fixes. I'm less interested in the label than in two practical questions. Which of these does Azure AI Search already do for you, and at what release status? And which are worth building yourself? This post answers both as things stand in mid-January 2025, and gives the order I'd add them in.

## What the platform gives you, and at what status

The most useful thing a team can do before writing retrieval code is check what the search service already does. Building your own reranker on top of a service that ships one is a common way to add cost without adding quality.

| Technique | Where it lives in January 2025 | Status | When I'd skip it |
|---|---|---|---|
| Hybrid search (BM25 + vector, fused with RRF) | Azure AI Search | GA | Almost never for text content |
| Semantic ranker (L2 reranking) | Azure AI Search | GA | Short, structured records with little prose |
| Vector weighting (`weight` on a vector query) | Azure AI Search, 2024-07-01 API | GA | Until you have an evaluation set to tune against |
| Integrated vectorization (vectorizers at query time) | Azure AI Search, 2024-07-01 API | GA | If you already embed in your own pipeline and want to keep it that way |
| Vector thresholds, `maxTextRecallSize` | 2024-05-01-preview API | Preview | Production paths that need a support agreement |
| RRF subscore debugging | 2024-09-01-preview API | Preview | Fine for tuning, not needed at runtime |
| Generative query rewriting | 2024-11-01-preview API | Preview, limited regions | See below |
| HyDE, decomposition, relevance grading, self-reflection | Your code | Not a product feature | Until retrieval evaluation shows a gap these address |

The [2024 what's new archive](https://learn.microsoft.com/previous-versions/azure/search/search-whats-new-2024) for Azure AI Search is the dated record for all of this. The August 2024 entries are the important ones. The 2024-07-01 API made integrated vectorization, vectorizers, quantization and vector weighting generally available. The November 2024 entries add query rewriting and the 2024-11-01-preview API.

On the Python side, the GA package is `azure-search-documents` 11.5.2, which targets the 2024-07-01 API. Preview parameters such as `query_rewrites` and `debug` only exist in the 11.6.0 betas (11.6.0b9, released on 14 January 2025, at the time of writing; `query_rewrites` first appeared in 11.6.0b7 in November 2024). The [SDK changelog](https://github.com/Azure/azure-sdk-for-python/blob/main/sdk/search/azure-search-documents/CHANGELOG.md) lists exactly which version added what. Keep production code on the GA package unless a specific preview feature is worth the risk.

## Hybrid plus semantic ranker is the new baseline

If you change one thing, make it this. Pure vector search is weak at exact matches: an error code, a policy number, a person's surname, an internal acronym the embedding model has never seen. BM25 is weak at paraphrase. Running both in parallel and fusing the rankings covers most of each one's blind spots.

Azure AI Search fuses hybrid results with [Reciprocal Rank Fusion](https://learn.microsoft.com/azure/search/hybrid-search-ranking). Each result list contributes `1/(rank + k)` per document, with `k` set to a small constant (60). RRF works on rank positions, not raw scores. That's why you don't have to normalise a BM25 score against a cosine similarity, and why the fused `@search.score` values look tiny. Don't threshold on them.

The [semantic ranker](https://learn.microsoft.com/azure/search/semantic-search-overview) then reranks the top 50 fused results using Microsoft's language models. It adds `@search.rerankerScore`, a calibrated score from 0 to 4. Microsoft moved it to new models in November 2024 with no API change, and it's free under 1,000 queries a month, which covers a pilot. It is a real cross-encoder-style reranker, already hosted. For most teams, it makes building your own reranking stage unnecessary.

Here is the retrieval function I'd start with. It uses the GA SDK, lets the index's vectorizer embed the question (so the query and documents are guaranteed to use the same embedding model), and treats the reranker score as the quality gate.

```python
import os

from azure.identity import DefaultAzureCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizableTextQuery

# pip install "azure-search-documents==11.5.2" azure-identity
search_client = SearchClient(
    endpoint=os.environ["AZURE_SEARCH_ENDPOINT"],  # https://<your-search-service>.search.windows.net
    index_name="<your-index-name>",
    # requires RBAC enabled on the search service and the 'Search Index Data Reader' role
    credential=DefaultAzureCredential(),
)


def retrieve(
    question: str,
    *,
    max_chunks: int = 5,
    min_reranker_score: float = 2.0,
    odata_filter: str | None = None,
) -> list[dict]:
    """Hybrid retrieval with semantic reranking and a relevance floor."""
    results = search_client.search(
        search_text=question,  # BM25 leg
        vector_queries=[
            VectorizableTextQuery(  # vector leg, embedded by the index's vectorizer
                text=question,
                k_nearest_neighbors=50,
                fields="content_vector",
            )
        ],
        filter=odata_filter,  # e.g. "department eq 'finance'"
        query_type="semantic",
        semantic_configuration_name="<your-semantic-config>",
        top=50,  # give the semantic ranker its full 50-document window
        select=["chunk_id", "title", "content", "source_url"],
    )

    chunks: list[dict] = []
    for result in results:
        reranker_score = result.get("@search.reranker_score") or 0.0
        if reranker_score < min_reranker_score:
            continue
        chunks.append(
            {
                "chunk_id": result["chunk_id"],
                "title": result["title"],
                "content": result["content"],
                "source_url": result["source_url"],
                "reranker_score": reranker_score,
            }
        )
        if len(chunks) == max_chunks:
            break
    return chunks
```

A few design choices are worth explaining:

- **`top=50` with a small `max_chunks`.** The semantic ranker only reranks what the first stage returns, up to 50. Asking for five means it only reorders five. Retrieve wide, rerank, then cut.
- **A reranker-score floor instead of a fixed k.** Returning zero chunks is a valid outcome. It is the signal that lets the application say "I couldn't find that" instead of making something up. A floor of 2.0 is my starting point, not a documented recommendation. Tune it against your own labelled questions.
- **Filters in the query, not after it.** Security trimming and scoping belong in `filter`, so they apply before ranking. I covered the trade-offs of pre- and post-filtering in [filtered vector search](/blog/2024-07-31-filtered-vector-search/).
- **`VectorizableTextQuery` needs a vectorizer** on the vector field's profile. If you embed outside the index, use `VectorizedQuery` with your own vector instead. Integrated vectorization is GA, so either is supportable.

When not to lean on semantic ranker: catalogues of short, structured records (SKUs, people directories, ticket metadata). The ranker scores prose. With little text to read, it adds latency without changing the order much.

## Query transformation: be careful what you build

Query rewriting is where I see the most over-engineering. The usual pattern is an LLM call to generate paraphrases, another to decompose the question, and a third for a HyDE passage ([Gao et al., 2022](https://arxiv.org/abs/2212.10496)), which is a hypothetical answer you embed instead of the question. That is three model calls before retrieval even starts, plus a fan-out of searches you then have to merge.

Azure AI Search now has a built-in option. [Generative query rewriting](https://learn.microsoft.com/azure/search/semantic-how-to-query-rewrite) sends the query to a model that produces up to ten alternative phrasings, and uses them alongside the original. It requires semantic ranker and the 2024-11-01-preview API, set with `"queryRewrites": "generative|count-5"` plus a `queryLanguage`. In January 2025 it's only available in North Europe and Southeast Asia. For anyone in Sydney with data residency requirements, that rules it out for now. Microsoft's own note also warns that rewrites can drop exact terms, which hurts queries built around identifiers.

My position on the do-it-yourself versions:

- **Decomposition** earns its place when users genuinely ask compound questions ("compare our leave policy in NSW and Victoria"). Detect it cheaply, and only split when needed.
- **Paraphrase expansion** is mostly what hybrid search already gives you. Add it only if evaluation shows recall failures on vocabulary mismatch.
- **HyDE** helps when questions and documents are written in very different registers, such as a casual question against formal policy text. It costs a full generation per query and can bias retrieval toward whatever the model already believes. I wouldn't make it the default.

## Grade the context before you generate

The pattern I'd prioritise isn't a retrieval technique at all. It's a cheap check between retrieval and generation: given these chunks, can this question actually be answered? This is the core idea behind Self-RAG ([Asai et al., 2023](https://arxiv.org/abs/2310.11511)) and corrective RAG, reduced to one model call that works with any model.

Structured outputs make this reliable. On Azure OpenAI, [structured outputs](https://learn.microsoft.com/azure/ai-services/openai/how-to/structured-outputs) are supported in the 2024-10-21 GA API with models including `gpt-4o` 2024-08-06, `gpt-4o-mini` 2024-07-18 and `o1` 2024-12-17. The model has to return the schema, so you don't parse free text looking for "YES".

```python
import os

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI
from pydantic import BaseModel

# pip install "openai>=1.40" azure-identity pydantic
# the identity needs the 'Cognitive Services OpenAI User' role on the Azure OpenAI resource
token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)
llm = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],  # https://<your-resource-name>.openai.azure.com
    azure_ad_token_provider=token_provider,
    api_version="2024-10-21",
)
GRADER_DEPLOYMENT = "<your-gpt-4o-mini-deployment>"


class ContextGrade(BaseModel):
    answerable: bool
    supporting_chunk_ids: list[str]
    missing_information: str


def grade_context(question: str, chunks: list[dict]) -> ContextGrade:
    context = "\n\n".join(f"[{c['chunk_id']}]\n{c['content']}" for c in chunks)
    completion = llm.beta.chat.completions.parse(
        model=GRADER_DEPLOYMENT,
        temperature=0,
        response_format=ContextGrade,
        messages=[
            {
                "role": "system",
                "content": (
                    "Decide whether the context fully answers the question. "
                    "Only cite chunk ids that directly support the answer. "
                    "If it is not answerable, say what information is missing."
                ),
            },
            {"role": "user", "content": f"Question: {question}\n\nContext:\n{context}"},
        ],
    )
    return completion.choices[0].message.parsed
```

If `answerable` is false, you have three honest options: retry once with a decomposed or reworded query, widen the filter, or tell the user what's missing. If it's true, pass only the `supporting_chunk_ids` to the generator. That is contextual compression in the same call, rather than one LLM call per document, which multiplies cost by the number of chunks.

When not to add this: low-stakes internal search where a slightly wrong answer is cheap, or latency budgets under a second or two. The grader adds a full round trip. I'd also keep it to one retry. Open-ended reflection loops are how a RAG app turns into an [agent you didn't mean to build](/blog/2025-01-15-ai-application-patterns-2025/).

## Multiple indexes and custom reranking stacks

Two patterns that appear in most "advanced RAG" lists, and that I'd usually avoid early on:

**Routing across several specialised indexes** with an LLM classifier. Scores from different indexes aren't comparable, even after weighting, so merging them is guesswork. One index with a `content_type` field and a filter is simpler. It also means the semantic ranker compares everything in a single pass. Split indexes when security boundaries or schemas genuinely differ, not by topic.

**A home-built rerank cascade** of cross-encoder plus LLM ranker plus a weighted blend of scores. On Azure AI Search, the semantic ranker already is the cross-encoder stage. Adding an LLM ranker on top costs a large prompt per query, and the hand-picked blend weights are rarely validated. If you need domain-specific ranking, start with vector weighting or a scoring profile, measured against an evaluation set.

## The order I'd add things

1. **Build an evaluation set first.** Fifty to a hundred real questions with the chunks that should come back. Without it, every item below is opinion.
2. **Hybrid search with semantic ranker,** retrieving 50 and cutting by reranker score. This is GA and mostly configuration.
3. **Fix chunking and metadata filters** before touching query logic. Bad chunks can't be reranked into good ones.
4. **Add the context grader** for anything user-facing where a wrong answer has a cost.
5. **Only then** consider decomposition, HyDE, or the query rewriting preview, one at a time, keeping whatever moves your retrieval metrics.

In its loose sense, "RAG 2.0" isn't a new architecture. It's the discipline of measuring retrieval and using what the search service already does well before writing your own version of it. In January 2025, Azure AI Search does more of that than most teams realise.
