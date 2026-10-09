---
title: "LLM Observability: What Actually Matters"
description: "Latency: P50, P95, P99 response times Cost: Per query, per user, per day Quality: Response relevance, accuracy"
author: Michael John Peña
draft: false
date: 2026-01-16
tags:
  - AI
  - Observability
  - LLM
  - Production
---

## What to Track

**Latency:** P50, P95, P99 response times

**Cost:** Per query, per user, per day

**Quality:** Response relevance, accuracy

**Errors:** Rate limits, failures, timeouts

## How to Track It

```python
import structlog

logger = structlog.get_logger()

def track_llm_call(func):
    async def wrapper(*args, **kwargs):
        start = time.time()
        
        try:
            result = await func(*args, **kwargs)
            
            logger.info("llm_call",
                model=result.model,
                tokens=result.usage.total_tokens,
                latency=time.time() - start,
                cost=calculate_cost(result.usage)
            )
            
            return result
        except Exception as e:
            logger.error("llm_call_failed",
                error=str(e),
                latency=time.time() - start
            )
            raise
    
    return wrapper
```

## What to Alert On

- Latency > 5 seconds (P95)
- Error rate > 5%
- Daily cost > budget threshold
- Quality score drop > 10%

## Tools That Help

- Application Insights for Azure
- Datadog for multi-cloud
- Custom dashboards with Grafana
- LangSmith for prompt tracking

## The Key Insight

You can't improve what you don't measure. Start logging everything from day one.
