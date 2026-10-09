---
title: "Evaluating RAG Systems: Metrics and Automated Testing with Azure AI"
description: "Fail builds when quality metrics drop below thresholds, catching regressions before they reach production."
author: Michael John Peña
draft: false
date: 2025-07-13
tags:
  - RAG
  - AI Evaluation
  - Azure AI
  - Testing
  - Python
---

## Core Evaluation Metrics

Azure AI Evaluation SDK calculates key metrics automatically:

```python
from azure.ai.evaluation import (
    RelevanceEvaluator,
    GroundednessEvaluator,
    CoherenceEvaluator,
    FluencyEvaluator,
    RetrievalEvaluator
)
from azure.ai.projects import AIProjectClient

project = AIProjectClient(subscription_id, resource_group, project_name, credential)

# Initialize evaluators
relevance = RelevanceEvaluator(model_config={"deployment": "gpt-4o"})
groundedness = GroundednessEvaluator(model_config={"deployment": "gpt-4o"})
coherence = CoherenceEvaluator(model_config={"deployment": "gpt-4o"})
retrieval = RetrievalEvaluator(model_config={"deployment": "gpt-4o"})

async def evaluate_rag_response(
    query: str,
    retrieved_docs: list[str],
    generated_response: str,
    ground_truth: str = None
) -> dict:

    context = "\n\n".join(retrieved_docs)

    results = {
        "relevance": await relevance(
            query=query,
            response=generated_response
        ),
        "groundedness": await groundedness(
            context=context,
            response=generated_response
        ),
        "coherence": await coherence(
            response=generated_response
        ),
        "retrieval_quality": await retrieval(
            query=query,
            context=context
        )
    }

    if ground_truth:
        from azure.ai.evaluation import SimilarityEvaluator
        similarity = SimilarityEvaluator(model_config={"deployment": "gpt-4o"})
        results["similarity"] = await similarity(
            response=generated_response,
            ground_truth=ground_truth
        )

    return results
```

## Building Test Suites

Create comprehensive test datasets that cover edge cases:

```python
test_cases = [
    {
        "query": "What is the refund policy?",
        "expected_topics": ["30-day window", "original payment method"],
        "min_relevance": 4.0,
        "min_groundedness": 4.0
    },
    # Add more test cases...
]

async def run_evaluation_suite(rag_pipeline, test_cases):
    results = []
    for case in test_cases:
        response = await rag_pipeline.query(case["query"])
        metrics = await evaluate_rag_response(
            query=case["query"],
            retrieved_docs=response.sources,
            generated_response=response.answer
        )
        results.append({"case": case, "metrics": metrics})
    return results
```

## CI/CD Integration

Fail builds when quality metrics drop below thresholds, catching regressions before they reach production.
