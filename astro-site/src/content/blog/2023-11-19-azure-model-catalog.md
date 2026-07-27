---
title: "Azure Model Catalog: Choosing the Right AI Model"
author: "Michael John Peña"
draft: false
date: 2023-11-19
tags: ["Azure", "Model Catalog", "AI", "LLM", "Machine Learning"]

---

I wrote "Azure Model Catalog: Choosing the Right AI Model" to share practical, production-minded guidance on this topic.

The Azure Model Catalog (available in Azure AI Studio and Azure ML) is where Microsoft is building the answer to the model selection question — "which foundation model should I use for this task?" — by providing a browsable, filterable catalog of models from Azure OpenAI, Meta (Llama 2), Mistral AI, Stability AI, Cohere, and other providers, with standardised deployment options and benchmark comparisons. The practical value: instead of evaluating models across different APIs, documentation sets, and pricing models, you can evaluate and deploy models from the catalog through a unified interface. The operational benefit for enterprise: models deployed from the Azure Model Catalog come with Azure's RBAC, networking, and compliance controls regardless of the underlying model provider. The model selection decision isn't purely technical — licence terms, data residency, and cost per token are all in the catalog metadata.

## Understanding the Model Catalog

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from enum import Enum

class ModelCapability(Enum):
    TEXT_GENERATION = "text-generation"
    CHAT_COMPLETION = "chat-completion"
    EMBEDDING = "embedding"
    IMAGE_GENERATION = "image-generation"
    SPEECH_TO_TEXT = "speech-to-text"
    TEXT_TO_SPEECH = "text-to-speech"
    VISION = "vision"
    CODE_GENERATION = "code-generation"

class ModelProvider(Enum):
    OPENAI = "OpenAI"
    META = "Meta"
    MISTRAL = "Mistral AI"
    MICROSOFT = "Microsoft"
    COHERE = "Cohere"
    HUGGING_FACE = "Hugging Face"

@dataclass
class ModelSpec:
    name: str
    provider: ModelProvider
    capabilities: List[ModelCapability]
    context_window: int
    parameters: str  # e.g., "7B", "70B", "175B"
    license: str
    pricing_tier: str
    recommended_use_cases: List[str]
    limitations: List[str]

# Model catalog entries
model_catalog = {
    "gpt-4-turbo": ModelSpec(
        name="GPT-4 Turbo",
        provider=ModelProvider.OPENAI,
        capabilities=[
            ModelCapability.CHAT_COMPLETION,
            ModelCapability.CODE_GENERATION,
            ModelCapability.VISION
        ],
        context_window=128000,
        parameters="~1.7T (estimated)",
        license="Proprietary",
        pricing_tier="Premium",
        recommended_use_cases=[
            "Complex reasoning tasks",
            "Long document analysis",
            "Multi-modal applications",
            "Code generation and review"
        ],
        limitations=[
            "Higher cost",
            "Latency for large contexts",
            "API rate limits"
        ]
    ),
    "gpt-35-turbo": ModelSpec(
        name="GPT-3.5 Turbo",
        provider=ModelProvider.OPENAI,
        capabilities=[
            ModelCapability.CHAT_COMPLETION,
            ModelCapability.CODE_GENERATION
        ],
        context_window=16384,
        parameters="~175B",
        license="Proprietary",
        pricing_tier="Standard",
        recommended_use_cases=[
            "General chat applications",
            "Simple Q&A",
            "Content generation",
            "Cost-sensitive applications"
        ],
        limitations=[
            "Less capable for complex reasoning",
            "Smaller context window"
        ]
    ),
    "llama-2-70b-chat": ModelSpec(
        name="Llama 2 70B Chat",
        provider=ModelProvider.META,
        capabilities=[ModelCapability.CHAT_COMPLETION],
        context_window=4096,
        parameters="70B",
        license="Llama 2 License",
        pricing_tier="Standard",
        recommended_use_cases=[
            "Open-source deployments",
            "Fine-tuning scenarios",
            "Self-hosted applications",
            "Research and experimentation"
        ],
        limitations=[
            "Smaller context window",
            "May need fine-tuning for specific tasks",
            "Less capable than GPT-4"
        ]
    ),
    "mistral-7b-instruct": ModelSpec(
        name="Mistral 7B Instruct",
        provider=ModelProvider.MISTRAL,
        capabilities=[ModelCapability.CHAT_COMPLETION],
        context_window=8192,
        parameters="7B",
        license="Apache 2.0",
        pricing_tier="Economy",
        recommended_use_cases=[
            "Cost-efficient deployments",
            "Edge scenarios",
            "High-volume, simple tasks",
            "Fine-tuning base"
        ],
        limitations=[
            "Limited capability for complex tasks",
            "Smaller parameter count"
        ]
    )
}
```

## Model Selection Framework

```python
from typing import Callable

class ModelSelector:
    def __init__(self, catalog: Dict[str, ModelSpec]):
        self.catalog = catalog

    def find_models(
        self,
        required_capabilities: List[ModelCapability],
        min_context_window: int = 0,
        max_pricing_tier: str = "Premium",
        provider: ModelProvider = None
    ) -> List[ModelSpec]:
        """Find models matching requirements."""
        tier_order = ["Economy", "Standard", "Premium"]
        max_tier_idx = tier_order.index(max_pricing_tier)

        matches = []
        for model in self.catalog.values():
            # Check capabilities
            if not all(cap in model.capabilities for cap in required_capabilities):
                continue

            # Check context window
            if model.context_window < min_context_window:
                continue

            # Check pricing tier
            if tier_order.index(model.pricing_tier) > max_tier_idx:
                continue

            # Check provider
            if provider and model.provider != provider:
                continue

            matches.append(model)

        return sorted(matches, key=lambda m: m.context_window, reverse=True)

    def recommend_for_use_case(self, use_case: str) -> List[tuple]:
        """Recommend models for a specific use case."""
        recommendations = []

        use_case_lower = use_case.lower()

        for name, model in self.catalog.items():
            score = 0
            for rec_use_case in model.recommended_use_cases:
                if any(word in rec_use_case.lower() for word in use_case_lower.split()):
                    score += 1

            if score > 0:
                recommendations.append((model, score))

        return sorted(recommendations, key=lambda x: x[1], reverse=True)

# Usage
selector = ModelSelector(model_catalog)

# Find models for document analysis
doc_models = selector.find_models(
    required_capabilities=[ModelCapability.CHAT_COMPLETION],
    min_context_window=32000
)
print("Models for long document analysis:")
for model in doc_models:
    print(f"  - {model.name}: {model.context_window} tokens")

# Get recommendations
recs = selector.recommend_for_use_case("code review and generation")
print("\nRecommended for code tasks:")
for model, score in recs:
    print(f"  - {model.name} (score: {score})")
```

## Cost-Performance Analysis

```python
@dataclass
class ModelBenchmark:
    model_name: str
    task: str
    accuracy: float
    latency_ms: float
    cost_per_1k_tokens: float
    throughput_tokens_per_sec: float

def calculate_cost_efficiency(benchmarks: List[ModelBenchmark]) -> Dict[str, float]:
    """Calculate cost-efficiency scores."""
    results = {}

    for benchmark in benchmarks:
        # Cost efficiency = accuracy / cost (higher is better)
        cost_efficiency = benchmark.accuracy / max(benchmark.cost_per_1k_tokens, 0.001)

        # Latency-adjusted score
        latency_factor = 1000 / max(benchmark.latency_ms, 1)  # Inverse of latency

        # Combined score
        combined_score = cost_efficiency * 0.6 + latency_factor * 0.4

        results[benchmark.model_name] = {
            "accuracy": benchmark.accuracy,
            "cost_efficiency": cost_efficiency,
            "latency_score": latency_factor,
            "combined_score": combined_score
        }

    return results

# Example benchmarks
benchmarks = [
    ModelBenchmark("gpt-4-turbo", "reasoning", 0.95, 2000, 0.01, 50),
    ModelBenchmark("gpt-35-turbo", "reasoning", 0.82, 500, 0.002, 200),
    ModelBenchmark("llama-2-70b", "reasoning", 0.78, 1500, 0.005, 80),
    ModelBenchmark("mistral-7b", "reasoning", 0.72, 200, 0.001, 500)
]

efficiency = calculate_cost_efficiency(benchmarks)
for model, scores in efficiency.items():
    print(f"{model}: Combined Score = {scores['combined_score']:.2f}")
```

## Decision Matrix

```python
def create_decision_matrix(requirements: dict) -> str:
    """Create a decision matrix for model selection."""

    matrix = """
# Model Selection Decision Matrix

## Your Requirements
- Primary Use Case: {use_case}
- Context Needed: {context} tokens
- Budget: {budget}
- Latency Requirement: {latency}

## Recommendation Matrix

| Criteria | GPT-4 Turbo | GPT-3.5 Turbo | Llama 2 70B | Mistral 7B |
|----------|-------------|---------------|-------------|------------|
| Capability | ★★★★★ | ★★★☆☆ | ★★★☆☆ | ★★☆☆☆ |
| Context | ★★★★★ | ★★★☆☆ | ★★☆☆☆ | ★★★☆☆ |
| Cost | ★★☆☆☆ | ★★★★☆ | ★★★★☆ | ★★★★★ |
| Latency | ★★★☆☆ | ★★★★☆ | ★★★☆☆ | ★★★★★ |
| Customizable | ★☆☆☆☆ | ★★☆☆☆ | ★★★★★ | ★★★★★ |

## Recommended Choice
Based on your requirements, we recommend: **{recommendation}**

Reasoning: {reasoning}
""".format(**requirements)

    return matrix

# Example
requirements = {
    "use_case": "Customer support chatbot",
    "context": "4000",
    "budget": "Medium",
    "latency": "< 1 second",
    "recommendation": "GPT-3.5 Turbo",
    "reasoning": "Balances capability with cost for chat scenarios. Consider GPT-4 Turbo for complex queries."
}

print(create_decision_matrix(requirements))
```

## Best Practices

1. **Start with benchmarks** - Test models on your actual data
2. **Consider total cost** - Include infrastructure, not just API costs
3. **Plan for scale** - What works in dev may not work in production
4. **Have fallback models** - Use routing for cost optimization
5. **Monitor quality** - Model performance can vary over time

Tomorrow, we'll explore Mistral models on Azure and their unique capabilities!\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
