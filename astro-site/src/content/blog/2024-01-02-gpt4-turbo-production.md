---
title: "GPT-4 Turbo in Production: Lessons from Real-World Deployments"
author: Michael John Peña
draft: false
date: 2024-01-02
tags:
  - GPT-4
  - Azure OpenAI
  - Production
  - Best Practices
  - Enterprise AI
---

## Key Differences from GPT-4

GPT-4 Turbo brings several improvements that matter for production:

| Feature | GPT-4 | GPT-4 Turbo |
|---------|-------|-------------|
| Context Window | 8K/32K | 128K |
| Input Cost | $0.03/1K | $0.01/1K |
| Output Cost | $0.06/1K | $0.03/1K |
| Knowledge Cutoff | Sep 2021 | Apr 2023 |
| JSON Mode | No | Yes |

## Production Patterns

### Structured Output with JSON Mode

JSON mode eliminates parsing headaches:

```python
from openai import AzureOpenAI
from pydantic import BaseModel
import json

client = AzureOpenAI(
    azure_endpoint="https://your-resource.openai.azure.com/",
    api_key="your-key",
    api_version="2024-02-15-preview"
)

class ExtractedEntity(BaseModel):
    name: str
    entity_type: str
    confidence: float
    context: str

def extract_entities_structured(text: str) -> list[ExtractedEntity]:
    """Extract entities with guaranteed JSON output."""

    response = client.chat.completions.create(
        model="gpt-4-turbo",
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": """Extract entities from text. Return JSON:
                {
                    "entities": [
                        {"name": "...", "entity_type": "...", "confidence": 0.0-1.0, "context": "..."}
                    ]
                }"""
            },
            {
                "role": "user",
                "content": text
            }
        ]
    )

    result = json.loads(response.choices[0].message.content)
    return [ExtractedEntity(**e) for e in result["entities"]]

# Usage
entities = extract_entities_structured(
    "Microsoft CEO Satya Nadella announced Azure AI updates at Ignite 2023."
)
for e in entities:
    print(f"{e.name} ({e.entity_type}): {e.confidence:.2%}")
```

### Handling the 128K Context Window

Large context windows enable new patterns but require careful management:

```python
import tiktoken
from typing import Generator

def count_tokens(text: str, model: str = "gpt-4-turbo") -> int:
    """Count tokens for a text string."""
    encoding = tiktoken.encoding_for_model(model)
    return len(encoding.encode(text))

def chunk_for_context(
    documents: list[str],
    max_context_tokens: int = 120000,  # Leave room for system prompt and output
    overlap_tokens: int = 500
) -> Generator[list[str], None, None]:
    """Yield document batches that fit within context window."""

    current_batch = []
    current_tokens = 0

    for doc in documents:
        doc_tokens = count_tokens(doc)

        if current_tokens + doc_tokens > max_context_tokens:
            if current_batch:
                yield current_batch
            current_batch = [doc]
            current_tokens = doc_tokens
        else:
            current_batch.append(doc)
            current_tokens += doc_tokens

    if current_batch:
        yield current_batch

# Process large document sets
def analyze_documents(documents: list[str], query: str) -> str:
    """Analyze documents in batches respecting context limits."""

    all_insights = []

    for batch in chunk_for_context(documents):
        context = "\n\n---\n\n".join(batch)

        response = client.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "Analyze the provided documents and answer the query."
                },
                {
                    "role": "user",
                    "content": f"Documents:\n{context}\n\nQuery: {query}"
                }
            ]
        )

        all_insights.append(response.choices[0].message.content)

    # Synthesize if multiple batches
    if len(all_insights) > 1:
        return synthesize_insights(all_insights, query)

    return all_insights[0]
```

### Robust Error Handling

Production systems need comprehensive error handling:

```python
from openai import APIError, RateLimitError, APIConnectionError
from tenacity import retry, wait_exponential, stop_after_attempt, retry_if_exception_type
import logging

logger = logging.getLogger(__name__)

class GPT4TurboClient:
    def __init__(self, client: AzureOpenAI, max_retries: int = 3):
        self.client = client
        self.max_retries = max_retries

    @retry(
        retry=retry_if_exception_type((RateLimitError, APIConnectionError)),
        wait=wait_exponential(multiplier=1, min=4, max=60),
        stop=stop_after_attempt(3)
    )
    def complete(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 4096,
        json_mode: bool = False
    ) -> str:
        """Make a completion request with retry logic."""

        try:
            kwargs = {
                "model": "gpt-4-turbo",
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens
            }

            if json_mode:
                kwargs["response_format"] = {"type": "json_object"}

            response = self.client.chat.completions.create(**kwargs)

            # Log usage for cost tracking
            usage = response.usage
            logger.info(
                f"GPT-4 Turbo usage: {usage.prompt_tokens} input, "
                f"{usage.completion_tokens} output"
            )

            return response.choices[0].message.content

        except RateLimitError as e:
            logger.warning(f"Rate limited, will retry: {e}")
            raise

        except APIConnectionError as e:
            logger.warning(f"Connection error, will retry: {e}")
            raise

        except APIError as e:
            logger.error(f"API error (not retrying): {e}")
            raise

    def complete_with_fallback(
        self,
        messages: list[dict],
        fallback_model: str = "gpt-35-turbo"
    ) -> tuple[str, str]:
        """Try GPT-4 Turbo, fall back to GPT-3.5 if needed."""

        try:
            return self.complete(messages), "gpt-4-turbo"
        except Exception as e:
            logger.warning(f"Falling back to {fallback_model}: {e}")

            response = self.client.chat.completions.create(
                model=fallback_model,
                messages=messages
            )
            return response.choices[0].message.content, fallback_model
```

### Streaming for Better UX

Streaming improves perceived latency for user-facing applications:

```python
from typing import Generator

def stream_completion(
    messages: list[dict],
    on_token: callable = None
) -> Generator[str, None, None]:
    """Stream completion tokens for responsive UI."""

    stream = client.chat.completions.create(
        model="gpt-4-turbo",
        messages=messages,
        stream=True
    )

    full_response = []

    for chunk in stream:
        if chunk.choices[0].delta.content:
            token = chunk.choices[0].delta.content
            full_response.append(token)

            if on_token:
                on_token(token)

            yield token

    return "".join(full_response)

# FastAPI endpoint with streaming
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI()

@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    def generate():
        for token in stream_completion(request.messages):
            yield f"data: {token}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream"
    )
```

## Cost Management

GPT-4 Turbo is cheaper but costs add up at scale:

```python
from dataclasses import dataclass
from datetime import datetime
import json

@dataclass
class UsageRecord:
    timestamp: datetime
    model: str
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float

class CostTracker:
    PRICING = {
        "gpt-4-turbo": {"input": 0.01, "output": 0.03},
        "gpt-4": {"input": 0.03, "output": 0.06},
        "gpt-35-turbo": {"input": 0.0005, "output": 0.0015}
    }

    def __init__(self):
        self.records: list[UsageRecord] = []

    def record_usage(self, model: str, prompt_tokens: int, completion_tokens: int):
        """Record API usage and calculate cost."""

        pricing = self.PRICING.get(model, self.PRICING["gpt-4-turbo"])

        cost = (
            (prompt_tokens / 1000) * pricing["input"] +
            (completion_tokens / 1000) * pricing["output"]
        )

        record = UsageRecord(
            timestamp=datetime.utcnow(),
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=cost
        )

        self.records.append(record)
        return record

    def get_daily_summary(self) -> dict:
        """Get cost summary by model."""

        from collections import defaultdict
        summary = defaultdict(lambda: {"calls": 0, "tokens": 0, "cost": 0.0})

        for record in self.records:
            summary[record.model]["calls"] += 1
            summary[record.model]["tokens"] += record.prompt_tokens + record.completion_tokens
            summary[record.model]["cost"] += record.cost_usd

        return dict(summary)
```

## Performance Benchmarks

Our production benchmarks show:

- **Latency**: 2-5 seconds for typical requests (vs 3-8s for GPT-4)
- **Throughput**: 3x improvement with same TPM limits
- **Quality**: Comparable to GPT-4, occasionally better on recent knowledge

## Migration Checklist

When migrating from GPT-4 to GPT-4 Turbo:

1. **Update model names** in all configurations
2. **Review prompts** - behavior may differ slightly
3. **Test JSON mode** for structured outputs
4. **Adjust token budgets** - you have more room now
5. **Update cost projections** - significant savings possible
6. **Monitor quality** - run regression tests

## Conclusion

GPT-4 Turbo is production-ready and offers compelling advantages over GPT-4. The combination of larger context, lower costs, and JSON mode makes it the default choice for new projects. Migrate carefully with proper testing, but don't wait too long - the benefits are substantial.
