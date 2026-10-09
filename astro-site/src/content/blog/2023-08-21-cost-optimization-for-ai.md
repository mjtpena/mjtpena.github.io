---
title: "Cost Optimization for AI Workloads"
description: "AI infrastructure costs compound quickly. A few patterns I've been applying with clients to bring Azure OpenAI and Azure ML spend under control: at the API…"
author: Michael John Peña
draft: false
date: 2023-08-21
tags:
  - Cost Optimization
  - AI
  - Azure
  - Cloud
---

AI infrastructure costs compound quickly. A few patterns I've been applying with clients to bring Azure OpenAI and Azure ML spend under control: at the API level, aggressive prompt compression (removing boilerplate from system prompts, summarising conversation history rather than sending raw turns) reduces input tokens; semantic caching avoids repeat calls for equivalent questions; and routing simpler queries to gpt-35-turbo rather than gpt-4 can cut per-call costs by 20-30x for the subset of tasks where gpt-35-turbo is sufficient. For Azure ML training, the combination of spot instances and QLoRA fine-tuning (which trains far fewer parameters than full fine-tuning, reducing required compute hours) is the highest-leverage cost reduction. At the infrastructure level, auto-scaling compute clusters to zero when idle and choosing the right VM SKU for the workload (A100 for training, T4 for inference at lower cost) prevents the common scenario where expensive GPU instances run idle overnight.

## Cost Drivers in AI

```python
cost_drivers = {
    "compute": "GPUs for training and inference",
    "storage": "Models, datasets, checkpoints",
    "api_calls": "OpenAI/Azure OpenAI usage",
    "networking": "Data transfer",
    "memory": "High-memory instances for large models"
}
```

## Compute Cost Strategies

```python
compute_optimization = {
    "right_sizing": {
        "strategy": "Use smallest GPU that fits your model",
        "example": "7B model: NC6s_v3 vs NC24 saves 75%"
    },
    "spot_instances": {
        "savings": "60-90%",
        "requirement": "Checkpointing support"
    },
    "auto_scaling": {
        "strategy": "Scale to zero when idle",
        "savings": "Pay only for active time"
    },
    "reserved_instances": {
        "commitment": "1-3 years",
        "savings": "30-60% for steady workloads"
    }
}

# Calculate optimal instance
def recommend_instance(model_size_gb, batch_size, budget_per_hour):
    instances = [
        {"name": "NC6s_v3", "vram": 16, "cost": 0.90},
        {"name": "NC12s_v3", "vram": 32, "cost": 1.80},
        {"name": "NC24ads_A100", "vram": 80, "cost": 3.67},
    ]

    for instance in instances:
        if instance["vram"] >= model_size_gb and instance["cost"] <= budget_per_hour:
            return instance

    return None
```

## API Cost Management

```python
# Token usage tracking
class TokenTracker:
    def __init__(self):
        self.total_input = 0
        self.total_output = 0
        self.costs = {
            "gpt-4": {"input": 0.03, "output": 0.06},
            "gpt-3.5-turbo": {"input": 0.0015, "output": 0.002}
        }

    def track(self, model, input_tokens, output_tokens):
        self.total_input += input_tokens
        self.total_output += output_tokens

    def get_cost(self, model):
        rates = self.costs[model]
        input_cost = (self.total_input / 1000) * rates["input"]
        output_cost = (self.total_output / 1000) * rates["output"]
        return input_cost + output_cost

# Reduce token usage
def optimize_prompt(prompt, max_tokens=1000):
    """Compress prompt to reduce tokens."""
    # Remove unnecessary whitespace
    prompt = " ".join(prompt.split())

    # Truncate if too long
    tokens = tokenizer.encode(prompt)
    if len(tokens) > max_tokens:
        tokens = tokens[:max_tokens]
        prompt = tokenizer.decode(tokens)

    return prompt
```

## Model Selection for Cost

```python
model_cost_comparison = {
    "gpt-4-turbo": {
        "quality": "Highest",
        "cost": "$$$",
        "use_for": "Complex reasoning"
    },
    "gpt-3.5-turbo": {
        "quality": "Good",
        "cost": "$",
        "use_for": "Most tasks"
    },
    "self_hosted_7b": {
        "quality": "Good for specific tasks",
        "cost": "Fixed compute cost",
        "use_for": "High volume, fine-tuned tasks"
    }
}

def select_model_for_task(task_complexity, volume_per_day):
    if volume_per_day > 10000:
        return "Consider self-hosted for cost savings"
    elif task_complexity == "simple":
        return "gpt-3.5-turbo"
    else:
        return "gpt-4-turbo"
```

## Caching Strategies

```python
import hashlib
import json

class ResponseCache:
    def __init__(self, cache_client):
        self.cache = cache_client
        self.hit_count = 0
        self.miss_count = 0

    def get_cache_key(self, prompt, model, params):
        content = json.dumps({"prompt": prompt, "model": model, **params})
        return hashlib.sha256(content.encode()).hexdigest()

    def get(self, prompt, model, params):
        key = self.get_cache_key(prompt, model, params)
        cached = self.cache.get(key)
        if cached:
            self.hit_count += 1
            return json.loads(cached)
        self.miss_count += 1
        return None

    def set(self, prompt, model, params, response, ttl=3600):
        key = self.get_cache_key(prompt, model, params)
        self.cache.set(key, json.dumps(response), ex=ttl)

    def stats(self):
        total = self.hit_count + self.miss_count
        return {
            "hit_rate": self.hit_count / total if total > 0 else 0,
            "estimated_savings": self.hit_count * 0.01  # Rough estimate
        }
```

## Cost Monitoring Dashboard

```python
def generate_cost_report(workspace, time_range="7d"):
    """Generate AI cost report."""
    report = {
        "compute_costs": get_compute_costs(workspace, time_range),
        "api_costs": get_api_costs(time_range),
        "storage_costs": get_storage_costs(workspace, time_range),
        "recommendations": []
    }

    # Generate recommendations
    if report["compute_costs"]["idle_percent"] > 30:
        report["recommendations"].append(
            "Reduce idle time with auto-scaling"
        )

    if report["api_costs"]["cache_hit_rate"] < 20:
        report["recommendations"].append(
            "Implement response caching"
        )

    return report
```

## Budget Alerts

```python
from azure.mgmt.consumption import ConsumptionManagementClient

def set_budget_alert(subscription_id, budget_amount, alert_threshold=80):
    """Set up budget alerts for AI spending."""
    # Create budget with alerts
    budget = {
        "name": "ai-workload-budget",
        "amount": budget_amount,
        "category": "Cost",
        "timeGrain": "Monthly",
        "notifications": {
            "alert1": {
                "enabled": True,
                "threshold": alert_threshold,
                "contactEmails": ["team@company.com"]
            }
        }
    }
    return budget
```

Tomorrow we'll explore Azure OpenAI quotas and rate limits.

## Resources

- [Azure Cost Management](https://learn.microsoft.com/en-us/azure/cost-management-billing/)
- [OpenAI Pricing](https://openai.com/pricing)
- [Azure ML Cost Optimization](https://learn.microsoft.com/en-us/azure/machine-learning/how-to-manage-optimize-cost)
