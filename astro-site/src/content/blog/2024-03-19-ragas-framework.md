---
title: "RAGAS Framework: Automated RAG Evaluation"
description: "RAGAS (Retrieval Augmented Generation Assessment) is an open-source framework for evaluating RAG pipelines. This guide covers how to implement and use RAGAS…"
author: "Michael John Peña"
draft: false
date: 2024-03-19
tags: ["AI", "RAG", "RAGAS", "Evaluation", "LLM"]
---

RAGAS (Retrieval Augmented Generation Assessment) is an open-source framework for evaluating RAG pipelines. This guide covers how to implement and use RAGAS for your RAG systems.

## What is RAGAS?

RAGAS provides a set of metrics specifically designed for RAG evaluation:

```python
from dataclasses import dataclass
from typing import List, Dict

@dataclass
class RAGASMetrics:
    """Core RAGAS metrics"""

    # Generation metrics
    faithfulness: float  # Is the answer grounded in context?
    answer_relevancy: float  # Does the answer address the question?

    # Retrieval metrics
    context_precision: float  # Are retrieved docs relevant?
    context_recall: float  # Are all needed docs retrieved?

    # Overall
    answer_correctness: float  # Is the answer factually correct?
```

## Installing and Setting Up RAGAS

```bash
pip install ragas langchain openai
```

```python
# Basic RAGAS setup
from ragas import evaluate
from ragas.metrics import (
    faithfulness,
    answer_relevancy,
    context_precision,
    context_recall,
)
from datasets import Dataset

# Prepare your evaluation data
eval_data = {
    "question": [
        "What is Azure OpenAI?",
        "How do you deploy a model in Azure ML?"
    ],
    "answer": [
        "Azure OpenAI is a cloud service that provides access to OpenAI's models.",
        "You can deploy models using managed online endpoints or batch endpoints."
    ],
    "contexts": [
        ["Azure OpenAI Service provides REST API access to OpenAI's models including GPT-4."],
        ["Azure ML supports managed online endpoints for real-time inference and batch endpoints for batch scoring."]
    ],
    "ground_truth": [
        "Azure OpenAI is Microsoft's cloud service providing access to OpenAI's language models.",
        "Models can be deployed via managed endpoints, Kubernetes, or batch endpoints."
    ]
}

# Convert to Dataset
dataset = Dataset.from_dict(eval_data)

# Run evaluation
result = evaluate(
    dataset,
    metrics=[
        faithfulness,
        answer_relevancy,
        context_precision,
        context_recall,
    ]
)

print(result)
```

## Implementing RAGAS Metrics from Scratch

```python
import anthropic
import numpy as np
from typing import List

class RAGASEvaluator:
    """RAGAS-style evaluation using Claude"""

    def __init__(self):
        self.client = anthropic.Anthropic()

    def faithfulness(
        self,
        answer: str,
        contexts: List[str]
    ) -> float:
        """
        Faithfulness measures if the answer is grounded in the context.
        Steps:
        1. Extract claims from the answer
        2. Verify each claim against the context
        3. Return ratio of supported claims
        """

        # Step 1: Extract claims
        claims_prompt = f"""Extract all factual claims from this answer as a numbered list.
Each claim should be a single, verifiable statement.

Answer: {answer}

List each claim on a new line, numbered."""

        claims_response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=500,
            messages=[{"role": "user", "content": claims_prompt}]
        )

        claims_text = claims_response.content[0].text
        claims = [line.strip() for line in claims_text.split('\n')
                  if line.strip() and line.strip()[0].isdigit()]

        if not claims:
            return 1.0  # No claims to verify

        # Step 2: Verify each claim
        context_combined = "\n\n".join(contexts)
        supported = 0

        for claim in claims:
            verify_prompt = f"""Given the following context, determine if this claim is supported.

Context:
{context_combined}

Claim: {claim}

Is this claim supported by the context? Answer only 'yes' or 'no'."""

            verify_response = self.client.messages.create(
                model="claude-3-sonnet-20240229",
                max_tokens=10,
                messages=[{"role": "user", "content": verify_prompt}]
            )

            if 'yes' in verify_response.content[0].text.lower():
                supported += 1

        return supported / len(claims)

    def answer_relevancy(
        self,
        question: str,
        answer: str
    ) -> float:
        """
        Answer relevancy measures if the answer addresses the question.
        Uses reverse generation: generate questions from the answer
        and measure similarity to original question.
        """

        # Generate questions from the answer
        gen_prompt = f"""Based on this answer, generate 3 questions that this answer would address.

Answer: {answer}

List 3 questions, one per line."""

        gen_response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=300,
            messages=[{"role": "user", "content": gen_prompt}]
        )

        generated_questions = [
            line.strip() for line in gen_response.content[0].text.split('\n')
            if line.strip() and '?' in line
        ]

        if not generated_questions:
            return 0.5

        # Measure similarity of generated questions to original
        similarities = []
        for gen_q in generated_questions:
            sim_prompt = f"""Rate the semantic similarity between these two questions.
0 = completely different topics
1 = identical meaning

Question 1: {question}
Question 2: {gen_q}

Respond with only a number between 0 and 1."""

            sim_response = self.client.messages.create(
                model="claude-3-sonnet-20240229",
                max_tokens=10,
                messages=[{"role": "user", "content": sim_prompt}]
            )

            try:
                similarity = float(sim_response.content[0].text.strip())
                similarities.append(similarity)
            except:
                similarities.append(0.5)

        return np.mean(similarities)

    def context_precision(
        self,
        question: str,
        contexts: List[str],
        ground_truth: str
    ) -> float:
        """
        Context precision measures if retrieved contexts are relevant.
        For each context, check if it's needed to answer the question.
        """

        if not contexts:
            return 0.0

        relevant_count = 0

        for context in contexts:
            relevance_prompt = f"""Determine if this context is relevant and useful for answering the question.

Question: {question}

Context: {context}

Is this context relevant for answering the question? Answer 'yes' or 'no'."""

            response = self.client.messages.create(
                model="claude-3-sonnet-20240229",
                max_tokens=10,
                messages=[{"role": "user", "content": relevance_prompt}]
            )

            if 'yes' in response.content[0].text.lower():
                relevant_count += 1

        return relevant_count / len(contexts)

    def context_recall(
        self,
        ground_truth: str,
        contexts: List[str]
    ) -> float:
        """
        Context recall measures if all information needed for ground truth
        is present in the retrieved contexts.
        """

        # Extract statements from ground truth
        extract_prompt = f"""Extract key factual statements from this answer.
List each statement on a new line.

Answer: {ground_truth}"""

        extract_response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=300,
            messages=[{"role": "user", "content": extract_prompt}]
        )

        statements = [
            line.strip() for line in extract_response.content[0].text.split('\n')
            if line.strip()
        ]

        if not statements:
            return 1.0

        context_combined = "\n\n".join(contexts)
        attributed = 0

        for statement in statements:
            check_prompt = f"""Can this statement be attributed to the given context?

Context:
{context_combined}

Statement: {statement}

Can this be attributed to the context? Answer 'yes' or 'no'."""

            check_response = self.client.messages.create(
                model="claude-3-sonnet-20240229",
                max_tokens=10,
                messages=[{"role": "user", "content": check_prompt}]
            )

            if 'yes' in check_response.content[0].text.lower():
                attributed += 1

        return attributed / len(statements)

    def evaluate(
        self,
        questions: List[str],
        answers: List[str],
        contexts: List[List[str]],
        ground_truths: List[str]
    ) -> Dict[str, float]:
        """Run full RAGAS evaluation"""

        faithfulness_scores = []
        relevancy_scores = []
        precision_scores = []
        recall_scores = []

        for q, a, c, gt in zip(questions, answers, contexts, ground_truths):
            faithfulness_scores.append(self.faithfulness(a, c))
            relevancy_scores.append(self.answer_relevancy(q, a))
            precision_scores.append(self.context_precision(q, c, gt))
            recall_scores.append(self.context_recall(gt, c))

        return {
            "faithfulness": np.mean(faithfulness_scores),
            "answer_relevancy": np.mean(relevancy_scores),
            "context_precision": np.mean(precision_scores),
            "context_recall": np.mean(recall_scores)
        }
```

## Running RAGAS Evaluation

```python
# Example usage
evaluator = RAGASEvaluator()

# Your RAG system outputs
questions = [
    "What is Azure Machine Learning?",
    "How do you create a Kubernetes cluster in Azure?"
]

answers = [
    "Azure Machine Learning is a cloud-based platform for building and deploying ML models.",
    "You can create an AKS cluster using Azure CLI, Portal, or ARM templates."
]

contexts = [
    ["Azure ML is Microsoft's cloud service for machine learning workflows."],
    ["Azure Kubernetes Service (AKS) can be deployed via CLI: az aks create..."]
]

ground_truths = [
    "Azure ML is a cloud platform for training, deploying, and managing ML models.",
    "AKS clusters can be created through Azure Portal, CLI, PowerShell, or ARM templates."
]

# Run evaluation
results = evaluator.evaluate(questions, answers, contexts, ground_truths)

print("RAGAS Evaluation Results:")
for metric, score in results.items():
    print(f"  {metric}: {score:.3f}")
```

## Best Practices

1. **Use diverse test cases**: Cover different question types and complexity
2. **Include edge cases**: Test with no context, wrong context, etc.
3. **Version your evaluations**: Track metrics over time
4. **Combine with human evaluation**: RAGAS supplements but doesn't replace human judgment

## Conclusion

RAGAS provides a standardized approach to RAG evaluation. Whether using the library directly or implementing the metrics yourself, consistent evaluation is key to improving RAG systems.
