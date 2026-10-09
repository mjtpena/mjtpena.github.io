---
title: "Conditional Edges in LangGraph: Dynamic Agent Flows"
author: Michael John Peña
draft: false
date: 2024-07-15
tags:
  - AI
  - LangGraph
  - Agents
  - Python
  - Control Flow
---

## Basic Conditional Edges

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Literal

class TaskState(TypedDict):
    input: str
    task_type: str
    complexity: str
    result: str

def analyze_task(state: TaskState) -> TaskState:
    """Analyze input to determine task type and complexity."""
    input_text = state["input"].lower()

    # Determine task type
    if "sql" in input_text or "query" in input_text:
        task_type = "database"
    elif "code" in input_text or "function" in input_text:
        task_type = "coding"
    elif "explain" in input_text or "what is" in input_text:
        task_type = "explanation"
    else:
        task_type = "general"

    # Determine complexity
    word_count = len(input_text.split())
    complexity = "complex" if word_count > 50 else "simple"

    return {"task_type": task_type, "complexity": complexity}

def route_by_type(state: TaskState) -> Literal["database", "coding", "explanation", "general"]:
    """Route based on task type."""
    return state["task_type"]

# Build graph with conditional routing
graph = StateGraph(TaskState)
graph.add_node("analyze", analyze_task)
graph.add_node("database", handle_database)
graph.add_node("coding", handle_coding)
graph.add_node("explanation", handle_explanation)
graph.add_node("general", handle_general)

graph.set_entry_point("analyze")

# Add conditional edges
graph.add_conditional_edges(
    "analyze",
    route_by_type,
    {
        "database": "database",
        "coding": "coding",
        "explanation": "explanation",
        "general": "general"
    }
)

# All handlers end
for node in ["database", "coding", "explanation", "general"]:
    graph.add_edge(node, END)

app = graph.compile()
```

## Multi-Factor Routing

Route based on multiple state attributes:

```python
from typing import Literal

class ComplexState(TypedDict):
    input: str
    user_tier: str  # "free", "pro", "enterprise"
    task_type: str
    urgency: str    # "low", "medium", "high"
    requires_approval: bool
    result: str

def multi_factor_route(state: ComplexState) -> Literal[
    "premium_fast", "premium_standard", "standard", "queue", "approval"
]:
    """Route based on multiple factors."""

    # High urgency enterprise users get premium fast track
    if state["user_tier"] == "enterprise" and state["urgency"] == "high":
        return "premium_fast"

    # Any task requiring approval goes to approval flow
    if state["requires_approval"]:
        return "approval"

    # Pro users get premium standard
    if state["user_tier"] == "pro":
        return "premium_standard"

    # Free users with high urgency still get standard
    if state["urgency"] == "high":
        return "standard"

    # Everything else goes to queue
    return "queue"

graph = StateGraph(ComplexState)

# Add all nodes
graph.add_node("classify", classify_request)
graph.add_node("premium_fast", handle_premium_fast)
graph.add_node("premium_standard", handle_premium_standard)
graph.add_node("standard", handle_standard)
graph.add_node("queue", handle_queued)
graph.add_node("approval", handle_approval_flow)

graph.set_entry_point("classify")

graph.add_conditional_edges(
    "classify",
    multi_factor_route,
    {
        "premium_fast": "premium_fast",
        "premium_standard": "premium_standard",
        "standard": "standard",
        "queue": "queue",
        "approval": "approval"
    }
)
```

## Dynamic Edge Creation

Sometimes you don't know all routes ahead of time:

```python
from typing import Callable

class DynamicRouter:
    def __init__(self):
        self.routes: dict[str, Callable] = {}

    def register_route(self, name: str, condition: Callable[[dict], bool], handler: Callable):
        """Register a route dynamically."""
        self.routes[name] = {"condition": condition, "handler": handler}

    def route(self, state: dict) -> str:
        """Find matching route."""
        for name, route_config in self.routes.items():
            if route_config["condition"](state):
                return name
        return "default"

    def build_graph(self, state_class, entry_node: str):
        """Build graph with registered routes."""
        graph = StateGraph(state_class)

        # Add entry node
        graph.add_node(entry_node, self._analyze)
        graph.set_entry_point(entry_node)

        # Add route handlers
        route_mapping = {}
        for name, config in self.routes.items():
            graph.add_node(name, config["handler"])
            graph.add_edge(name, END)
            route_mapping[name] = name

        # Add default
        graph.add_node("default", self._default_handler)
        graph.add_edge("default", END)
        route_mapping["default"] = "default"

        # Add conditional edges
        graph.add_conditional_edges(entry_node, self.route, route_mapping)

        return graph.compile()

    def _analyze(self, state: dict) -> dict:
        return state

    def _default_handler(self, state: dict) -> dict:
        return {"result": "Handled by default"}

# Usage
router = DynamicRouter()

router.register_route(
    "sql_query",
    lambda s: "SELECT" in s.get("input", "").upper(),
    lambda s: {"result": "SQL handler"}
)

router.register_route(
    "python_code",
    lambda s: "def " in s.get("input", "") or "import " in s.get("input", ""),
    lambda s: {"result": "Python handler"}
)

app = router.build_graph(TaskState, "analyze")
```

## Chained Conditions

Multiple decision points in sequence:

```python
class PipelineState(TypedDict):
    data: str
    is_valid: bool
    is_sensitive: bool
    needs_transformation: bool
    result: str

def validate_data(state: PipelineState) -> PipelineState:
    """Check if data is valid."""
    is_valid = len(state["data"]) > 0 and "error" not in state["data"].lower()
    return {"is_valid": is_valid}

def check_sensitivity(state: PipelineState) -> PipelineState:
    """Check if data contains sensitive information."""
    sensitive_patterns = ["ssn", "password", "secret", "credit"]
    is_sensitive = any(p in state["data"].lower() for p in sensitive_patterns)
    return {"is_sensitive": is_sensitive}

def check_transformation(state: PipelineState) -> PipelineState:
    """Check if data needs transformation."""
    needs_transform = "raw_" in state["data"] or "unprocessed" in state["data"]
    return {"needs_transformation": needs_transform}

def route_after_validation(state: PipelineState) -> Literal["check_sensitive", "reject"]:
    return "check_sensitive" if state["is_valid"] else "reject"

def route_after_sensitivity(state: PipelineState) -> Literal["check_transform", "mask"]:
    return "mask" if state["is_sensitive"] else "check_transform"

def route_after_transform_check(state: PipelineState) -> Literal["transform", "process"]:
    return "transform" if state["needs_transformation"] else "process"

# Build chained conditional graph
graph = StateGraph(PipelineState)

graph.add_node("validate", validate_data)
graph.add_node("check_sensitive", check_sensitivity)
graph.add_node("check_transform", check_transformation)
graph.add_node("reject", lambda s: {"result": "Rejected: invalid data"})
graph.add_node("mask", lambda s: {"result": "Masked sensitive data"})
graph.add_node("transform", lambda s: {"result": "Transformed data"})
graph.add_node("process", lambda s: {"result": "Processed data"})

graph.set_entry_point("validate")

# Chain of conditions
graph.add_conditional_edges("validate", route_after_validation,
    {"check_sensitive": "check_sensitive", "reject": "reject"})

graph.add_conditional_edges("check_sensitive", route_after_sensitivity,
    {"check_transform": "check_transform", "mask": "mask"})

graph.add_conditional_edges("check_transform", route_after_transform_check,
    {"transform": "transform", "process": "process"})

# Terminal nodes
for node in ["reject", "mask", "transform", "process"]:
    graph.add_edge(node, END)

pipeline = graph.compile()
```

## Probabilistic Routing

Route with randomization for A/B testing or load balancing:

```python
import random
from typing import Literal

class ABTestState(TypedDict):
    input: str
    variant: str
    result: str
    metrics: dict

def probabilistic_route(state: ABTestState) -> Literal["variant_a", "variant_b", "control"]:
    """Route with probability weights."""
    weights = {
        "variant_a": 0.3,
        "variant_b": 0.3,
        "control": 0.4
    }

    r = random.random()
    cumulative = 0

    for variant, weight in weights.items():
        cumulative += weight
        if r < cumulative:
            return variant

    return "control"

def deterministic_ab_route(state: ABTestState) -> Literal["variant_a", "variant_b", "control"]:
    """Deterministic routing based on user/session ID."""
    # Use hash for consistent routing
    import hashlib
    session_id = state.get("session_id", state["input"])
    hash_val = int(hashlib.md5(session_id.encode()).hexdigest(), 16)
    bucket = hash_val % 100

    if bucket < 30:
        return "variant_a"
    elif bucket < 60:
        return "variant_b"
    else:
        return "control"

# Build A/B test graph
graph = StateGraph(ABTestState)

graph.add_node("assign", lambda s: s)  # Just passes through
graph.add_node("variant_a", handle_variant_a)
graph.add_node("variant_b", handle_variant_b)
graph.add_node("control", handle_control)
graph.add_node("track", track_metrics)

graph.set_entry_point("assign")

graph.add_conditional_edges(
    "assign",
    deterministic_ab_route,
    {
        "variant_a": "variant_a",
        "variant_b": "variant_b",
        "control": "control"
    }
)

# All variants go to tracking
for node in ["variant_a", "variant_b", "control"]:
    graph.add_edge(node, "track")

graph.add_edge("track", END)
```

## Error-Based Routing

Route based on errors and recovery:

```python
from typing import Literal, Optional

class ErrorHandlingState(TypedDict):
    input: str
    result: Optional[str]
    error: Optional[str]
    error_type: Optional[str]
    retry_count: int
    max_retries: int

def process_with_error_handling(state: ErrorHandlingState) -> ErrorHandlingState:
    """Process input, capturing any errors."""
    try:
        # Simulated processing that might fail
        if "fail" in state["input"]:
            raise ValueError("Simulated failure")

        result = f"Processed: {state['input']}"
        return {"result": result, "error": None, "error_type": None}

    except ValueError as e:
        return {
            "error": str(e),
            "error_type": "validation",
            "retry_count": state["retry_count"] + 1
        }
    except ConnectionError as e:
        return {
            "error": str(e),
            "error_type": "connection",
            "retry_count": state["retry_count"] + 1
        }
    except Exception as e:
        return {
            "error": str(e),
            "error_type": "unknown",
            "retry_count": state["retry_count"] + 1
        }

def route_on_error(state: ErrorHandlingState) -> Literal["success", "retry", "fallback", "fail"]:
    """Route based on processing result."""
    if state.get("result") and not state.get("error"):
        return "success"

    if state["retry_count"] >= state["max_retries"]:
        return "fail"

    error_type = state.get("error_type", "unknown")

    # Retry transient errors
    if error_type == "connection":
        return "retry"

    # Use fallback for validation errors
    if error_type == "validation":
        return "fallback"

    # Unknown errors fail
    return "fail"

# Build error handling graph
graph = StateGraph(ErrorHandlingState)

graph.add_node("process", process_with_error_handling)
graph.add_node("success", lambda s: {"result": f"Success: {s['result']}"})
graph.add_node("retry", lambda s: s)  # Will loop back to process
graph.add_node("fallback", lambda s: {"result": "Fallback result"})
graph.add_node("fail", lambda s: {"result": f"Failed after {s['retry_count']} attempts: {s['error']}"})

graph.set_entry_point("process")

graph.add_conditional_edges(
    "process",
    route_on_error,
    {
        "success": "success",
        "retry": "retry",
        "fallback": "fallback",
        "fail": "fail"
    }
)

# Retry loops back to process
graph.add_edge("retry", "process")

# Terminal nodes
graph.add_edge("success", END)
graph.add_edge("fallback", END)
graph.add_edge("fail", END)

error_handler = graph.compile()
```

## Testing Conditional Edges

Always test your routing logic:

```python
import pytest

def test_routing_logic():
    """Test routing function in isolation."""

    # Test database routing
    state = {"input": "Write a SQL query", "task_type": "", "complexity": "", "result": ""}
    analyzed = analyze_task(state)
    assert route_by_type(analyzed) == "database"

    # Test coding routing
    state = {"input": "Write a Python function", "task_type": "", "complexity": "", "result": ""}
    analyzed = analyze_task(state)
    assert route_by_type(analyzed) == "coding"

    # Test explanation routing
    state = {"input": "What is Azure Synapse?", "task_type": "", "complexity": "", "result": ""}
    analyzed = analyze_task(state)
    assert route_by_type(analyzed) == "explanation"

def test_multi_factor_routing():
    """Test complex routing logic."""

    # Enterprise + High urgency = premium_fast
    state = {
        "input": "test",
        "user_tier": "enterprise",
        "task_type": "query",
        "urgency": "high",
        "requires_approval": False,
        "result": ""
    }
    assert multi_factor_route(state) == "premium_fast"

    # Requires approval overrides everything
    state["requires_approval"] = True
    assert multi_factor_route(state) == "approval"

def test_full_graph_routing():
    """Test routing through full graph execution."""
    result = app.invoke({
        "input": "SELECT * FROM users WHERE active = true",
        "task_type": "",
        "complexity": "",
        "result": ""
    })

    assert result["task_type"] == "database"
    assert "database" in result["result"].lower() or result["result"] != ""
```

## Best Practices

1. **Keep routing functions pure**: No side effects, just return the route
2. **Use type hints**: `Literal` types catch routing errors at development time
3. **Test routing separately**: Unit test routing logic before full graph tests
4. **Log routing decisions**: Track which paths are taken in production
5. **Have a default route**: Always handle unexpected cases
6. **Document routing logic**: Complex routing needs clear documentation

## Conclusion

Conditional edges are the decision-making backbone of intelligent agents. Master them, and you can build agents that adapt to any situation.

Start with simple binary decisions, build up to multi-factor routing, and always test your routing logic thoroughly.
