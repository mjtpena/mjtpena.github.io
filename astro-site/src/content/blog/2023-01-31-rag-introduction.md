---
title: "RAG on Azure OpenAI: Grounding GPT-3 Answers in Your Own Documents"
description: "What retrieval augmented generation is, why it beats fine-tuning for company knowledge, and a minimal loop on Azure OpenAI completions in January 2023."
author: Michael John Peña
draft: false
date: 2023-01-31
tags:
  - Azure OpenAI
  - RAG
  - Embeddings
  - Python
  - Architecture
---

Ask `text-davinci-003` about your company's refund policy and it will give you a confident, well-written answer that has nothing to do with your company. The model only knows what was in its training data, and when it doesn't know it tends to invent something plausible rather than say so. The first follow-up question after almost any GPT-3 demo to a business stakeholder is the same: "can it answer from *our* documents?" The pattern that makes that work is retrieval augmented generation, and it is less exotic than the name suggests.

It builds on the posts on [embeddings](/blog/2023-01-23-embeddings-introduction/) and [semantic search](/blog/2023-01-24-semantic-search-embeddings/); the follow-ups go deeper on [architecture patterns](/blog/2023-02-01-rag-architecture-patterns/), [chunking](/blog/2023-02-02-document-chunking-strategies/) and [re-ranking](/blog/2023-02-05-reranking-results/).

## What RAG actually is

The term comes from a 2020 paper by Patrick Lewis and colleagues at Facebook AI Research, [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401). They trained a retriever and a generator together. What most of us mean by RAG today is looser and much easier to build: you don't train anything. At question time you search your own content, paste the most relevant passages into the prompt, and tell the model to answer from those passages only.

The flow has two halves:

1. **Indexing (offline).** Split documents into chunks, embed each chunk, and store the vectors next to the original text.
2. **Answering (per request).** Embed the question, find the closest chunks, build a prompt that contains them, and send it to a completion model.

The model's job changes. It is no longer the source of facts; it is a reader and writer that summarises what you handed it. That is a job GPT-3 is very good at, and it is far easier to check.

## Why not fine-tune instead?

This is the first question I get, because "train it on our data" sounds like the obvious answer. For knowledge questions it is usually the wrong one.

| Concern | Fine-tuning | Retrieval augmented generation |
|---|---|---|
| Content changes weekly | Retrain and redeploy | Re-embed the changed documents |
| "Where did that answer come from?" | You can't tell | The prompt contains the sources, so you can cite them |
| Document-level permissions | Baked into the weights for everyone | Filter what you retrieve per user |
| Teaching tone, format or a narrow task | Good fit | Possible with examples, but prompt space is limited |
| Facts the model must recall | Unreliable; it still makes things up | The facts are in the prompt |

Fine-tuning changes *how* a model responds. It is a poor way to store facts, because you can't update one policy without another training run, and you can't stop the model blending what it learned with what it already "knew". RAG keeps your knowledge in a store you control and can audit. Use fine-tuning when the problem is behaviour, not knowledge.

## The constraints you're designing around in January 2023

The design of a RAG system right now is shaped by a few hard limits on Azure OpenAI, which went [generally available](/blog/2023-01-20-azure-openai-service-ga/) on 16 January.

- **There is no chat API.** You build the prompt as one string and call the completions endpoint. Instructions, sources and question all live in that one prompt, as covered in [instruction preambles](/blog/2023-01-15-system-prompts-azure-openai/).
- **The context window is small.** `text-davinci-003` and `text-davinci-002` accept about 4,097 tokens, shared between the prompt and the answer. Reserve 400 tokens for the answer and you have room for perhaps six or seven 500-token chunks plus instructions. Retrieval quality matters more than anything else, because you can't afford to send ten "maybe relevant" passages.
- **Model availability varies.** `text-davinci-003` is rolling out region by region, so check the [models page](https://learn.microsoft.com/azure/ai-foundry/openai/concepts/models) and your deployments before you design around it. `text-davinci-002` works for this pattern too, with somewhat weaker instruction-following. The same goes for `text-embedding-ada-002`: if your resource doesn't offer it, the first-generation `text-search-ada-doc-001` and `-query-001` pair works with two deployments.
- **There is no managed vector search on Azure.** [Azure Cognitive Search can't query vectors](/blog/2023-01-30-azure-cognitive-search-vectors/) yet. For a first build, a NumPy matrix in memory is enough.

## A minimal RAG loop

This uses the `openai` 0.26 Python library in Azure mode with API version `2022-12-01`, configured as in [the Python setup post](/blog/2023-01-18-azure-openai-python-sdk/), plus `tiktoken` to count tokens. It assumes a `text-embedding-ada-002` deployment and a `text-davinci-003` (or `-002`) deployment. Install with `pip install "openai==0.26.4" tiktoken numpy` and save it as `rag_minimal.py`.

```python
import os
from typing import Dict, List, Tuple

import numpy as np
import openai
import tiktoken

openai.api_type = "azure"
openai.api_base = "https://<your-resource-name>.openai.azure.com/"
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

EMBEDDING_DEPLOYMENT = "<your-ada-002-deployment>"
COMPLETION_DEPLOYMENT = "<your-davinci-003-deployment>"

CONTEXT_WINDOW = 4097   # text-davinci-003 and text-davinci-002
ANSWER_TOKENS = 400
COMPLETION_ENCODING = tiktoken.get_encoding("p50k_base")

INSTRUCTIONS = (
    "Answer the question using only the sources below. "
    "Cite the source id in square brackets after each fact, for example [refunds]. "
    "If the sources do not contain the answer, reply exactly: I don't know.\n\n"
)


def embed(text: str) -> np.ndarray:
    # Azure OpenAI takes one input per embeddings request.
    response = openai.Embedding.create(engine=EMBEDDING_DEPLOYMENT, input=text.replace("\n", " "))
    vector = np.array(response["data"][0]["embedding"], dtype=np.float32)
    return vector / np.linalg.norm(vector)


class KnowledgeBase:
    def __init__(self, chunks: Dict[str, str]) -> None:
        self.ids = list(chunks)
        self.texts = [chunks[i] for i in self.ids]
        self.matrix = np.vstack([embed(t) for t in self.texts])

    def search(self, question: str, top_k: int = 10) -> List[Tuple[str, str, float]]:
        scores = self.matrix @ embed(question)
        best = np.argsort(-scores)[:top_k]
        return [(self.ids[i], self.texts[i], float(scores[i])) for i in best]


def build_prompt(question: str, hits: List[Tuple[str, str, float]]) -> Tuple[str, List[str]]:
    tail = f"Question: {question}\nAnswer:"
    budget = CONTEXT_WINDOW - ANSWER_TOKENS - len(COMPLETION_ENCODING.encode(INSTRUCTIONS + tail))
    sources, used = "", []
    for chunk_id, text, _score in hits:
        block = f"[{chunk_id}]\n{text}\n\n"
        cost = len(COMPLETION_ENCODING.encode(block))
        if cost > budget:
            break
        sources += block
        budget -= cost
        used.append(chunk_id)
    return INSTRUCTIONS + "Sources:\n" + sources + tail, used


def answer(kb: KnowledgeBase, question: str) -> Dict[str, object]:
    prompt, used = build_prompt(question, kb.search(question))
    response = openai.Completion.create(
        engine=COMPLETION_DEPLOYMENT,
        prompt=prompt,
        max_tokens=ANSWER_TOKENS,
        temperature=0,
        stop=["\nQuestion:"],  # stop davinci writing the next Question/Answer pair
        request_timeout=30,
    )
    return {"answer": response["choices"][0]["text"].strip(), "sources": used}


if __name__ == "__main__":
    kb = KnowledgeBase({
        "refunds": "Customers can request a full refund within 30 days of purchase. "
                   "After 30 days we offer store credit instead.",
        "shipping": "Shipping is free for orders over $50. Standard shipping takes 5 to 7 "
                    "business days. Express shipping costs $15.",
        "tracking": "To track an order, sign in and open the Orders page. Tracking numbers "
                    "appear once an item has shipped.",
    })
    for q in ["Can I get my money back after six weeks?", "Do you ship to Antarctica?"]:
        result = answer(kb, q)
        print(q, "->", result["answer"], result["sources"])
```

The second question is the one to watch. None of the sources mention destinations, so a well-grounded answer is "I don't know". If you get a confident answer about Antarctic shipping instead, your instructions aren't strong enough for the model you deployed, and that's worth knowing before a user finds it.

## The decisions that matter in that code

**Temperature 0.** For grounded answers you want the most likely reading of the sources, not creative variation. Save higher temperatures for drafting tasks; I covered what they actually change in [temperature and top-p](/blog/2023-01-16-temperature-top-p-parameters/).

**A token budget on top of `top_k`.** `top_k=10` only sets the candidate pool, ranked by similarity; the token budget decides how many of those candidates actually reach the prompt. Chunks vary in length, and an over-length prompt is rejected outright. Counting with the model's own encoding (`p50k_base` for the Davinci completion models) and stopping when the budget runs out means the request always fits. It also means a long chunk can crowd out a better one, which is a good argument for keeping chunks of similar size.

**A stop sequence and a timeout.** With a "Question: ... Answer:" template, davinci will happily invent the next question and answer it too, so `stop=["\nQuestion:"]` ends the completion where your answer ends. `request_timeout` keeps a slow call from hanging the request; retries are left out here, and [the Python setup post](/blog/2023-01-18-azure-openai-python-sdk/) covers them.

**Source ids in the prompt.** Labelling each chunk and asking for citations gives users something to check and gives you something to evaluate. GPT-3 won't cite perfectly every time, so verify that cited ids exist in the `sources` list before showing them as links.

**An explicit refusal string.** "Reply exactly: I don't know" gives your application a value it can detect and handle, for example by offering a search results page or a human contact. Vague instructions like "don't make things up" are much weaker.

**No similarity threshold.** A common shortcut is to drop chunks below a cosine score of 0.7. With [ada-002](https://openai.com/blog/new-and-improved-embedding-model) that cut-off is meaningless, because its scores sit in a narrow band and unrelated text often scores around 0.7; embed a few pairs of unrelated sentences and compare them to see it for yourself. If you want a threshold, derive it from labelled queries on your own content.

## Where it goes wrong

Most RAG failures are retrieval failures that look like generation failures. The model answers badly because it was handed the wrong passages, or the right passage was split across two chunks. Before you tune prompts, log the retrieved chunk ids for every question and check them by hand. If the right text isn't in the prompt, no instruction will fix the answer.

The other failure modes are worth naming up front:

- **Exact identifiers.** Embeddings blur `ERR-4012` and `ERR-4021`. If users ask about product codes, add keyword search alongside the vectors.
- **Questions that need the whole corpus.** "How many policies mention contractors?" can't be answered from a handful of chunks. That is a reporting query, not a RAG query.
- **Permissions.** If two users shouldn't see the same documents, filter at retrieval time. Once a passage is in the prompt, the model will happily repeat it.
- **Prompt injection through content.** Retrieved text is untrusted input. A document that says "ignore previous instructions" ends up in your prompt verbatim.

## When not to use RAG

Skip it when the answer lives in a database, not a document; a SQL query is more accurate and cheaper than a language model reading rows. Skip it when your content is small and stable enough to fit in the prompt every time. And skip it when nobody will act on "I don't know", because a RAG system that is right 85% of the time still needs a fallback for the other 15%.

## Where I'd start

Pick one bounded corpus with a clear owner, such as an HR policy set or a product FAQ. Build the loop above, then write 30 real questions with the answers you expect, including a handful that the content can't answer. Measure two things separately: did retrieval return the right chunk, and did the model answer faithfully from it? Fix retrieval first. Once those numbers are stable, the production concerns in [the architecture patterns post](/blog/2023-02-01-rag-architecture-patterns/) are worth the effort. Until then, keep it to a few dozen lines you can reason about.
