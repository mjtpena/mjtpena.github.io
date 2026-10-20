---
title: "Fine-Tuning or RAG? Decide by the Failure You're Fixing"
description: "Fine-tuning and RAG fix different failures. How to tell which one you have on Microsoft Foundry in early 2026, what each costs, and when to combine them."
author: Michael John Peña
draft: false
date: 2026-02-20
tags:
  - RAG
  - Fine-Tuning
  - Microsoft Foundry
  - Azure OpenAI
  - Architecture
---

"Should we fine-tune or use RAG?" is usually the wrong question, because the two techniques fix different failures. RAG fixes a model that doesn't *know* something. Fine-tuning fixes a model that knows enough but doesn't *behave* the way you need. Teams that skip that diagnosis pick based on whichever one they read about last, and they end up paying for training runs that don't fix their real problem, or building retrieval pipelines for problems that were never about knowledge.

My rule of thumb: name the failure first, then pick the tool. Here is how I'd make that call on Microsoft Foundry as it stands in February 2026.

## What has actually changed

The old advice was "RAG first, fine-tune almost never", and for most knowledge problems it still holds. Three things have moved the line, though.

**Long context weakened the case for *simple* RAG, not for retrieval.** GPT-4.1 accepts up to about a million tokens of input on Global Standard deployments (128,000 on regional Standard and provisioned deployments), per the [Foundry models table](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure). For a small, stable corpus (a 40-page policy manual, one product's API reference) you can often put the whole thing in the prompt and skip the vector index. That stops working when the corpus is large, changes daily, or needs per-user security trimming. It also means you pay for every one of those tokens on every call, and models still lose track of details buried in very long contexts. Long context is a reason to question a *small* RAG system. It is not a reason to drop retrieval at scale.

**Fine-tuning on Azure has more than one technique now.** Foundry supports supervised fine-tuning (SFT) on the GPT-4.1 family and GPT-4o models, direct preference optimisation (DPO, still in preview) on GPT-4o, GPT-4.1 and GPT-4.1-mini, and [reinforcement fine-tuning (RFT)](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reinforcement-fine-tuning) on o4-mini, which is now generally available. RFT on GPT-5 is in private preview. Serverless SFT on a few open-weight models is in public preview too. The [supported models table in the fine-tuning overview](https://learn.microsoft.com/en-us/azure/foundry/fine-tuning/overview#supported-models) lists which model supports which technique, and at what release status. Check it before you plan anything, because that matrix keeps changing.

**Retrieval is becoming a managed service.** Azure AI Search's agentic retrieval and knowledge bases (still in preview) plan queries, run subqueries and merge the results for you. That makes good RAG cheaper to build, which raises the bar for fine-tuning even further. I covered when to hand the pipeline over in [Agentic Retrieval or a Hand-Built RAG Pipeline?](/blog/2026-02-02-rag-systems-that-work/).

## Diagnose the failure first

Before you choose anything, take 50 to 100 bad outputs from your current system and sort them. Nearly all of them fall into one of these groups:

| Failure you observe | Root cause | Fix |
|---|---|---|
| Wrong or outdated facts, made-up policy details | Model lacks the knowledge | RAG |
| Right documents exist but the answer ignores them | Retrieval miss or poor ranking | Better retrieval (hybrid search, reranking, chunking) |
| Correct facts, wrong format or tone | Behaviour | Prompting first, then SFT |
| Inconsistent labels or extractions across similar inputs | Behaviour on a narrow task | SFT |
| Picks the worse of two acceptable answers | Preference | DPO |
| Multi-step reasoning goes wrong in ways you can grade | Reasoning on a checkable task | RFT |
| Good quality but too slow or too expensive | Model size | Distil into a smaller fine-tuned model |

The second row is the one teams misdiagnose most. If the right chunk was never retrieved, a fine-tuned model won't save you, because it can't cite a document it never saw. Fix retrieval first. [Seven RAG Failure Modes](/blog/2026-01-07-rag-patterns-production/) walks through those fixes.

## When RAG is the right answer

**The knowledge changes.** Policies, prices, product catalogues and support articles change weekly. Re-indexing a document takes minutes. A training run takes hours, and then you still have to evaluate and redeploy the result.

**You need citations.** Regulated and customer-facing answers need to point at a source. RAG gives you the passage the answer came from. Fine-tuned weights can't point to anything.

**Access differs by user.** Security trimming at query time is a retrieval feature. You can't fine-tune a model so that it knows only what the current user is allowed to see.

**You don't have training data.** Fine-tuning needs hundreds of good examples, ideally more. Plenty of organisations have the documents but not the curated question-and-answer pairs.

## When fine-tuning earns its cost

**Format and style have to be exact, at volume.** If every output must match a strict schema, house style or classification scheme, and a few-shot prompt gets you to 90% but not 99%, SFT closes that gap and lets you drop the long prompt examples you send on every call.

**The task is narrow and repetitive.** Ticket routing, contract clause extraction and turning text into a domain-specific SQL dialect are good candidates. A fine-tuned GPT-4.1-mini or GPT-4.1-nano on a narrow task can match a larger general model at a fraction of the latency and per-token price, provided you run enough volume to cover the hourly hosting fee (see below).

**You can grade the answer but not easily demonstrate it.** RFT trains against a grader rather than labelled answers. It suits tasks where checking an output is easy but writing perfect examples is hard. It is also the most expensive option to run and the most work to get right. It bills by training hour (plus grader tokens if you use a model grader): core training time for o4-mini is listed at $100 an hour, and a single RFT job pauses at $5,000 so you can decide whether to continue. SFT bills per training token instead (tokens in the dataset times epochs), which typically makes it far cheaper on the same data.

**You want to distil.** Azure OpenAI [stored completions](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/stored-completions) (preview) can capture production traffic from a large model as a dataset. You filter it, evaluate it, and fine-tune a smaller model on the best outputs. This is my favourite route to fine-tuning, because the training data comes from real traffic rather than examples someone invented in a workshop.

## The costs people forget

Training cost is the number everyone looks at. It is rarely the one that hurts.

- **Hosting.** A fine-tuned model on a Standard or Global Standard (preview) deployment carries an hourly hosting charge whether you call it or not: $1.70 an hour at the time of writing, which is roughly $1,240 a month per deployment before you send a single token. A deployment that sits inactive for 15 days is deleted. The model isn't, so you can redeploy it. The [fine-tuning cost management](https://learn.microsoft.com/en-us/azure/foundry/fine-tuning/cost-management) page has the breakdown. For evaluation, the Developer deployment type skips the hosting fee and removes itself after 24 hours, with no SLA or data residency guarantees. I unpacked the idle-deployment trap in [Azure OpenAI Hidden Costs](/blog/2026-01-04-azure-openai-hidden-costs/).
- **Data residency.** Global training is cheaper, but it can copy training data and weights to another region for the run. Developer training (preview) is cheaper again, but runs on pre-emptible capacity. If your data has to stay in a specific geography, use Standard training in an approved region and accept the price.
- **Base model retirement.** A fine-tuned model is tied to its base model version. When that version retires, you retrain, so keep your datasets and training pipeline versioned.
- **Evaluation.** Every retrain needs a regression run against a held-out test set. If you can't afford to build that test set, you can't afford to fine-tune.

RAG has its own running costs: index storage, embedding refreshes, search units and larger prompts. The difference is that those costs scale with usage you can see, while fine-tuning costs often come from things that look idle.

## The hybrid, done properly

The pattern that holds up in production is a fine-tuned model for behaviour plus retrieval for facts. Keep a clean boundary between them. Don't fine-tune facts into the model "as a backup" to retrieval. When the two disagree, you get a confident answer that cites one document and states a fact from a stale training set. Also note that fine-tuned GPT-4.1 models cap input at 128,000 tokens (training examples at 65,536, or 32,768 for nano), so fine-tuning and stuffing the whole corpus into a million-token prompt are mutually exclusive.

The sketch below queries Azure AI Search with a hybrid query, then calls a fine-tuned deployment through the Azure OpenAI v1 endpoint. It uses `openai` 1.106 or later (2.x is current; earlier 1.x releases don't accept a token provider as `api_key`) and `azure-search-documents` 11.6 with Microsoft Entra ID authentication. Your index needs `title`, `content` and `contentVector` fields, with a vectorizer configured on the vector field (integrated vectorization). For `DefaultAzureCredential` to work, the identity running the code needs the **Search Index Data Reader** role on the search service and **Cognitive Services OpenAI User** on the Azure OpenAI or Foundry resource. Because the vectorizer embeds the query on the search side, the search service's managed identity also needs **Cognitive Services OpenAI User** on the resource that hosts the embedding deployment, and the search service must have role-based access enabled.

```python
import os

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizableTextQuery
from openai import OpenAI

credential = DefaultAzureCredential()

search = SearchClient(
    endpoint="https://<your-search-service>.search.windows.net",
    index_name="<your-index>",
    credential=credential,
)

llm = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=get_bearer_token_provider(
        credential, "https://cognitiveservices.azure.com/.default"
    ),
)

# Deployment name of your fine-tuned model, e.g. a GPT-4.1-mini SFT run
FINE_TUNED_DEPLOYMENT = os.environ.get("FT_DEPLOYMENT", "<your-ft-deployment>")


def answer(question: str) -> str:
    results = search.search(
        search_text=question,
        vector_queries=[
            VectorizableTextQuery(
                text=question, k_nearest_neighbors=20, fields="contentVector"
            )
        ],
        select=["title", "content"],
        top=5,
    )
    sources = "\n\n".join(
        f"[{i}] {doc['title']}\n{doc['content']}" for i, doc in enumerate(results, 1)
    )

    response = llm.chat.completions.create(
        model=FINE_TUNED_DEPLOYMENT,
        messages=[
            {
                "role": "system",
                "content": (
                    "Answer only from the numbered sources. Cite them as [n]. "
                    "If the sources don't contain the answer, say so."
                ),
            },
            {"role": "user", "content": f"Sources:\n{sources}\n\nQuestion: {question}"},
        ],
    )
    # content is None if the response was blocked by a content filter
    return response.choices[0].message.content or ""


if __name__ == "__main__":
    print(answer("What is our refund window for annual plans?"))
```

Notice what the fine-tuned model is *not* asked to do: remember the refund policy. Its training examples should teach it how to answer from sources: the citation format, the tone, and when to refuse. They should never teach the facts. If your SFT dataset includes the retrieved context in each example, the model learns to rely on that context, which is exactly what you want.

## When not to fine-tune at all

Skip fine-tuning if any of these apply:

- You haven't yet tried a strong system prompt with a handful of good examples on a current model.
- You can't describe the failure in one sentence, or you can't measure it.
- Your training data would come mostly from people writing ideal answers by hand. Those datasets are small, expensive and biased towards what the authors think users ask.
- The underlying facts or rules change more often than you're willing to retrain.

## How I'd decide

Start with RAG and a good prompt. Run an evaluation, sort the failures, and fix retrieval before you touch the model. Reach for fine-tuning only when the remaining failures are about behaviour: format, consistency, preference or a checkable reasoning task. Pick the technique that matches the failure (SFT, DPO or RFT), not the newest one. When you do fine-tune, budget for hosting, retraining and evaluation, not just the training run. And if you can't name the failure in one sentence, you aren't ready to spend money on either.
