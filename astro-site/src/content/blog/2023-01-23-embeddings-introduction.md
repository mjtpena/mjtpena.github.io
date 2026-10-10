---
title: "Text Embeddings on Azure OpenAI: What They Are and When to Use Them"
description: "What text embeddings are, which Azure OpenAI embeddings models you can use in January 2023, how to compare vectors, and when embeddings are the wrong tool."
author: Michael John Peña
draft: false
date: 2023-01-23
tags:
  - Azure OpenAI
  - OpenAI
  - Embeddings
  - Python
  - NLP
---

Most of the attention on Azure OpenAI is going to completions, but I expect the embeddings endpoint to do more quiet, useful work inside real systems. Search, deduplication, clustering and "find me the similar ticket" all reduce to the same operation: turn text into a vector, then measure distance. If you get the basics wrong, such as mixing models, comparing the wrong way, or embedding text that is too long, nothing errors. Your results just get worse, and nobody can tell you why.

## What an embedding actually is

An embedding is a fixed-length list of floating-point numbers that a model produces for a piece of text. The model is trained so that texts with similar meaning land close together in that vector space and unrelated texts land far apart. "Reset my password" and "I can't log in" share almost no words, but their vectors sit near each other. That is the whole point: you get similarity on meaning, not on spelling.

Three properties matter in practice:

- **The length is fixed per model.** Every input, from three words to three pages, comes back as the same number of dimensions. A long document gets squeezed into the same space as a short phrase, which is why chunking matters.
- **Vectors are only comparable within one model.** A vector from one model means nothing next to a vector from another. Change models and you re-embed everything.
- **The individual numbers mean nothing on their own.** Dimension 412 isn't "about cloud computing". Only distances between vectors carry information.

## The models you'll meet in January 2023

Azure OpenAI went [generally available on 16 January](/blog/2023-01-20-azure-openai-service-ga/), and the embeddings story is in transition right now.

The first-generation models come in families split by task and size. There are `text-similarity-*-001` models for comparing two texts, and pairs of `text-search-*-doc-001` and `text-search-*-query-001` models for search, where documents and queries go through different models. There are also `code-search-*` models for code. Sizes run from Ada to Davinci, and the vector length grows with the size: 1,024 dimensions for Ada, 4,096 for Curie and 12,288 for Davinci. Microsoft's [Azure OpenAI models page](https://learn.microsoft.com/azure/cognitive-services/openai/concepts/models) lists those dimensions and the regions each model is offered in. The input limit is in the [REST reference](https://learn.microsoft.com/azure/cognitive-services/openai/reference): 2,048 tokens per input.

On 15 December 2022 OpenAI released [`text-embedding-ada-002`](https://openai.com/index/new-and-improved-embedding-model/), which replaces five of those first-generation models (similarity, text search query and doc, and code search) with a single model. It returns 1,536 dimensions, one-eighth the size of Davinci's vectors. On OpenAI's API it accepts inputs up to 8,191 tokens, and OpenAI prices it far below the Davinci-class embedding models. On OpenAI's own API it is the obvious default.

Here is the catch for Azure users: **`text-embedding-ada-002` isn't in the Azure OpenAI model list yet.** The models page lists only the `-001` embeddings models, and the January entry on the [What's new page](https://learn.microsoft.com/azure/cognitive-services/openai/whats-new) covers GA and `text-davinci-003`, not ada-002. Neither page gives a date for it. When it does arrive, don't assume it will carry the same 8,191-token limit as OpenAI's API; check the models page for whatever you actually deploy. My position is simple:

| Situation | What I'd do |
|---|---|
| Building now on Azure OpenAI | Use the `-001` families: `text-search-ada-doc-001` and `text-search-ada-query-001` (or the Curie pair) for search, `text-similarity-*-001` for comparing texts. Keep the source text and plan a re-embed when ada-002 lands. |
| Prototyping on OpenAI's API | Use `text-embedding-ada-002` for everything: similarity, search and code. One model, one vector store. |
| You're tempted by Davinci-001 embeddings for quality | Don't. 12,288 dimensions is eight times the storage and compute per comparison of ada-002 for results that OpenAI's own benchmarks put behind ada-002 on most tasks. |

For a search prototype on Azure today, I'd start with the Ada search pair: 1,024 dimensions and the cheapest per token. Curie's 4,096 dimensions cost more and take four times the storage, which is hard to justify for vectors you expect to replace when ada-002 arrives. The search pair has one rule that trips people up: embed every document with the `-doc` model and every query with the `-query` model. They are two deployments, and using the doc model for queries (or the reverse) quietly degrades ranking. The `text-similarity` models use one model for both sides and suit deduplication and clustering, where there is no query/document split.

## Getting a vector from Azure OpenAI

With the `openai` 0.26 Python library, an embeddings call to Azure looks like a completions call: you point the library at your resource, pin the API version, and pass your deployment name as `engine`. I covered the configuration options in [setting up the openai 0.26 library](/blog/2023-01-18-azure-openai-python-sdk/).

```python
import os
from typing import List

import openai

openai.api_type = "azure"
openai.api_base = "https://<your-resource-name>.openai.azure.com/"
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

EMBEDDING_DEPLOYMENT = "<your-embedding-deployment>"


def get_embedding(text: str, deployment: str = EMBEDDING_DEPLOYMENT) -> List[float]:
    # Newlines can degrade results on the first-generation models; flatten them.
    text = text.replace("\n", " ")
    response = openai.Embedding.create(engine=deployment, input=text)
    return response["data"][0]["embedding"]


if __name__ == "__main__":
    vector = get_embedding("Azure Key Vault stores secrets and certificates")
    print(len(vector))
```

Two Azure-specific details. First, `engine` is the name you gave the deployment, not the model name. If you use a search pair, you need two deployments and two engine names, one for `-doc` and one for `-query`. Second, send one input per request. OpenAI's API accepts an array of inputs, but the [Azure OpenAI REST reference](https://learn.microsoft.com/azure/cognitive-services/openai/reference) currently accepts a maximum array of one, so plan on one string per call. A bulk indexing job then becomes thousands of small requests against your deployment's rate limit, which is why [handling throttling](/blog/2023-01-10-rate-limiting-azure-openai/) matters more for embeddings than for completions.

## Comparing vectors

Cosine similarity is the standard measure. It looks at the angle between two vectors and ignores their length. OpenAI's embeddings are normalised to length 1, so cosine similarity and a plain dot product give the same ranking, and the dot product is cheaper. I still write the cosine version in exploratory code because it stays correct if a vector from somewhere else turns up.

This block is self-contained and uses the search pair: documents go through the `-doc` deployment, the query through the `-query` one.

```python
import os
from typing import List, Tuple

import numpy as np
import openai

openai.api_type = "azure"
openai.api_base = "https://<your-resource-name>.openai.azure.com/"
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

DOC_DEPLOYMENT = "<your-text-search-ada-doc-001-deployment>"
QUERY_DEPLOYMENT = "<your-text-search-ada-query-001-deployment>"


def get_embedding(text: str, deployment: str) -> List[float]:
    # Retry on HTTP 429 is omitted on purpose to keep the demo short.
    text = text.replace("\n", " ")
    response = openai.Embedding.create(engine=deployment, input=text)
    return response["data"][0]["embedding"]


def cosine_similarity(a: List[float], b: List[float]) -> float:
    va, vb = np.array(a), np.array(b)
    return float(np.dot(va, vb) / (np.linalg.norm(va) * np.linalg.norm(vb)))


def rank(
    query: str,
    documents: List[str],
    doc_vectors: List[List[float]],
    query_deployment: str,
) -> List[Tuple[float, str]]:
    query_vector = get_embedding(query, query_deployment)
    scored = [
        (cosine_similarity(query_vector, vector), doc)
        for vector, doc in zip(doc_vectors, documents)
    ]
    return sorted(scored, reverse=True)


if __name__ == "__main__":
    docs = [
        "Azure Functions runs event-driven code without managing servers",
        "Azure SQL Database is a managed relational database",
        "My dog sleeps most of the afternoon",
    ]
    # Embed the documents once with the -doc deployment. A real index stores
    # these vectors rather than recomputing them for every query.
    doc_vectors = [get_embedding(d, DOC_DEPLOYMENT) for d in docs]
    for score, doc in rank("serverless compute", docs, doc_vectors, QUERY_DEPLOYMENT):
        print(f"{score:.3f}  {doc}")
```

With a `text-similarity` model, pass the same deployment for both sides. Production code should also retry on HTTP 429 with backoff, as in the [throttling post](/blog/2023-01-10-rate-limiting-azure-openai/). Expect the Functions sentence to rank first. Expect the scores to be compressed, too. In my experience scores cluster high (unrelated text often lands around 0.7 with ada-002), and the `-001` models have their own range, so the gap between "relevant" and "irrelevant" is narrower than intuition suggests.

That leads to the most common mistake I see: **treating the similarity score as a probability.** A score of 0.82 doesn't mean "82% relevant". Scores are only meaningful relative to other scores from the same model on the same kind of content. If you need a cut-off, for example "treat anything above X as a duplicate", pick X by labelling a few dozen real pairs from your own data and looking at where the scores separate.

## What embeddings are good for

- **Semantic search.** Embed your documents once, embed each query, return the nearest vectors. This is the backbone of the retrieve-then-generate pattern, where you find relevant passages and put them in a completion prompt. I build one end to end in [semantic search with Azure OpenAI embeddings](/blog/2023-01-24-semantic-search-embeddings/).
- **Near-duplicate detection.** Support tickets, product listings and survey responses that say the same thing in different words.
- **Clustering and topic discovery.** Run k-means over the vectors and read a sample from each cluster.
- **Classification with few labels.** Embed a handful of labelled examples per class and assign new text to the nearest class centroid. It's crude, but it often beats nothing when you have twenty examples and no budget to train a model.

## When not to use them

Embeddings are cheap to try, which makes them easy to overuse.

- **Exact matches.** Product codes, error numbers, invoice IDs and people's names are what keyword search was built for. Embeddings blur `ERR-4012` and `ERR-4021` together because they look alike. If users search for identifiers, you need keyword search alongside the vectors, not instead of them.
- **Long documents as a single vector.** A 6,000-token policy document embedded whole becomes an average of everything in it and matches nothing well. Chunk by section or paragraph, and keep a pointer back to the source.
- **Small corpora with good structure.** If your content is 200 well-tagged FAQ entries, a filter and a keyword index may be all you need. Adding a vector store adds a pipeline to keep in sync.
- **Anything needing an explanation.** You can't tell a user or an auditor why two texts scored 0.84. If a decision has to be justified, embeddings can shortlist candidates, but something explainable should make the call.
- **Sensitive text you haven't classified.** Every embedding call sends the text to the service. Treat it like any other Azure OpenAI request for data-handling purposes.

## Operational details that bite later

**Store the model name with every vector.** When you re-embed, and you will, you need to know which vectors came from which model. A `model` column costs nothing and saves you from silently mixing spaces.

**Keep the source text.** Vectors can't be turned back into text. If you only keep vectors, a model change means going back to source systems that may have moved on.

**Mind the storage.** 1,536 32-bit floats is about 6 KB per vector before any index overhead. A million chunks is roughly 6 GB of raw vectors. I compare the storage options in [an introduction to vector databases](/blog/2023-01-25-vector-databases-intro/).

**Count tokens before you send.** Over-length inputs are rejected, not truncated. Check length with `tiktoken` first and chunk anything over the limit of the model you deployed, as covered in [token management](/blog/2023-01-11-token-management-azure-openai/). Use the right tokenizer: ada-002 uses the `cl100k_base` encoding, but the `-001` models use the older GPT-3 tokenizer (`r50k_base` in `tiktoken`), so don't count tokens for them with `cl100k_base`. On Azure today, size chunks to stay under the 2,048-token limit in the REST reference, and re-check the models page when you deploy something new.

## The short version

Use one embedding model per corpus. On Azure OpenAI this month that means a `-001` model, most likely the Ada search pair, with the source text kept so you can re-embed when ada-002 arrives; on OpenAI's API, use ada-002 now. Embed documents and queries with the matching halves of a search pair, send one input per call to Azure OpenAI, and budget for the rate limit. Compare with cosine similarity, and calibrate any threshold on your own data. Chunk long text, keep the original, and record the model that produced each vector. Then be honest about the gaps: embeddings are good at finding meaning and bad at exact identifiers and explanations, so plan for keyword search and human judgement where they matter. Microsoft's [embeddings concept page](https://learn.microsoft.com/azure/cognitive-services/openai/concepts/understand-embeddings) is a good short read on the Azure side.
