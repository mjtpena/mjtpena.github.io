---
title: "Optimizing AI Cost Per Query"
author: Michael John Peña
draft: false
date: 2026-01-18
tags:
  - AI
  - Cost
  - Optimization
  - Azure

---

I wrote "Optimizing AI Cost Per Query" to share practical, production-minded guidance on this topic.

## The Baseline

Started at $0.08 per query. Too high for our user volume.

## Optimization 1: Model Selection

Switched simple queries from GPT-4o to GPT-4o-mini.

**Savings: 40%**

## Optimization 2: Aggressive Caching

```python
from functools import lru_cache
import hashlib

@lru_cache(maxsize=1000)
def cached_embedding(text):
    return get_embedding(text)

def cache_key(query):
    return hashlib.sha256(query.encode()).hexdigest()
```

**Savings: 20%**

## Optimization 3: Context Compression

Send only relevant context, not entire documents.

**Savings: 15%**

## Optimization 4: Batch Processing

Group similar queries when possible.

**Savings: 10%**

## Final Cost

$0.024 per query. 70% reduction.

## The Lesson

Most AI costs come from waste. Cut the waste first.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
