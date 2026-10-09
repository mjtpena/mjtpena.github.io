---
title: "AI Project Learnings: What Actually Works in Practice"
description: "These lessons were learned the hard way. Hopefully, they save you some pain."
author: Michael John Peña
draft: false
date: 2024-12-05
tags:
  - AI
  - Project Management
  - Lessons Learned
  - Best Practices
  - Enterprise
---

## Lesson 1: Data Quality Trumps Model Sophistication

```python
# What we thought would matter most:
initial_priorities = [
    "Latest model (GPT-4o vs GPT-4)",
    "Complex prompt engineering",
    "Fine-tuning",
    "Advanced RAG techniques"
]

# What actually mattered most:
actual_priorities = [
    "Clean, accurate source data",
    "Consistent data formatting",
    "Complete context in prompts",
    "Clear, simple instructions"
]

# Real example:
# Project A: GPT-4, complex prompts, dirty data -> 65% accuracy
# Project B: GPT-3.5, simple prompts, clean data -> 89% accuracy

lesson = "Fix your data before upgrading your model"
```

## Lesson 2: Start with the Unhappy Path

```python
class RobustAISystem:
    """Design for failure from the start."""

    def process_request(self, request: dict) -> dict:
        try:
            # Validate input
            validated = self.validate_input(request)
            if not validated.success:
                return self.handle_validation_error(validated.errors)

            # Rate limit check
            if not self.check_rate_limit(request.user_id):
                return self.handle_rate_limit()

            # Call AI with timeout
            response = self.call_ai_with_timeout(
                validated.data,
                timeout_seconds=30
            )

            # Validate output
            if not self.validate_output(response):
                return self.handle_invalid_output(response)

            # Content filter
            if self.content_filter.is_blocked(response):
                return self.handle_blocked_content()

            return {"success": True, "response": response}

        except TimeoutError:
            return self.handle_timeout()
        except RateLimitError:
            return self.handle_external_rate_limit()
        except Exception as e:
            self.log_error(e)
            return self.handle_generic_error()

# Lesson: 40% of our code handles error cases
# This prevents 90% of production incidents
```

## Lesson 3: Evaluation is Non-Negotiable

```python
class AIProjectEvaluation:
    """What we learned about testing AI systems."""

    evaluation_mistakes = [
        "Tested only on happy path examples",
        "Used same data for development and evaluation",
        "Didn't test edge cases",
        "Evaluated too late in the process",
        "Didn't involve domain experts"
    ]

    evaluation_framework = {
        "unit_tests": {
            "purpose": "Basic functionality",
            "examples": [
                "Does it handle empty input?",
                "Does it respect token limits?",
                "Does it return expected format?"
            ]
        },

        "golden_set": {
            "purpose": "Accuracy on known answers",
            "size": "50-100 examples",
            "maintenance": "Update monthly",
            "threshold": "Must pass 90%+"
        },

        "adversarial_tests": {
            "purpose": "Edge cases and attacks",
            "examples": [
                "Prompt injection attempts",
                "Malformed inputs",
                "Out-of-domain requests"
            ]
        },

        "human_evaluation": {
            "purpose": "Quality assessment",
            "frequency": "Weekly sample review",
            "reviewers": "Domain experts"
        }
    }

    def setup_continuous_evaluation(self):
        """Run evaluations on every change."""
        return """
        CI Pipeline:
        1. Run golden set tests (must pass)
        2. Run adversarial tests (must pass)
        3. Sample human review (weekly)
        4. Monitor production metrics (continuous)
        """
```

## Lesson 4: Users Need Guardrails, Not Restrictions

```python
# What didn't work: Heavy restrictions
restricted_approach = {
    "allowed_topics": ["only pre-approved questions"],
    "result": "Users stopped using the system",
    "adoption": "15%"
}

# What worked: Smart guardrails
guardrails_approach = {
    "approach": "Allow most requests, protect against harm",
    "guardrails": [
        "Content filtering for harmful content",
        "PII detection and redaction",
        "Query limits to prevent abuse",
        "Audit logging for accountability"
    ],
    "result": "Users felt empowered but safe",
    "adoption": "78%"
}

# Key insight:
# Trust users but verify outputs
# Don't prevent usage, prevent harm
```

## Lesson 5: Prompt Engineering is Iterative

```python
prompt_evolution = {
    "v1": {
        "prompt": "Answer the user's question.",
        "issues": ["Too vague", "Inconsistent format", "Hallucinations"]
    },

    "v2": {
        "prompt": """Answer the user's question based on the context provided.
        If you don't know, say so.""",
        "issues": ["Still hallucinated", "No structure"]
    },

    "v3": {
        "prompt": """You are a customer service assistant for Contoso.

        CONTEXT:
        {context}

        RULES:
        1. Only answer based on the context above
        2. If the answer isn't in the context, say "I don't have information about that"
        3. Always be professional and helpful
        4. Never make up information

        QUESTION: {question}

        ANSWER:""",
        "issues": ["Better but still occasional issues"]
    },

    "v4": {
        "prompt": """<system>
        You are a customer service assistant for Contoso.
        You help customers with product questions and support issues.
        </system>

        <context>
        {context}
        </context>

        <rules>
        - Only use information from the context above
        - If information isn't available, say "I'll need to connect you with a specialist for that question"
        - Format responses with clear sections when appropriate
        - Include relevant product names and numbers from context
        - Never speculate or make assumptions
        </rules>

        <examples>
        Q: What's the return policy?
        A: Based on our policy, you can return items within 30 days of purchase...

        Q: What's the weather like?
        A: I'll need to connect you with a specialist for that question. I'm here to help with Contoso products and services.
        </examples>

        Customer question: {question}""",
        "result": "92% accuracy, consistent format"
    }
}

lesson = "Expect 5-10 prompt iterations minimum"
```

## Lesson 6: Latency Matters More Than You Think

```python
latency_lessons = {
    "user_perception": {
        "under_1s": "Feels instant, high satisfaction",
        "1_3s": "Acceptable, slight impatience",
        "3_5s": "Noticeable delay, reduced usage",
        "over_5s": "Users abandon or complain"
    },

    "optimizations_that_worked": [
        {
            "technique": "Streaming responses",
            "impact": "Perceived 3x faster",
            "implementation": "Enable SSE, show tokens as generated"
        },
        {
            "technique": "Caching common queries",
            "impact": "50% of requests served in <100ms",
            "implementation": "Semantic cache with Redis"
        },
        {
            "technique": "Smaller model for simple tasks",
            "impact": "4x faster for 60% of requests",
            "implementation": "Route simple queries to GPT-4o-mini"
        },
        {
            "technique": "Parallel tool calls",
            "impact": "2x faster for multi-tool requests",
            "implementation": "Async execution of independent tools"
        }
    ],

    "mistake": "We initially optimized for accuracy only, users complained about speed"
}
```

## Lesson 7: Change Management is 50% of the Work

```python
change_management_reality = {
    "what_we_planned": {
        "technical_work": "80%",
        "change_management": "20%"
    },

    "what_actually_happened": {
        "technical_work": "50%",
        "change_management": "50%"
    },

    "change_management_activities": [
        "Training sessions (multiple rounds)",
        "Creating documentation and guides",
        "Addressing user concerns and fears",
        "Handling resistance from skeptics",
        "Celebrating early wins",
        "Gathering and acting on feedback",
        "Supporting struggling users",
        "Communicating updates and changes"
    ],

    "key_insight": "Technical success without adoption is failure"
}
```

## Lesson 8: Monitor Everything

```python
monitoring_essentials = {
    "must_have_metrics": [
        "Request volume and trends",
        "Response latency (p50, p95, p99)",
        "Error rates by type",
        "Token usage and costs",
        "User satisfaction signals"
    ],

    "should_have_metrics": [
        "Response quality scores",
        "Feedback ratings",
        "Abandonment rate",
        "Feature adoption",
        "A/B test results"
    ],

    "what_we_missed_initially": [
        "Didn't track which prompts led to poor responses",
        "Didn't monitor cost by use case",
        "Didn't correlate errors with input patterns",
        "Didn't track user journey through AI interactions"
    ],

    "monitoring_stack": {
        "infrastructure": "Azure Monitor / Application Insights",
        "ai_specific": "AI Foundry Tracing",
        "business": "Custom dashboards in Power BI",
        "alerting": "PagerDuty for critical, Teams for warnings"
    }
}
```

## Lesson 9: Plan for Model Updates

```python
model_update_lessons = {
    "surprise_1": "GPT-4 update changed response format, broke parsing",
    "surprise_2": "Performance regression on specific use case after update",
    "surprise_3": "Cost doubled when new version used more tokens",

    "best_practices": [
        "Pin to specific model versions in production",
        "Test new versions in staging before promotion",
        "Maintain evaluation suite that runs on version changes",
        "Have rollback plan ready",
        "Monitor closely after any model change"
    ],

    "model_versioning_strategy": """
    - Development: Latest model for exploration
    - Staging: Candidate version for testing
    - Production: Pinned version, updated quarterly
    - Rollback: Previous version ready
    """
}
```

## Key Takeaways

1. **Data > Models** - Clean data beats fancy models
2. **Plan for failure** - Error handling is half the code
3. **Evaluate continuously** - Test before, during, and after deployment
4. **Enable users** - Guardrails, not restrictions
5. **Iterate on prompts** - Expect many versions
6. **Optimize for speed** - Latency kills adoption
7. **Invest in change** - People matter as much as technology
8. **Monitor obsessively** - You can't improve what you don't measure
9. **Version everything** - Models change, be prepared

These lessons were learned the hard way. Hopefully, they save you some pain.

## Resources

- [Google AI Best Practices](https://ai.google/responsibility/best-practices/)
- [OpenAI Production Best Practices](https://platform.openai.com/docs/guides/production-best-practices)
- [Microsoft Responsible AI](https://www.microsoft.com/en-us/ai/responsible-ai)
