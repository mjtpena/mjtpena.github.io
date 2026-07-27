---
title: "Cycles in Agent Graphs: Iterative Refinement Patterns"
author: Michael John Peña
draft: false
date: 2024-07-16
tags:
  - AI
  - LangGraph
  - Agents
  - Iteration
  - Design Patterns

---

I wrote "Cycles in Agent Graphs: Iterative Refinement Patterns" to share practical, production-minded guidance on this topic.

## Why Cycles?

Real tasks often require iteration:
- **Refinement**: Improve output quality through multiple passes
- **Retry**: Handle failures with backoff strategies
- **Search**: Explore solution spaces systematically
- **Convergence**: Iterate until a condition is met

## Basic Cycle Pattern

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Literal

class IterativeState(TypedDict):
    task: str
    current_solution: str
    iteration: int
    max_iterations: int
    quality_score: float
    quality_threshold: float

def generate_solution(state: IterativeState) -> IterativeState:
    """Generate or refine solution."""
    iteration = state["iteration"]

    if iteration == 0:
        # Initial generation
        solution = f"Initial solution for: {state['task']}"
    else:
        # Refinement based on previous attempt
        solution = f"Refined solution (v{iteration + 1}): {state['current_solution']}"

    return {
        "current_solution": solution,
        "iteration": iteration + 1
    }

def evaluate_solution(state: IterativeState) -> IterativeState:
    """Evaluate solution quality."""
    # Simulated evaluation - in practice, use LLM or metrics
    score = min(0.5 + (state["iteration"] * 0.15), 0.95)
    return {"quality_score": score}

def should_continue(state: IterativeState) -> Literal["generate", "end"]:
    """Decide whether to continue iterating."""
    if state["quality_score"] >= state["quality_threshold"]:
        return "end"
    if state["iteration"] >= state["max_iterations"]:
        return "end"
    return "generate"

# Build graph with cycle
graph = StateGraph(IterativeState)

graph.add_node("generate", generate_solution)
graph.add_node("evaluate", evaluate_solution)

graph.set_entry_point("generate")
graph.add_edge("generate", "evaluate")

# This creates the cycle
graph.add_conditional_edges(
    "evaluate",
    should_continue,
    {"generate": "generate", "end": END}
)

iterative_agent = graph.compile()

# Run
result = iterative_agent.invoke({
    "task": "Write a sorting algorithm",
    "current_solution": "",
    "iteration": 0,
    "max_iterations": 5,
    "quality_score": 0.0,
    "quality_threshold": 0.8
})

print(f"Completed in {result['iteration']} iterations")
print(f"Final score: {result['quality_score']}")
```

## Retry with Backoff

Handle transient failures with exponential backoff:

```python
import time
from typing import Optional

class RetryState(TypedDict):
    task: str
    result: Optional[str]
    error: Optional[str]
    attempt: int
    max_attempts: int
    last_attempt_time: float
    backoff_seconds: float

def execute_task(state: RetryState) -> RetryState:
    """Execute task with potential failure."""
    import random

    # Track timing for backoff
    current_time = time.time()

    # Simulated failure (fails 70% of early attempts)
    if state["attempt"] < 3 and random.random() < 0.7:
        return {
            "error": f"Transient error on attempt {state['attempt']}",
            "result": None,
            "attempt": state["attempt"] + 1,
            "last_attempt_time": current_time
        }

    # Success
    return {
        "result": f"Success on attempt {state['attempt'] + 1}",
        "error": None,
        "attempt": state["attempt"] + 1,
        "last_attempt_time": current_time
    }

def apply_backoff(state: RetryState) -> RetryState:
    """Apply exponential backoff delay."""
    backoff = state["backoff_seconds"] * (2 ** (state["attempt"] - 1))
    backoff = min(backoff, 60)  # Cap at 60 seconds

    print(f"Backing off for {backoff} seconds...")
    time.sleep(backoff)  # In production, use async

    return {}

def should_retry(state: RetryState) -> Literal["backoff", "success", "fail"]:
    """Decide whether to retry."""
    if state.get("result"):
        return "success"
    if state["attempt"] >= state["max_attempts"]:
        return "fail"
    return "backoff"

# Build retry graph
graph = StateGraph(RetryState)

graph.add_node("execute", execute_task)
graph.add_node("backoff", apply_backoff)
graph.add_node("success", lambda s: s)
graph.add_node("fail", lambda s: {"result": f"Failed after {s['attempt']} attempts: {s['error']}"})

graph.set_entry_point("execute")

graph.add_conditional_edges(
    "execute",
    should_retry,
    {"backoff": "backoff", "success": "success", "fail": "fail"}
)

# Backoff loops back to execute
graph.add_edge("backoff", "execute")
graph.add_edge("success", END)
graph.add_edge("fail", END)

retry_agent = graph.compile()
```

## Self-Correction Loop

Let the LLM critique and improve its own output:

```python
from langchain_openai import AzureChatOpenAI

class SelfCorrectState(TypedDict):
    task: str
    output: str
    critique: str
    issues_found: list[str]
    iteration: int
    max_iterations: int
    is_satisfactory: bool

llm = AzureChatOpenAI(azure_deployment="gpt-4o")

def generate_output(state: SelfCorrectState) -> SelfCorrectState:
    """Generate or improve output."""
    if state["iteration"] == 0:
        prompt = f"Complete this task: {state['task']}"
    else:
        prompt = f"""
        Improve this output based on the critique:

        Original task: {state['task']}
        Current output: {state['output']}
        Critique: {state['critique']}
        Issues: {', '.join(state['issues_found'])}

        Provide an improved version that addresses all issues.
        """

    response = llm.invoke(prompt)
    return {"output": response.content, "iteration": state["iteration"] + 1}

def critique_output(state: SelfCorrectState) -> SelfCorrectState:
    """Critique the current output."""
    prompt = f"""
    Critically evaluate this output for the task "{state['task']}":

    {state['output']}

    Identify specific issues. If the output is satisfactory, say "SATISFACTORY".
    Otherwise, list each issue on a new line starting with "- ".
    """

    response = llm.invoke(prompt)
    content = response.content

    if "SATISFACTORY" in content.upper():
        return {
            "is_satisfactory": True,
            "critique": "Output is satisfactory",
            "issues_found": []
        }

    # Parse issues
    issues = [
        line.strip("- ").strip()
        for line in content.split("\n")
        if line.strip().startswith("-")
    ]

    return {
        "is_satisfactory": False,
        "critique": content,
        "issues_found": issues
    }

def should_continue_correction(state: SelfCorrectState) -> Literal["generate", "end"]:
    """Decide whether to continue self-correction."""
    if state["is_satisfactory"]:
        return "end"
    if state["iteration"] >= state["max_iterations"]:
        return "end"
    if not state["issues_found"]:  # No issues found
        return "end"
    return "generate"

# Build self-correction graph
graph = StateGraph(SelfCorrectState)

graph.add_node("generate", generate_output)
graph.add_node("critique", critique_output)

graph.set_entry_point("generate")
graph.add_edge("generate", "critique")

graph.add_conditional_edges(
    "critique",
    should_continue_correction,
    {"generate": "generate", "end": END}
)

self_correct = graph.compile()

# Usage
result = self_correct.invoke({
    "task": "Write a Python function to validate email addresses with proper error handling",
    "output": "",
    "critique": "",
    "issues_found": [],
    "iteration": 0,
    "max_iterations": 3,
    "is_satisfactory": False
})
```

## Search Loop

Systematically explore a solution space:

```python
from typing import Annotated
from operator import add

class SearchState(TypedDict):
    goal: str
    candidates: list[str]
    evaluated: Annotated[list[dict], add]
    current_best: dict
    exploration_count: int
    max_explorations: int

def generate_candidates(state: SearchState) -> SearchState:
    """Generate new candidate solutions."""
    prompt = f"""
    Generate 3 different approaches for: {state['goal']}

    Already tried approaches:
    {chr(10).join(e['approach'] for e in state['evaluated'])}

    Return each approach on a new line, numbered 1-3.
    """

    response = llm.invoke(prompt)

    # Parse candidates
    candidates = [
        line.strip()
        for line in response.content.split("\n")
        if line.strip() and line.strip()[0].isdigit()
    ]

    return {"candidates": candidates[:3]}

def evaluate_candidates(state: SearchState) -> SearchState:
    """Evaluate all current candidates."""
    new_evaluations = []

    for candidate in state["candidates"]:
        prompt = f"""
        Rate this approach for "{state['goal']}" from 0-10:

        Approach: {candidate}

        Return just the number.
        """

        response = llm.invoke(prompt)
        try:
            score = float(response.content.strip())
        except:
            score = 5.0

        new_evaluations.append({
            "approach": candidate,
            "score": score
        })

    # Update best
    all_evaluated = state["evaluated"] + new_evaluations
    best = max(all_evaluated, key=lambda x: x["score"])

    return {
        "evaluated": new_evaluations,
        "current_best": best,
        "exploration_count": state["exploration_count"] + 1,
        "candidates": []  # Clear for next round
    }

def should_continue_search(state: SearchState) -> Literal["generate", "end"]:
    """Decide whether to continue searching."""
    if state["current_best"]["score"] >= 9.0:
        return "end"  # Found excellent solution
    if state["exploration_count"] >= state["max_explorations"]:
        return "end"
    return "generate"

# Build search graph
graph = StateGraph(SearchState)

graph.add_node("generate", generate_candidates)
graph.add_node("evaluate", evaluate_candidates)

graph.set_entry_point("generate")
graph.add_edge("generate", "evaluate")

graph.add_conditional_edges(
    "evaluate",
    should_continue_search,
    {"generate": "generate", "end": END}
)

search_agent = graph.compile()
```

## Nested Cycles

Cycles within cycles for complex workflows:

```python
class OuterState(TypedDict):
    main_task: str
    subtasks: list[str]
    subtask_results: Annotated[list[str], add]
    current_subtask_index: int
    final_result: str
    outer_iteration: int
    max_outer_iterations: int

class SubtaskState(TypedDict):
    subtask: str
    attempt: int
    max_attempts: int
    result: str
    success: bool

def plan_subtasks(state: OuterState) -> OuterState:
    """Break main task into subtasks."""
    prompt = f"Break this into 3 subtasks: {state['main_task']}"
    response = llm.invoke(prompt)

    subtasks = [
        line.strip()
        for line in response.content.split("\n")
        if line.strip()
    ][:3]

    return {
        "subtasks": subtasks,
        "current_subtask_index": 0,
        "outer_iteration": state["outer_iteration"] + 1
    }

def execute_subtask_with_retry(state: OuterState) -> OuterState:
    """Execute current subtask with inner retry loop."""
    idx = state["current_subtask_index"]
    subtask = state["subtasks"][idx]

    # Inner cycle: retry logic
    for attempt in range(3):
        try:
            prompt = f"Complete this subtask: {subtask}"
            response = llm.invoke(prompt)
            result = response.content
            break
        except Exception as e:
            if attempt == 2:
                result = f"Failed: {str(e)}"
            continue

    return {
        "subtask_results": [result],
        "current_subtask_index": idx + 1
    }

def synthesize_results(state: OuterState) -> OuterState:
    """Combine subtask results."""
    prompt = f"""
    Synthesize these results for "{state['main_task']}":

    {chr(10).join(state['subtask_results'])}
    """

    response = llm.invoke(prompt)
    return {"final_result": response.content}

def route_subtask(state: OuterState) -> Literal["execute", "synthesize"]:
    """Route based on subtask completion."""
    if state["current_subtask_index"] >= len(state["subtasks"]):
        return "synthesize"
    return "execute"

def should_retry_outer(state: OuterState) -> Literal["plan", "end"]:
    """Check if outer loop should retry."""
    # Simple quality check
    if len(state["final_result"]) > 100:
        return "end"
    if state["outer_iteration"] >= state["max_outer_iterations"]:
        return "end"
    return "plan"

# Build nested cycle graph
graph = StateGraph(OuterState)

graph.add_node("plan", plan_subtasks)
graph.add_node("execute", execute_subtask_with_retry)
graph.add_node("synthesize", synthesize_results)

graph.set_entry_point("plan")

# Inner cycle: subtask execution
graph.add_conditional_edges(
    "plan",
    lambda s: "execute",
    {"execute": "execute"}
)

graph.add_conditional_edges(
    "execute",
    route_subtask,
    {"execute": "execute", "synthesize": "synthesize"}
)

# Outer cycle: quality check
graph.add_conditional_edges(
    "synthesize",
    should_retry_outer,
    {"plan": "plan", "end": END}
)

nested_agent = graph.compile()
```

## Cycle Safety

Always protect against infinite loops:

```python
class SafeCycleState(TypedDict):
    iteration: int
    max_iterations: int
    total_llm_calls: int
    max_llm_calls: int
    start_time: float
    max_duration_seconds: float

def safe_cycle_check(state: SafeCycleState) -> Literal["continue", "stop"]:
    """Multi-layered safety checks."""
    import time

    # Check iteration count
    if state["iteration"] >= state["max_iterations"]:
        print(f"Stopping: max iterations ({state['max_iterations']}) reached")
        return "stop"

    # Check LLM call budget
    if state["total_llm_calls"] >= state["max_llm_calls"]:
        print(f"Stopping: max LLM calls ({state['max_llm_calls']}) reached")
        return "stop"

    # Check time budget
    elapsed = time.time() - state["start_time"]
    if elapsed >= state["max_duration_seconds"]:
        print(f"Stopping: max duration ({state['max_duration_seconds']}s) reached")
        return "stop"

    return "continue"
```

## Best Practices

1. **Always set limits**: Max iterations, time, cost
2. **Track progress**: Log each iteration for debugging
3. **Use meaningful exit conditions**: Quality thresholds, not just counts
4. **Handle stagnation**: Detect when iterations aren't improving
5. **Test cycle termination**: Ensure cycles actually end

## Conclusion

Cycles enable agents to tackle problems that require iteration. From simple retries to complex self-correction loops, these patterns make agents more robust and capable.

Always implement safety guards, and remember: the power of cycles comes with the responsibility of ensuring they terminate.

