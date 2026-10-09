---
title: "AI Cost Optimization: Managing LLM Expenses"
description: "Strategic cost optimization can reduce AI expenses by 50-80% while maintaining quality."
author: Michael John Peña
draft: false
date: 2025-04-29
tags:
  - AI
  - Cost
  - Optimization
  - FinOps
  - Best Practices
---

## AI Cost Optimization Strategies

```python
from azure.ai.openai import AzureOpenAI
from dataclasses import dataclass
from typing import Dict, List
import tiktoken

@dataclass
class CostMetrics:
    input_tokens: int
    output_tokens: int
    model: str
    cost_usd: float

class AICostOptimizer:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client
        self.encoder = tiktoken.encoding_for_model("gpt-4o")

        # Cost per 1K tokens (as of 2025)
        self.pricing = {
            "gpt-4o": {"input": 0.005, "output": 0.015},
            "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},
            "gpt-4": {"input": 0.03, "output": 0.06},
            "text-embedding-3-small": {"input": 0.00002, "output": 0},
            "text-embedding-3-large": {"input": 0.00013, "output": 0}
        }

    def estimate_cost(self, prompt: str, model: str, expected_output_tokens: int = 500) -> float:
        """Estimate cost before making API call."""
        input_tokens = len(self.encoder.encode(prompt))
        pricing = self.pricing.get(model, self.pricing["gpt-4o"])

        input_cost = (input_tokens / 1000) * pricing["input"]
        output_cost = (expected_output_tokens / 1000) * pricing["output"]

        return input_cost + output_cost

    def optimize_prompt(self, prompt: str, max_tokens: int = 1000) -> str:
        """Compress prompt while preserving meaning."""
        current_tokens = len(self.encoder.encode(prompt))

        if current_tokens <= max_tokens:
            return prompt

        # Strategies for compression
        # 1. Remove redundant whitespace
        prompt = " ".join(prompt.split())

        # 2. Use abbreviations for common phrases
        abbreviations = {
            "for example": "e.g.",
            "that is": "i.e.",
            "and so on": "etc."
        }
        for full, abbrev in abbreviations.items():
            prompt = prompt.replace(full, abbrev)

        # 3. If still too long, use LLM to compress
        if len(self.encoder.encode(prompt)) > max_tokens:
            prompt = self.llm_compress(prompt, max_tokens)

        return prompt

    async def smart_model_selection(self, task: str, complexity: float) -> str:
        """Select cheapest model that can handle the task."""
        if complexity < 0.3:
            return "gpt-4o-mini"  # 20x cheaper
        elif complexity < 0.7:
            return "gpt-4o-mini"  # Try mini first
        else:
            return "gpt-4o"

    async def batch_requests(self, prompts: List[str], model: str) -> List[str]:
        """Batch multiple requests to reduce overhead."""
        # Combine prompts with delimiters
        combined = "\n---\n".join([f"[{i}] {p}" for i, p in enumerate(prompts)])

        response = await self.openai.chat.completions.create(
            model=model,
            messages=[{
                "role": "system",
                "content": "Answer each numbered question. Separate answers with ---"
            }, {
                "role": "user",
                "content": combined
            }]
        )

        # Parse responses
        responses = response.choices[0].message.content.split("---")
        return [r.strip() for r in responses]

    def track_costs(self, response, model: str) -> CostMetrics:
        """Track actual costs from response."""
        input_tokens = response.usage.prompt_tokens
        output_tokens = response.usage.completion_tokens
        pricing = self.pricing.get(model, self.pricing["gpt-4o"])

        cost = (input_tokens / 1000) * pricing["input"] + \
               (output_tokens / 1000) * pricing["output"]

        return CostMetrics(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            model=model,
            cost_usd=cost
        )

# Cost optimization strategies summary
# | Strategy | Savings | Implementation Effort |
# |----------|---------|----------------------|
# | Model routing | 50-80% | Medium |
# | Prompt caching | 30-50% | Low |
# | Prompt compression | 20-40% | Low |
# | Batching | 10-20% | Medium |
# | Output length limits | 20-30% | Low |
```

Strategic cost optimization can reduce AI expenses by 50-80% while maintaining quality.
