---
title: "A/B Testing AI Features: Data-Driven Model Selection"
description: "A/B testing AI features requires special considerations beyond traditional web experiments. This guide covers how to design, implement, and analyze AI…"
author: "Michael John Peña"
draft: false
date: 2024-03-27
tags: ["AI", "A/B Testing", "MLOps", "Experimentation", "Data Science"]
---

A/B testing AI features requires special considerations beyond traditional web experiments. This guide covers how to design, implement, and analyze AI experiments.

## Unique Challenges in AI A/B Testing

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum
import random
import hashlib

class AIExperimentChallenges(Enum):
    NON_DETERMINISTIC = "Model outputs vary for same input"
    DELAYED_FEEDBACK = "Quality assessment takes time"
    COMPLEX_METRICS = "Multiple metrics to optimize"
    USER_LEARNING = "Users adapt to AI behavior"
    COST_VARIANCE = "Different models have different costs"

@dataclass
class Variant:
    name: str
    model_id: str
    prompt_template: str
    parameters: Dict
    traffic_percentage: float

@dataclass
class Experiment:
    id: str
    name: str
    description: str
    variants: List[Variant]
    primary_metric: str
    secondary_metrics: List[str]
    start_date: str
    end_date: Optional[str] = None
```

## Experiment Framework

```python
import hashlib
from datetime import datetime
from typing import Callable
import anthropic

class AIExperimentFramework:
    """Framework for A/B testing AI features"""

    def __init__(self):
        self.experiments: Dict[str, Experiment] = {}
        self.client = anthropic.Anthropic()
        self.results_store = {}

    def create_experiment(self, experiment: Experiment) -> str:
        """Register a new experiment"""
        self.experiments[experiment.id] = experiment
        self.results_store[experiment.id] = {
            variant.name: {"impressions": 0, "metrics": {}}
            for variant in experiment.variants
        }
        return experiment.id

    def get_variant(
        self,
        experiment_id: str,
        user_id: str
    ) -> Variant:
        """Deterministically assign user to variant"""
        experiment = self.experiments[experiment_id]

        # Consistent hashing for user assignment
        hash_input = f"{experiment_id}:{user_id}"
        hash_value = int(hashlib.md5(hash_input.encode()).hexdigest(), 16)
        bucket = hash_value % 100

        cumulative = 0
        for variant in experiment.variants:
            cumulative += variant.traffic_percentage
            if bucket < cumulative:
                return variant

        return experiment.variants[-1]  # Fallback

    def run_variant(
        self,
        variant: Variant,
        user_input: str
    ) -> Dict:
        """Execute the AI model for a variant"""

        prompt = variant.prompt_template.format(input=user_input)

        start_time = datetime.now()
        response = self.client.messages.create(
            model=variant.model_id,
            max_tokens=variant.parameters.get("max_tokens", 1000),
            temperature=variant.parameters.get("temperature", 0.7),
            messages=[{"role": "user", "content": prompt}]
        )
        latency_ms = (datetime.now() - start_time).total_seconds() * 1000

        return {
            "response": response.content[0].text,
            "latency_ms": latency_ms,
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "model": variant.model_id
        }

    def log_metric(
        self,
        experiment_id: str,
        variant_name: str,
        metric_name: str,
        value: float
    ):
        """Log a metric for analysis"""
        store = self.results_store[experiment_id][variant_name]
        store["impressions"] += 1

        if metric_name not in store["metrics"]:
            store["metrics"][metric_name] = []
        store["metrics"][metric_name].append(value)

    def analyze_experiment(self, experiment_id: str) -> Dict:
        """Analyze experiment results"""
        experiment = self.experiments[experiment_id]
        results = self.results_store[experiment_id]

        analysis = {}

        for variant_name, data in results.items():
            metrics_summary = {}

            for metric_name, values in data["metrics"].items():
                if values:
                    import numpy as np
                    metrics_summary[metric_name] = {
                        "mean": np.mean(values),
                        "std": np.std(values),
                        "count": len(values),
                        "ci_95": self._confidence_interval(values)
                    }

            analysis[variant_name] = {
                "impressions": data["impressions"],
                "metrics": metrics_summary
            }

        # Statistical significance
        if len(experiment.variants) == 2:
            analysis["statistical_test"] = self._run_significance_test(
                experiment_id,
                experiment.primary_metric
            )

        return analysis

    def _confidence_interval(self, values: List[float], confidence: float = 0.95) -> tuple:
        """Calculate confidence interval"""
        import numpy as np
        from scipy import stats

        n = len(values)
        mean = np.mean(values)
        se = stats.sem(values)
        h = se * stats.t.ppf((1 + confidence) / 2, n - 1)
        return (mean - h, mean + h)

    def _run_significance_test(
        self,
        experiment_id: str,
        metric_name: str
    ) -> Dict:
        """Run statistical significance test between variants"""
        from scipy import stats

        results = self.results_store[experiment_id]
        variants = list(results.keys())

        if len(variants) != 2:
            return {"error": "Requires exactly 2 variants"}

        values_a = results[variants[0]]["metrics"].get(metric_name, [])
        values_b = results[variants[1]]["metrics"].get(metric_name, [])

        if len(values_a) < 30 or len(values_b) < 30:
            return {"error": "Insufficient samples for significance test"}

        # T-test
        t_stat, p_value = stats.ttest_ind(values_a, values_b)

        return {
            "test": "t-test",
            "t_statistic": t_stat,
            "p_value": p_value,
            "significant": p_value < 0.05,
            "winner": variants[0] if np.mean(values_a) > np.mean(values_b) else variants[1]
        }
```

## Example: Testing Different Models

```python
# Create experiment comparing Claude models
experiment = Experiment(
    id="claude-model-comparison-001",
    name="Claude 3 Sonnet vs Haiku for Support",
    description="Compare models for customer support responses",
    variants=[
        Variant(
            name="control-sonnet",
            model_id="claude-3-sonnet-20240229",
            prompt_template="You are a helpful customer support agent. Help with: {input}",
            parameters={"max_tokens": 500, "temperature": 0.7},
            traffic_percentage=50
        ),
        Variant(
            name="treatment-haiku",
            model_id="claude-3-haiku-20240307",
            prompt_template="You are a helpful customer support agent. Help with: {input}",
            parameters={"max_tokens": 500, "temperature": 0.7},
            traffic_percentage=50
        )
    ],
    primary_metric="user_satisfaction",
    secondary_metrics=["response_time", "resolution_rate", "cost_per_query"]
)

framework = AIExperimentFramework()
framework.create_experiment(experiment)

# Simulate experiment
def process_support_request(user_id: str, query: str):
    # Get variant
    variant = framework.get_variant(experiment.id, user_id)

    # Run AI
    result = framework.run_variant(variant, query)

    # Log metrics
    framework.log_metric(experiment.id, variant.name, "latency_ms", result["latency_ms"])

    # Cost calculation (simplified)
    cost = (result["input_tokens"] * 0.00001) + (result["output_tokens"] * 0.00003)
    framework.log_metric(experiment.id, variant.name, "cost", cost)

    return result["response"], variant.name

# After collecting data, analyze
# analysis = framework.analyze_experiment(experiment.id)
```

## Multi-Armed Bandit for Adaptive Allocation

```python
import numpy as np

class ThompsonSamplingBandit:
    """
    Thompson Sampling for adaptive traffic allocation

    Automatically shifts traffic to better-performing variants
    """

    def __init__(self, variants: List[str]):
        self.variants = variants
        # Beta distribution parameters (successes, failures)
        self.alpha = {v: 1.0 for v in variants}
        self.beta = {v: 1.0 for v in variants}

    def select_variant(self) -> str:
        """Select variant using Thompson Sampling"""
        samples = {
            v: np.random.beta(self.alpha[v], self.beta[v])
            for v in self.variants
        }
        return max(samples, key=samples.get)

    def update(self, variant: str, reward: float):
        """Update beliefs based on observed reward"""
        # For binary rewards
        if reward > 0.5:
            self.alpha[variant] += 1
        else:
            self.beta[variant] += 1

    def get_probabilities(self) -> Dict[str, float]:
        """Get current probability estimates for each variant"""
        return {
            v: self.alpha[v] / (self.alpha[v] + self.beta[v])
            for v in self.variants
        }

# Usage with AI experiments
class AdaptiveAIExperiment:
    def __init__(self, variants: List[Variant]):
        self.variants = {v.name: v for v in variants}
        self.bandit = ThompsonSamplingBandit(list(self.variants.keys()))
        self.client = anthropic.Anthropic()

    def get_response(self, user_input: str) -> tuple:
        """Get response using adaptive variant selection"""
        variant_name = self.bandit.select_variant()
        variant = self.variants[variant_name]

        response = self.client.messages.create(
            model=variant.model_id,
            max_tokens=variant.parameters.get("max_tokens", 500),
            messages=[{"role": "user", "content": user_input}]
        )

        return response.content[0].text, variant_name

    def record_feedback(self, variant_name: str, positive: bool):
        """Record user feedback"""
        self.bandit.update(variant_name, 1.0 if positive else 0.0)
```

## Metrics to Track

```python
AI_EXPERIMENT_METRICS = {
    # Quality metrics
    "user_satisfaction": "User rating of response (1-5 scale)",
    "task_completion": "Did the AI help complete the task?",
    "accuracy": "Factual correctness of response",

    # Engagement metrics
    "follow_up_rate": "Rate of follow-up questions",
    "abandonment_rate": "Users who left without resolution",

    # Efficiency metrics
    "response_time_ms": "Time to generate response",
    "tokens_used": "Total tokens consumed",
    "cost_per_query": "Cost to serve each query",

    # Safety metrics
    "refusal_rate": "Rate of refused queries",
    "escalation_rate": "Rate of human escalation"
}
```

## Conclusion

A/B testing AI features requires thoughtful experiment design, proper statistical analysis, and consideration of multiple metrics including cost and latency. Use adaptive methods like Thompson Sampling for faster convergence to optimal variants.
