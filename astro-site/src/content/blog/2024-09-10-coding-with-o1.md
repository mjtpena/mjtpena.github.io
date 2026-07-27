---
title: "Advanced Coding Techniques with GPT-4o and Claude 3.5 Sonnet"
author: "Michael John Peña"
draft: false
date: 2024-09-10
tags: ["AI", "Coding", "Software Development", "GPT-4o", "Claude"]

---

I wrote "Advanced Coding Techniques with GPT-4o and Claude 3.5 Sonnet" to share practical, production-minded guidance on this topic.

## Algorithm Design with Structured Prompts

For complex algorithms, provide clear structure:

```python
from openai import OpenAI

client = OpenAI()

def design_algorithm(problem: str, constraints: dict) -> str:
    """
    Design an algorithm with specified constraints
    """
    constraints_text = "\n".join(f"- {k}: {v}" for k, v in constraints.items())

    prompt = f"""
Design an algorithm for the following problem:

Problem: {problem}

Constraints:
{constraints_text}

Provide:
1. Problem analysis and approach selection
2. Pseudocode for the algorithm
3. Time complexity analysis
4. Space complexity analysis
5. Edge cases to handle
6. Full implementation in Python
7. Test cases covering normal and edge cases

Think through each step carefully before implementing.
"""

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=4096
    )

    return response.choices[0].message.content

# Example: LRU Cache with a twist
result = design_algorithm(
    problem="Implement an LRU cache that also tracks access frequency",
    constraints={
        "Time complexity for get/put": "O(1)",
        "Space complexity": "O(capacity)",
        "Thread safety": "Not required",
        "Language": "Python 3.10+"
    }
)
```

## Complex Data Structure Implementation

```python
def implement_data_structure(name: str, operations: list, requirements: list) -> str:
    """
    Implement a complex data structure with specific requirements
    """
    ops_text = "\n".join(f"- {op}" for op in operations)
    reqs_text = "\n".join(f"- {req}" for req in requirements)

    prompt = f"""
Implement the following data structure:

Name: {name}

Required Operations:
{ops_text}

Requirements:
{reqs_text}

Provide:
1. Class design with clear interface
2. Internal data structure choices with justification
3. Implementation of all operations
4. Complexity analysis for each operation
5. Complete test suite
6. Example usage

Work through the design step by step before coding.
"""

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=4096
    )

    return response.choices[0].message.content

# Example: Interval Tree
result = implement_data_structure(
    name="Interval Tree",
    operations=[
        "insert(start, end, value) - Insert an interval",
        "delete(start, end) - Delete an interval",
        "query(point) - Find all intervals containing the point",
        "query_range(start, end) - Find all overlapping intervals"
    ],
    requirements=[
        "Insert: O(log n)",
        "Delete: O(log n)",
        "Query: O(log n + k) where k is number of results"
    ]
)
```

## Code Refactoring

```python
def refactor_code(code: str, goals: list) -> str:
    """
    Refactor code with specific goals
    """
    goals_text = "\n".join(f"- {g}" for g in goals)

    prompt = f"""
Refactor the following code:

```python
{code}
```

Refactoring Goals:
{goals_text}

Provide:
1. Analysis of current code issues
2. Refactoring strategy
3. Refactored code with explanatory comments
4. Explanation of each major change
5. Before/after comparison of key metrics
6. Any remaining technical debt to address later

Think through the design before implementing.
"""

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=4096
    )

    return response.choices[0].message.content

# Example: Refactor messy code
legacy_code = '''
def proc(d):
    r = []
    for i in d:
        if i['t'] == 'A':
            if i['v'] > 100:
                r.append({'n': i['n'], 's': 'high'})
            else:
                r.append({'n': i['n'], 's': 'low'})
        elif i['t'] == 'B':
            if i['v'] > 50:
                r.append({'n': i['n'], 's': 'high'})
            else:
                r.append({'n': i['n'], 's': 'low'})
    return r
'''

refactored = refactor_code(
    code=legacy_code,
    goals=[
        "Improve readability with clear variable names",
        "Add type hints",
        "Make thresholds configurable",
        "Add documentation",
        "Make it extensible for new types"
    ]
)
```

## Bug Detection and Fixing

```python
def find_and_fix_bugs(code: str, symptoms: str = None) -> str:
    """
    Find bugs through careful analysis
    """
    symptoms_text = f"\nReported symptoms: {symptoms}" if symptoms else ""

    prompt = f"""
Analyze this code for bugs:

```python
{code}
```
{symptoms_text}

Please:
1. Trace through the code logic step by step
2. Identify all bugs (obvious and subtle)
3. For each bug:
   - Line number and description
   - Why it's a bug
   - What input triggers it
   - How to fix it
4. Provide the corrected code
5. Add test cases that would have caught these bugs

Think carefully through each step.
"""

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=4096
    )

    return response.choices[0].message.content

# Example: Code with subtle bugs
buggy_code = '''
def binary_search(arr, target):
    left, right = 0, len(arr)
    while left < right:
        mid = (left + right) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            left = mid
        else:
            right = mid
    return -1

def merge_sorted_lists(list1, list2):
    result = []
    i = j = 0
    while i < len(list1) and j < len(list2):
        if list1[i] <= list2[j]:
            result.append(list1[i])
            i += 1
        else:
            result.append(list2[j])
            j += 1
    return result
'''

analysis = find_and_fix_bugs(
    code=buggy_code,
    symptoms="binary_search hangs on some inputs; merge_sorted_lists loses elements"
)
```

## System Design to Code

```python
def design_to_implementation(design: str, language: str = "Python") -> str:
    """
    Convert a system design into working code
    """
    prompt = f"""
Convert this system design into a working implementation:

Design:
{design}

Implementation Language: {language}

Provide:
1. Architecture overview
2. Class/module structure
3. Interface definitions
4. Full implementation
5. Error handling
6. Configuration management
7. Example usage
8. Integration test outline

Plan the architecture before coding.
"""

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=4096
    )

    return response.choices[0].message.content

# Example
implementation = design_to_implementation("""
Rate Limiter Service:
- Support multiple rate limiting algorithms (token bucket, sliding window)
- Per-user and per-endpoint limits
- Distributed support via Redis
- Graceful degradation when Redis is unavailable
- Metrics and monitoring hooks
""")
```

## Using Claude for Code Review

Claude 3.5 Sonnet excels at code analysis:

```python
from anthropic import Anthropic

anthropic_client = Anthropic()

def code_review(code: str, focus_areas: list = None) -> str:
    """Use Claude for comprehensive code review"""

    focus_text = "\n".join(f"- {f}" for f in (focus_areas or []))

    prompt = f"""
Review this code thoroughly:

```python
{code}
```

{"Focus areas:" + focus_text if focus_text else ""}

Analyze:
1. Code quality and readability
2. Potential bugs or edge cases
3. Performance considerations
4. Security vulnerabilities
5. Best practice violations
6. Suggested improvements

Provide specific, actionable feedback.
"""

    response = anthropic_client.messages.create(
        model="claude-3-5-sonnet-20240620",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )

    return response.content[0].text
```

## Best Practices for AI-Assisted Coding

1. **Provide clear context** - Include constraints and requirements
2. **Ask for step-by-step reasoning** - Better algorithms emerge
3. **Request tests** - Ensures correctness
4. **Iterate** - Refine based on output
5. **Review carefully** - AI code needs human verification

## When to Use Each Model

**GPT-4o** works well for:
- Interactive coding with streaming
- Function calling integrations
- Quick iterations

**Claude 3.5 Sonnet** excels at:
- Complex algorithm design
- Detailed code review
- Long context (large codebases)

## Looking Ahead

The AI community is actively developing models with improved reasoning capabilities. These may handle complex coding tasks even better in the future. Build flexible abstractions ready to adopt new models when they arrive.

## Conclusion

Effective AI-assisted coding requires clear prompts and structured requests. Use chain-of-thought style prompts for complex problems, and always verify the output. The combination of GPT-4o and Claude 3.5 Sonnet covers most coding needs today.

## Resources

- [OpenAI Cookbook](https://cookbook.openai.com/)
- [Anthropic Claude Documentation](https://docs.anthropic.com/)
- [Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering)

