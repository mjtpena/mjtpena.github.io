---
title: "Thinking Tokens: Understanding o1's Hidden Reasoning Process"
author: "Michael John Peña"
draft: false
date: 2024-09-06
tags: ["OpenAI", "o1", "Thinking Tokens", "AI", "LLM"]

---

I wrote "Thinking Tokens: Understanding o1's Hidden Reasoning Process" to share practical, production-minded guidance on this topic.

## What Are Thinking Tokens?

When o1 processes a request, it generates two types of tokens:
1. **Thinking tokens**: Internal reasoning (not shown to users)
2. **Output tokens**: The visible response

```python
from openai import OpenAI

client = OpenAI()

response = client.chat.completions.create(
    model="o1-preview",
    messages=[{
        "role": "user",
        "content": "What's the probability of rolling exactly two 6s in five dice rolls?"
    }],
    max_completion_tokens=4096
)

# Analyze token usage
usage = response.usage
print(f"Input tokens: {usage.prompt_tokens}")
print(f"Output tokens: {usage.completion_tokens}")
print(f"Reasoning tokens: {usage.completion_tokens_details.reasoning_tokens}")

# Reasoning tokens are part of completion_tokens but charged differently
visible_output_tokens = usage.completion_tokens - usage.completion_tokens_details.reasoning_tokens
print(f"Visible output tokens: {visible_output_tokens}")
```

## The Thinking Process Visualized

```python
def visualize_thinking_ratio(response) -> dict:
    """
    Visualize how much thinking went into a response
    """
    usage = response.usage
    reasoning = usage.completion_tokens_details.reasoning_tokens
    total_completion = usage.completion_tokens
    visible = total_completion - reasoning

    thinking_ratio = reasoning / total_completion if total_completion > 0 else 0

    # Create a visual bar
    bar_length = 50
    thinking_bar = int(bar_length * thinking_ratio)
    output_bar = bar_length - thinking_bar

    visual = f"[{'#' * thinking_bar}{'.' * output_bar}]"

    return {
        "reasoning_tokens": reasoning,
        "visible_tokens": visible,
        "thinking_ratio": f"{thinking_ratio:.1%}",
        "visualization": visual,
        "interpretation": interpret_ratio(thinking_ratio)
    }

def interpret_ratio(ratio: float) -> str:
    if ratio > 0.9:
        return "Heavy reasoning - complex problem"
    elif ratio > 0.7:
        return "Significant reasoning - moderate complexity"
    elif ratio > 0.5:
        return "Balanced reasoning and output"
    elif ratio > 0.3:
        return "Light reasoning - straightforward problem"
    else:
        return "Minimal reasoning - simple task"
```

## Thinking Tokens and Cost

```python
def calculate_o1_cost(input_tokens: int,
                       reasoning_tokens: int,
                       output_tokens: int) -> dict:
    """
    Calculate the full cost breakdown for o1 requests
    """
    # Pricing per million tokens
    INPUT_RATE = 15.00
    OUTPUT_RATE = 60.00  # Both reasoning and output

    input_cost = (input_tokens / 1_000_000) * INPUT_RATE
    reasoning_cost = (reasoning_tokens / 1_000_000) * OUTPUT_RATE
    output_cost = (output_tokens / 1_000_000) * OUTPUT_RATE

    total = input_cost + reasoning_cost + output_cost

    return {
        "input_cost": f"${input_cost:.4f}",
        "reasoning_cost": f"${reasoning_cost:.4f}",
        "output_cost": f"${output_cost:.4f}",
        "total_cost": f"${total:.4f}",
        "reasoning_percentage": f"{(reasoning_cost/total)*100:.1f}%" if total > 0 else "0%"
    }

# Example: A complex coding problem
# Input: 500 tokens, Reasoning: 3000 tokens, Output: 1000 tokens
cost = calculate_o1_cost(500, 3000, 1000)
print(cost)
# Reasoning often dominates the cost!
```

## Controlling Thinking with max_completion_tokens

```python
def optimize_thinking_budget(problem: str, budget: str = "standard") -> dict:
    """
    Adjust thinking budget based on problem complexity
    """
    budgets = {
        "minimal": 2048,   # Quick answers
        "standard": 4096,  # Normal problems
        "extended": 8192,  # Complex reasoning
        "maximum": 16384   # Very complex problems
    }

    max_tokens = budgets.get(budget, 4096)

    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{"role": "user", "content": problem}],
        max_completion_tokens=max_tokens
    )

    return {
        "budget": budget,
        "max_tokens": max_tokens,
        "used_tokens": response.usage.completion_tokens,
        "reasoning_tokens": response.usage.completion_tokens_details.reasoning_tokens,
        "response": response.choices[0].message.content
    }

# For simple problems, limit the thinking budget
simple_result = optimize_thinking_budget(
    "What's 15% of 200?",
    budget="minimal"
)

# For complex problems, allow extended thinking
complex_result = optimize_thinking_budget(
    "Design a distributed consensus algorithm for a 1000-node cluster",
    budget="maximum"
)
```

## Monitoring Thinking Patterns

```python
import statistics
from typing import List

class ThinkingAnalyzer:
    """Track and analyze thinking patterns across requests"""

    def __init__(self):
        self.history: List[dict] = []

    def record(self, response, task_type: str):
        usage = response.usage
        reasoning = usage.completion_tokens_details.reasoning_tokens

        self.history.append({
            "task_type": task_type,
            "reasoning_tokens": reasoning,
            "total_tokens": usage.completion_tokens,
            "ratio": reasoning / usage.completion_tokens
        })

    def get_stats(self, task_type: str = None) -> dict:
        data = self.history
        if task_type:
            data = [h for h in self.history if h["task_type"] == task_type]

        if not data:
            return {"error": "No data available"}

        ratios = [d["ratio"] for d in data]
        reasoning_tokens = [d["reasoning_tokens"] for d in data]

        return {
            "count": len(data),
            "avg_reasoning_ratio": statistics.mean(ratios),
            "avg_reasoning_tokens": statistics.mean(reasoning_tokens),
            "max_reasoning_tokens": max(reasoning_tokens),
            "min_reasoning_tokens": min(reasoning_tokens)
        }

# Usage
analyzer = ThinkingAnalyzer()
# Record responses over time...
# analyzer.record(response, "code_review")
# stats = analyzer.get_stats("code_review")
```

## Key Takeaways

1. **Thinking tokens are the real cost driver** - More complex problems = more thinking = higher cost
2. **You can't see the thinking** - Only the final output is visible
3. **Budget wisely** - Use `max_completion_tokens` to control costs
4. **Monitor patterns** - Track thinking ratios to optimize model selection

Understanding thinking tokens helps you make informed decisions about when o1's extended reasoning is worth the investment.

