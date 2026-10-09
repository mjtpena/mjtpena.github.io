---
title: "Testing LLM Applications: Strategies Beyond Traditional Unit Tests"
description: "LLM outputs vary between runs and model versions. Testing must focus on behavioral properties rather than exact string matching, while still catching…"
author: Michael John Peña
draft: false
date: 2025-11-05
tags:
  - Testing
  - LLM
  - AI Quality
  - DevOps
  - Python
---

## The LLM Testing Challenge

LLM outputs vary between runs and model versions. Testing must focus on behavioral properties rather than exact string matching, while still catching regressions and quality degradation.

## Building a Testing Framework

Create evaluation suites that assess response quality across multiple dimensions:

```python
from dataclasses import dataclass
from typing import Callable
import numpy as np
from openai import AzureOpenAI

@dataclass
class TestCase:
    input: str
    expected_behavior: str
    validators: list[Callable]
    tags: list[str]

class LLMTestSuite:
    def __init__(self, client: AzureOpenAI, model: str):
        self.client = client
        self.model = model
        self.results = []

    def evaluate_response(self, test_case: TestCase) -> dict:
        """Run a single test case and evaluate response."""
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": test_case.input}],
            temperature=0.1  # Lower temperature for more consistent testing
        )

        output = response.choices[0].message.content

        # Run all validators
        validation_results = {}
        for validator in test_case.validators:
            validator_name = validator.__name__
            validation_results[validator_name] = validator(
                test_case.input,
                output,
                test_case.expected_behavior
            )

        return {
            "input": test_case.input,
            "output": output,
            "validations": validation_results,
            "passed": all(validation_results.values())
        }

    def run_suite(self, test_cases: list[TestCase]) -> dict:
        """Execute all test cases and aggregate results."""
        for test_case in test_cases:
            result = self.evaluate_response(test_case)
            self.results.append(result)

        return {
            "total": len(self.results),
            "passed": sum(1 for r in self.results if r["passed"]),
            "failed": sum(1 for r in self.results if not r["passed"]),
            "pass_rate": sum(1 for r in self.results if r["passed"]) / len(self.results)
        }

# Validator functions
def contains_required_info(input: str, output: str, expected: str) -> bool:
    """Check if response contains expected information."""
    keywords = expected.lower().split()
    output_lower = output.lower()
    return all(kw in output_lower for kw in keywords)

def no_hallucination(input: str, output: str, expected: str) -> bool:
    """Use LLM-as-judge to detect hallucinations."""
    judge_prompt = f"""
    Input: {input}
    Response: {output}

    Does this response contain factual claims not supported by the input?
    Answer only YES or NO.
    """
    # Call judge model
    return "NO" in judge_response.upper()

def appropriate_length(input: str, output: str, expected: str) -> bool:
    """Verify response length is reasonable."""
    word_count = len(output.split())
    return 50 <= word_count <= 500

# Define test cases
test_cases = [
    TestCase(
        input="Explain what Azure Functions is in simple terms",
        expected_behavior="serverless compute event-driven",
        validators=[contains_required_info, appropriate_length],
        tags=["azure", "explanation"]
    )
]
```

## Continuous Evaluation Pipeline

Integrate LLM testing into CI/CD pipelines to catch regressions before deployment. Track metrics over time to identify gradual quality degradation that might not trigger immediate test failures.

Combining automated testing with periodic human evaluation ensures AI applications maintain quality standards as models and prompts evolve.
