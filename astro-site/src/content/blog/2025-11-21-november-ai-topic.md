---
title: "Implementing Guardrails for Production LLM Applications"
author: Michael John Peña
draft: false
date: 2025-11-21
tags:
  - Guardrails
  - LLM Safety
  - Azure AI
  - Content Safety
  - Production

---

I wrote "Implementing Guardrails for Production LLM Applications" to share practical, production-minded guidance on this topic.

## The Need for Guardrails

LLMs can generate harmful content, leak sensitive information, or be manipulated through prompt injection. A layered defense approach protects users and organizations.

## Azure AI Content Safety

Integrate Azure's content filtering with custom rules:

```python
from azure.ai.contentsafety import ContentSafetyClient
from azure.ai.contentsafety.models import TextCategory, AnalyzeTextOptions
from azure.identity import DefaultAzureCredential
from enum import Enum
from dataclasses import dataclass

class SafetyLevel(Enum):
    SAFE = "safe"
    WARNING = "warning"
    BLOCKED = "blocked"

@dataclass
class SafetyResult:
    level: SafetyLevel
    categories: dict
    blocked_reason: str = None

class ContentGuardrails:
    def __init__(self, endpoint: str):
        self.safety_client = ContentSafetyClient(
            endpoint=endpoint,
            credential=DefaultAzureCredential()
        )
        self.custom_blocklist = set()
        self.pii_patterns = []

    def analyze_input(self, text: str) -> SafetyResult:
        """Analyze user input for safety issues."""

        # Azure Content Safety check
        response = self.safety_client.analyze_text(
            AnalyzeTextOptions(text=text)
        )

        categories = {
            "hate": response.hate_result.severity if response.hate_result else 0,
            "self_harm": response.self_harm_result.severity if response.self_harm_result else 0,
            "sexual": response.sexual_result.severity if response.sexual_result else 0,
            "violence": response.violence_result.severity if response.violence_result else 0
        }

        # Check severity thresholds
        if any(severity >= 4 for severity in categories.values()):
            return SafetyResult(
                level=SafetyLevel.BLOCKED,
                categories=categories,
                blocked_reason="Content safety violation"
            )

        # Check for prompt injection patterns
        if self.detect_prompt_injection(text):
            return SafetyResult(
                level=SafetyLevel.BLOCKED,
                categories=categories,
                blocked_reason="Potential prompt injection detected"
            )

        # Check custom blocklist
        if self.contains_blocked_terms(text):
            return SafetyResult(
                level=SafetyLevel.WARNING,
                categories=categories,
                blocked_reason="Contains restricted terms"
            )

        return SafetyResult(level=SafetyLevel.SAFE, categories=categories)

    def detect_prompt_injection(self, text: str) -> bool:
        """Detect common prompt injection patterns."""
        injection_patterns = [
            r"ignore (?:all )?(?:previous|above|prior) instructions",
            r"disregard (?:all )?(?:previous|above|prior)",
            r"you are now",
            r"new instructions:",
            r"system prompt:",
            r"\\[INST\\]",
            r"<\\|im_start\\|>",
            r"### (?:Human|Assistant|System):"
        ]

        text_lower = text.lower()
        for pattern in injection_patterns:
            if re.search(pattern, text_lower, re.IGNORECASE):
                return True
        return False

    def validate_output(self, output: str, context: dict) -> SafetyResult:
        """Validate LLM output before returning to user."""

        # Check for PII leakage
        if self.contains_pii(output):
            return SafetyResult(
                level=SafetyLevel.WARNING,
                categories={},
                blocked_reason="Output may contain PII"
            )

        # Check for confidential data patterns
        if self.contains_sensitive_data(output, context.get("sensitivity_rules", [])):
            return SafetyResult(
                level=SafetyLevel.BLOCKED,
                categories={},
                blocked_reason="Output contains sensitive data"
            )

        # Run content safety on output
        return self.analyze_input(output)
```

## Implementing Output Constraints

Enforce response boundaries and format requirements:

```python
class OutputConstraints:
    def __init__(self, max_length: int = 2000):
        self.max_length = max_length
        self.required_disclaimers = []

    def enforce_constraints(self, output: str, topic: str) -> str:
        """Apply output constraints and add required elements."""

        # Truncate if too long
        if len(output) > self.max_length:
            output = output[:self.max_length] + "..."

        # Add topic-specific disclaimers
        disclaimers = self.get_disclaimers(topic)
        if disclaimers:
            output += f"\n\n{disclaimers}"

        return output

    def get_disclaimers(self, topic: str) -> str:
        """Get required disclaimers for specific topics."""
        topic_disclaimers = {
            "medical": "This is for informational purposes only and not medical advice.",
            "financial": "This is not financial advice. Consult a professional.",
            "legal": "This is not legal advice. Consult an attorney."
        }
        return topic_disclaimers.get(topic, "")
```

Guardrails are essential for production LLM applications. Combining Azure AI Content Safety with custom rules creates a robust defense against misuse while maintaining a positive user experience.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
