---
title: "A/B Testing AI Features: Data-Driven AI Improvements"
author: Michael John Peña
draft: false
date: 2025-03-24
tags:
  - AI
  - A/B Testing
  - Experimentation
  - Data Science
  - Best Practices

---

I wrote "A/B Testing AI Features: Data-Driven AI Improvements" to share practical, production-minded guidance on this topic.

## AI A/B Testing Framework

```python
from dataclasses import dataclass
from typing import Optional, Callable
import random
import hashlib
from scipy import stats
import numpy as np

@dataclass
class AIExperiment:
    name: str
    control_config: dict
    treatment_config: dict
    allocation_percentage: float = 0.5
    min_samples: int = 1000

class AIExperimentFramework:
    def __init__(self):
        self.experiments = {}
        self.results_store = ResultsStore()

    def create_experiment(self, experiment: AIExperiment):
        """Create new A/B experiment."""
        self.experiments[experiment.name] = experiment

    def get_variant(self, experiment_name: str, user_id: str) -> str:
        """Deterministic variant assignment based on user ID."""
        experiment = self.experiments[experiment_name]

        # Consistent hashing for stable assignment
        hash_input = f"{experiment_name}:{user_id}"
        hash_value = int(hashlib.md5(hash_input.encode()).hexdigest(), 16)
        bucket = (hash_value % 100) / 100

        if bucket < experiment.allocation_percentage:
            return "treatment"
        return "control"

    def get_config(self, experiment_name: str, user_id: str) -> dict:
        """Get configuration for user's variant."""
        experiment = self.experiments[experiment_name]
        variant = self.get_variant(experiment_name, user_id)

        if variant == "treatment":
            return experiment.treatment_config
        return experiment.control_config

    def log_metric(self, experiment_name: str, user_id: str, metric_name: str, value: float):
        """Log metric for analysis."""
        variant = self.get_variant(experiment_name, user_id)
        self.results_store.log(experiment_name, variant, metric_name, value)

    def analyze_experiment(self, experiment_name: str, metric_name: str) -> dict:
        """Analyze experiment results with statistical significance."""
        control_data = self.results_store.get(experiment_name, "control", metric_name)
        treatment_data = self.results_store.get(experiment_name, "treatment", metric_name)

        # T-test for significance
        t_stat, p_value = stats.ttest_ind(control_data, treatment_data)

        return {
            "control_mean": np.mean(control_data),
            "treatment_mean": np.mean(treatment_data),
            "lift": (np.mean(treatment_data) - np.mean(control_data)) / np.mean(control_data),
            "p_value": p_value,
            "significant": p_value < 0.05,
            "control_n": len(control_data),
            "treatment_n": len(treatment_data)
        }

# Example: Testing different prompts
experiment = AIExperiment(
    name="prompt_v2_test",
    control_config={"prompt_version": "v1", "temperature": 0.7},
    treatment_config={"prompt_version": "v2", "temperature": 0.7},
    allocation_percentage=0.5
)
framework.create_experiment(experiment)

# In application
config = framework.get_config("prompt_v2_test", user_id)
response = generate_response(config)
framework.log_metric("prompt_v2_test", user_id, "user_satisfaction", rating)
```

Rigorous experimentation enables confident AI improvements based on real user impact.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
