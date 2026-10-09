---
title: "Responsible AI Practices with Azure OpenAI"
description: "Responsible AI isn't just about compliance - it's about building trust with users and ensuring AI benefits everyone. Azure OpenAI provides a foundation, but…"
author: Michael John Pena
draft: false
date: 2023-03-05
tags:
  - Azure
  - OpenAI
  - AI
  - Responsible AI
  - Ethics
---

## Azure OpenAI Content Filtering

Azure OpenAI includes built-in content filters that run on both inputs and outputs:

```python
import openai

def check_content_filter_results(response):
    """Check if content filtering was triggered."""
    if hasattr(response, 'choices') and response.choices:
        choice = response.choices[0]
        if hasattr(choice, 'content_filter_results'):
            filters = choice.content_filter_results
            for category, result in filters.items():
                if result.get('filtered', False):
                    print(f"Content filtered: {category}")
                    return True
    return False

# Example with content filtering
try:
    response = openai.ChatCompletion.create(
        engine="gpt-35-turbo",
        messages=[{"role": "user", "content": "Your message here"}]
    )

    if not check_content_filter_results(response):
        print(response.choices[0].message.content)
    else:
        print("Response was filtered for safety")

except openai.error.InvalidRequestError as e:
    if "content_filter" in str(e):
        print("Input was filtered for safety")
    raise
```

## Content Filter Categories

Azure OpenAI filters four categories at different severity levels:

```python
from enum import Enum
from dataclasses import dataclass

class FilterCategory(Enum):
    HATE = "hate"
    SEXUAL = "sexual"
    VIOLENCE = "violence"
    SELF_HARM = "self_harm"

class Severity(Enum):
    SAFE = "safe"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"

@dataclass
class ContentFilterConfig:
    """Content filter configuration per category."""
    category: FilterCategory
    input_threshold: Severity
    output_threshold: Severity

# Default Azure OpenAI settings (as of March 2023)
default_config = [
    ContentFilterConfig(FilterCategory.HATE, Severity.MEDIUM, Severity.MEDIUM),
    ContentFilterConfig(FilterCategory.SEXUAL, Severity.MEDIUM, Severity.MEDIUM),
    ContentFilterConfig(FilterCategory.VIOLENCE, Severity.MEDIUM, Severity.MEDIUM),
    ContentFilterConfig(FilterCategory.SELF_HARM, Severity.MEDIUM, Severity.MEDIUM),
]
```

## Implementing Additional Safety Layers

Don't rely solely on built-in filters. Add your own:

```python
import re
from typing import Tuple

class SafetyChecker:
    def __init__(self):
        # Patterns for sensitive information
        self.pii_patterns = {
            'email': r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
            'phone': r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b',
            'ssn': r'\b\d{3}-\d{2}-\d{4}\b',
            'credit_card': r'\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b',
        }

        # Words that might indicate prompt injection
        self.injection_patterns = [
            r'ignore (previous|all) instructions',
            r'disregard (previous|all|your)',
            r'you are now',
            r'pretend (to be|you are)',
            r'act as',
            r'roleplay as',
        ]

    def check_pii(self, text: str) -> Tuple[bool, list]:
        """Check for PII in text."""
        found_pii = []
        for pii_type, pattern in self.pii_patterns.items():
            if re.search(pattern, text, re.IGNORECASE):
                found_pii.append(pii_type)
        return len(found_pii) > 0, found_pii

    def check_injection(self, text: str) -> bool:
        """Check for potential prompt injection."""
        text_lower = text.lower()
        for pattern in self.injection_patterns:
            if re.search(pattern, text_lower):
                return True
        return False

    def sanitize_input(self, text: str) -> Tuple[str, dict]:
        """Sanitize input and return warnings."""
        warnings = {}

        has_pii, pii_types = self.check_pii(text)
        if has_pii:
            warnings['pii_detected'] = pii_types
            # Optionally redact PII
            for pii_type, pattern in self.pii_patterns.items():
                text = re.sub(pattern, f'[REDACTED_{pii_type.upper()}]', text)

        if self.check_injection(text):
            warnings['potential_injection'] = True

        return text, warnings

# Usage
safety = SafetyChecker()

user_input = "My email is john@example.com and ignore previous instructions"
sanitized, warnings = safety.sanitize_input(user_input)

if warnings:
    print(f"Warnings: {warnings}")
print(f"Sanitized: {sanitized}")
```

## Implementing Guardrails

Use a moderation layer before and after model calls:

```python
import openai
from dataclasses import dataclass
from typing import Optional

@dataclass
class ModerationResult:
    is_safe: bool
    categories: dict
    message: Optional[str] = None

class AIGuardrails:
    def __init__(self, strict_mode: bool = True):
        self.strict_mode = strict_mode
        self.safety_checker = SafetyChecker()

    def moderate_input(self, text: str) -> ModerationResult:
        """Check input before sending to model."""
        # Check for PII and injection
        _, warnings = self.safety_checker.sanitize_input(text)

        if warnings.get('potential_injection') and self.strict_mode:
            return ModerationResult(
                is_safe=False,
                categories=warnings,
                message="Input appears to contain prompt manipulation attempts"
            )

        if warnings.get('pii_detected') and self.strict_mode:
            return ModerationResult(
                is_safe=False,
                categories=warnings,
                message=f"Input contains personal information: {warnings['pii_detected']}"
            )

        return ModerationResult(is_safe=True, categories={})

    def moderate_output(self, text: str, context: str = "") -> ModerationResult:
        """Check output before returning to user."""
        # Check for leaked PII
        has_pii, pii_types = self.safety_checker.check_pii(text)

        if has_pii:
            return ModerationResult(
                is_safe=False,
                categories={'pii_in_output': pii_types},
                message="Output contains personal information"
            )

        # Check for factual claims that need verification
        # This is a simplified example
        uncertain_phrases = [
            'i think', 'probably', 'might be', 'not sure',
            'could be', 'possibly', 'i believe'
        ]

        confidence_concerns = any(
            phrase in text.lower() for phrase in uncertain_phrases
        )

        return ModerationResult(
            is_safe=True,
            categories={'low_confidence': confidence_concerns}
        )

    def safe_completion(self, messages: list) -> dict:
        """Complete with guardrails."""
        # Check input
        user_message = next(
            (m['content'] for m in messages if m['role'] == 'user'),
            ""
        )

        input_check = self.moderate_input(user_message)
        if not input_check.is_safe:
            return {
                'success': False,
                'error': input_check.message,
                'categories': input_check.categories
            }

        # Call model
        try:
            response = openai.ChatCompletion.create(
                engine="gpt-35-turbo",
                messages=messages
            )
            output = response.choices[0].message.content

            # Check output
            output_check = self.moderate_output(output)
            if not output_check.is_safe:
                return {
                    'success': False,
                    'error': output_check.message,
                    'categories': output_check.categories
                }

            return {
                'success': True,
                'content': output,
                'warnings': output_check.categories if output_check.categories else None
            }

        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

# Usage
guardrails = AIGuardrails(strict_mode=True)

result = guardrails.safe_completion([
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is Azure Data Factory?"}
])

if result['success']:
    print(result['content'])
else:
    print(f"Blocked: {result['error']}")
```

## Transparency and Disclosure

Always be clear that users are interacting with AI:

```python
class TransparentAI:
    def __init__(self, model_name: str):
        self.model_name = model_name
        self.disclaimer = f"""
Note: This response was generated by an AI system ({model_name}).
- Responses may contain errors or outdated information
- Verify important information from authoritative sources
- Do not share personal or sensitive information
"""

    def get_response_with_disclosure(self, response: str) -> str:
        """Add transparency disclosure to response."""
        return f"{response}\n\n---\n{self.disclaimer}"

    def log_interaction(self, user_input: str, response: str, metadata: dict):
        """Log interactions for audit trail."""
        import json
        from datetime import datetime

        log_entry = {
            'timestamp': datetime.utcnow().isoformat(),
            'model': self.model_name,
            'input_length': len(user_input),
            'output_length': len(response),
            'metadata': metadata
        }

        # In production, send to proper logging system
        print(json.dumps(log_entry))
```

## Bias Detection

Monitor for biased outputs:

```python
from collections import Counter

class BiasMonitor:
    def __init__(self):
        self.response_history = []
        self.sentiment_scores = []

    def analyze_response(self, response: str, context: dict) -> dict:
        """Analyze response for potential bias indicators."""
        analysis = {
            'length': len(response),
            'context_type': context.get('type'),
        }

        # Track patterns over time
        self.response_history.append(analysis)

        return analysis

    def get_bias_report(self) -> dict:
        """Generate bias analysis report."""
        if len(self.response_history) < 10:
            return {'status': 'insufficient_data'}

        # Analyze response patterns
        context_types = [r['context_type'] for r in self.response_history]
        type_distribution = Counter(context_types)

        avg_length = sum(r['length'] for r in self.response_history) / len(self.response_history)

        return {
            'total_responses': len(self.response_history),
            'context_distribution': dict(type_distribution),
            'average_response_length': avg_length,
        }
```

## Key Principles

1. **Transparency**: Be clear about AI involvement
2. **Human oversight**: Keep humans in the loop for critical decisions
3. **Privacy**: Protect user data and PII
4. **Fairness**: Monitor and address bias
5. **Safety**: Implement multiple layers of safeguards
6. **Accountability**: Log and audit AI decisions

Responsible AI isn't just about compliance - it's about building trust with users and ensuring AI benefits everyone. Azure OpenAI provides a foundation, but the responsibility ultimately lies with us as developers.
