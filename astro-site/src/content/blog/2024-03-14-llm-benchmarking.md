---
title: "LLM Benchmarking: Understanding Model Performance"
author: "Michael John Peña"
draft: false
date: 2024-03-14
tags: ["AI", "LLM", "Benchmarking", "Evaluation", "Machine Learning"]

---

I wrote "LLM Benchmarking: Understanding Model Performance" to share practical, production-minded guidance on this topic.

Understanding LLM benchmarks is essential for making informed model selection decisions. This guide covers the major benchmarks and how to interpret their results.

## Major LLM Benchmarks

```python
from dataclasses import dataclass
from typing import List, Dict
from enum import Enum

class BenchmarkCategory(Enum):
    REASONING = "reasoning"
    KNOWLEDGE = "knowledge"
    CODING = "coding"
    MATH = "math"
    LANGUAGE = "language"

@dataclass
class Benchmark:
    name: str
    category: BenchmarkCategory
    description: str
    metric: str
    human_baseline: float

benchmarks = [
    Benchmark(
        name="MMLU",
        category=BenchmarkCategory.KNOWLEDGE,
        description="Massive Multitask Language Understanding - 57 subjects",
        metric="accuracy",
        human_baseline=0.898
    ),
    Benchmark(
        name="HumanEval",
        category=BenchmarkCategory.CODING,
        description="Python coding problems with unit tests",
        metric="pass@1",
        human_baseline=None  # Varies by developer
    ),
    Benchmark(
        name="GSM8K",
        category=BenchmarkCategory.MATH,
        description="Grade school math word problems",
        metric="accuracy",
        human_baseline=0.95
    ),
    Benchmark(
        name="HellaSwag",
        category=BenchmarkCategory.REASONING,
        description="Commonsense reasoning completion",
        metric="accuracy",
        human_baseline=0.954
    ),
    Benchmark(
        name="TruthfulQA",
        category=BenchmarkCategory.KNOWLEDGE,
        description="Questions testing truthfulness",
        metric="MC1 accuracy",
        human_baseline=0.94
    ),
    Benchmark(
        name="ARC-Challenge",
        category=BenchmarkCategory.REASONING,
        description="AI2 Reasoning Challenge - hard science questions",
        metric="accuracy",
        human_baseline=None
    ),
    Benchmark(
        name="MATH",
        category=BenchmarkCategory.MATH,
        description="Competition mathematics problems",
        metric="accuracy",
        human_baseline=0.90  # Expert mathematicians
    )
]
```

## Model Performance Database

```python
from typing import Optional

@dataclass
class ModelScore:
    model_name: str
    benchmark: str
    score: float
    date: str
    notes: Optional[str] = None

# March 2024 benchmark data
model_scores = [
    # Claude 3 Opus
    ModelScore("Claude 3 Opus", "MMLU", 0.868, "2024-03-04"),
    ModelScore("Claude 3 Opus", "HumanEval", 0.849, "2024-03-04"),
    ModelScore("Claude 3 Opus", "GSM8K", 0.950, "2024-03-04"),
    ModelScore("Claude 3 Opus", "HellaSwag", 0.953, "2024-03-04"),

    # GPT-4 Turbo
    ModelScore("GPT-4 Turbo", "MMLU", 0.864, "2024-01-25"),
    ModelScore("GPT-4 Turbo", "HumanEval", 0.670, "2024-01-25"),
    ModelScore("GPT-4 Turbo", "GSM8K", 0.920, "2024-01-25"),
    ModelScore("GPT-4 Turbo", "HellaSwag", 0.950, "2024-01-25"),

    # Llama 2 70B
    ModelScore("Llama 2 70B", "MMLU", 0.689, "2023-07-18"),
    ModelScore("Llama 2 70B", "HumanEval", 0.298, "2023-07-18"),
    ModelScore("Llama 2 70B", "GSM8K", 0.568, "2023-07-18"),

    # Mistral Large
    ModelScore("Mistral Large", "MMLU", 0.812, "2024-02-26"),
    ModelScore("Mistral Large", "HumanEval", 0.451, "2024-02-26"),
    ModelScore("Mistral Large", "GSM8K", 0.810, "2024-02-26"),
]

def compare_models(benchmark: str) -> List[tuple]:
    """Compare all models on a specific benchmark"""
    scores = [s for s in model_scores if s.benchmark == benchmark]
    scores.sort(key=lambda x: x.score, reverse=True)
    return [(s.model_name, s.score) for s in scores]

# Compare on MMLU
print("MMLU Rankings:")
for model, score in compare_models("MMLU"):
    print(f"  {model}: {score:.1%}")
```

## Running Your Own Benchmarks

```python
import json
from typing import Callable
import anthropic
from openai import OpenAI

class BenchmarkRunner:
    def __init__(self):
        self.anthropic = anthropic.Anthropic()
        self.openai = OpenAI()

    def run_mmlu_sample(
        self,
        model: str,
        provider: str,
        questions: List[dict]
    ) -> float:
        """Run MMLU-style questions"""
        correct = 0

        for q in questions:
            prompt = f"""Answer the following multiple choice question.
Reply with only the letter (A, B, C, or D).

Question: {q['question']}

A) {q['choices'][0]}
B) {q['choices'][1]}
C) {q['choices'][2]}
D) {q['choices'][3]}

Answer:"""

            if provider == "anthropic":
                response = self.anthropic.messages.create(
                    model=model,
                    max_tokens=1,
                    messages=[{"role": "user", "content": prompt}]
                )
                answer = response.content[0].text.strip().upper()
            else:
                response = self.openai.chat.completions.create(
                    model=model,
                    max_tokens=1,
                    messages=[{"role": "user", "content": prompt}]
                )
                answer = response.choices[0].message.content.strip().upper()

            correct_letter = chr(65 + q['answer'])  # 0->A, 1->B, etc.
            if answer == correct_letter:
                correct += 1

        return correct / len(questions)

    def run_coding_benchmark(
        self,
        model: str,
        provider: str,
        problems: List[dict],
        executor: Callable
    ) -> float:
        """Run HumanEval-style coding problems"""
        passed = 0

        for problem in problems:
            prompt = f"""Complete the following Python function.
Return only the function implementation, no explanations.

{problem['prompt']}"""

            if provider == "anthropic":
                response = self.anthropic.messages.create(
                    model=model,
                    max_tokens=500,
                    messages=[{"role": "user", "content": prompt}]
                )
                code = response.content[0].text
            else:
                response = self.openai.chat.completions.create(
                    model=model,
                    max_tokens=500,
                    messages=[{"role": "user", "content": prompt}]
                )
                code = response.choices[0].message.content

            # Execute tests
            try:
                result = executor(code, problem['test_cases'])
                if result:
                    passed += 1
            except Exception as e:
                pass  # Test failed

        return passed / len(problems)

# Example usage
runner = BenchmarkRunner()

sample_questions = [
    {
        "question": "What is the capital of France?",
        "choices": ["London", "Berlin", "Paris", "Madrid"],
        "answer": 2  # Paris
    },
    # Add more questions...
]

score = runner.run_mmlu_sample(
    model="claude-3-opus-20240229",
    provider="anthropic",
    questions=sample_questions
)
print(f"MMLU Sample Score: {score:.1%}")
```

## Visualizing Benchmark Results

```python
import matplotlib.pyplot as plt
import numpy as np

def plot_model_comparison(scores: List[ModelScore]):
    """Create radar chart comparing models"""

    models = list(set(s.model_name for s in scores))
    benchmarks = list(set(s.benchmark for s in scores))

    # Create score matrix
    score_matrix = {}
    for model in models:
        score_matrix[model] = {}
        for benchmark in benchmarks:
            matching = [s for s in scores
                       if s.model_name == model and s.benchmark == benchmark]
            score_matrix[model][benchmark] = matching[0].score if matching else 0

    # Plot
    angles = np.linspace(0, 2 * np.pi, len(benchmarks), endpoint=False).tolist()
    angles += angles[:1]  # Close the plot

    fig, ax = plt.subplots(figsize=(10, 10), subplot_kw=dict(polar=True))

    for model in models:
        values = [score_matrix[model].get(b, 0) for b in benchmarks]
        values += values[:1]
        ax.plot(angles, values, label=model, linewidth=2)
        ax.fill(angles, values, alpha=0.1)

    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(benchmarks)
    ax.set_ylim(0, 1)
    ax.legend(loc='upper right', bbox_to_anchor=(1.3, 1.0))
    ax.set_title("Model Benchmark Comparison")

    plt.tight_layout()
    plt.savefig("benchmark_comparison.png")
    plt.show()

# Generate comparison
plot_model_comparison(model_scores)
```

## Key Insights

1. **No single benchmark tells the whole story** - Use multiple benchmarks
2. **Domain-specific evaluation is crucial** - Test on your actual use case
3. **Benchmark scores can be gamed** - Be skeptical of outlier results
4. **Human baselines matter** - Compare against human performance

## Conclusion

Benchmarks provide useful signals but shouldn't be the only factor in model selection. Always validate with your specific use cases and data.

