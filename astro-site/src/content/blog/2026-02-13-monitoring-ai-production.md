---
title: "Monitoring AI Applications in Production"
author: Michael John Peña
draft: false
date: 2026-02-13
tags:
  - AI
  - DevOps
  - Monitoring
  - Azure

---

I wrote "Monitoring AI Applications in Production" to share practical, production-minded guidance on this topic.

This is how most AI deployments start. Here's how to fix it.

## Why AI Monitoring Is Different

Traditional apps: request comes in, response goes out. Monitor latency, errors, throughput. Done.

AI apps: request comes in, LLM generates something unpredictable, response goes out. The response might be wrong, harmful, or irrelevant—and your monitoring won't catch it because there's no error code for "bad answer."

## The Four Layers of AI Monitoring

### Layer 1: Infrastructure

The basics. These are the same as any application.

```python
# Track in Application Insights or your APM of choice
metrics = {
    "request_count": counter,
    "response_latency_ms": histogram,
    "error_rate": gauge,
    "active_connections": gauge
}
```

If the app is down, nothing else matters. Monitor infrastructure first.

### Layer 2: LLM-Specific Metrics

```python
def track_llm_call(response):
    metrics.record({
        "model": response.model,
        "prompt_tokens": response.usage.prompt_tokens,
        "completion_tokens": response.usage.completion_tokens,
        "total_tokens": response.usage.total_tokens,
        "latency_ms": response.response_time,
        "finish_reason": response.choices[0].finish_reason,
        "estimated_cost": calculate_cost(response.usage)
    })
```

Track tokens, costs, and latency per model. You'll want this when the bill arrives.

### Layer 3: Quality Metrics

This is where it gets interesting.

```python
def track_response_quality(input_text, output_text, user_feedback=None):
    metrics.record({
        "response_length": len(output_text),
        "contains_refusal": detect_refusal(output_text),
        "safety_score": content_safety_check(output_text),
        "relevance_score": quick_relevance_check(input_text, output_text),
        "user_thumbs_up": user_feedback == "positive",
        "user_thumbs_down": user_feedback == "negative"
    })
```

Automated quality checks catch obvious problems. User feedback catches the subtle ones.

### Layer 4: Business Metrics

```python
def track_business_impact():
    metrics.record({
        "tasks_completed_with_ai": count,
        "tasks_completed_without_ai": count,
        "ai_suggestions_accepted": rate,
        "ai_suggestions_rejected": rate,
        "time_saved_estimate": duration
    })
```

If AI isn't improving business outcomes, the technical metrics don't matter.

## Alerting Strategy

**Immediate alerts (page someone):**

- Error rate > 5%
- Latency > 30 seconds
- Safety filter triggered > 10 times in an hour
- Cost spike > 200% of daily average

**Daily digest:**

- Quality score trends
- User feedback summary
- Cost breakdown by model/feature
- Top refused or failed queries

**Weekly review:**

- Random sample of conversations for human review
- Drift detection in response patterns
- Feature adoption metrics

## The Dashboard

Every AI app needs a dashboard with:

1. **Cost tracker** - Real-time spend vs budget
2. **Quality gauge** - Rolling average of quality scores
3. **User satisfaction** - Thumbs up/down ratio
4. **Latency distribution** - P50, P95, P99
5. **Safety alerts** - Content filter triggers

## Azure-Specific Tools

**Application Insights:** Custom metrics and distributed tracing for the full pipeline.

**Azure Monitor:** Alerts and dashboards.

**Content Safety API:** Built-in content filtering metrics.

**Azure OpenAI diagnostics:** Token usage and throttling metrics out of the box.

## The Minimum

If you can only do three things:

1. **Track cost** - Know what you're spending, daily
2. **Track quality** - Automated checks plus user feedback
3. **Log everything** - With PII redaction, so you can debug after the fact

Everything else is optimization. These three are survival.

## The Reality

You can't monitor AI quality the same way you monitor uptime. There's no binary "working/broken" for AI responses.

Accept the ambiguity. Build monitoring around it. Review regularly.

Your AI app is only as good as your ability to know when it's not good.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
