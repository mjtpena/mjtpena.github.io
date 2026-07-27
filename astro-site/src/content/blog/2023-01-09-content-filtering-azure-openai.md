---
title: "Content Filtering in Azure OpenAI: Implementing Safety Guardrails"
author: Michael John Peña
draft: false
date: 2023-01-09
tags:
  - Azure
  - OpenAI
  - Content Safety
  - Security
  - AI

---

I wrote "Content Filtering in Azure OpenAI: Implementing Safety Guardrails" to share practical, production-minded guidance on this topic.

## Understanding Content Filtering

Azure OpenAI's content filtering system evaluates both inputs and outputs across four categories:

1. **Hate**: Content attacking identity groups
2. **Sexual**: Sexually explicit content
3. **Violence**: Violent content or threats
4. **Self-Harm**: Content promoting self-harm

Each category has severity levels: safe, low, medium, high.

## Default Filtering Behavior

By default, Azure OpenAI blocks:
- High severity content in all categories
- Medium severity content in most categories

```python
import openai
import os

openai.api_type = "azure"
openai.api_base = os.getenv("AZURE_OPENAI_ENDPOINT")
openai.api_version = "2023-06-01-preview"
openai.api_key = os.getenv("AZURE_OPENAI_KEY")

def test_content_filter(prompt: str) -> dict:
    """Test content filtering on a prompt."""
    try:
        response = openai.Completion.create(
            engine="gpt35",
            prompt=prompt,
            max_tokens=100
        )

        return {
            "status": "success",
            "response": response.choices[0].text,
            "content_filter_results": response.get("choices", [{}])[0].get(
                "content_filter_results", {}
            )
        }

    except openai.error.InvalidRequestError as e:
        # Content was filtered
        return {
            "status": "filtered",
            "error": str(e),
            "category": extract_filter_category(str(e))
        }

def extract_filter_category(error_message: str) -> str:
    """Extract which category triggered the filter."""
    categories = ["hate", "sexual", "violence", "self_harm"]
    for category in categories:
        if category in error_message.lower():
            return category
    return "unknown"

# Test various inputs
test_cases = [
    "Explain cloud computing in simple terms",  # Safe
    "Write a poem about nature",  # Safe
    # Potentially filtered content would be blocked
]

for prompt in test_cases:
    result = test_content_filter(prompt)
    print(f"Prompt: {prompt[:50]}...")
    print(f"Result: {result['status']}")
    print("---")
```

## Content Filter Response Structure

When content filtering is applied, responses include filter results:

```python
from dataclasses import dataclass
from typing import Optional, Dict, Any
from enum import Enum

class FilterSeverity(Enum):
    SAFE = "safe"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"

@dataclass
class ContentFilterResult:
    """Represents content filter results for a single category."""
    category: str
    severity: FilterSeverity
    filtered: bool

@dataclass
class ContentFilterResults:
    """Complete content filter results."""
    hate: ContentFilterResult
    sexual: ContentFilterResult
    violence: ContentFilterResult
    self_harm: ContentFilterResult

    @classmethod
    def from_api_response(cls, response: Dict[str, Any]) -> 'ContentFilterResults':
        """Parse content filter results from API response."""
        filter_results = response.get("choices", [{}])[0].get(
            "content_filter_results", {}
        )

        def parse_category(name: str) -> ContentFilterResult:
            data = filter_results.get(name, {})
            return ContentFilterResult(
                category=name,
                severity=FilterSeverity(data.get("severity", "safe")),
                filtered=data.get("filtered", False)
            )

        return cls(
            hate=parse_category("hate"),
            sexual=parse_category("sexual"),
            violence=parse_category("violence"),
            self_harm=parse_category("self_harm")
        )

    def any_filtered(self) -> bool:
        """Check if any category was filtered."""
        return any([
            self.hate.filtered,
            self.sexual.filtered,
            self.violence.filtered,
            self.self_harm.filtered
        ])

    def get_filtered_categories(self) -> list:
        """Get list of filtered categories."""
        filtered = []
        for result in [self.hate, self.sexual, self.violence, self.self_harm]:
            if result.filtered:
                filtered.append(result.category)
        return filtered
```

## Building a Safe AI Wrapper

Create a wrapper that handles content filtering gracefully:

```python
from typing import Optional, Callable
import logging

class SafeOpenAIClient:
    """OpenAI client with content filtering handling."""

    def __init__(
        self,
        deployment: str,
        on_content_filtered: Optional[Callable[[str, list], str]] = None
    ):
        self.deployment = deployment
        self.logger = logging.getLogger("safe_openai")
        self.on_content_filtered = on_content_filtered or self._default_filter_handler

    def complete(
        self,
        prompt: str,
        max_tokens: int = 500,
        **kwargs
    ) -> dict:
        """
        Generate completion with content filter handling.

        Returns:
            dict with 'response', 'filtered', and 'filter_results'
        """

        try:
            response = openai.Completion.create(
                engine=self.deployment,
                prompt=prompt,
                max_tokens=max_tokens,
                **kwargs
            )

            # Parse filter results
            filter_results = ContentFilterResults.from_api_response(response)

            # Check if any output was filtered
            if filter_results.any_filtered():
                self.logger.warning(
                    f"Output partially filtered: {filter_results.get_filtered_categories()}"
                )

            return {
                "response": response.choices[0].text.strip(),
                "filtered": False,
                "filter_results": filter_results,
                "usage": response.usage
            }

        except openai.error.InvalidRequestError as e:
            error_str = str(e)

            # Input was filtered
            if "content_filter" in error_str.lower():
                self.logger.warning(f"Input filtered: {error_str}")

                filtered_categories = self._parse_filter_error(error_str)
                fallback_response = self.on_content_filtered(prompt, filtered_categories)

                return {
                    "response": fallback_response,
                    "filtered": True,
                    "filter_results": None,
                    "filtered_categories": filtered_categories
                }

            raise

    def _default_filter_handler(self, prompt: str, categories: list) -> str:
        """Default handler for filtered content."""
        return (
            "I'm unable to process that request as it may contain "
            "content that violates our usage policies. "
            "Please rephrase your question."
        )

    def _parse_filter_error(self, error: str) -> list:
        """Parse which categories caused filtering from error message."""
        categories = []
        category_keywords = {
            "hate": ["hate", "discrimination"],
            "sexual": ["sexual", "explicit"],
            "violence": ["violence", "violent"],
            "self_harm": ["self-harm", "self_harm", "suicide"]
        }

        error_lower = error.lower()
        for category, keywords in category_keywords.items():
            if any(kw in error_lower for kw in keywords):
                categories.append(category)

        return categories if categories else ["unknown"]

# Usage with custom filter handler
def custom_filter_handler(prompt: str, categories: list) -> str:
    """Custom handler that provides category-specific responses."""

    responses = {
        "hate": "I can't respond to content that may be discriminatory. Let me know if you have other questions.",
        "violence": "I'm not able to discuss violent content. Is there something else I can help with?",
        "sexual": "I can't generate explicit content. Please ask something else.",
        "self_harm": "If you're struggling, please reach out to a mental health professional. I'm here for other questions."
    }

    for category in categories:
        if category in responses:
            return responses[category]

    return "I can't process that request. Please try rephrasing."

client = SafeOpenAIClient(
    deployment="gpt35",
    on_content_filtered=custom_filter_handler
)

result = client.complete("Tell me about cloud computing")
print(result["response"])
```

## Custom Content Filter Configurations

You can request custom content filter configurations for specific use cases:

```python
# Example: Medical content might need adjusted filters
# This requires Azure support approval

FILTER_CONFIGURATIONS = {
    "default": {
        "hate": {"threshold": "medium"},
        "sexual": {"threshold": "medium"},
        "violence": {"threshold": "medium"},
        "self_harm": {"threshold": "low"}
    },
    "medical": {
        # Medical content may discuss injuries, procedures
        "hate": {"threshold": "medium"},
        "sexual": {"threshold": "high"},
        "violence": {"threshold": "high"},  # Allow medical violence discussion
        "self_harm": {"threshold": "medium"}
    },
    "gaming": {
        # Gaming content may reference fantasy violence
        "hate": {"threshold": "medium"},
        "sexual": {"threshold": "medium"},
        "violence": {"threshold": "high"},
        "self_harm": {"threshold": "low"}
    }
}

class ConfigurableFilterClient:
    """Client that uses appropriate filter configuration."""

    def __init__(self, config_name: str = "default"):
        self.config = FILTER_CONFIGURATIONS.get(config_name, FILTER_CONFIGURATIONS["default"])
        self.config_name = config_name

    def should_proceed(self, filter_results: ContentFilterResults) -> bool:
        """Check if results pass configured thresholds."""
        severity_order = ["safe", "low", "medium", "high"]

        for category_name, settings in self.config.items():
            category_result = getattr(filter_results, category_name, None)
            if category_result:
                threshold = settings["threshold"]
                result_severity = category_result.severity.value

                threshold_idx = severity_order.index(threshold)
                result_idx = severity_order.index(result_severity)

                if result_idx > threshold_idx:
                    return False

        return True
```

## Logging and Monitoring Content Filters

Track content filtering events for analysis:

```python
from datetime import datetime
from collections import defaultdict
import json

class ContentFilterLogger:
    """Log and analyze content filter events."""

    def __init__(self, log_path: str = "content_filter_logs.jsonl"):
        self.log_path = log_path
        self.stats = defaultdict(int)

    def log_event(
        self,
        user_id: str,
        prompt_hash: str,  # Don't log actual prompts for privacy
        filter_results: Optional[ContentFilterResults],
        was_blocked: bool,
        blocked_categories: list = None
    ):
        """Log a content filter event."""
        event = {
            "timestamp": datetime.utcnow().isoformat(),
            "user_id": user_id,
            "prompt_hash": prompt_hash,
            "was_blocked": was_blocked,
            "blocked_categories": blocked_categories or [],
            "filter_details": self._serialize_filter_results(filter_results)
        }

        # Write to log file
        with open(self.log_path, "a") as f:
            f.write(json.dumps(event) + "\n")

        # Update stats
        if was_blocked:
            self.stats["total_blocked"] += 1
            for category in (blocked_categories or []):
                self.stats[f"blocked_{category}"] += 1
        else:
            self.stats["total_passed"] += 1

    def _serialize_filter_results(
        self,
        results: Optional[ContentFilterResults]
    ) -> Optional[dict]:
        """Serialize filter results for logging."""
        if not results:
            return None

        return {
            "hate": {"severity": results.hate.severity.value, "filtered": results.hate.filtered},
            "sexual": {"severity": results.sexual.severity.value, "filtered": results.sexual.filtered},
            "violence": {"severity": results.violence.severity.value, "filtered": results.violence.filtered},
            "self_harm": {"severity": results.self_harm.severity.value, "filtered": results.self_harm.filtered}
        }

    def get_stats(self) -> dict:
        """Get filter statistics."""
        total = self.stats["total_blocked"] + self.stats["total_passed"]

        return {
            "total_requests": total,
            "blocked_count": self.stats["total_blocked"],
            "passed_count": self.stats["total_passed"],
            "block_rate": self.stats["total_blocked"] / total if total > 0 else 0,
            "by_category": {
                "hate": self.stats.get("blocked_hate", 0),
                "sexual": self.stats.get("blocked_sexual", 0),
                "violence": self.stats.get("blocked_violence", 0),
                "self_harm": self.stats.get("blocked_self_harm", 0)
            }
        }

# Azure Monitor integration
def send_to_azure_monitor(event: dict):
    """Send content filter event to Azure Monitor."""
    from opencensus.ext.azure import metrics_exporter
    from opencensus.stats import aggregation, measure, stats, view

    # Create custom metrics
    content_filter_measure = measure.MeasureInt(
        "content_filter_events",
        "Number of content filter events",
        "events"
    )

    # Record metric
    mmap = stats.stats.stats_recorder.new_measurement_map()
    mmap.measure_int_put(content_filter_measure, 1)
    mmap.record()
```

## Best Practices

1. **Don't disable filters**: Keep default filtering enabled for safety
2. **Handle gracefully**: Provide helpful messages when content is filtered
3. **Log events**: Track filtering for analysis and improvement
4. **Test edge cases**: Ensure your app handles filtered content correctly
5. **Custom configs**: Request custom configurations only when necessary
6. **Combine with other safety measures**: Content filtering is one layer of defense

## Resources

- [Azure OpenAI Content Filtering](https://learn.microsoft.com/azure/cognitive-services/openai/concepts/content-filter)
- [Azure Content Safety Service](https://azure.microsoft.com/products/cognitive-services/content-safety/)
- [Responsible AI Dashboard](https://learn.microsoft.com/azure/machine-learning/concept-responsible-ai-dashboard)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
