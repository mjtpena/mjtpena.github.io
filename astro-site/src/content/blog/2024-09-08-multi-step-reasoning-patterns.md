---
title: "Multi-Step Reasoning Patterns with o1"
author: "Michael John Peña"
draft: false
date: 2024-09-08
tags: ["OpenAI", "o1", "Reasoning", "AI", "Patterns"]

---

I wrote "Multi-Step Reasoning Patterns with o1" to share practical, production-minded guidance on this topic.

## Understanding Multi-Step Reasoning

```python
from openai import OpenAI
from typing import List, Dict

client = OpenAI()

class ReasoningChain:
    """
    Structure for multi-step reasoning problems
    """

    def __init__(self, problem: str):
        self.problem = problem
        self.steps: List[Dict] = []

    def add_step(self, description: str, dependencies: List[int] = None):
        step = {
            "step_num": len(self.steps) + 1,
            "description": description,
            "dependencies": dependencies or []
        }
        self.steps.append(step)
        return self

    def to_prompt(self) -> str:
        steps_text = "\n".join([
            f"Step {s['step_num']}: {s['description']}"
            + (f" (requires steps: {s['dependencies']})" if s['dependencies'] else "")
            for s in self.steps
        ])

        return f"""
Problem: {self.problem}

This requires the following reasoning steps:
{steps_text}

Work through each step carefully, showing your reasoning for each.
After completing all steps, provide the final answer.
"""

# Example: Investment analysis
chain = ReasoningChain("Should we invest $1M in expanding to the European market?")
chain.add_step("Analyze current market position and growth rate")
chain.add_step("Research European market size and competition")
chain.add_step("Estimate customer acquisition cost in Europe", [2])
chain.add_step("Project revenue over 5 years", [1, 2, 3])
chain.add_step("Calculate ROI and payback period", [4])
chain.add_step("Identify and quantify risks", [2, 3])
chain.add_step("Make final recommendation with confidence level", [5, 6])

response = client.chat.completions.create(
    model="o1-preview",
    messages=[{"role": "user", "content": chain.to_prompt()}],
    max_completion_tokens=8192
)
```

## Pattern: Backward Reasoning

```python
def backward_reasoning(goal: str, current_state: str, constraints: List[str]) -> str:
    """
    Reason backward from goal to current state
    Useful for planning and strategy
    """
    prompt = f"""
    Use backward reasoning to solve this problem:

    Goal State: {goal}
    Current State: {current_state}

    Constraints:
    {chr(10).join(f'- {c}' for c in constraints)}

    Reason backward:
    1. Start from the goal - what must be true immediately before achieving it?
    2. For each prerequisite, what must be true before that?
    3. Continue until you reach the current state
    4. Present the full path from current state to goal

    For each step, explain:
    - What needs to happen
    - Why it's necessary
    - How long it might take
    - What could go wrong
    """

    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=8192
    )

    return response.choices[0].message.content

# Example: Product launch
plan = backward_reasoning(
    goal="Launch product with 10,000 paying customers",
    current_state="MVP completed, 100 beta users",
    constraints=[
        "Budget: $500k",
        "Timeline: 6 months",
        "Team: 5 people",
        "Must maintain 99.9% uptime during launch"
    ]
)
```

## Pattern: Parallel Hypothesis Testing

```python
def parallel_hypothesis_analysis(observation: str, hypotheses: List[str]) -> str:
    """
    Evaluate multiple hypotheses in parallel, then synthesize
    """
    prompt = f"""
    Observation: {observation}

    Evaluate each hypothesis independently:

    {chr(10).join(f'Hypothesis {i+1}: {h}' for i, h in enumerate(hypotheses))}

    For each hypothesis:
    1. List evidence that supports it
    2. List evidence that contradicts it
    3. Identify what additional information would confirm or refute it
    4. Assign a probability (0-100%)

    Then:
    1. Consider if hypotheses could be combined
    2. Identify if there's a better hypothesis not listed
    3. Rank hypotheses by likelihood
    4. Recommend next steps for investigation
    """

    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=8192
    )

    return response.choices[0].message.content

# Example: System performance issue
analysis = parallel_hypothesis_analysis(
    observation="Application response time degraded from 100ms to 2s over the past week",
    hypotheses=[
        "Database queries are becoming slower due to data growth",
        "A recent code deployment introduced a performance regression",
        "Third-party API is experiencing issues",
        "Memory leak is causing garbage collection pauses",
        "Network latency increased due to infrastructure changes"
    ]
)
```

## Pattern: Iterative Refinement

```python
def iterative_refinement(initial_solution: str, evaluation_criteria: List[str],
                         max_iterations: int = 3) -> str:
    """
    Have o1 iteratively improve a solution
    """
    prompt = f"""
    Initial Solution:
    {initial_solution}

    Evaluation Criteria:
    {chr(10).join(f'- {c}' for c in evaluation_criteria)}

    Perform {max_iterations} iterations of refinement:

    For each iteration:
    1. Evaluate the current solution against all criteria
    2. Identify the weakest aspect
    3. Propose a specific improvement
    4. Present the refined solution

    After all iterations:
    1. Present the final refined solution
    2. Summarize all improvements made
    3. Identify remaining weaknesses
    4. Suggest future improvements if more time were available
    """

    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=12000
    )

    return response.choices[0].message.content
```

## Pattern: Dependency Resolution

```python
def resolve_dependencies(tasks: List[Dict]) -> str:
    """
    Analyze and resolve task dependencies
    """
    tasks_text = "\n".join([
        f"Task {t['id']}: {t['name']} (duration: {t['duration']})"
        + (f" - depends on: {t.get('depends_on', 'none')}" if t.get('depends_on') else "")
        for t in tasks
    ])

    prompt = f"""
    Analyze these tasks and their dependencies:

    {tasks_text}

    Please:
    1. Identify the critical path
    2. Calculate minimum total duration
    3. Identify tasks that can run in parallel
    4. Find any circular dependencies (error if found)
    5. Create an optimal execution schedule
    6. Identify bottlenecks and suggest how to reduce total time

    Present the schedule as a Gantt-chart style timeline (ASCII).
    """

    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=8192
    )

    return response.choices[0].message.content

# Example
tasks = [
    {"id": "A", "name": "Design database schema", "duration": "2 days"},
    {"id": "B", "name": "Set up infrastructure", "duration": "3 days"},
    {"id": "C", "name": "Implement API", "duration": "5 days", "depends_on": "A"},
    {"id": "D", "name": "Build frontend", "duration": "4 days", "depends_on": "A"},
    {"id": "E", "name": "Integration testing", "duration": "2 days", "depends_on": "C, D"},
    {"id": "F", "name": "Deploy to production", "duration": "1 day", "depends_on": "B, E"}
]

schedule = resolve_dependencies(tasks)
```

## Key Insights

1. **Structure helps reasoning** - Breaking problems into explicit steps improves o1's performance
2. **Dependencies matter** - Clearly stating what depends on what helps o1 reason correctly
3. **Multiple perspectives** - Parallel hypothesis testing leverages o1's ability to hold multiple ideas
4. **Iteration improves quality** - Asking for refinement cycles produces better solutions

Multi-step reasoning is o1's superpower. Use these patterns to unlock its full potential.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
