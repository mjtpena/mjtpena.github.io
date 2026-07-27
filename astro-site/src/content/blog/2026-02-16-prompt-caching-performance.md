---
title: "Prompt Caching: The Performance Win Nobody Talks About"
author: Michael John Peña
draft: false
date: 2026-02-16
tags:
  - AI
  - Azure
  - Performance
  - Engineering

---

I wrote "Prompt Caching: The Performance Win Nobody Talks About" to share practical, production-minded guidance on this topic.

That's a mistake. Prompt caching is one of the highest-leverage optimizations available for AI apps today.

## What Prompt Caching Is

When you send the same prompt prefix repeatedly—system instructions, context documents, examples—the model recomputes them every time. Prompt caching stores the computed state of that prefix so it doesn't get reprocessed.

Result: dramatically lower latency and cost on repeated calls.

## Why It Matters in Production

Most AI apps share a large common prefix across requests:

```python
system_prompt = """
You are a data analysis assistant for ACME Corp.

Company context:
[500 tokens of business context]

Available tools:
[200 tokens of tool descriptions]

Guidelines:
[300 tokens of behavioral rules]
"""
```

Without caching, every user message reprocesses that ~1000-token prefix. With caching, it's computed once and reused.

At scale, this compounds quickly.

## Numbers That Matter

**Latency:** Cached tokens skip the prefill phase. First-token latency drops from 2-3 seconds to under 500ms for large system prompts.

**Cost:** Azure OpenAI charges less for cached input tokens. At high volume, this is meaningful.

**Throughput:** Less compute per request means more requests handled under the same rate limit.

## How to Maximize Cache Hits

**Put static content first.** Cache keys are prefix-based. Your system prompt and static context should come before dynamic user content.

```python
# Good: Static prefix, dynamic suffix
messages = [
    {"role": "system", "content": STATIC_SYSTEM_PROMPT},  # Cached
    {"role": "user", "content": user_question}             # Dynamic
]

# Bad: Dynamic content mixed in early
messages = [
    {"role": "system", "content": f"User is {user_name}. {STATIC_INSTRUCTIONS}"},  # No cache hit
]
```

**Keep prompts structurally consistent.** Even one character change in the prefix breaks the cache hit.

**Use conversation history carefully.** Long conversation threads can break caching if the prefix grows. Consider summarization strategies.

## Measuring Cache Performance

Azure OpenAI returns cache hit information in the usage object:

```python
response = client.chat.completions.create(
    model="gpt-4o",
    messages=messages
)

usage = response.usage
print(f"Prompt tokens: {usage.prompt_tokens}")
print(f"Cached tokens: {usage.prompt_tokens_details.cached_tokens}")
print(f"Cache hit rate: {usage.prompt_tokens_details.cached_tokens / usage.prompt_tokens:.1%}")
```

Track this metric. If your cache hit rate is under 60%, your prompt structure needs work.

## The Setup Cost

First call pays full price. Subsequent calls benefit. So prompt caching pays off most for:

- High-traffic endpoints
- Consistent system prompts
- Multi-turn conversations with stable context

Low-traffic or highly variable prompts? Less benefit.

## Combining with RAG

RAG systems are a perfect fit for prompt caching. The retrieved documents change, but the instructions don't.

```python
# Cache this part
SYSTEM_PROMPT = "You answer questions based on provided context. Be precise and cite sources."

# This changes per query
context_message = f"Context:\n{retrieved_chunks}\n\nQuestion: {user_question}"
```

Split your prompts intentionally. Stable instructions go first. Dynamic content follows.

## The Bottom Line

Prompt caching is free performance. It requires prompt structure discipline, not more infrastructure.

Before adding more capacity, check your cache hit rate. There's likely latency and cost sitting on the table.

Optimize the prompt structure first. Scale after.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
