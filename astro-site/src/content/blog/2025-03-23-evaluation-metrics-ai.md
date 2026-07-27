---
title: "Evaluation Metrics for AI: Measuring What Matters"
author: Michael John Peña
draft: false
date: 2025-03-23
tags:
  - AI
  - Evaluation
  - Metrics
  - Quality
  - Best Practices

---

I wrote "Evaluation Metrics for AI: Measuring What Matters" to share practical, production-minded guidance on this topic.

## AI Evaluation Framework

```python
from azure.ai.openai import AzureOpenAI
from deepeval.metrics import (
    GEval,
    AnswerRelevancyMetric,
    FaithfulnessMetric,
    ContextualRelevancyMetric,
    HallucinationMetric
)
import numpy as np

class AIEvaluator:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client

    async def evaluate_rag(self, question: str, answer: str, context: list[str]) -> dict:
        """Comprehensive RAG evaluation."""
        metrics = {}

        # Answer relevancy - does the answer address the question?
        metrics["answer_relevancy"] = await self.answer_relevancy(question, answer)

        # Faithfulness - is the answer grounded in context?
        metrics["faithfulness"] = await self.faithfulness(answer, context)

        # Context relevancy - is the retrieved context useful?
        metrics["context_relevancy"] = await self.context_relevancy(question, context)

        # Hallucination detection
        metrics["hallucination_score"] = await self.detect_hallucination(answer, context)

        return metrics

    async def answer_relevancy(self, question: str, answer: str) -> float:
        """Measure how well answer addresses the question."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Rate answer relevancy from 0-1.
                1 = Directly and completely answers the question
                0.5 = Partially answers or tangentially related
                0 = Does not address the question at all"""
            }, {
                "role": "user",
                "content": f"Question: {question}\n\nAnswer: {answer}"
            }]
        )
        return float(response.choices[0].message.content)

    async def faithfulness(self, answer: str, context: list[str]) -> float:
        """Measure if answer claims are supported by context."""
        context_text = "\n\n".join(context)
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Analyze each claim in the answer.
                Return the percentage of claims supported by the context.
                Return only a number between 0 and 1."""
            }, {
                "role": "user",
                "content": f"Context:\n{context_text}\n\nAnswer:\n{answer}"
            }]
        )
        return float(response.choices[0].message.content)

    async def context_relevancy(self, question: str, context: list[str]) -> float:
        """Measure if retrieved context is relevant to question."""
        scores = []
        for ctx in context:
            response = await self.openai.chat.completions.create(
                model="gpt-4o",
                messages=[{
                    "role": "user",
                    "content": f"Rate relevancy 0-1. Question: {question}\nContext: {ctx}"
                }]
            )
            scores.append(float(response.choices[0].message.content))
        return np.mean(scores)

    async def detect_hallucination(self, answer: str, context: list[str]) -> float:
        """Detect hallucinated content not in context."""
        # Lower score = less hallucination
        faithfulness = await self.faithfulness(answer, context)
        return 1 - faithfulness
```

Regular evaluation with consistent metrics drives continuous improvement in AI quality.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
