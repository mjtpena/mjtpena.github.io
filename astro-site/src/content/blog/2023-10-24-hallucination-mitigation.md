---
title: "Hallucination Mitigation Strategies for LLM Applications"
author: Michael John Peña
draft: false
date: 2023-10-24
description: "Comprehensive strategies for detecting and mitigating hallucinations in LLM-generated content."
tags:
  - Hallucination
  - LLM
  - AI Safety
  - Mitigation
  - AI
---

## Introduction

Hallucination in LLMs refers to generating plausible but factually incorrect or unsupported information. This post covers strategies for detecting, preventing, and mitigating hallucinations in production systems.

## Types of Hallucinations

```python
from dataclasses import dataclass
from typing import List, Dict
from enum import Enum

class HallucinationType(Enum):
    FACTUAL = "factual"  # Incorrect facts
    FABRICATION = "fabrication"  # Made-up information
    INCONSISTENCY = "inconsistency"  # Self-contradictions
    EXTRINSIC = "extrinsic"  # Information beyond source
    INTRINSIC = "intrinsic"  # Misrepresentation of source

@dataclass
class HallucinationExample:
    type: HallucinationType
    description: str
    example_prompt: str
    hallucinated_response: str
    why_problematic: str

class HallucinationTaxonomy:
    """Taxonomy of LLM hallucinations"""

    @staticmethod
    def get_examples() -> List[HallucinationExample]:
        return [
            HallucinationExample(
                type=HallucinationType.FACTUAL,
                description="Stating incorrect facts as true",
                example_prompt="When was the Eiffel Tower built?",
                hallucinated_response="The Eiffel Tower was built in 1920.",
                why_problematic="Actual construction was 1887-1889"
            ),
            HallucinationExample(
                type=HallucinationType.FABRICATION,
                description="Inventing non-existent information",
                example_prompt="Cite a study on AI safety",
                hallucinated_response="According to Smith et al. (2023) in Nature...",
                why_problematic="Citation may not exist"
            ),
            HallucinationExample(
                type=HallucinationType.INCONSISTENCY,
                description="Contradicting previous statements",
                example_prompt="Tell me about the company",
                hallucinated_response="Founded in 2010... established in 2015...",
                why_problematic="Self-contradictory dates"
            ),
            HallucinationExample(
                type=HallucinationType.EXTRINSIC,
                description="Adding information not in provided context",
                example_prompt="Summarize this document (RAG)",
                hallucinated_response="The document mentions X, Y, and Z (Z not in doc)",
                why_problematic="Introduces external information"
            ),
            HallucinationExample(
                type=HallucinationType.INTRINSIC,
                description="Misrepresenting source information",
                example_prompt="What does the document say?",
                hallucinated_response="The report shows 50% increase (actually 15%)",
                why_problematic="Misquotes or distorts source"
            )
        ]
```

## Hallucination Detection

```python
import re
from typing import Tuple

class HallucinationDetector:
    """Detect potential hallucinations in LLM responses"""

    def __init__(self):
        self.confidence_indicators = [
            (r"definitely|certainly|absolutely", -0.1),  # Overconfidence
            (r"I think|I believe|probably|might", 0.05),  # Appropriate uncertainty
            (r"I'm not sure|uncertain", 0.1),  # Good uncertainty acknowledgment
        ]
        self.fabrication_indicators = [
            r"\(\w+(?:\s+et\s+al\.?)?,\s*\d{4}\)",  # Academic citations
            r"according to.*\d{4}",  # Attributed claims
            r"studies show|research indicates",  # Research claims
            r"\d+(?:\.\d+)?%",  # Specific percentages
        ]

    def detect(self, response: str, context: str = None) -> Dict:
        """Detect potential hallucinations"""
        indicators = []
        risk_score = 0.0

        # Check confidence level
        confidence_issues = self._check_confidence(response)
        indicators.extend(confidence_issues)
        risk_score += sum(i["risk_contribution"] for i in confidence_issues)

        # Check for fabrication patterns
        fabrication_issues = self._check_fabrication_patterns(response)
        indicators.extend(fabrication_issues)
        risk_score += sum(i["risk_contribution"] for i in fabrication_issues)

        # Check consistency if context provided
        if context:
            consistency_issues = self._check_context_consistency(response, context)
            indicators.extend(consistency_issues)
            risk_score += sum(i["risk_contribution"] for i in consistency_issues)

        # Check self-consistency
        self_consistency_issues = self._check_self_consistency(response)
        indicators.extend(self_consistency_issues)
        risk_score += sum(i["risk_contribution"] for i in self_consistency_issues)

        return {
            "risk_score": min(1.0, risk_score),
            "indicators": indicators,
            "likely_hallucination": risk_score > 0.5,
            "confidence": 1.0 - risk_score
        }

    def _check_confidence(self, text: str) -> List[Dict]:
        """Check for inappropriate confidence levels"""
        issues = []
        text_lower = text.lower()

        for pattern, risk_change in self.confidence_indicators:
            if re.search(pattern, text_lower):
                issues.append({
                    "type": "confidence",
                    "pattern": pattern,
                    "risk_contribution": abs(risk_change) if risk_change < 0 else 0,
                    "severity": "medium" if risk_change < 0 else "low"
                })

        return issues

    def _check_fabrication_patterns(self, text: str) -> List[Dict]:
        """Check for patterns indicating possible fabrication"""
        issues = []

        for pattern in self.fabrication_indicators:
            matches = re.findall(pattern, text, re.IGNORECASE)
            if matches:
                issues.append({
                    "type": "potential_fabrication",
                    "pattern": pattern,
                    "matches": matches,
                    "risk_contribution": 0.2,
                    "severity": "medium"
                })

        return issues

    def _check_context_consistency(self, response: str, context: str) -> List[Dict]:
        """Check if response is consistent with provided context"""
        issues = []

        # Extract key entities from context
        context_numbers = set(re.findall(r'\d+(?:\.\d+)?', context))
        response_numbers = set(re.findall(r'\d+(?:\.\d+)?', response))

        # Numbers in response not in context
        novel_numbers = response_numbers - context_numbers
        if novel_numbers:
            issues.append({
                "type": "extrinsic_numbers",
                "values": list(novel_numbers),
                "risk_contribution": 0.15 * len(novel_numbers),
                "severity": "high"
            })

        return issues

    def _check_self_consistency(self, text: str) -> List[Dict]:
        """Check for internal contradictions"""
        issues = []

        # Extract numbers with context
        number_contexts = re.findall(r'(\w+)\s+(?:is|was|are|were)\s+(\d+(?:\.\d+)?)', text)

        # Check for same entity with different numbers
        entity_numbers = {}
        for entity, number in number_contexts:
            entity_lower = entity.lower()
            if entity_lower in entity_numbers:
                if entity_numbers[entity_lower] != number:
                    issues.append({
                        "type": "self_contradiction",
                        "entity": entity,
                        "values": [entity_numbers[entity_lower], number],
                        "risk_contribution": 0.4,
                        "severity": "high"
                    })
            else:
                entity_numbers[entity_lower] = number

        return issues
```

## Mitigation Strategies

```python
class HallucinationMitigation:
    """Strategies to mitigate hallucinations"""

    def __init__(self, llm_client=None):
        self.llm = llm_client
        self.detector = HallucinationDetector()

    def apply_grounding_prompt(self, query: str, context: str) -> str:
        """Create a grounded prompt that reduces hallucination"""
        return f"""Answer the following question using ONLY the information provided in the context.
If the answer is not in the context, say "I don't have enough information to answer this."
Do not make up or infer information not explicitly stated in the context.

Context:
{context}

Question: {query}

Remember: Only use information from the context. If unsure, acknowledge uncertainty.

Answer:"""

    def apply_self_consistency_check(
        self,
        query: str,
        n_samples: int = 3,
        temperature: float = 0.7
    ) -> Dict:
        """Generate multiple responses and check consistency"""
        responses = []

        for _ in range(n_samples):
            response = self.llm.generate(query, temperature=temperature)
            responses.append(response)

        # Check consistency across responses
        consistency = self._measure_consistency(responses)

        if consistency["score"] < 0.7:
            return {
                "response": self._get_conservative_response(responses),
                "confidence": consistency["score"],
                "warning": "Low consistency across samples",
                "all_responses": responses
            }

        return {
            "response": responses[0],
            "confidence": consistency["score"],
            "all_responses": responses
        }

    def _measure_consistency(self, responses: List[str]) -> Dict:
        """Measure consistency across multiple responses"""
        if len(responses) < 2:
            return {"score": 1.0, "consistent": True}

        # Extract key claims from each response
        all_claims = []
        for response in responses:
            # Simple extraction: numbers and key facts
            numbers = set(re.findall(r'\d+(?:\.\d+)?', response))
            all_claims.append(numbers)

        # Calculate overlap
        if not all_claims[0]:
            return {"score": 1.0, "consistent": True}

        common = all_claims[0]
        for claims in all_claims[1:]:
            common = common & claims

        union = set()
        for claims in all_claims:
            union = union | claims

        if not union:
            return {"score": 1.0, "consistent": True}

        consistency_score = len(common) / len(union)

        return {
            "score": consistency_score,
            "consistent": consistency_score > 0.7,
            "common_elements": list(common),
            "total_elements": len(union)
        }

    def _get_conservative_response(self, responses: List[str]) -> str:
        """Get the most conservative response"""
        # Return shortest response (often most conservative)
        return min(responses, key=len)

    def apply_verification_chain(
        self,
        query: str,
        initial_response: str,
        context: str = None
    ) -> Dict:
        """Apply verification chain to response"""
        # Step 1: Detect potential issues
        detection = self.detector.detect(initial_response, context)

        if not detection["likely_hallucination"]:
            return {
                "verified_response": initial_response,
                "verified": True,
                "changes_made": False
            }

        # Step 2: Ask model to verify and correct
        verification_prompt = f"""Review this response for accuracy and potential hallucinations.

Original Question: {query}

Response to Verify:
{initial_response}

{f"Context (source of truth): {context}" if context else ""}

Instructions:
1. Identify any claims that seem incorrect or unsupported
2. Remove or correct any hallucinated information
3. Add uncertainty markers where appropriate
4. Return a revised, more accurate response

Verified Response:"""

        verified_response = self.llm.generate(verification_prompt)

        return {
            "original_response": initial_response,
            "verified_response": verified_response,
            "verified": True,
            "changes_made": verified_response != initial_response,
            "detection_results": detection
        }

class RetrievalAugmentedMitigation:
    """Mitigation through retrieval augmentation"""

    def __init__(self, retriever, llm_client):
        self.retriever = retriever
        self.llm = llm_client

    def generate_with_citations(self, query: str) -> Dict:
        """Generate response with inline citations"""
        # Retrieve relevant documents
        docs = self.retriever.retrieve(query)

        # Create prompt requiring citations
        context = "\n".join([f"[{i+1}] {doc}" for i, doc in enumerate(docs)])

        prompt = f"""Answer the question using the provided sources.
Include citations [1], [2], etc. for each claim you make.
Only make claims that are supported by the sources.

Sources:
{context}

Question: {query}

Answer (with citations):"""

        response = self.llm.generate(prompt)

        # Verify citations
        citation_check = self._verify_citations(response, docs)

        return {
            "response": response,
            "sources": docs,
            "citation_check": citation_check
        }

    def _verify_citations(self, response: str, sources: List[str]) -> Dict:
        """Verify that citations are valid"""
        citations = re.findall(r'\[(\d+)\]', response)
        valid_citations = []
        invalid_citations = []

        for citation in citations:
            idx = int(citation) - 1
            if 0 <= idx < len(sources):
                valid_citations.append(citation)
            else:
                invalid_citations.append(citation)

        return {
            "total_citations": len(citations),
            "valid": len(valid_citations),
            "invalid": len(invalid_citations),
            "invalid_list": invalid_citations,
            "all_valid": len(invalid_citations) == 0
        }
```

## Real-Time Hallucination Prevention

```python
class RealTimeHallucinationPrevention:
    """Real-time hallucination prevention during generation"""

    def __init__(self, llm_client):
        self.llm = llm_client
        self.detector = HallucinationDetector()
        self.mitigation = HallucinationMitigation(llm_client)

    def safe_generate(
        self,
        query: str,
        context: str = None,
        max_retries: int = 3
    ) -> Dict:
        """Generate with hallucination prevention"""
        # Create grounded prompt
        if context:
            prompt = self.mitigation.apply_grounding_prompt(query, context)
        else:
            prompt = query

        for attempt in range(max_retries):
            # Generate response
            response = self.llm.generate(prompt)

            # Detect hallucinations
            detection = self.detector.detect(response, context)

            if not detection["likely_hallucination"]:
                return {
                    "response": response,
                    "attempts": attempt + 1,
                    "confidence": detection["confidence"],
                    "hallucination_detected": False
                }

            # If hallucination detected, try verification
            if attempt < max_retries - 1:
                verified = self.mitigation.apply_verification_chain(
                    query, response, context
                )
                response = verified["verified_response"]

        # Final attempt - return with warning
        return {
            "response": response,
            "attempts": max_retries,
            "confidence": detection["confidence"],
            "hallucination_detected": True,
            "warning": "Response may contain hallucinations despite mitigation attempts"
        }

    def streaming_generate_with_check(
        self,
        query: str,
        context: str = None
    ):
        """Generate with periodic hallucination checks during streaming"""
        buffer = ""
        check_interval = 100  # characters

        for token in self.llm.stream(query):
            buffer += token
            yield token

            # Periodic check
            if len(buffer) >= check_interval:
                detection = self.detector.detect(buffer, context)
                if detection["likely_hallucination"]:
                    yield "\n[Warning: Potential hallucination detected]"
                buffer = buffer[-50:]  # Keep recent context

# Usage example
class MockLLM:
    def generate(self, prompt, temperature=0.7):
        return "Sample response"

    def stream(self, query):
        for word in "Sample streaming response".split():
            yield word + " "

prevention = RealTimeHallucinationPrevention(MockLLM())

result = prevention.safe_generate(
    query="What is the capital of France?",
    context="Paris is the capital and largest city of France."
)

print(f"Response: {result['response']}")
print(f"Attempts: {result['attempts']}")
print(f"Confidence: {result['confidence']:.2f}")
```

## Monitoring and Metrics

```python
from datetime import datetime
from collections import defaultdict

class HallucinationMetrics:
    """Track hallucination metrics over time"""

    def __init__(self):
        self.events = []
        self.detector = HallucinationDetector()

    def log_generation(
        self,
        query: str,
        response: str,
        context: str = None,
        user_feedback: str = None
    ):
        """Log a generation event"""
        detection = self.detector.detect(response, context)

        event = {
            "timestamp": datetime.now(),
            "query_length": len(query),
            "response_length": len(response),
            "risk_score": detection["risk_score"],
            "likely_hallucination": detection["likely_hallucination"],
            "indicators": len(detection["indicators"]),
            "user_feedback": user_feedback
        }
        self.events.append(event)

    def get_metrics(self, hours: int = 24) -> Dict:
        """Get hallucination metrics"""
        from datetime import timedelta
        cutoff = datetime.now() - timedelta(hours=hours)
        recent = [e for e in self.events if e["timestamp"] > cutoff]

        if not recent:
            return {"period_hours": hours, "total_events": 0}

        total = len(recent)
        hallucination_count = sum(1 for e in recent if e["likely_hallucination"])
        avg_risk = sum(e["risk_score"] for e in recent) / total

        return {
            "period_hours": hours,
            "total_events": total,
            "hallucination_count": hallucination_count,
            "hallucination_rate": hallucination_count / total,
            "average_risk_score": avg_risk,
            "high_risk_events": sum(1 for e in recent if e["risk_score"] > 0.7)
        }

# Usage
metrics = HallucinationMetrics()

# Log events during operation
metrics.log_generation(
    query="What is AI?",
    response="AI stands for Artificial Intelligence...",
    context="AI is a branch of computer science..."
)

stats = metrics.get_metrics(hours=24)
print(f"Hallucination rate: {stats.get('hallucination_rate', 0):.1%}")
```

## Conclusion

Hallucination mitigation requires a multi-faceted approach combining detection, prevention, and verification. Key strategies include grounded prompting, self-consistency checking, retrieval augmentation with citations, and real-time monitoring. Regular evaluation and metrics tracking help maintain quality and identify areas for improvement.
