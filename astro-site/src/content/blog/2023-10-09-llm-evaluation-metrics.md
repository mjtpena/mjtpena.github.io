---
title: "LLM Evaluation Metrics: Measuring What Matters"
author: Michael John Peña
draft: false
date: 2023-10-09
description: "Understanding and implementing key metrics for evaluating LLM application performance and quality."
tags:
  - LLM Evaluation
  - Metrics
  - Quality
  - AI
  - Testing
---

LLM evaluation metrics exist on a spectrum from fully automated (no human in the loop) to human-graded, and the trade-off is cost and consistency vs. the granularity and nuance of human judgment. The automated metrics I find most useful in practice: faithfulness (does the response accurately reflect the retrieved context — essential for RAG applications where hallucination on top of context is a key failure mode), answer relevancy (does the response actually address the question asked), and context precision (are the retrieved documents actually relevant to the question). The RAGAS framework (Retrieval Augmented Generation Assessment) implements these as automated metrics using GPT-4 as the evaluator, which makes it practical to run evaluation sweeps across large test sets without human review of every response. The caveat: GPT-4 as an evaluator has its own consistency and calibration issues; these scores should be used directionally, not as absolute quality scores.

## Introduction

Choosing the right evaluation metrics is crucial for understanding LLM application performance. This post covers essential metrics, their implementation, and when to use each one.

## Core Evaluation Metrics

### Text Similarity Metrics

```python
import numpy as np
from typing import List, Tuple
from collections import Counter
import math

class TextSimilarityMetrics:
    """Collection of text similarity metrics"""

    @staticmethod
    def exact_match(prediction: str, reference: str) -> float:
        """Exact string match"""
        return 1.0 if prediction.strip() == reference.strip() else 0.0

    @staticmethod
    def contains_match(prediction: str, reference: str) -> float:
        """Check if reference is contained in prediction"""
        return 1.0 if reference.lower() in prediction.lower() else 0.0

    @staticmethod
    def token_overlap(prediction: str, reference: str) -> float:
        """Token-level overlap (Jaccard similarity)"""
        pred_tokens = set(prediction.lower().split())
        ref_tokens = set(reference.lower().split())

        if not pred_tokens or not ref_tokens:
            return 0.0

        intersection = pred_tokens & ref_tokens
        union = pred_tokens | ref_tokens

        return len(intersection) / len(union)

    @staticmethod
    def bleu_score(prediction: str, reference: str, n: int = 4) -> float:
        """BLEU score for text generation"""
        pred_tokens = prediction.lower().split()
        ref_tokens = reference.lower().split()

        scores = []
        for i in range(1, n + 1):
            pred_ngrams = Counter(
                tuple(pred_tokens[j:j+i])
                for j in range(len(pred_tokens) - i + 1)
            )
            ref_ngrams = Counter(
                tuple(ref_tokens[j:j+i])
                for j in range(len(ref_tokens) - i + 1)
            )

            if not pred_ngrams:
                scores.append(0)
                continue

            overlap = sum(
                min(pred_ngrams[ng], ref_ngrams[ng])
                for ng in pred_ngrams
            )
            scores.append(overlap / sum(pred_ngrams.values()))

        # Geometric mean with brevity penalty
        if all(s > 0 for s in scores):
            geo_mean = math.exp(sum(math.log(s) for s in scores) / len(scores))
        else:
            geo_mean = 0

        # Brevity penalty
        bp = min(1.0, math.exp(1 - len(ref_tokens) / max(len(pred_tokens), 1)))

        return bp * geo_mean

    @staticmethod
    def rouge_l(prediction: str, reference: str) -> dict:
        """ROUGE-L score (longest common subsequence)"""
        pred_tokens = prediction.lower().split()
        ref_tokens = reference.lower().split()

        # LCS length using dynamic programming
        m, n = len(pred_tokens), len(ref_tokens)
        dp = [[0] * (n + 1) for _ in range(m + 1)]

        for i in range(1, m + 1):
            for j in range(1, n + 1):
                if pred_tokens[i-1] == ref_tokens[j-1]:
                    dp[i][j] = dp[i-1][j-1] + 1
                else:
                    dp[i][j] = max(dp[i-1][j], dp[i][j-1])

        lcs = dp[m][n]

        precision = lcs / m if m > 0 else 0
        recall = lcs / n if n > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

        return {
            "precision": precision,
            "recall": recall,
            "f1": f1
        }

# Usage
metrics = TextSimilarityMetrics()

prediction = "Python is a popular programming language used for web development"
reference = "Python is a programming language"

print(f"Exact match: {metrics.exact_match(prediction, reference)}")
print(f"Token overlap: {metrics.token_overlap(prediction, reference):.3f}")
print(f"BLEU-4: {metrics.bleu_score(prediction, reference):.3f}")
print(f"ROUGE-L: {metrics.rouge_l(prediction, reference)}")
```

### Semantic Similarity

```python
from langchain_openai import OpenAIEmbeddings
import numpy as np

class SemanticSimilarityMetrics:
    """Semantic similarity using embeddings"""

    def __init__(self):
        self.embeddings = OpenAIEmbeddings()

    def cosine_similarity(self, text1: str, text2: str) -> float:
        """Cosine similarity between embeddings"""
        emb1 = self.embeddings.embed_query(text1)
        emb2 = self.embeddings.embed_query(text2)

        emb1 = np.array(emb1)
        emb2 = np.array(emb2)

        return float(np.dot(emb1, emb2) / (np.linalg.norm(emb1) * np.linalg.norm(emb2)))

    def batch_similarity(self, predictions: List[str], references: List[str]) -> List[float]:
        """Batch compute similarities"""
        pred_embeddings = self.embeddings.embed_documents(predictions)
        ref_embeddings = self.embeddings.embed_documents(references)

        similarities = []
        for pred_emb, ref_emb in zip(pred_embeddings, ref_embeddings):
            pred_emb = np.array(pred_emb)
            ref_emb = np.array(ref_emb)
            sim = np.dot(pred_emb, ref_emb) / (np.linalg.norm(pred_emb) * np.linalg.norm(ref_emb))
            similarities.append(float(sim))

        return similarities

    def semantic_search_score(self, query: str, response: str, context: str) -> float:
        """Score how well response addresses query given context"""
        # Embed all texts
        query_emb = np.array(self.embeddings.embed_query(query))
        response_emb = np.array(self.embeddings.embed_query(response))
        context_emb = np.array(self.embeddings.embed_query(context))

        # Response should be similar to both query intent and context
        query_sim = np.dot(response_emb, query_emb) / (np.linalg.norm(response_emb) * np.linalg.norm(query_emb))
        context_sim = np.dot(response_emb, context_emb) / (np.linalg.norm(response_emb) * np.linalg.norm(context_emb))

        # Weighted average
        return 0.6 * query_sim + 0.4 * context_sim

# Usage
semantic = SemanticSimilarityMetrics()
sim = semantic.cosine_similarity(
    "Python is great for data science",
    "Python is excellent for data analysis and machine learning"
)
print(f"Semantic similarity: {sim:.3f}")
```

### Task-Specific Metrics

```python
from typing import List, Dict, Any
import json

class TaskSpecificMetrics:
    """Metrics for specific LLM tasks"""

    @staticmethod
    def qa_f1(prediction: str, reference: str) -> float:
        """F1 score for QA tasks (token level)"""
        pred_tokens = prediction.lower().split()
        ref_tokens = reference.lower().split()

        common = Counter(pred_tokens) & Counter(ref_tokens)
        num_same = sum(common.values())

        if num_same == 0:
            return 0.0

        precision = num_same / len(pred_tokens)
        recall = num_same / len(ref_tokens)

        return 2 * precision * recall / (precision + recall)

    @staticmethod
    def classification_accuracy(predictions: List[str], references: List[str]) -> float:
        """Accuracy for classification tasks"""
        correct = sum(
            1 for p, r in zip(predictions, references)
            if p.strip().lower() == r.strip().lower()
        )
        return correct / len(predictions) if predictions else 0

    @staticmethod
    def json_validity(response: str) -> Dict[str, Any]:
        """Check if response is valid JSON"""
        try:
            parsed = json.loads(response)
            return {
                "valid": True,
                "parsed": parsed,
                "error": None
            }
        except json.JSONDecodeError as e:
            return {
                "valid": False,
                "parsed": None,
                "error": str(e)
            }

    @staticmethod
    def structured_output_score(response: str, schema: Dict) -> float:
        """Score structured output against schema"""
        validity = TaskSpecificMetrics.json_validity(response)
        if not validity["valid"]:
            return 0.0

        parsed = validity["parsed"]
        required_keys = schema.get("required", list(schema.get("properties", {}).keys()))

        present_keys = set(parsed.keys()) if isinstance(parsed, dict) else set()
        required_set = set(required_keys)

        if not required_set:
            return 1.0

        return len(present_keys & required_set) / len(required_set)

    @staticmethod
    def summarization_metrics(summary: str, source: str) -> Dict[str, float]:
        """Metrics for summarization tasks"""
        # Compression ratio
        compression = 1 - (len(summary) / len(source)) if source else 0

        # Content coverage (simple word overlap)
        source_words = set(source.lower().split())
        summary_words = set(summary.lower().split())
        coverage = len(summary_words & source_words) / len(summary_words) if summary_words else 0

        # Density (unique information per word)
        unique_in_summary = summary_words - source_words
        novelty = len(unique_in_summary) / len(summary_words) if summary_words else 0

        return {
            "compression_ratio": compression,
            "content_coverage": coverage,
            "novelty_ratio": novelty
        }

# Usage
task_metrics = TaskSpecificMetrics()

# QA evaluation
qa_score = task_metrics.qa_f1(
    "Python is a programming language",
    "Python is a popular programming language for data science"
)
print(f"QA F1: {qa_score:.3f}")

# Summarization
sum_metrics = task_metrics.summarization_metrics(
    "AI is transforming industries.",
    "Artificial intelligence is rapidly transforming multiple industries including healthcare, finance, and manufacturing."
)
print(f"Summarization metrics: {sum_metrics}")
```

### LLM-as-Judge Metrics

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

class LLMJudgeMetrics:
    """Use LLM as judge for evaluation"""

    def __init__(self, judge_model: str = "gpt-4"):
        self.llm = ChatOpenAI(model=judge_model, temperature=0)

    def pairwise_comparison(self, query: str, response_a: str, response_b: str) -> Dict:
        """Compare two responses and pick the better one"""
        prompt = ChatPromptTemplate.from_template("""
        Compare these two responses to the query.

        Query: {query}

        Response A:
        {response_a}

        Response B:
        {response_b}

        Which response is better? Consider:
        - Accuracy and correctness
        - Completeness
        - Clarity
        - Relevance

        Return JSON: {{"winner": "A" or "B" or "tie", "reasoning": "..."}}
        """)

        result = (prompt | self.llm).invoke({
            "query": query,
            "response_a": response_a,
            "response_b": response_b
        })

        try:
            return json.loads(result.content)
        except:
            return {"winner": "tie", "reasoning": "Failed to parse"}

    def score_response(self, query: str, response: str, criteria: List[str]) -> Dict:
        """Score response on multiple criteria"""
        criteria_str = "\n".join(f"- {c}" for c in criteria)

        prompt = ChatPromptTemplate.from_template("""
        Score this response on each criterion (0-10).

        Query: {query}
        Response: {response}

        Criteria:
        {criteria}

        Return JSON: {{
            "scores": {{"criterion1": score, "criterion2": score, ...}},
            "overall": <average>,
            "feedback": "..."
        }}
        """)

        result = (prompt | self.llm).invoke({
            "query": query,
            "response": response,
            "criteria": criteria_str
        })

        try:
            parsed = json.loads(result.content)
            # Normalize scores to 0-1
            if "scores" in parsed:
                parsed["normalized_scores"] = {
                    k: v / 10.0 for k, v in parsed["scores"].items()
                }
            return parsed
        except:
            return {"error": "Failed to parse"}

    def reference_comparison(self, query: str, prediction: str, reference: str) -> Dict:
        """Compare prediction against reference answer"""
        prompt = ChatPromptTemplate.from_template("""
        Compare the prediction to the reference answer.

        Query: {query}
        Reference (correct): {reference}
        Prediction: {prediction}

        Evaluate:
        1. Correctness: Does prediction convey the same information?
        2. Completeness: Does prediction cover all points in reference?
        3. Accuracy: Are there any errors in prediction?

        Return JSON: {{
            "correctness": 0-10,
            "completeness": 0-10,
            "accuracy": 0-10,
            "errors": ["list of errors if any"],
            "missing": ["list of missing points"]
        }}
        """)

        result = (prompt | self.llm).invoke({
            "query": query,
            "reference": reference,
            "prediction": prediction
        })

        try:
            return json.loads(result.content)
        except:
            return {"error": "Failed to parse"}

# Usage
judge = LLMJudgeMetrics()

# Pairwise comparison
comparison = judge.pairwise_comparison(
    "What is Python?",
    "Python is a programming language.",
    "Python is a high-level, interpreted programming language known for its simplicity and versatility."
)
print(f"Winner: {comparison['winner']}")

# Multi-criteria scoring
score = judge.score_response(
    "Explain machine learning",
    "Machine learning is a type of AI that learns from data.",
    ["accuracy", "completeness", "clarity", "technical depth"]
)
print(f"Scores: {score}")
```

## Aggregating Metrics

```python
from dataclasses import dataclass
from typing import Dict, List

@dataclass
class AggregatedMetrics:
    mean: float
    median: float
    std: float
    min: float
    max: float
    p25: float
    p75: float
    p95: float

class MetricsAggregator:
    """Aggregate metrics across multiple samples"""

    @staticmethod
    def aggregate(scores: List[float]) -> AggregatedMetrics:
        """Compute aggregate statistics"""
        if not scores:
            return AggregatedMetrics(0, 0, 0, 0, 0, 0, 0, 0)

        sorted_scores = sorted(scores)
        n = len(sorted_scores)

        return AggregatedMetrics(
            mean=sum(scores) / n,
            median=sorted_scores[n // 2],
            std=np.std(scores),
            min=min(scores),
            max=max(scores),
            p25=sorted_scores[int(n * 0.25)],
            p75=sorted_scores[int(n * 0.75)],
            p95=sorted_scores[int(n * 0.95)]
        )

    @staticmethod
    def compare_models(model_a_scores: Dict[str, List[float]],
                       model_b_scores: Dict[str, List[float]]) -> Dict:
        """Compare two models across metrics"""
        comparison = {}

        all_metrics = set(model_a_scores.keys()) | set(model_b_scores.keys())

        for metric in all_metrics:
            a_scores = model_a_scores.get(metric, [])
            b_scores = model_b_scores.get(metric, [])

            a_mean = sum(a_scores) / len(a_scores) if a_scores else 0
            b_mean = sum(b_scores) / len(b_scores) if b_scores else 0

            comparison[metric] = {
                "model_a_mean": a_mean,
                "model_b_mean": b_mean,
                "difference": b_mean - a_mean,
                "winner": "B" if b_mean > a_mean else "A" if a_mean > b_mean else "tie"
            }

        return comparison

# Usage
aggregator = MetricsAggregator()
scores = [0.85, 0.90, 0.78, 0.92, 0.88]
agg = aggregator.aggregate(scores)
print(f"Mean: {agg.mean:.3f}, P95: {agg.p95:.3f}")
```

## Conclusion

Effective LLM evaluation requires a combination of automated metrics, semantic similarity measures, task-specific metrics, and LLM-as-judge approaches. By implementing comprehensive metrics and aggregation strategies, you can systematically measure and improve your LLM applications across multiple dimensions of quality.
