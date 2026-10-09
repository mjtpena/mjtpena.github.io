---
title: "Azure AI Content Safety: Comprehensive Content Moderation"
author: Michael John Peña
draft: false
date: 2023-10-19
description: "Implementing Azure AI Content Safety for robust content moderation in AI applications."
tags:
  - Azure AI
  - Content Safety
  - Content Moderation
  - Microsoft Azure
  - AI Safety
---

## Introduction

Azure AI Content Safety provides advanced content moderation capabilities for detecting harmful content across text and images. This post covers how to implement comprehensive content safety using Azure's moderation APIs.

## Setting Up Azure AI Content Safety

```python
import os
from azure.ai.contentsafety import ContentSafetyClient
from azure.ai.contentsafety.models import (
    AnalyzeTextOptions,
    AnalyzeImageOptions,
    TextCategory,
    ImageCategory
)
from azure.core.credentials import AzureKeyCredential

class AzureContentSafety:
    """Azure AI Content Safety client wrapper"""

    def __init__(self):
        endpoint = os.environ.get("AZURE_CONTENT_SAFETY_ENDPOINT")
        key = os.environ.get("AZURE_CONTENT_SAFETY_KEY")

        self.client = ContentSafetyClient(
            endpoint=endpoint,
            credential=AzureKeyCredential(key)
        )

    def analyze_text(self, text: str) -> dict:
        """Analyze text for harmful content"""
        request = AnalyzeTextOptions(
            text=text,
            categories=[
                TextCategory.HATE,
                TextCategory.SELF_HARM,
                TextCategory.SEXUAL,
                TextCategory.VIOLENCE
            ],
            output_type="FourSeverityLevels"
        )

        response = self.client.analyze_text(request)

        return {
            "hate": {
                "severity": response.hate_result.severity if response.hate_result else 0,
                "category": "Hate"
            },
            "self_harm": {
                "severity": response.self_harm_result.severity if response.self_harm_result else 0,
                "category": "SelfHarm"
            },
            "sexual": {
                "severity": response.sexual_result.severity if response.sexual_result else 0,
                "category": "Sexual"
            },
            "violence": {
                "severity": response.violence_result.severity if response.violence_result else 0,
                "category": "Violence"
            }
        }

    def analyze_image(self, image_data: bytes) -> dict:
        """Analyze image for harmful content"""
        from azure.ai.contentsafety.models import ImageData

        request = AnalyzeImageOptions(
            image=ImageData(content=image_data),
            categories=[
                ImageCategory.HATE,
                ImageCategory.SELF_HARM,
                ImageCategory.SEXUAL,
                ImageCategory.VIOLENCE
            ]
        )

        response = self.client.analyze_image(request)

        return {
            "hate": response.hate_result.severity if response.hate_result else 0,
            "self_harm": response.self_harm_result.severity if response.self_harm_result else 0,
            "sexual": response.sexual_result.severity if response.sexual_result else 0,
            "violence": response.violence_result.severity if response.violence_result else 0
        }

# Usage
safety = AzureContentSafety()

text_result = safety.analyze_text("This is a test message")
print(f"Text analysis: {text_result}")
```

## Severity Levels and Thresholds

```python
from dataclasses import dataclass
from typing import Dict, List
from enum import IntEnum

class SeverityLevel(IntEnum):
    SAFE = 0
    LOW = 2
    MEDIUM = 4
    HIGH = 6

@dataclass
class ContentPolicy:
    """Content moderation policy configuration"""
    hate_threshold: SeverityLevel = SeverityLevel.LOW
    self_harm_threshold: SeverityLevel = SeverityLevel.LOW
    sexual_threshold: SeverityLevel = SeverityLevel.MEDIUM
    violence_threshold: SeverityLevel = SeverityLevel.MEDIUM

class ContentModerator:
    """Content moderator with configurable policies"""

    def __init__(self, policy: ContentPolicy = None):
        self.safety_client = AzureContentSafety()
        self.policy = policy or ContentPolicy()

    def moderate_text(self, text: str) -> Dict:
        """Moderate text content"""
        analysis = self.safety_client.analyze_text(text)

        violations = []

        # Check each category against thresholds
        if analysis["hate"]["severity"] >= self.policy.hate_threshold:
            violations.append({
                "category": "hate",
                "severity": analysis["hate"]["severity"],
                "threshold": self.policy.hate_threshold
            })

        if analysis["self_harm"]["severity"] >= self.policy.self_harm_threshold:
            violations.append({
                "category": "self_harm",
                "severity": analysis["self_harm"]["severity"],
                "threshold": self.policy.self_harm_threshold
            })

        if analysis["sexual"]["severity"] >= self.policy.sexual_threshold:
            violations.append({
                "category": "sexual",
                "severity": analysis["sexual"]["severity"],
                "threshold": self.policy.sexual_threshold
            })

        if analysis["violence"]["severity"] >= self.policy.violence_threshold:
            violations.append({
                "category": "violence",
                "severity": analysis["violence"]["severity"],
                "threshold": self.policy.violence_threshold
            })

        return {
            "text": text,
            "analysis": analysis,
            "violations": violations,
            "action": self._determine_action(violations),
            "safe": len(violations) == 0
        }

    def _determine_action(self, violations: List[Dict]) -> str:
        """Determine moderation action"""
        if not violations:
            return "allow"

        max_severity = max(v["severity"] for v in violations)

        if max_severity >= SeverityLevel.HIGH:
            return "block"
        elif max_severity >= SeverityLevel.MEDIUM:
            return "review"
        else:
            return "warn"

# Usage with custom policy
strict_policy = ContentPolicy(
    hate_threshold=SeverityLevel.SAFE,
    self_harm_threshold=SeverityLevel.SAFE,
    sexual_threshold=SeverityLevel.LOW,
    violence_threshold=SeverityLevel.LOW
)

moderator = ContentModerator(policy=strict_policy)

result = moderator.moderate_text("Sample content to moderate")
print(f"Safe: {result['safe']}")
print(f"Action: {result['action']}")
```

## Blocklist Management

```python
class BlocklistManager:
    """Manage custom blocklists for content moderation"""

    def __init__(self):
        self.safety_client = AzureContentSafety()

    def create_blocklist(self, name: str, description: str) -> Dict:
        """Create a new blocklist"""
        from azure.ai.contentsafety.models import TextBlocklist

        blocklist = TextBlocklist(
            blocklist_name=name,
            description=description
        )

        result = self.safety_client.client.create_or_update_text_blocklist(
            blocklist_name=name,
            options=blocklist
        )

        return {
            "name": result.blocklist_name,
            "description": result.description,
            "created": True
        }

    def add_items(self, blocklist_name: str, items: List[str]) -> Dict:
        """Add items to blocklist"""
        from azure.ai.contentsafety.models import (
            AddOrUpdateTextBlocklistItemsOptions,
            TextBlocklistItem
        )

        blocklist_items = [
            TextBlocklistItem(text=item, description=f"Blocked term: {item}")
            for item in items
        ]

        options = AddOrUpdateTextBlocklistItemsOptions(
            blocklist_items=blocklist_items
        )

        result = self.safety_client.client.add_or_update_blocklist_items(
            blocklist_name=blocklist_name,
            options=options
        )

        return {
            "blocklist": blocklist_name,
            "items_added": len(result.blocklist_items),
            "success": True
        }

    def analyze_with_blocklist(self, text: str, blocklist_names: List[str]) -> Dict:
        """Analyze text including blocklist check"""
        from azure.ai.contentsafety.models import AnalyzeTextOptions

        request = AnalyzeTextOptions(
            text=text,
            blocklist_names=blocklist_names,
            halt_on_blocklist_hit=True
        )

        response = self.safety_client.client.analyze_text(request)

        blocklist_matches = []
        if response.blocklists_match:
            for match in response.blocklists_match:
                blocklist_matches.append({
                    "blocklist": match.blocklist_name,
                    "item_id": match.blocklist_item_id,
                    "text": match.blocklist_item_text
                })

        return {
            "text": text,
            "blocklist_matches": blocklist_matches,
            "blocked": len(blocklist_matches) > 0
        }

# Usage
blocklist_mgr = BlocklistManager()

# Create blocklist
blocklist_mgr.create_blocklist(
    name="custom_blocked_terms",
    description="Custom blocked terms for our application"
)

# Add items
blocklist_mgr.add_items(
    blocklist_name="custom_blocked_terms",
    items=["spam", "scam", "phishing"]
)

# Analyze with blocklist
result = blocklist_mgr.analyze_with_blocklist(
    text="Check out this great deal!",
    blocklist_names=["custom_blocked_terms"]
)
```

## Batch Processing

```python
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List

class BatchModerator:
    """Batch content moderation"""

    def __init__(self, max_workers: int = 5):
        self.moderator = ContentModerator()
        self.max_workers = max_workers

    def moderate_batch(self, texts: List[str]) -> List[Dict]:
        """Moderate multiple texts in parallel"""
        results = []

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            future_to_text = {
                executor.submit(self.moderator.moderate_text, text): text
                for text in texts
            }

            for future in as_completed(future_to_text):
                text = future_to_text[future]
                try:
                    result = future.result()
                    results.append(result)
                except Exception as e:
                    results.append({
                        "text": text,
                        "error": str(e),
                        "safe": False,
                        "action": "error"
                    })

        return results

    def generate_report(self, results: List[Dict]) -> Dict:
        """Generate moderation report"""
        total = len(results)
        safe_count = sum(1 for r in results if r.get("safe", False))
        blocked_count = sum(1 for r in results if r.get("action") == "block")
        review_count = sum(1 for r in results if r.get("action") == "review")
        error_count = sum(1 for r in results if r.get("action") == "error")

        # Category breakdown
        category_counts = {
            "hate": 0,
            "self_harm": 0,
            "sexual": 0,
            "violence": 0
        }

        for result in results:
            for violation in result.get("violations", []):
                category = violation["category"]
                if category in category_counts:
                    category_counts[category] += 1

        return {
            "total_items": total,
            "safe": safe_count,
            "blocked": blocked_count,
            "review_required": review_count,
            "errors": error_count,
            "safe_rate": safe_count / total if total > 0 else 0,
            "category_breakdown": category_counts
        }

# Usage
batch_moderator = BatchModerator(max_workers=10)

texts_to_moderate = [
    "Hello, how can I help you?",
    "This is a normal message",
    "Another test message"
]

results = batch_moderator.moderate_batch(texts_to_moderate)
report = batch_moderator.generate_report(results)

print(f"Total: {report['total_items']}")
print(f"Safe: {report['safe']} ({report['safe_rate']:.1%})")
print(f"Blocked: {report['blocked']}")
```

## Integration with LLM Applications

```python
class SafetyIntegratedLLM:
    """LLM with integrated content safety"""

    def __init__(self, llm_client, policy: ContentPolicy = None):
        self.llm = llm_client
        self.moderator = ContentModerator(policy)
        self.input_moderation = True
        self.output_moderation = True

    def generate(self, prompt: str, user_input: str) -> Dict:
        """Generate response with safety checks"""
        # Moderate input
        if self.input_moderation:
            input_check = self.moderator.moderate_text(user_input)

            if input_check["action"] == "block":
                return {
                    "success": False,
                    "error": "input_blocked",
                    "message": "Your input was flagged for policy violations.",
                    "violations": input_check["violations"]
                }

        # Generate response
        full_prompt = f"{prompt}\n\nUser: {user_input}\n\nAssistant:"
        response = self.llm.generate(full_prompt)

        # Moderate output
        if self.output_moderation:
            output_check = self.moderator.moderate_text(response)

            if output_check["action"] == "block":
                return {
                    "success": False,
                    "error": "output_blocked",
                    "message": "The generated response was flagged and blocked.",
                    "response": None
                }

            if output_check["action"] == "review":
                return {
                    "success": True,
                    "response": response,
                    "flagged": True,
                    "requires_review": True,
                    "violations": output_check["violations"]
                }

        return {
            "success": True,
            "response": response,
            "flagged": False
        }

class ConversationModerator:
    """Moderate entire conversations"""

    def __init__(self):
        self.moderator = ContentModerator()
        self.conversation_history = []

    def add_message(self, role: str, content: str) -> Dict:
        """Add message to conversation with moderation"""
        moderation_result = self.moderator.moderate_text(content)

        message = {
            "role": role,
            "content": content,
            "moderation": moderation_result,
            "timestamp": self._get_timestamp()
        }

        if moderation_result["action"] != "block":
            self.conversation_history.append(message)

        return moderation_result

    def get_conversation_safety_score(self) -> Dict:
        """Calculate overall conversation safety"""
        if not self.conversation_history:
            return {"score": 1.0, "messages": 0}

        total_violations = 0
        category_scores = {
            "hate": [],
            "self_harm": [],
            "sexual": [],
            "violence": []
        }

        for msg in self.conversation_history:
            analysis = msg["moderation"]["analysis"]
            for category in category_scores:
                if category in analysis:
                    category_scores[category].append(analysis[category]["severity"])
            total_violations += len(msg["moderation"]["violations"])

        # Calculate average scores
        avg_scores = {}
        for category, scores in category_scores.items():
            avg_scores[category] = sum(scores) / len(scores) if scores else 0

        # Overall safety score
        max_avg = max(avg_scores.values()) if avg_scores else 0
        safety_score = 1.0 - (max_avg / 6)  # Normalize from 0-6 scale

        return {
            "safety_score": safety_score,
            "messages": len(self.conversation_history),
            "total_violations": total_violations,
            "category_averages": avg_scores
        }

    def _get_timestamp(self) -> str:
        from datetime import datetime
        return datetime.now().isoformat()
```

## Monitoring and Analytics

```python
from datetime import datetime, timedelta
from collections import defaultdict

class SafetyAnalytics:
    """Analytics for content safety monitoring"""

    def __init__(self):
        self.events = []

    def log_moderation_event(self, result: Dict):
        """Log a moderation event"""
        event = {
            "timestamp": datetime.now(),
            "action": result.get("action"),
            "violations": result.get("violations", []),
            "categories": [v["category"] for v in result.get("violations", [])]
        }
        self.events.append(event)

    def get_stats(self, hours: int = 24) -> Dict:
        """Get moderation statistics"""
        cutoff = datetime.now() - timedelta(hours=hours)
        recent_events = [e for e in self.events if e["timestamp"] > cutoff]

        if not recent_events:
            return {"period_hours": hours, "total_events": 0}

        action_counts = defaultdict(int)
        category_counts = defaultdict(int)

        for event in recent_events:
            action_counts[event["action"]] += 1
            for category in event["categories"]:
                category_counts[category] += 1

        return {
            "period_hours": hours,
            "total_events": len(recent_events),
            "action_breakdown": dict(action_counts),
            "category_breakdown": dict(category_counts),
            "block_rate": action_counts["block"] / len(recent_events) if recent_events else 0
        }

# Usage
analytics = SafetyAnalytics()

# Log events during operation
for result in results:
    analytics.log_moderation_event(result)

stats = analytics.get_stats(hours=24)
print(f"Total events: {stats['total_events']}")
print(f"Block rate: {stats['block_rate']:.1%}")
```

## Conclusion

Azure AI Content Safety provides powerful tools for implementing comprehensive content moderation. By combining severity-based thresholds, custom blocklists, batch processing, and integration with LLM applications, organizations can build robust safety systems. Regular monitoring and analytics help maintain effectiveness and identify emerging risks.
