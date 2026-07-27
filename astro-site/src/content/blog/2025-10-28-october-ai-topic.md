---
title: "Testing AI Applications: Strategies for LLM-Based Systems"
author: Michael John Peña
draft: false
date: 2025-10-28
tags:
  - Testing
  - AI Applications
  - LLM
  - Quality Assurance
  - MLOps

---

I wrote "Testing AI Applications: Strategies for LLM-Based Systems" to share practical, production-minded guidance on this topic.

## Property-Based Testing for AI

Test invariant properties rather than exact outputs:

```python
import pytest
from hypothesis import given, strategies as st
from dataclasses import dataclass
from typing import Callable

@dataclass
class AITestCase:
    input_text: str
    expected_properties: list[Callable[[str], bool]]
    category: str

class AIPropertyTester:
    def __init__(self, ai_client, deployment: str):
        self.client = ai_client
        self.deployment = deployment

    def test_response_properties(self, test_case: AITestCase) -> dict:
        """Test that response satisfies expected properties."""

        response = self.client.chat.completions.create(
            model=self.deployment,
            messages=[{"role": "user", "content": test_case.input_text}]
        )

        output = response.choices[0].message.content
        results = {}

        for i, prop in enumerate(test_case.expected_properties):
            try:
                results[f"property_{i}"] = {
                    "passed": prop(output),
                    "output_sample": output[:200]
                }
            except Exception as e:
                results[f"property_{i}"] = {"passed": False, "error": str(e)}

        return {
            "input": test_case.input_text,
            "category": test_case.category,
            "all_passed": all(r["passed"] for r in results.values()),
            "property_results": results
        }

# Property definitions
def contains_no_pii(text: str) -> bool:
    """Check that response contains no PII patterns."""
    import re
    pii_patterns = [
        r'\b\d{3}-\d{2}-\d{4}\b',  # SSN
        r'\b\d{16}\b',  # Credit card
    ]
    return not any(re.search(p, text) for p in pii_patterns)

def is_valid_json(text: str) -> bool:
    """Check that response is valid JSON."""
    import json
    try:
        json.loads(text)
        return True
    except:
        return False

def response_length_reasonable(text: str, max_length: int = 2000) -> bool:
    """Check that response length is reasonable."""
    return len(text) <= max_length
```

## Regression Testing with Golden Datasets

Maintain test datasets for consistent evaluation:

```python
import json
from pathlib import Path
from typing import List
import difflib

class GoldenDatasetTester:
    def __init__(self, golden_path: str, ai_client, similarity_threshold: float = 0.8):
        self.golden_path = Path(golden_path)
        self.client = ai_client
        self.threshold = similarity_threshold

    def load_golden_cases(self) -> List[dict]:
        """Load golden test cases."""
        with open(self.golden_path) as f:
            return json.load(f)

    def run_regression_tests(self) -> dict:
        """Run all regression tests against golden dataset."""

        cases = self.load_golden_cases()
        results = []

        for case in cases:
            response = self.client.chat.completions.create(
                model="gpt-4",
                messages=case["messages"],
                temperature=0.1
            )

            actual_output = response.choices[0].message.content
            expected_output = case["expected_output"]

            similarity = self._calculate_similarity(actual_output, expected_output)

            results.append({
                "case_id": case["id"],
                "passed": similarity >= self.threshold,
                "similarity": similarity,
                "actual": actual_output[:500],
                "expected": expected_output[:500]
            })

        return {
            "total_cases": len(results),
            "passed": sum(1 for r in results if r["passed"]),
            "failed": sum(1 for r in results if not r["passed"]),
            "details": results
        }

    def _calculate_similarity(self, text1: str, text2: str) -> float:
        """Calculate semantic similarity between texts."""
        return difflib.SequenceMatcher(None, text1.lower(), text2.lower()).ratio()
```

## Integration Testing

Test AI components within the full application context, including error handling, timeout behavior, and integration with downstream systems.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
