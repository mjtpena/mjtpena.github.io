---
title: "Mathematical Reasoning with o1: From Basics to Proofs"
author: "Michael John Peña"
draft: false
date: 2024-09-09
tags: ["OpenAI", "o1", "Mathematics", "AI", "Reasoning"]

---

I wrote "Mathematical Reasoning with o1: From Basics to Proofs" to share practical, production-minded guidance on this topic.

## Basic Mathematical Operations

Even for basic math, o1 approaches problems methodically:

```python
from openai import OpenAI

client = OpenAI()

def solve_math(problem: str, show_steps: bool = True) -> str:
    """
    Solve mathematical problems with optional step-by-step explanation
    """
    step_instruction = "Show all steps clearly." if show_steps else "Provide just the final answer."

    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{
            "role": "user",
            "content": f"{problem}\n\n{step_instruction}"
        }],
        max_completion_tokens=4096
    )

    return response.choices[0].message.content

# Example: Word problem
result = solve_math("""
A tank fills at 2 liters per minute through pipe A and
3 liters per minute through pipe B. It drains at 1 liter
per minute through a hole. If the tank capacity is 100 liters
and starts empty, how long until it's full?
""")
```

## Algebraic Problem Solving

```python
def solve_algebra(equations: list, variables: list) -> str:
    """
    Solve systems of equations
    """
    eq_text = "\n".join(f"  {e}" for e in equations)
    var_text = ", ".join(variables)

    prompt = f"""
Solve this system of equations for {var_text}:

{eq_text}

Provide:
1. The solution method you'll use
2. Step-by-step solution
3. Final values for each variable
4. Verification by substituting back
"""

    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=4096
    )

    return response.choices[0].message.content

# Example: System of equations
result = solve_algebra(
    equations=[
        "2x + 3y - z = 1",
        "x - y + 2z = 4",
        "3x + y + z = 5"
    ],
    variables=["x", "y", "z"]
)
```

## Probability and Statistics

```python
def analyze_probability(scenario: str, questions: list) -> str:
    """
    Solve probability problems with detailed reasoning
    """
    questions_text = "\n".join(f"{i+1}. {q}" for i, q in enumerate(questions))

    prompt = f"""
Probability Scenario:
{scenario}

Questions:
{questions_text}

For each question:
1. Identify the probability type (classical, conditional, Bayesian, etc.)
2. Set up the problem mathematically
3. Solve step by step
4. Express the answer as both a fraction and decimal
5. Provide intuition for why the answer makes sense
"""

    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=8192
    )

    return response.choices[0].message.content

# Example: Conditional probability
result = analyze_probability(
    scenario="""
    A medical test has:
    - 95% sensitivity (true positive rate)
    - 90% specificity (true negative rate)
    The disease affects 1% of the population.
    """,
    questions=[
        "What is P(disease | positive test)?",
        "What is P(healthy | negative test)?",
        "If we test 10,000 people, how many false positives do we expect?"
    ]
)
```

## Mathematical Proofs

```python
def construct_proof(statement: str, context: str = None) -> str:
    """
    Construct a mathematical proof
    """
    context_text = f"\nContext: {context}" if context else ""

    prompt = f"""
Prove the following statement:
{statement}
{context_text}

Provide:
1. Statement of what needs to be proved
2. Strategy for the proof
3. Full formal proof with clear logical steps
4. Commentary on why each step follows
5. Note any assumptions made
6. If relevant, provide a counterexample showing why conditions are necessary
"""

    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=8192
    )

    return response.choices[0].message.content

# Classic proofs
proof1 = construct_proof("√2 is irrational")
proof2 = construct_proof("There are infinitely many prime numbers")
proof3 = construct_proof(
    "For any integer n, n³ - n is divisible by 6",
    context="Hint: Factor and use properties of consecutive integers"
)
```

## Calculus and Analysis

```python
def solve_calculus(problem: str, problem_type: str) -> str:
    """
    Solve calculus problems with appropriate techniques
    """
    prompt = f"""
Problem Type: {problem_type}
Problem: {problem}

Solve this problem showing:
1. Identification of the problem type
2. Relevant theorems or techniques to apply
3. Step-by-step solution
4. Final answer (simplified)
5. Graphical interpretation if relevant
"""

    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=8192
    )

    return response.choices[0].message.content

# Examples
integral = solve_calculus(
    "∫ x² * e^x dx",
    "Integration by parts"
)

limit = solve_calculus(
    "lim(x→0) (sin(x) - x) / x³",
    "Limit evaluation"
)

optimization = solve_calculus(
    "Find the dimensions of a rectangular box with maximum volume if surface area is 600 cm²",
    "Optimization with constraints"
)
```

## Combinatorics and Discrete Math

```python
def solve_combinatorics(problem: str) -> str:
    """
    Solve counting and combinatorics problems
    """
    prompt = f"""
Combinatorics Problem:
{problem}

Solve this by:
1. Identifying the counting principle needed (permutation, combination, inclusion-exclusion, etc.)
2. Breaking down into cases if necessary
3. Computing the answer step by step
4. Verifying with a smaller example if possible
5. Explaining why other approaches might not work
"""

    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=8192
    )

    return response.choices[0].message.content

# Example
result = solve_combinatorics("""
How many ways can you arrange the letters in "MISSISSIPPI"
such that no two 'I's are adjacent?
""")
```

## Verification Pattern

```python
def verify_math_solution(problem: str, proposed_solution: str) -> str:
    """
    Use o1 to verify a mathematical solution
    """
    prompt = f"""
Problem: {problem}

Proposed Solution: {proposed_solution}

Please verify this solution:
1. Is the approach correct?
2. Are all steps logically valid?
3. Is the final answer correct?
4. If there are errors, identify exactly where and why
5. Provide the correct solution if needed
"""

    response = client.chat.completions.create(
        model="o1-preview",
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=8192
    )

    return response.choices[0].message.content
```

## Key Takeaways

1. **o1 excels at multi-step mathematical reasoning** - It can maintain context through long proofs
2. **Request verification** - Always ask o1 to check its own work
3. **Provide context** - Hints and problem types help focus reasoning
4. **Complex problems benefit most** - Simple arithmetic doesn't need o1's power

Mathematical reasoning is one of o1's strongest capabilities. Use it for problems that require genuine reasoning, not just computation.

