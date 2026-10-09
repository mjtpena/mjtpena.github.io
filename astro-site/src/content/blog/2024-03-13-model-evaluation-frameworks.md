---
title: "Model Evaluation Frameworks: A Comprehensive Guide"
description: "Rigorous model evaluation is critical for production AI systems. This guide covers the major evaluation frameworks and how to implement comprehensive…"
author: "Michael John Peña"
draft: false
date: 2024-03-13
tags: ["AI", "Machine Learning", "Evaluation", "MLOps", "Testing"]
---

Rigorous model evaluation is critical for production AI systems. This guide covers the major evaluation frameworks and how to implement comprehensive testing pipelines.

## Evaluation Framework Overview

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
import json

@dataclass
class EvaluationResult:
    metric_name: str
    score: float
    details: Optional[Dict[str, Any]] = None

    def to_dict(self) -> dict:
        return {
            "metric": self.metric_name,
            "score": self.score,
            "details": self.details
        }

class Evaluator(ABC):
    @abstractmethod
    def evaluate(self, predictions: List[str], references: List[str]) -> EvaluationResult:
        pass

class EvaluationPipeline:
    def __init__(self):
        self.evaluators: List[Evaluator] = []

    def add_evaluator(self, evaluator: Evaluator):
        self.evaluators.append(evaluator)

    def run(
        self,
        predictions: List[str],
        references: List[str]
    ) -> List[EvaluationResult]:
        results = []
        for evaluator in self.evaluators:
            result = evaluator.evaluate(predictions, references)
            results.append(result)
        return results

    def to_report(self, results: List[EvaluationResult]) -> str:
        report = "# Model Evaluation Report\n\n"
        for result in results:
            report += f"## {result.metric_name}\n"
            report += f"Score: {result.score:.4f}\n\n"
            if result.details:
                report += f"Details: {json.dumps(result.details, indent=2)}\n\n"
        return report
```

## Built-in Evaluators

```python
from collections import Counter
import numpy as np
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score

class ExactMatchEvaluator(Evaluator):
    def evaluate(self, predictions: List[str], references: List[str]) -> EvaluationResult:
        matches = sum(p.strip() == r.strip() for p, r in zip(predictions, references))
        score = matches / len(predictions)
        return EvaluationResult(
            metric_name="Exact Match",
            score=score,
            details={"matches": matches, "total": len(predictions)}
        )

class F1Evaluator(Evaluator):
    def __init__(self, average: str = "weighted"):
        self.average = average

    def evaluate(self, predictions: List[str], references: List[str]) -> EvaluationResult:
        # For classification tasks
        score = f1_score(references, predictions, average=self.average, zero_division=0)
        return EvaluationResult(
            metric_name=f"F1 ({self.average})",
            score=score
        )

class BLEUEvaluator(Evaluator):
    def __init__(self, max_n: int = 4):
        self.max_n = max_n

    def _get_ngrams(self, tokens: List[str], n: int) -> Counter:
        return Counter(tuple(tokens[i:i+n]) for i in range(len(tokens) - n + 1))

    def _brevity_penalty(self, candidate_len: int, reference_len: int) -> float:
        if candidate_len >= reference_len:
            return 1.0
        return np.exp(1 - reference_len / candidate_len)

    def evaluate(self, predictions: List[str], references: List[str]) -> EvaluationResult:
        total_score = 0

        for pred, ref in zip(predictions, references):
            pred_tokens = pred.lower().split()
            ref_tokens = ref.lower().split()

            precisions = []
            for n in range(1, self.max_n + 1):
                pred_ngrams = self._get_ngrams(pred_tokens, n)
                ref_ngrams = self._get_ngrams(ref_tokens, n)

                matches = sum((pred_ngrams & ref_ngrams).values())
                total = sum(pred_ngrams.values())

                precision = matches / total if total > 0 else 0
                precisions.append(precision)

            if all(p > 0 for p in precisions):
                geo_mean = np.exp(np.mean(np.log(precisions)))
            else:
                geo_mean = 0

            bp = self._brevity_penalty(len(pred_tokens), len(ref_tokens))
            total_score += bp * geo_mean

        return EvaluationResult(
            metric_name="BLEU",
            score=total_score / len(predictions)
        )

class ROUGEEvaluator(Evaluator):
    def __init__(self, rouge_type: str = "rouge-l"):
        self.rouge_type = rouge_type

    def _lcs_length(self, x: List[str], y: List[str]) -> int:
        m, n = len(x), len(y)
        dp = [[0] * (n + 1) for _ in range(m + 1)]

        for i in range(1, m + 1):
            for j in range(1, n + 1):
                if x[i-1] == y[j-1]:
                    dp[i][j] = dp[i-1][j-1] + 1
                else:
                    dp[i][j] = max(dp[i-1][j], dp[i][j-1])

        return dp[m][n]

    def evaluate(self, predictions: List[str], references: List[str]) -> EvaluationResult:
        scores = []

        for pred, ref in zip(predictions, references):
            pred_tokens = pred.lower().split()
            ref_tokens = ref.lower().split()

            lcs_len = self._lcs_length(pred_tokens, ref_tokens)

            precision = lcs_len / len(pred_tokens) if pred_tokens else 0
            recall = lcs_len / len(ref_tokens) if ref_tokens else 0

            if precision + recall > 0:
                f1 = 2 * precision * recall / (precision + recall)
            else:
                f1 = 0

            scores.append(f1)

        return EvaluationResult(
            metric_name="ROUGE-L",
            score=np.mean(scores),
            details={"precision": precision, "recall": recall}
        )
```

## LLM-as-Judge Evaluator

```python
import anthropic

class LLMJudgeEvaluator(Evaluator):
    def __init__(self, criteria: str):
        self.client = anthropic.Anthropic()
        self.criteria = criteria

    def evaluate(self, predictions: List[str], references: List[str]) -> EvaluationResult:
        scores = []

        for pred, ref in zip(predictions, references):
            prompt = f"""Evaluate the following response against the reference.

Criteria: {self.criteria}

Reference: {ref}

Response to evaluate: {pred}

Score from 1-5 (5 being best) and explain briefly.
Format: Score: X
Explanation: ..."""

            response = self.client.messages.create(
                model="claude-3-sonnet-20240229",
                max_tokens=200,
                messages=[{"role": "user", "content": prompt}]
            )

            # Parse score from response
            text = response.content[0].text
            try:
                score_line = [l for l in text.split('\n') if 'Score:' in l][0]
                score = int(score_line.split(':')[1].strip())
                scores.append(score / 5.0)  # Normalize to 0-1
            except:
                scores.append(0.5)  # Default score on parse failure

        return EvaluationResult(
            metric_name=f"LLM Judge ({self.criteria})",
            score=np.mean(scores)
        )
```

## Running a Complete Evaluation

```python
# Create evaluation pipeline
pipeline = EvaluationPipeline()
pipeline.add_evaluator(ExactMatchEvaluator())
pipeline.add_evaluator(F1Evaluator())
pipeline.add_evaluator(BLEUEvaluator())
pipeline.add_evaluator(ROUGEEvaluator())
pipeline.add_evaluator(LLMJudgeEvaluator("accuracy and helpfulness"))

# Test data
predictions = [
    "The capital of France is Paris.",
    "Machine learning is a subset of artificial intelligence.",
    "Python is a programming language."
]
references = [
    "Paris is the capital of France.",
    "Machine learning is part of AI.",
    "Python is a popular programming language."
]

# Run evaluation
results = pipeline.run(predictions, references)

# Generate report
report = pipeline.to_report(results)
print(report)
```

## Integration with Azure ML

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import Model
import mlflow

def log_evaluation_results(
    ml_client: MLClient,
    model_name: str,
    results: List[EvaluationResult]
):
    """Log evaluation results to Azure ML"""

    with mlflow.start_run():
        # Log metrics
        for result in results:
            mlflow.log_metric(result.metric_name.replace(" ", "_"), result.score)

        # Log evaluation report
        report = pipeline.to_report(results)
        with open("evaluation_report.md", "w") as f:
            f.write(report)
        mlflow.log_artifact("evaluation_report.md")

        # Register model if metrics meet threshold
        if all(r.score > 0.8 for r in results):
            mlflow.register_model(
                f"runs:/{mlflow.active_run().info.run_id}/model",
                model_name
            )
```

## Conclusion

A comprehensive evaluation framework combining traditional metrics, semantic similarity, and LLM-based judgment provides the most complete picture of model performance. Always evaluate across multiple dimensions before production deployment.
