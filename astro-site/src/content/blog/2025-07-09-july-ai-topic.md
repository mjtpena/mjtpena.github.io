---
title: "Prompt Caching with Claude and Azure OpenAI: Reducing Latency and Costs"
author: Michael John Peña
draft: false
date: 2025-07-09
tags:
  - Prompt Engineering
  - Performance Optimization
  - Claude
  - Azure OpenAI
  - Python

---

I wrote "Prompt Caching with Claude and Azure OpenAI: Reducing Latency and Costs" to share practical, production-minded guidance on this topic.

## Understanding Cache Mechanics

Caching works on prefix matching - the system caches processed prompts and reuses them when subsequent requests share the same prefix. Structure your prompts with static content first:

```python
from anthropic import Anthropic

client = Anthropic()

# Static system context that will be cached
SYSTEM_CONTEXT = """You are an expert financial analyst assistant.
You have access to the following company data:

<company_financials>
{financial_data}  # 50KB of structured financial data
</company_financials>

<analysis_guidelines>
{guidelines}  # 10KB of analysis guidelines
</analysis_guidelines>

Always cite specific numbers from the data."""

async def analyze_query(user_query: str, financial_data: str, guidelines: str):
    response = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        system=[
            {
                "type": "text",
                "text": SYSTEM_CONTEXT.format(
                    financial_data=financial_data,
                    guidelines=guidelines
                ),
                "cache_control": {"type": "ephemeral"}
            }
        ],
        messages=[{"role": "user", "content": user_query}]
    )

    # Check cache performance
    usage = response.usage
    print(f"Cache read tokens: {usage.cache_read_input_tokens}")
    print(f"Cache write tokens: {usage.cache_creation_input_tokens}")

    return response.content[0].text
```

## Azure OpenAI Caching Strategy

For Azure OpenAI, caching happens automatically. Optimize by ensuring your system message and initial context remain identical across requests:

```python
from openai import AzureOpenAI

client = AzureOpenAI(...)

# Keep system message identical for cache hits
SYSTEM_MESSAGE = {"role": "system", "content": static_context}

def get_completion(user_message: str, conversation_history: list):
    messages = [SYSTEM_MESSAGE] + conversation_history + [
        {"role": "user", "content": user_message}
    ]
    return client.chat.completions.create(
        model="gpt-4o",
        messages=messages
    )
```

## Measuring Impact

Track cache hit rates in your monitoring. Applications with high context reuse typically see 60-80% cache hit rates, dramatically reducing per-request costs.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
