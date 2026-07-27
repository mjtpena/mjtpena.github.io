---
title: "Claude Extended Thinking: Solving Complex Reasoning Problems"
author: Michael John Peña
draft: false
date: 2025-07-21
tags:
  - Claude
  - Anthropic
  - Reasoning
  - AI
  - Python

---

I wrote "Claude Extended Thinking: Solving Complex Reasoning Problems" to share practical, production-minded guidance on this topic.

## Enabling Extended Thinking

Extended thinking is activated through the API with specific parameters:

```python
import anthropic

client = anthropic.Anthropic()

def solve_complex_problem(problem: str, budget_tokens: int = 10000):
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=16000,
        thinking={
            "type": "enabled",
            "budget_tokens": budget_tokens
        },
        messages=[{
            "role": "user",
            "content": f"""Solve this problem step by step:

{problem}

Show your complete reasoning process."""
        }]
    )

    # Extract thinking and response
    thinking_content = None
    response_content = None

    for block in response.content:
        if block.type == "thinking":
            thinking_content = block.thinking
        elif block.type == "text":
            response_content = block.text

    return {
        "thinking": thinking_content,
        "response": response_content,
        "thinking_tokens": response.usage.thinking_tokens
    }
```

## Use Cases for Extended Thinking

Complex analysis tasks benefit significantly from extended thinking:

```python
# Financial analysis example
financial_problem = """
Analyze this investment scenario:
- Initial investment: $100,000
- Expected cash flows: Year 1: $25,000, Year 2: $35,000, Year 3: $50,000
- Discount rate: 8%
- Consider inflation at 3%
- Calculate NPV, IRR, and payback period
- Recommend whether to proceed with the investment
"""

result = solve_complex_problem(financial_problem, budget_tokens=15000)

# Code debugging example
debug_problem = """
This Python function should return the longest palindromic substring,
but it has bugs. Find and fix all issues:

def longest_palindrome(s):
    if len(s) < 2:
        return s
    start, max_len = 0, 1
    for i in range(len(s)):
        for j in range(i, len(s)):
            if s[i:j] == s[i:j:-1] and j - i > max_len:
                start, max_len = i, j - 1
    return s[start:start + max_len]
"""

result = solve_complex_problem(debug_problem)
```

## When to Use Extended Thinking

Enable extended thinking for mathematical proofs, code analysis, strategic planning, and multi-constraint optimization problems. For simple queries, standard responses are faster and more cost-effective.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
