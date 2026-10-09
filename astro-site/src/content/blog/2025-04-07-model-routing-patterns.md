---
title: "Model Routing Patterns: Smart Query Distribution"
description: "Smart routing can reduce AI costs by 50-70% while maintaining quality."
author: Michael John Peña
draft: false
date: 2025-04-07
tags:
  - AI
  - Routing
  - Architecture
  - Optimization
  - Cost
---

## Intelligent Model Routing

```python
from azure.ai.openai import AzureOpenAI
from dataclasses import dataclass
from typing import Callable
import numpy as np

@dataclass
class ModelConfig:
    name: str
    endpoint: str
    cost_per_1k_tokens: float
    avg_latency_ms: float
    max_complexity: float  # 0-1 scale

class ModelRouter:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client
        self.models = {}
        self.classifier = QueryClassifier(openai_client)

    def register_model(self, config: ModelConfig):
        """Register a model for routing."""
        self.models[config.name] = config

    async def route(self, query: str, constraints: dict = None) -> str:
        """Route query to optimal model."""
        # Classify query complexity
        complexity = await self.classifier.estimate_complexity(query)

        # Apply constraints
        constraints = constraints or {}
        max_latency = constraints.get("max_latency_ms", float("inf"))
        max_cost = constraints.get("max_cost_per_1k", float("inf"))

        # Find suitable models
        candidates = []
        for name, config in self.models.items():
            if (config.max_complexity >= complexity and
                config.avg_latency_ms <= max_latency and
                config.cost_per_1k_tokens <= max_cost):
                candidates.append(config)

        if not candidates:
            # Fall back to most capable model
            return max(self.models.values(), key=lambda m: m.max_complexity).name

        # Select cheapest suitable model
        return min(candidates, key=lambda m: m.cost_per_1k_tokens).name

    async def execute(self, query: str, constraints: dict = None) -> dict:
        """Route and execute query."""
        model_name = await self.route(query, constraints)
        model_config = self.models[model_name]

        response = await self.openai.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": query}]
        )

        return {
            "response": response.choices[0].message.content,
            "model_used": model_name,
            "estimated_cost": self.estimate_cost(response, model_config)
        }


class QueryClassifier:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client

    async def estimate_complexity(self, query: str) -> float:
        """Estimate query complexity (0-1)."""
        # Fast heuristics first
        heuristic_score = self.heuristic_complexity(query)

        if heuristic_score < 0.3 or heuristic_score > 0.7:
            return heuristic_score

        # Use LLM for ambiguous cases
        return await self.llm_complexity(query)

    def heuristic_complexity(self, query: str) -> float:
        """Fast heuristic-based complexity estimation."""
        score = 0.0

        # Length factor
        score += min(len(query) / 1000, 0.3)

        # Question words
        complex_patterns = ["why", "how", "explain", "compare", "analyze"]
        if any(p in query.lower() for p in complex_patterns):
            score += 0.2

        # Code indicators
        if "```" in query or "def " in query or "function" in query:
            score += 0.2

        # Multi-step indicators
        if " and " in query.lower() or " then " in query.lower():
            score += 0.15

        return min(score, 1.0)

    async def llm_complexity(self, query: str) -> float:
        """Use LLM for complexity estimation."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o-mini",  # Use cheap model for classification
            messages=[{
                "role": "user",
                "content": f"Rate complexity 0-1: {query[:500]}"
            }]
        )
        return float(response.choices[0].message.content)
```

Smart routing can reduce AI costs by 50-70% while maintaining quality.
