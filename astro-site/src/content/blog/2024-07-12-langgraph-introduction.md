---
title: "LangGraph Introduction: Building Stateful AI Agents"
description: "LangGraph provides these capabilities through a graph-based execution model."
author: Michael John Peña
draft: false
date: 2024-07-12
tags:
  - AI
  - LangGraph
  - Agents
  - Python
  - LLM
---

## Why LangGraph?

Traditional chains are linear: A -> B -> C. But real-world AI applications often need:

- **Cycles**: Retry until success, iterative refinement
- **Conditional branching**: Different paths based on LLM output
- **Persistent state**: Remember context across nodes
- **Human-in-the-loop**: Pause for human input at specific points

LangGraph provides these capabilities through a graph-based execution model.

## Basic Concepts

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Annotated
from operator import add

# Define state schema
class AgentState(TypedDict):
    messages: Annotated[list, add]  # Messages accumulate
    current_step: str
    iteration_count: int
    final_answer: str

# Create graph
graph = StateGraph(AgentState)

# Define nodes (functions that process state)
def analyze_request(state: AgentState) -> AgentState:
    """First node: analyze the user request."""
    messages = state["messages"]
    # Process and return updated state
    return {
        "current_step": "analysis_complete",
        "messages": [{"role": "system", "content": "Request analyzed"}]
    }

def generate_response(state: AgentState) -> AgentState:
    """Generate response based on analysis."""
    # Generate response logic
    return {
        "current_step": "response_generated",
        "final_answer": "Generated response here"
    }

# Add nodes to graph
graph.add_node("analyze", analyze_request)
graph.add_node("generate", generate_response)

# Define edges (transitions)
graph.set_entry_point("analyze")
graph.add_edge("analyze", "generate")
graph.add_edge("generate", END)

# Compile and run
app = graph.compile()
result = app.invoke({
    "messages": [{"role": "user", "content": "Help me optimize this SQL query"}],
    "current_step": "start",
    "iteration_count": 0,
    "final_answer": ""
})
```

## Conditional Edges

Route to different nodes based on state:

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Literal

class QueryState(TypedDict):
    query: str
    query_type: str
    result: str

def classify_query(state: QueryState) -> QueryState:
    """Classify the type of query."""
    query = state["query"].lower()

    if "select" in query or "from" in query:
        query_type = "sql"
    elif "create" in query or "build" in query:
        query_type = "creation"
    else:
        query_type = "general"

    return {"query_type": query_type}

def handle_sql(state: QueryState) -> QueryState:
    """Handle SQL-related queries."""
    return {"result": f"SQL Analysis: {state['query']}"}

def handle_creation(state: QueryState) -> QueryState:
    """Handle creation requests."""
    return {"result": f"Creation Plan: {state['query']}"}

def handle_general(state: QueryState) -> QueryState:
    """Handle general queries."""
    return {"result": f"General Response: {state['query']}"}

def route_query(state: QueryState) -> Literal["sql", "creation", "general"]:
    """Determine which handler to use."""
    return state["query_type"]

# Build graph
graph = StateGraph(QueryState)

graph.add_node("classify", classify_query)
graph.add_node("sql", handle_sql)
graph.add_node("creation", handle_creation)
graph.add_node("general", handle_general)

graph.set_entry_point("classify")

# Conditional routing
graph.add_conditional_edges(
    "classify",
    route_query,
    {
        "sql": "sql",
        "creation": "creation",
        "general": "general"
    }
)

# All handlers go to END
graph.add_edge("sql", END)
graph.add_edge("creation", END)
graph.add_edge("general", END)

app = graph.compile()

# Test different queries
result = app.invoke({"query": "SELECT * FROM users WHERE active = 1"})
print(result["result"])  # SQL Analysis: ...

result = app.invoke({"query": "Create a new data pipeline"})
print(result["result"])  # Creation Plan: ...
```

## Cycles and Iteration

LangGraph supports cycles for iterative refinement:

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Literal
from langchain_openai import AzureChatOpenAI

class RefinementState(TypedDict):
    task: str
    current_solution: str
    feedback: str
    iteration: int
    max_iterations: int
    is_acceptable: bool

llm = AzureChatOpenAI(azure_deployment="gpt-4o")

def generate_solution(state: RefinementState) -> RefinementState:
    """Generate or refine solution."""
    if state["iteration"] == 0:
        prompt = f"Create a solution for: {state['task']}"
    else:
        prompt = f"""
        Improve this solution based on feedback:

        Current solution: {state['current_solution']}
        Feedback: {state['feedback']}

        Provide an improved version.
        """

    response = llm.invoke(prompt)

    return {
        "current_solution": response.content,
        "iteration": state["iteration"] + 1
    }

def evaluate_solution(state: RefinementState) -> RefinementState:
    """Evaluate the current solution."""
    prompt = f"""
    Evaluate this solution for the task: {state['task']}

    Solution: {state['current_solution']}

    Is this solution acceptable? Answer with 'acceptable' or provide specific feedback for improvement.
    """

    response = llm.invoke(prompt)
    content = response.content.lower()

    is_acceptable = "acceptable" in content
    feedback = "" if is_acceptable else response.content

    return {
        "feedback": feedback,
        "is_acceptable": is_acceptable
    }

def should_continue(state: RefinementState) -> Literal["generate", "end"]:
    """Decide whether to continue refining."""
    if state["is_acceptable"]:
        return "end"
    if state["iteration"] >= state["max_iterations"]:
        return "end"
    return "generate"

# Build graph with cycle
graph = StateGraph(RefinementState)

graph.add_node("generate", generate_solution)
graph.add_node("evaluate", evaluate_solution)

graph.set_entry_point("generate")
graph.add_edge("generate", "evaluate")

# Conditional edge that can loop back
graph.add_conditional_edges(
    "evaluate",
    should_continue,
    {
        "generate": "generate",  # Loop back
        "end": END
    }
)

app = graph.compile()

# Run with iterative refinement
result = app.invoke({
    "task": "Write a Python function to calculate Fibonacci numbers efficiently",
    "current_solution": "",
    "feedback": "",
    "iteration": 0,
    "max_iterations": 3,
    "is_acceptable": False
})

print(f"Final solution after {result['iteration']} iterations:")
print(result["current_solution"])
```

## Data Engineering Agent Example

A practical example for data work:

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Literal, Optional
from langchain_openai import AzureChatOpenAI
from langchain_core.tools import tool
import json

class DataAgentState(TypedDict):
    user_request: str
    intent: str
    sql_query: Optional[str]
    query_result: Optional[str]
    analysis: Optional[str]
    final_response: str
    error: Optional[str]

llm = AzureChatOpenAI(azure_deployment="gpt-4o")

@tool
def execute_sql(query: str) -> str:
    """Execute SQL query against the data warehouse."""
    # In production, this would execute against actual database
    # Simulated response for demonstration
    if "error" in query.lower():
        raise Exception("SQL syntax error")
    return json.dumps([
        {"product": "Widget A", "sales": 15000},
        {"product": "Widget B", "sales": 12000},
        {"product": "Widget C", "sales": 8500}
    ])

def understand_intent(state: DataAgentState) -> DataAgentState:
    """Understand what the user wants."""
    prompt = f"""
    Classify this data request into one of these categories:
    - query: User wants to retrieve specific data
    - analyze: User wants analysis or insights
    - explain: User wants explanation of concepts
    - create: User wants to create something (pipeline, table, etc.)

    Request: {state['user_request']}

    Respond with just the category name.
    """

    response = llm.invoke(prompt)
    return {"intent": response.content.strip().lower()}

def generate_sql(state: DataAgentState) -> DataAgentState:
    """Generate SQL query for data retrieval."""
    prompt = f"""
    Generate a SQL query for Azure Synapse Analytics to answer:
    {state['user_request']}

    Available tables:
    - sales (date, product_id, region, amount, quantity)
    - products (product_id, name, category, price)
    - customers (customer_id, name, segment, region)

    Return only the SQL query, no explanation.
    """

    response = llm.invoke(prompt)
    return {"sql_query": response.content.strip()}

def run_query(state: DataAgentState) -> DataAgentState:
    """Execute the generated SQL query."""
    try:
        result = execute_sql.invoke(state["sql_query"])
        return {"query_result": result}
    except Exception as e:
        return {"error": str(e)}

def analyze_results(state: DataAgentState) -> DataAgentState:
    """Analyze query results."""
    prompt = f"""
    Analyze these query results in the context of the user's question:

    Question: {state['user_request']}
    Results: {state['query_result']}

    Provide insights and key observations.
    """

    response = llm.invoke(prompt)
    return {"analysis": response.content}

def generate_response(state: DataAgentState) -> DataAgentState:
    """Generate final user response."""
    if state.get("error"):
        return {"final_response": f"I encountered an error: {state['error']}"}

    if state.get("analysis"):
        return {"final_response": state["analysis"]}

    if state.get("query_result"):
        return {"final_response": f"Query results: {state['query_result']}"}

    return {"final_response": "I processed your request."}

def handle_explanation(state: DataAgentState) -> DataAgentState:
    """Handle explanation requests."""
    prompt = f"""
    Explain the following in the context of data engineering:
    {state['user_request']}

    Be clear and include examples where helpful.
    """

    response = llm.invoke(prompt)
    return {"final_response": response.content}

def route_intent(state: DataAgentState) -> Literal["query", "analyze", "explain", "general"]:
    """Route based on detected intent."""
    intent = state.get("intent", "general")
    if intent in ["query", "analyze"]:
        return "query"
    elif intent == "explain":
        return "explain"
    return "general"

def route_after_query(state: DataAgentState) -> Literal["analyze", "respond"]:
    """Route after query execution."""
    if state.get("error"):
        return "respond"
    if "analyze" in state.get("intent", ""):
        return "analyze"
    return "respond"

# Build the graph
graph = StateGraph(DataAgentState)

# Add nodes
graph.add_node("understand", understand_intent)
graph.add_node("generate_sql", generate_sql)
graph.add_node("run_query", run_query)
graph.add_node("analyze", analyze_results)
graph.add_node("explain", handle_explanation)
graph.add_node("respond", generate_response)

# Set entry and edges
graph.set_entry_point("understand")

graph.add_conditional_edges(
    "understand",
    route_intent,
    {
        "query": "generate_sql",
        "analyze": "generate_sql",
        "explain": "explain",
        "general": "respond"
    }
)

graph.add_edge("generate_sql", "run_query")

graph.add_conditional_edges(
    "run_query",
    route_after_query,
    {
        "analyze": "analyze",
        "respond": "respond"
    }
)

graph.add_edge("analyze", "respond")
graph.add_edge("explain", END)
graph.add_edge("respond", END)

# Compile
app = graph.compile()

# Test queries
queries = [
    "What were our top selling products last month?",
    "Explain what a star schema is",
    "Analyze our sales trends by region"
]

for query in queries:
    result = app.invoke({
        "user_request": query,
        "intent": "",
        "sql_query": None,
        "query_result": None,
        "analysis": None,
        "final_response": "",
        "error": None
    })
    print(f"\nQuery: {query}")
    print(f"Response: {result['final_response'][:200]}...")
```

## Visualization

LangGraph provides graph visualization:

```python
from langgraph.graph import StateGraph
from IPython.display import Image, display

# After building your graph
graph = StateGraph(DataAgentState)
# ... add nodes and edges ...

app = graph.compile()

# Visualize
display(Image(app.get_graph().draw_png()))

# Or save to file
app.get_graph().draw_png("agent_graph.png")
```

## Best Practices

1. **Keep nodes focused**: Each node should do one thing well
2. **Use TypedDict for state**: Provides type safety and documentation
3. **Handle errors in state**: Don't raise exceptions; capture them in state
4. **Limit iterations**: Always set max iterations for cycles
5. **Test edges independently**: Verify routing logic works correctly

## Conclusion

LangGraph brings structure to complex AI workflows. When your application needs cycles, conditional logic, or persistent state, LangGraph provides the primitives to build reliably.

Start with simple graphs, add complexity as needed, and always visualize your graph to understand the flow.
