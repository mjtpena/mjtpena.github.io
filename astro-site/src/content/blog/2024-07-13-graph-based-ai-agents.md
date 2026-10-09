---
title: "Graph-Based AI Agents: Design Patterns and Architecture"
author: Michael John Peña
draft: false
date: 2024-07-13
tags:
  - AI
  - Agents
  - LangGraph
  - Architecture
  - Design Patterns
---

## The Graph Mental Model

Think of your agent as a state machine:
- **Nodes**: Processing steps (functions that transform state)
- **Edges**: Transitions between steps
- **State**: Accumulated context that flows through the graph

```python
from typing import TypedDict, Annotated, Literal
from operator import add
from langgraph.graph import StateGraph, END

# State accumulates through the graph
class AgentState(TypedDict):
    # Accumulated messages (using Annotated with add operator)
    messages: Annotated[list[dict], add]
    # Current processing phase
    phase: str
    # Accumulated artifacts
    artifacts: Annotated[list[str], add]
    # Final output
    output: str
```

## Pattern 1: Sequential Pipeline

The simplest pattern - nodes execute in order:

```python
class PipelineState(TypedDict):
    raw_data: str
    cleaned_data: str
    transformed_data: str
    validated_data: str
    output: str

def clean_data(state: PipelineState) -> PipelineState:
    # Remove duplicates, fix formatting
    cleaned = state["raw_data"].strip().lower()
    return {"cleaned_data": cleaned}

def transform_data(state: PipelineState) -> PipelineState:
    # Apply transformations
    transformed = state["cleaned_data"].upper()
    return {"transformed_data": transformed}

def validate_data(state: PipelineState) -> PipelineState:
    # Validate output
    is_valid = len(state["transformed_data"]) > 0
    return {
        "validated_data": state["transformed_data"] if is_valid else "",
        "output": "valid" if is_valid else "invalid"
    }

graph = StateGraph(PipelineState)
graph.add_node("clean", clean_data)
graph.add_node("transform", transform_data)
graph.add_node("validate", validate_data)

graph.set_entry_point("clean")
graph.add_edge("clean", "transform")
graph.add_edge("transform", "validate")
graph.add_edge("validate", END)

pipeline = graph.compile()
```

## Pattern 2: Router/Dispatcher

Route to different handlers based on input:

```python
from langchain_openai import AzureChatOpenAI

class RouterState(TypedDict):
    input: str
    category: str
    result: str

llm = AzureChatOpenAI(azure_deployment="gpt-4o")

def classify_input(state: RouterState) -> RouterState:
    """Classify the input to determine routing."""
    prompt = f"""
    Classify this input into one of: [data_query, code_request, explanation, other]

    Input: {state['input']}

    Return only the category name.
    """
    response = llm.invoke(prompt)
    return {"category": response.content.strip().lower()}

def handle_data_query(state: RouterState) -> RouterState:
    prompt = f"Generate a SQL query for: {state['input']}"
    response = llm.invoke(prompt)
    return {"result": f"SQL Query: {response.content}"}

def handle_code_request(state: RouterState) -> RouterState:
    prompt = f"Write code for: {state['input']}"
    response = llm.invoke(prompt)
    return {"result": f"Code: {response.content}"}

def handle_explanation(state: RouterState) -> RouterState:
    prompt = f"Explain: {state['input']}"
    response = llm.invoke(prompt)
    return {"result": response.content}

def handle_other(state: RouterState) -> RouterState:
    return {"result": "I'm not sure how to handle that request."}

def route_decision(state: RouterState) -> Literal["data", "code", "explain", "other"]:
    category_map = {
        "data_query": "data",
        "code_request": "code",
        "explanation": "explain"
    }
    return category_map.get(state["category"], "other")

graph = StateGraph(RouterState)

graph.add_node("classify", classify_input)
graph.add_node("data", handle_data_query)
graph.add_node("code", handle_code_request)
graph.add_node("explain", handle_explanation)
graph.add_node("other", handle_other)

graph.set_entry_point("classify")

graph.add_conditional_edges(
    "classify",
    route_decision,
    {"data": "data", "code": "code", "explain": "explain", "other": "other"}
)

for node in ["data", "code", "explain", "other"]:
    graph.add_edge(node, END)

router = graph.compile()
```

## Pattern 3: Iterative Refinement

Loop until quality threshold is met:

```python
class RefinementState(TypedDict):
    task: str
    draft: str
    feedback: str
    score: float
    iterations: int
    max_iterations: int
    final: str

def generate_draft(state: RefinementState) -> RefinementState:
    """Generate or improve draft."""
    if state["iterations"] == 0:
        prompt = f"Create a first draft for: {state['task']}"
    else:
        prompt = f"""
        Improve this draft based on feedback:

        Draft: {state['draft']}
        Feedback: {state['feedback']}
        """

    response = llm.invoke(prompt)
    return {
        "draft": response.content,
        "iterations": state["iterations"] + 1
    }

def evaluate_draft(state: RefinementState) -> RefinementState:
    """Score the current draft."""
    prompt = f"""
    Rate this draft from 0-10 for the task "{state['task']}":

    {state['draft']}

    Return a JSON object: {{"score": N, "feedback": "..."}}
    """

    response = llm.invoke(prompt)
    # Parse response (simplified)
    import json
    try:
        result = json.loads(response.content)
        return {
            "score": result["score"] / 10,  # Normalize to 0-1
            "feedback": result["feedback"]
        }
    except:
        return {"score": 0.5, "feedback": "Could not parse evaluation"}

def finalize(state: RefinementState) -> RefinementState:
    """Finalize the output."""
    return {"final": state["draft"]}

def should_continue(state: RefinementState) -> Literal["refine", "finalize"]:
    """Decide whether to continue refining."""
    if state["score"] >= 0.8:  # Quality threshold
        return "finalize"
    if state["iterations"] >= state["max_iterations"]:
        return "finalize"
    return "refine"

graph = StateGraph(RefinementState)

graph.add_node("generate", generate_draft)
graph.add_node("evaluate", evaluate_draft)
graph.add_node("finalize", finalize)

graph.set_entry_point("generate")
graph.add_edge("generate", "evaluate")

graph.add_conditional_edges(
    "evaluate",
    should_continue,
    {"refine": "generate", "finalize": "finalize"}
)

graph.add_edge("finalize", END)

refiner = graph.compile()
```

## Pattern 4: Parallel Execution

Execute multiple paths simultaneously:

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Annotated
from operator import add
import asyncio

class ParallelState(TypedDict):
    query: str
    sql_result: str
    nosql_result: str
    cache_result: str
    combined_result: str

async def query_sql(state: ParallelState) -> ParallelState:
    """Query SQL database."""
    await asyncio.sleep(0.5)  # Simulate query
    return {"sql_result": f"SQL results for: {state['query']}"}

async def query_nosql(state: ParallelState) -> ParallelState:
    """Query NoSQL database."""
    await asyncio.sleep(0.3)  # Simulate query
    return {"nosql_result": f"NoSQL results for: {state['query']}"}

async def query_cache(state: ParallelState) -> ParallelState:
    """Query cache."""
    await asyncio.sleep(0.1)  # Simulate query
    return {"cache_result": f"Cache results for: {state['query']}"}

def combine_results(state: ParallelState) -> ParallelState:
    """Combine all query results."""
    combined = f"""
    SQL: {state.get('sql_result', 'N/A')}
    NoSQL: {state.get('nosql_result', 'N/A')}
    Cache: {state.get('cache_result', 'N/A')}
    """
    return {"combined_result": combined}

# Build graph with parallel branches
graph = StateGraph(ParallelState)

graph.add_node("sql", query_sql)
graph.add_node("nosql", query_nosql)
graph.add_node("cache", query_cache)
graph.add_node("combine", combine_results)

# Fan-out from entry to parallel nodes
graph.set_entry_point("sql")  # Start with sql
# Note: True parallelism requires async execution

# Fan-in to combine
graph.add_edge("sql", "nosql")
graph.add_edge("nosql", "cache")
graph.add_edge("cache", "combine")
graph.add_edge("combine", END)

parallel_agent = graph.compile()
```

## Pattern 5: Supervisor Agent

A coordinator that delegates to specialized sub-agents:

```python
class SupervisorState(TypedDict):
    task: str
    subtasks: list[dict]
    current_subtask_index: int
    results: Annotated[list[str], add]
    final_answer: str

def plan_subtasks(state: SupervisorState) -> SupervisorState:
    """Break task into subtasks."""
    prompt = f"""
    Break this task into subtasks:
    {state['task']}

    Return as JSON: [{{"id": 1, "description": "...", "agent": "sql|code|analysis"}}]
    """
    response = llm.invoke(prompt)
    import json
    try:
        subtasks = json.loads(response.content)
    except:
        subtasks = [{"id": 1, "description": state["task"], "agent": "analysis"}]

    return {"subtasks": subtasks, "current_subtask_index": 0}

def execute_subtask(state: SupervisorState) -> SupervisorState:
    """Execute current subtask with appropriate agent."""
    idx = state["current_subtask_index"]
    subtask = state["subtasks"][idx]

    # Dispatch to appropriate handler
    if subtask["agent"] == "sql":
        result = execute_sql_subtask(subtask["description"])
    elif subtask["agent"] == "code":
        result = execute_code_subtask(subtask["description"])
    else:
        result = execute_analysis_subtask(subtask["description"])

    return {
        "results": [result],
        "current_subtask_index": idx + 1
    }

def execute_sql_subtask(description: str) -> str:
    response = llm.invoke(f"Generate SQL for: {description}")
    return f"SQL: {response.content}"

def execute_code_subtask(description: str) -> str:
    response = llm.invoke(f"Write code for: {description}")
    return f"Code: {response.content}"

def execute_analysis_subtask(description: str) -> str:
    response = llm.invoke(f"Analyze: {description}")
    return f"Analysis: {response.content}"

def synthesize_results(state: SupervisorState) -> SupervisorState:
    """Combine all subtask results."""
    prompt = f"""
    Synthesize these results into a coherent answer:

    Original task: {state['task']}

    Results:
    {chr(10).join(state['results'])}
    """
    response = llm.invoke(prompt)
    return {"final_answer": response.content}

def should_continue_subtasks(state: SupervisorState) -> Literal["execute", "synthesize"]:
    """Check if more subtasks remain."""
    if state["current_subtask_index"] < len(state["subtasks"]):
        return "execute"
    return "synthesize"

graph = StateGraph(SupervisorState)

graph.add_node("plan", plan_subtasks)
graph.add_node("execute", execute_subtask)
graph.add_node("synthesize", synthesize_results)

graph.set_entry_point("plan")
graph.add_edge("plan", "execute")

graph.add_conditional_edges(
    "execute",
    should_continue_subtasks,
    {"execute": "execute", "synthesize": "synthesize"}
)

graph.add_edge("synthesize", END)

supervisor = graph.compile()
```

## Pattern 6: Human-in-the-Loop

Pause for human input:

```python
from langgraph.checkpoint.sqlite import SqliteSaver

class HITLState(TypedDict):
    request: str
    proposed_action: str
    human_approved: bool
    execution_result: str

def propose_action(state: HITLState) -> HITLState:
    """Propose an action for human approval."""
    prompt = f"Propose an action for: {state['request']}"
    response = llm.invoke(prompt)
    return {"proposed_action": response.content}

def await_human_approval(state: HITLState) -> HITLState:
    """This node pauses for human input."""
    # In practice, this would wait for external input
    # The graph execution pauses here
    return {}  # State updated externally

def execute_action(state: HITLState) -> HITLState:
    """Execute the approved action."""
    if state["human_approved"]:
        return {"execution_result": f"Executed: {state['proposed_action']}"}
    return {"execution_result": "Action rejected by human"}

def route_approval(state: HITLState) -> Literal["execute", "end"]:
    return "execute" if state.get("human_approved") else "end"

graph = StateGraph(HITLState)

graph.add_node("propose", propose_action)
graph.add_node("await_approval", await_human_approval)
graph.add_node("execute", execute_action)

graph.set_entry_point("propose")
graph.add_edge("propose", "await_approval")

graph.add_conditional_edges(
    "await_approval",
    route_approval,
    {"execute": "execute", "end": END}
)

graph.add_edge("execute", END)

# Use checkpointer for persistence
checkpointer = SqliteSaver.from_conn_string(":memory:")
hitl_agent = graph.compile(checkpointer=checkpointer)

# Start execution (pauses at await_approval)
config = {"configurable": {"thread_id": "user-123"}}
result = hitl_agent.invoke(
    {"request": "Delete all records from staging table"},
    config
)

# Later: resume with human decision
hitl_agent.update_state(config, {"human_approved": True})
final_result = hitl_agent.invoke(None, config)  # Resume from checkpoint
```

## Composition Best Practices

1. **Single Responsibility**: Each node does one thing
2. **Explicit State**: All data flows through typed state
3. **Idempotent Nodes**: Nodes should be safe to retry
4. **Clear Routing Logic**: Decision functions should be testable
5. **Bounded Iterations**: Always limit cycles

```python
# Good: Clear, testable routing
def route_decision(state: State) -> Literal["a", "b", "c"]:
    if state["condition_a"]:
        return "a"
    elif state["condition_b"]:
        return "b"
    return "c"

# Bad: Complex logic in routing
def route_decision(state: State) -> str:
    # Don't do complex processing here
    result = complex_calculation(state)
    return result
```

## Conclusion

Graph-based agents provide the flexibility needed for real-world AI applications. Master these patterns, and you can build agents that handle complex, multi-step tasks reliably.

Start with simple patterns, combine as needed, and always keep your graphs testable and observable.
