---
title: "Enterprise AI in 2024: Five Bets Against What Is GA on Azure"
description: "Five enterprise AI bets for 2024, each checked against what is generally available or still in preview on Azure as of 1 January 2024."
author: Michael John Peña
draft: false
date: 2024-01-01
tags:
  - Predictions
  - Enterprise AI
  - Azure OpenAI
  - Azure AI Search
  - Microsoft Fabric
---

Most 2024 prediction lists, mine included, describe where the industry is heading. What they rarely say is which parts of that future you can put into production on 1 January, and which parts are still a preview feature with no SLA. That gap matters more than the predictions do, because it decides what goes into this year's budget and what stays in the lab.

I've already written broader takes in [2024 Predictions: The Year Ahead in AI and Data](/blog/2023-12-26-2024-predictions-ai/) and [AI Trends to Watch in 2024](/blog/2023-12-27-ai-trends-to-watch/). This post is narrower: five bets for enterprise teams building on Microsoft, each one checked against what is actually shipped today.

## Where things stand on 1 January 2024

A quick status check, because the November and December announcements blurred the line between "announced" and "available":

| Capability | Status on 1 Jan 2024 |
|---|---|
| Microsoft Fabric | GA (announced at Ignite, 15 Nov 2023) |
| Copilot in Fabric | Public preview (staged rollout; F64/P1 capacity and above) |
| Data Activator (Fabric) | Public preview |
| Azure AI Search vector search and semantic ranker | GA (REST API `2023-11-01`) |
| Azure AI Search integrated vectorisation | Public preview |
| GPT-4 Turbo (`1106-preview`) on Azure OpenAI | Preview model version |
| GPT-4 Turbo with Vision on Azure OpenAI | Public preview (December 2023) |
| Assistants API | OpenAI platform only, in beta; not on Azure OpenAI yet |
| Azure AI Studio | Public preview |
| Semantic Kernel for .NET | v1.0.1, first stable release (18 Dec 2023) |
| Copilot for Microsoft 365 | GA for enterprise customers since 1 Nov 2023 |

The pattern is clear. The data and retrieval layers are GA. The model layer you'd most want to use (GPT-4 Turbo, vision) is still preview on Azure. The orchestration layer is either brand new (Semantic Kernel 1.0.1) or not on Azure at all (Assistants). Plan accordingly. The sources for these are the [Azure OpenAI what's new page](https://learn.microsoft.com/azure/ai-services/openai/whats-new) and the [Azure AI Search what's new page](https://learn.microsoft.com/azure/search/whats-new).

## Bet 1: Agents arrive, but as narrow tool-calling loops

Everyone expects 2024 to be the year of agents. I agree, with a caveat: the agents that reach production this year will be small, bounded loops where a model chooses between three to ten well-defined tools, not open-ended autonomous systems.

The building blocks are real. Parallel tool calling arrived with the `1106` model versions, and Azure OpenAI exposes it through the `2023-12-01-preview` API version. Microsoft shipped [Semantic Kernel 1.0.1 for .NET](https://devblogs.microsoft.com/semantic-kernel/semantic-kernel-v1-0-1-has-arrived-to-help-you-build-agents/) on 18 December with automatic function calling. AutoGen from Microsoft Research is the most interesting multi-agent framework I've looked at, and LangChain is still pre-1.0 and changing fast.

What isn't there yet is the operational layer. There's no Azure equivalent of the Assistants API, so you own conversation state, retries, and tool execution. That's fine. Owning the loop is how you learn where it breaks, and it means the guardrails are yours to set. Three I'd put in from day one: a hard cap on iterations per request (five is plenty for most tasks), an allow-list of tools scoped to the request rather than the whole catalogue, and human approval before any tool that writes, sends, or deletes. A loop that can only read and has to stop after five turns is cheap to get wrong.

When *not* to build an agent: if the steps are known in advance, write a workflow. A Logic App or a Durable Function that calls a model at fixed points is cheaper, testable, and auditable. Reach for a model-driven loop only when the order of steps genuinely depends on the input.

## Bet 2: RAG stops being a demo and becomes a retrieval problem

Retrieval-augmented generation is now the default pattern for "chat with our documents". The 2024 shift is that teams will stop treating it as a prompt problem and start treating it as a search-relevance problem, because that's where the bad answers come from.

This is the area where the GA story is strongest. Vector search and semantic ranker both went GA in Azure AI Search in November, so a hybrid query (keyword plus vector, re-ranked semantically) is a supported production pattern today. Microsoft's [published relevance testing](https://techcommunity.microsoft.com/t5/ai-azure-ai-services-blog/azure-cognitive-search-outperforming-vector-search-with-hybrid/ba-p/3929167) showed hybrid retrieval with semantic ranking beating pure vector search across their test sets, which matches what I'd expect from mixed enterprise content full of product codes and acronyms that embeddings handle badly.

Here's the query pattern using `azure-search-documents` 11.4.0 (GA) and `openai` 1.x. It assumes an existing index with a `content_vector` field and a semantic configuration.

```python
import os

from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery
from openai import AzureOpenAI

openai_client = AzureOpenAI(
    azure_endpoint="https://<your-openai-resource>.openai.azure.com",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version="2023-05-15",
)

search_client = SearchClient(
    endpoint="https://<your-search-service>.search.windows.net",
    index_name="<your-index-name>",
    credential=AzureKeyCredential(os.environ["AZURE_SEARCH_API_KEY"]),
)


def hybrid_search(query: str, k: int = 5) -> list[dict]:
    embedding = openai_client.embeddings.create(
        model="<your-ada-002-deployment>",
        input=query,
    ).data[0].embedding

    results = search_client.search(
        search_text=query,
        vector_queries=[
            VectorizedQuery(vector=embedding, k_nearest_neighbors=50, fields="content_vector")
        ],
        query_type="semantic",
        semantic_configuration_name="<your-semantic-config>",
        select=["title", "content"],
        top=k,
    )

    return [
        {
            "title": r["title"],
            "content": r["content"],
            # None if the semantic ranker didn't run (e.g. a throttling fallback)
            "reranker_score": r.get("@search.reranker_score"),
        }
        for r in results
    ]


if __name__ == "__main__":
    for hit in hybrid_search("What is our parental leave policy?"):
        print(round(hit["reranker_score"] or 0, 2), hit["title"])
```

Two decisions in that snippet are deliberate. I ask the vector query for 50 neighbours even though I only want five results, because the semantic ranker can only re-rank what it's given. And I generate the embedding client-side, because integrated vectorisation, which would do this inside the service, is still preview.

When *not* to use RAG: if the answer lives in a structured system (an ERP, a data warehouse), retrieving text chunks about it is the wrong tool. Query the system and let the model summarise the result.

## Bet 3: Multimodal moves into document pipelines first

GPT-4 Turbo with Vision reached public preview on Azure OpenAI in December. The first serious enterprise use won't be chatbots that look at photos. It will be document processing: forms, invoices, and scanned PDFs where layout carries meaning.

My position is that vision models will complement Azure AI Document Intelligence rather than replace it this year. Document Intelligence gives you deterministic field extraction, confidence scores, and a GA SLA. A vision model gives you flexible reasoning over messy layouts, with no confidence score and preview status. A sensible 2024 pipeline uses Document Intelligence for extraction and a language model for the judgement calls that follow, such as "does this invoice match the purchase order?".

When *not* to use a vision model: anything where you need repeatable, auditable field values. Preview models can change behaviour between versions, and finance teams don't accept "the model read it differently this week".

## Bet 4: Cost moves from the pilot budget to the P&L

In 2023, most generative AI spend sat in innovation budgets that nobody scrutinised. In 2024 the successful pilots become products, and someone in finance will ask what each conversation costs.

The price gap between models is the lever. At [OpenAI's DevDay](https://openai.com/blog/new-models-and-developer-products-announced-at-devday) in November, GPT-4 Turbo was priced at a third of GPT-4's input price and half its output price, and GPT-3.5 Turbo is cheaper again by an order of magnitude. Routing simple requests to a smaller model is the single biggest saving available, and it's an architecture decision you make early, not a tuning exercise you bolt on later.

Practical moves for this year:

- **Log tokens per request with a business identifier** (tenant, product, use case). Azure Monitor gives you totals per deployment; it doesn't tell you which feature burned them.
- **Separate deployments per workload** so one noisy feature can't exhaust another's tokens-per-minute quota.
- **Trim retrieval context.** In RAG, the retrieved chunks usually dominate input tokens. Five good chunks beat twenty mediocre ones on both cost and answer quality.

When *not* to optimise: before you have a product people use. Optimising a pilot's token spend is premature; measure first.

## Bet 5: Governance becomes a delivery requirement, not a slide

Two things changed in December. The EU reached a provisional political agreement on the AI Act on 8 December, and Copilot for Microsoft 365 has been GA long enough that security teams are discovering how much oversharing exists in SharePoint permissions. Both push governance from a policy document to an engineering task.

For Azure teams, that means content filtering configuration, prompt and response logging with clear retention rules, and Microsoft Purview sensitivity labels that actually reflect the data. The Copilot point is worth stressing: Copilot respects existing permissions, so it will surface anything a user can already technically open. Fixing permissions is a prerequisite, not a Copilot problem.

On Fabric, the same discipline applies. Fabric is GA and OneLake makes data far easier to share across workspaces. Easier sharing without domains, endorsement, and workspace roles set up properly is how you end up feeding the wrong data to a model.

## What I'd commit to in Q1

If I had to pick where to spend the first quarter, it would be in this order:

1. **Build retrieval on GA pieces.** Hybrid search with semantic ranker is production-ready. Get relevance right before touching agents.
2. **Prototype agents, don't ship them broadly.** Keep tool sets small and wait for the orchestration layer on Azure to mature.
3. **Instrument cost per use case now**, while volumes are low and changes are cheap.
4. **Treat preview as preview.** GPT-4 Turbo, vision, Copilot in Fabric and integrated vectorisation are worth evaluating. Don't put them on a critical path with a contractual SLA until they go GA.

Put a GA/preview column in your 2024 roadmap and make every line item fill it in.
