---
title: "Stateful AI Agents: Managing Context and Memory"
description: "All require state management beyond simple request-response."
author: Michael John Peña
draft: false
date: 2024-07-14
tags:
  - AI
  - Agents
  - State Management
  - LangGraph
  - Memory
---

## The State Challenge

Consider these scenarios:
- A data assistant that remembers your schema preferences
- A debugging agent that tracks what it's already tried
- A report generator that builds up analysis incrementally

All require state management beyond simple request-response.

## State Design Principles

```python
from typing import TypedDict, Annotated, Optional, Any
from operator import add
from datetime import datetime

class WellDesignedState(TypedDict):
    # Immutable context (set once)
    session_id: str
    user_id: str
    started_at: str

    # Accumulated data (grows over time)
    messages: Annotated[list[dict], add]
    artifacts: Annotated[list[str], add]
    tool_calls: Annotated[list[dict], add]

    # Current working data (changes each step)
    current_task: str
    current_step: str
    working_memory: dict

    # Output
    final_result: Optional[str]

    # Control flow
    iteration_count: int
    max_iterations: int
    should_stop: bool
    error: Optional[str]
```

**Key principles:**

1. **Separate concerns**: Context vs. accumulated vs. working data
2. **Use accumulation operators**: `Annotated[list, add]` for appending
3. **Include control flow state**: Iteration counts, stop flags
4. **Plan for errors**: Error fields for graceful handling

## Implementing Stateful Patterns

### Session State with Checkpointing

```python
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.sqlite import SqliteSaver
import sqlite3

class SessionState(TypedDict):
    session_id: str
    messages: Annotated[list[dict], add]
    context: dict
    last_activity: str

def update_activity(state: SessionState) -> SessionState:
    return {"last_activity": datetime.utcnow().isoformat()}

def process_message(state: SessionState) -> SessionState:
    # Process the latest message
    latest = state["messages"][-1] if state["messages"] else None
    if not latest:
        return {}

    # Generate response based on full context
    response = generate_response(latest, state["context"])

    return {
        "messages": [{"role": "assistant", "content": response}]
    }

def generate_response(message: dict, context: dict) -> str:
    # Use context for personalized response
    return f"Responding to: {message['content']} with context: {context}"

# Build graph
graph = StateGraph(SessionState)
graph.add_node("update_activity", update_activity)
graph.add_node("process", process_message)

graph.set_entry_point("update_activity")
graph.add_edge("update_activity", "process")
graph.add_edge("process", END)

# Persist state with checkpointing
conn = sqlite3.connect("sessions.db", check_same_thread=False)
checkpointer = SqliteSaver(conn)

agent = graph.compile(checkpointer=checkpointer)

# Each session maintains its own state
def chat(session_id: str, user_message: str):
    config = {"configurable": {"thread_id": session_id}}

    result = agent.invoke(
        {
            "session_id": session_id,
            "messages": [{"role": "user", "content": user_message}],
            "context": {},
            "last_activity": ""
        },
        config
    )

    return result

# Session 1
chat("session-001", "What tables do we have?")
chat("session-001", "Show me the customers table")  # Remembers previous context

# Session 2 (independent state)
chat("session-002", "Different conversation entirely")
```

### Accumulating Knowledge

```python
class KnowledgeState(TypedDict):
    query: str
    discovered_facts: Annotated[list[str], add]
    explored_sources: Annotated[list[str], add]
    knowledge_graph: dict  # Structured knowledge
    answer: str

def explore_source(state: KnowledgeState) -> KnowledgeState:
    """Explore a source and extract facts."""
    # Find unexplored sources
    all_sources = ["database", "documentation", "api", "logs"]
    unexplored = [s for s in all_sources if s not in state["explored_sources"]]

    if not unexplored:
        return {}

    source = unexplored[0]
    facts = extract_facts_from_source(source, state["query"])

    return {
        "discovered_facts": facts,
        "explored_sources": [source]
    }

def extract_facts_from_source(source: str, query: str) -> list[str]:
    """Extract relevant facts from a source."""
    # Simulated extraction
    return [f"Fact from {source} about {query}"]

def update_knowledge_graph(state: KnowledgeState) -> KnowledgeState:
    """Update structured knowledge from facts."""
    kg = state.get("knowledge_graph", {})

    for fact in state["discovered_facts"]:
        # Parse and add to knowledge graph
        if "entities" not in kg:
            kg["entities"] = []
        kg["entities"].append({"fact": fact, "source": state["explored_sources"][-1]})

    return {"knowledge_graph": kg}

def synthesize_answer(state: KnowledgeState) -> KnowledgeState:
    """Generate answer from accumulated knowledge."""
    facts = state["discovered_facts"]
    kg = state["knowledge_graph"]

    answer = f"""
    Based on exploration of {len(state['explored_sources'])} sources,
    I found {len(facts)} relevant facts.

    Key findings:
    {chr(10).join(f'- {f}' for f in facts[:5])}
    """

    return {"answer": answer}

def should_continue_exploration(state: KnowledgeState) -> str:
    """Decide whether to explore more sources."""
    all_sources = ["database", "documentation", "api", "logs"]
    explored = state.get("explored_sources", [])

    if len(explored) >= len(all_sources):
        return "synthesize"
    if len(state.get("discovered_facts", [])) >= 10:
        return "synthesize"

    return "explore"

graph = StateGraph(KnowledgeState)

graph.add_node("explore", explore_source)
graph.add_node("update_kg", update_knowledge_graph)
graph.add_node("synthesize", synthesize_answer)

graph.set_entry_point("explore")
graph.add_edge("explore", "update_kg")

graph.add_conditional_edges(
    "update_kg",
    should_continue_exploration,
    {"explore": "explore", "synthesize": "synthesize"}
)

graph.add_edge("synthesize", END)

knowledge_agent = graph.compile()
```

### Working Memory Pattern

For complex tasks, maintain a scratchpad:

```python
class WorkingMemoryState(TypedDict):
    task: str
    working_memory: dict  # Scratchpad for intermediate results
    steps_completed: Annotated[list[str], add]
    final_output: str

def initialize_working_memory(state: WorkingMemoryState) -> WorkingMemoryState:
    """Set up working memory structure."""
    return {
        "working_memory": {
            "hypotheses": [],
            "evidence": [],
            "rejected": [],
            "current_focus": None,
            "confidence": 0.0
        }
    }

def generate_hypothesis(state: WorkingMemoryState) -> WorkingMemoryState:
    """Generate hypothesis and store in working memory."""
    wm = state["working_memory"].copy()

    hypothesis = f"Hypothesis about {state['task']}"
    wm["hypotheses"].append(hypothesis)
    wm["current_focus"] = hypothesis

    return {
        "working_memory": wm,
        "steps_completed": ["generated_hypothesis"]
    }

def gather_evidence(state: WorkingMemoryState) -> WorkingMemoryState:
    """Gather evidence for current hypothesis."""
    wm = state["working_memory"].copy()

    evidence = f"Evidence for: {wm['current_focus']}"
    wm["evidence"].append({
        "hypothesis": wm["current_focus"],
        "evidence": evidence,
        "supports": True
    })

    # Update confidence
    supporting = sum(1 for e in wm["evidence"] if e["supports"])
    wm["confidence"] = supporting / max(len(wm["evidence"]), 1)

    return {
        "working_memory": wm,
        "steps_completed": ["gathered_evidence"]
    }

def evaluate_hypothesis(state: WorkingMemoryState) -> WorkingMemoryState:
    """Evaluate current hypothesis based on evidence."""
    wm = state["working_memory"].copy()

    if wm["confidence"] < 0.5:
        wm["rejected"].append(wm["current_focus"])
        wm["hypotheses"] = [h for h in wm["hypotheses"] if h != wm["current_focus"]]
        wm["current_focus"] = None

    return {
        "working_memory": wm,
        "steps_completed": ["evaluated_hypothesis"]
    }

def decide_next_step(state: WorkingMemoryState) -> str:
    """Decide what to do next based on working memory."""
    wm = state["working_memory"]

    if wm["confidence"] >= 0.8:
        return "conclude"
    if wm["current_focus"] is None and wm["hypotheses"]:
        return "focus_next"
    if len(wm["hypotheses"]) < 3:
        return "generate"
    if len(wm["evidence"]) < 5:
        return "gather"

    return "conclude"

def conclude(state: WorkingMemoryState) -> WorkingMemoryState:
    """Generate final output from working memory."""
    wm = state["working_memory"]

    output = f"""
    Task: {state['task']}

    Analysis complete with {wm['confidence']:.0%} confidence.

    Accepted hypotheses: {wm['hypotheses']}
    Rejected hypotheses: {wm['rejected']}

    Evidence gathered: {len(wm['evidence'])} items

    Steps completed: {', '.join(state['steps_completed'])}
    """

    return {"final_output": output}
```

### External State Storage

For production, use external storage:

```python
from abc import ABC, abstractmethod
import json
import redis

class StateStore(ABC):
    @abstractmethod
    def save(self, session_id: str, state: dict) -> None:
        pass

    @abstractmethod
    def load(self, session_id: str) -> dict:
        pass

    @abstractmethod
    def delete(self, session_id: str) -> None:
        pass

class RedisStateStore(StateStore):
    def __init__(self, redis_url: str, ttl_seconds: int = 3600):
        self.client = redis.from_url(redis_url)
        self.ttl = ttl_seconds

    def save(self, session_id: str, state: dict) -> None:
        key = f"agent_state:{session_id}"
        self.client.setex(key, self.ttl, json.dumps(state))

    def load(self, session_id: str) -> dict:
        key = f"agent_state:{session_id}"
        data = self.client.get(key)
        return json.loads(data) if data else {}

    def delete(self, session_id: str) -> None:
        key = f"agent_state:{session_id}"
        self.client.delete(key)

class CosmosDBStateStore(StateStore):
    def __init__(self, connection_string: str, database: str, container: str):
        from azure.cosmos import CosmosClient
        client = CosmosClient.from_connection_string(connection_string)
        self.container = client.get_database_client(database).get_container_client(container)

    def save(self, session_id: str, state: dict) -> None:
        document = {
            "id": session_id,
            "state": state,
            "updated_at": datetime.utcnow().isoformat()
        }
        self.container.upsert_item(document)

    def load(self, session_id: str) -> dict:
        try:
            document = self.container.read_item(session_id, partition_key=session_id)
            return document.get("state", {})
        except:
            return {}

    def delete(self, session_id: str) -> None:
        try:
            self.container.delete_item(session_id, partition_key=session_id)
        except:
            pass

# Usage with agent
class StatefulAgent:
    def __init__(self, graph, state_store: StateStore):
        self.graph = graph
        self.state_store = state_store

    def invoke(self, session_id: str, input_data: dict) -> dict:
        # Load existing state
        state = self.state_store.load(session_id)

        # Merge with input
        state.update(input_data)

        # Run graph
        result = self.graph.invoke(state)

        # Save updated state
        self.state_store.save(session_id, result)

        return result
```

## State Isolation and Security

```python
class SecureStateManager:
    def __init__(self, store: StateStore, encryption_key: bytes):
        self.store = store
        self.key = encryption_key

    def save(self, session_id: str, state: dict, user_id: str) -> None:
        """Save state with user ownership."""
        wrapped = {
            "owner": user_id,
            "state": self._encrypt(state),
            "created_at": datetime.utcnow().isoformat()
        }
        self.store.save(session_id, wrapped)

    def load(self, session_id: str, user_id: str) -> dict:
        """Load state with ownership verification."""
        wrapped = self.store.load(session_id)

        if not wrapped:
            return {}

        if wrapped.get("owner") != user_id:
            raise PermissionError("User does not own this session")

        return self._decrypt(wrapped["state"])

    def _encrypt(self, data: dict) -> str:
        from cryptography.fernet import Fernet
        f = Fernet(self.key)
        return f.encrypt(json.dumps(data).encode()).decode()

    def _decrypt(self, encrypted: str) -> dict:
        from cryptography.fernet import Fernet
        f = Fernet(self.key)
        return json.loads(f.decrypt(encrypted.encode()))
```

## Best Practices

1. **Design state schema upfront**: Know what you need to track
2. **Use typed state**: TypedDict provides documentation and validation
3. **Separate concerns**: Context, working data, and output
4. **Plan for persistence**: Choose appropriate storage early
5. **Handle state corruption**: Validate on load, have recovery paths
6. **Implement TTL**: Clean up old sessions automatically
7. **Consider multi-tenancy**: Isolate state between users

## Conclusion

Stateful agents enable sophisticated AI applications that maintain context and accumulate knowledge. The key is thoughtful state design and appropriate persistence strategies.

Start with simple in-memory state, add persistence as needed, and always consider security and isolation in production deployments.
