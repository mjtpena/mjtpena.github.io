---
title: "Azure Content Safety: Protecting AI Applications from Harmful Content"
author: Michael John Peña
draft: false
date: 2023-02-26
tags:
  - Azure
  - Content Safety
  - AI
  - Moderation
  - Security
---

## Getting Started

```python
from azure.ai.contentsafety import ContentSafetyClient
from azure.core.credentials import AzureKeyCredential
from azure.ai.contentsafety.models import (
    AnalyzeTextOptions,
    AnalyzeImageOptions,
    TextCategory,
    ImageCategory
)

client = ContentSafetyClient(
    endpoint="https://your-resource.cognitiveservices.azure.com/",
    credential=AzureKeyCredential("your-key")
)
```

## Text Analysis

```python
def analyze_text_safety(text: str) -> dict:
    """Analyze text for harmful content."""

    request = AnalyzeTextOptions(
        text=text,
        categories=[
            TextCategory.HATE,
            TextCategory.SELF_HARM,
            TextCategory.SEXUAL,
            TextCategory.VIOLENCE
        ],
        output_type="FourSeverityLevels"  # 0-6 scale
    )

    response = client.analyze_text(request)

    results = {
        "is_safe": True,
        "categories": {}
    }

    category_results = response.categories_analysis

    for result in category_results:
        category = result.category.value
        severity = result.severity

        results["categories"][category] = {
            "severity": severity,
            "is_flagged": severity >= 2  # Threshold
        }

        if severity >= 2:
            results["is_safe"] = False

    return results

# Usage
text = "Some text to analyze..."
safety_result = analyze_text_safety(text)
print(f"Safe: {safety_result['is_safe']}")
```

## Image Analysis

```python
import base64

def analyze_image_safety(image_path: str) -> dict:
    """Analyze image for harmful content."""

    # Read and encode image
    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")

    request = AnalyzeImageOptions(
        image={"content": image_data},
        categories=[
            ImageCategory.HATE,
            ImageCategory.SELF_HARM,
            ImageCategory.SEXUAL,
            ImageCategory.VIOLENCE
        ],
        output_type="FourSeverityLevels"
    )

    response = client.analyze_image(request)

    results = {
        "is_safe": True,
        "categories": {}
    }

    for result in response.categories_analysis:
        category = result.category.value
        severity = result.severity

        results["categories"][category] = {
            "severity": severity,
            "is_flagged": severity >= 2
        }

        if severity >= 2:
            results["is_safe"] = False

    return results
```

## Content Safety Middleware

```python
from functools import wraps
from typing import Callable

class ContentSafetyMiddleware:
    """Middleware for content safety in AI applications."""

    def __init__(self, client: ContentSafetyClient, threshold: int = 2):
        self.client = client
        self.threshold = threshold

    def check_input(self, text: str) -> tuple:
        """Check if input is safe."""
        result = analyze_text_safety(text)
        return result["is_safe"], result

    def check_output(self, text: str) -> tuple:
        """Check if output is safe."""
        result = analyze_text_safety(text)
        return result["is_safe"], result

    def safe_llm_call(self, llm_function: Callable):
        """Decorator to add safety checks to LLM calls."""
        @wraps(llm_function)
        def wrapper(prompt: str, *args, **kwargs):
            # Check input
            input_safe, input_result = self.check_input(prompt)
            if not input_safe:
                return {
                    "blocked": True,
                    "stage": "input",
                    "reason": "Input contains potentially harmful content",
                    "categories": input_result["categories"]
                }

            # Call LLM
            response = llm_function(prompt, *args, **kwargs)

            # Check output
            output_safe, output_result = self.check_output(response)
            if not output_safe:
                return {
                    "blocked": True,
                    "stage": "output",
                    "reason": "Generated content contains potentially harmful content",
                    "categories": output_result["categories"]
                }

            return {
                "blocked": False,
                "response": response
            }

        return wrapper

# Usage
middleware = ContentSafetyMiddleware(client)

@middleware.safe_llm_call
def generate_response(prompt: str) -> str:
    # Your LLM call here
    return openai.ChatCompletion.create(
        engine="gpt-35-turbo",
        messages=[{"role": "user", "content": prompt}]
    ).choices[0].message.content

result = generate_response("Tell me about cloud computing")
if result["blocked"]:
    print(f"Content blocked at {result['stage']}: {result['reason']}")
else:
    print(result["response"])
```

## Blocklist Management

```python
def create_blocklist(name: str, description: str):
    """Create a custom blocklist."""
    from azure.ai.contentsafety.models import TextBlocklist

    blocklist = client.create_or_update_text_blocklist(
        blocklist_name=name,
        options=TextBlocklist(description=description)
    )
    return blocklist

def add_blocklist_items(blocklist_name: str, items: list):
    """Add items to blocklist."""
    from azure.ai.contentsafety.models import TextBlocklistItem

    block_items = [
        TextBlocklistItem(text=item, description=f"Blocked: {item}")
        for item in items
    ]

    result = client.add_or_update_blocklist_items(
        blocklist_name=blocklist_name,
        options={"blocklistItems": block_items}
    )
    return result

def check_with_blocklist(text: str, blocklist_names: list) -> dict:
    """Check text against custom blocklists."""
    request = AnalyzeTextOptions(
        text=text,
        blocklist_names=blocklist_names,
        halt_on_blocklist_hit=True
    )

    response = client.analyze_text(request)

    blocklist_matches = []
    for match in response.blocklists_match or []:
        blocklist_matches.append({
            "blocklist": match.blocklist_name,
            "item": match.blocklist_item_text
        })

    return {
        "blocked": len(blocklist_matches) > 0,
        "matches": blocklist_matches
    }

# Usage
create_blocklist("competitor-names", "Block competitor mentions")
add_blocklist_items("competitor-names", ["CompetitorA", "CompetitorB"])

result = check_with_blocklist("Check out CompetitorA's products", ["competitor-names"])
```

## Severity Thresholds

```python
class ContentSafetyConfig:
    """Configure content safety thresholds."""

    SEVERITY_LEVELS = {
        0: "Safe",
        2: "Low",
        4: "Medium",
        6: "High"
    }

    # Default thresholds (block if >= threshold)
    DEFAULT_THRESHOLDS = {
        "hate": 2,
        "self_harm": 2,
        "sexual": 4,
        "violence": 4
    }

    def __init__(self, thresholds: dict = None):
        self.thresholds = thresholds or self.DEFAULT_THRESHOLDS

    def should_block(self, category: str, severity: int) -> bool:
        """Determine if content should be blocked."""
        threshold = self.thresholds.get(category.lower(), 2)
        return severity >= threshold

    def get_action(self, results: dict) -> str:
        """Get recommended action based on results."""
        max_severity = 0
        worst_category = None

        for category, data in results["categories"].items():
            if data["severity"] > max_severity:
                max_severity = data["severity"]
                worst_category = category

        if max_severity == 0:
            return "allow"
        elif max_severity < 2:
            return "allow_with_warning"
        elif max_severity < 4:
            return "require_review"
        else:
            return "block"

# Usage
config = ContentSafetyConfig({
    "hate": 2,
    "self_harm": 2,
    "sexual": 4,
    "violence": 2
})

safety_result = analyze_text_safety(text)
action = config.get_action(safety_result)
```

## Logging and Monitoring

```python
import logging
from datetime import datetime

class ContentSafetyLogger:
    """Log content safety events."""

    def __init__(self):
        self.logger = logging.getLogger("content_safety")
        self.events = []

    def log_check(
        self,
        content_type: str,
        result: dict,
        user_id: str = None
    ):
        """Log a content safety check."""
        event = {
            "timestamp": datetime.utcnow().isoformat(),
            "content_type": content_type,
            "is_safe": result["is_safe"],
            "categories": result["categories"],
            "user_id": user_id
        }

        self.events.append(event)

        if not result["is_safe"]:
            self.logger.warning(
                f"Unsafe content detected - User: {user_id}, "
                f"Categories: {result['categories']}"
            )
        else:
            self.logger.info(f"Content check passed - User: {user_id}")

    def get_metrics(self) -> dict:
        """Get safety metrics."""
        total = len(self.events)
        blocked = sum(1 for e in self.events if not e["is_safe"])

        by_category = {}
        for event in self.events:
            for cat, data in event["categories"].items():
                if cat not in by_category:
                    by_category[cat] = {"total": 0, "flagged": 0}
                by_category[cat]["total"] += 1
                if data["is_flagged"]:
                    by_category[cat]["flagged"] += 1

        return {
            "total_checks": total,
            "blocked": blocked,
            "block_rate": blocked / total if total > 0 else 0,
            "by_category": by_category
        }
```

## Best Practices

1. **Set appropriate thresholds**: Adjust based on your use case
2. **Use blocklists**: For domain-specific terms
3. **Check both input and output**: For AI applications
4. **Log safety events**: Monitor and improve
5. **Handle edge cases**: Plan for borderline content
6. **Human review**: For uncertain cases

## Resources

- [Azure Content Safety](https://learn.microsoft.com/azure/ai-services/content-safety/)
- [Content Safety API Reference](https://learn.microsoft.com/rest/api/contentsafety/)
- [Best Practices](https://learn.microsoft.com/azure/ai-services/content-safety/concepts/content-moderation)
