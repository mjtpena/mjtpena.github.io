---
title: "Implementing Guardrails for Production AI Systems"
description: "Filter and sanitize user inputs before they reach the LLM. Verify AI responses before returning them to users."
author: Michael John Peña
draft: false
date: 2025-08-20
tags:
  - AI Safety
  - Guardrails
  - Content Moderation
  - Production AI
  - Security
---

## Input Validation

Filter and sanitize user inputs before they reach the LLM.

```python
import re
from azure.ai.contentsafety import ContentSafetyClient
from azure.core.credentials import AzureKeyCredential

class InputGuardrails:
    def __init__(self, content_safety_client: ContentSafetyClient):
        self.content_safety = content_safety_client
        self.blocked_patterns = [
            r"ignore.*previous.*instructions",
            r"disregard.*system.*prompt",
            r"you are now",
            r"pretend you are"
        ]

    def validate_input(self, user_input: str) -> tuple[bool, str]:
        # Check for prompt injection patterns
        for pattern in self.blocked_patterns:
            if re.search(pattern, user_input, re.IGNORECASE):
                return False, "Input contains blocked patterns"

        # Check content safety
        analysis = self.content_safety.analyze_text({"text": user_input})

        for category in ["hate", "violence", "self_harm", "sexual"]:
            if getattr(analysis, f"{category}_result").severity > 2:
                return False, f"Content flagged for {category}"

        return True, "Input validated"
```

## Output Validation

Verify AI responses before returning them to users.

```python
class OutputGuardrails:
    def __init__(self, pii_patterns: list[str], banned_topics: list[str]):
        self.pii_patterns = [re.compile(p) for p in pii_patterns]
        self.banned_topics = banned_topics

    def validate_output(self, response: str, context: dict) -> tuple[bool, str]:
        # Check for PII leakage
        for pattern in self.pii_patterns:
            if pattern.search(response):
                return False, "Response contains potential PII"

        # Check for banned topics
        response_lower = response.lower()
        for topic in self.banned_topics:
            if topic.lower() in response_lower:
                return False, f"Response contains banned topic: {topic}"

        # Verify response stays within scope
        if not self._is_on_topic(response, context.get("allowed_topics", [])):
            return False, "Response appears off-topic"

        return True, "Output validated"

    def _is_on_topic(self, response: str, allowed_topics: list[str]) -> bool:
        # Implement topic classification logic
        return True  # Simplified
```

## Defense in Depth

Combine input validation, output filtering, rate limiting, and monitoring. No single guardrail is sufficient. Regularly test your guardrails with adversarial inputs and update them as new attack patterns emerge.
