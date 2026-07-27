---
title: "Building Custom LLM Observability: DIY Solutions"
author: "Michael John Peña"
draft: false
date: 2024-10-20
tags: ["Observability", "LLM", "DIY", "Custom", "Monitoring"]

---

I wrote "Building Custom LLM Observability: DIY Solutions" to share practical, production-minded guidance on this topic.

## Custom Observability Stack

```python
from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
from datetime import datetime
import json
import sqlite3
import threading
from queue import Queue

@dataclass
class LLMEvent:
    """Base event for LLM observability"""
    event_id: str
    timestamp: datetime
    event_type: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_ms: float = 0
    cost_usd: float = 0
    success: bool = True
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

class CustomObservability:
    """Custom observability system for LLM applications"""

    def __init__(self, db_path: str = "llm_observability.db"):
        self.db_path = db_path
        self.event_queue: Queue = Queue()
        self._init_db()
        self._start_writer()

    def _init_db(self):
        """Initialize SQLite database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS events (
                event_id TEXT PRIMARY KEY,
                timestamp TEXT,
                event_type TEXT,
                model TEXT,
                prompt_tokens INTEGER,
                completion_tokens INTEGER,
                latency_ms REAL,
                cost_usd REAL,
                success INTEGER,
                error TEXT,
                metadata TEXT
            )
        ''')

        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_timestamp ON events(timestamp)
        ''')

        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_model ON events(model)
        ''')

        conn.commit()
        conn.close()

    def _start_writer(self):
        """Start background writer thread"""
        def writer():
            conn = sqlite3.connect(self.db_path)
            while True:
                event = self.event_queue.get()
                if event is None:
                    break

                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    event.event_id,
                    event.timestamp.isoformat(),
                    event.event_type,
                    event.model,
                    event.prompt_tokens,
                    event.completion_tokens,
                    event.latency_ms,
                    event.cost_usd,
                    1 if event.success else 0,
                    event.error,
                    json.dumps(event.metadata)
                ))
                conn.commit()

            conn.close()

        thread = threading.Thread(target=writer, daemon=True)
        thread.start()

    def log_event(self, event: LLMEvent):
        """Log an event asynchronously"""
        self.event_queue.put(event)

    def query(self, sql: str, params: tuple = ()) -> List[Dict]:
        """Run a custom query"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(sql, params)
        results = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return results
```

## Instrumentation Decorator

```python
import functools
import time
import uuid

def observe_llm(obs: CustomObservability, model: str = None):
    """Decorator to observe LLM calls"""

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            event_id = str(uuid.uuid4())
            start_time = time.time()

            try:
                result = func(*args, **kwargs)

                # Extract usage info (assuming OpenAI-style response)
                usage = getattr(result, 'usage', None) or {}
                prompt_tokens = getattr(usage, 'prompt_tokens', 0)
                completion_tokens = getattr(usage, 'completion_tokens', 0)

                event = LLMEvent(
                    event_id=event_id,
                    timestamp=datetime.utcnow(),
                    event_type="llm_call",
                    model=model or kwargs.get('model', 'unknown'),
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    latency_ms=(time.time() - start_time) * 1000,
                    cost_usd=calculate_cost(model, prompt_tokens, completion_tokens),
                    success=True,
                    metadata={
                        "function": func.__name__,
                        "args_count": len(args),
                        "kwargs_keys": list(kwargs.keys())
                    }
                )

                obs.log_event(event)
                return result

            except Exception as e:
                event = LLMEvent(
                    event_id=event_id,
                    timestamp=datetime.utcnow(),
                    event_type="llm_call",
                    model=model or kwargs.get('model', 'unknown'),
                    latency_ms=(time.time() - start_time) * 1000,
                    success=False,
                    error=str(e),
                    metadata={"function": func.__name__}
                )
                obs.log_event(event)
                raise

        return wrapper
    return decorator

def calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    pricing = {
        "gpt-4o": (2.50, 10.00),
        "gpt-4o-mini": (0.15, 0.60),
    }
    rates = pricing.get(model, (2.50, 10.00))
    return (input_tokens * rates[0] + output_tokens * rates[1]) / 1_000_000

# Usage
obs = CustomObservability()

@observe_llm(obs)
def chat(messages: list, model: str = "gpt-4o"):
    return client.chat.completions.create(
        model=model,
        messages=messages
    )
```

## Analytics and Dashboards

```python
class LLMAnalytics:
    """Analytics for LLM observability data"""

    def __init__(self, obs: CustomObservability):
        self.obs = obs

    def get_summary(self, hours: int = 24) -> Dict:
        """Get summary statistics"""
        cutoff = (datetime.utcnow() - timedelta(hours=hours)).isoformat()

        results = self.obs.query('''
            SELECT
                COUNT(*) as total_calls,
                SUM(prompt_tokens) as total_prompt_tokens,
                SUM(completion_tokens) as total_completion_tokens,
                SUM(cost_usd) as total_cost,
                AVG(latency_ms) as avg_latency,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
            FROM events
            WHERE timestamp > ?
        ''', (cutoff,))

        return results[0] if results else {}

    def get_by_model(self, hours: int = 24) -> List[Dict]:
        """Get statistics by model"""
        cutoff = (datetime.utcnow() - timedelta(hours=hours)).isoformat()

        return self.obs.query('''
            SELECT
                model,
                COUNT(*) as calls,
                SUM(prompt_tokens + completion_tokens) as tokens,
                SUM(cost_usd) as cost,
                AVG(latency_ms) as avg_latency
            FROM events
            WHERE timestamp > ?
            GROUP BY model
            ORDER BY calls DESC
        ''', (cutoff,))

    def get_hourly_trend(self, hours: int = 24) -> List[Dict]:
        """Get hourly trend data"""
        cutoff = (datetime.utcnow() - timedelta(hours=hours)).isoformat()

        return self.obs.query('''
            SELECT
                strftime('%Y-%m-%d %H:00', timestamp) as hour,
                COUNT(*) as calls,
                SUM(cost_usd) as cost,
                AVG(latency_ms) as avg_latency,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
            FROM events
            WHERE timestamp > ?
            GROUP BY hour
            ORDER BY hour
        ''', (cutoff,))

    def get_error_analysis(self, hours: int = 24) -> List[Dict]:
        """Analyze errors"""
        cutoff = (datetime.utcnow() - timedelta(hours=hours)).isoformat()

        return self.obs.query('''
            SELECT
                error,
                COUNT(*) as count,
                model
            FROM events
            WHERE timestamp > ? AND success = 0
            GROUP BY error, model
            ORDER BY count DESC
            LIMIT 20
        ''', (cutoff,))

# API for dashboard
from flask import Flask, jsonify

app = Flask(__name__)
analytics = LLMAnalytics(obs)

@app.route('/api/summary')
def api_summary():
    return jsonify(analytics.get_summary())

@app.route('/api/by-model')
def api_by_model():
    return jsonify(analytics.get_by_model())

@app.route('/api/trend')
def api_trend():
    return jsonify(analytics.get_hourly_trend())

@app.route('/api/errors')
def api_errors():
    return jsonify(analytics.get_error_analysis())
```

## Real-Time Streaming

```python
from collections import deque
import asyncio

class RealtimeMonitor:
    """Real-time monitoring with WebSocket support"""

    def __init__(self, max_events: int = 1000):
        self.recent_events: deque = deque(maxlen=max_events)
        self.subscribers: List[asyncio.Queue] = []

    async def publish(self, event: LLMEvent):
        """Publish event to all subscribers"""
        self.recent_events.append(event)

        for queue in self.subscribers:
            await queue.put(event)

    async def subscribe(self) -> asyncio.Queue:
        """Subscribe to real-time events"""
        queue = asyncio.Queue()
        self.subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue):
        """Unsubscribe from events"""
        self.subscribers.remove(queue)

    def get_recent(self, n: int = 100) -> List[LLMEvent]:
        """Get recent events"""
        return list(self.recent_events)[-n:]

# FastAPI WebSocket endpoint
from fastapi import FastAPI, WebSocket

app = FastAPI()
monitor = RealtimeMonitor()

@app.websocket("/ws/events")
async def websocket_events(websocket: WebSocket):
    await websocket.accept()

    queue = await monitor.subscribe()

    try:
        while True:
            event = await queue.get()
            await websocket.send_json({
                "event_id": event.event_id,
                "timestamp": event.timestamp.isoformat(),
                "model": event.model,
                "latency_ms": event.latency_ms,
                "cost_usd": event.cost_usd,
                "success": event.success
            })
    finally:
        monitor.unsubscribe(queue)
```

## Alerting System

```python
from dataclasses import dataclass
from typing import Callable

@dataclass
class AlertRule:
    name: str
    condition: Callable[[Dict], bool]
    message_template: str
    severity: str  # "info", "warning", "critical"

class AlertManager:
    """Custom alerting for LLM observability"""

    def __init__(self, analytics: LLMAnalytics):
        self.analytics = analytics
        self.rules: List[AlertRule] = []
        self.handlers: Dict[str, Callable] = {}

    def add_rule(self, rule: AlertRule):
        self.rules.append(rule)

    def add_handler(self, severity: str, handler: Callable):
        self.handlers[severity] = handler

    def check_alerts(self):
        """Check all alert rules"""
        summary = self.analytics.get_summary(hours=1)

        for rule in self.rules:
            if rule.condition(summary):
                alert = {
                    "name": rule.name,
                    "severity": rule.severity,
                    "message": rule.message_template.format(**summary),
                    "timestamp": datetime.utcnow().isoformat()
                }

                handler = self.handlers.get(rule.severity)
                if handler:
                    handler(alert)

# Define alert rules
alert_manager = AlertManager(analytics)

alert_manager.add_rule(AlertRule(
    name="High Error Rate",
    condition=lambda s: s.get("errors", 0) / max(s.get("total_calls", 1), 1) > 0.05,
    message_template="Error rate is {errors}/{total_calls} in the last hour",
    severity="critical"
))

alert_manager.add_rule(AlertRule(
    name="High Latency",
    condition=lambda s: s.get("avg_latency", 0) > 5000,
    message_template="Average latency is {avg_latency:.0f}ms",
    severity="warning"
))

alert_manager.add_rule(AlertRule(
    name="High Cost",
    condition=lambda s: s.get("total_cost", 0) > 100,
    message_template="Hourly cost is ${total_cost:.2f}",
    severity="warning"
))

# Add handlers
alert_manager.add_handler("critical", lambda a: send_pagerduty(a))
alert_manager.add_handler("warning", lambda a: send_slack(a))

# Run periodically
import schedule
schedule.every(5).minutes.do(alert_manager.check_alerts)
```

Building custom observability gives you full control over your data and features. Start simple and add complexity as your needs grow.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
