---
title: "Guardrails for LLMs: Building Safe AI Applications"
description: "Comprehensive guardrails are essential for responsible AI deployment."
author: Michael John Peña
draft: false
date: 2025-03-20
tags:
  - AI
  - Guardrails
  - Safety
  - Security
  - Best Practices
---

## LLM Guardrails Implementation

```python
from azure.ai.openai import AzureOpenAI
from azure.ai.contentsafety import ContentSafetyClient
from typing import Optional
import re

class GuardrailPipeline:
    def __init__(self, openai_client: AzureOpenAI, safety_client: ContentSafetyClient):
        self.openai = openai_client
        self.safety = safety_client

    async def check_input(self, user_input: str) -> dict:
        """Validate user input before processing."""
        checks = {
            "content_safety": await self.check_content_safety(user_input),
            "prompt_injection": self.check_prompt_injection(user_input),
            "pii_detected": self.check_pii(user_input),
            "allowed_topic": await self.check_topic(user_input)
        }

        is_safe = all(c["passed"] for c in checks.values())
        return {"safe": is_safe, "checks": checks}

    async def check_content_safety(self, text: str) -> dict:
        """Check for harmful content."""
        result = await self.safety.analyze_text(text=text)
        return {
            "passed": all(cat.severity < 2 for cat in result.categories),
            "categories": {cat.category: cat.severity for cat in result.categories}
        }

    def check_prompt_injection(self, text: str) -> dict:
        """Detect potential prompt injection attempts."""
        injection_patterns = [
            r"ignore (?:previous|above|all) instructions",
            r"you are now",
            r"new instructions:",
            r"system prompt:",
            r"<\|.*\|>",  # Special tokens
        ]

        for pattern in injection_patterns:
            if re.search(pattern, text.lower()):
                return {"passed": False, "reason": f"Matched pattern: {pattern}"}

        return {"passed": True}

    def check_pii(self, text: str) -> dict:
        """Detect PII in text."""
        pii_patterns = {
            "ssn": r"\b\d{3}-\d{2}-\d{4}\b",
            "credit_card": r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b",
            "email": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"
        }

        detected = []
        for pii_type, pattern in pii_patterns.items():
            if re.search(pattern, text):
                detected.append(pii_type)

        return {"passed": len(detected) == 0, "detected": detected}

    async def check_output(self, response: str, context: str) -> dict:
        """Validate LLM output before returning to user."""
        checks = {
            "content_safety": await self.check_content_safety(response),
            "factuality": await self.check_factuality(response, context),
            "relevance": await self.check_relevance(response, context)
        }

        is_safe = all(c["passed"] for c in checks.values())
        return {"safe": is_safe, "checks": checks}

    async def check_factuality(self, response: str, context: str) -> dict:
        """Check if response is grounded in context."""
        result = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": "Check if the response is fully supported by the context. Return JSON."
            }, {
                "role": "user",
                "content": f"Context: {context}\n\nResponse: {response}"
            }],
            response_format={"type": "json_object"}
        )
        return json.loads(result.choices[0].message.content)
```

Comprehensive guardrails are essential for responsible AI deployment.
