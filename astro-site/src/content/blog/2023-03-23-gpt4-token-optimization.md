---
title: "Token Optimization Strategies for GPT-4"
author: Michael John Pena
draft: false
date: 2023-03-23
tags:
  - OpenAI
  - AI
  - GPT-4
  - Optimization
  - Cost

---

I wrote "Token Optimization Strategies for GPT-4" to share practical, production-minded guidance on this topic.

## Understanding Token Costs

GPT-4 pricing per 1K tokens:
- GPT-4 8K: $0.03 input, $0.06 output
- GPT-4 32K: $0.06 input, $0.12 output

Output tokens cost 2x input tokens. This changes optimization strategy.

```python
import tiktoken

class TokenCounter:
    """Count and estimate tokens."""

    def __init__(self, model: str = "gpt-4"):
        self.encoding = tiktoken.encoding_for_model(model)
        self.model = model

    def count(self, text: str) -> int:
        """Count tokens in text."""
        return len(self.encoding.encode(text))

    def count_messages(self, messages: list[dict]) -> int:
        """Count tokens in message list."""
        total = 0
        for message in messages:
            total += 4  # Message overhead
            for key, value in message.items():
                total += self.count(str(value))
        total += 2  # Reply priming
        return total

    def estimate_cost(
        self,
        input_tokens: int,
        estimated_output_tokens: int
    ) -> float:
        """Estimate request cost."""
        if "32k" in self.model:
            input_cost = input_tokens * 0.06 / 1000
            output_cost = estimated_output_tokens * 0.12 / 1000
        else:
            input_cost = input_tokens * 0.03 / 1000
            output_cost = estimated_output_tokens * 0.06 / 1000
        return input_cost + output_cost
```

## Strategy 1: Prompt Compression

Remove unnecessary words while preserving meaning:

```python
class PromptCompressor:
    """Compress prompts to reduce tokens."""

    def __init__(self):
        # Phrases to remove/shorten
        self.removable = [
            "Please ", "Could you please ", "I would like you to ",
            "Can you help me ", "I need you to ", "Would you mind ",
            "I was wondering if you could ", "It would be great if you could ",
        ]

        self.shortenings = {
            "for example": "e.g.",
            "in order to": "to",
            "a lot of": "many",
            "due to the fact that": "because",
            "in the event that": "if",
            "at this point in time": "now",
            "in the near future": "soon",
        }

    def compress(self, prompt: str) -> str:
        """Compress prompt."""
        result = prompt

        # Remove filler phrases
        for phrase in self.removable:
            result = result.replace(phrase, "")

        # Apply shortenings
        for long, short in self.shortenings.items():
            result = result.replace(long, short)

        # Remove extra whitespace
        result = ' '.join(result.split())

        return result

    def compress_with_metrics(self, prompt: str) -> dict:
        """Compress and report savings."""
        counter = TokenCounter()
        original_tokens = counter.count(prompt)

        compressed = self.compress(prompt)
        compressed_tokens = counter.count(compressed)

        savings = original_tokens - compressed_tokens
        savings_pct = (savings / original_tokens * 100) if original_tokens > 0 else 0

        return {
            "compressed": compressed,
            "original_tokens": original_tokens,
            "compressed_tokens": compressed_tokens,
            "tokens_saved": savings,
            "savings_percent": round(savings_pct, 1),
            "cost_saved": savings * 0.03 / 1000  # GPT-4 input cost
        }
```

## Strategy 2: Context Pruning

Include only relevant context:

```python
class ContextPruner:
    """Prune context to essential information."""

    def __init__(self, client, token_budget: int = 4000):
        self.client = client
        self.token_budget = token_budget
        self.counter = TokenCounter()

    async def prune_context(
        self,
        query: str,
        documents: list[dict],
    ) -> list[dict]:
        """Select most relevant documents within budget."""

        # Score relevance using cheaper model
        scored_docs = await self._score_relevance(query, documents)

        # Sort by relevance
        scored_docs.sort(key=lambda x: x["score"], reverse=True)

        # Select within budget
        selected = []
        total_tokens = 0

        for doc in scored_docs:
            doc_tokens = self.counter.count(doc["content"])
            if total_tokens + doc_tokens <= self.token_budget:
                selected.append(doc)
                total_tokens += doc_tokens
            else:
                break

        return selected

    async def _score_relevance(
        self,
        query: str,
        documents: list[dict]
    ) -> list[dict]:
        """Score document relevance using GPT-3.5."""
        # Use cheaper model for relevance scoring
        docs_summary = "\n".join([
            f"{i}: {d['content'][:200]}..."
            for i, d in enumerate(documents)
        ])

        prompt = f"""Rate relevance of each document to the query (0-10).

Query: {query}

Documents:
{docs_summary}

Return JSON: {{"scores": [score1, score2, ...]}}"""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",  # Use cheaper model
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        import json
        try:
            scores = json.loads(response.content)["scores"]
            for i, doc in enumerate(documents):
                doc["score"] = scores[i] if i < len(scores) else 0
        except:
            for doc in documents:
                doc["score"] = 5  # Default score

        return documents

    def truncate_to_budget(
        self,
        text: str,
        budget: int,
        strategy: str = "end"
    ) -> str:
        """Truncate text to fit token budget."""
        tokens = self.counter.encoding.encode(text)

        if len(tokens) <= budget:
            return text

        if strategy == "end":
            # Keep beginning
            truncated_tokens = tokens[:budget]
        elif strategy == "start":
            # Keep end
            truncated_tokens = tokens[-budget:]
        elif strategy == "middle":
            # Keep beginning and end
            half = budget // 2
            truncated_tokens = tokens[:half] + tokens[-half:]
        else:
            truncated_tokens = tokens[:budget]

        return self.counter.encoding.decode(truncated_tokens)
```

## Strategy 3: Output Control

Limit output length to reduce the more expensive output tokens:

```python
class OutputController:
    """Control output length."""

    def __init__(self, client):
        self.client = client

    async def generate_concise(
        self,
        prompt: str,
        max_sentences: int = 3,
        max_tokens: int = 200
    ) -> str:
        """Generate concise output."""

        constrained_prompt = f"""{prompt}

Requirements:
- Maximum {max_sentences} sentences
- Be concise and direct
- No unnecessary preamble"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": constrained_prompt}],
            max_tokens=max_tokens
        )

        return response.content

    async def generate_structured(
        self,
        prompt: str,
        fields: list[str]
    ) -> dict:
        """Generate structured output for efficiency."""

        fields_str = "\n".join([f"- {f}: <brief value>" for f in fields])

        constrained_prompt = f"""{prompt}

Return ONLY these fields:
{fields_str}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": constrained_prompt}],
            max_tokens=len(fields) * 50  # Estimate per field
        )

        return {"output": response.content}

    def estimate_output_tokens(
        self,
        task_type: str,
        input_length: int
    ) -> int:
        """Estimate output tokens by task type."""
        estimates = {
            "classification": 10,
            "extraction": min(input_length // 4, 500),
            "summarization": min(input_length // 5, 300),
            "analysis": min(input_length // 2, 1000),
            "generation": 500,
            "code": 800,
        }
        return estimates.get(task_type, 200)
```

## Strategy 4: Caching and Deduplication

Avoid redundant API calls:

```python
import hashlib
import json
from datetime import datetime, timedelta

class TokenSavingCache:
    """Cache to save tokens on repeated queries."""

    def __init__(self, redis_client, ttl_hours: int = 24):
        self.redis = redis_client
        self.ttl = timedelta(hours=ttl_hours)
        self.counter = TokenCounter()
        self.stats = {"hits": 0, "misses": 0, "tokens_saved": 0}

    def _cache_key(self, prompt: str, params: dict) -> str:
        """Generate cache key."""
        content = json.dumps({"prompt": prompt, "params": params}, sort_keys=True)
        return f"gpt4:{hashlib.sha256(content.encode()).hexdigest()}"

    async def get_or_generate(
        self,
        prompt: str,
        generate_fn,
        params: dict = None
    ) -> dict:
        """Get from cache or generate."""
        params = params or {}
        key = self._cache_key(prompt, params)

        # Check cache
        cached = self.redis.get(key)
        if cached:
            self.stats["hits"] += 1
            input_tokens = self.counter.count(prompt)
            self.stats["tokens_saved"] += input_tokens
            return {
                "result": json.loads(cached),
                "cached": True,
                "tokens_saved": input_tokens
            }

        # Generate
        self.stats["misses"] += 1
        result = await generate_fn(prompt, **params)

        # Cache result
        self.redis.setex(key, self.ttl, json.dumps(result))

        return {"result": result, "cached": False}

    def get_savings_report(self) -> dict:
        """Report token savings from caching."""
        total_requests = self.stats["hits"] + self.stats["misses"]
        hit_rate = self.stats["hits"] / total_requests if total_requests > 0 else 0

        return {
            "cache_hits": self.stats["hits"],
            "cache_misses": self.stats["misses"],
            "hit_rate": round(hit_rate * 100, 1),
            "tokens_saved": self.stats["tokens_saved"],
            "cost_saved": self.stats["tokens_saved"] * 0.03 / 1000
        }
```

## Strategy 5: Model Tiering

Use cheaper models when possible:

```python
class ModelTiering:
    """Route to appropriate model tier."""

    def __init__(self, clients: dict):
        self.clients = clients  # {"gpt35": ..., "gpt4": ..., "gpt4-32k": ...}
        self.counter = TokenCounter()

    async def smart_route(
        self,
        prompt: str,
        task_type: str,
        quality_threshold: str = "normal"
    ) -> dict:
        """Route to appropriate model."""

        # Task-based routing
        gpt35_tasks = ["classification", "extraction", "simple_qa", "summarization"]
        gpt4_tasks = ["code_review", "analysis", "reasoning", "complex_qa"]

        if task_type in gpt35_tasks and quality_threshold != "high":
            model = "gpt35"
        elif task_type in gpt4_tasks:
            model = "gpt4"
        else:
            model = "gpt35"

        # Context-based upgrade
        input_tokens = self.counter.count(prompt)
        if input_tokens > 3500:
            model = "gpt4"
        if input_tokens > 7000:
            model = "gpt4-32k"

        # Execute
        response = await self.clients[model].chat_completion(
            messages=[{"role": "user", "content": prompt}]
        )

        return {
            "result": response.content,
            "model_used": model,
            "input_tokens": input_tokens
        }

    def estimate_savings(
        self,
        requests: list[dict]
    ) -> dict:
        """Estimate savings from tiering."""
        gpt4_only_cost = 0
        tiered_cost = 0

        for req in requests:
            input_tokens = self.counter.count(req["prompt"])
            output_tokens = req.get("output_tokens", 200)

            # All GPT-4 cost
            gpt4_only_cost += (input_tokens * 0.03 + output_tokens * 0.06) / 1000

            # Tiered cost
            model = self.smart_route_sync(req["prompt"], req["task_type"])
            if model == "gpt35":
                tiered_cost += (input_tokens + output_tokens) * 0.002 / 1000
            else:
                tiered_cost += (input_tokens * 0.03 + output_tokens * 0.06) / 1000

        return {
            "gpt4_only_cost": round(gpt4_only_cost, 4),
            "tiered_cost": round(tiered_cost, 4),
            "savings": round(gpt4_only_cost - tiered_cost, 4),
            "savings_percent": round((1 - tiered_cost / gpt4_only_cost) * 100, 1) if gpt4_only_cost > 0 else 0
        }
```

## Strategy 6: Batch Optimization

Combine related requests:

```python
class BatchOptimizer:
    """Batch related requests for efficiency."""

    async def batch_similar_tasks(
        self,
        tasks: list[dict],
        max_batch_size: int = 10
    ) -> list[dict]:
        """Batch similar tasks into single requests."""
        results = []

        # Group by task type
        grouped = {}
        for task in tasks:
            task_type = task.get("type", "default")
            if task_type not in grouped:
                grouped[task_type] = []
            grouped[task_type].append(task)

        # Process each group
        for task_type, group_tasks in grouped.items():
            # Batch within groups
            for i in range(0, len(group_tasks), max_batch_size):
                batch = group_tasks[i:i + max_batch_size]
                batch_result = await self._process_batch(batch, task_type)
                results.extend(batch_result)

        return results

    async def _process_batch(
        self,
        batch: list[dict],
        task_type: str
    ) -> list[dict]:
        """Process a batch in single request."""
        items_str = "\n".join([
            f"{i+1}. {task['input']}"
            for i, task in enumerate(batch)
        ])

        prompt = f"""Process these {len(batch)} items.

Items:
{items_str}

For each item, provide the result in format:
1. <result>
2. <result>
..."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        # Parse results
        results = self._parse_batch_results(response.content, batch)
        return results
```

## Optimization Dashboard

```python
class TokenOptimizationDashboard:
    """Track optimization metrics."""

    def __init__(self):
        self.metrics = {
            "total_tokens": 0,
            "saved_by_compression": 0,
            "saved_by_caching": 0,
            "saved_by_tiering": 0,
            "total_cost": 0,
            "optimized_cost": 0
        }

    def record(self, original: int, optimized: int, method: str):
        """Record optimization."""
        savings = original - optimized
        self.metrics["total_tokens"] += original
        self.metrics[f"saved_by_{method}"] += savings

    def get_report(self) -> dict:
        """Get optimization report."""
        total_saved = sum(v for k, v in self.metrics.items() if k.startswith("saved_by"))
        return {
            "total_tokens_processed": self.metrics["total_tokens"],
            "total_tokens_saved": total_saved,
            "savings_percent": round(total_saved / self.metrics["total_tokens"] * 100, 1) if self.metrics["total_tokens"] > 0 else 0,
            "cost_saved": round(total_saved * 0.03 / 1000, 2),
            "breakdown": {k: v for k, v in self.metrics.items() if k.startswith("saved_by")}
        }
```

With systematic token optimization, you can reduce GPT-4 costs by 50-70% while maintaining quality. Track your savings and continuously refine your strategies.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
