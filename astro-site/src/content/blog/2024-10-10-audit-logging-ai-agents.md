---
title: "Audit Logging for AI Agents: Complete Activity Tracking"
description: "Comprehensive audit logging is essential for AI agents in production. It enables debugging, ensures compliance, and provides the visibility needed to build…"
author: "Michael John Peña"
draft: false
date: 2024-10-10
tags: ["Audit Logging", "AI Agents", "Compliance", "Security", "Observability"]
---

## Audit Log Structure

```python
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List
from datetime import datetime
from enum import Enum
import json
import uuid

class AuditEventType(Enum):
    AGENT_START = "agent.start"
    AGENT_STOP = "agent.stop"
    ACTION_REQUEST = "action.request"
    ACTION_APPROVED = "action.approved"
    ACTION_DENIED = "action.denied"
    ACTION_EXECUTED = "action.executed"
    ACTION_FAILED = "action.failed"
    TOOL_CALL = "tool.call"
    TOOL_RESPONSE = "tool.response"
    DATA_ACCESS = "data.access"
    DATA_MODIFY = "data.modify"
    PERMISSION_CHECK = "permission.check"
    PERMISSION_DENIED = "permission.denied"
    ERROR = "error"

@dataclass
class AuditEvent:
    """A single audit log event"""
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    event_type: AuditEventType = AuditEventType.ACTION_REQUEST
    agent_id: str = ""
    session_id: str = ""
    user_id: Optional[str] = None
    action: str = ""
    resource: Optional[str] = None
    parameters: Dict[str, Any] = field(default_factory=dict)
    result: Optional[str] = None
    error: Optional[str] = None
    duration_ms: Optional[float] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return {
            "event_id": self.event_id,
            "timestamp": self.timestamp,
            "event_type": self.event_type.value,
            "agent_id": self.agent_id,
            "session_id": self.session_id,
            "user_id": self.user_id,
            "action": self.action,
            "resource": self.resource,
            "parameters": self._sanitize_params(self.parameters),
            "result": self.result,
            "error": self.error,
            "duration_ms": self.duration_ms,
            "metadata": self.metadata
        }

    def _sanitize_params(self, params: Dict) -> Dict:
        """Remove sensitive data from parameters"""
        sensitive_keys = ["password", "token", "secret", "key", "credential"]
        sanitized = {}

        for k, v in params.items():
            if any(sk in k.lower() for sk in sensitive_keys):
                sanitized[k] = "[REDACTED]"
            elif isinstance(v, dict):
                sanitized[k] = self._sanitize_params(v)
            else:
                sanitized[k] = v

        return sanitized
```

## Audit Logger Implementation

```python
from abc import ABC, abstractmethod
import logging
import threading
from queue import Queue
import time

class AuditBackend(ABC):
    """Abstract backend for audit log storage"""

    @abstractmethod
    def write(self, event: AuditEvent):
        pass

    @abstractmethod
    def query(self, filters: Dict) -> List[AuditEvent]:
        pass

class FileAuditBackend(AuditBackend):
    """Write audit logs to file"""

    def __init__(self, log_path: str):
        self.log_path = log_path
        self._lock = threading.Lock()

    def write(self, event: AuditEvent):
        with self._lock:
            with open(self.log_path, 'a') as f:
                f.write(json.dumps(event.to_dict()) + '\n')

    def query(self, filters: Dict) -> List[AuditEvent]:
        results = []
        with open(self.log_path, 'r') as f:
            for line in f:
                event_dict = json.loads(line.strip())
                if self._matches_filters(event_dict, filters):
                    results.append(self._dict_to_event(event_dict))
        return results

    def _matches_filters(self, event: Dict, filters: Dict) -> bool:
        for key, value in filters.items():
            if event.get(key) != value:
                return False
        return True

    def _dict_to_event(self, d: Dict) -> AuditEvent:
        return AuditEvent(
            event_id=d["event_id"],
            timestamp=d["timestamp"],
            event_type=AuditEventType(d["event_type"]),
            agent_id=d["agent_id"],
            session_id=d["session_id"],
            user_id=d.get("user_id"),
            action=d["action"],
            resource=d.get("resource"),
            parameters=d.get("parameters", {}),
            result=d.get("result"),
            error=d.get("error"),
            duration_ms=d.get("duration_ms"),
            metadata=d.get("metadata", {})
        )

class AsyncAuditLogger:
    """Asynchronous audit logger with buffering"""

    def __init__(self, backend: AuditBackend, buffer_size: int = 100):
        self.backend = backend
        self.buffer: Queue = Queue(maxsize=buffer_size)
        self.running = True
        self._start_writer_thread()

    def log(self, event: AuditEvent):
        """Log an audit event (non-blocking)"""
        try:
            self.buffer.put_nowait(event)
        except:
            # Buffer full - write synchronously
            self.backend.write(event)

    def _start_writer_thread(self):
        """Start background writer thread"""
        def writer():
            batch = []
            while self.running or not self.buffer.empty():
                try:
                    event = self.buffer.get(timeout=1)
                    batch.append(event)

                    # Write in batches of 10 or after 1 second
                    if len(batch) >= 10:
                        for e in batch:
                            self.backend.write(e)
                        batch = []

                except:
                    if batch:
                        for e in batch:
                            self.backend.write(e)
                        batch = []

        thread = threading.Thread(target=writer, daemon=True)
        thread.start()

    def shutdown(self):
        """Shutdown logger gracefully"""
        self.running = False
```

## Agent with Audit Logging

```python
from contextlib import contextmanager
import time

class AuditedAgent:
    """Agent with comprehensive audit logging"""

    def __init__(self, agent_id: str, logger: AsyncAuditLogger):
        self.agent_id = agent_id
        self.logger = logger
        self.session_id = str(uuid.uuid4())

    @contextmanager
    def audit_context(self, action: str, **metadata):
        """Context manager for auditing an action"""
        start_time = time.time()

        event = AuditEvent(
            event_type=AuditEventType.ACTION_REQUEST,
            agent_id=self.agent_id,
            session_id=self.session_id,
            action=action,
            metadata=metadata
        )

        try:
            yield event
            event.event_type = AuditEventType.ACTION_EXECUTED
            event.result = "success"

        except PermissionError as e:
            event.event_type = AuditEventType.PERMISSION_DENIED
            event.error = str(e)
            raise

        except Exception as e:
            event.event_type = AuditEventType.ACTION_FAILED
            event.error = str(e)
            raise

        finally:
            event.duration_ms = (time.time() - start_time) * 1000
            self.logger.log(event)

    def log_tool_call(self, tool_name: str, parameters: Dict,
                     result: Any, duration_ms: float):
        """Log a tool call"""
        self.logger.log(AuditEvent(
            event_type=AuditEventType.TOOL_CALL,
            agent_id=self.agent_id,
            session_id=self.session_id,
            action=f"tool.{tool_name}",
            parameters=parameters,
            result=str(result)[:1000],  # Truncate long results
            duration_ms=duration_ms
        ))

    def log_data_access(self, resource: str, operation: str,
                       details: Dict = None):
        """Log data access"""
        event_type = (AuditEventType.DATA_MODIFY
                     if operation in ["write", "delete", "update"]
                     else AuditEventType.DATA_ACCESS)

        self.logger.log(AuditEvent(
            event_type=event_type,
            agent_id=self.agent_id,
            session_id=self.session_id,
            action=operation,
            resource=resource,
            parameters=details or {}
        ))

# Usage
backend = FileAuditBackend("/var/log/agent_audit.jsonl")
logger = AsyncAuditLogger(backend)
agent = AuditedAgent("agent-001", logger)

with agent.audit_context("process_request", user_input="hello"):
    # Agent actions here
    result = process_something()
```

## Audit Analysis

```python
class AuditAnalyzer:
    """Analyze audit logs for insights"""

    def __init__(self, backend: AuditBackend):
        self.backend = backend

    def get_agent_activity(self, agent_id: str,
                          start_time: str = None,
                          end_time: str = None) -> Dict:
        """Get activity summary for an agent"""

        filters = {"agent_id": agent_id}
        events = self.backend.query(filters)

        # Filter by time if provided
        if start_time:
            events = [e for e in events if e.timestamp >= start_time]
        if end_time:
            events = [e for e in events if e.timestamp <= end_time]

        return {
            "agent_id": agent_id,
            "total_events": len(events),
            "by_type": self._count_by_type(events),
            "errors": [e for e in events if e.error],
            "avg_duration_ms": self._avg_duration(events),
            "unique_actions": len(set(e.action for e in events))
        }

    def detect_anomalies(self, agent_id: str) -> List[Dict]:
        """Detect unusual patterns in agent behavior"""

        events = self.backend.query({"agent_id": agent_id})
        anomalies = []

        # Check for rapid-fire actions
        event_times = sorted([e.timestamp for e in events])
        for i in range(len(event_times) - 10):
            window = event_times[i:i+10]
            if (datetime.fromisoformat(window[-1]) -
                datetime.fromisoformat(window[0])).seconds < 1:
                anomalies.append({
                    "type": "rapid_actions",
                    "timestamp": window[0],
                    "description": "10+ actions in less than 1 second"
                })

        # Check for repeated failures
        failures = [e for e in events if e.error]
        if len(failures) > len(events) * 0.3:
            anomalies.append({
                "type": "high_failure_rate",
                "rate": len(failures) / len(events),
                "description": f"Failure rate above 30%"
            })

        # Check for permission denials
        denials = [e for e in events
                   if e.event_type == AuditEventType.PERMISSION_DENIED]
        if len(denials) > 5:
            anomalies.append({
                "type": "permission_issues",
                "count": len(denials),
                "description": "Multiple permission denials"
            })

        return anomalies

    def generate_compliance_report(self, start_date: str,
                                   end_date: str) -> Dict:
        """Generate compliance report for time period"""

        all_events = self.backend.query({})
        events = [e for e in all_events
                 if start_date <= e.timestamp <= end_date]

        return {
            "period": {"start": start_date, "end": end_date},
            "total_events": len(events),
            "unique_agents": len(set(e.agent_id for e in events)),
            "data_access_events": len([e for e in events
                                       if e.event_type in [
                                           AuditEventType.DATA_ACCESS,
                                           AuditEventType.DATA_MODIFY
                                       ]]),
            "security_events": len([e for e in events
                                   if e.event_type == AuditEventType.PERMISSION_DENIED]),
            "errors": len([e for e in events if e.error]),
            "top_actions": self._get_top_items([e.action for e in events], 10),
            "top_resources": self._get_top_items(
                [e.resource for e in events if e.resource], 10
            )
        }

    def _count_by_type(self, events: List[AuditEvent]) -> Dict[str, int]:
        counts = {}
        for e in events:
            counts[e.event_type.value] = counts.get(e.event_type.value, 0) + 1
        return counts

    def _avg_duration(self, events: List[AuditEvent]) -> float:
        durations = [e.duration_ms for e in events if e.duration_ms]
        return sum(durations) / len(durations) if durations else 0

    def _get_top_items(self, items: List[str], n: int) -> List[tuple]:
        from collections import Counter
        return Counter(items).most_common(n)
```

Comprehensive audit logging is essential for AI agents in production. It enables debugging, ensures compliance, and provides the visibility needed to build trust in autonomous systems.
