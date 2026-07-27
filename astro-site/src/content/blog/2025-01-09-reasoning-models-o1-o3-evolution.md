---
title: "Reasoning Models Evolution: From o1 to o3 and Beyond"
author: Michael John Peña
draft: false
date: 2025-01-09
tags:
  - AI
  - OpenAI
  - Reasoning Models
  - o1
  - o3
  - LLM

---

I wrote "Reasoning Models Evolution: From o1 to o3 and Beyond" to share practical, production-minded guidance on this topic.

## What Makes Reasoning Models Different?

Traditional LLMs generate responses token by token. Reasoning models add an explicit "thinking" phase:

```
Traditional: Input → Generate → Output
Reasoning:   Input → Think → Verify → Output
```

## Using o3 in Practice

```python
from openai import OpenAI

client = OpenAI()

# o3 for complex reasoning tasks
response = client.chat.completions.create(
    model="o3",
    messages=[
        {
            "role": "user",
            "content": """
            Design a data architecture for a multi-tenant SaaS platform that:
            1. Serves 10,000 tenants with varying data volumes
            2. Requires sub-second query performance
            3. Must comply with GDPR (data residency)
            4. Needs to support real-time analytics
            5. Budget constraint: $50K/month

            Provide a detailed architecture with trade-off analysis.
            """
        }
    ],
    reasoning_effort="high"  # Control thinking depth
)

print(response.choices[0].message.content)
```

## Reasoning Effort Levels

```python
# Low effort - quick reasoning for simpler problems
response = client.chat.completions.create(
    model="o3",
    messages=[{"role": "user", "content": "Calculate the total cost of 5 EC2 instances at $0.10/hour for 30 days"}],
    reasoning_effort="low"
)

# Medium effort - balanced for most tasks
response = client.chat.completions.create(
    model="o3",
    messages=[{"role": "user", "content": "Design an ETL pipeline for daily sales data"}],
    reasoning_effort="medium"
)

# High effort - deep reasoning for complex problems
response = client.chat.completions.create(
    model="o3",
    messages=[{"role": "user", "content": "Architect a globally distributed real-time analytics system"}],
    reasoning_effort="high"
)
```

## When to Use Reasoning Models

### Good Use Cases

```python
# 1. Complex technical design
response = await client.chat.completions.create(
    model="o3",
    messages=[{
        "role": "user",
        "content": """
        We're migrating from on-premise SQL Server to Azure.
        Current state: 50TB database, 1000 concurrent users,
        complex stored procedures, SSIS packages.

        Design the migration strategy with:
        - Minimal downtime approach
        - Data validation plan
        - Rollback strategy
        - Timeline estimation
        """
    }],
    reasoning_effort="high"
)

# 2. Code review with reasoning
response = await client.chat.completions.create(
    model="o3",
    messages=[{
        "role": "user",
        "content": f"""
        Review this data pipeline code for:
        - Correctness
        - Performance issues
        - Edge cases
        - Security vulnerabilities

        Code:
        {pipeline_code}

        Explain your reasoning for each finding.
        """
    }],
    reasoning_effort="medium"
)

# 3. Debugging complex issues
response = await client.chat.completions.create(
    model="o3",
    messages=[{
        "role": "user",
        "content": f"""
        Our Spark job is failing intermittently with OOM errors.

        Configuration: {spark_config}
        Error logs: {error_logs}
        Data characteristics: {data_info}

        Diagnose the root cause and provide fix.
        """
    }],
    reasoning_effort="high"
)
```

### Not Ideal For

```python
# Simple factual questions - use regular models
# Bad: o3 for "What is the capital of France?"

# High-volume, low-complexity tasks - too expensive
# Bad: o3 for classifying 1 million support tickets

# Creative writing - reasoning doesn't help much
# Bad: o3 for "Write a blog post about Python"
```

## Combining Reasoning with Tools

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "query_database",
            "description": "Execute SQL query",
            "parameters": {...}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_performance",
            "description": "Analyze query execution plan",
            "parameters": {...}
        }
    }
]

response = await client.chat.completions.create(
    model="o3",
    messages=[{
        "role": "user",
        "content": "Our customer_orders query is slow. Investigate and optimize it."
    }],
    tools=tools,
    reasoning_effort="high"
)

# o3 reasons about the problem, then uses tools strategically
# It might:
# 1. Query to understand current performance
# 2. Analyze the execution plan
# 3. Reason about optimization strategies
# 4. Propose and validate improvements
```

## Cost Considerations

Reasoning models use more tokens due to the thinking process:

```python
from openai import OpenAI

client = OpenAI()

# Track token usage
response = client.chat.completions.create(
    model="o3",
    messages=[{"role": "user", "content": complex_question}],
    reasoning_effort="high"
)

usage = response.usage
print(f"Input tokens: {usage.prompt_tokens}")
print(f"Reasoning tokens: {usage.completion_tokens_details.reasoning_tokens}")
print(f"Output tokens: {usage.completion_tokens - usage.completion_tokens_details.reasoning_tokens}")

# Reasoning tokens can be 10-100x the output tokens for complex problems
```

## Model Selection Strategy

```python
def select_model(task):
    """Choose the right model for the task."""

    # Task complexity assessment
    complexity_indicators = {
        "multi_step_reasoning": task.requires_planning,
        "technical_depth": task.domain_expertise_needed,
        "verification_needed": task.accuracy_critical,
        "creativity_needed": task.open_ended,
        "latency_sensitive": task.real_time
    }

    complexity_score = sum(complexity_indicators.values())

    if complexity_score >= 4 and not task.real_time:
        return "o3"  # Complex reasoning, can wait
    elif complexity_score >= 2:
        return "gpt-4o"  # Moderate complexity
    else:
        return "gpt-4o-mini"  # Simple tasks
```

## Building Reasoning Pipelines

```python
class ReasoningPipeline:
    """Multi-stage reasoning for complex problems."""

    def __init__(self):
        self.client = OpenAI()

    async def solve(self, problem: str) -> dict:
        # Stage 1: Problem decomposition
        decomposition = await self.client.chat.completions.create(
            model="o3",
            messages=[{
                "role": "user",
                "content": f"Decompose this problem into sub-problems:\n{problem}"
            }],
            reasoning_effort="medium"
        )

        sub_problems = self.parse_sub_problems(decomposition)

        # Stage 2: Solve each sub-problem
        solutions = []
        for sub in sub_problems:
            solution = await self.client.chat.completions.create(
                model="o3",
                messages=[{
                    "role": "user",
                    "content": f"Solve this specific problem:\n{sub}"
                }],
                reasoning_effort="high"
            )
            solutions.append(solution)

        # Stage 3: Synthesize final answer
        synthesis = await self.client.chat.completions.create(
            model="o3",
            messages=[{
                "role": "user",
                "content": f"""
                Original problem: {problem}
                Sub-solutions: {solutions}

                Synthesize a complete solution, ensuring consistency.
                """
            }],
            reasoning_effort="high"
        )

        return {
            "problem": problem,
            "decomposition": sub_problems,
            "sub_solutions": solutions,
            "final_solution": synthesis
        }
```

## The Future of Reasoning Models

Expect to see:
- **Longer reasoning chains** for more complex problems
- **Domain-specific reasoning** models
- **Hybrid architectures** combining fast and slow thinking
- **Verifiable reasoning** with formal proofs
- **Cost optimization** as the technology matures

Reasoning models represent a significant advancement in AI capability. Use them for problems that truly require deep thinking, and you'll see dramatically better results.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
