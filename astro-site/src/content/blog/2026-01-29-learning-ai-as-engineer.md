---
title: "Learning AI Without a PhD: What Transfers From Cloud Engineering"
description: "How I moved from cloud and data engineering into AI work without a maths degree: what I learnt in which order, what I skipped, and where engineers go wrong."
author: Michael John Peña
draft: false
date: 2026-01-29
tags:
  - AI
  - Career
  - Azure OpenAI
  - LLM
---

Three years ago I was a cloud and data engineer, and AI was "something other people do". Today it's a core part of my work. Many engineers are where I was: they assume the door is closed without a maths PhD, so they wait. That assumption is wrong for anyone building applications on top of models rather than training them.

This is the path that worked for me, what I deliberately ignored, and where I think an experienced engineer should spend their limited learning hours.

## The skills I thought I needed

When I started, my mental checklist looked like a university syllabus:

- A deep maths background (linear algebra, calculus, probability)
- Machine learning expertise: training, loss functions, hyperparameters
- The ability to read research papers comfortably
- A real understanding of how neural networks work

None of that is useless. But it describes the job of someone who *builds* models. Most of the AI work in organisations right now is *applying* models someone else trained, behind an API, inside a system that has to be secure, observable and affordable. That's a different job, and it's much closer to the one I already had.

## The skills I actually needed

| What I needed | Did I already have it? |
|---|---|
| Calling APIs, handling auth, retries and timeouts | Yes, from years of cloud integration work |
| Understanding what models can and can't do | No, and this took the most deliberate practice |
| Prompt engineering | Partly: it's mostly clear, specific written communication |
| System design: data flow, caching, failure modes | Yes, and it carries over almost unchanged |
| Measuring quality of non-deterministic output | No, and most engineers underinvest here |

The two "no" rows are where the real learning was. The capabilities-and-limits row is the one I'd stress. Knowing that a model will confidently invent an answer when the context doesn't contain one, or that output quality drifts when you change a prompt you thought was harmless, changes how you design everything around it. The limits I'd probe early, on purpose: what happens as you approach the model's context window, what it says when retrieval comes back empty (it rarely says "I don't know" unless you tell it to), how much the same prompt varies across runs and across model versions, and how reliably it calls a tool with the right arguments. Each of those is a ten-minute experiment, and each one shows up later as a production bug if you skip it.

## The learning path that worked

I didn't plan this as a curriculum. Looking back, it fell into four phases, and the order mattered. The durations are what it took me learning part-time alongside a day job, not a target; the sequence is the part I'd keep.

### Months 1–2: intuition from small builds

I built simple ChatGPT-style integrations, experimented with prompts, and made plenty of mistakes. The goal of this phase isn't to build anything useful. It's to develop intuition for how a model responds to instructions, examples and missing context. You can't get that from reading alone; every concept in this post only stuck once I'd built something that used it. If you want structure, Microsoft Learn's [Develop generative AI apps in Azure](https://learn.microsoft.com/training/paths/get-started-azure-ai) path gives you a guided set of hands-on exercises, and the Azure OpenAI [prompt engineering techniques](https://learn.microsoft.com/azure/foundry/openai/concepts/prompt-engineering) page is the best short reference for why the same question phrased two ways gets two different answers.

Two habits from this phase paid off later. First, stay simple: basic completions, then retrieval, then tools, and no agents on day one. Second, keep your bad prompts. Every prompt that produced a wrong or odd answer tells you something about how the model reads instructions, and it becomes a ready-made test case in phase four.

### Months 3–4: embeddings, retrieval and tokens

This is where I learnt about embeddings, built a basic retrieval-augmented generation (RAG) system, and finally understood tokens and what they cost. RAG is worth building by hand once, even if you later use a managed service, because it shows you that most "the model got it wrong" problems are really "retrieval handed it the wrong chunks" problems. Microsoft's [RAG overview for Azure AI Search](https://learn.microsoft.com/azure/search/retrieval-augmented-generation-overview) is a good map of the moving parts.

Tokens deserve their own mention. Once you see that cost and latency scale with prompt length, you start designing differently: shorter system prompts, fewer retrieved chunks, and caching where it's safe.

### Months 5–6: production engineering around the model

Error handling, cost optimisation, monitoring and observability. This is the phase where my existing engineering background paid off most. Rate limits, transient failures, timeouts, logging the right context without logging sensitive data: none of it is new. It just has a model at the centre instead of a database.

This is also when you start getting stuck on things documentation doesn't answer, so learn to ask well. Post service questions on Microsoft Q&A, and SDK bugs as GitHub issues on the SDK you're using (the `openai-python` or `azure-sdk-for-python` repositories, for example). What makes a question answerable is the detail: the exact request you sent, the full error or the usage output, the deployment name, model and model version, and the package versions. A question with those details is far more likely to get a useful answer than "the model gives bad answers".

### Months 7–12: evaluation first, then agents and fine-tuning

Agent systems, fine-tuning and evaluation frameworks. My honest view after working through all three: evaluation is the one to prioritise. Fine-tuning is rarely the first answer to a quality problem; better prompts, better retrieval and better test data usually get you further for less. Agents are powerful but multiply the failure modes, so they're the last thing I'd reach for, not the first. Evaluation is what lets you make either decision with evidence instead of impressions.

You don't need a framework to start. Collect 20–50 real questions with the answers you expect, including the bad prompts you kept from phase one. Rerun the whole set after every prompt change and every retrieval change, and score each answer for groundedness (is it supported by the retrieved context?) and relevance (does it answer the question?). A spreadsheet and an hour of reading answers will teach you more than an evaluation SDK you don't yet understand; reach for the tooling once the set is too big to read by hand. Evaluation also has its own running cost: automated scoring usually means an LLM-as-judge, and every judged answer is another model call that consumes tokens, so a 50-question set rerun on every change adds up. That's another reason to start small and by hand. Microsoft Foundry's [observability guidance](https://learn.microsoft.com/azure/foundry/concepts/observability) covers evaluation across the whole lifecycle, from base model selection to production monitoring, which is the right mental model. I wrote about where different kinds of tests belong in [Testing AI Systems: Which Tests Run Where, and Why](/blog/2026-01-21-ai-testing-strategies/).

## Start with the API, not the framework

The advice I'd give most strongly: start with the raw OpenAI or Azure OpenAI API before you adopt an orchestration framework. Frameworks are useful once you know what they're abstracting. Before that, they hide the very things you need to learn: what the request looks like, what the model actually received, and what the usage numbers were.

As of early 2026, Azure OpenAI's [v1 API](https://learn.microsoft.com/azure/foundry/openai/api-version-lifecycle) lets you use the standard `OpenAI()` client against an Azure endpoint without pinning a dated `api-version`. A first call with Microsoft Entra ID authentication looks like this (it needs `azure-identity` and `openai` 1.106.0 or later, the first release that accepts a callable such as a token provider as `api_key`):

```python
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import OpenAI

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(),
    # Either scope works for an Azure OpenAI resource; current docs show "https://ai.azure.com/.default".
    "https://cognitiveservices.azure.com/.default",
)

client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=token_provider,
    # Your existing engineering habits belong here: bound every call and retry transient failures.
    timeout=30,
    max_retries=3,
)

response = client.chat.completions.create(
    model="<your-deployment-name>",
    messages=[
        {"role": "system", "content": "Answer in two sentences. Say 'I don't know' if unsure."},
        {"role": "user", "content": "What is a token in the context of language models?"},
    ],
)

print(response.choices[0].message.content)
print(response.usage)
```

I've used Chat Completions here because the messages format is the easiest to learn first and it's still fully supported. Microsoft's v1 API documentation now recommends the Responses API (`client.responses.create`) for new Azure OpenAI work, so once the basics click, move to it.

That last line is the point. Print the usage on every call while you're learning. It's the fastest way to build an instinct for cost.

## What I ignored, and whether I'd ignore it again

**Mathematical foundations.** I didn't need to understand backpropagation to build with LLMs. I'd make the same call again for application work. If you move into training or deep model optimisation, that changes.

**Research papers.** For applied work I found them too theoretical and focused on practical tutorials and documentation instead. The one adjustment I'd make: skim the abstract and results of papers that a product you depend on cites. It tells you what the technique is good and bad at.

**Perfect understanding.** I started building before I felt ready and learnt by doing. That's still the right default. Waiting until you understand everything means never starting, because the models and APIs change faster than any study plan.

## When this path doesn't fit

This advice is for engineers building AI into products and platforms. It isn't a route into ML research, model training, or roles where you're accountable for how a model was built. For those, the maths and the papers are the job, and skipping them would be a mistake. Be honest with yourself about which kind of role you want before you choose what to skip.

## The decision

If you're a solid engineer, you already have most of what applied AI work needs: API integration, system design and debugging transfer directly. What you need to add is a working sense of model capabilities and limits, and the discipline to measure quality instead of eyeballing it.

Good AI systems need good software engineering, and that's your advantage. The AI part is learnable. The engineering discipline is harder to teach. Pick a small problem this week, call a model directly, print the usage, and build from there.
