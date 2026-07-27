---
title: "LLM Benchmarking: Evaluating Models for Your Use Case"
author: "Michael John Peña"
draft: false
date: 2023-11-23
tags: ["AI", "LLM", "Benchmarking", "Evaluation", "Machine Learning"]

---

I wrote "LLM Benchmarking: Evaluating Models for Your Use Case" to share practical, production-minded guidance on this topic.

LLM benchmarking methodology matters more than the benchmark scores themselves, because the standard public benchmarks (MMLU for general knowledge, HumanEval for code generation, HellaSwag for commonsense reasoning, TruthfulQA for accuracy) measure specific capabilities in specific formats that may not reflect your application's actual requirements. A model that tops MMLU may still fail on your specific domain because the evaluation questions are multiple-choice academic problems, not the open-ended extraction tasks your application performs. The evaluation methodology I recommend building before making a model selection decision: a representative sample of 50-200 real examples from your use case, evaluated on the dimensions that matter for your application (accuracy, format adherence, latency, cost), run consistently across candidate models. This is task-based evaluation, not benchmark-based selection, and it's the only approach that gives you reliable signal for the specific deployment context.

## Understanding Standard Benchmarks

```python
from dataclasses import dataclass
from typing import List, Dict, Callable
from enum import Enum

class BenchmarkCategory(Enum):
    KNOWLEDGE = "World Knowledge"
    REASONING = "Reasoning & Logic"
    CODE = "Code Generation"
    MATH = "Mathematical Ability"
    LANGUAGE = "Language Understanding"
    SAFETY = "Safety & Ethics"

@dataclass
class StandardBenchmark:
    name: str
    category: BenchmarkCategory
    description: str
    metric: str
    what_it_measures: str
    limitations: List[str]

standard_benchmarks = {
    "MMLU": StandardBenchmark(
        name="MMLU",
        category=BenchmarkCategory.KNOWLEDGE,
        description="Massive Multitask Language Understanding",
        metric="Accuracy (%)",
        what_it_measures="Knowledge across 57 subjects from STEM to humanities",
        limitations=[
            "Multiple choice format may not reflect real-world use",
            "Memorization can inflate scores",
            "Doesn't test reasoning depth"
        ]
    ),
    "HumanEval": StandardBenchmark(
        name="HumanEval",
        category=BenchmarkCategory.CODE,
        description="Code generation benchmark",
        metric="pass@k",
        what_it_measures="Ability to generate working Python functions",
        limitations=[
            "Only Python",
            "Relatively simple problems",
            "Doesn't test debugging or refactoring"
        ]
    ),
    "GSM8K": StandardBenchmark(
        name="GSM8K",
        category=BenchmarkCategory.MATH,
        description="Grade School Math 8K",
        metric="Accuracy (%)",
        what_it_measures="Multi-step mathematical reasoning",
        limitations=[
            "Only grade-school level",
            "Word problems may have specific patterns",
            "Chain-of-thought prompting inflates scores"
        ]
    ),
    "TruthfulQA": StandardBenchmark(
        name="TruthfulQA",
        category=BenchmarkCategory.SAFETY,
        description="Truthfulness evaluation",
        metric="MC1/MC2 Accuracy",
        what_it_measures="Resistance to common misconceptions",
        limitations=[
            "Limited question set",
            "May not cover domain-specific misinformation",
            "Binary truth assessment oversimplified"
        ]
    )
}
```

## Building Custom Evaluation Framework

```python
import json
import time
from typing import List, Dict, Any, Callable, Optional
from dataclasses import dataclass, field
from abc import ABC, abstractmethod

@dataclass
class EvalExample:
    input_text: str
    expected_output: str
    category: str
    difficulty: str = "medium"
    metadata: Dict = field(default_factory=dict)

@dataclass
class EvalResult:
    example_id: int
    input_text: str
    expected: str
    actual: str
    score: float
    latency_ms: float
    tokens_used: int
    metadata: Dict = field(default_factory=dict)

class Evaluator(ABC):
    @abstractmethod
    def score(self, expected: str, actual: str, context: Dict = None) -> float:
        pass

class ExactMatchEvaluator(Evaluator):
    def score(self, expected: str, actual: str, context: Dict = None) -> float:
        return 1.0 if expected.strip().lower() == actual.strip().lower() else 0.0

class ContainsEvaluator(Evaluator):
    def score(self, expected: str, actual: str, context: Dict = None) -> float:
        return 1.0 if expected.lower() in actual.lower() else 0.0

class SemanticSimilarityEvaluator(Evaluator):
    def __init__(self, embedding_model):
        self.embedding_model = embedding_model

    def score(self, expected: str, actual: str, context: Dict = None) -> float:
        # Use embedding similarity
        emb1 = self.embedding_model.encode(expected)
        emb2 = self.embedding_model.encode(actual)

        # Cosine similarity
        from numpy import dot
        from numpy.linalg import norm
        return float(dot(emb1, emb2) / (norm(emb1) * norm(emb2)))

class LLMJudgeEvaluator(Evaluator):
    def __init__(self, judge_model):
        self.judge_model = judge_model

    def score(self, expected: str, actual: str, context: Dict = None) -> float:
        prompt = f"""Rate the quality of the response on a scale of 0-10.

Expected answer: {expected}

Actual response: {actual}

Consider:
- Accuracy of information
- Completeness
- Relevance to the question

Score (0-10):"""

        result = self.judge_model.generate(prompt)
        try:
            score = float(result.strip().split()[0]) / 10
            return min(max(score, 0), 1)  # Clamp to [0, 1]
        except:
            return 0.5  # Default if parsing fails

class EvaluationPipeline:
    def __init__(
        self,
        model: Any,  # Your LLM interface
        evaluator: Evaluator,
        examples: List[EvalExample]
    ):
        self.model = model
        self.evaluator = evaluator
        self.examples = examples
        self.results: List[EvalResult] = []

    def run(self, max_tokens: int = 500) -> Dict:
        """Run evaluation on all examples."""
        for i, example in enumerate(self.examples):
            start_time = time.time()

            # Generate response
            response = self.model.generate(
                example.input_text,
                max_tokens=max_tokens
            )

            latency = (time.time() - start_time) * 1000

            # Score response
            score = self.evaluator.score(
                example.expected_output,
                response,
                {"category": example.category}
            )

            self.results.append(EvalResult(
                example_id=i,
                input_text=example.input_text,
                expected=example.expected_output,
                actual=response,
                score=score,
                latency_ms=latency,
                tokens_used=len(response.split()),  # Approximate
                metadata={"category": example.category, "difficulty": example.difficulty}
            ))

        return self.summarize()

    def summarize(self) -> Dict:
        """Summarize evaluation results."""
        scores = [r.score for r in self.results]
        latencies = [r.latency_ms for r in self.results]

        # Group by category
        by_category = {}
        for r in self.results:
            cat = r.metadata.get("category", "unknown")
            if cat not in by_category:
                by_category[cat] = []
            by_category[cat].append(r.score)

        return {
            "total_examples": len(self.results),
            "overall_score": sum(scores) / len(scores),
            "score_std": self._std(scores),
            "avg_latency_ms": sum(latencies) / len(latencies),
            "p95_latency_ms": sorted(latencies)[int(len(latencies) * 0.95)],
            "by_category": {
                cat: sum(scores) / len(scores)
                for cat, scores in by_category.items()
            }
        }

    def _std(self, values: List[float]) -> float:
        mean = sum(values) / len(values)
        variance = sum((x - mean) ** 2 for x in values) / len(values)
        return variance ** 0.5
```

## Creating Domain-Specific Test Sets

```python
def create_customer_support_eval_set() -> List[EvalExample]:
    """Create evaluation set for customer support use case."""
    return [
        EvalExample(
            input_text="What is your return policy for electronics?",
            expected_output="Our return policy for electronics allows returns within 30 days with original packaging and receipt. Items must be in working condition.",
            category="policy",
            difficulty="easy"
        ),
        EvalExample(
            input_text="My order #12345 hasn't arrived yet. It's been 2 weeks.",
            expected_output="I apologize for the delay. Let me look up order #12345 and provide you with tracking information and estimated delivery date.",
            category="order_inquiry",
            difficulty="medium"
        ),
        EvalExample(
            input_text="I want to speak to a manager right now!",
            expected_output="I understand your frustration. I'd like to try to help resolve your issue first. Could you tell me what happened? If needed, I can escalate to a supervisor.",
            category="escalation",
            difficulty="hard"
        ),
        EvalExample(
            input_text="Can I use multiple discount codes?",
            expected_output="Only one discount code can be applied per order. If you have multiple codes, I recommend using the one with the highest value.",
            category="policy",
            difficulty="easy"
        )
    ]

def create_code_review_eval_set() -> List[EvalExample]:
    """Create evaluation set for code review use case."""
    return [
        EvalExample(
            input_text="""Review this code:
def calculate_total(items):
    total = 0
    for item in items:
        total = total + item['price'] * item['quantity']
    return total""",
            expected_output="The code is functional but could be improved: 1) Use += operator, 2) Consider using sum() with generator expression, 3) Add type hints, 4) Handle potential KeyError if price/quantity missing.",
            category="code_quality",
            difficulty="medium"
        )
    ]
```

## Running Model Comparisons

```python
def compare_models(
    models: Dict[str, Any],
    eval_set: List[EvalExample],
    evaluator: Evaluator
) -> Dict[str, Dict]:
    """Compare multiple models on the same evaluation set."""

    results = {}

    for model_name, model in models.items():
        print(f"Evaluating {model_name}...")
        pipeline = EvaluationPipeline(model, evaluator, eval_set)
        results[model_name] = pipeline.run()

    # Create comparison table
    comparison = {
        "models": list(results.keys()),
        "overall_scores": [r["overall_score"] for r in results.values()],
        "avg_latencies": [r["avg_latency_ms"] for r in results.values()]
    }

    return {
        "detailed_results": results,
        "comparison": comparison
    }

# Example usage
"""
models = {
    "gpt-4-turbo": gpt4_client,
    "gpt-35-turbo": gpt35_client,
    "llama-2-70b": llama_client,
    "mixtral-8x7b": mixtral_client
}

eval_set = create_customer_support_eval_set()
evaluator = LLMJudgeEvaluator(judge_model)

results = compare_models(models, eval_set, evaluator)
"""
```

## Best Practices

1. **Use multiple evaluators** - Combine exact match, semantic similarity, and LLM-as-judge
2. **Test edge cases** - Include adversarial and boundary examples
3. **Version your eval sets** - Track changes over time
4. **Blind evaluation** - Remove model names during human review
5. **Continuously update** - Add examples from production failures

Tomorrow, we'll explore Azure OpenAI updates and the Assistants API on Azure!\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
