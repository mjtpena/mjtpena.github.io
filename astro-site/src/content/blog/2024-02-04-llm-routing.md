---
title: "LLM Routing: Intelligent Model Selection for Cost and Quality"
author: Michael John Peña
draft: false
date: 2024-02-04
tags:
  - LLM Routing
  - Cost Optimization
  - AI Architecture
  - GPT
  - Model Selection
---

## The Routing Problem

```
Query: "What's 2+2?"           → GPT-3.5 ($0.0005/1K) ✓
Query: "Explain quantum physics" → GPT-4 ($0.01/1K) ✓
Query: "Debug this complex code"  → GPT-4 ($0.01/1K) ✓
```

## Router Implementation

```python
from enum import Enum
import re

class ModelTier(Enum):
    SIMPLE = "gpt-3.5-turbo"
    STANDARD = "gpt-4-turbo"
    PREMIUM = "gpt-4"

class QueryRouter:
    def __init__(self):
        self.complexity_keywords = {
            "high": ["analyze", "synthesize", "compare", "evaluate", "debug", "architect"],
            "medium": ["explain", "summarize", "write", "create", "implement"],
            "low": ["what is", "define", "list", "when", "where", "who"]
        }

    def route(self, query: str) -> ModelTier:
        """Route query to appropriate model tier."""

        query_lower = query.lower()
        word_count = len(query.split())

        # Check for high complexity indicators
        if any(kw in query_lower for kw in self.complexity_keywords["high"]):
            return ModelTier.PREMIUM

        # Check for code (usually needs better model)
        if "```" in query or self._has_code_indicators(query_lower):
            return ModelTier.STANDARD

        # Long queries often need more capability
        if word_count > 200:
            return ModelTier.STANDARD

        # Simple queries
        if word_count < 20 and any(kw in query_lower for kw in self.complexity_keywords["low"]):
            return ModelTier.SIMPLE

        return ModelTier.STANDARD  # Default

    def _has_code_indicators(self, text: str) -> bool:
        code_patterns = ["function", "def ", "class ", "import ", "const ", "var "]
        return any(p in text for p in code_patterns)
```

## ML-Based Router

```python
from sklearn.ensemble import RandomForestClassifier
import numpy as np

class MLRouter:
    def __init__(self):
        self.model = RandomForestClassifier()
        self.is_trained = False

    def extract_features(self, query: str) -> np.array:
        """Extract features from query for classification."""
        return np.array([
            len(query),
            len(query.split()),
            query.count("?"),
            int("code" in query.lower()),
            int("analyze" in query.lower()),
            int("explain" in query.lower()),
            int(any(c.isupper() for c in query)),
            query.count("\n")
        ]).reshape(1, -1)

    def train(self, queries: list[str], optimal_models: list[str]):
        """Train router on historical data."""
        X = np.vstack([self.extract_features(q) for q in queries])
        self.model.fit(X, optimal_models)
        self.is_trained = True

    def route(self, query: str) -> str:
        if not self.is_trained:
            return "gpt-4-turbo"  # Default
        features = self.extract_features(query)
        return self.model.predict(features)[0]
```

## Cost Savings Analysis

```python
def analyze_routing_savings(queries: list[str], router: QueryRouter):
    """Calculate cost savings from routing."""

    pricing = {
        ModelTier.SIMPLE: 0.0005,
        ModelTier.STANDARD: 0.01,
        ModelTier.PREMIUM: 0.03
    }

    no_routing_cost = sum(pricing[ModelTier.PREMIUM] for _ in queries)
    with_routing_cost = sum(pricing[router.route(q)] for q in queries)

    return {
        "without_routing": no_routing_cost,
        "with_routing": with_routing_cost,
        "savings": no_routing_cost - with_routing_cost,
        "savings_percent": (no_routing_cost - with_routing_cost) / no_routing_cost * 100
    }
```

## Best Practices

1. **Start with rules** - Simple heuristics work well
2. **Collect feedback** - Track when routing was wrong
3. **Train ML router** - Use feedback to improve
4. **Monitor quality** - Ensure cheaper models perform adequately
5. **A/B test** - Validate routing decisions

## Conclusion

LLM routing can reduce costs by 50-70% without sacrificing quality. Start with rule-based routing and evolve to ML-based as you collect data.
