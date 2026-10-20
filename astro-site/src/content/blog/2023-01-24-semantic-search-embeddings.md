---
title: "Semantic Search Prototype: Azure OpenAI Embeddings and NumPy"
description: "Build a small semantic search prototype on Azure OpenAI embeddings and NumPy, measure it with hit rate@k, add BM25, and know when to move to a real index."
author: Michael John Peña
draft: false
date: 2023-01-24
tags:
  - Azure OpenAI
  - Embeddings
  - Semantic Search
  - Python
  - Search
---

Users don't search with your vocabulary. They type "how do I stop paying for idle machines" and your documentation says "auto-shutdown for Azure Virtual Machines", so a keyword index returns nothing useful. Embeddings fix that mismatch by comparing meaning instead of words. Before you commit to a vector database, though, you should prove that embedding search actually beats what you have on your own content, and the cheapest way to prove it is a prototype that fits in one Python file.

Azure OpenAI went [generally available](/blog/2023-01-20-azure-openai-service-ga/) on 16 January, and if you need the basics of what an embedding is first, start with [text embeddings on Azure OpenAI](/blog/2023-01-23-embeddings-introduction/).

## Why a prototype and not a platform

The default advice right now is "pick a vector database". I think that's premature for most teams. The question you can't answer yet is whether semantic search is better than keyword search *for your corpus and your users' queries*. Internal wikis full of product codes, ticket numbers and acronyms often do fine with keywords. Long-form policy and how-to content usually doesn't.

A brute-force search over a NumPy matrix answers that question in a day. A few tens of thousands of chunks at 1,536 dimensions fit comfortably in memory. Scoring every chunk against a query is a single matrix-vector multiply that takes milliseconds. Nothing to deploy, nothing to keep in sync, and nothing to unpick if the answer is "keywords were fine".

The latency you'll notice is elsewhere. Every query has to be embedded first, which is an Azure OpenAI round trip that typically takes hundreds of milliseconds and counts against the same rate limit as indexing. That applies to every evaluation query and every hybrid search call too, so cache query embeddings while you iterate on chunking and fusion rather than paying for the same 50 queries on every run.

## Choosing the embedding model in January 2023

On 15 December 2022 OpenAI released [`text-embedding-ada-002`](https://openai.com/index/new-and-improved-embedding-model/). It replaces the first-generation similarity and search models with one model, returns 1,536 dimensions, and accepts up to 8,191 tokens on OpenAI's own API. It isn't in the Azure OpenAI model list yet: the [models page](https://learn.microsoft.com/azure/cognitive-services/openai/concepts/models) lists only the first-generation embeddings models, and the January entry on the [What's new page](https://learn.microsoft.com/azure/cognitive-services/openai/whats-new) doesn't mention it. When it arrives, don't assume Azure will match OpenAI's 8,191-token limit; check the models page and the deployments list in Azure OpenAI Studio before you design around it.

So on Azure this month, build on the first-generation search models. They come as pairs: `text-search-ada-doc-001` for the documents and `text-search-ada-query-001` for the queries. Both produce 1,024-dimensional vectors that are designed to be compared with each other, and the [REST reference](https://learn.microsoft.com/azure/cognitive-services/openai/reference) caps each input at 2,048 tokens. That asymmetry is why the code below takes two deployment names. With the `-001` pair you use one deployment for each. When ada-002 reaches Azure you point both at the same deployment. When you switch models later you re-embed the whole corpus, because vectors from different models aren't comparable.

Two Azure details shape the code:

- **One input per request.** OpenAI's own API accepts an array of inputs. In Azure OpenAI, plan on a single string per call for now. Indexing 20,000 chunks means 20,000 requests against your resource's rate limit for the model, so the indexer needs to back off on HTTP 429. At an illustrative 300 requests a minute that's a bit over an hour of wall-clock time; check the current per-model limits on the [Azure OpenAI quotas and limits page](https://learn.microsoft.com/azure/ai-services/openai/quotas-limits) before you plan around it.
- **The deployment name is the `engine`.** You pass the name you gave the deployment, not the model name.

Estimate the one-off cost before you start. Count the corpus's tokens with OpenAI's `tiktoken` library (or use roughly 1.3 tokens per English word), divide by 1,000 and multiply by the per-1K-token price for your embedding model on the Azure OpenAI pricing page. For a typical internal knowledge base that is a small number, and it's paid once per model, which is another reason to settle the model choice before you index everything.

## The prototype

This uses the `openai` 0.26 Python library with `api_type = "azure"` and API version `2022-12-01`, as covered in [the Azure OpenAI Python setup post](/blog/2023-01-18-azure-openai-python-sdk/). Save it as `semantic_search.py`.

```python
import json
import os
import sys
import time
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np
import openai

openai.api_type = "azure"
openai.api_base = "https://<your-resource-name>.openai.azure.com/"
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

# Once text-embedding-ada-002 is on Azure, set both to the same deployment.
# With the first-generation pair, use text-search-ada-doc-001 and text-search-ada-query-001.
DOC_DEPLOYMENT = "<your-doc-embedding-deployment>"
QUERY_DEPLOYMENT = "<your-query-embedding-deployment>"


@dataclass
class Chunk:
    id: str
    text: str
    metadata: Dict[str, str] = field(default_factory=dict)


def embed(text: str, deployment: str, max_retries: int = 5) -> np.ndarray:
    """Embed one string, backing off on throttling and transient service errors."""
    text = text.replace("\n", " ")
    for attempt in range(max_retries):
        try:
            response = openai.Embedding.create(engine=deployment, input=text)
            vector = np.array(response["data"][0]["embedding"], dtype=np.float32)
            return vector / np.linalg.norm(vector)
        except (openai.error.RateLimitError, openai.error.ServiceUnavailableError,
                openai.error.Timeout):
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Embedding failed after {max_retries} attempts")


def chunk_text(doc_id: str, text: str, metadata: Dict[str, str],
               max_words: int = 200) -> List[Chunk]:
    """Split on paragraphs, merging small ones and splitting long ones at max_words."""
    pieces: List[str] = []
    for paragraph in [p.strip() for p in text.split("\n\n") if p.strip()]:
        words = paragraph.split()
        for start in range(0, len(words), max_words):
            pieces.append(" ".join(words[start:start + max_words]))

    chunks: List[str] = []
    current: List[str] = []
    for piece in pieces:
        if current and len(" ".join(current + [piece]).split()) > max_words:
            chunks.append(" ".join(current))
            current = []
        current.append(piece)
    if current:
        chunks.append(" ".join(current))
    return [Chunk(f"{doc_id}#{i}", c, metadata) for i, c in enumerate(chunks)]


class VectorIndex:
    def __init__(self) -> None:
        self.chunks: List[Chunk] = []
        self.matrix: Optional[np.ndarray] = None
        self.doc_deployment = DOC_DEPLOYMENT

    def add(self, chunks: List[Chunk]) -> None:
        if not chunks:  # empty or whitespace-only file
            return
        vectors = [embed(c.text, DOC_DEPLOYMENT) for c in chunks]
        new = np.vstack(vectors)
        self.matrix = new if self.matrix is None else np.vstack([self.matrix, new])
        self.chunks.extend(chunks)

    def search(self, query: str, top_k: int = 5,
               where: Optional[Dict[str, str]] = None) -> List[tuple]:
        if self.matrix is None:
            return []
        q = embed(query, QUERY_DEPLOYMENT)
        scores = self.matrix @ q  # vectors are unit length, so this is cosine similarity
        if where:
            mask = np.array([all(c.metadata.get(k) == v for k, v in where.items())
                             for c in self.chunks])
            scores = np.where(mask, scores, -np.inf)
        best = np.argsort(-scores)[:top_k]
        return [(float(scores[i]), self.chunks[i]) for i in best if np.isfinite(scores[i])]

    def save(self, path: str) -> None:
        if self.matrix is None:
            raise ValueError("Nothing to save: the index is empty")
        np.save(f"{path}.npy", self.matrix)
        with open(f"{path}.json", "w", encoding="utf-8") as f:
            json.dump({"doc_deployment": DOC_DEPLOYMENT,
                       "chunks": [c.__dict__ for c in self.chunks]}, f)

    @classmethod
    def load(cls, path: str) -> "VectorIndex":
        index = cls()
        index.matrix = np.load(f"{path}.npy")
        with open(f"{path}.json", encoding="utf-8") as f:
            data = json.load(f)
        index.doc_deployment = data["doc_deployment"]
        if index.doc_deployment != DOC_DEPLOYMENT:
            raise ValueError(
                f"Index was built with '{index.doc_deployment}' but DOC_DEPLOYMENT is "
                f"'{DOC_DEPLOYMENT}'. Re-embed the corpus before searching it.")
        index.chunks = [Chunk(**c) for c in data["chunks"]]
        return index


if __name__ == "__main__":
    # Usage: python semantic_search.py <folder-of-md-or-txt-files>
    folder = Path(sys.argv[1])
    index = VectorIndex()
    for file in sorted(folder.glob("*")):
        if file.suffix in (".md", ".txt"):
            text = file.read_text(encoding="utf-8")
            index.add(chunk_text(file.stem, text, {"source": file.name}))
    index.save("kb-index")
    print(f"Indexed {len(index.chunks)} chunks into kb-index.npy and kb-index.json")
```

A few decisions in there are deliberate.

**Normalise once at index time.** OpenAI's embeddings already come back at roughly unit length, but normalising explicitly means `matrix @ q` is cosine similarity no matter what. Scoring the whole corpus is then one operation instead of a Python loop. A Python loop over documents is fine for fifty items and painful for fifty thousand.

**Chunk by paragraph, not by document.** One vector for a ten-page document is an average of everything in it and matches nothing well. Paragraph-sized chunks of a couple of hundred words stay well inside the 2,048-token input limit Azure documents for embeddings, and any paragraph longer than `max_words` is split into word windows first, so one wall of text can't produce an oversized chunk that the service rejects. That also gives the search something specific to match. Overlap between chunks and splitting on headings are worth trying once you have an evaluation set to tell you whether they help.

**Filter before ranking, not after.** Masking scores to `-inf` for chunks outside the filter means `top_k` always returns the best matching results *within* the filter. Filtering after taking the top five can leave you with zero results.

**Record the deployment with the vectors.** The saved JSON keeps the document deployment name. `load()` compares it with the current `DOC_DEPLOYMENT` and refuses to search an index built with a different model, because a silent mismatch returns plausible-looking nonsense.

## Measuring it before you believe it

The step most teams skip is evaluation. A demo with three hand-picked queries always looks good. Write down 30 to 50 real queries, from search logs or support tickets if you have them, and for each one note which chunk IDs a good answer would include. Build the index first with `python semantic_search.py ./docs`; chunk IDs take the form `<file-name>#<n>`, so label your queries with those. Then measure hit rate@k: the share of queries where at least one correct chunk appears in the top k. It's often loosely called recall@k, but strictly recall@k divides the relevant chunks found by all relevant chunks for the query. Hit rate is the better first question for search, because a user usually needs one good result.

```python
from typing import Dict, Set

from semantic_search import VectorIndex


def hit_rate_at_k(index: VectorIndex, labelled: Dict[str, Set[str]], k: int = 5) -> float:
    hits = 0
    for query, relevant_ids in labelled.items():
        returned = {chunk.id for _, chunk in index.search(query, top_k=k)}
        hits += bool(returned & relevant_ids)
    return hits / len(labelled)


if __name__ == "__main__":
    index = VectorIndex.load("kb-index")
    labelled_queries: Dict[str, Set[str]] = {
        "stop paying for idle virtual machines": {"vm-cost-guide#2"},
        "rotate storage account keys": {"storage-security#4", "key-vault-howto#1"},
    }
    print(f"hit rate@5: {hit_rate_at_k(index, labelled_queries):.2f}")
```

Run the same labelled set against your current keyword search. If embeddings don't clearly win, you've saved yourself a platform decision. If they do, you have a baseline to protect when you change chunk sizes or models.

While you're labelling, look at the raw scores. Don't read a cosine similarity of 0.82 as "82% relevant". In my experience scores cluster high (with ada-002, unrelated text often lands around 0.7), and the `-001` models have their own range, so any "minimum score" cut-off has to come from your labelled data, not from a default.

## Adding keywords back in

Embeddings are weak at exact identifiers. `ERR-4012` and `ERR-4021` look almost identical to an embedding model. If your users search for product codes or error numbers, combine vector results with BM25 keyword scoring. I prefer reciprocal rank fusion over a weighted sum of scores, because BM25 scores and cosine similarities sit on different scales and normalising them is fiddly. Rank fusion only uses each result's position in each list. Run BM25 on its own against the labelled set first, though. If it matches the vector hit rate@5, keep keywords and stop there.

```python
from typing import Dict, List

from rank_bm25 import BM25Okapi

from semantic_search import VectorIndex


def hybrid_search(index: VectorIndex, query: str, top_k: int = 5, k: int = 60) -> List[str]:
    tokenised = [c.text.lower().split() for c in index.chunks]
    bm25_scores = BM25Okapi(tokenised).get_scores(query.lower().split())
    order = bm25_scores.argsort()[::-1]
    # Skip zero-score chunks so they don't collect fusion credit by accident.
    keyword_ranking = [index.chunks[i].id for i in order[:50] if bm25_scores[i] > 0]
    vector_ranking = [c.id for _, c in index.search(query, top_k=50)]

    fused: Dict[str, float] = {}
    for ranking in (keyword_ranking, vector_ranking):
        for position, chunk_id in enumerate(ranking):
            fused[chunk_id] = fused.get(chunk_id, 0.0) + 1.0 / (k + position + 1)
    return sorted(fused, key=fused.get, reverse=True)[:top_k]
```

Building the BM25 index on every call keeps the example short. In anything beyond a notebook, build it once alongside the vector matrix. The constant `k = 60` is the value commonly used for reciprocal rank fusion. Tune it against your hit-rate numbers if you like, but it rarely changes much.

## When to stop using this

This prototype has clear limits, and I'd move off it when any of these become true:

| Signal | What it means |
|---|---|
| More than a few hundred thousand chunks | Brute force is still correct, but memory and latency start to hurt. Look at an approximate nearest neighbour library such as [FAISS](https://github.com/facebookresearch/faiss) or a managed vector store. |
| Content changes hourly | Re-embedding and reloading a file is now a pipeline problem. You need incremental updates and deletes. |
| Multiple app instances | Each process holding its own copy of the matrix gets wasteful and drifts out of sync. |
| Security trimming per user | Metadata filters in Python are not access control. You need the index to enforce it. |

On the Azure side, it's worth knowing what [Azure Cognitive Search's semantic search](https://learn.microsoft.com/azure/search/semantic-search-overview) is and isn't. It's in preview, and it re-ranks keyword results using Microsoft's own language models. It doesn't take your Azure OpenAI vectors. That makes it a strong option if you already run Cognitive Search and mostly want better ranking, with no embedding pipeline to maintain. It doesn't replace this prototype if you want to search your own vectors. For that, the options today are libraries like FAISS or dedicated vector databases such as Pinecone, Weaviate, Milvus and Qdrant.

## What I'd do this week

Pick one corpus that users complain about. Chunk it, embed it with whichever model your Azure OpenAI resource offers, and keep the source text and the model name next to the vectors. Write 30 labelled queries and compare hit rate@5 against your current search. Add BM25 fusion if your content is full of identifiers. If the numbers justify it, then choose a vector store, knowing exactly what you need from it. Microsoft's [models page](https://learn.microsoft.com/azure/ai-services/openai/concepts/models) lists the embedding models, their dimensions and regions, and the [embeddings concept page](https://learn.microsoft.com/azure/ai-services/openai/concepts/understand-embeddings) explains how to compare the vectors.
