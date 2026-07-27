---
title: "Implementing Guardrails for Production LLM Applications"
author: Michael John Peña
draft: false
date: 2025-07-16
tags:
  - AI Safety
  - Guardrails
  - Production AI
  - Azure AI Content Safety
  - Python

---

I wrote "Implementing Guardrails for Production LLM Applications" to share practical, production-minded guidance on this topic.

## Multi-Layer Safety Architecture

Implement guardrails at input, processing, and output stages:

```python
from azure.ai.contentsafety import ContentSafetyClient
from azure.ai.contentsafety.models import AnalyzeTextOptions, TextCategory
from dataclasses import dataclass

@dataclass
class SafetyResult:
    is_safe: bool
    blocked_categories: list[str]
    risk_scores: dict[str, float]

class GuardrailService:
    def __init__(self, content_safety_client: ContentSafetyClient):
        self.safety_client = content_safety_client
        self.severity_threshold = 2  # Block medium and above

    async def check_input(self, user_input: str) -> SafetyResult:
        """Check user input before processing."""
        response = await self.safety_client.analyze_text(
            AnalyzeTextOptions(
                text=user_input,
                categories=[
                    TextCategory.HATE,
                    TextCategory.VIOLENCE,
                    TextCategory.SELF_HARM,
                    TextCategory.SEXUAL
                ]
            )
        )

        blocked = []
        scores = {}
        for result in response.categories_analysis:
            scores[result.category] = result.severity
            if result.severity >= self.severity_threshold:
                blocked.append(result.category)

        return SafetyResult(
            is_safe=len(blocked) == 0,
            blocked_categories=blocked,
            risk_scores=scores
        )

    async def check_output(self, llm_response: str) -> SafetyResult:
        """Validate LLM output before returning to user."""
        # Content safety check
        safety_result = await self.check_input(llm_response)

        # Custom business rule checks
        if self._contains_pii(llm_response):
            safety_result.is_safe = False
            safety_result.blocked_categories.append("PII_DETECTED")

        if self._contains_competitor_recommendations(llm_response):
            safety_result.is_safe = False
            safety_result.blocked_categories.append("COMPETITOR_MENTION")

        return safety_result

    def _contains_pii(self, text: str) -> bool:
        # Implement PII detection logic
        pass

    def _contains_competitor_recommendations(self, text: str) -> bool:
        # Implement business rule logic
        pass
```

## Integration Pattern

Wrap your LLM calls with guardrail checks:

```python
async def safe_completion(user_input: str) -> str:
    input_check = await guardrails.check_input(user_input)
    if not input_check.is_safe:
        return "I can't help with that request."

    response = await llm.complete(user_input)

    output_check = await guardrails.check_output(response)
    if not output_check.is_safe:
        return "I apologize, but I need to provide a different response."

    return response
```

Guardrails are essential for enterprise AI deployments, protecting both users and your organization.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
