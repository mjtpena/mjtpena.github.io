---
title: "Answer Relevancy in RAG: Does the Response Address the Question?"
description: "An answer can be factually correct and grounded in context but still fail to address what was actually asked. Answer relevancy measures how well the…"
author: "Michael John Peña"
draft: false
date: 2024-03-23
tags: ["AI", "RAG", "Evaluation", "Relevancy", "LLM"]
---

An answer can be factually correct and grounded in context but still fail to address what was actually asked. Answer relevancy measures how well the generated response addresses the user's question.

## Understanding Answer Relevancy

```python
from dataclasses import dataclass
from typing import List, Optional
import anthropic

@dataclass
class RelevancyResult:
    score: float  # 0-1
    generated_questions: List[str]  # Questions the answer would address
    similarity_scores: List[float]  # Similarity to original question
    explanation: str

class AnswerRelevancyEvaluator:
    """
    Measures if the answer actually addresses the question asked.

    Uses reverse question generation:
    1. Generate questions that the answer would address
    2. Compare generated questions to original question
    3. High similarity = high relevancy
    """

    def __init__(self):
        self.client = anthropic.Anthropic()

    def generate_questions_from_answer(
        self,
        answer: str,
        num_questions: int = 3
    ) -> List[str]:
        """
        Generate questions that this answer would address
        """
        prompt = f"""Given this answer, generate {num_questions} different questions
that this answer would be responding to.
Each question should be natural and directly addressed by the answer.

Answer: {answer}

Generate {num_questions} questions, one per line:"""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )

        text = response.content[0].text
        questions = []
        for line in text.strip().split('\n'):
            line = line.strip().lstrip('0123456789.-) ')
            if line and '?' in line:
                questions.append(line)

        return questions[:num_questions]

    def calculate_question_similarity(
        self,
        original: str,
        generated: str
    ) -> float:
        """
        Calculate semantic similarity between questions
        """
        prompt = f"""Rate the semantic similarity between these two questions.
Consider if they're asking for the same information.

Question 1: {original}
Question 2: {generated}

Similarity scale:
- 1.0: Identical meaning, asking the same thing
- 0.75: Very similar, minor differences
- 0.5: Related topic, different focus
- 0.25: Loosely related
- 0.0: Completely different questions

Score (just the number):"""

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
        question: str,
        answer: str,
        num_samples: int = 3
    ) -> RelevancyResult:
        """
        Full relevancy evaluation using reverse question generation
        """
        # Generate questions from answer
        generated_questions = self.generate_questions_from_answer(
            answer,
            num_questions=num_samples
        )

        if not generated_questions:
            return RelevancyResult(
                score=0.0,
                generated_questions=[],
                similarity_scores=[],
                explanation="Could not generate questions from answer"
            )

        # Calculate similarities
        similarity_scores = []
        for gen_q in generated_questions:
            sim = self.calculate_question_similarity(question, gen_q)
            similarity_scores.append(sim)

        # Average score
        score = sum(similarity_scores) / len(similarity_scores)

        # Generate explanation
        if score >= 0.8:
            explanation = "Answer directly addresses the question"
        elif score >= 0.6:
            explanation = "Answer partially addresses the question"
        elif score >= 0.4:
            explanation = "Answer is somewhat related but misses key aspects"
        else:
            explanation = "Answer does not address the question"

        return RelevancyResult(
            score=score,
            generated_questions=generated_questions,
            similarity_scores=similarity_scores,
            explanation=explanation
        )
```

## Alternative Relevancy Approaches

```python
class MultiMethodRelevancyEvaluator:
    """Multiple approaches to measuring answer relevancy"""

    def __init__(self):
        self.client = anthropic.Anthropic()

    def direct_relevancy_scoring(
        self,
        question: str,
        answer: str
    ) -> float:
        """
        Direct LLM-based relevancy scoring
        """
        prompt = f"""Evaluate how well this answer addresses the question.

Question: {question}

Answer: {answer}

Scoring criteria:
- Does the answer directly address what was asked?
- Is the information provided relevant to the question?
- Are there major aspects of the question left unanswered?

Score from 0.0 (completely irrelevant) to 1.0 (perfectly relevant).
Provide only the numerical score:"""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=10,
            messages=[{"role": "user", "content": prompt}]
        )

        try:
            return float(response.content[0].text.strip())
        except:
            return 0.5

    def question_decomposition_relevancy(
        self,
        question: str,
        answer: str
    ) -> dict:
        """
        Decompose question into sub-questions and check coverage
        """
        # Decompose question
        decompose_prompt = f"""Break this question into its component parts or sub-questions.
What specific pieces of information is the questioner looking for?

Question: {question}

List each sub-question or information need:"""

        decompose_response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=300,
            messages=[{"role": "user", "content": decompose_prompt}]
        )

        sub_questions = [
            line.strip().lstrip('0123456789.-) ')
            for line in decompose_response.content[0].text.split('\n')
            if line.strip()
        ]

        # Check if each sub-question is addressed
        addressed = 0
        details = []

        for sq in sub_questions:
            check_prompt = f"""Does this answer address or provide information for this sub-question?

Sub-question: {sq}

Answer: {answer}

Reply YES or NO:"""

            check_response = self.client.messages.create(
                model="claude-3-sonnet-20240229",
                max_tokens=10,
                messages=[{"role": "user", "content": check_prompt}]
            )

            is_addressed = "YES" in check_response.content[0].text.upper()
            details.append({"sub_question": sq, "addressed": is_addressed})

            if is_addressed:
                addressed += 1

        score = addressed / len(sub_questions) if sub_questions else 0.0

        return {
            "score": score,
            "total_sub_questions": len(sub_questions),
            "addressed": addressed,
            "details": details
        }

    def intent_match_relevancy(
        self,
        question: str,
        answer: str
    ) -> float:
        """
        Check if answer matches the intent of the question
        """
        # Identify question intent
        intent_prompt = f"""What is the intent or purpose of this question?
What type of information is the questioner seeking?

Question: {question}

Intent (one sentence):"""

        intent_response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=100,
            messages=[{"role": "user", "content": intent_prompt}]
        )
        intent = intent_response.content[0].text.strip()

        # Check if answer fulfills intent
        match_prompt = f"""Does this answer fulfill the identified intent?

Intent: {intent}

Answer: {answer}

How well does the answer fulfill this intent?
Score from 0.0 (not at all) to 1.0 (perfectly).
Score:"""

        match_response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=10,
            messages=[{"role": "user", "content": match_prompt}]
        )

        try:
            return float(match_response.content[0].text.strip())
        except:
            return 0.5

    def comprehensive_relevancy(
        self,
        question: str,
        answer: str
    ) -> dict:
        """Combine all relevancy methods"""

        reverse_eval = AnswerRelevancyEvaluator()
        reverse_result = reverse_eval.evaluate(question, answer)

        direct_score = self.direct_relevancy_scoring(question, answer)
        decomp_result = self.question_decomposition_relevancy(question, answer)
        intent_score = self.intent_match_relevancy(question, answer)

        # Weighted combination
        combined_score = (
            0.3 * reverse_result.score +
            0.25 * direct_score +
            0.25 * decomp_result["score"] +
            0.2 * intent_score
        )

        return {
            "combined_score": combined_score,
            "reverse_generation_score": reverse_result.score,
            "direct_score": direct_score,
            "decomposition_score": decomp_result["score"],
            "intent_match_score": intent_score,
            "sub_questions_covered": f"{decomp_result['addressed']}/{decomp_result['total_sub_questions']}"
        }
```

## Practical Usage

```python
# Example evaluation
evaluator = MultiMethodRelevancyEvaluator()

question = "What are the main benefits of using Azure Kubernetes Service for container orchestration?"

answer = "Azure Kubernetes Service (AKS) simplifies deployment by automating infrastructure management. It integrates well with Azure services and provides built-in monitoring."

# This answer is somewhat relevant but doesn't fully address "main benefits"
# A complete answer would cover: scalability, cost, security, integration, etc.

result = evaluator.comprehensive_relevancy(question, answer)

print(f"Combined Relevancy Score: {result['combined_score']:.2f}")
print(f"Coverage: {result['sub_questions_covered']} sub-questions addressed")
```

## Conclusion

Answer relevancy ensures RAG systems actually address user questions. Combine multiple evaluation approaches for robust relevancy assessment, especially for complex questions with multiple information needs.
