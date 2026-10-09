---
title: "LLM Model Selection Criteria: A Decision Framework"
author: Michael John Peña
draft: false
date: 2024-02-05
tags:
  - Model Selection
  - LLM
  - Decision Framework
  - Enterprise AI
  - Architecture
---

## Selection Criteria

### 1. Capability Requirements

```python
capability_matrix = {
    "gpt-4-turbo": {
        "reasoning": 9,
        "code": 9,
        "creative": 8,
        "multilingual": 8,
        "instruction_following": 9,
        "context_length": 128000
    },
    "gpt-3.5-turbo": {
        "reasoning": 7,
        "code": 7,
        "creative": 7,
        "multilingual": 7,
        "instruction_following": 7,
        "context_length": 16000
    },
    "claude-3-opus": {
        "reasoning": 9,
        "code": 8,
        "creative": 8,
        "multilingual": 8,
        "instruction_following": 10,
        "context_length": 200000
    }
}

def score_model(model: str, requirements: dict) -> float:
    caps = capability_matrix.get(model, {})
    score = sum(
        caps.get(req, 0) * weight
        for req, weight in requirements.items()
    )
    return score
```

### 2. Cost Constraints

```python
def calculate_monthly_cost(
    model: str,
    daily_requests: int,
    avg_input_tokens: int,
    avg_output_tokens: int
) -> float:
    pricing = {
        "gpt-4-turbo": {"input": 0.01, "output": 0.03},
        "gpt-3.5-turbo": {"input": 0.0005, "output": 0.0015},
        "claude-3-opus": {"input": 0.015, "output": 0.075}
    }

    p = pricing[model]
    daily_cost = (
        daily_requests * avg_input_tokens / 1000 * p["input"] +
        daily_requests * avg_output_tokens / 1000 * p["output"]
    )
    return daily_cost * 30
```

### 3. Latency Requirements

```python
latency_profiles = {
    "gpt-4-turbo": {"p50": 2000, "p95": 5000, "p99": 10000},
    "gpt-3.5-turbo": {"p50": 500, "p95": 1500, "p99": 3000},
    "claude-3-opus": {"p50": 2500, "p95": 6000, "p99": 12000}
}

def meets_latency_requirement(model: str, max_p95_ms: int) -> bool:
    return latency_profiles[model]["p95"] <= max_p95_ms
```

### 4. Compliance Requirements

```python
compliance_features = {
    "gpt-4-turbo": {
        "azure_available": True,
        "data_residency": ["US", "EU", "Asia"],
        "soc2": True,
        "hipaa": True
    },
    "claude-3-opus": {
        "azure_available": False,
        "data_residency": ["US"],
        "soc2": True,
        "hipaa": False
    }
}
```

## Decision Matrix

```python
def select_model(requirements: dict) -> str:
    """Select best model based on requirements."""

    candidates = list(capability_matrix.keys())

    # Filter by hard requirements
    if requirements.get("azure_required"):
        candidates = [m for m in candidates if compliance_features[m]["azure_available"]]

    if requirements.get("max_latency_p95"):
        candidates = [m for m in candidates if meets_latency_requirement(m, requirements["max_latency_p95"])]

    if requirements.get("min_context"):
        candidates = [m for m in candidates if capability_matrix[m]["context_length"] >= requirements["min_context"]]

    # Score remaining candidates
    scores = {}
    for model in candidates:
        cap_score = score_model(model, requirements.get("capability_weights", {}))
        cost = calculate_monthly_cost(model, 1000, 500, 200)
        # Normalize and combine
        scores[model] = cap_score - (cost * requirements.get("cost_sensitivity", 0.1))

    return max(scores, key=scores.get)
```

## Practical Example

```python
# E-commerce chatbot requirements
requirements = {
    "capability_weights": {
        "instruction_following": 2.0,
        "multilingual": 1.5,
        "reasoning": 1.0
    },
    "azure_required": True,
    "max_latency_p95": 3000,
    "cost_sensitivity": 0.5
}

selected = select_model(requirements)
print(f"Selected model: {selected}")
```

## Conclusion

Model selection should be systematic, not arbitrary. Define your requirements, score candidates objectively, and document decisions for future review.
