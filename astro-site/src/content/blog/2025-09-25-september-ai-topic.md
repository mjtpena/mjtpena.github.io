---
title: "Responsible AI: Content Safety Filters for LLM Applications"
description: "Content safety is non-negotiable for production AI applications. Implement multiple layers of filtering for both inputs and outputs to protect users and…"
author: Michael John Peña
draft: false
date: 2025-09-25
tags:
  - Responsible AI
  - Content Safety
  - Azure AI
  - Moderation
  - LLM
---

## Implementing Content Safety

```python
from azure.ai.contentsafety import ContentSafetyClient
from azure.ai.contentsafety.models import (
    AnalyzeTextOptions,
    TextCategory
)
from azure.core.credentials import AzureKeyCredential
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum
import os

class SafetyAction(Enum):
    ALLOW = "allow"
    WARN = "warn"
    BLOCK = "block"

@dataclass
class SafetyResult:
    is_safe: bool
    action: SafetyAction
    categories: Dict[str, int]
    flagged_categories: List[str]
    analysis_id: str

class ContentSafetyFilter:
    def __init__(self, thresholds: Dict[str, int] = None):
        self.client = ContentSafetyClient(
            endpoint=os.environ["AZURE_CONTENT_SAFETY_ENDPOINT"],
            credential=AzureKeyCredential(os.environ["AZURE_CONTENT_SAFETY_KEY"])
        )

        # Default thresholds (0=safe, 2=low, 4=medium, 6=high severity)
        self.thresholds = thresholds or {
            "Hate": 2,
            "SelfHarm": 2,
            "Sexual": 4,
            "Violence": 4
        }

    def analyze_text(self, text: str) -> SafetyResult:
        """Analyze text for safety concerns."""

        request = AnalyzeTextOptions(text=text)
        response = self.client.analyze_text(request)

        categories = {}
        flagged = []
        max_severity = 0

        for category in response.categories_analysis:
            severity = category.severity
            categories[category.category] = severity

            threshold = self.thresholds.get(category.category, 4)
            if severity >= threshold:
                flagged.append(category.category)

            max_severity = max(max_severity, severity)

        # Determine action
        if len(flagged) > 0:
            action = SafetyAction.BLOCK
        elif max_severity >= 2:
            action = SafetyAction.WARN
        else:
            action = SafetyAction.ALLOW

        return SafetyResult(
            is_safe=len(flagged) == 0,
            action=action,
            categories=categories,
            flagged_categories=flagged,
            analysis_id=response.analysis_id if hasattr(response, 'analysis_id') else ""
        )

    def filter_llm_response(self, response: str,
                           original_prompt: str) -> Dict:
        """Filter LLM response and optionally check prompt."""

        # Check response
        response_safety = self.analyze_text(response)

        if response_safety.action == SafetyAction.BLOCK:
            return {
                "filtered": True,
                "original_response": None,  # Don't return unsafe content
                "safe_response": self._generate_safe_response(response_safety),
                "reason": response_safety.flagged_categories
            }

        return {
            "filtered": False,
            "original_response": response,
            "safe_response": response,
            "warnings": response_safety.flagged_categories if response_safety.action == SafetyAction.WARN else []
        }

    def _generate_safe_response(self, safety_result: SafetyResult) -> str:
        """Generate a safe alternative response."""
        return ("I apologize, but I cannot provide a response to that request. "
                "Please rephrase your question or ask about a different topic.")


class SafeLLMWrapper:
    """Wrapper that applies content safety to all LLM interactions."""

    def __init__(self, llm_client, safety_filter: ContentSafetyFilter):
        self.client = llm_client
        self.safety = safety_filter

    def chat(self, messages: List[Dict], **kwargs) -> Dict:
        """Safe chat completion with content filtering."""

        # Check user message
        user_message = messages[-1]["content"] if messages else ""
        input_safety = self.safety.analyze_text(user_message)

        if input_safety.action == SafetyAction.BLOCK:
            return {
                "blocked": True,
                "reason": "input_filtered",
                "message": "Your message could not be processed due to content policy."
            }

        # Get LLM response
        response = self.client.chat.completions.create(messages=messages, **kwargs)
        response_text = response.choices[0].message.content

        # Filter response
        filtered = self.safety.filter_llm_response(response_text, user_message)

        return {
            "blocked": filtered["filtered"],
            "content": filtered["safe_response"],
            "warnings": filtered.get("warnings", [])
        }
```

Content safety is non-negotiable for production AI applications. Implement multiple layers of filtering for both inputs and outputs to protect users and maintain trust.
