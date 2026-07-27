---
title: "Temperature and Top-P: Fine-Tuning Azure OpenAI Response Creativity"
author: Michael John Peña
draft: false
date: 2023-01-16
tags:
  - Azure
  - OpenAI
  - Parameters
  - AI
  - Configuration

---

I wrote "Temperature and Top-P: Fine-Tuning Azure OpenAI Response Creativity" to share practical, production-minded guidance on this topic.

## Understanding Temperature

Temperature controls randomness in token selection:

- **Temperature = 0**: Nearly deterministic, always picks the most likely token
- **Temperature = 1**: Standard randomness, samples according to probability
- **Temperature > 1**: More random, flattens probability distribution
- **Temperature < 1**: More focused, sharpens probability distribution

```python
import openai
from typing import List

def demonstrate_temperature(
    prompt: str,
    temperatures: List[float],
    deployment: str = "gpt35"
) -> dict:
    """Show how temperature affects outputs."""
    results = {}

    for temp in temperatures:
        responses = []

        # Generate multiple responses at each temperature
        for _ in range(3):
            response = openai.Completion.create(
                engine=deployment,
                prompt=prompt,
                max_tokens=50,
                temperature=temp
            )
            responses.append(response.choices[0].text.strip())

        results[temp] = {
            "responses": responses,
            "unique_count": len(set(responses)),
            "variance": "low" if len(set(responses)) == 1 else "high"
        }

    return results

# Example
results = demonstrate_temperature(
    prompt="Write a creative tagline for a cloud computing company:",
    temperatures=[0.0, 0.5, 1.0, 1.5]
)

for temp, data in results.items():
    print(f"\nTemperature {temp}:")
    print(f"  Unique responses: {data['unique_count']}/3")
    for r in data['responses']:
        print(f"  - {r[:60]}...")
```

## Understanding Top-P (Nucleus Sampling)

Top-P limits token selection to a cumulative probability threshold:

- **Top-P = 1.0**: Consider all tokens
- **Top-P = 0.9**: Consider tokens comprising top 90% of probability mass
- **Top-P = 0.1**: Only consider the very top tokens

```python
def demonstrate_top_p(
    prompt: str,
    top_p_values: List[float],
    deployment: str = "gpt35"
) -> dict:
    """Show how top_p affects outputs."""
    results = {}

    for top_p in top_p_values:
        responses = []

        for _ in range(3):
            response = openai.Completion.create(
                engine=deployment,
                prompt=prompt,
                max_tokens=50,
                temperature=1.0,  # Keep temperature constant
                top_p=top_p
            )
            responses.append(response.choices[0].text.strip())

        results[top_p] = {
            "responses": responses,
            "unique_count": len(set(responses))
        }

    return results

# Example
results = demonstrate_top_p(
    prompt="Complete this sentence creatively: The cloud is like",
    top_p_values=[0.1, 0.5, 0.9, 1.0]
)
```

## Temperature vs Top-P: When to Use Each

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class SamplingConfig:
    """Configuration for sampling parameters."""
    temperature: float
    top_p: float
    use_case: str
    description: str

# Recommended configurations for different use cases
SAMPLING_CONFIGS = {
    "factual_qa": SamplingConfig(
        temperature=0.0,
        top_p=1.0,
        use_case="Factual Q&A, data extraction",
        description="Deterministic output for consistent, factual responses"
    ),

    "code_generation": SamplingConfig(
        temperature=0.2,
        top_p=0.95,
        use_case="Code generation, SQL queries",
        description="Low randomness for syntactically correct code"
    ),

    "summarization": SamplingConfig(
        temperature=0.3,
        top_p=0.9,
        use_case="Document summarization",
        description="Slight variation while maintaining accuracy"
    ),

    "conversational": SamplingConfig(
        temperature=0.7,
        top_p=0.9,
        use_case="Chatbots, conversational AI",
        description="Natural, varied responses"
    ),

    "creative_writing": SamplingConfig(
        temperature=0.9,
        top_p=0.95,
        use_case="Creative writing, brainstorming",
        description="High creativity and variation"
    ),

    "experimental": SamplingConfig(
        temperature=1.2,
        top_p=1.0,
        use_case="Highly creative, experimental",
        description="Maximum randomness (may be incoherent)"
    )
}

def get_sampling_config(use_case: str) -> SamplingConfig:
    """Get recommended sampling config for a use case."""
    if use_case not in SAMPLING_CONFIGS:
        raise ValueError(f"Unknown use case. Available: {list(SAMPLING_CONFIGS.keys())}")
    return SAMPLING_CONFIGS[use_case]

def create_completion_with_config(
    prompt: str,
    use_case: str,
    deployment: str = "gpt35",
    max_tokens: int = 500
) -> str:
    """Create completion using recommended config."""
    config = get_sampling_config(use_case)

    response = openai.Completion.create(
        engine=deployment,
        prompt=prompt,
        max_tokens=max_tokens,
        temperature=config.temperature,
        top_p=config.top_p
    )

    return response.choices[0].text.strip()

# Usage
code = create_completion_with_config(
    prompt="Write a Python function to calculate Fibonacci numbers:",
    use_case="code_generation"
)

creative = create_completion_with_config(
    prompt="Write the opening paragraph of a sci-fi story:",
    use_case="creative_writing"
)
```

## Frequency and Presence Penalties

Additional parameters to control repetition:

```python
@dataclass
class GenerationConfig:
    """Complete generation configuration."""
    temperature: float = 0.7
    top_p: float = 1.0
    frequency_penalty: float = 0.0  # -2.0 to 2.0, penalizes frequent tokens
    presence_penalty: float = 0.0   # -2.0 to 2.0, penalizes any repeat

class SmartGenerator:
    """Generate text with smart parameter selection."""

    def __init__(self, deployment: str):
        self.deployment = deployment

    def generate(
        self,
        prompt: str,
        config: GenerationConfig,
        max_tokens: int = 500
    ) -> str:
        """Generate with specified configuration."""
        response = openai.Completion.create(
            engine=self.deployment,
            prompt=prompt,
            max_tokens=max_tokens,
            temperature=config.temperature,
            top_p=config.top_p,
            frequency_penalty=config.frequency_penalty,
            presence_penalty=config.presence_penalty
        )
        return response.choices[0].text.strip()

    def generate_diverse_list(
        self,
        prompt: str,
        num_items: int = 5
    ) -> str:
        """Generate diverse list with anti-repetition."""
        config = GenerationConfig(
            temperature=0.8,
            top_p=0.95,
            frequency_penalty=0.5,  # Reduce word repetition
            presence_penalty=0.3   # Encourage new topics
        )

        full_prompt = f"{prompt}\n\nProvide {num_items} diverse and unique items:"
        return self.generate(full_prompt, config)

    def generate_focused(self, prompt: str) -> str:
        """Generate focused, on-topic response."""
        config = GenerationConfig(
            temperature=0.3,
            top_p=0.8,
            frequency_penalty=0.0,
            presence_penalty=0.0
        )
        return self.generate(prompt, config)

    def generate_creative(self, prompt: str) -> str:
        """Generate creative, varied response."""
        config = GenerationConfig(
            temperature=1.0,
            top_p=0.95,
            frequency_penalty=0.3,
            presence_penalty=0.3
        )
        return self.generate(prompt, config)

# Usage
generator = SmartGenerator("gpt35")

# Diverse list generation
ideas = generator.generate_diverse_list(
    "Azure services for building a modern data platform"
)

# Focused technical response
technical = generator.generate_focused(
    "Explain how Azure Cosmos DB partitioning works:"
)
```

## A/B Testing Parameters

Test different configurations to find optimal settings:

```python
from dataclasses import dataclass, field
from typing import Dict, List, Callable
import random
import statistics

@dataclass
class ABTestResult:
    """Result of an A/B test."""
    config_a: GenerationConfig
    config_b: GenerationConfig
    scores_a: List[float]
    scores_b: List[float]
    winner: str
    confidence: float

class ParameterTester:
    """A/B test different parameter configurations."""

    def __init__(
        self,
        deployment: str,
        evaluator: Callable[[str, str], float] = None
    ):
        self.deployment = deployment
        self.generator = SmartGenerator(deployment)
        # Default evaluator: response length (replace with actual metrics)
        self.evaluator = evaluator or (lambda prompt, response: len(response))

    def test_configurations(
        self,
        prompts: List[str],
        config_a: GenerationConfig,
        config_b: GenerationConfig,
        num_iterations: int = 10
    ) -> ABTestResult:
        """Test two configurations against each other."""
        scores_a = []
        scores_b = []

        for prompt in prompts:
            for _ in range(num_iterations):
                # Generate with config A
                response_a = self.generator.generate(prompt, config_a)
                score_a = self.evaluator(prompt, response_a)
                scores_a.append(score_a)

                # Generate with config B
                response_b = self.generator.generate(prompt, config_b)
                score_b = self.evaluator(prompt, response_b)
                scores_b.append(score_b)

        mean_a = statistics.mean(scores_a)
        mean_b = statistics.mean(scores_b)

        # Simple winner determination (use proper statistical tests in production)
        winner = "A" if mean_a > mean_b else "B"
        difference = abs(mean_a - mean_b) / max(mean_a, mean_b)

        return ABTestResult(
            config_a=config_a,
            config_b=config_b,
            scores_a=scores_a,
            scores_b=scores_b,
            winner=winner,
            confidence=difference
        )

    def find_optimal_temperature(
        self,
        prompts: List[str],
        temperature_range: List[float] = None
    ) -> Dict[float, float]:
        """Find optimal temperature for given prompts."""
        temperatures = temperature_range or [0.0, 0.3, 0.5, 0.7, 0.9, 1.0]
        results = {}

        for temp in temperatures:
            config = GenerationConfig(temperature=temp)
            scores = []

            for prompt in prompts:
                response = self.generator.generate(prompt, config)
                score = self.evaluator(prompt, response)
                scores.append(score)

            results[temp] = statistics.mean(scores)

        return results

# Custom evaluator for code quality
def code_quality_evaluator(prompt: str, response: str) -> float:
    """Simple code quality heuristic."""
    score = 0.0

    # Has code block
    if "```" in response or "def " in response or "function" in response:
        score += 1.0

    # Has comments
    if "#" in response or "//" in response:
        score += 0.5

    # Reasonable length
    if 100 < len(response) < 2000:
        score += 0.5

    return score

# Usage
# tester = ParameterTester("gpt35", evaluator=code_quality_evaluator)
# results = tester.find_optimal_temperature(
#     prompts=["Write a Python function to sort a list"],
#     temperature_range=[0.0, 0.2, 0.4, 0.6]
# )
```

## Dynamic Parameter Adjustment

Adjust parameters based on context:

```python
class AdaptiveGenerator:
    """Dynamically adjust parameters based on context."""

    def __init__(self, deployment: str):
        self.deployment = deployment

    def analyze_prompt(self, prompt: str) -> GenerationConfig:
        """Analyze prompt and select appropriate config."""
        prompt_lower = prompt.lower()

        # Code-related prompts
        if any(kw in prompt_lower for kw in ["code", "function", "implement", "write a program"]):
            return GenerationConfig(temperature=0.2, top_p=0.95)

        # Factual questions
        if any(kw in prompt_lower for kw in ["what is", "explain", "how does", "describe"]):
            return GenerationConfig(temperature=0.3, top_p=0.9)

        # Creative prompts
        if any(kw in prompt_lower for kw in ["creative", "imagine", "story", "brainstorm"]):
            return GenerationConfig(temperature=0.9, top_p=0.95, presence_penalty=0.3)

        # List generation
        if any(kw in prompt_lower for kw in ["list", "enumerate", "give me examples"]):
            return GenerationConfig(temperature=0.7, frequency_penalty=0.5)

        # Default
        return GenerationConfig(temperature=0.7, top_p=0.9)

    def generate(self, prompt: str, max_tokens: int = 500) -> dict:
        """Generate with auto-selected parameters."""
        config = self.analyze_prompt(prompt)

        response = openai.Completion.create(
            engine=self.deployment,
            prompt=prompt,
            max_tokens=max_tokens,
            temperature=config.temperature,
            top_p=config.top_p,
            frequency_penalty=config.frequency_penalty,
            presence_penalty=config.presence_penalty
        )

        return {
            "response": response.choices[0].text.strip(),
            "config_used": config,
            "analysis": f"Detected prompt type and used temp={config.temperature}"
        }

# Usage
adaptive = AdaptiveGenerator("gpt35")

# Will use low temperature
code_result = adaptive.generate("Write a Python function to parse JSON")

# Will use high temperature
creative_result = adaptive.generate("Imagine a world where clouds are made of data")
```

## Best Practices

1. **Don't use both temperature and top_p together**: OpenAI recommends adjusting one, not both
2. **Start conservative**: Begin with lower temperature for production
3. **Test systematically**: Use A/B testing to find optimal values
4. **Match task requirements**: Factual = low temp, creative = high temp
5. **Consider penalties**: Use frequency/presence penalties for diverse outputs
6. **Monitor outputs**: Track quality metrics with different configurations

## Quick Reference

| Use Case | Temperature | Top-P | Notes |
|----------|-------------|-------|-------|
| Code generation | 0.0-0.2 | 0.95 | Deterministic, correct syntax |
| Factual Q&A | 0.0-0.3 | 0.9 | Consistent, accurate |
| Summarization | 0.3-0.5 | 0.9 | Slight variation |
| Conversational | 0.7 | 0.9 | Natural responses |
| Creative writing | 0.8-1.0 | 0.95 | High variety |
| Brainstorming | 0.9+ | 1.0 | Maximum creativity |

## Resources

- [Azure OpenAI Parameters](https://learn.microsoft.com/azure/cognitive-services/openai/reference)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference/completions)
- [Sampling Methods Explained](https://towardsdatascience.com/how-to-sample-from-language-models-682bceb97277)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
