---
title: "Groundedness Detection for LLM Responses"
author: Michael John Peña
draft: false
date: 2023-10-23
description: "Techniques for detecting and measuring groundedness in LLM responses to ensure factual accuracy."
tags:
  - Groundedness
  - Hallucination Detection
  - LLM Evaluation
  - Factual Accuracy
  - AI
---

## Introduction

Groundedness detection verifies that LLM responses are supported by provided source documents or context. This is critical for RAG applications and any system requiring factual accuracy. This post covers techniques for measuring and improving groundedness.

## Groundedness Concepts

```python
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple
from enum import Enum

class GroundednessLevel(Enum):
    FULLY_GROUNDED = "fully_grounded"
    PARTIALLY_GROUNDED = "partially_grounded"
    UNGROUNDED = "ungrounded"
    CONTRADICTORY = "contradictory"

@dataclass
class GroundednessResult:
    level: GroundednessLevel
    score: float  # 0-1, higher is more grounded
    supported_claims: List[str]
    unsupported_claims: List[str]
    contradicted_claims: List[str]
    evidence: List[Dict]

class GroundednessDefinitions:
    """Definitions and examples of groundedness levels"""

    @staticmethod
    def get_definitions() -> Dict:
        return {
            GroundednessLevel.FULLY_GROUNDED: {
                "description": "All claims in the response are directly supported by the source",
                "score_range": (0.9, 1.0),
                "example": "Source says 'Paris is the capital of France'. Response: 'The capital of France is Paris.'"
            },
            GroundednessLevel.PARTIALLY_GROUNDED: {
                "description": "Some claims are supported, others are not mentioned in source",
                "score_range": (0.5, 0.9),
                "example": "Source mentions population but response adds historical facts not in source"
            },
            GroundednessLevel.UNGROUNDED: {
                "description": "Claims are not supported by the source",
                "score_range": (0.1, 0.5),
                "example": "Response makes claims about topics not covered in source"
            },
            GroundednessLevel.CONTRADICTORY: {
                "description": "Claims directly contradict the source",
                "score_range": (0.0, 0.1),
                "example": "Source says '2020' but response says '2019'"
            }
        }
```

## Claim Extraction

```python
import re

class ClaimExtractor:
    """Extract verifiable claims from text"""

    def __init__(self):
        self.claim_patterns = [
            r"[A-Z][^.!?]*(?:is|are|was|were|has|have|had)[^.!?]+[.!?]",
            r"[A-Z][^.!?]*(?:stated|reported|found|showed|demonstrated)[^.!?]+[.!?]",
        ]

    def extract_claims(self, text: str) -> List[Dict]:
        """Extract claims from text"""
        sentences = self._split_sentences(text)
        claims = []

        for i, sentence in enumerate(sentences):
            claim_type = self._classify_claim(sentence)
            if claim_type:
                claims.append({
                    "id": f"claim_{i}",
                    "text": sentence.strip(),
                    "type": claim_type,
                    "position": i
                })

        return claims

    def _split_sentences(self, text: str) -> List[str]:
        """Split text into sentences"""
        # Simple sentence splitting
        sentences = re.split(r'(?<=[.!?])\s+', text)
        return [s for s in sentences if s.strip()]

    def _classify_claim(self, sentence: str) -> Optional[str]:
        """Classify the type of claim"""
        sentence_lower = sentence.lower()

        # Factual claims
        if any(word in sentence_lower for word in ["is", "are", "was", "were"]):
            return "factual"

        # Numerical claims
        if re.search(r'\d+', sentence):
            return "numerical"

        # Causal claims
        if any(word in sentence_lower for word in ["because", "caused", "resulted", "led to"]):
            return "causal"

        # Attribution claims
        if any(word in sentence_lower for word in ["said", "stated", "according to", "reported"]):
            return "attribution"

        return None

class EntityExtractor:
    """Extract entities for grounding verification"""

    def extract_entities(self, text: str) -> Dict:
        """Extract named entities and key terms"""
        entities = {
            "numbers": self._extract_numbers(text),
            "dates": self._extract_dates(text),
            "names": self._extract_names(text),
            "locations": self._extract_locations(text)
        }
        return entities

    def _extract_numbers(self, text: str) -> List[str]:
        """Extract numerical values"""
        patterns = [
            r'\$[\d,]+(?:\.\d{2})?',  # Currency
            r'\d+(?:\.\d+)?%',  # Percentages
            r'\d{1,3}(?:,\d{3})*(?:\.\d+)?',  # Numbers with commas
        ]
        numbers = []
        for pattern in patterns:
            numbers.extend(re.findall(pattern, text))
        return numbers

    def _extract_dates(self, text: str) -> List[str]:
        """Extract dates"""
        patterns = [
            r'\b\d{4}\b',  # Years
            r'\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}\b',
            r'\b\d{1,2}/\d{1,2}/\d{2,4}\b',
        ]
        dates = []
        for pattern in patterns:
            dates.extend(re.findall(pattern, text, re.IGNORECASE))
        return dates

    def _extract_names(self, text: str) -> List[str]:
        """Extract potential names"""
        # Simple pattern for capitalized words
        names = re.findall(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b', text)
        return names

    def _extract_locations(self, text: str) -> List[str]:
        """Extract location mentions"""
        # Would use NER in production
        location_indicators = ["in", "at", "from", "to"]
        locations = []
        for indicator in location_indicators:
            pattern = rf'{indicator}\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)'
            locations.extend(re.findall(pattern, text))
        return list(set(locations))
```

## Groundedness Checker

```python
class GroundednessChecker:
    """Check groundedness of response against source"""

    def __init__(self):
        self.claim_extractor = ClaimExtractor()
        self.entity_extractor = EntityExtractor()

    def check_groundedness(
        self,
        response: str,
        source: str
    ) -> GroundednessResult:
        """Check if response is grounded in source"""
        # Extract claims from response
        claims = self.claim_extractor.extract_claims(response)

        # Extract entities from both
        response_entities = self.entity_extractor.extract_entities(response)
        source_entities = self.entity_extractor.extract_entities(source)

        # Verify each claim
        supported = []
        unsupported = []
        contradicted = []
        evidence = []

        for claim in claims:
            verification = self._verify_claim(claim, source, source_entities)
            evidence.append(verification)

            if verification["status"] == "supported":
                supported.append(claim["text"])
            elif verification["status"] == "contradicted":
                contradicted.append(claim["text"])
            else:
                unsupported.append(claim["text"])

        # Check entity consistency
        entity_issues = self._check_entity_consistency(
            response_entities, source_entities
        )

        # Calculate score
        total_claims = len(claims)
        if total_claims == 0:
            score = 1.0
            level = GroundednessLevel.FULLY_GROUNDED
        else:
            supported_count = len(supported)
            contradicted_count = len(contradicted)

            if contradicted_count > 0:
                score = 0.1 * (1 - contradicted_count / total_claims)
                level = GroundednessLevel.CONTRADICTORY
            else:
                score = supported_count / total_claims
                if score >= 0.9:
                    level = GroundednessLevel.FULLY_GROUNDED
                elif score >= 0.5:
                    level = GroundednessLevel.PARTIALLY_GROUNDED
                else:
                    level = GroundednessLevel.UNGROUNDED

        return GroundednessResult(
            level=level,
            score=score,
            supported_claims=supported,
            unsupported_claims=unsupported,
            contradicted_claims=contradicted,
            evidence=evidence
        )

    def _verify_claim(
        self,
        claim: Dict,
        source: str,
        source_entities: Dict
    ) -> Dict:
        """Verify a single claim against source"""
        claim_text = claim["text"].lower()
        source_lower = source.lower()

        # Check for direct text overlap
        overlap_score = self._calculate_overlap(claim_text, source_lower)

        # Check entity consistency
        claim_entities = self.entity_extractor.extract_entities(claim["text"])
        entity_match = self._match_entities(claim_entities, source_entities)

        # Determine status
        if overlap_score > 0.7 and entity_match["consistent"]:
            status = "supported"
        elif entity_match["contradicted"]:
            status = "contradicted"
        elif overlap_score > 0.3:
            status = "partial"
        else:
            status = "unsupported"

        return {
            "claim_id": claim["id"],
            "claim_text": claim["text"],
            "status": status,
            "overlap_score": overlap_score,
            "entity_match": entity_match
        }

    def _calculate_overlap(self, text1: str, text2: str) -> float:
        """Calculate word overlap between texts"""
        words1 = set(text1.split())
        words2 = set(text2.split())

        # Remove common stop words
        stop_words = {"the", "a", "an", "is", "are", "was", "were", "in", "on", "at", "to", "for"}
        words1 = words1 - stop_words
        words2 = words2 - stop_words

        if not words1:
            return 0.0

        intersection = words1 & words2
        return len(intersection) / len(words1)

    def _match_entities(
        self,
        claim_entities: Dict,
        source_entities: Dict
    ) -> Dict:
        """Match entities between claim and source"""
        consistent = True
        contradicted = False
        matches = []

        # Check numbers
        for num in claim_entities.get("numbers", []):
            if num in source_entities.get("numbers", []):
                matches.append({"type": "number", "value": num, "found": True})
            else:
                consistent = False
                # Check if different number for same context
                matches.append({"type": "number", "value": num, "found": False})

        # Check dates
        for date in claim_entities.get("dates", []):
            if date in source_entities.get("dates", []):
                matches.append({"type": "date", "value": date, "found": True})
            else:
                consistent = False
                matches.append({"type": "date", "value": date, "found": False})

        return {
            "consistent": consistent,
            "contradicted": contradicted,
            "matches": matches
        }

    def _check_entity_consistency(
        self,
        response_entities: Dict,
        source_entities: Dict
    ) -> List[Dict]:
        """Check for entity inconsistencies"""
        issues = []

        # Check if response has entities not in source
        for entity_type, values in response_entities.items():
            source_values = set(source_entities.get(entity_type, []))
            for value in values:
                if value not in source_values:
                    issues.append({
                        "type": entity_type,
                        "value": value,
                        "issue": "not_in_source"
                    })

        return issues
```

## LLM-Based Groundedness Evaluation

```python
class LLMGroundednessEvaluator:
    """Use LLM to evaluate groundedness"""

    def __init__(self, llm_client):
        self.llm = llm_client

    def evaluate(self, response: str, source: str) -> Dict:
        """Use LLM to evaluate groundedness"""
        prompt = f"""Evaluate if the following response is grounded in the given source document.

SOURCE DOCUMENT:
{source}

RESPONSE TO EVALUATE:
{response}

For each claim in the response, determine if it is:
1. SUPPORTED - Directly stated or clearly implied by the source
2. UNSUPPORTED - Not mentioned in the source
3. CONTRADICTED - Conflicts with information in the source

Provide your evaluation in the following format:
- List each claim and its status
- Overall groundedness score (0-100)
- Explanation

EVALUATION:"""

        result = self.llm.generate(prompt)

        return {
            "evaluation": result,
            "raw_response": result
        }

    def evaluate_with_reasoning(
        self,
        response: str,
        source: str
    ) -> Dict:
        """Evaluate with chain-of-thought reasoning"""
        prompt = f"""You are evaluating whether a response is grounded in a source document.

SOURCE DOCUMENT:
{source}

RESPONSE:
{response}

Step 1: Identify all factual claims in the response.
Step 2: For each claim, find supporting evidence in the source (or note if absent).
Step 3: Check for any contradictions between the response and source.
Step 4: Calculate the overall groundedness score.

Think through this step-by-step:"""

        result = self.llm.generate(prompt)

        # Parse the result
        score = self._extract_score(result)

        return {
            "reasoning": result,
            "score": score,
            "grounded": score > 0.7
        }

    def _extract_score(self, text: str) -> float:
        """Extract score from LLM response"""
        import re
        # Look for percentage or score
        match = re.search(r'(\d+(?:\.\d+)?)\s*(?:%|/100|out of 100)', text)
        if match:
            return float(match.group(1)) / 100
        return 0.5
```

## Integrated Groundedness Pipeline

```python
class GroundednessPipeline:
    """Complete groundedness checking pipeline"""

    def __init__(self, use_llm: bool = False, llm_client=None):
        self.rule_checker = GroundednessChecker()
        self.use_llm = use_llm
        if use_llm and llm_client:
            self.llm_evaluator = LLMGroundednessEvaluator(llm_client)
        else:
            self.llm_evaluator = None

    def check(
        self,
        response: str,
        source: str,
        threshold: float = 0.7
    ) -> Dict:
        """Check groundedness with configurable approach"""
        # Rule-based check
        rule_result = self.rule_checker.check_groundedness(response, source)

        result = {
            "rule_based": {
                "level": rule_result.level.value,
                "score": rule_result.score,
                "supported_claims": rule_result.supported_claims,
                "unsupported_claims": rule_result.unsupported_claims,
                "contradicted_claims": rule_result.contradicted_claims
            }
        }

        # LLM-based check if enabled
        if self.use_llm and self.llm_evaluator:
            llm_result = self.llm_evaluator.evaluate_with_reasoning(
                response, source
            )
            result["llm_based"] = llm_result

            # Combine scores
            final_score = (rule_result.score + llm_result["score"]) / 2
        else:
            final_score = rule_result.score

        result["final_score"] = final_score
        result["is_grounded"] = final_score >= threshold
        result["recommendation"] = self._get_recommendation(
            final_score, rule_result
        )

        return result

    def _get_recommendation(
        self,
        score: float,
        rule_result: GroundednessResult
    ) -> str:
        """Get recommendation based on results"""
        if rule_result.contradicted_claims:
            return "Response contains contradictions with source. Do not use."
        elif score >= 0.9:
            return "Response is well-grounded. Safe to use."
        elif score >= 0.7:
            return "Response is mostly grounded with some unsupported claims."
        elif score >= 0.5:
            return "Response has significant unsupported content. Review needed."
        else:
            return "Response is poorly grounded. Consider regenerating."

# Usage
pipeline = GroundednessPipeline()

source = """
The Eiffel Tower is a wrought-iron lattice tower located in Paris, France.
It was constructed from 1887 to 1889 as the entrance arch for the 1889
World's Fair. The tower is 330 meters tall and was the tallest man-made
structure in the world until 1930.
"""

response = """
The Eiffel Tower is located in Paris, France. It was built between 1887
and 1889 for the World's Fair. The tower stands at 330 meters tall and
was once the world's tallest structure. It attracts millions of visitors
each year and is a UNESCO World Heritage Site.
"""

result = pipeline.check(response, source)
print(f"Grounded: {result['is_grounded']}")
print(f"Score: {result['final_score']:.2f}")
print(f"Recommendation: {result['recommendation']}")
```

## Conclusion

Groundedness detection is essential for ensuring LLM responses are factually accurate and supported by source documents. A comprehensive approach combines claim extraction, entity verification, overlap analysis, and optionally LLM-based evaluation. Regular groundedness checks help prevent hallucinations and maintain trust in AI-generated content.
