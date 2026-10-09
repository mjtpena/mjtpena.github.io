---
title: "Testing AI Applications: Strategies for Non-Deterministic Systems"
description: "Robust AI testing combines deterministic checks with AI-powered evaluation."
author: Michael John Peña
draft: false
date: 2025-03-08
tags:
  - AI
  - Testing
  - Quality Assurance
  - Best Practices
  - DevOps
---

## AI Testing Framework

```python
import pytest
from azure.ai.openai import AzureOpenAI
from deepeval import evaluate
from deepeval.metrics import GEval, AnswerRelevancy, Faithfulness

class AITestSuite:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client
        self.evaluator = AIEvaluator(openai_client)

    async def test_response_relevancy(self, question: str, response: str, context: str):
        """Test if response is relevant to the question."""
        metric = AnswerRelevancy(threshold=0.7)
        result = evaluate(
            test_cases=[{
                "input": question,
                "actual_output": response,
                "context": context
            }],
            metrics=[metric]
        )
        assert result.passed, f"Relevancy score: {result.score}"

    async def test_faithfulness(self, response: str, context: str):
        """Test if response is grounded in context (no hallucinations)."""
        metric = Faithfulness(threshold=0.8)
        result = evaluate(
            test_cases=[{
                "actual_output": response,
                "context": context
            }],
            metrics=[metric]
        )
        assert result.passed, f"Faithfulness score: {result.score}"

    async def test_consistency(self, question: str, num_runs: int = 5):
        """Test response consistency across multiple runs."""
        responses = []
        for _ in range(num_runs):
            response = await self.get_response(question)
            responses.append(response)

        similarity_scores = self.compute_pairwise_similarity(responses)
        avg_similarity = sum(similarity_scores) / len(similarity_scores)
        assert avg_similarity > 0.8, f"Consistency score: {avg_similarity}"

    async def test_edge_cases(self, test_cases: list[dict]):
        """Test handling of edge cases."""
        for case in test_cases:
            response = await self.get_response(case["input"])
            assert case["expected_behavior"] in response.lower()

    async def test_safety(self, prompts: list[str]):
        """Test safety guardrails."""
        for prompt in prompts:
            response = await self.get_response(prompt)
            safety_check = await self.evaluator.check_safety(response)
            assert safety_check.is_safe, f"Safety violation: {safety_check.reason}"
```

Robust AI testing combines deterministic checks with AI-powered evaluation.
