---
title: "Prompt Engineering: Chain-of-Thought Techniques for Complex Reasoning"
author: Michael John Peña
draft: false
date: 2025-09-04
tags:
  - Prompt Engineering
  - LLM
  - Chain of Thought
  - AI
  - Best Practices

---

I wrote "Prompt Engineering: Chain-of-Thought Techniques for Complex Reasoning" to share practical, production-minded guidance on this topic.

## The Power of Explicit Reasoning

When faced with multi-step problems, LLMs perform better when prompted to reason step-by-step rather than jump directly to answers.

## Implementing Chain-of-Thought

```python
from openai import AzureOpenAI
import os

client = AzureOpenAI(
    api_key=os.environ["AZURE_OPENAI_KEY"],
    api_version="2024-06-01",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"]
)

def solve_with_chain_of_thought(problem: str) -> dict:
    """Solve complex problems using chain-of-thought prompting."""

    system_prompt = """You are a precise analytical assistant.
When solving problems:
1. First, identify what information is given
2. Then, determine what needs to be found
3. Break down the problem into smaller steps
4. Solve each step explicitly, showing your work
5. Verify your answer makes sense
6. Provide the final answer clearly marked"""

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Solve this step-by-step:\n\n{problem}"}
        ],
        temperature=0.1  # Low temperature for reasoning tasks
    )

    return {
        "reasoning": response.choices[0].message.content,
        "tokens_used": response.usage.total_tokens
    }

# Example: Complex business calculation
problem = """
A company's revenue grew 15% in Q1, declined 8% in Q2,
grew 22% in Q3, and grew 5% in Q4. If they started the
year with $10 million in quarterly revenue, what was
their total annual revenue?
"""

result = solve_with_chain_of_thought(problem)
```

## Few-Shot Chain-of-Thought

Providing examples of reasoning patterns further improves performance.

```python
def few_shot_cot(problem: str, examples: list[dict]) -> str:
    """Use few-shot examples to guide reasoning patterns."""

    messages = [
        {"role": "system", "content": "Solve problems step-by-step, showing all reasoning."}
    ]

    # Add examples
    for ex in examples:
        messages.append({"role": "user", "content": ex["problem"]})
        messages.append({"role": "assistant", "content": ex["solution"]})

    # Add the actual problem
    messages.append({"role": "user", "content": problem})

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        temperature=0.1
    )

    return response.choices[0].message.content
```

## When to Use CoT

Chain-of-thought works best for mathematical reasoning, logical deduction, multi-step analysis, and problems requiring synthesis of multiple facts. For simple factual queries, it adds unnecessary overhead.

The key insight: LLMs reason better when they write their reasoning explicitly, just like humans benefit from showing their work.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
