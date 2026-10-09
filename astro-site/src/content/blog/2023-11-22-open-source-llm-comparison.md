---
title: "Open Source LLMs: Comparing Llama, Mistral, and Beyond"
description: "The open-source LLM landscape in late 2023 is richer than most enterprise teams have had time to evaluate — and the pace of model releases (Llama 2 in July…"
author: "Michael John Peña"
draft: false
date: 2023-11-22
tags: ["AI", "LLM", "Open Source", "Llama", "Mistral", "Benchmarks"]
---

The open-source LLM landscape in late 2023 is richer than most enterprise teams have had time to evaluate — and the pace of model releases (Llama 2 in July, Mistral 7B in September, Mixtral 8x7B in December) means that last quarter's comparison is already out of date. The relevant comparison for enterprise use cases isn't raw benchmark scores (MMLU, HumanEval) — it's the practical question of which model, deployed in your environment with your data, performs well enough on your tasks at an acceptable cost and latency. Llama 2 70B Chat is the strongest open-source model for general-purpose instruction following and reasoning. Mistral 7B punches above its weight in speed-to-quality trade-offs. The Code Llama variants (7B, 13B, 34B) are purpose-trained for code generation and significantly outperform the base Llama 2 models on coding tasks. The evaluation that matters is on your tasks, not on the benchmark leaderboard.

## The Open Source Landscape

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum

class ModelFamily(Enum):
    LLAMA = "Meta Llama"
    MISTRAL = "Mistral AI"
    FALCON = "TII Falcon"
    MPT = "MosaicML MPT"
    QWEN = "Alibaba Qwen"
    YI = "01.AI Yi"

@dataclass
class OpenSourceModel:
    name: str
    family: ModelFamily
    parameters: str
    context_length: int
    license: str
    release_date: str
    specialties: List[str]
    benchmark_mmlu: float
    benchmark_humaneval: float

open_source_models = [
    OpenSourceModel(
        name="Llama-2-70B-Chat",
        family=ModelFamily.LLAMA,
        parameters="70B",
        context_length=4096,
        license="Llama 2 Community",
        release_date="2023-07",
        specialties=["General chat", "Reasoning", "Instruction following"],
        benchmark_mmlu=68.9,
        benchmark_humaneval=29.9
    ),
    OpenSourceModel(
        name="Mixtral-8x7B-Instruct",
        family=ModelFamily.MISTRAL,
        parameters="46.7B (12.9B active)",
        context_length=32768,
        license="Apache 2.0",
        release_date="2023-12",
        specialties=["Long context", "Multilingual", "Efficient inference"],
        benchmark_mmlu=70.6,
        benchmark_humaneval=40.2
    ),
    OpenSourceModel(
        name="Mistral-7B-Instruct",
        family=ModelFamily.MISTRAL,
        parameters="7B",
        context_length=8192,
        license="Apache 2.0",
        release_date="2023-09",
        specialties=["Fast inference", "Cost efficient", "Good base for fine-tuning"],
        benchmark_mmlu=60.1,
        benchmark_humaneval=30.5
    ),
    OpenSourceModel(
        name="Falcon-180B-Chat",
        family=ModelFamily.FALCON,
        parameters="180B",
        context_length=2048,
        license="Falcon-180B TII License",
        release_date="2023-09",
        specialties=["Large scale", "Multilingual"],
        benchmark_mmlu=70.4,
        benchmark_humaneval=None
    ),
    OpenSourceModel(
        name="Qwen-72B-Chat",
        family=ModelFamily.QWEN,
        parameters="72B",
        context_length=32768,
        license="Qianwen License",
        release_date="2023-11",
        specialties=["Chinese-English", "Long context", "Tool use"],
        benchmark_mmlu=74.4,
        benchmark_humaneval=35.4
    )
]
```

## Comprehensive Benchmark Comparison

```python
import pandas as pd
from typing import Dict, List

def create_benchmark_comparison():
    """Create comprehensive benchmark comparison."""

    benchmarks = {
        "Model": [
            "GPT-4 (reference)",
            "GPT-3.5-Turbo",
            "Llama-2-70B",
            "Mixtral-8x7B",
            "Mistral-7B",
            "Falcon-180B",
            "Qwen-72B"
        ],
        "MMLU (knowledge)": [86.4, 70.0, 68.9, 70.6, 60.1, 70.4, 74.4],
        "HumanEval (code)": [67.0, 48.1, 29.9, 40.2, 30.5, None, 35.4],
        "GSM8K (math)": [92.0, 57.1, 56.8, 60.4, 52.2, None, 61.3],
        "ARC (reasoning)": [96.3, 85.2, 67.3, 70.2, 64.5, None, 65.4],
        "TruthfulQA": [59.0, 47.0, 45.0, 46.8, 42.1, 40.2, 52.1],
        "Context Length": [128000, 16384, 4096, 32768, 8192, 2048, 32768],
        "Relative Cost": [1.0, 0.1, 0.05, 0.04, 0.01, 0.08, 0.05]
    }

    df = pd.DataFrame(benchmarks)
    return df

def calculate_value_score(row: pd.Series) -> float:
    """Calculate value score (performance/cost)."""
    # Normalize metrics (higher is better)
    mmlu_score = row["MMLU (knowledge)"] / 100
    code_score = (row["HumanEval (code)"] or 0) / 100
    math_score = (row["GSM8K (math)"] or 0) / 100

    # Average performance
    perf_score = (mmlu_score + code_score + math_score) / 3

    # Value = performance / cost
    cost = row["Relative Cost"]
    if cost == 0:
        return 0

    return perf_score / cost

# Generate comparison
comparison = create_benchmark_comparison()
comparison["Value Score"] = comparison.apply(calculate_value_score, axis=1)
print(comparison.to_string())
```

## Use Case Decision Tree

```python
def recommend_model(requirements: dict) -> dict:
    """Recommend open source model based on requirements."""

    recommendations = {
        "model": None,
        "reason": "",
        "alternatives": [],
        "considerations": []
    }

    # Decision logic
    context_needed = requirements.get("context_length", 4096)
    budget = requirements.get("budget", "medium")  # low, medium, high
    task_type = requirements.get("task_type", "general")
    language = requirements.get("language", "english")
    latency_critical = requirements.get("latency_critical", False)
    needs_fine_tuning = requirements.get("needs_fine_tuning", False)

    # Long context requirement
    if context_needed > 8192:
        if budget == "low":
            recommendations["model"] = "Mixtral-8x7B-Instruct"
            recommendations["reason"] = "Best long-context performance at low cost"
        else:
            recommendations["model"] = "Qwen-72B-Chat"
            recommendations["reason"] = "Highest quality with 32K context"
        recommendations["alternatives"].append("Llama-2-70B with context extension")

    # Latency critical
    elif latency_critical:
        recommendations["model"] = "Mistral-7B-Instruct"
        recommendations["reason"] = "Fastest inference, good quality for simple tasks"
        recommendations["alternatives"].append("Llama-2-7B-Chat")

    # Code generation
    elif task_type == "code":
        recommendations["model"] = "Mixtral-8x7B-Instruct"
        recommendations["reason"] = "Best code generation among open models"
        recommendations["alternatives"].extend(["CodeLlama-34B", "Llama-2-70B"])

    # Fine-tuning needed
    elif needs_fine_tuning:
        if budget == "low":
            recommendations["model"] = "Mistral-7B"
            recommendations["reason"] = "Apache 2.0 license, efficient fine-tuning"
        else:
            recommendations["model"] = "Llama-2-13B"
            recommendations["reason"] = "Good balance of capability and fine-tuning cost"

    # Chinese language
    elif "chinese" in language.lower():
        recommendations["model"] = "Qwen-72B-Chat"
        recommendations["reason"] = "Superior Chinese language capabilities"

    # General purpose
    else:
        if budget == "high":
            recommendations["model"] = "Llama-2-70B-Chat"
            recommendations["reason"] = "Best general performance among open models"
        else:
            recommendations["model"] = "Mixtral-8x7B-Instruct"
            recommendations["reason"] = "Near-GPT-3.5 performance at fraction of cost"

    # Add considerations
    recommendations["considerations"] = [
        "Test on your specific use case before production",
        "Consider fine-tuning for domain-specific tasks",
        "Monitor for quality issues compared to proprietary models",
        "Check license compatibility with your use case"
    ]

    return recommendations

# Example usage
reqs = {
    "context_length": 8000,
    "budget": "medium",
    "task_type": "customer_support",
    "language": "english",
    "latency_critical": True
}

recommendation = recommend_model(reqs)
print(f"Recommended: {recommendation['model']}")
print(f"Reason: {recommendation['reason']}")
```

## Self-Hosting Considerations

```python
def calculate_infrastructure_requirements(model_size: str) -> dict:
    """Calculate infrastructure needs for self-hosting."""

    # Approximate requirements for inference
    requirements = {
        "7B": {
            "gpu": "1x A10 (24GB) or 1x A100 (40GB)",
            "memory_required_gb": 14,
            "estimated_monthly_cost_azure": 1500,
            "throughput_tokens_per_sec": 50,
            "quantization_options": ["4-bit", "8-bit", "fp16"]
        },
        "13B": {
            "gpu": "1x A100 (40GB) or 2x A10",
            "memory_required_gb": 26,
            "estimated_monthly_cost_azure": 2500,
            "throughput_tokens_per_sec": 30,
            "quantization_options": ["4-bit", "8-bit"]
        },
        "70B": {
            "gpu": "2x A100 (80GB) or 8x A10",
            "memory_required_gb": 140,
            "estimated_monthly_cost_azure": 8000,
            "throughput_tokens_per_sec": 10,
            "quantization_options": ["4-bit", "8-bit"]
        }
    }

    return requirements.get(model_size, requirements["13B"])

def compare_hosting_vs_api():
    """Compare self-hosting vs API costs."""

    analysis = """
    # Self-Hosting vs API Cost Analysis

    ## API (e.g., Azure OpenAI GPT-3.5-Turbo)
    - $0.002 per 1K tokens
    - No infrastructure management
    - Scales automatically
    - Break-even at ~750M tokens/month

    ## Self-Hosted Mistral-7B (1x A100)
    - ~$2,500/month infrastructure
    - Can process unlimited tokens
    - Requires DevOps expertise
    - Better for high-volume, predictable workloads

    ## Recommendation
    - < 500M tokens/month: Use API
    - > 1B tokens/month: Consider self-hosting
    - Variable load: Use API with self-hosted fallback
    """
    return analysis
```

## Best Practices

1. **Benchmark on your data** - Public benchmarks don't tell the full story
2. **Start small, scale up** - Begin with 7B models, increase if needed
3. **Consider quantization** - 4-bit models offer good quality/cost trade-off
4. **Plan for fine-tuning** - Choose models with permissive licenses
5. **Monitor quality** - Set up evaluation pipelines

Tomorrow, we'll dive into model benchmarking methodologies and how to evaluate models for your specific needs!
