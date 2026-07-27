---
title: "AI Safety Guardrails: Implementing Content Filtering in Azure OpenAI"
author: Michael John Peña
draft: false
date: 2025-10-04
tags:
  - AI Safety
  - Azure OpenAI
  - Content Filtering
  - Responsible AI
  - Security

---

I wrote "AI Safety Guardrails: Implementing Content Filtering in Azure OpenAI" to share practical, production-minded guidance on this topic.

## Understanding Azure OpenAI Content Filtering

Azure OpenAI's content filtering system operates on four categories: hate, sexual, violence, and self-harm. Each category can be configured with different severity thresholds:

```python
from openai import AzureOpenAI
from azure.ai.contentsafety import ContentSafetyClient
from azure.ai.contentsafety.models import TextCategory, AnalyzeTextOptions
from azure.core.credentials import AzureKeyCredential

class ContentSafetyGuard:
    def __init__(self, openai_client: AzureOpenAI, safety_endpoint: str, safety_key: str):
        self.openai_client = openai_client
        self.safety_client = ContentSafetyClient(
            endpoint=safety_endpoint,
            credential=AzureKeyCredential(safety_key)
        )
        self.severity_thresholds = {
            TextCategory.HATE: 2,
            TextCategory.SEXUAL: 2,
            TextCategory.VIOLENCE: 4,
            TextCategory.SELF_HARM: 2
        }

    def analyze_content(self, text: str) -> dict:
        """Analyze text for safety concerns."""

        request = AnalyzeTextOptions(text=text)
        response = self.safety_client.analyze_text(request)

        violations = []
        for category_result in response.categories_analysis:
            if category_result.severity >= self.severity_thresholds.get(
                category_result.category, 2
            ):
                violations.append({
                    "category": category_result.category.value,
                    "severity": category_result.severity
                })

        return {
            "is_safe": len(violations) == 0,
            "violations": violations,
            "analysis": response
        }
```

## Implementing Custom Business Rules

Add domain-specific safety rules beyond default content filtering:

```python
import re
from typing import List, Callable

class BusinessRuleGuard:
    def __init__(self):
        self.rules: List[Callable[[str], tuple[bool, str]]] = []

    def add_pii_detection(self):
        """Block potential PII in prompts."""
        patterns = {
            "ssn": r"\b\d{3}-\d{2}-\d{4}\b",
            "credit_card": r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b",
            "email": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"
        }

        def check_pii(text: str) -> tuple[bool, str]:
            for pii_type, pattern in patterns.items():
                if re.search(pattern, text):
                    return False, f"Potential {pii_type} detected"
            return True, ""

        self.rules.append(check_pii)

    def add_prompt_injection_detection(self):
        """Detect common prompt injection patterns."""
        injection_patterns = [
            r"ignore\s+(previous|above|all)\s+instructions",
            r"disregard\s+(your|the)\s+(rules|guidelines)",
            r"you\s+are\s+now\s+(a|an)\s+"
        ]

        def check_injection(text: str) -> tuple[bool, str]:
            text_lower = text.lower()
            for pattern in injection_patterns:
                if re.search(pattern, text_lower):
                    return False, "Potential prompt injection detected"
            return True, ""

        self.rules.append(check_injection)
```

## Logging and Audit Trail

Maintain comprehensive logs of all content filtering decisions for compliance and incident investigation. Every blocked request should be logged with context while respecting privacy requirements.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
