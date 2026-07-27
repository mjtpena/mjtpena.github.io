---
title: "AI Testing Frameworks: Comprehensive Testing for AI Systems"
author: Michael John Peña
draft: false
date: 2025-05-19
tags:
  - AI
  - Testing
  - Frameworks
  - Quality Assurance
  - Best Practices

---

I wrote "AI Testing Frameworks: Comprehensive Testing for AI Systems" to share practical, production-minded guidance on this topic.

## AI Testing Framework

```python
import pytest
from typing import List, Dict
from dataclasses import dataclass

@dataclass
class TestCase:
    id: str
    input: str
    expected_behavior: str
    context: str = None

class AITestFramework:
    def __init__(self, ai_client, evaluator):
        self.ai = ai_client
        self.evaluator = evaluator

    async def run_test_suite(self, test_cases: List[TestCase]) -> Dict:
        """Run complete test suite."""
        results = {
            "passed": 0,
            "failed": 0,
            "details": []
        }

        for case in test_cases:
            result = await self.run_test(case)
            results["details"].append(result)
            if result["passed"]:
                results["passed"] += 1
            else:
                results["failed"] += 1

        results["pass_rate"] = results["passed"] / len(test_cases)
        return results

    async def run_test(self, case: TestCase) -> Dict:
        """Run single test case."""
        # Get AI response
        response = await self.ai.generate(case.input, case.context)

        # Evaluate response
        evaluation = await self.evaluator.evaluate(
            input=case.input,
            output=response,
            expected=case.expected_behavior
        )

        return {
            "test_id": case.id,
            "input": case.input,
            "output": response,
            "expected": case.expected_behavior,
            "passed": evaluation["score"] >= 0.7,
            "score": evaluation["score"],
            "feedback": evaluation["feedback"]
        }

    async def test_consistency(self, input: str, num_runs: int = 5) -> Dict:
        """Test response consistency."""
        responses = []
        for _ in range(num_runs):
            response = await self.ai.generate(input)
            responses.append(response)

        # Calculate consistency metrics
        embeddings = await self.get_embeddings(responses)
        similarities = self.pairwise_similarities(embeddings)

        return {
            "responses": responses,
            "avg_similarity": np.mean(similarities),
            "min_similarity": np.min(similarities),
            "consistent": np.mean(similarities) > 0.85
        }

    async def test_robustness(self, input: str, perturbations: List[str]) -> Dict:
        """Test robustness to input variations."""
        base_response = await self.ai.generate(input)
        results = []

        for perturbed in perturbations:
            perturbed_response = await self.ai.generate(perturbed)
            similarity = await self.semantic_similarity(base_response, perturbed_response)
            results.append({
                "perturbation": perturbed,
                "similarity": similarity,
                "robust": similarity > 0.8
            })

        return {
            "base_input": input,
            "base_response": base_response,
            "perturbation_results": results,
            "robustness_score": np.mean([r["similarity"] for r in results])
        }

    async def test_boundaries(self, boundary_cases: List[Dict]) -> Dict:
        """Test behavior at boundaries."""
        results = []
        for case in boundary_cases:
            response = await self.ai.generate(case["input"])
            expected_behavior = case["expected"]
            actual_behavior = self.classify_behavior(response)

            results.append({
                "case": case["description"],
                "expected": expected_behavior,
                "actual": actual_behavior,
                "passed": actual_behavior == expected_behavior
            })

        return {
            "boundary_tests": results,
            "pass_rate": sum(r["passed"] for r in results) / len(results)
        }
```

Comprehensive AI testing ensures reliable behavior across diverse scenarios.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
