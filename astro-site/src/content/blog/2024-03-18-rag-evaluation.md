---
title: "RAG Evaluation: Measuring Retrieval-Augmented Generation Quality"
author: "Michael John Peña"
draft: false
date: 2024-03-18
tags: ["AI", "RAG", "Evaluation", "LLM", "Search"]

---

I wrote "RAG Evaluation: Measuring Retrieval-Augmented Generation Quality" to share practical, production-minded guidance on this topic.

Retrieval-Augmented Generation (RAG) systems combine retrieval and generation components, each requiring specific evaluation strategies. This guide covers comprehensive RAG evaluation approaches.

## RAG System Components

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum

class RAGComponent(Enum):
    RETRIEVAL = "retrieval"
    GENERATION = "generation"
    END_TO_END = "end_to_end"

@dataclass
class RAGTestCase:
    question: str
    ground_truth_answer: str
    relevant_documents: List[str]  # Document IDs
    context: Optional[str] = None  # For generation-only testing

@dataclass
class RAGResult:
    question: str
    retrieved_docs: List[Dict]
    generated_answer: str
    retrieval_time_ms: float
    generation_time_ms: float
```

## Retrieval Evaluation Metrics

```python
import numpy as np
from typing import Set

class RetrievalEvaluator:
    """Evaluate retrieval component of RAG"""

    def precision_at_k(
        self,
        retrieved: List[str],
        relevant: Set[str],
        k: int
    ) -> float:
        """Precision at k - what fraction of top-k are relevant"""
        if k == 0:
            return 0.0
        retrieved_at_k = retrieved[:k]
        relevant_retrieved = sum(1 for doc in retrieved_at_k if doc in relevant)
        return relevant_retrieved / k

    def recall_at_k(
        self,
        retrieved: List[str],
        relevant: Set[str],
        k: int
    ) -> float:
        """Recall at k - what fraction of relevant docs are in top-k"""
        if not relevant:
            return 0.0
        retrieved_at_k = set(retrieved[:k])
        relevant_retrieved = len(retrieved_at_k & relevant)
        return relevant_retrieved / len(relevant)

    def mrr(self, retrieved: List[str], relevant: Set[str]) -> float:
        """Mean Reciprocal Rank"""
        for i, doc in enumerate(retrieved):
            if doc in relevant:
                return 1.0 / (i + 1)
        return 0.0

    def ndcg_at_k(
        self,
        retrieved: List[str],
        relevant: Set[str],
        k: int
    ) -> float:
        """Normalized Discounted Cumulative Gain at k"""
        def dcg(scores: List[float]) -> float:
            return sum(
                score / np.log2(i + 2)
                for i, score in enumerate(scores)
            )

        # Actual DCG
        relevance_scores = [
            1.0 if doc in relevant else 0.0
            for doc in retrieved[:k]
        ]
        actual_dcg = dcg(relevance_scores)

        # Ideal DCG
        ideal_scores = sorted(relevance_scores, reverse=True)
        ideal_dcg = dcg(ideal_scores)

        if ideal_dcg == 0:
            return 0.0
        return actual_dcg / ideal_dcg

    def evaluate(
        self,
        test_cases: List[RAGTestCase],
        results: List[RAGResult],
        k_values: List[int] = [1, 3, 5, 10]
    ) -> Dict[str, float]:
        """Evaluate retrieval across all test cases"""

        metrics = {}

        for k in k_values:
            p_scores = []
            r_scores = []
            ndcg_scores = []

            for case, result in zip(test_cases, results):
                relevant = set(case.relevant_documents)
                retrieved = [d['id'] for d in result.retrieved_docs]

                p_scores.append(self.precision_at_k(retrieved, relevant, k))
                r_scores.append(self.recall_at_k(retrieved, relevant, k))
                ndcg_scores.append(self.ndcg_at_k(retrieved, relevant, k))

            metrics[f"precision@{k}"] = np.mean(p_scores)
            metrics[f"recall@{k}"] = np.mean(r_scores)
            metrics[f"ndcg@{k}"] = np.mean(ndcg_scores)

        # MRR (not k-dependent)
        mrr_scores = []
        for case, result in zip(test_cases, results):
            relevant = set(case.relevant_documents)
            retrieved = [d['id'] for d in result.retrieved_docs]
            mrr_scores.append(self.mrr(retrieved, relevant))

        metrics["mrr"] = np.mean(mrr_scores)

        return metrics

# Usage
retrieval_evaluator = RetrievalEvaluator()
```

## Generation Evaluation

```python
import anthropic

class GenerationEvaluator:
    """Evaluate generation component of RAG"""

    def __init__(self):
        self.client = anthropic.Anthropic()

    def faithfulness(
        self,
        answer: str,
        context: str
    ) -> float:
        """Check if answer is faithful to the context"""
        prompt = f"""Evaluate if the following answer is faithful to the given context.
An answer is faithful if all claims in the answer can be inferred from the context.

Context:
{context}

Answer:
{answer}

Rate faithfulness from 0 to 1:
- 1.0: Completely faithful, all claims supported
- 0.5: Partially faithful, some unsupported claims
- 0.0: Not faithful, contradicts or fabricates

Respond with only the number."""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=10,
            messages=[{"role": "user", "content": prompt}]
        )

        try:
            return float(response.content[0].text.strip())
        except:
            return 0.5

    def answer_relevance(
        self,
        question: str,
        answer: str
    ) -> float:
        """Check if answer is relevant to the question"""
        prompt = f"""Evaluate if the following answer is relevant to the question.
An answer is relevant if it directly addresses what was asked.

Question: {question}

Answer: {answer}

Rate relevance from 0 to 1:
- 1.0: Directly answers the question
- 0.5: Partially relevant
- 0.0: Not relevant at all

Respond with only the number."""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=10,
            messages=[{"role": "user", "content": prompt}]
        )

        try:
            return float(response.content[0].text.strip())
        except:
            return 0.5

    def answer_correctness(
        self,
        generated: str,
        ground_truth: str
    ) -> float:
        """Compare generated answer to ground truth"""
        prompt = f"""Compare the generated answer to the ground truth.
Evaluate factual correctness and completeness.

Ground Truth:
{ground_truth}

Generated Answer:
{generated}

Rate correctness from 0 to 1:
- 1.0: Completely correct and complete
- 0.5: Partially correct
- 0.0: Incorrect

Respond with only the number."""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=10,
            messages=[{"role": "user", "content": prompt}]
        )

        try:
            return float(response.content[0].text.strip())
        except:
            return 0.5

    def evaluate(
        self,
        test_cases: List[RAGTestCase],
        results: List[RAGResult]
    ) -> Dict[str, float]:
        """Evaluate generation across all test cases"""

        faithfulness_scores = []
        relevance_scores = []
        correctness_scores = []

        for case, result in zip(test_cases, results):
            # Build context from retrieved docs
            context = "\n\n".join(d['content'] for d in result.retrieved_docs)

            faithfulness_scores.append(
                self.faithfulness(result.generated_answer, context)
            )
            relevance_scores.append(
                self.answer_relevance(case.question, result.generated_answer)
            )
            correctness_scores.append(
                self.answer_correctness(result.generated_answer, case.ground_truth_answer)
            )

        return {
            "faithfulness": np.mean(faithfulness_scores),
            "answer_relevance": np.mean(relevance_scores),
            "answer_correctness": np.mean(correctness_scores)
        }

generation_evaluator = GenerationEvaluator()
```

## End-to-End RAG Evaluation

```python
class RAGEvaluator:
    """Complete RAG system evaluation"""

    def __init__(self):
        self.retrieval_evaluator = RetrievalEvaluator()
        self.generation_evaluator = GenerationEvaluator()

    def evaluate(
        self,
        test_cases: List[RAGTestCase],
        results: List[RAGResult]
    ) -> Dict[str, float]:
        """Run complete evaluation"""

        # Retrieval metrics
        retrieval_metrics = self.retrieval_evaluator.evaluate(
            test_cases, results
        )

        # Generation metrics
        generation_metrics = self.generation_evaluator.evaluate(
            test_cases, results
        )

        # Latency metrics
        retrieval_latencies = [r.retrieval_time_ms for r in results]
        generation_latencies = [r.generation_time_ms for r in results]

        latency_metrics = {
            "avg_retrieval_ms": np.mean(retrieval_latencies),
            "p95_retrieval_ms": np.percentile(retrieval_latencies, 95),
            "avg_generation_ms": np.mean(generation_latencies),
            "p95_generation_ms": np.percentile(generation_latencies, 95),
            "avg_total_ms": np.mean([r + g for r, g in zip(retrieval_latencies, generation_latencies)])
        }

        return {
            "retrieval": retrieval_metrics,
            "generation": generation_metrics,
            "latency": latency_metrics
        }

    def generate_report(self, metrics: Dict) -> str:
        """Generate evaluation report"""
        report = "# RAG Evaluation Report\n\n"

        report += "## Retrieval Metrics\n"
        for metric, value in metrics["retrieval"].items():
            report += f"- {metric}: {value:.3f}\n"

        report += "\n## Generation Metrics\n"
        for metric, value in metrics["generation"].items():
            report += f"- {metric}: {value:.3f}\n"

        report += "\n## Latency Metrics\n"
        for metric, value in metrics["latency"].items():
            report += f"- {metric}: {value:.1f}ms\n"

        return report

# Usage
rag_evaluator = RAGEvaluator()
# metrics = rag_evaluator.evaluate(test_cases, results)
# print(rag_evaluator.generate_report(metrics))
```

## Conclusion

Comprehensive RAG evaluation requires measuring both retrieval quality and generation quality. Use a combination of automated metrics and LLM-based evaluation to get a complete picture of system performance.

