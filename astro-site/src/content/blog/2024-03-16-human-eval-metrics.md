---
title: "HumanEval Metrics: Measuring Code Generation Quality"
author: "Michael John Peña"
draft: false
date: 2024-03-16
tags: ["AI", "LLM", "HumanEval", "Code Generation", "Benchmarking"]

---

I wrote "HumanEval Metrics: Measuring Code Generation Quality" to share practical, production-minded guidance on this topic.

HumanEval is the standard benchmark for measuring LLM code generation capabilities. Understanding its methodology and limitations is essential for evaluating coding assistants.

## What is HumanEval?

HumanEval consists of 164 Python programming problems with:
- Function signature and docstring
- Unit tests for validation
- Pass@k metric for evaluation

```python
from dataclasses import dataclass
from typing import List, Callable
import ast
import sys
from io import StringIO

@dataclass
class HumanEvalProblem:
    task_id: str
    prompt: str
    entry_point: str
    canonical_solution: str
    test: str

# Example HumanEval problem
example_problem = HumanEvalProblem(
    task_id="HumanEval/0",
    prompt='''from typing import List

def has_close_elements(numbers: List[float], threshold: float) -> bool:
    """Check if in given list of numbers, are any two numbers closer to each
    other than given threshold.
    >>> has_close_elements([1.0, 2.0, 3.0], 0.5)
    False
    >>> has_close_elements([1.0, 2.8, 3.0, 4.0, 5.0, 2.0], 0.3)
    True
    """
''',
    entry_point="has_close_elements",
    canonical_solution='''    for i, n1 in enumerate(numbers):
        for j, n2 in enumerate(numbers):
            if i != j and abs(n1 - n2) < threshold:
                return True
    return False
''',
    test='''
def check(candidate):
    assert candidate([1.0, 2.0, 3.9, 4.0, 5.0, 2.2], 0.3) == True
    assert candidate([1.0, 2.0, 3.9, 4.0, 5.0, 2.2], 0.05) == False
    assert candidate([1.0, 2.0, 5.9, 4.0, 5.0], 0.95) == True
    assert candidate([1.0, 2.0, 5.9, 4.0, 5.0], 0.8) == False
    assert candidate([1.0, 2.0, 3.0, 4.0, 5.0], 2.0) == True
'''
)
```

## Pass@k Metric

```python
import numpy as np
from typing import List
from scipy.special import comb

def pass_at_k(n: int, c: int, k: int) -> float:
    """
    Calculate pass@k metric.

    Args:
        n: Total number of code samples generated
        c: Number of samples that pass all tests
        k: Number of samples to consider

    Returns:
        Probability that at least one of k samples passes
    """
    if n - c < k:
        return 1.0

    return 1.0 - np.prod(1.0 - k / np.arange(n - c + 1, n + 1))

# Example: 10 samples generated, 3 pass
print(f"pass@1: {pass_at_k(10, 3, 1):.3f}")   # 0.300
print(f"pass@5: {pass_at_k(10, 3, 5):.3f}")   # 0.738
print(f"pass@10: {pass_at_k(10, 3, 10):.3f}") # 1.000

def estimate_pass_at_k(
    num_samples: List[int],
    num_correct: List[int],
    k: int
) -> float:
    """Estimate pass@k across multiple problems"""
    total = 0
    for n, c in zip(num_samples, num_correct):
        total += pass_at_k(n, c, k)
    return total / len(num_samples)
```

## Running HumanEval

```python
import anthropic
import subprocess
import tempfile
import os

class HumanEvalRunner:
    def __init__(self):
        self.client = anthropic.Anthropic()

    def generate_solution(
        self,
        model: str,
        problem: HumanEvalProblem,
        temperature: float = 0.2
    ) -> str:
        """Generate a solution for the problem"""

        prompt = f"""Complete the following Python function. Only return the function body, nothing else.

{problem.prompt}"""

        response = self.client.messages.create(
            model=model,
            max_tokens=500,
            temperature=temperature,
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content[0].text

    def execute_solution(
        self,
        problem: HumanEvalProblem,
        solution: str,
        timeout: int = 5
    ) -> bool:
        """Execute and test a solution"""

        # Combine prompt, solution, and test
        full_code = f"""
{problem.prompt}
{solution}

{problem.test}

check({problem.entry_point})
print("PASSED")
"""

        # Write to temp file and execute
        with tempfile.NamedTemporaryFile(
            mode='w',
            suffix='.py',
            delete=False
        ) as f:
            f.write(full_code)
            temp_path = f.name

        try:
            result = subprocess.run(
                ['python', temp_path],
                capture_output=True,
                text=True,
                timeout=timeout
            )
            return "PASSED" in result.stdout
        except subprocess.TimeoutExpired:
            return False
        except Exception as e:
            return False
        finally:
            os.unlink(temp_path)

    def evaluate_model(
        self,
        model: str,
        problems: List[HumanEvalProblem],
        num_samples: int = 10,
        temperature: float = 0.8
    ) -> dict:
        """Evaluate model on HumanEval"""

        results = []

        for problem in problems:
            correct = 0

            for _ in range(num_samples):
                solution = self.generate_solution(
                    model=model,
                    problem=problem,
                    temperature=temperature
                )

                if self.execute_solution(problem, solution):
                    correct += 1

            results.append({
                "task_id": problem.task_id,
                "num_samples": num_samples,
                "num_correct": correct
            })

        # Calculate pass@k metrics
        num_samples_list = [r["num_samples"] for r in results]
        num_correct_list = [r["num_correct"] for r in results]

        metrics = {
            "pass@1": estimate_pass_at_k(num_samples_list, num_correct_list, 1),
            "pass@5": estimate_pass_at_k(num_samples_list, num_correct_list, 5),
            "pass@10": estimate_pass_at_k(num_samples_list, num_correct_list, 10),
            "detailed_results": results
        }

        return metrics

# Usage
runner = HumanEvalRunner()
# metrics = runner.evaluate_model("claude-3-opus-20240229", problems)
```

## Model Comparison

```python
# HumanEval scores (March 2024)
humaneval_scores = {
    "Claude 3 Opus": {"pass@1": 0.849},
    "GPT-4 Turbo": {"pass@1": 0.670},
    "Claude 3 Sonnet": {"pass@1": 0.730},
    "Llama 2 70B": {"pass@1": 0.298},
    "Mistral Large": {"pass@1": 0.451},
    "CodeLlama 34B": {"pass@1": 0.488},
}

def compare_models():
    print("HumanEval pass@1 Comparison:\n")
    sorted_models = sorted(
        humaneval_scores.items(),
        key=lambda x: x[1]["pass@1"],
        reverse=True
    )
    for model, scores in sorted_models:
        bar = "=" * int(scores["pass@1"] * 50)
        print(f"{model:20} {scores['pass@1']:.1%} |{bar}")

compare_models()
```

## Beyond HumanEval

```python
# Extended benchmarks for more comprehensive evaluation

extended_benchmarks = {
    "MBPP": {
        "description": "Mostly Basic Python Programming - 974 problems",
        "difficulty": "Basic to intermediate",
        "languages": ["Python"]
    },
    "HumanEval+": {
        "description": "Extended HumanEval with more test cases",
        "difficulty": "Same as HumanEval, stricter testing",
        "languages": ["Python"]
    },
    "MultiPL-E": {
        "description": "HumanEval translated to 18 languages",
        "difficulty": "Same as HumanEval",
        "languages": ["Python", "JavaScript", "Go", "Java", "C++", "Rust", "..."]
    },
    "DS-1000": {
        "description": "Data science coding problems",
        "difficulty": "Applied data science",
        "languages": ["Python with pandas, numpy, etc."]
    },
    "SWE-bench": {
        "description": "Real GitHub issues to resolve",
        "difficulty": "Real-world software engineering",
        "languages": ["Python"]
    }
}

for name, info in extended_benchmarks.items():
    print(f"\n{name}:")
    print(f"  {info['description']}")
    print(f"  Difficulty: {info['difficulty']}")
```

## Limitations of HumanEval

1. **Python-only** in original form
2. **Algorithmic focus** - doesn't test real-world coding
3. **Short functions** - no multi-file or architecture testing
4. **Test coverage** - limited test cases may miss bugs
5. **No debugging** - tests generation, not fixing code

## Conclusion

HumanEval provides a standardized way to compare code generation capabilities, but production code assistants need evaluation on more realistic tasks like SWE-bench and real-world debugging scenarios.

