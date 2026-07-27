---
title: "Responsible AI with Azure OpenAI: Building Ethical AI Systems"
author: Michael John Peña
draft: false
date: 2023-01-08
tags:
  - Azure
  - OpenAI
  - AI
  - Ethics
  - Responsible AI

---

I wrote "Responsible AI with Azure OpenAI: Building Ethical AI Systems" to share practical, production-minded guidance on this topic.

## Microsoft's Responsible AI Principles

Microsoft's Responsible AI framework guides Azure OpenAI Service:

1. **Fairness**: AI systems should treat all people fairly
2. **Reliability & Safety**: AI systems should perform reliably and safely
3. **Privacy & Security**: AI systems should be secure and respect privacy
4. **Inclusiveness**: AI systems should empower everyone
5. **Transparency**: AI systems should be understandable
6. **Accountability**: People should be accountable for AI systems

## Implementing Responsible AI

Here's a framework for implementing these principles:

```python
from dataclasses import dataclass
from typing import List, Optional, Dict, Any
from enum import Enum
import logging

class RiskLevel(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

@dataclass
class ResponsibleAIConfig:
    """Configuration for responsible AI deployment."""

    # Content filtering
    enable_content_filtering: bool = True
    content_filter_level: str = "medium"  # low, medium, high

    # Transparency
    disclose_ai_usage: bool = True
    log_all_interactions: bool = True

    # Human oversight
    require_human_review_threshold: RiskLevel = RiskLevel.HIGH
    escalation_contact: str = ""

    # Fairness
    bias_monitoring_enabled: bool = True
    demographic_parity_threshold: float = 0.8

    # Rate limiting for safety
    max_requests_per_user_per_hour: int = 100

class ResponsibleAIGuard:
    """Guard rails for responsible AI deployment."""

    def __init__(self, config: ResponsibleAIConfig):
        self.config = config
        self.logger = logging.getLogger("responsible_ai")

    def pre_request_check(
        self,
        prompt: str,
        user_id: str,
        context: Dict[str, Any]
    ) -> tuple[bool, Optional[str]]:
        """
        Check if request should proceed.
        Returns (should_proceed, reason_if_blocked)
        """

        # Check rate limits
        if not self._check_rate_limit(user_id):
            return False, "Rate limit exceeded"

        # Check for harmful content
        if self.config.enable_content_filtering:
            is_safe, category = self._check_content_safety(prompt)
            if not is_safe:
                self.logger.warning(
                    f"Blocked request from {user_id}: {category}"
                )
                return False, f"Content blocked: {category}"

        # Log interaction for transparency
        if self.config.log_all_interactions:
            self._log_interaction(user_id, prompt, "request")

        return True, None

    def post_response_check(
        self,
        response: str,
        user_id: str,
        context: Dict[str, Any]
    ) -> tuple[str, bool]:
        """
        Check response and potentially modify or flag.
        Returns (processed_response, needs_human_review)
        """

        needs_review = False
        processed = response

        # Check response safety
        if self.config.enable_content_filtering:
            is_safe, category = self._check_content_safety(response)
            if not is_safe:
                processed = self._get_safe_fallback_response()
                self.logger.warning(
                    f"Response filtered for {user_id}: {category}"
                )

        # Assess risk level
        risk_level = self._assess_risk_level(response, context)
        if risk_level.value >= self.config.require_human_review_threshold.value:
            needs_review = True
            self.logger.info(
                f"Flagged for human review: risk={risk_level.value}"
            )

        # Add AI disclosure if configured
        if self.config.disclose_ai_usage:
            processed = self._add_ai_disclosure(processed)

        # Log response
        if self.config.log_all_interactions:
            self._log_interaction(user_id, processed, "response")

        return processed, needs_review

    def _check_content_safety(self, text: str) -> tuple[bool, Optional[str]]:
        """Check text for harmful content categories."""
        # In production, use Azure Content Safety API
        harmful_patterns = {
            "hate_speech": ["hate", "discriminate"],
            "violence": ["kill", "attack", "weapon"],
            "self_harm": ["suicide", "self-harm"],
            "sexual": ["explicit content patterns"]
        }

        text_lower = text.lower()
        for category, patterns in harmful_patterns.items():
            for pattern in patterns:
                if pattern in text_lower:
                    return False, category

        return True, None

    def _assess_risk_level(
        self,
        response: str,
        context: Dict[str, Any]
    ) -> RiskLevel:
        """Assess risk level of response."""
        # Risk indicators
        high_risk_indicators = [
            "medical advice",
            "legal advice",
            "financial recommendation",
            "personal data"
        ]

        response_lower = response.lower()

        for indicator in high_risk_indicators:
            if indicator in response_lower:
                return RiskLevel.HIGH

        if len(response) > 2000:
            return RiskLevel.MEDIUM

        return RiskLevel.LOW

    def _check_rate_limit(self, user_id: str) -> bool:
        """Check if user is within rate limits."""
        # Implement with Redis or similar
        return True

    def _get_safe_fallback_response(self) -> str:
        """Return safe fallback when content is filtered."""
        return "I'm not able to provide that information. Please rephrase your question or contact support for assistance."

    def _add_ai_disclosure(self, response: str) -> str:
        """Add AI-generated content disclosure."""
        return f"{response}\n\n---\n*This response was generated by AI and may contain errors. Please verify important information.*"

    def _log_interaction(
        self,
        user_id: str,
        content: str,
        interaction_type: str
    ):
        """Log interaction for audit and analysis."""
        self.logger.info(
            f"Interaction logged",
            extra={
                "user_id": user_id,
                "type": interaction_type,
                "content_length": len(content),
                "timestamp": datetime.utcnow().isoformat()
            }
        )
```

## Bias Detection and Mitigation

Monitor for bias in AI outputs:

```python
from collections import Counter
from typing import List, Dict
import numpy as np

class BiasMonitor:
    """Monitor AI outputs for potential bias."""

    def __init__(self):
        self.demographic_groups = [
            "male", "female", "non-binary",
            "young", "old",
            "asian", "black", "white", "hispanic"
        ]
        self.response_history: Dict[str, List[str]] = {
            group: [] for group in self.demographic_groups
        }

    def analyze_response(
        self,
        response: str,
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Analyze response for potential bias indicators."""

        analysis = {
            "sentiment_scores": self._analyze_sentiment(response),
            "length": len(response),
            "formality_score": self._analyze_formality(response),
            "detected_demographics": self._detect_demographic_references(response)
        }

        return analysis

    def calculate_demographic_parity(
        self,
        metric: str = "sentiment"
    ) -> Dict[str, float]:
        """
        Calculate demographic parity across groups.
        Returns parity scores (1.0 = perfect parity)
        """

        if metric == "sentiment":
            scores = {}
            for group, responses in self.response_history.items():
                if responses:
                    sentiments = [
                        self._analyze_sentiment(r)["positive"]
                        for r in responses
                    ]
                    scores[group] = np.mean(sentiments)

            if not scores:
                return {}

            max_score = max(scores.values())
            min_score = min(scores.values())

            # Parity ratio
            parity = min_score / max_score if max_score > 0 else 1.0

            return {
                "parity_ratio": parity,
                "group_scores": scores,
                "is_fair": parity >= 0.8  # 80% rule
            }

        return {}

    def _analyze_sentiment(self, text: str) -> Dict[str, float]:
        """Basic sentiment analysis."""
        # In production, use Azure Cognitive Services
        positive_words = ["good", "great", "excellent", "happy", "wonderful"]
        negative_words = ["bad", "poor", "terrible", "sad", "awful"]

        text_lower = text.lower()
        words = text_lower.split()

        positive_count = sum(1 for w in words if w in positive_words)
        negative_count = sum(1 for w in words if w in negative_words)
        total = positive_count + negative_count

        return {
            "positive": positive_count / total if total > 0 else 0.5,
            "negative": negative_count / total if total > 0 else 0.5
        }

    def _analyze_formality(self, text: str) -> float:
        """Analyze text formality (0=informal, 1=formal)."""
        formal_indicators = ["therefore", "however", "consequently", "regarding"]
        informal_indicators = ["gonna", "wanna", "hey", "cool", "awesome"]

        text_lower = text.lower()

        formal_count = sum(1 for i in formal_indicators if i in text_lower)
        informal_count = sum(1 for i in informal_indicators if i in text_lower)

        total = formal_count + informal_count
        return formal_count / total if total > 0 else 0.5

    def _detect_demographic_references(self, text: str) -> List[str]:
        """Detect demographic group references in text."""
        detected = []
        text_lower = text.lower()

        for group in self.demographic_groups:
            if group in text_lower:
                detected.append(group)

        return detected
```

## Human-in-the-Loop Implementation

For high-stakes decisions, include human oversight:

```python
from enum import Enum
import uuid
from datetime import datetime

class ReviewStatus(Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    MODIFIED = "modified"

@dataclass
class HumanReviewRequest:
    id: str
    original_response: str
    context: Dict[str, Any]
    risk_level: RiskLevel
    created_at: datetime
    status: ReviewStatus = ReviewStatus.PENDING
    reviewer: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    final_response: Optional[str] = None
    notes: Optional[str] = None

class HumanReviewQueue:
    """Queue for human review of AI responses."""

    def __init__(self):
        self.pending_reviews: Dict[str, HumanReviewRequest] = {}
        self.completed_reviews: List[HumanReviewRequest] = []

    def submit_for_review(
        self,
        response: str,
        context: Dict[str, Any],
        risk_level: RiskLevel
    ) -> str:
        """Submit response for human review."""
        review_id = str(uuid.uuid4())

        review = HumanReviewRequest(
            id=review_id,
            original_response=response,
            context=context,
            risk_level=risk_level,
            created_at=datetime.utcnow()
        )

        self.pending_reviews[review_id] = review

        # In production, send notification to reviewers
        self._notify_reviewers(review)

        return review_id

    def complete_review(
        self,
        review_id: str,
        status: ReviewStatus,
        reviewer: str,
        final_response: Optional[str] = None,
        notes: Optional[str] = None
    ):
        """Complete a human review."""
        if review_id not in self.pending_reviews:
            raise ValueError(f"Review {review_id} not found")

        review = self.pending_reviews.pop(review_id)
        review.status = status
        review.reviewer = reviewer
        review.reviewed_at = datetime.utcnow()
        review.final_response = final_response or review.original_response
        review.notes = notes

        self.completed_reviews.append(review)

        return review

    def get_pending_reviews(
        self,
        risk_level: Optional[RiskLevel] = None
    ) -> List[HumanReviewRequest]:
        """Get pending reviews, optionally filtered by risk level."""
        reviews = list(self.pending_reviews.values())

        if risk_level:
            reviews = [r for r in reviews if r.risk_level == risk_level]

        return sorted(reviews, key=lambda r: r.created_at)

    def _notify_reviewers(self, review: HumanReviewRequest):
        """Notify reviewers of new item."""
        # Implement email/Slack/Teams notification
        pass

# Usage with AI system
class ResponsibleAISystem:
    """Complete responsible AI system with human oversight."""

    def __init__(self, config: ResponsibleAIConfig):
        self.guard = ResponsibleAIGuard(config)
        self.review_queue = HumanReviewQueue()
        self.bias_monitor = BiasMonitor()

    async def process_request(
        self,
        prompt: str,
        user_id: str,
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Process request with full responsible AI pipeline."""

        # Pre-request checks
        should_proceed, block_reason = self.guard.pre_request_check(
            prompt, user_id, context
        )

        if not should_proceed:
            return {
                "status": "blocked",
                "reason": block_reason
            }

        # Generate response (would call Azure OpenAI here)
        raw_response = await self._generate_response(prompt)

        # Post-response checks
        processed_response, needs_review = self.guard.post_response_check(
            raw_response, user_id, context
        )

        # Bias monitoring
        bias_analysis = self.bias_monitor.analyze_response(
            processed_response, context
        )

        # Human review if needed
        if needs_review:
            review_id = self.review_queue.submit_for_review(
                processed_response,
                context,
                RiskLevel.HIGH
            )

            return {
                "status": "pending_review",
                "review_id": review_id,
                "message": "Response is being reviewed by a human."
            }

        return {
            "status": "success",
            "response": processed_response,
            "bias_analysis": bias_analysis
        }

    async def _generate_response(self, prompt: str) -> str:
        """Generate response from Azure OpenAI."""
        # Implementation here
        pass
```

## Transparency and Documentation

Create model cards and documentation:

```python
@dataclass
class ModelCard:
    """Documentation for AI model deployment."""

    model_name: str
    version: str
    deployment_date: datetime

    # Model details
    description: str
    intended_use: List[str]
    out_of_scope_uses: List[str]

    # Performance
    evaluation_metrics: Dict[str, float]
    known_limitations: List[str]

    # Ethical considerations
    ethical_considerations: List[str]
    bias_evaluation: Dict[str, Any]

    # Maintenance
    maintainer: str
    update_frequency: str
    feedback_channel: str

# Example model card
customer_support_model = ModelCard(
    model_name="Customer Support Assistant",
    version="1.0.0",
    deployment_date=datetime(2023, 1, 8),
    description="AI assistant for answering customer support queries about our products.",
    intended_use=[
        "Answering product questions",
        "Providing troubleshooting guidance",
        "Directing users to relevant documentation"
    ],
    out_of_scope_uses=[
        "Medical advice",
        "Legal advice",
        "Financial recommendations",
        "Personal counseling"
    ],
    evaluation_metrics={
        "accuracy": 0.92,
        "user_satisfaction": 0.87,
        "escalation_rate": 0.15
    },
    known_limitations=[
        "May not have information about products released after training",
        "Cannot access user account information",
        "May occasionally provide outdated pricing"
    ],
    ethical_considerations=[
        "Responses are reviewed for bias monthly",
        "Sensitive topics are escalated to human agents",
        "User data is not used for training"
    ],
    bias_evaluation={
        "demographic_parity": 0.91,
        "equal_opportunity": 0.88
    },
    maintainer="AI Ethics Team",
    update_frequency="Monthly review, quarterly retraining",
    feedback_channel="ai-feedback@company.com"
)
```

## Best Practices Summary

1. **Always filter content**: Use Azure's content filtering by default
2. **Log everything**: Maintain audit trails for accountability
3. **Monitor for bias**: Regularly check outputs across demographics
4. **Include human oversight**: Especially for high-stakes decisions
5. **Be transparent**: Disclose AI usage, document limitations
6. **Have escalation paths**: Know when to involve humans
7. **Regular audits**: Review and update AI systems regularly

## Resources

- [Microsoft Responsible AI](https://www.microsoft.com/ai/responsible-ai)
- [Azure AI Content Safety](https://azure.microsoft.com/services/cognitive-services/content-safety/)
- [AI Fairness Checklist](https://www.microsoft.com/research/project/ai-fairness-checklist/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
