---
title: "Content Moderation Patterns for AI Applications"
author: Michael John Peña
draft: false
date: 2023-10-20
description: "Design patterns and best practices for implementing content moderation in AI-powered applications."
tags:
  - Content Moderation
  - Design Patterns
  - AI Safety
  - Architecture
  - AI
---

Content moderation for AI applications is more complex than traditional content moderation for user-generated content because the AI system itself is a content producer — you're moderating both user inputs and AI-generated outputs. The pattern I use for enterprise deployments: moderation at the API boundary (not embedded in application logic), so you can update moderation thresholds without deploying new application code. This means a separate content safety microservice or Azure AI Content Safety integration that wraps both the input path and output path of every LLM call. The operational consideration: moderation adds latency (another network call, another ML inference). For synchronous user-facing applications this matters; for async batch processing it typically doesn't. Caching moderation decisions for identical inputs helps with repeat queries; tiered moderation (fast lightweight classifier first, expensive full-featured classifier only for borderline cases) reduces latency at acceptable accuracy trade-offs.

## Introduction

Content moderation is essential for responsible AI deployment. This post covers design patterns and architectural approaches for implementing scalable, effective content moderation in AI applications.

## Moderation Architecture Patterns

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum

class ModerationDecision(Enum):
    APPROVE = "approve"
    REJECT = "reject"
    REVIEW = "review"
    MODIFY = "modify"

@dataclass
class ModerationResult:
    decision: ModerationDecision
    confidence: float
    reasons: List[str]
    modified_content: Optional[str] = None

class ContentModerator(ABC):
    """Abstract base class for content moderators"""

    @abstractmethod
    def moderate(self, content: str) -> ModerationResult:
        pass

class ChainOfResponsibilityPattern:
    """Chain of responsibility for moderation"""

    def __init__(self):
        self.handlers: List[ContentModerator] = []

    def add_handler(self, handler: ContentModerator):
        """Add handler to chain"""
        self.handlers.append(handler)
        return self

    def moderate(self, content: str) -> ModerationResult:
        """Process content through chain"""
        for handler in self.handlers:
            result = handler.moderate(content)

            # If rejected or needs review, stop chain
            if result.decision in [ModerationDecision.REJECT, ModerationDecision.REVIEW]:
                return result

            # If modified, continue with modified content
            if result.decision == ModerationDecision.MODIFY:
                content = result.modified_content

        return ModerationResult(
            decision=ModerationDecision.APPROVE,
            confidence=1.0,
            reasons=["Passed all moderation checks"]
        )
```

## Layered Moderation Pattern

```python
class KeywordFilter(ContentModerator):
    """Fast keyword-based filtering"""

    def __init__(self, blocked_words: List[str]):
        self.blocked_words = set(w.lower() for w in blocked_words)

    def moderate(self, content: str) -> ModerationResult:
        content_lower = content.lower()
        found_words = [
            word for word in self.blocked_words
            if word in content_lower
        ]

        if found_words:
            return ModerationResult(
                decision=ModerationDecision.REJECT,
                confidence=1.0,
                reasons=[f"Blocked words found: {', '.join(found_words)}"]
            )

        return ModerationResult(
            decision=ModerationDecision.APPROVE,
            confidence=1.0,
            reasons=["No blocked words found"]
        )

class RegexFilter(ContentModerator):
    """Pattern-based filtering using regex"""

    def __init__(self, patterns: Dict[str, str]):
        import re
        self.patterns = {
            name: re.compile(pattern, re.IGNORECASE)
            for name, pattern in patterns.items()
        }

    def moderate(self, content: str) -> ModerationResult:
        matches = []

        for name, pattern in self.patterns.items():
            if pattern.search(content):
                matches.append(name)

        if matches:
            return ModerationResult(
                decision=ModerationDecision.REVIEW,
                confidence=0.8,
                reasons=[f"Pattern matches: {', '.join(matches)}"]
            )

        return ModerationResult(
            decision=ModerationDecision.APPROVE,
            confidence=0.9,
            reasons=["No suspicious patterns found"]
        )

class MLClassifier(ContentModerator):
    """ML-based content classification"""

    def __init__(self, model, threshold: float = 0.8):
        self.model = model
        self.threshold = threshold

    def moderate(self, content: str) -> ModerationResult:
        # Get model predictions
        prediction = self.model.predict(content)

        if prediction["harmful_score"] > self.threshold:
            return ModerationResult(
                decision=ModerationDecision.REJECT,
                confidence=prediction["harmful_score"],
                reasons=[f"ML classifier flagged: {prediction['category']}"]
            )

        if prediction["harmful_score"] > self.threshold * 0.7:
            return ModerationResult(
                decision=ModerationDecision.REVIEW,
                confidence=prediction["harmful_score"],
                reasons=[f"ML classifier uncertain: {prediction['category']}"]
            )

        return ModerationResult(
            decision=ModerationDecision.APPROVE,
            confidence=1 - prediction["harmful_score"],
            reasons=["ML classifier approved"]
        )

class LayeredModerationSystem:
    """Multi-layer moderation with fast path"""

    def __init__(self):
        # Layer 1: Fast, rule-based
        self.keyword_filter = KeywordFilter([
            "spam", "scam", "hack"
        ])

        # Layer 2: Pattern matching
        self.regex_filter = RegexFilter({
            "email_solicitation": r"send.*email.*password",
            "phone_number": r"\d{3}[-.]?\d{3}[-.]?\d{4}",
            "credit_card": r"\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}"
        })

        # Layer 3: ML-based (heavier)
        # self.ml_classifier = MLClassifier(model)

    def moderate(self, content: str) -> ModerationResult:
        """Moderate through layers, short-circuit on rejection"""
        # Layer 1: Keyword filter (fastest)
        result = self.keyword_filter.moderate(content)
        if result.decision == ModerationDecision.REJECT:
            return result

        # Layer 2: Regex patterns
        result = self.regex_filter.moderate(content)
        if result.decision in [ModerationDecision.REJECT, ModerationDecision.REVIEW]:
            return result

        # Layer 3: ML classifier (only if passed previous layers)
        # result = self.ml_classifier.moderate(content)

        return result

# Usage
moderation_system = LayeredModerationSystem()
result = moderation_system.moderate("This is a test message")
print(f"Decision: {result.decision.value}")
```

## Async Moderation Pattern

```python
import asyncio
from typing import Callable, Awaitable

class AsyncModerationPipeline:
    """Asynchronous moderation for high throughput"""

    def __init__(self):
        self.sync_filters: List[ContentModerator] = []
        self.async_filters: List[Callable[[str], Awaitable[ModerationResult]]] = []

    def add_sync_filter(self, filter: ContentModerator):
        """Add synchronous filter"""
        self.sync_filters.append(filter)
        return self

    def add_async_filter(self, filter: Callable):
        """Add asynchronous filter"""
        self.async_filters.append(filter)
        return self

    async def moderate(self, content: str) -> ModerationResult:
        """Moderate content asynchronously"""
        # Run sync filters first (fast path)
        for filter in self.sync_filters:
            result = filter.moderate(content)
            if result.decision == ModerationDecision.REJECT:
                return result

        # Run async filters in parallel
        if self.async_filters:
            tasks = [filter(content) for filter in self.async_filters]
            results = await asyncio.gather(*tasks)

            # Aggregate results
            for result in results:
                if result.decision == ModerationDecision.REJECT:
                    return result

            # Check for any review needed
            review_results = [r for r in results if r.decision == ModerationDecision.REVIEW]
            if review_results:
                return ModerationResult(
                    decision=ModerationDecision.REVIEW,
                    confidence=min(r.confidence for r in review_results),
                    reasons=[r for result in review_results for r in result.reasons]
                )

        return ModerationResult(
            decision=ModerationDecision.APPROVE,
            confidence=1.0,
            reasons=["All filters passed"]
        )

    async def moderate_batch(self, contents: List[str]) -> List[ModerationResult]:
        """Moderate multiple items in parallel"""
        tasks = [self.moderate(content) for content in contents]
        return await asyncio.gather(*tasks)

# Example async filter
async def external_api_filter(content: str) -> ModerationResult:
    """Call external moderation API"""
    # Simulate API call
    await asyncio.sleep(0.1)
    return ModerationResult(
        decision=ModerationDecision.APPROVE,
        confidence=0.95,
        reasons=["External API approved"]
    )

# Usage
async def main():
    pipeline = AsyncModerationPipeline()
    pipeline.add_sync_filter(KeywordFilter(["spam"]))
    pipeline.add_async_filter(external_api_filter)

    result = await pipeline.moderate("Test content")
    print(f"Decision: {result.decision.value}")

# asyncio.run(main())
```

## Human-in-the-Loop Pattern

```python
from datetime import datetime
import uuid

@dataclass
class ReviewItem:
    id: str
    content: str
    automated_result: ModerationResult
    created_at: datetime
    priority: int
    status: str = "pending"
    reviewer: Optional[str] = None
    final_decision: Optional[ModerationDecision] = None

class HumanReviewQueue:
    """Queue for human review of flagged content"""

    def __init__(self):
        self.queue: Dict[str, ReviewItem] = {}

    def add_for_review(
        self,
        content: str,
        automated_result: ModerationResult,
        priority: int = 5
    ) -> str:
        """Add item to review queue"""
        item_id = str(uuid.uuid4())
        item = ReviewItem(
            id=item_id,
            content=content,
            automated_result=automated_result,
            created_at=datetime.now(),
            priority=priority
        )
        self.queue[item_id] = item
        return item_id

    def get_next_item(self, reviewer: str) -> Optional[ReviewItem]:
        """Get next item for review"""
        pending = [
            item for item in self.queue.values()
            if item.status == "pending"
        ]

        if not pending:
            return None

        # Sort by priority (higher first) and age (older first)
        pending.sort(key=lambda x: (-x.priority, x.created_at))

        item = pending[0]
        item.status = "in_review"
        item.reviewer = reviewer
        return item

    def submit_review(
        self,
        item_id: str,
        decision: ModerationDecision,
        notes: str = ""
    ) -> bool:
        """Submit human review decision"""
        if item_id not in self.queue:
            return False

        item = self.queue[item_id]
        item.status = "reviewed"
        item.final_decision = decision
        return True

    def get_stats(self) -> Dict:
        """Get queue statistics"""
        items = list(self.queue.values())

        pending = sum(1 for i in items if i.status == "pending")
        in_review = sum(1 for i in items if i.status == "in_review")
        reviewed = sum(1 for i in items if i.status == "reviewed")

        # Calculate agreement rate
        reviewed_items = [i for i in items if i.status == "reviewed"]
        agreements = sum(
            1 for i in reviewed_items
            if i.final_decision == i.automated_result.decision
        )

        return {
            "total": len(items),
            "pending": pending,
            "in_review": in_review,
            "reviewed": reviewed,
            "agreement_rate": agreements / len(reviewed_items) if reviewed_items else 0
        }

class ModerationWithHITL:
    """Moderation system with human-in-the-loop"""

    def __init__(self):
        self.automated = LayeredModerationSystem()
        self.review_queue = HumanReviewQueue()
        self.review_threshold = 0.7

    def moderate(self, content: str) -> Dict:
        """Moderate with potential human review"""
        result = self.automated.moderate(content)

        if result.decision == ModerationDecision.REVIEW:
            # Add to human review queue
            review_id = self.review_queue.add_for_review(
                content=content,
                automated_result=result,
                priority=self._calculate_priority(result)
            )

            return {
                "decision": "pending_review",
                "review_id": review_id,
                "automated_result": result
            }

        return {
            "decision": result.decision.value,
            "confidence": result.confidence,
            "reasons": result.reasons
        }

    def _calculate_priority(self, result: ModerationResult) -> int:
        """Calculate review priority"""
        # Higher priority for lower confidence
        if result.confidence < 0.5:
            return 10
        elif result.confidence < 0.7:
            return 7
        else:
            return 5
```

## Feedback Loop Pattern

```python
class FeedbackCollector:
    """Collect feedback on moderation decisions"""

    def __init__(self):
        self.feedback_log = []

    def log_feedback(
        self,
        content: str,
        automated_decision: ModerationDecision,
        correct_decision: ModerationDecision,
        source: str = "user"
    ):
        """Log feedback on moderation decision"""
        self.feedback_log.append({
            "timestamp": datetime.now(),
            "content_hash": hash(content),
            "automated": automated_decision.value,
            "correct": correct_decision.value,
            "was_correct": automated_decision == correct_decision,
            "source": source
        })

    def get_accuracy_report(self) -> Dict:
        """Generate accuracy report from feedback"""
        if not self.feedback_log:
            return {"error": "No feedback collected"}

        total = len(self.feedback_log)
        correct = sum(1 for f in self.feedback_log if f["was_correct"])

        # Breakdown by decision type
        by_automated = {}
        for f in self.feedback_log:
            auto = f["automated"]
            if auto not in by_automated:
                by_automated[auto] = {"total": 0, "correct": 0}
            by_automated[auto]["total"] += 1
            if f["was_correct"]:
                by_automated[auto]["correct"] += 1

        return {
            "total_feedback": total,
            "overall_accuracy": correct / total,
            "by_decision_type": {
                k: v["correct"] / v["total"] if v["total"] > 0 else 0
                for k, v in by_automated.items()
            },
            "false_positive_rate": self._calculate_fpr(),
            "false_negative_rate": self._calculate_fnr()
        }

    def _calculate_fpr(self) -> float:
        """Calculate false positive rate"""
        # Rejected when should be approved
        rejected_feedback = [
            f for f in self.feedback_log
            if f["automated"] == "reject"
        ]
        if not rejected_feedback:
            return 0.0

        false_positives = sum(
            1 for f in rejected_feedback
            if f["correct"] == "approve"
        )
        return false_positives / len(rejected_feedback)

    def _calculate_fnr(self) -> float:
        """Calculate false negative rate"""
        # Approved when should be rejected
        approved_feedback = [
            f for f in self.feedback_log
            if f["automated"] == "approve"
        ]
        if not approved_feedback:
            return 0.0

        false_negatives = sum(
            1 for f in approved_feedback
            if f["correct"] == "reject"
        )
        return false_negatives / len(approved_feedback)

class AdaptiveModerationSystem:
    """Moderation system that adapts based on feedback"""

    def __init__(self):
        self.base_system = LayeredModerationSystem()
        self.feedback = FeedbackCollector()
        self.adjustment_threshold = 0.1

    def moderate(self, content: str) -> ModerationResult:
        """Moderate with adaptive thresholds"""
        base_result = self.base_system.moderate(content)

        # Adjust based on feedback
        accuracy_report = self.feedback.get_accuracy_report()

        if "false_positive_rate" in accuracy_report:
            if accuracy_report["false_positive_rate"] > self.adjustment_threshold:
                # Too many false positives - be more lenient
                if base_result.decision == ModerationDecision.REJECT:
                    if base_result.confidence < 0.9:
                        return ModerationResult(
                            decision=ModerationDecision.REVIEW,
                            confidence=base_result.confidence,
                            reasons=base_result.reasons + ["Adjusted due to high FPR"]
                        )

        return base_result

    def process_feedback(
        self,
        content: str,
        automated_decision: ModerationDecision,
        correct_decision: ModerationDecision
    ):
        """Process user feedback"""
        self.feedback.log_feedback(
            content=content,
            automated_decision=automated_decision,
            correct_decision=correct_decision
        )
```

## Caching Pattern

```python
from functools import lru_cache
import hashlib

class CachedModerationSystem:
    """Moderation with caching for repeated content"""

    def __init__(self, base_system: ContentModerator, cache_size: int = 10000):
        self.base_system = base_system
        self.cache_size = cache_size
        self._cache = {}

    def _get_content_hash(self, content: str) -> str:
        """Generate hash for content"""
        return hashlib.sha256(content.encode()).hexdigest()

    def moderate(self, content: str) -> ModerationResult:
        """Moderate with caching"""
        content_hash = self._get_content_hash(content)

        # Check cache
        if content_hash in self._cache:
            cached = self._cache[content_hash]
            return ModerationResult(
                decision=cached["decision"],
                confidence=cached["confidence"],
                reasons=cached["reasons"] + ["(cached)"]
            )

        # Moderate
        result = self.base_system.moderate(content)

        # Cache result
        if len(self._cache) >= self.cache_size:
            # Simple eviction: remove oldest
            oldest_key = next(iter(self._cache))
            del self._cache[oldest_key]

        self._cache[content_hash] = {
            "decision": result.decision,
            "confidence": result.confidence,
            "reasons": result.reasons
        }

        return result

    def invalidate_cache(self):
        """Clear the cache"""
        self._cache.clear()

    def get_cache_stats(self) -> Dict:
        """Get cache statistics"""
        return {
            "cache_size": len(self._cache),
            "max_size": self.cache_size,
            "utilization": len(self._cache) / self.cache_size
        }
```

## Conclusion

Content moderation patterns provide structured approaches to building effective moderation systems. Key patterns include chain of responsibility for modular processing, layered filtering for efficiency, async pipelines for throughput, human-in-the-loop for complex cases, feedback loops for continuous improvement, and caching for performance. Combining these patterns creates robust, scalable moderation systems.
