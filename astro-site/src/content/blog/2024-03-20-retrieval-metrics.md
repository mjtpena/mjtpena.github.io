---
title: "Retrieval Metrics for RAG: A Deep Dive"
description: "The retrieval component of RAG systems directly impacts generation quality. This guide provides a comprehensive overview of retrieval metrics and how to…"
author: "Michael John Peña"
draft: false
date: 2024-03-20
tags: ["AI", "RAG", "Search", "Evaluation", "Information Retrieval"]
---

The retrieval component of RAG systems directly impacts generation quality. This guide provides a comprehensive overview of retrieval metrics and how to implement them.

## Core Retrieval Metrics

```python
import numpy as np
from typing import List, Set, Dict
from dataclasses import dataclass

@dataclass
class RetrievalResult:
    query_id: str
    retrieved_doc_ids: List[str]
    relevant_doc_ids: Set[str]
    retrieval_scores: List[float]

class RetrievalMetrics:
    """Comprehensive retrieval metrics implementation"""

    @staticmethod
    def precision_at_k(result: RetrievalResult, k: int) -> float:
        """
        Precision@K: What fraction of retrieved docs are relevant?

        Formula: |Retrieved ∩ Relevant| / K
        """
        retrieved_k = result.retrieved_doc_ids[:k]
        relevant_retrieved = sum(1 for doc in retrieved_k if doc in result.relevant_doc_ids)
        return relevant_retrieved / k if k > 0 else 0.0

    @staticmethod
    def recall_at_k(result: RetrievalResult, k: int) -> float:
        """
        Recall@K: What fraction of relevant docs are retrieved?

        Formula: |Retrieved ∩ Relevant| / |Relevant|
        """
        if not result.relevant_doc_ids:
            return 0.0
        retrieved_k = set(result.retrieved_doc_ids[:k])
        relevant_retrieved = len(retrieved_k & result.relevant_doc_ids)
        return relevant_retrieved / len(result.relevant_doc_ids)

    @staticmethod
    def f1_at_k(result: RetrievalResult, k: int) -> float:
        """F1@K: Harmonic mean of precision and recall"""
        p = RetrievalMetrics.precision_at_k(result, k)
        r = RetrievalMetrics.recall_at_k(result, k)
        if p + r == 0:
            return 0.0
        return 2 * p * r / (p + r)

    @staticmethod
    def average_precision(result: RetrievalResult) -> float:
        """
        Average Precision: Area under precision-recall curve

        AP = (1/|Relevant|) * Σ (Precision@k * rel(k))
        where rel(k) = 1 if doc at position k is relevant
        """
        if not result.relevant_doc_ids:
            return 0.0

        relevant_count = 0
        precision_sum = 0.0

        for i, doc_id in enumerate(result.retrieved_doc_ids):
            if doc_id in result.relevant_doc_ids:
                relevant_count += 1
                precision_sum += relevant_count / (i + 1)

        return precision_sum / len(result.relevant_doc_ids)

    @staticmethod
    def reciprocal_rank(result: RetrievalResult) -> float:
        """
        Reciprocal Rank: 1 / position of first relevant doc

        Used for queries with single relevant answer
        """
        for i, doc_id in enumerate(result.retrieved_doc_ids):
            if doc_id in result.relevant_doc_ids:
                return 1.0 / (i + 1)
        return 0.0

    @staticmethod
    def ndcg_at_k(result: RetrievalResult, k: int) -> float:
        """
        Normalized Discounted Cumulative Gain@K

        Accounts for position-based discount in ranking
        """
        def dcg(relevances: List[float]) -> float:
            return sum(
                rel / np.log2(i + 2)  # i+2 because log2(1) = 0
                for i, rel in enumerate(relevances)
            )

        # Calculate actual DCG
        actual_relevances = [
            1.0 if doc in result.relevant_doc_ids else 0.0
            for doc in result.retrieved_doc_ids[:k]
        ]
        actual_dcg = dcg(actual_relevances)

        # Calculate ideal DCG
        ideal_relevances = sorted(actual_relevances, reverse=True)
        ideal_dcg = dcg(ideal_relevances)

        if ideal_dcg == 0:
            return 0.0
        return actual_dcg / ideal_dcg

    @staticmethod
    def hit_rate_at_k(result: RetrievalResult, k: int) -> float:
        """
        Hit Rate@K: Is there at least one relevant doc in top-K?

        Binary metric: 1 if any relevant doc in top-K, else 0
        """
        retrieved_k = set(result.retrieved_doc_ids[:k])
        return 1.0 if retrieved_k & result.relevant_doc_ids else 0.0
```

## Evaluating Multiple Queries

```python
class RetrievalEvaluator:
    """Evaluate retrieval over multiple queries"""

    def __init__(self, k_values: List[int] = [1, 3, 5, 10, 20]):
        self.k_values = k_values
        self.metrics = RetrievalMetrics()

    def evaluate(self, results: List[RetrievalResult]) -> Dict[str, float]:
        """Calculate all metrics across queries"""

        evaluation = {}

        # K-dependent metrics
        for k in self.k_values:
            precision_scores = [self.metrics.precision_at_k(r, k) for r in results]
            recall_scores = [self.metrics.recall_at_k(r, k) for r in results]
            f1_scores = [self.metrics.f1_at_k(r, k) for r in results]
            ndcg_scores = [self.metrics.ndcg_at_k(r, k) for r in results]
            hit_rates = [self.metrics.hit_rate_at_k(r, k) for r in results]

            evaluation[f"P@{k}"] = np.mean(precision_scores)
            evaluation[f"R@{k}"] = np.mean(recall_scores)
            evaluation[f"F1@{k}"] = np.mean(f1_scores)
            evaluation[f"NDCG@{k}"] = np.mean(ndcg_scores)
            evaluation[f"Hit@{k}"] = np.mean(hit_rates)

        # K-independent metrics
        ap_scores = [self.metrics.average_precision(r) for r in results]
        rr_scores = [self.metrics.reciprocal_rank(r) for r in results]

        evaluation["MAP"] = np.mean(ap_scores)  # Mean Average Precision
        evaluation["MRR"] = np.mean(rr_scores)  # Mean Reciprocal Rank

        return evaluation

    def generate_report(self, evaluation: Dict[str, float]) -> str:
        """Generate human-readable report"""
        report = "# Retrieval Evaluation Report\n\n"

        # Group by metric type
        precision_metrics = {k: v for k, v in evaluation.items() if k.startswith("P@")}
        recall_metrics = {k: v for k, v in evaluation.items() if k.startswith("R@")}
        ndcg_metrics = {k: v for k, v in evaluation.items() if k.startswith("NDCG@")}

        report += "## Precision\n"
        for metric, value in sorted(precision_metrics.items()):
            report += f"- {metric}: {value:.4f}\n"

        report += "\n## Recall\n"
        for metric, value in sorted(recall_metrics.items()):
            report += f"- {metric}: {value:.4f}\n"

        report += "\n## NDCG\n"
        for metric, value in sorted(ndcg_metrics.items()):
            report += f"- {metric}: {value:.4f}\n"

        report += f"\n## Overall\n"
        report += f"- MAP: {evaluation['MAP']:.4f}\n"
        report += f"- MRR: {evaluation['MRR']:.4f}\n"

        return report
```

## Graded Relevance Metrics

```python
@dataclass
class GradedRetrievalResult:
    """For systems with graded relevance (0-3 scale)"""
    query_id: str
    retrieved_doc_ids: List[str]
    relevance_grades: Dict[str, int]  # doc_id -> grade (0-3)

class GradedRetrievalMetrics:
    """Metrics for graded relevance judgments"""

    @staticmethod
    def graded_ndcg_at_k(result: GradedRetrievalResult, k: int) -> float:
        """NDCG with graded relevance"""

        def dcg(grades: List[int]) -> float:
            return sum(
                (2 ** grade - 1) / np.log2(i + 2)
                for i, grade in enumerate(grades)
            )

        # Actual DCG
        actual_grades = [
            result.relevance_grades.get(doc, 0)
            for doc in result.retrieved_doc_ids[:k]
        ]
        actual_dcg = dcg(actual_grades)

        # Ideal DCG (best possible ordering)
        all_grades = sorted(result.relevance_grades.values(), reverse=True)[:k]
        # Pad with zeros if needed
        all_grades.extend([0] * (k - len(all_grades)))
        ideal_dcg = dcg(all_grades)

        if ideal_dcg == 0:
            return 0.0
        return actual_dcg / ideal_dcg

    @staticmethod
    def expected_reciprocal_rank(
        result: GradedRetrievalResult,
        max_grade: int = 3
    ) -> float:
        """
        Expected Reciprocal Rank (ERR)

        Models probability of user finding relevant doc at each position
        """
        err = 0.0
        prob_stop = 0.0

        for i, doc_id in enumerate(result.retrieved_doc_ids):
            grade = result.relevance_grades.get(doc_id, 0)
            # Probability of relevance given grade
            prob_rel = (2 ** grade - 1) / (2 ** max_grade)

            err += (1 - prob_stop) * prob_rel / (i + 1)
            prob_stop += (1 - prob_stop) * prob_rel

        return err
```

## Practical Example

```python
# Create sample results
results = [
    RetrievalResult(
        query_id="q1",
        retrieved_doc_ids=["d1", "d3", "d5", "d2", "d7"],
        relevant_doc_ids={"d1", "d2", "d4"},
        retrieval_scores=[0.95, 0.85, 0.75, 0.70, 0.65]
    ),
    RetrievalResult(
        query_id="q2",
        retrieved_doc_ids=["d6", "d8", "d1", "d9", "d2"],
        relevant_doc_ids={"d1", "d2"},
        retrieval_scores=[0.90, 0.85, 0.80, 0.75, 0.70]
    )
]

# Evaluate
evaluator = RetrievalEvaluator(k_values=[1, 3, 5])
evaluation = evaluator.evaluate(results)

print(evaluator.generate_report(evaluation))
```

## Conclusion

Understanding retrieval metrics is essential for optimizing RAG systems. Different metrics capture different aspects of retrieval quality - use multiple metrics for a complete picture.
