---
title: "End-to-End RAG Evaluation: Complete System Assessment"
description: "Individual component metrics tell part of the story, but end-to-end evaluation measures how well your entire RAG pipeline performs as a system."
author: "Michael John Peña"
draft: false
date: 2024-03-26
tags: ["AI", "RAG", "Evaluation", "MLOps", "Testing"]
---

Individual component metrics tell part of the story, but end-to-end evaluation measures how well your entire RAG pipeline performs as a system.

## End-to-End Evaluation Framework

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime
import anthropic
import time

@dataclass
class E2ETestCase:
    id: str
    question: str
    ground_truth_answer: str
    relevant_doc_ids: Optional[List[str]] = None
    metadata: Dict = field(default_factory=dict)

@dataclass
class E2EResult:
    test_case_id: str
    question: str
    generated_answer: str
    retrieved_doc_ids: List[str]
    retrieval_time_ms: float
    generation_time_ms: float
    total_time_ms: float
    metrics: Dict[str, float] = field(default_factory=dict)

class EndToEndEvaluator:
    """
    Comprehensive end-to-end RAG evaluation

    Measures:
    - Answer quality (correctness, relevance)
    - Retrieval effectiveness
    - System performance (latency)
    - Cost efficiency
    """

    def __init__(self, rag_system):
        self.rag = rag_system
        self.client = anthropic.Anthropic()

    def run_test_case(self, test_case: E2ETestCase) -> E2EResult:
        """Execute single test case and collect metrics"""

        # Run RAG pipeline with timing
        start_total = time.time()

        # Retrieval phase
        start_retrieval = time.time()
        retrieved_docs = self.rag.retrieve(test_case.question)
        retrieval_time = (time.time() - start_retrieval) * 1000

        # Generation phase
        start_generation = time.time()
        generated_answer = self.rag.generate(test_case.question, retrieved_docs)
        generation_time = (time.time() - start_generation) * 1000

        total_time = (time.time() - start_total) * 1000

        return E2EResult(
            test_case_id=test_case.id,
            question=test_case.question,
            generated_answer=generated_answer,
            retrieved_doc_ids=[d["id"] for d in retrieved_docs],
            retrieval_time_ms=retrieval_time,
            generation_time_ms=generation_time,
            total_time_ms=total_time
        )

    def evaluate_answer_quality(
        self,
        generated: str,
        ground_truth: str,
        question: str
    ) -> Dict[str, float]:
        """Evaluate quality of generated answer"""

        # Correctness
        correctness_prompt = f"""Compare the generated answer to the ground truth.
Rate factual correctness from 0 to 1.

Question: {question}

Ground Truth:
{ground_truth}

Generated Answer:
{generated}

Correctness score (0-1):"""

        correctness_response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=10,
            messages=[{"role": "user", "content": correctness_prompt}]
        )

        try:
            correctness = float(correctness_response.content[0].text.strip())
        except:
            correctness = 0.5

        # Completeness
        completeness_prompt = f"""Rate how complete the generated answer is compared to ground truth.

Question: {question}

Ground Truth:
{ground_truth}

Generated Answer:
{generated}

Completeness score (0-1):"""

        completeness_response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=10,
            messages=[{"role": "user", "content": completeness_prompt}]
        )

        try:
            completeness = float(completeness_response.content[0].text.strip())
        except:
            completeness = 0.5

        # Relevance
        relevance_prompt = f"""Rate how relevant the generated answer is to the question.

Question: {question}

Generated Answer:
{generated}

Relevance score (0-1):"""

        relevance_response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=10,
            messages=[{"role": "user", "content": relevance_prompt}]
        )

        try:
            relevance = float(relevance_response.content[0].text.strip())
        except:
            relevance = 0.5

        return {
            "correctness": correctness,
            "completeness": completeness,
            "relevance": relevance,
            "quality_score": (correctness + completeness + relevance) / 3
        }

    def evaluate_batch(
        self,
        test_cases: List[E2ETestCase]
    ) -> Dict:
        """Run evaluation on batch of test cases"""

        results = []

        for test_case in test_cases:
            # Run test
            result = self.run_test_case(test_case)

            # Evaluate quality
            quality_metrics = self.evaluate_answer_quality(
                result.generated_answer,
                test_case.ground_truth_answer,
                test_case.question
            )
            result.metrics = quality_metrics

            results.append(result)

        # Aggregate metrics
        return self.aggregate_results(results)

    def aggregate_results(self, results: List[E2EResult]) -> Dict:
        """Aggregate results across all test cases"""
        import numpy as np

        # Quality metrics
        correctness_scores = [r.metrics.get("correctness", 0) for r in results]
        completeness_scores = [r.metrics.get("completeness", 0) for r in results]
        relevance_scores = [r.metrics.get("relevance", 0) for r in results]

        # Latency metrics
        retrieval_times = [r.retrieval_time_ms for r in results]
        generation_times = [r.generation_time_ms for r in results]
        total_times = [r.total_time_ms for r in results]

        return {
            "quality": {
                "correctness": np.mean(correctness_scores),
                "completeness": np.mean(completeness_scores),
                "relevance": np.mean(relevance_scores),
                "overall": np.mean([r.metrics.get("quality_score", 0) for r in results])
            },
            "latency": {
                "retrieval_avg_ms": np.mean(retrieval_times),
                "retrieval_p95_ms": np.percentile(retrieval_times, 95),
                "generation_avg_ms": np.mean(generation_times),
                "generation_p95_ms": np.percentile(generation_times, 95),
                "total_avg_ms": np.mean(total_times),
                "total_p95_ms": np.percentile(total_times, 95)
            },
            "summary": {
                "total_tests": len(results),
                "pass_rate": sum(1 for r in results if r.metrics.get("quality_score", 0) >= 0.7) / len(results)
            },
            "detailed_results": results
        }
```

## Automated Testing Pipeline

```python
class RAGTestPipeline:
    """Automated testing pipeline for RAG systems"""

    def __init__(self, rag_system, evaluator: EndToEndEvaluator):
        self.rag = rag_system
        self.evaluator = evaluator
        self.baseline_metrics = None

    def load_test_suite(self, filepath: str) -> List[E2ETestCase]:
        """Load test cases from file"""
        import json

        with open(filepath, 'r') as f:
            data = json.load(f)

        return [
            E2ETestCase(
                id=item["id"],
                question=item["question"],
                ground_truth_answer=item["answer"],
                relevant_doc_ids=item.get("relevant_docs"),
                metadata=item.get("metadata", {})
            )
            for item in data
        ]

    def run_regression_tests(
        self,
        test_cases: List[E2ETestCase],
        baseline: Dict = None
    ) -> Dict:
        """Run tests and compare to baseline"""

        results = self.evaluator.evaluate_batch(test_cases)

        if baseline:
            regression_analysis = self.compare_to_baseline(results, baseline)
            results["regression"] = regression_analysis

        return results

    def compare_to_baseline(
        self,
        current: Dict,
        baseline: Dict,
        threshold: float = 0.05
    ) -> Dict:
        """Compare current results to baseline"""

        regressions = []
        improvements = []

        # Quality metrics
        for metric in ["correctness", "completeness", "relevance"]:
            current_val = current["quality"][metric]
            baseline_val = baseline["quality"][metric]
            diff = current_val - baseline_val

            if diff < -threshold:
                regressions.append({
                    "metric": metric,
                    "baseline": baseline_val,
                    "current": current_val,
                    "diff": diff
                })
            elif diff > threshold:
                improvements.append({
                    "metric": metric,
                    "baseline": baseline_val,
                    "current": current_val,
                    "diff": diff
                })

        # Latency
        if current["latency"]["total_avg_ms"] > baseline["latency"]["total_avg_ms"] * 1.2:
            regressions.append({
                "metric": "latency",
                "baseline": baseline["latency"]["total_avg_ms"],
                "current": current["latency"]["total_avg_ms"],
                "diff_pct": (current["latency"]["total_avg_ms"] / baseline["latency"]["total_avg_ms"] - 1) * 100
            })

        return {
            "has_regressions": len(regressions) > 0,
            "regressions": regressions,
            "improvements": improvements,
            "status": "FAIL" if regressions else "PASS"
        }

    def generate_report(self, results: Dict) -> str:
        """Generate human-readable test report"""

        report = f"""# RAG End-to-End Test Report
Generated: {datetime.now().isoformat()}

## Summary
- Total Tests: {results['summary']['total_tests']}
- Pass Rate: {results['summary']['pass_rate']:.1%}

## Quality Metrics
| Metric | Score |
|--------|-------|
| Correctness | {results['quality']['correctness']:.2f} |
| Completeness | {results['quality']['completeness']:.2f} |
| Relevance | {results['quality']['relevance']:.2f} |
| Overall | {results['quality']['overall']:.2f} |

## Latency Metrics
| Metric | Value |
|--------|-------|
| Retrieval (avg) | {results['latency']['retrieval_avg_ms']:.0f}ms |
| Retrieval (p95) | {results['latency']['retrieval_p95_ms']:.0f}ms |
| Generation (avg) | {results['latency']['generation_avg_ms']:.0f}ms |
| Generation (p95) | {results['latency']['generation_p95_ms']:.0f}ms |
| Total (avg) | {results['latency']['total_avg_ms']:.0f}ms |
| Total (p95) | {results['latency']['total_p95_ms']:.0f}ms |
"""

        if "regression" in results:
            reg = results["regression"]
            report += f"""
## Regression Analysis
Status: {reg['status']}

### Regressions
"""
            for r in reg["regressions"]:
                report += f"- {r['metric']}: {r.get('diff', r.get('diff_pct', 'N/A'))}\n"

            report += "\n### Improvements\n"
            for i in reg["improvements"]:
                report += f"- {i['metric']}: +{i['diff']:.2f}\n"

        return report
```

## Continuous Evaluation

```python
class ContinuousRAGMonitor:
    """Monitor RAG quality in production"""

    def __init__(self, rag_system, alert_threshold: float = 0.7):
        self.rag = rag_system
        self.client = anthropic.Anthropic()
        self.alert_threshold = alert_threshold
        self.metrics_history = []

    def sample_and_evaluate(self, sample_size: int = 10) -> Dict:
        """Sample recent queries and evaluate"""
        # In production, this would sample from actual query logs
        # Here we simulate with recent queries

        # Evaluate sample
        scores = []
        for query in self.get_recent_queries(sample_size):
            score = self.quick_quality_check(
                query["question"],
                query["answer"],
                query["context"]
            )
            scores.append(score)

        avg_score = sum(scores) / len(scores) if scores else 0

        result = {
            "timestamp": datetime.now().isoformat(),
            "sample_size": len(scores),
            "avg_quality": avg_score,
            "below_threshold": sum(1 for s in scores if s < self.alert_threshold)
        }

        self.metrics_history.append(result)

        if avg_score < self.alert_threshold:
            self.trigger_alert(result)

        return result

    def quick_quality_check(
        self,
        question: str,
        answer: str,
        context: str
    ) -> float:
        """Quick quality assessment for monitoring"""

        prompt = f"""Quickly assess the quality of this RAG response.

Question: {question}
Context: {context[:500]}...
Answer: {answer}

Score from 0-1 based on: correctness, relevance, groundedness.
Score:"""

        response = self.client.messages.create(
            model="claude-3-haiku-20240307",  # Fast model for monitoring
            max_tokens=10,
            messages=[{"role": "user", "content": prompt}]
        )

        try:
            return float(response.content[0].text.strip())
        except:
            return 0.5

    def get_recent_queries(self, n: int) -> List[Dict]:
        """Get recent queries from logs - implement based on your logging"""
        # Placeholder - implement based on your logging infrastructure
        return []

    def trigger_alert(self, result: Dict):
        """Trigger alert for quality degradation"""
        print(f"ALERT: RAG quality below threshold: {result}")
        # Implement alerting (email, Slack, PagerDuty, etc.)
```

## Conclusion

End-to-end evaluation provides a complete picture of RAG system performance. Combine quality metrics, latency measurements, and regression testing for comprehensive assessment. Implement continuous monitoring for production systems.
