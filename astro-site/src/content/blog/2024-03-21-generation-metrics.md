---
title: "Generation Metrics for RAG: Measuring Answer Quality"
author: "Michael John Peña"
draft: false
date: 2024-03-21
tags: ["AI", "RAG", "NLG", "Evaluation", "LLM"]

---

I wrote "Generation Metrics for RAG: Measuring Answer Quality" to share practical, production-minded guidance on this topic.

While retrieval metrics measure what documents are found, generation metrics evaluate the quality of the synthesized answer. This guide covers metrics specific to RAG generation evaluation.

## Categories of Generation Metrics

```python
from enum import Enum
from dataclasses import dataclass
from typing import List, Dict, Optional

class MetricCategory(Enum):
    LEXICAL = "lexical"  # Word overlap-based
    SEMANTIC = "semantic"  # Meaning-based
    FAITHFULNESS = "faithfulness"  # Grounded in context
    FLUENCY = "fluency"  # Language quality
    RELEVANCE = "relevance"  # Answers the question

@dataclass
class GenerationMetric:
    name: str
    category: MetricCategory
    description: str
    requires_reference: bool
    requires_context: bool
```

## Lexical Metrics

```python
from collections import Counter
import numpy as np

class LexicalMetrics:
    """Word-overlap based metrics"""

    @staticmethod
    def rouge_n(hypothesis: str, reference: str, n: int = 1) -> Dict[str, float]:
        """
        ROUGE-N: N-gram overlap between hypothesis and reference

        Returns precision, recall, and F1
        """
        def get_ngrams(text: str, n: int) -> Counter:
            tokens = text.lower().split()
            return Counter(tuple(tokens[i:i+n]) for i in range(len(tokens) - n + 1))

        hyp_ngrams = get_ngrams(hypothesis, n)
        ref_ngrams = get_ngrams(reference, n)

        overlap = sum((hyp_ngrams & ref_ngrams).values())
        hyp_total = sum(hyp_ngrams.values())
        ref_total = sum(ref_ngrams.values())

        precision = overlap / hyp_total if hyp_total > 0 else 0
        recall = overlap / ref_total if ref_total > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

        return {"precision": precision, "recall": recall, "f1": f1}

    @staticmethod
    def rouge_l(hypothesis: str, reference: str) -> Dict[str, float]:
        """
        ROUGE-L: Longest Common Subsequence

        Better at capturing sentence-level structure
        """
        def lcs_length(x: List[str], y: List[str]) -> int:
            m, n = len(x), len(y)
            dp = [[0] * (n + 1) for _ in range(m + 1)]

            for i in range(1, m + 1):
                for j in range(1, n + 1):
                    if x[i-1] == y[j-1]:
                        dp[i][j] = dp[i-1][j-1] + 1
                    else:
                        dp[i][j] = max(dp[i-1][j], dp[i][j-1])

            return dp[m][n]

        hyp_tokens = hypothesis.lower().split()
        ref_tokens = reference.lower().split()

        lcs = lcs_length(hyp_tokens, ref_tokens)

        precision = lcs / len(hyp_tokens) if hyp_tokens else 0
        recall = lcs / len(ref_tokens) if ref_tokens else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

        return {"precision": precision, "recall": recall, "f1": f1}

    @staticmethod
    def bleu(hypothesis: str, reference: str, max_n: int = 4) -> float:
        """
        BLEU: Bilingual Evaluation Understudy

        Geometric mean of n-gram precisions with brevity penalty
        """
        def get_ngrams(text: str, n: int) -> Counter:
            tokens = text.lower().split()
            return Counter(tuple(tokens[i:i+n]) for i in range(len(tokens) - n + 1))

        hyp_tokens = hypothesis.lower().split()
        ref_tokens = reference.lower().split()

        # Brevity penalty
        if len(hyp_tokens) <= len(ref_tokens):
            bp = np.exp(1 - len(ref_tokens) / len(hyp_tokens)) if hyp_tokens else 0
        else:
            bp = 1.0

        # N-gram precisions
        precisions = []
        for n in range(1, max_n + 1):
            hyp_ngrams = get_ngrams(hypothesis, n)
            ref_ngrams = get_ngrams(reference, n)

            overlap = sum((hyp_ngrams & ref_ngrams).values())
            total = sum(hyp_ngrams.values())

            precision = overlap / total if total > 0 else 0
            precisions.append(precision)

        # Geometric mean
        if all(p > 0 for p in precisions):
            geo_mean = np.exp(np.mean(np.log(precisions)))
        else:
            geo_mean = 0

        return bp * geo_mean

    @staticmethod
    def meteor(hypothesis: str, reference: str) -> float:
        """
        Simplified METEOR-like scoring

        Considers unigram matching with stemming awareness
        """
        # Simplified version - just unigram F1 with different weighting
        hyp_words = set(hypothesis.lower().split())
        ref_words = set(reference.lower().split())

        matches = len(hyp_words & ref_words)

        precision = matches / len(hyp_words) if hyp_words else 0
        recall = matches / len(ref_words) if ref_words else 0

        # METEOR uses recall-weighted harmonic mean
        alpha = 0.9
        if precision + recall > 0:
            fmean = (precision * recall) / (alpha * precision + (1 - alpha) * recall)
        else:
            fmean = 0

        return fmean
```

## Semantic Metrics

```python
import anthropic

class SemanticMetrics:
    """Meaning-based metrics using LLMs"""

    def __init__(self):
        self.client = anthropic.Anthropic()

    def semantic_similarity(self, text1: str, text2: str) -> float:
        """
        Semantic similarity between two texts using LLM

        Returns score from 0 (different) to 1 (same meaning)
        """
        prompt = f"""Rate the semantic similarity between these two texts.
Consider meaning, not exact wording.

Text 1: {text1}

Text 2: {text2}

Score from 0 to 1:
- 0.0: Completely different meanings
- 0.5: Related but different
- 1.0: Same meaning

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

    def entailment_score(self, premise: str, hypothesis: str) -> float:
        """
        Check if premise entails hypothesis

        Used to verify if generated answer follows from context
        """
        prompt = f"""Determine if the premise entails the hypothesis.
Entailment means the hypothesis logically follows from the premise.

Premise: {premise}

Hypothesis: {hypothesis}

Score:
- 1.0: Definitely entails
- 0.5: Neutral/unclear
- 0.0: Contradicts

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

    def bertscore_approximation(
        self,
        hypothesis: str,
        reference: str
    ) -> Dict[str, float]:
        """
        BERTScore approximation using LLM

        Real BERTScore uses BERT embeddings; this approximates semantically
        """
        prompt = f"""Evaluate the semantic overlap between these texts.
Consider meaning similarity at the phrase level.

Reference: {reference}

Generated: {hypothesis}

Rate precision (how much of generated is in reference), recall (how much of reference is in generated), and F1.
Format: P: X.XX, R: X.XX, F1: X.XX"""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=50,
            messages=[{"role": "user", "content": prompt}]
        )

        text = response.content[0].text
        try:
            # Parse response
            parts = text.split(",")
            precision = float(parts[0].split(":")[1].strip())
            recall = float(parts[1].split(":")[1].strip())
            f1 = float(parts[2].split(":")[1].strip())
            return {"precision": precision, "recall": recall, "f1": f1}
        except:
            return {"precision": 0.5, "recall": 0.5, "f1": 0.5}
```

## RAG-Specific Generation Metrics

```python
class RAGGenerationMetrics:
    """Metrics specific to RAG answer generation"""

    def __init__(self):
        self.client = anthropic.Anthropic()

    def groundedness(self, answer: str, context: str) -> float:
        """
        Groundedness: Is the answer grounded in the context?

        Key metric for RAG - penalizes hallucination
        """
        prompt = f"""Evaluate how grounded this answer is in the given context.
A grounded answer only contains information that can be found or inferred from the context.

Context:
{context}

Answer:
{answer}

Score:
- 1.0: Fully grounded, all information from context
- 0.5: Partially grounded, some unsupported claims
- 0.0: Not grounded, mostly fabricated

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

    def completeness(
        self,
        answer: str,
        question: str,
        context: str
    ) -> float:
        """
        Completeness: Does the answer cover all relevant information?
        """
        prompt = f"""Evaluate the completeness of this answer.
Consider what information is available in the context to answer the question.

Question: {question}

Context:
{context}

Answer:
{answer}

Score:
- 1.0: Completely answers the question using available info
- 0.5: Partially complete
- 0.0: Very incomplete

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

    def coherence(self, answer: str) -> float:
        """
        Coherence: Is the answer well-structured and logical?
        """
        prompt = f"""Evaluate the coherence of this answer.
Consider logical flow, structure, and clarity.

Answer:
{answer}

Score:
- 1.0: Very coherent and well-structured
- 0.5: Somewhat coherent
- 0.0: Incoherent

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
        questions: List[str],
        answers: List[str],
        contexts: List[str],
        references: Optional[List[str]] = None
    ) -> Dict[str, float]:
        """Run comprehensive generation evaluation"""

        lexical = LexicalMetrics()
        semantic = SemanticMetrics()

        metrics = {
            "groundedness": [],
            "completeness": [],
            "coherence": [],
            "rouge_l_f1": [],
            "bleu": []
        }

        for i, (q, a, c) in enumerate(zip(questions, answers, contexts)):
            metrics["groundedness"].append(self.groundedness(a, c))
            metrics["completeness"].append(self.completeness(a, q, c))
            metrics["coherence"].append(self.coherence(a))

            if references:
                metrics["rouge_l_f1"].append(lexical.rouge_l(a, references[i])["f1"])
                metrics["bleu"].append(lexical.bleu(a, references[i]))

        return {k: np.mean(v) for k, v in metrics.items() if v}
```

## Conclusion

Generation metrics for RAG must evaluate both output quality and faithfulness to source documents. Combine lexical metrics with LLM-based semantic evaluation for comprehensive assessment.

