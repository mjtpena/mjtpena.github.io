---
title: "GPT-4 Is Here: Analyzing the Announcement"
description: "This isn't just incremental improvement - it's a capability threshold crossing. The AI capability curve just jumped. Time to adapt."
author: Michael John Pena
draft: false
date: 2023-03-14
tags:
  - OpenAI
  - AI
  - GPT-4
  - Azure
  - Machine Learning
---

## The Headlines

- **Multimodal**: GPT-4 accepts images as input (text output only for now)
- **Larger context**: 8K tokens standard, 32K tokens available
- **Better reasoning**: Passes bar exam in 90th percentile (GPT-3.5: 10th)
- **More reliable**: Significantly reduced hallucination in testing
- **Already in Bing**: Bing Chat has been running on GPT-4 since launch

## Benchmark Results

OpenAI tested GPT-4 on professional and academic exams:

| Exam | GPT-4 | GPT-3.5 |
|------|-------|---------|
| Bar Exam | 90th percentile | 10th percentile |
| LSAT | 88th percentile | 40th percentile |
| GRE Quantitative | 80th percentile | 25th percentile |
| AP Calculus BC | 43rd percentile | Failed |
| Codeforces | 392 rating | Below 5th percentile |

This isn't just incremental improvement - it's a capability threshold crossing.

## What This Means for Code

I've been testing GPT-4 on coding tasks. The improvement is substantial:

```python
# Task: Implement a rate limiter with sliding window

# GPT-4 Response (with explanation)
import time
from collections import deque
from threading import Lock

class SlidingWindowRateLimiter:
    """
    Token bucket rate limiter with sliding window.

    Uses a deque to track request timestamps, providing O(1) amortized
    operations for checking and recording requests.
    """

    def __init__(self, max_requests: int, window_seconds: float):
        """
        Args:
            max_requests: Maximum requests allowed in the window
            window_seconds: Size of the sliding window in seconds
        """
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests = deque()
        self.lock = Lock()

    def is_allowed(self) -> bool:
        """Check if a request is allowed and record it if so."""
        with self.lock:
            now = time.time()
            cutoff = now - self.window_seconds

            # Remove expired timestamps
            while self.requests and self.requests[0] < cutoff:
                self.requests.popleft()

            if len(self.requests) < self.max_requests:
                self.requests.append(now)
                return True

            return False

    def wait_time(self) -> float:
        """Return seconds to wait before next request is allowed."""
        with self.lock:
            if len(self.requests) < self.max_requests:
                return 0

            oldest = self.requests[0]
            return max(0, oldest + self.window_seconds - time.time())

# GPT-4 also provides usage example and tests
limiter = SlidingWindowRateLimiter(max_requests=100, window_seconds=60)

# Check before making request
if limiter.is_allowed():
    make_api_call()
else:
    wait = limiter.wait_time()
    print(f"Rate limited, wait {wait:.1f}s")
```

GPT-4's code is:
- More complete with docstrings and type hints
- Handles edge cases (thread safety, expired cleanup)
- Includes practical usage examples
- Better algorithmic choices

## Testing Vision Capabilities

The vision capabilities aren't publicly available yet (waitlist), but the demos are impressive:

```python
# Expected API format (based on demos)
response = openai.ChatCompletion.create(
    model="gpt-4-vision-preview",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "What's wrong with this architecture diagram?"},
                {
                    "type": "image_url",
                    "image_url": {"url": "https://example.com/architecture.png"}
                }
            ]
        }
    ]
)
```

Potential applications:
- Analyzing dashboards and charts
- Understanding system architecture diagrams
- Processing screenshots for debugging
- Extracting data from images

## Context Window Impact

The 32K token context is transformative:

```python
def analyze_large_document(document: str, question: str) -> str:
    """Analyze documents up to ~50 pages with GPT-4 32K."""

    # 32K tokens ≈ 24,000 words ≈ 50 pages
    if len(document.split()) > 24000:
        raise ValueError("Document too large for single-pass analysis")

    response = openai.ChatCompletion.create(
        model="gpt-4-32k",
        messages=[
            {
                "role": "system",
                "content": "You are a document analyst. Answer questions about the provided document accurately and cite relevant sections."
            },
            {
                "role": "user",
                "content": f"Document:\n{document}\n\nQuestion: {question}"
            }
        ],
        temperature=0.2
    )

    return response.choices[0].message.content

# Examples of what's now possible in a single pass:
# - Full legal contract analysis
# - Complete codebase review
# - Long-form technical documentation analysis
# - Extended conversation history
```

## Improved Reliability

GPT-4 is more factually grounded:

```python
# GPT-4 system prompt for factual tasks
FACTUAL_SYSTEM_PROMPT = """You are a helpful assistant that provides accurate information.

Rules:
1. If you're not certain about something, say so
2. Distinguish between facts and opinions
3. When appropriate, suggest how the user can verify information
4. If a question is outside your knowledge, acknowledge the limitation

Your knowledge cutoff is September 2021."""

def get_factual_response(question: str) -> dict:
    """Get response with confidence indication."""

    response = openai.ChatCompletion.create(
        model="gpt-4",
        messages=[
            {"role": "system", "content": FACTUAL_SYSTEM_PROMPT},
            {"role": "user", "content": f"{question}\n\nProvide your answer and indicate your confidence level (high/medium/low)."}
        ],
        temperature=0.1
    )

    return {
        "answer": response.choices[0].message.content,
        "model": "gpt-4",
        "note": "Verify important information from authoritative sources"
    }
```

## Pricing Reality

GPT-4 is significantly more expensive:

| Model | Input | Output |
|-------|-------|--------|
| GPT-3.5 Turbo | $0.002/1K | $0.002/1K |
| GPT-4 (8K) | $0.03/1K | $0.06/1K |
| GPT-4 (32K) | $0.06/1K | $0.12/1K |

GPT-4 is 15-60x more expensive than GPT-3.5. This changes architecture decisions:

```python
class CostAwareRouter:
    """Route requests based on cost-benefit analysis."""

    def __init__(self, gpt4_budget_daily: float = 100.0):
        self.gpt4_budget = gpt4_budget_daily
        self.gpt4_spent_today = 0.0

    def should_use_gpt4(
        self,
        task_complexity: str,
        estimated_tokens: int,
        quality_critical: bool = False
    ) -> bool:
        """Decide whether to use GPT-4."""

        # Always use GPT-4 for quality-critical tasks
        if quality_critical:
            return True

        # Check budget
        estimated_cost = (estimated_tokens / 1000) * 0.09  # Avg of input/output
        if self.gpt4_spent_today + estimated_cost > self.gpt4_budget:
            return False

        # Use GPT-4 for complex tasks
        complex_tasks = ["code_review", "legal_analysis", "architecture", "debugging"]
        if task_complexity in complex_tasks:
            self.gpt4_spent_today += estimated_cost
            return True

        # Default to GPT-3.5 for simple tasks
        return False
```

## Immediate Actions

1. **Request access**: GPT-4 API access is limited; join the waitlist
2. **Test your prompts**: Many prompts need adjustment for GPT-4
3. **Update cost models**: Budget for 30x cost increase for GPT-4 tasks
4. **Identify high-value use cases**: Where does quality matter most?
5. **Plan for Azure**: GPT-4 will come to Azure OpenAI

## What I'm Building

Starting today, I'm updating my applications to:

1. Route complex reasoning tasks to GPT-4
2. Keep simple tasks on GPT-3.5
3. Prepare for vision capabilities
4. Leverage longer context for document analysis

The AI capability curve just jumped. Time to adapt.

## Resources

- [GPT-4 Technical Report](https://openai.com/research/gpt-4)
- [GPT-4 API Documentation](https://platform.openai.com/docs/models/gpt-4)
- [GPT-4 System Card](https://cdn.openai.com/papers/gpt-4-system-card.pdf)
