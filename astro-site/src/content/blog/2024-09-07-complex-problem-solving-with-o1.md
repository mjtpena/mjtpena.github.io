---
title: "Complex Problem Solving with o1: Practical Patterns"
author: "Michael John Peña"
draft: false
date: 2024-09-07
tags: ["OpenAI", "o1", "Problem Solving", "AI", "Engineering"]

---

I wrote "Complex Problem Solving with o1: Practical Patterns" to share practical, production-minded guidance on this topic.

## Pattern 1: Multi-Constraint Optimization

```python
from openai import OpenAI

client = OpenAI()

def solve_optimization_problem(constraints: list, objectives: list, variables: list) -> str:
    """
    Use o1 for multi-constraint optimization problems
    """
    prompt = f"""
    Solve this optimization problem:

    Variables:
    {chr(10).join(f'- {v}' for v in variables)}

    Constraints:
    {chr(10).join(f'- {c}' for c in constraints)}

    Objectives (in priority order):
    {chr(10).join(f'{i+1}. {o}' for i, o in enumerate(objectives))}

    Provide:
    1. The optimal values for each variable
    2. Analysis of trade-offs between objectives
    3. Sensitivity analysis for key constraints
    4. Recommendations for relaxing constraints if needed
    """

    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=8192
    )

    return response.choices[0].message.content

# Example: Resource allocation
result = solve_optimization_problem(
    variables=[
        "Team A headcount (0-10)",
        "Team B headcount (0-15)",
        "Infrastructure budget ($0-$100k/month)",
        "Feature development time (weeks)"
    ],
    constraints=[
        "Total headcount <= 20",
        "Total budget <= $150k/month",
        "Must launch MVP in 12 weeks",
        "Each team needs minimum 3 people"
    ],
    objectives=[
        "Maximize feature completeness",
        "Minimize time to market",
        "Minimize ongoing operational cost"
    ]
)
```

## Pattern 2: Root Cause Analysis

```python
def analyze_root_cause(symptoms: list, context: str, history: list = None) -> str:
    """
    Deep root cause analysis for complex systems
    """
    history_text = ""
    if history:
        history_text = f"\nPrevious incidents:\n" + "\n".join(f"- {h}" for h in history)

    prompt = f"""
    Perform root cause analysis for the following issue:

    Context:
    {context}

    Observed symptoms:
    {chr(10).join(f'- {s}' for s in symptoms)}
    {history_text}

    Please provide:
    1. Most likely root causes (ranked by probability)
    2. Evidence supporting each hypothesis
    3. Evidence that would refute each hypothesis
    4. Recommended diagnostic steps to confirm root cause
    5. Immediate mitigation actions
    6. Long-term preventive measures

    Use the 5 Whys technique where appropriate.
    """

    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=8192
    )

    return response.choices[0].message.content

# Example: Production incident
analysis = analyze_root_cause(
    symptoms=[
        "API latency increased from 50ms to 2000ms",
        "Database CPU at 95%",
        "Memory usage stable",
        "No deployment in last 24 hours",
        "Error rate increased by 10x"
    ],
    context="E-commerce platform, PostgreSQL database, 10M daily active users",
    history=[
        "Similar incident 3 months ago caused by missing index",
        "Database was upgraded 1 week ago"
    ]
)
```

## Pattern 3: System Design Review

```python
def review_system_design(design_doc: str, requirements: list) -> str:
    """
    Comprehensive system design review using o1's reasoning
    """
    prompt = f"""
    Review this system design critically:

    Design Document:
    {design_doc}

    Requirements that must be met:
    {chr(10).join(f'- {r}' for r in requirements)}

    Analyze:
    1. Does the design meet all requirements? If not, what's missing?
    2. What are the failure modes and how are they handled?
    3. What are the scalability bottlenecks?
    4. What are the security vulnerabilities?
    5. What operational challenges will arise?
    6. What's the total cost of ownership?

    For each issue found, provide:
    - Severity (Critical/High/Medium/Low)
    - Impact description
    - Recommended solution
    - Implementation complexity
    """

    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=16384
    )

    return response.choices[0].message.content
```

## Pattern 4: Complex Code Architecture

```python
def design_architecture(requirements: str, constraints: str) -> str:
    """
    Generate and validate complex system architecture
    """
    prompt = f"""
    Design a software architecture for the following requirements:

    Requirements:
    {requirements}

    Constraints:
    {constraints}

    Provide:
    1. High-level architecture diagram (in ASCII or Mermaid format)
    2. Component breakdown with responsibilities
    3. Data flow between components
    4. API contracts between services
    5. Database schema design
    6. Caching strategy
    7. Error handling approach
    8. Monitoring and observability plan

    For each architectural decision, explain:
    - Why this approach was chosen
    - What alternatives were considered
    - Trade-offs made
    """

    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=16384
    )

    return response.choices[0].message.content

# Example usage
architecture = design_architecture(
    requirements="""
    - Real-time chat system supporting 1M concurrent users
    - Message delivery guarantee (at-least-once)
    - End-to-end encryption
    - Message history with search
    - Presence indicators
    - Typing indicators
    - Group chats up to 1000 members
    """,
    constraints="""
    - Must run on Azure
    - Budget: $50k/month
    - Team: 5 engineers
    - Launch in 6 months
    """
)
```

## Pattern 5: Decision Analysis

```python
def analyze_decision(decision: str, options: list, criteria: list) -> str:
    """
    Multi-criteria decision analysis
    """
    prompt = f"""
    Help analyze this decision:

    Decision: {decision}

    Options:
    {chr(10).join(f'{i+1}. {o}' for i, o in enumerate(options))}

    Evaluation criteria:
    {chr(10).join(f'- {c}' for c in criteria)}

    Please:
    1. Create a decision matrix scoring each option against criteria
    2. Identify risks and unknowns for each option
    3. Consider second-order effects
    4. Identify reversibility of each option
    5. Recommend the best option with detailed justification
    6. Describe conditions that would change the recommendation
    """

    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=8192
    )

    return response.choices[0].message.content
```

## Best Practices

1. **Structure your problems clearly** - o1 reasons better with well-defined inputs
2. **Ask for reasoning steps** - Request explicit analysis, not just conclusions
3. **Use appropriate token budgets** - Complex problems need more thinking tokens
4. **Validate outputs** - o1 is better but not infallible

o1's reasoning capabilities open up new possibilities for tackling complex problems that were previously difficult for AI to handle reliably.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
