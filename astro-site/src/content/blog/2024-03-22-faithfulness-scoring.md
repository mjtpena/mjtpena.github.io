---
title: "Faithfulness Scoring in RAG: Detecting Hallucinations"
description: "Faithfulness is perhaps the most critical metric for RAG systems. An unfaithful answer that hallucinates information not in the source documents can be…"
author: "Michael John Peña"
draft: false
date: 2024-03-22
tags: ["AI", "RAG", "Faithfulness", "Hallucination", "Evaluation"]
---

Faithfulness is perhaps the most critical metric for RAG systems. An unfaithful answer that hallucinates information not in the source documents can be worse than no answer at all.

## What is Faithfulness?

```python
from dataclasses import dataclass
from typing import List, Tuple
import anthropic

@dataclass
class FaithfulnessResult:
    score: float  # 0-1, where 1 is fully faithful
    claims: List[str]  # Extracted claims
    verified_claims: List[Tuple[str, bool, str]]  # (claim, is_supported, evidence)
    hallucinations: List[str]  # Unsupported claims

class FaithfulnessEvaluator:
    """
    Faithfulness measures whether the generated answer is
    grounded in the provided context.

    A faithful answer:
    - Only contains information from the context
    - Does not add unsupported facts
    - Does not contradict the context
    """

    def __init__(self):
        self.client = anthropic.Anthropic()

    def extract_claims(self, answer: str) -> List[str]:
        """
        Step 1: Extract atomic claims from the answer

        Each claim should be independently verifiable
        """
        prompt = f"""Extract all factual claims from this answer.
Each claim should be a single, atomic, verifiable statement.
Number each claim on a separate line.

Answer: {answer}

Claims:"""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}]
        )

        text = response.content[0].text
        claims = []
        for line in text.strip().split('\n'):
            line = line.strip()
            if line and (line[0].isdigit() or line.startswith('-')):
                # Remove numbering/bullets
                claim = line.lstrip('0123456789.-) ').strip()
                if claim:
                    claims.append(claim)

        return claims

    def verify_claim(
        self,
        claim: str,
        context: str
    ) -> Tuple[bool, str]:
        """
        Step 2: Verify each claim against the context

        Returns (is_supported, evidence_or_reason)
        """
        prompt = f"""Determine if this claim is supported by the context.

Context:
{context}

Claim: {claim}

Instructions:
1. If the claim is explicitly stated or can be directly inferred, respond: SUPPORTED: [quote from context]
2. If the claim contradicts the context, respond: CONTRADICTED: [explanation]
3. If the claim cannot be verified from context, respond: UNSUPPORTED: [explanation]

Response:"""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}]
        )

        text = response.content[0].text.strip()

        if text.startswith("SUPPORTED"):
            return True, text.replace("SUPPORTED:", "").strip()
        elif text.startswith("CONTRADICTED"):
            return False, text.replace("CONTRADICTED:", "").strip()
        else:  # UNSUPPORTED
            return False, text.replace("UNSUPPORTED:", "").strip()

    def evaluate(
        self,
        answer: str,
        context: str
    ) -> FaithfulnessResult:
        """
        Full faithfulness evaluation
        """
        # Extract claims
        claims = self.extract_claims(answer)

        if not claims:
            # No claims to verify - consider faithful
            return FaithfulnessResult(
                score=1.0,
                claims=[],
                verified_claims=[],
                hallucinations=[]
            )

        # Verify each claim
        verified_claims = []
        hallucinations = []
        supported_count = 0

        for claim in claims:
            is_supported, evidence = self.verify_claim(claim, context)
            verified_claims.append((claim, is_supported, evidence))

            if is_supported:
                supported_count += 1
            else:
                hallucinations.append(claim)

        # Calculate score
        score = supported_count / len(claims)

        return FaithfulnessResult(
            score=score,
            claims=claims,
            verified_claims=verified_claims,
            hallucinations=hallucinations
        )
```

## Advanced Faithfulness Detection

```python
class AdvancedFaithfulnessEvaluator:
    """Enhanced faithfulness evaluation with multiple strategies"""

    def __init__(self):
        self.client = anthropic.Anthropic()

    def nli_based_faithfulness(
        self,
        answer: str,
        context: str
    ) -> float:
        """
        Natural Language Inference approach

        Treats context as premise, answer sentences as hypotheses
        """
        # Split answer into sentences
        sentences = [s.strip() for s in answer.replace('!', '.').replace('?', '.').split('.')
                    if s.strip()]

        if not sentences:
            return 1.0

        entailment_scores = []

        for sentence in sentences:
            prompt = f"""Given the premise, classify the hypothesis as:
- ENTAILMENT (follows from premise)
- NEUTRAL (neither follows nor contradicts)
- CONTRADICTION (contradicts premise)

Premise: {context}

Hypothesis: {sentence}

Classification:"""

            response = self.client.messages.create(
                model="claude-3-sonnet-20240229",
                max_tokens=20,
                messages=[{"role": "user", "content": prompt}]
            )

            result = response.content[0].text.strip().upper()

            if "ENTAILMENT" in result:
                entailment_scores.append(1.0)
            elif "NEUTRAL" in result:
                entailment_scores.append(0.5)
            else:  # CONTRADICTION
                entailment_scores.append(0.0)

        return sum(entailment_scores) / len(entailment_scores)

    def qa_based_faithfulness(
        self,
        answer: str,
        context: str
    ) -> float:
        """
        Question-Answer based approach

        Generate questions from answer, verify answers in context
        """
        # Generate questions from the answer
        gen_prompt = f"""Generate verification questions for this answer.
Each question should be answerable from the answer and verifiable against source material.

Answer: {answer}

Generate 3-5 questions:"""

        gen_response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=300,
            messages=[{"role": "user", "content": gen_prompt}]
        )

        questions = [q.strip() for q in gen_response.content[0].text.split('\n')
                    if q.strip() and '?' in q]

        if not questions:
            return 1.0

        consistency_scores = []

        for question in questions:
            # Answer from the generated answer
            ans_prompt = f"""Based on this text, answer the question briefly.

Text: {answer}

Question: {question}

Answer:"""

            ans_response = self.client.messages.create(
                model="claude-3-sonnet-20240229",
                max_tokens=100,
                messages=[{"role": "user", "content": ans_prompt}]
            )
            answer_based = ans_response.content[0].text.strip()

            # Answer from the context
            ctx_prompt = f"""Based on this context, answer the question briefly.
If the context doesn't contain the answer, say "NOT FOUND".

Context: {context}

Question: {question}

Answer:"""

            ctx_response = self.client.messages.create(
                model="claude-3-sonnet-20240229",
                max_tokens=100,
                messages=[{"role": "user", "content": ctx_prompt}]
            )
            context_based = ctx_response.content[0].text.strip()

            # Compare answers
            if "NOT FOUND" in context_based.upper():
                consistency_scores.append(0.0)  # Hallucination
            else:
                # Check consistency
                compare_prompt = f"""Are these two answers consistent (same meaning)?

Answer 1: {answer_based}
Answer 2: {context_based}

Reply YES or NO:"""

                compare_response = self.client.messages.create(
                    model="claude-3-sonnet-20240229",
                    max_tokens=10,
                    messages=[{"role": "user", "content": compare_prompt}]
                )

                if "YES" in compare_response.content[0].text.upper():
                    consistency_scores.append(1.0)
                else:
                    consistency_scores.append(0.0)

        return sum(consistency_scores) / len(consistency_scores)

    def comprehensive_evaluation(
        self,
        answer: str,
        context: str
    ) -> dict:
        """Combine multiple faithfulness approaches"""

        basic = FaithfulnessEvaluator()
        basic_result = basic.evaluate(answer, context)

        nli_score = self.nli_based_faithfulness(answer, context)
        qa_score = self.qa_based_faithfulness(answer, context)

        # Weighted average
        combined_score = (
            0.4 * basic_result.score +
            0.3 * nli_score +
            0.3 * qa_score
        )

        return {
            "combined_score": combined_score,
            "claim_based_score": basic_result.score,
            "nli_score": nli_score,
            "qa_consistency_score": qa_score,
            "hallucinations": basic_result.hallucinations
        }
```

## Using Faithfulness in Production

```python
class RAGWithFaithfulnessCheck:
    """RAG system with built-in faithfulness validation"""

    def __init__(self, faithfulness_threshold: float = 0.8):
        self.client = anthropic.Anthropic()
        self.evaluator = FaithfulnessEvaluator()
        self.threshold = faithfulness_threshold

    def generate_with_validation(
        self,
        question: str,
        context: str,
        max_retries: int = 2
    ) -> dict:
        """Generate answer with faithfulness validation"""

        for attempt in range(max_retries + 1):
            # Generate answer
            answer = self._generate_answer(question, context)

            # Check faithfulness
            result = self.evaluator.evaluate(answer, context)

            if result.score >= self.threshold:
                return {
                    "answer": answer,
                    "faithfulness_score": result.score,
                    "validated": True,
                    "attempts": attempt + 1
                }

            # If unfaithful, try again with stricter prompt
            if result.hallucinations:
                context += f"\n\nIMPORTANT: Only use information from this context. Do not mention: {', '.join(result.hallucinations)}"

        # Return best effort with warning
        return {
            "answer": answer,
            "faithfulness_score": result.score,
            "validated": False,
            "warning": "Could not achieve faithfulness threshold",
            "hallucinations": result.hallucinations
        }

    def _generate_answer(self, question: str, context: str) -> str:
        prompt = f"""Answer the question based ONLY on the provided context.
Do not add any information not present in the context.
If the context doesn't contain the answer, say so.

Context:
{context}

Question: {question}

Answer:"""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content[0].text.strip()
```

## Conclusion

Faithfulness scoring is essential for trustworthy RAG systems. Implement multiple verification strategies and set appropriate thresholds to minimize hallucinations in production.
