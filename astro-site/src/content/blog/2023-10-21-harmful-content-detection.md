---
title: "Harmful Content Detection in AI Applications"
author: Michael John Peña
draft: false
date: 2023-10-21
description: "Techniques and systems for detecting harmful content in AI-generated and user-submitted text."
tags:
  - Harmful Content
  - Content Detection
  - AI Safety
  - Machine Learning
  - AI

---

I wrote "Harmful Content Detection in AI Applications" to share practical, production-minded guidance on this topic.

## Introduction

Detecting harmful content is crucial for responsible AI deployment. This post covers techniques for identifying various types of harmful content including hate speech, violence, misinformation, and self-harm content.

## Harmful Content Taxonomy

```python
from dataclasses import dataclass
from typing import List, Dict
from enum import Enum

class HarmCategory(Enum):
    HATE_SPEECH = "hate_speech"
    VIOLENCE = "violence"
    SEXUAL_CONTENT = "sexual_content"
    SELF_HARM = "self_harm"
    HARASSMENT = "harassment"
    MISINFORMATION = "misinformation"
    ILLEGAL_ACTIVITY = "illegal_activity"
    SPAM = "spam"

@dataclass
class HarmDefinition:
    category: HarmCategory
    description: str
    subcategories: List[str]
    severity_levels: Dict[str, str]

class HarmfulContentTaxonomy:
    """Taxonomy of harmful content types"""

    @staticmethod
    def get_definitions() -> List[HarmDefinition]:
        return [
            HarmDefinition(
                category=HarmCategory.HATE_SPEECH,
                description="Content that attacks or demeans groups based on protected characteristics",
                subcategories=[
                    "racial_hate",
                    "religious_hate",
                    "gender_hate",
                    "sexuality_hate",
                    "disability_hate"
                ],
                severity_levels={
                    "low": "Stereotypes or microaggressions",
                    "medium": "Derogatory language or slurs",
                    "high": "Calls for violence or dehumanization"
                }
            ),
            HarmDefinition(
                category=HarmCategory.VIOLENCE,
                description="Content depicting or encouraging violence",
                subcategories=[
                    "graphic_violence",
                    "threats",
                    "glorification",
                    "instructions"
                ],
                severity_levels={
                    "low": "Mild conflict descriptions",
                    "medium": "Detailed violence without glorification",
                    "high": "Graphic violence or incitement"
                }
            ),
            HarmDefinition(
                category=HarmCategory.SELF_HARM,
                description="Content related to self-harm or suicide",
                subcategories=[
                    "suicide_ideation",
                    "self_injury",
                    "eating_disorders",
                    "dangerous_challenges"
                ],
                severity_levels={
                    "low": "General discussion of mental health",
                    "medium": "Descriptions of self-harm",
                    "high": "Instructions or encouragement"
                }
            ),
            HarmDefinition(
                category=HarmCategory.MISINFORMATION,
                description="False or misleading information",
                subcategories=[
                    "health_misinfo",
                    "political_misinfo",
                    "scientific_misinfo",
                    "conspiracy_theories"
                ],
                severity_levels={
                    "low": "Minor inaccuracies",
                    "medium": "Misleading claims",
                    "high": "Dangerous false information"
                }
            )
        ]
```

## Multi-Signal Detection System

```python
import re
from typing import Tuple

class HarmfulContentDetector:
    """Multi-signal harmful content detection"""

    def __init__(self):
        self.keyword_detector = KeywordBasedDetector()
        self.pattern_detector = PatternBasedDetector()
        self.context_analyzer = ContextAnalyzer()

    def detect(self, text: str) -> Dict:
        """Detect harmful content using multiple signals"""
        results = {}

        # Keyword detection (fast)
        keyword_result = self.keyword_detector.detect(text)
        results["keyword_signals"] = keyword_result

        # Pattern detection
        pattern_result = self.pattern_detector.detect(text)
        results["pattern_signals"] = pattern_result

        # Context analysis
        context_result = self.context_analyzer.analyze(text)
        results["context_signals"] = context_result

        # Aggregate results
        aggregated = self._aggregate_signals(results)

        return {
            "is_harmful": aggregated["score"] > 0.5,
            "harm_score": aggregated["score"],
            "categories": aggregated["categories"],
            "confidence": aggregated["confidence"],
            "signals": results
        }

    def _aggregate_signals(self, signals: Dict) -> Dict:
        """Aggregate detection signals"""
        categories = set()
        scores = []
        confidences = []

        for signal_type, result in signals.items():
            if result.get("detected"):
                categories.update(result.get("categories", []))
                scores.append(result.get("score", 0))
                confidences.append(result.get("confidence", 0.5))

        if not scores:
            return {"score": 0, "categories": [], "confidence": 1.0}

        return {
            "score": max(scores),
            "categories": list(categories),
            "confidence": sum(confidences) / len(confidences)
        }

class KeywordBasedDetector:
    """Fast keyword-based detection"""

    def __init__(self):
        self.keyword_lists = {
            HarmCategory.HATE_SPEECH: self._load_hate_keywords(),
            HarmCategory.VIOLENCE: self._load_violence_keywords(),
            HarmCategory.SELF_HARM: self._load_self_harm_keywords()
        }

    def _load_hate_keywords(self) -> Dict[str, float]:
        """Load hate speech keywords with severity scores"""
        return {
            "hate": 0.3,
            "kill all": 0.9,
            "inferior": 0.5
        }

    def _load_violence_keywords(self) -> Dict[str, float]:
        """Load violence keywords"""
        return {
            "murder": 0.7,
            "attack": 0.4,
            "weapon": 0.5,
            "bomb": 0.8
        }

    def _load_self_harm_keywords(self) -> Dict[str, float]:
        """Load self-harm keywords"""
        return {
            "suicide": 0.6,
            "kill myself": 0.9,
            "self harm": 0.7
        }

    def detect(self, text: str) -> Dict:
        """Detect using keywords"""
        text_lower = text.lower()
        detected_categories = []
        max_score = 0

        for category, keywords in self.keyword_lists.items():
            for keyword, score in keywords.items():
                if keyword in text_lower:
                    detected_categories.append(category.value)
                    max_score = max(max_score, score)

        return {
            "detected": len(detected_categories) > 0,
            "categories": list(set(detected_categories)),
            "score": max_score,
            "confidence": 0.7 if detected_categories else 1.0
        }

class PatternBasedDetector:
    """Pattern-based harmful content detection"""

    def __init__(self):
        self.patterns = {
            HarmCategory.HATE_SPEECH: [
                (r"\b(hate|kill)\s+all\s+\w+", 0.9),
                (r"\b\w+\s+(should|must)\s+(die|be killed)", 0.95),
                (r"\b(inferior|subhuman)\s+(race|people)", 0.85)
            ],
            HarmCategory.VIOLENCE: [
                (r"\b(how to|instructions for)\s+(make|build)\s+(bomb|weapon)", 0.95),
                (r"\b(I will|going to)\s+(kill|hurt|attack)", 0.9),
                (r"\b(murder|assassinate)\s+\w+", 0.8)
            ],
            HarmCategory.SELF_HARM: [
                (r"\b(want to|going to)\s+(kill|hurt)\s+(myself|themselves)", 0.9),
                (r"\b(best way|how) to (commit suicide|end my life)", 0.95),
                (r"\b(cutting|burning)\s+myself", 0.85)
            ]
        }

    def detect(self, text: str) -> Dict:
        """Detect using regex patterns"""
        detected = []
        max_score = 0

        for category, patterns in self.patterns.items():
            for pattern, score in patterns:
                if re.search(pattern, text, re.IGNORECASE):
                    detected.append({
                        "category": category.value,
                        "pattern": pattern,
                        "score": score
                    })
                    max_score = max(max_score, score)

        return {
            "detected": len(detected) > 0,
            "categories": list(set(d["category"] for d in detected)),
            "matches": detected,
            "score": max_score,
            "confidence": 0.85 if detected else 1.0
        }

class ContextAnalyzer:
    """Analyze context to reduce false positives"""

    def __init__(self):
        self.educational_indicators = [
            "research", "study", "history", "documentary",
            "awareness", "prevention", "education", "learn"
        ]
        self.fiction_indicators = [
            "story", "novel", "character", "fiction",
            "movie", "game", "imaginary", "fantasy"
        ]
        self.negation_patterns = [
            r"don't\s+\w+\s+",
            r"should not",
            r"never\s+",
            r"against\s+"
        ]

    def analyze(self, text: str) -> Dict:
        """Analyze context for mitigation"""
        text_lower = text.lower()

        mitigation_factors = []
        mitigation_score = 0

        # Check for educational context
        educational_count = sum(
            1 for indicator in self.educational_indicators
            if indicator in text_lower
        )
        if educational_count > 0:
            mitigation_factors.append("educational_context")
            mitigation_score += 0.2 * educational_count

        # Check for fictional context
        fiction_count = sum(
            1 for indicator in self.fiction_indicators
            if indicator in text_lower
        )
        if fiction_count > 0:
            mitigation_factors.append("fictional_context")
            mitigation_score += 0.15 * fiction_count

        # Check for negation
        for pattern in self.negation_patterns:
            if re.search(pattern, text_lower):
                mitigation_factors.append("negation_present")
                mitigation_score += 0.1
                break

        return {
            "detected": False,  # Context doesn't detect, it mitigates
            "categories": [],
            "score": 0,
            "mitigation_factors": mitigation_factors,
            "mitigation_score": min(1.0, mitigation_score),
            "confidence": 0.6
        }
```

## Severity Scoring

```python
class SeverityScorer:
    """Score harmful content severity"""

    def __init__(self):
        self.category_base_scores = {
            HarmCategory.HATE_SPEECH: 0.7,
            HarmCategory.VIOLENCE: 0.8,
            HarmCategory.SEXUAL_CONTENT: 0.6,
            HarmCategory.SELF_HARM: 0.9,
            HarmCategory.HARASSMENT: 0.6,
            HarmCategory.MISINFORMATION: 0.5,
            HarmCategory.ILLEGAL_ACTIVITY: 0.8,
            HarmCategory.SPAM: 0.3
        }

    def score(self, detection_result: Dict) -> Dict:
        """Calculate severity score"""
        if not detection_result.get("is_harmful"):
            return {
                "severity": "none",
                "score": 0,
                "action": "allow"
            }

        categories = detection_result.get("categories", [])
        harm_score = detection_result.get("harm_score", 0)

        # Get base score from categories
        base_scores = [
            self.category_base_scores.get(
                HarmCategory(cat) if isinstance(cat, str) else cat,
                0.5
            )
            for cat in categories
        ]
        base_score = max(base_scores) if base_scores else 0.5

        # Combine with detection score
        final_score = (base_score + harm_score) / 2

        # Determine severity level
        if final_score >= 0.8:
            severity = "critical"
            action = "block"
        elif final_score >= 0.6:
            severity = "high"
            action = "block"
        elif final_score >= 0.4:
            severity = "medium"
            action = "review"
        elif final_score >= 0.2:
            severity = "low"
            action = "flag"
        else:
            severity = "minimal"
            action = "allow"

        return {
            "severity": severity,
            "score": final_score,
            "action": action,
            "categories": categories
        }

class HarmfulContentPipeline:
    """Complete harmful content detection pipeline"""

    def __init__(self):
        self.detector = HarmfulContentDetector()
        self.scorer = SeverityScorer()

    def analyze(self, text: str) -> Dict:
        """Analyze text for harmful content"""
        # Detect harmful content
        detection = self.detector.detect(text)

        # Score severity
        severity = self.scorer.score(detection)

        return {
            "text_length": len(text),
            "detection": detection,
            "severity": severity,
            "recommendation": self._get_recommendation(severity)
        }

    def _get_recommendation(self, severity: Dict) -> str:
        """Get action recommendation"""
        action = severity["action"]

        recommendations = {
            "block": "Content should be blocked and logged for review.",
            "review": "Content flagged for human review before display.",
            "flag": "Content allowed but flagged for monitoring.",
            "allow": "Content passes safety checks."
        }

        return recommendations.get(action, "Unknown action")

# Usage
pipeline = HarmfulContentPipeline()

test_texts = [
    "Hello, how can I help you today?",
    "What's the weather like?",
    "This is educational content about historical events."
]

for text in test_texts:
    result = pipeline.analyze(text)
    print(f"Text: {text[:50]}...")
    print(f"Harmful: {result['detection']['is_harmful']}")
    print(f"Severity: {result['severity']['severity']}")
    print(f"Action: {result['severity']['action']}")
    print()
```

## Real-Time Detection Service

```python
from datetime import datetime
from collections import deque

class RealTimeHarmDetector:
    """Real-time harmful content detection service"""

    def __init__(self, window_size: int = 1000):
        self.pipeline = HarmfulContentPipeline()
        self.recent_detections = deque(maxlen=window_size)
        self.alert_threshold = 0.1  # Alert if >10% harmful

    def detect(self, text: str, user_id: str = None) -> Dict:
        """Detect harmful content in real-time"""
        start_time = datetime.now()

        result = self.pipeline.analyze(text)

        processing_time = (datetime.now() - start_time).total_seconds()

        # Log detection
        self.recent_detections.append({
            "timestamp": start_time,
            "is_harmful": result["detection"]["is_harmful"],
            "severity": result["severity"]["severity"],
            "user_id": user_id
        })

        # Check for alert conditions
        alert = self._check_alerts()

        return {
            **result,
            "processing_time_ms": processing_time * 1000,
            "alert": alert
        }

    def _check_alerts(self) -> Dict:
        """Check if alert conditions are met"""
        if len(self.recent_detections) < 10:
            return {"triggered": False}

        harmful_count = sum(
            1 for d in self.recent_detections
            if d["is_harmful"]
        )
        harmful_rate = harmful_count / len(self.recent_detections)

        if harmful_rate > self.alert_threshold:
            return {
                "triggered": True,
                "type": "high_harmful_rate",
                "rate": harmful_rate,
                "threshold": self.alert_threshold
            }

        return {"triggered": False}

    def get_stats(self) -> Dict:
        """Get detection statistics"""
        if not self.recent_detections:
            return {"total": 0}

        total = len(self.recent_detections)
        harmful = sum(1 for d in self.recent_detections if d["is_harmful"])

        severity_counts = {}
        for d in self.recent_detections:
            sev = d["severity"]
            severity_counts[sev] = severity_counts.get(sev, 0) + 1

        return {
            "total": total,
            "harmful_count": harmful,
            "harmful_rate": harmful / total,
            "severity_breakdown": severity_counts
        }

# Usage
detector = RealTimeHarmDetector()

result = detector.detect("Test message", user_id="user123")
print(f"Processing time: {result['processing_time_ms']:.2f}ms")
print(f"Stats: {detector.get_stats()}")
```

## Conclusion

Harmful content detection requires a multi-layered approach combining keyword detection, pattern matching, contextual analysis, and severity scoring. Real-time detection services enable immediate response to harmful content while maintaining performance. Regular updates to detection patterns and continuous monitoring ensure effectiveness against evolving harmful content.

