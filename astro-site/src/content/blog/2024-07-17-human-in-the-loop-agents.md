---
title: "Human-in-the-Loop AI Agents: Building Trust Through Oversight"
author: Michael John Peña
draft: false
date: 2024-07-17
tags:
  - AI
  - Agents
  - Human-in-the-Loop
  - LangGraph
  - Enterprise
---

## When to Use HITL

- **Irreversible actions**: Deletions, payments, deployments
- **High-cost operations**: Expensive API calls, resource provisioning
- **Sensitive data**: PII handling, credential management
- **Learning systems**: Until confidence is established

## Basic HITL Pattern

```python
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.sqlite import SqliteSaver
from typing import TypedDict, Literal, Optional

class HITLState(TypedDict):
    request: str
    analysis: str
    proposed_action: str
    action_details: dict
    human_decision: Optional[str]  # "approve", "reject", "modify"
    human_feedback: Optional[str]
    execution_result: Optional[str]
    status: str

def analyze_request(state: HITLState) -> HITLState:
    """Analyze the incoming request."""
    # In production, use LLM
    analysis = f"Analyzed request: {state['request']}"
    return {"analysis": analysis, "status": "analyzed"}

def propose_action(state: HITLState) -> HITLState:
    """Propose an action for human review."""
    # Generate proposed action
    proposed = f"Proposed action for: {state['request']}"
    details = {
        "action_type": "database_modification",
        "affected_records": 150,
        "reversible": False,
        "estimated_cost": "$0.05"
    }

    return {
        "proposed_action": proposed,
        "action_details": details,
        "status": "awaiting_approval"
    }

def await_human_decision(state: HITLState) -> HITLState:
    """
    Pause point for human input.
    The graph execution stops here until human provides decision.
    """
    # This node doesn't change state - it's a pause point
    # State will be updated externally by the human
    return {}

def execute_action(state: HITLState) -> HITLState:
    """Execute the approved action."""
    # Check if action was modified
    if state["human_decision"] == "modify":
        action = state["human_feedback"]  # Use modified action
    else:
        action = state["proposed_action"]

    # Execute (simulated)
    result = f"Executed: {action}"

    return {
        "execution_result": result,
        "status": "completed"
    }

def handle_rejection(state: HITLState) -> HITLState:
    """Handle rejected actions."""
    return {
        "execution_result": None,
        "status": "rejected",
    }

def route_decision(state: HITLState) -> Literal["execute", "reject", "await"]:
    """Route based on human decision."""
    decision = state.get("human_decision")

    if decision is None:
        return "await"  # Still waiting
    if decision == "reject":
        return "reject"
    return "execute"  # "approve" or "modify"

# Build HITL graph
graph = StateGraph(HITLState)

graph.add_node("analyze", analyze_request)
graph.add_node("propose", propose_action)
graph.add_node("await", await_human_decision)
graph.add_node("execute", execute_action)
graph.add_node("reject", handle_rejection)

graph.set_entry_point("analyze")
graph.add_edge("analyze", "propose")
graph.add_edge("propose", "await")

graph.add_conditional_edges(
    "await",
    route_decision,
    {"execute": "execute", "reject": "reject", "await": "await"}
)

graph.add_edge("execute", END)
graph.add_edge("reject", END)

# Compile with checkpointing for state persistence
checkpointer = SqliteSaver.from_conn_string("hitl_sessions.db")
hitl_agent = graph.compile(checkpointer=checkpointer)
```

## Interacting with HITL Agent

```python
import uuid

class HITLController:
    def __init__(self, agent):
        self.agent = agent
        self.pending_approvals = {}

    def submit_request(self, request: str) -> str:
        """Submit a new request, returns session ID."""
        session_id = str(uuid.uuid4())

        config = {"configurable": {"thread_id": session_id}}

        # Start execution (will pause at await node)
        result = self.agent.invoke(
            {
                "request": request,
                "analysis": "",
                "proposed_action": "",
                "action_details": {},
                "human_decision": None,
                "human_feedback": None,
                "execution_result": None,
                "status": "submitted"
            },
            config
        )

        # Store pending approval
        self.pending_approvals[session_id] = {
            "request": request,
            "proposed_action": result["proposed_action"],
            "details": result["action_details"],
            "status": result["status"]
        }

        return session_id

    def get_pending_approvals(self) -> list[dict]:
        """Get all pending approval requests."""
        return [
            {"session_id": sid, **info}
            for sid, info in self.pending_approvals.items()
            if info["status"] == "awaiting_approval"
        ]

    def approve(self, session_id: str) -> dict:
        """Approve a pending request."""
        return self._decide(session_id, "approve", None)

    def reject(self, session_id: str, reason: str = None) -> dict:
        """Reject a pending request."""
        return self._decide(session_id, "reject", reason)

    def modify_and_approve(self, session_id: str, modified_action: str) -> dict:
        """Modify and approve a pending request."""
        return self._decide(session_id, "modify", modified_action)

    def _decide(self, session_id: str, decision: str, feedback: str) -> dict:
        """Submit human decision and resume execution."""
        if session_id not in self.pending_approvals:
            raise ValueError(f"Unknown session: {session_id}")

        config = {"configurable": {"thread_id": session_id}}

        # Update state with human decision
        self.agent.update_state(
            config,
            {
                "human_decision": decision,
                "human_feedback": feedback
            }
        )

        # Resume execution
        result = self.agent.invoke(None, config)

        # Update tracking
        self.pending_approvals[session_id]["status"] = result["status"]

        return result

# Usage
controller = HITLController(hitl_agent)

# User submits request
session_id = controller.submit_request(
    "Delete all inactive users older than 2 years"
)

# Admin reviews pending approvals
pending = controller.get_pending_approvals()
for approval in pending:
    print(f"Session: {approval['session_id']}")
    print(f"Action: {approval['proposed_action']}")
    print(f"Details: {approval['details']}")

# Admin approves
result = controller.approve(session_id)
print(f"Result: {result['execution_result']}")
```

## Multi-Level Approval

For critical operations, require multiple approvals:

```python
class MultiApprovalState(TypedDict):
    request: str
    proposed_action: str
    required_approvals: int
    current_approvals: list[dict]  # [{approver: str, timestamp: str, decision: str}]
    final_decision: Optional[str]
    execution_result: Optional[str]

def check_approval_status(state: MultiApprovalState) -> Literal["await", "execute", "reject"]:
    """Check if we have enough approvals."""
    approvals = state.get("current_approvals", [])

    # Count approvals and rejections
    approved = sum(1 for a in approvals if a["decision"] == "approve")
    rejected = sum(1 for a in approvals if a["decision"] == "reject")

    # Any rejection stops the process
    if rejected > 0:
        return "reject"

    # Need all required approvals
    if approved >= state["required_approvals"]:
        return "execute"

    return "await"

def add_approval(state: MultiApprovalState, approver: str, decision: str) -> dict:
    """Add an approval to the state."""
    from datetime import datetime

    new_approval = {
        "approver": approver,
        "timestamp": datetime.utcnow().isoformat(),
        "decision": decision
    }

    current = state.get("current_approvals", [])

    # Prevent duplicate approvals
    if any(a["approver"] == approver for a in current):
        raise ValueError(f"{approver} has already submitted a decision")

    return {"current_approvals": current + [new_approval]}

# Build multi-approval graph
graph = StateGraph(MultiApprovalState)

graph.add_node("propose", propose_multi_approval_action)
graph.add_node("await", lambda s: s)  # Pause for approvals
graph.add_node("execute", execute_multi_approval_action)
graph.add_node("reject", reject_multi_approval_action)

graph.set_entry_point("propose")
graph.add_edge("propose", "await")

graph.add_conditional_edges(
    "await",
    check_approval_status,
    {"await": "await", "execute": "execute", "reject": "reject"}
)

graph.add_edge("execute", END)
graph.add_edge("reject", END)

multi_approval_agent = graph.compile(checkpointer=checkpointer)

# Usage for critical operations
def submit_critical_operation(request: str, required_approvals: int = 2):
    session_id = str(uuid.uuid4())
    config = {"configurable": {"thread_id": session_id}}

    result = multi_approval_agent.invoke({
        "request": request,
        "proposed_action": f"Critical: {request}",
        "required_approvals": required_approvals,
        "current_approvals": [],
        "final_decision": None,
        "execution_result": None
    }, config)

    return session_id, result

def add_approver_decision(session_id: str, approver: str, decision: str):
    config = {"configurable": {"thread_id": session_id}}

    # Get current state
    state = multi_approval_agent.get_state(config)

    # Add approval
    update = add_approval(state.values, approver, decision)
    multi_approval_agent.update_state(config, update)

    # Resume to check if we have enough approvals
    return multi_approval_agent.invoke(None, config)
```

## Timeout and Escalation

Handle cases where humans don't respond:

```python
from datetime import datetime, timedelta

class TimedApprovalState(TypedDict):
    request: str
    proposed_action: str
    submitted_at: str
    timeout_minutes: int
    escalation_level: int
    max_escalation: int
    assigned_approver: str
    human_decision: Optional[str]
    execution_result: Optional[str]

def check_timeout(state: TimedApprovalState) -> Literal["await", "escalate", "auto_reject"]:
    """Check if approval has timed out."""
    if state.get("human_decision"):
        return "await"  # Decision made, proceed normally

    submitted = datetime.fromisoformat(state["submitted_at"])
    elapsed = datetime.utcnow() - submitted
    timeout = timedelta(minutes=state["timeout_minutes"])

    if elapsed < timeout:
        return "await"

    # Timed out - escalate or auto-reject
    if state["escalation_level"] < state["max_escalation"]:
        return "escalate"

    return "auto_reject"

def escalate_approval(state: TimedApprovalState) -> TimedApprovalState:
    """Escalate to next approval level."""
    escalation_chain = ["team_lead", "manager", "director", "vp"]

    new_level = state["escalation_level"] + 1
    new_approver = escalation_chain[min(new_level, len(escalation_chain) - 1)]

    # Notify new approver (implementation depends on notification system)
    notify_approver(new_approver, state["request"], state["proposed_action"])

    return {
        "escalation_level": new_level,
        "assigned_approver": new_approver,
        "submitted_at": datetime.utcnow().isoformat()  # Reset timeout
    }

def notify_approver(approver: str, request: str, action: str):
    """Send notification to approver."""
    # Implementation: email, Slack, Teams, etc.
    print(f"Notifying {approver}: Action pending approval - {action}")

def auto_reject_action(state: TimedApprovalState) -> TimedApprovalState:
    """Auto-reject after all escalations timeout."""
    return {
        "human_decision": "auto_rejected",
        "execution_result": "Auto-rejected: approval timeout at all escalation levels"
    }

# Build timed approval graph
graph = StateGraph(TimedApprovalState)

graph.add_node("propose", propose_action)
graph.add_node("await", lambda s: s)
graph.add_node("check_timeout", lambda s: s)  # Just for routing
graph.add_node("escalate", escalate_approval)
graph.add_node("execute", execute_action)
graph.add_node("reject", handle_rejection)
graph.add_node("auto_reject", auto_reject_action)

graph.set_entry_point("propose")
graph.add_edge("propose", "await")
graph.add_edge("await", "check_timeout")

graph.add_conditional_edges(
    "check_timeout",
    check_timeout,
    {"await": "await", "escalate": "escalate", "auto_reject": "auto_reject"}
)

graph.add_edge("escalate", "await")  # Back to waiting after escalation
graph.add_edge("auto_reject", END)
```

## Audit Trail

Track all human decisions for compliance:

```python
from dataclasses import dataclass
from datetime import datetime
import json

@dataclass
class AuditEntry:
    session_id: str
    timestamp: str
    action_type: str  # "submit", "approve", "reject", "modify", "execute"
    actor: str
    details: dict

class AuditedHITLController:
    def __init__(self, agent, audit_store):
        self.agent = agent
        self.audit_store = audit_store

    def _audit(self, session_id: str, action_type: str, actor: str, details: dict):
        """Record audit entry."""
        entry = AuditEntry(
            session_id=session_id,
            timestamp=datetime.utcnow().isoformat(),
            action_type=action_type,
            actor=actor,
            details=details
        )
        self.audit_store.record(entry)

    def submit_request(self, request: str, submitter: str) -> str:
        session_id = str(uuid.uuid4())

        self._audit(session_id, "submit", submitter, {"request": request})

        # ... rest of submission logic ...

        return session_id

    def approve(self, session_id: str, approver: str, justification: str = None) -> dict:
        self._audit(session_id, "approve", approver, {
            "justification": justification
        })

        result = self._decide(session_id, "approve", None)

        self._audit(session_id, "execute", "system", {
            "result": result.get("execution_result")
        })

        return result

    def reject(self, session_id: str, approver: str, reason: str) -> dict:
        self._audit(session_id, "reject", approver, {"reason": reason})

        return self._decide(session_id, "reject", reason)

    def get_audit_trail(self, session_id: str) -> list[AuditEntry]:
        """Get full audit trail for a session."""
        return self.audit_store.get_by_session(session_id)

class AuditStore:
    def __init__(self, connection_string: str):
        # Use Azure Table Storage, Cosmos DB, or SQL
        pass

    def record(self, entry: AuditEntry):
        # Persist audit entry
        pass

    def get_by_session(self, session_id: str) -> list[AuditEntry]:
        # Retrieve all entries for session
        pass
```

## UI Integration

Example REST API for HITL:

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()
controller = HITLController(hitl_agent)

class SubmitRequest(BaseModel):
    request: str
    submitter: str

class DecisionRequest(BaseModel):
    decision: str  # "approve", "reject", "modify"
    feedback: str = None
    approver: str

@app.post("/requests")
def submit_request(req: SubmitRequest):
    session_id = controller.submit_request(req.request, req.submitter)
    return {"session_id": session_id, "status": "submitted"}

@app.get("/requests/pending")
def get_pending():
    return controller.get_pending_approvals()

@app.get("/requests/{session_id}")
def get_request(session_id: str):
    if session_id not in controller.pending_approvals:
        raise HTTPException(status_code=404, detail="Session not found")
    return controller.pending_approvals[session_id]

@app.post("/requests/{session_id}/decide")
def submit_decision(session_id: str, decision: DecisionRequest):
    if decision.decision == "approve":
        result = controller.approve(session_id, decision.approver)
    elif decision.decision == "reject":
        result = controller.reject(session_id, decision.approver, decision.feedback)
    elif decision.decision == "modify":
        result = controller.modify_and_approve(session_id, decision.approver, decision.feedback)
    else:
        raise HTTPException(status_code=400, detail="Invalid decision")

    return result

@app.get("/requests/{session_id}/audit")
def get_audit(session_id: str):
    return controller.get_audit_trail(session_id)
```

## Best Practices

1. **Clear action descriptions**: Humans need to understand what they're approving
2. **Show impact**: Display affected records, costs, reversibility
3. **Timeout handling**: Don't let requests hang forever
4. **Audit everything**: Full trail for compliance and debugging
5. **Graceful degradation**: Have fallbacks if human isn't available

## Conclusion

Human-in-the-loop patterns bridge the gap between AI capability and human accountability. For high-stakes operations, HITL provides the safety net that makes AI adoption possible.

Start with simple approval flows, add complexity (multi-approval, escalation, timeouts) as your use cases require.
