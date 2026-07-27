---
title: "AI Safety Fundamentals for LLM Applications"
author: Michael John Peña
draft: false
date: 2023-10-14
description: "Essential AI safety concepts and practices for building responsible LLM applications."
tags:
  - AI Safety
  - LLM
  - Responsible AI
  - Security
  - AI

---

I wrote "AI Safety Fundamentals for LLM Applications" to share practical, production-minded guidance on this topic.

## Introduction

AI safety is critical for deploying LLM applications responsibly. This post covers fundamental safety concepts, common risks, and practical mitigation strategies for production systems.

## AI Safety Taxonomy

```python
from dataclasses import dataclass
from typing import List, Dict
from enum import Enum

class RiskCategory(Enum):
    HARMFUL_CONTENT = "harmful_content"
    MISINFORMATION = "misinformation"
    PRIVACY = "privacy"
    SECURITY = "security"
    BIAS = "bias"
    MISUSE = "misuse"

@dataclass
class SafetyRisk:
    category: RiskCategory
    name: str
    description: str
    examples: List[str]
    mitigations: List[str]

class AISafetyTaxonomy:
    """Taxonomy of AI safety risks"""

    @staticmethod
    def get_risks() -> List[SafetyRisk]:
        return [
            SafetyRisk(
                category=RiskCategory.HARMFUL_CONTENT,
                name="Toxic Content Generation",
                description="Model generates offensive, violent, or hateful content",
                examples=[
                    "Hate speech targeting groups",
                    "Violent content or threats",
                    "Sexually explicit material"
                ],
                mitigations=[
                    "Content filtering on outputs",
                    "RLHF training for refusals",
                    "Real-time moderation systems"
                ]
            ),
            SafetyRisk(
                category=RiskCategory.MISINFORMATION,
                name="Hallucination and False Information",
                description="Model generates plausible but incorrect information",
                examples=[
                    "Made-up citations and sources",
                    "Incorrect factual claims",
                    "Fabricated statistics"
                ],
                mitigations=[
                    "RAG for grounding responses",
                    "Fact-checking pipelines",
                    "Confidence calibration",
                    "Source attribution requirements"
                ]
            ),
            SafetyRisk(
                category=RiskCategory.PRIVACY,
                name="Privacy Leakage",
                description="Model reveals or generates personal information",
                examples=[
                    "Revealing training data PII",
                    "Generating realistic fake PII",
                    "Exposing user information in context"
                ],
                mitigations=[
                    "PII detection and redaction",
                    "Differential privacy in training",
                    "Input/output filtering"
                ]
            ),
            SafetyRisk(
                category=RiskCategory.SECURITY,
                name="Prompt Injection",
                description="Malicious inputs manipulate model behavior",
                examples=[
                    "Jailbreak attempts",
                    "Indirect prompt injection via data",
                    "System prompt extraction"
                ],
                mitigations=[
                    "Input validation and sanitization",
                    "Prompt hardening",
                    "Output monitoring"
                ]
            ),
            SafetyRisk(
                category=RiskCategory.BIAS,
                name="Unfair Bias",
                description="Model exhibits discriminatory behavior",
                examples=[
                    "Stereotyping based on demographics",
                    "Unequal performance across groups",
                    "Reinforcing societal biases"
                ],
                mitigations=[
                    "Bias testing and auditing",
                    "Diverse training data",
                    "Fairness constraints in training"
                ]
            ),
            SafetyRisk(
                category=RiskCategory.MISUSE,
                name="Dual-Use and Misuse",
                description="Model used for harmful purposes",
                examples=[
                    "Generating malware code",
                    "Creating disinformation",
                    "Automating harassment"
                ],
                mitigations=[
                    "Use case restrictions",
                    "Rate limiting",
                    "User authentication and monitoring"
                ]
            )
        ]
```

## Safety Layers Architecture

```python
class SafetyLayersArchitecture:
    """Multi-layered safety architecture"""

    @staticmethod
    def describe_layers() -> Dict:
        return {
            "layer_1_input": {
                "name": "Input Safety Layer",
                "purpose": "Filter and validate user inputs",
                "components": [
                    "PII detection and masking",
                    "Prompt injection detection",
                    "Malicious content filtering",
                    "Rate limiting and abuse detection"
                ]
            },
            "layer_2_model": {
                "name": "Model Safety Layer",
                "purpose": "Ensure model behaves safely",
                "components": [
                    "System prompt with safety instructions",
                    "RLHF-trained refusal behaviors",
                    "Constitutional AI principles",
                    "Token-level content filtering"
                ]
            },
            "layer_3_output": {
                "name": "Output Safety Layer",
                "purpose": "Validate and filter model outputs",
                "components": [
                    "Content classification",
                    "Harmful content detection",
                    "Hallucination detection",
                    "PII scanning"
                ]
            },
            "layer_4_monitoring": {
                "name": "Monitoring Layer",
                "purpose": "Detect and respond to issues",
                "components": [
                    "Real-time safety metrics",
                    "Anomaly detection",
                    "Incident alerting",
                    "Audit logging"
                ]
            }
        }

class InputSafetyLayer:
    """Input validation and safety"""

    def __init__(self):
        self.blocked_patterns = [
            r"ignore (all )?(previous|above) instructions",
            r"you are now",
            r"pretend (to be|you are)",
            r"bypass",
            r"jailbreak"
        ]

    def validate_input(self, user_input: str) -> Dict:
        """Validate user input for safety issues"""
        import re

        issues = []

        # Check for prompt injection patterns
        for pattern in self.blocked_patterns:
            if re.search(pattern, user_input.lower()):
                issues.append({
                    "type": "prompt_injection",
                    "pattern": pattern,
                    "severity": "high"
                })

        # Check input length
        if len(user_input) > 10000:
            issues.append({
                "type": "excessive_length",
                "length": len(user_input),
                "severity": "medium"
            })

        return {
            "safe": len(issues) == 0,
            "issues": issues,
            "input_length": len(user_input)
        }

    def sanitize_input(self, user_input: str) -> str:
        """Sanitize input to reduce risks"""
        import re

        sanitized = user_input

        # Remove potential injection patterns
        for pattern in self.blocked_patterns:
            sanitized = re.sub(pattern, "[FILTERED]", sanitized, flags=re.IGNORECASE)

        return sanitized

class OutputSafetyLayer:
    """Output validation and safety"""

    def __init__(self, content_classifier=None):
        self.content_classifier = content_classifier
        self.harmful_categories = [
            "violence", "hate_speech", "sexual_content",
            "self_harm", "illegal_activity"
        ]

    def classify_content(self, output: str) -> Dict:
        """Classify output for harmful content"""
        # In practice, use a trained classifier or API
        classifications = {}

        # Simple keyword-based check (replace with real classifier)
        for category in self.harmful_categories:
            # Placeholder - use actual classifier
            classifications[category] = 0.0

        return classifications

    def check_output_safety(self, output: str) -> Dict:
        """Check output for safety issues"""
        classifications = self.classify_content(output)

        issues = []
        for category, score in classifications.items():
            if score > 0.5:
                issues.append({
                    "category": category,
                    "score": score,
                    "severity": "high" if score > 0.8 else "medium"
                })

        return {
            "safe": len(issues) == 0,
            "issues": issues,
            "classifications": classifications
        }
```

## Safety System Prompts

```python
class SafetyPromptTemplates:
    """Templates for safety-focused system prompts"""

    @staticmethod
    def get_base_safety_prompt() -> str:
        return """You are a helpful, harmless, and honest AI assistant.

SAFETY GUIDELINES:
1. Never provide instructions for harmful, illegal, or dangerous activities
2. Do not generate hateful, violent, or sexually explicit content
3. Protect user privacy - never reveal or generate personal information
4. Acknowledge uncertainty - say "I don't know" when appropriate
5. Refuse requests that could cause harm, explaining why
6. Do not pretend to be human or claim capabilities you don't have

When you cannot help with a request, politely explain why and suggest alternatives if possible.
"""

    @staticmethod
    def get_refusal_prompt() -> str:
        return """When you receive a request you cannot fulfill safely, respond with:
1. A clear but polite refusal
2. A brief explanation of why you cannot help
3. An alternative suggestion if appropriate

Example: "I'm not able to provide instructions for [harmful activity] as this could cause harm. Instead, I'd be happy to help you with [alternative]."
"""

    @staticmethod
    def get_grounding_prompt(context_source: str) -> str:
        return f"""Base your responses on the provided context from {context_source}.

GROUNDING RULES:
1. Only make claims supported by the provided context
2. If information is not in the context, say so
3. Clearly distinguish between context-based facts and general knowledge
4. If asked about topics not in the context, acknowledge the limitation
"""

    @staticmethod
    def build_safe_system_prompt(
        role: str,
        additional_rules: List[str] = None
    ) -> str:
        """Build a comprehensive safe system prompt"""
        prompt = f"""You are {role}.

{SafetyPromptTemplates.get_base_safety_prompt()}

{SafetyPromptTemplates.get_refusal_prompt()}
"""

        if additional_rules:
            prompt += "\nADDITIONAL RULES:\n"
            for rule in additional_rules:
                prompt += f"- {rule}\n"

        return prompt
```

## Safety Monitoring

```python
from datetime import datetime
from collections import defaultdict

class SafetyMonitor:
    """Monitor safety metrics in production"""

    def __init__(self):
        self.safety_events = []
        self.metrics = defaultdict(int)

    def log_safety_event(
        self,
        event_type: str,
        severity: str,
        details: Dict
    ):
        """Log a safety-related event"""
        event = {
            "timestamp": datetime.now().isoformat(),
            "type": event_type,
            "severity": severity,
            "details": details
        }
        self.safety_events.append(event)
        self.metrics[event_type] += 1

        # Alert on high severity
        if severity == "high":
            self._trigger_alert(event)

    def _trigger_alert(self, event: Dict):
        """Trigger alert for high severity events"""
        print(f"ALERT: {event['type']} - {event['details']}")

    def get_safety_report(self, hours: int = 24) -> Dict:
        """Generate safety report"""
        cutoff = datetime.now().timestamp() - (hours * 3600)

        recent_events = [
            e for e in self.safety_events
            if datetime.fromisoformat(e["timestamp"]).timestamp() > cutoff
        ]

        by_type = defaultdict(list)
        by_severity = defaultdict(int)

        for event in recent_events:
            by_type[event["type"]].append(event)
            by_severity[event["severity"]] += 1

        return {
            "period_hours": hours,
            "total_events": len(recent_events),
            "by_severity": dict(by_severity),
            "by_type": {k: len(v) for k, v in by_type.items()},
            "high_severity_events": [
                e for e in recent_events if e["severity"] == "high"
            ]
        }

# Usage
monitor = SafetyMonitor()

# Log events during operation
monitor.log_safety_event(
    "prompt_injection_detected",
    "high",
    {"user_id": "123", "pattern": "ignore previous instructions"}
)

monitor.log_safety_event(
    "harmful_content_blocked",
    "medium",
    {"category": "violence", "score": 0.75}
)

# Generate report
report = monitor.get_safety_report(hours=24)
print(f"Safety events in last 24h: {report['total_events']}")
print(f"High severity: {report['by_severity'].get('high', 0)}")
```

## Conclusion

AI safety requires a multi-layered approach combining input validation, model-level safeguards, output filtering, and continuous monitoring. By implementing comprehensive safety measures and maintaining vigilance through monitoring, organizations can deploy LLM applications responsibly while minimizing risks.

