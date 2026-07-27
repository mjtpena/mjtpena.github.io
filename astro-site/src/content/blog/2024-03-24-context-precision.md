---
title: "Context Precision in RAG: Evaluating Retrieval Quality"
author: "Michael John Peña"
draft: false
date: 2024-03-24
tags: ["AI", "RAG", "Retrieval", "Evaluation", "Search"]

---

I wrote "Context Precision in RAG: Evaluating Retrieval Quality" to share practical, production-minded guidance on this topic.

Context precision measures whether the retrieved documents are actually relevant to answering the question. High precision means less noise for the generator to filter through.

## Understanding Context Precision

```python
from dataclasses import dataclass
from typing import List, Dict
import anthropic

@dataclass
class ContextPrecisionResult:
    score: float  # 0-1
    document_relevance: List[Dict]  # {doc_id, relevant, reason}
    relevant_count: int
    total_count: int

class ContextPrecisionEvaluator:
    """
    Context Precision measures the proportion of retrieved
    documents that are actually relevant to the question.

    Precision = Relevant Retrieved / Total Retrieved

    Unlike traditional IR precision, we use LLM judgment
    to determine relevance rather than binary labels.
    """

    def __init__(self):
        self.client = anthropic.Anthropic()

    def is_document_relevant(
        self,
        question: str,
        document: str,
        ground_truth: str = None
    ) -> Dict:
        """
        Determine if a document is relevant to answering the question
        """
        prompt = f"""Evaluate if this document contains information useful for answering the question.

Question: {question}

Document:
{document}

Evaluation criteria:
- Does the document contain information related to the question?
- Could this document help in formulating an answer?
- Is the document on-topic for the question?

Respond with:
RELEVANT: [brief reason] or IRRELEVANT: [brief reason]"""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=100,
            messages=[{"role": "user", "content": prompt}]
        )

        text = response.content[0].text.strip()

        is_relevant = text.upper().startswith("RELEVANT")
        reason = text.split(":", 1)[1].strip() if ":" in text else text

        return {
            "relevant": is_relevant,
            "reason": reason
        }

    def evaluate(
        self,
        question: str,
        retrieved_documents: List[str],
        ground_truth: str = None
    ) -> ContextPrecisionResult:
        """
        Calculate context precision for retrieved documents
        """
        if not retrieved_documents:
            return ContextPrecisionResult(
                score=0.0,
                document_relevance=[],
                relevant_count=0,
                total_count=0
            )

        document_relevance = []
        relevant_count = 0

        for i, doc in enumerate(retrieved_documents):
            result = self.is_document_relevant(question, doc, ground_truth)
            result["doc_id"] = i
            result["doc_preview"] = doc[:100] + "..." if len(doc) > 100 else doc
            document_relevance.append(result)

            if result["relevant"]:
                relevant_count += 1

        score = relevant_count / len(retrieved_documents)

        return ContextPrecisionResult(
            score=score,
            document_relevance=document_relevance,
            relevant_count=relevant_count,
            total_count=len(retrieved_documents)
        )
```

## Weighted Context Precision

```python
class WeightedContextPrecisionEvaluator:
    """
    Weighted precision that considers position in ranking

    Documents ranked higher should be more relevant.
    Uses position-based discounting similar to NDCG.
    """

    def __init__(self):
        self.client = anthropic.Anthropic()

    def relevance_score(
        self,
        question: str,
        document: str
    ) -> float:
        """
        Get graded relevance score (0-1) instead of binary
        """
        prompt = f"""Rate how relevant this document is for answering the question.

Question: {question}

Document:
{document}

Relevance scale:
- 1.0: Directly answers or contains key information
- 0.75: Contains useful supporting information
- 0.5: Tangentially related
- 0.25: Slightly related
- 0.0: Not relevant at all

Score (number only):"""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=10,
            messages=[{"role": "user", "content": prompt}]
        )

        try:
            return float(response.content[0].text.strip())
        except:
            return 0.0

    def evaluate(
        self,
        question: str,
        retrieved_documents: List[str]
    ) -> Dict:
        """
        Calculate weighted precision with position discounting
        """
        import numpy as np

        if not retrieved_documents:
            return {"weighted_precision": 0.0, "simple_precision": 0.0}

        scores = []
        weighted_scores = []

        for i, doc in enumerate(retrieved_documents):
            relevance = self.relevance_score(question, doc)
            scores.append(relevance)

            # Position discount: log2(rank + 1)
            position_weight = 1.0 / np.log2(i + 2)
            weighted_scores.append(relevance * position_weight)

        # Simple precision (average relevance)
        simple_precision = np.mean(scores)

        # Weighted precision (position-discounted)
        max_weights = sum(1.0 / np.log2(i + 2) for i in range(len(retrieved_documents)))
        weighted_precision = sum(weighted_scores) / max_weights

        return {
            "weighted_precision": weighted_precision,
            "simple_precision": simple_precision,
            "per_document_scores": [
                {"position": i+1, "relevance": s}
                for i, s in enumerate(scores)
            ]
        }
```

## Context Precision at K

```python
class ContextPrecisionAtK:
    """
    Precision at different K values

    Useful for understanding where relevant docs appear in ranking
    """

    def __init__(self):
        self.base_evaluator = ContextPrecisionEvaluator()

    def evaluate(
        self,
        question: str,
        retrieved_documents: List[str],
        k_values: List[int] = [1, 3, 5, 10]
    ) -> Dict[str, float]:
        """
        Calculate precision at various K values
        """
        # First, determine relevance for all documents
        full_result = self.base_evaluator.evaluate(question, retrieved_documents)

        results = {}
        relevant_mask = [d["relevant"] for d in full_result.document_relevance]

        for k in k_values:
            if k > len(retrieved_documents):
                continue

            relevant_at_k = sum(relevant_mask[:k])
            precision_at_k = relevant_at_k / k
            results[f"P@{k}"] = precision_at_k

        # Also include Mean Average Precision
        ap_sum = 0.0
        relevant_seen = 0
        for i, is_rel in enumerate(relevant_mask):
            if is_rel:
                relevant_seen += 1
                ap_sum += relevant_seen / (i + 1)

        results["MAP"] = ap_sum / max(sum(relevant_mask), 1)

        return results
```

## Integrating with Ground Truth

```python
class GroundTruthContextPrecision:
    """
    When ground truth relevant documents are known,
    use them for more accurate precision calculation
    """

    def evaluate(
        self,
        retrieved_doc_ids: List[str],
        relevant_doc_ids: List[str],
        k: int = None
    ) -> Dict[str, float]:
        """
        Calculate precision using known relevant documents
        """
        if k:
            retrieved_set = set(retrieved_doc_ids[:k])
        else:
            retrieved_set = set(retrieved_doc_ids)

        relevant_set = set(relevant_doc_ids)

        true_positives = len(retrieved_set & relevant_set)
        retrieved_count = len(retrieved_set)

        precision = true_positives / retrieved_count if retrieved_count > 0 else 0.0

        return {
            "precision": precision,
            "true_positives": true_positives,
            "retrieved": retrieved_count,
            "relevant": len(relevant_set)
        }
```

## Practical Example

```python
# Example usage
question = "How do I configure auto-scaling in Azure Kubernetes Service?"

retrieved_docs = [
    "Azure Kubernetes Service (AKS) supports cluster autoscaler which automatically adjusts the number of nodes. Enable it using az aks update --enable-cluster-autoscaler.",
    "AKS integrates with Azure Monitor for container insights and logging.",
    "Horizontal Pod Autoscaler (HPA) scales pods based on CPU/memory metrics in AKS.",
    "Azure Virtual Machines can be configured with VM scale sets.",
    "Kubernetes pods can be scheduled across multiple nodes for high availability."
]

# Evaluate
evaluator = WeightedContextPrecisionEvaluator()
result = evaluator.evaluate(question, retrieved_docs)

print(f"Weighted Precision: {result['weighted_precision']:.2f}")
print(f"Simple Precision: {result['simple_precision']:.2f}")
print("\nPer-document scores:")
for doc_score in result['per_document_scores']:
    print(f"  Position {doc_score['position']}: {doc_score['relevance']:.2f}")

# Expected: docs 1 and 3 highly relevant, doc 4 not relevant, others somewhat
```

## Conclusion

Context precision helps identify whether your retrieval system is returning relevant documents. Low precision means the generator must work harder to filter noise, potentially leading to worse answers. Monitor precision at different K values to understand ranking quality.

