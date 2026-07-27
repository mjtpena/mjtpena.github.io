---
title: "Operational Risk in AI Systems: Keeping the Lights On"
author: "Michael John Peña"
draft: false
date: 2023-12-07
tags: ["AI", "Operations", "Risk Management", "SRE", "Reliability"]

---

I wrote "Operational Risk in AI Systems: Keeping the Lights On" to share practical, production-minded guidance on this topic.

Operational resilience is the unsung prerequisite for AI adoption. Practical SRE for AI means instrumenting model performance, bounding cost exposure, and architecting graceful degradation — the techniques I outline come from production incidents I've investigated this year.

## AI Operational Risk Categories

## AI Operational Risk Categories

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum
from datetime import datetime, timedelta

class OperationalRiskType(Enum):
    AVAILABILITY = "Service Availability"
    PERFORMANCE = "Performance Degradation"
    COST = "Cost Overrun"
    INTEGRATION = "Integration Failure"
    DATA_PIPELINE = "Data Pipeline Issues"
    MODEL_SERVING = "Model Serving Problems"
    VENDOR = "Vendor Dependency"

@dataclass
class OperationalIncident:
    incident_id: str
    risk_type: OperationalRiskType
    severity: str  # Critical, High, Medium, Low
    description: str
    started_at: datetime
    resolved_at: Optional[datetime]
    root_cause: Optional[str]
    mitigation_applied: Optional[str]

    @property
    def duration_minutes(self) -> Optional[float]:
        if self.resolved_at:
            return (self.resolved_at - self.started_at).total_seconds() / 60
        return None

class IncidentTracker:
    def __init__(self):
        self.incidents: List[OperationalIncident] = []

    def report_incident(
        self,
        risk_type: OperationalRiskType,
        severity: str,
        description: str
    ) -> str:
        import uuid
        incident_id = f"INC-{str(uuid.uuid4())[:8]}"

        incident = OperationalIncident(
            incident_id=incident_id,
            risk_type=risk_type,
            severity=severity,
            description=description,
            started_at=datetime.now(),
            resolved_at=None,
            root_cause=None,
            mitigation_applied=None
        )

        self.incidents.append(incident)
        return incident_id

    def resolve_incident(
        self,
        incident_id: str,
        root_cause: str,
        mitigation: str
    ):
        for incident in self.incidents:
            if incident.incident_id == incident_id:
                incident.resolved_at = datetime.now()
                incident.root_cause = root_cause
                incident.mitigation_applied = mitigation
                break

    def get_mttr(self, days: int = 30) -> float:
        """Calculate Mean Time To Resolution."""
        cutoff = datetime.now() - timedelta(days=days)
        resolved = [
            i for i in self.incidents
            if i.resolved_at and i.started_at > cutoff
        ]

        if not resolved:
            return 0

        total_minutes = sum(i.duration_minutes for i in resolved if i.duration_minutes)
        return total_minutes / len(resolved)
```

## Resilience Patterns for AI Systems

```python
from typing import Callable, Any
import time
import random

class AIResiliencePatterns:
    """Implement resilience patterns for AI operations."""

    @staticmethod
    def retry_with_backoff(
        func: Callable,
        max_retries: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 60.0
    ) -> Any:
        """Retry with exponential backoff."""
        for attempt in range(max_retries):
            try:
                return func()
            except Exception as e:
                if attempt == max_retries - 1:
                    raise

                delay = min(base_delay * (2 ** attempt), max_delay)
                jitter = random.uniform(0, delay * 0.1)
                time.sleep(delay + jitter)

        return None

    @staticmethod
    def circuit_breaker(
        failure_threshold: int = 5,
        recovery_timeout: int = 60
    ):
        """Circuit breaker decorator."""
        def decorator(func: Callable):
            failures = 0
            last_failure_time = None
            circuit_open = False

            def wrapper(*args, **kwargs):
                nonlocal failures, last_failure_time, circuit_open

                # Check if circuit should be closed
                if circuit_open:
                    if (datetime.now() - last_failure_time).seconds > recovery_timeout:
                        circuit_open = False
                        failures = 0
                    else:
                        raise Exception("Circuit breaker is open")

                try:
                    result = func(*args, **kwargs)
                    failures = 0  # Reset on success
                    return result
                except Exception as e:
                    failures += 1
                    last_failure_time = datetime.now()

                    if failures >= failure_threshold:
                        circuit_open = True

                    raise

            return wrapper
        return decorator

    @staticmethod
    def fallback_chain(primary: Callable, *fallbacks: Callable) -> Any:
        """Try primary, then fallbacks in order."""
        try:
            return primary()
        except Exception as primary_error:
            for fallback in fallbacks:
                try:
                    return fallback()
                except:
                    continue
            raise primary_error

class ModelFallbackStrategy:
    """Implement model fallback strategies."""

    def __init__(self):
        self.models = {}
        self.model_health = {}

    def register_model(
        self,
        name: str,
        model_client: Any,
        priority: int,
        capabilities: List[str]
    ):
        """Register a model in the fallback chain."""
        self.models[name] = {
            "client": model_client,
            "priority": priority,
            "capabilities": capabilities
        }
        self.model_health[name] = True

    def get_healthy_model(self, required_capabilities: List[str] = None) -> str:
        """Get the highest priority healthy model."""
        candidates = []

        for name, config in self.models.items():
            if not self.model_health.get(name, False):
                continue

            if required_capabilities:
                if not all(cap in config["capabilities"] for cap in required_capabilities):
                    continue

            candidates.append((name, config["priority"]))

        if not candidates:
            raise Exception("No healthy models available")

        candidates.sort(key=lambda x: x[1])
        return candidates[0][0]

    def mark_unhealthy(self, model_name: str):
        """Mark a model as unhealthy."""
        self.model_health[model_name] = False

    def mark_healthy(self, model_name: str):
        """Mark a model as healthy."""
        self.model_health[model_name] = True

# Example usage
fallback = ModelFallbackStrategy()
fallback.register_model("gpt-4-turbo", None, 1, ["reasoning", "code", "analysis"])
fallback.register_model("gpt-35-turbo", None, 2, ["chat", "code"])
fallback.register_model("llama-70b", None, 3, ["chat"])
```

## Cost Control Operations

```python
class CostController:
    """Operational cost control for AI systems."""

    def __init__(self, daily_budget: float, monthly_budget: float):
        self.daily_budget = daily_budget
        self.monthly_budget = monthly_budget
        self.daily_spend: Dict[str, float] = {}
        self.monthly_spend: float = 0
        self.alerts_sent: List[Dict] = []

    def record_cost(self, amount: float, service: str):
        """Record a cost incurrence."""
        today = datetime.now().strftime("%Y-%m-%d")

        if today not in self.daily_spend:
            self.daily_spend[today] = 0

        self.daily_spend[today] += amount
        self.monthly_spend += amount

        # Check thresholds
        self._check_thresholds(today)

    def _check_thresholds(self, date: str):
        """Check and alert on budget thresholds."""
        daily_pct = self.daily_spend[date] / self.daily_budget
        monthly_pct = self.monthly_spend / self.monthly_budget

        if daily_pct >= 0.9 and not self._alert_sent_today("daily_90"):
            self._send_alert("Daily budget at 90%", "Warning")

        if daily_pct >= 1.0 and not self._alert_sent_today("daily_100"):
            self._send_alert("Daily budget exceeded", "Critical")

        if monthly_pct >= 0.75 and not self._alert_sent_today("monthly_75"):
            self._send_alert("Monthly budget at 75%", "Info")

        if monthly_pct >= 0.9 and not self._alert_sent_today("monthly_90"):
            self._send_alert("Monthly budget at 90%", "Warning")

    def _alert_sent_today(self, alert_type: str) -> bool:
        today = datetime.now().strftime("%Y-%m-%d")
        return any(
            a["type"] == alert_type and a["date"] == today
            for a in self.alerts_sent
        )

    def _send_alert(self, message: str, severity: str):
        alert = {
            "message": message,
            "severity": severity,
            "date": datetime.now().strftime("%Y-%m-%d"),
            "type": message.lower().replace(" ", "_"),
            "timestamp": datetime.now()
        }
        self.alerts_sent.append(alert)
        print(f"[{severity}] {message}")

    def should_throttle(self) -> bool:
        """Determine if requests should be throttled due to cost."""
        today = datetime.now().strftime("%Y-%m-%d")
        daily_pct = self.daily_spend.get(today, 0) / self.daily_budget

        return daily_pct >= 1.0

    def get_cost_report(self) -> Dict:
        """Generate cost report."""
        today = datetime.now().strftime("%Y-%m-%d")
        return {
            "daily_spend": self.daily_spend.get(today, 0),
            "daily_budget": self.daily_budget,
            "daily_utilization": self.daily_spend.get(today, 0) / self.daily_budget,
            "monthly_spend": self.monthly_spend,
            "monthly_budget": self.monthly_budget,
            "monthly_utilization": self.monthly_spend / self.monthly_budget
        }
```

## SLA Management

```python
@dataclass
class SLA:
    name: str
    target_availability: float  # e.g., 0.999 for 99.9%
    max_latency_p99_ms: int
    max_error_rate: float

class SLAMonitor:
    """Monitor and report on SLA compliance."""

    def __init__(self, sla: SLA):
        self.sla = sla
        self.uptime_checks: List[bool] = []
        self.latencies: List[float] = []
        self.errors: List[bool] = []

    def record_check(self, available: bool, latency_ms: float, error: bool):
        """Record a single check."""
        self.uptime_checks.append(available)
        self.latencies.append(latency_ms)
        self.errors.append(error)

    def get_sla_status(self) -> Dict:
        """Calculate current SLA status."""
        if not self.uptime_checks:
            return {"status": "No data"}

        availability = sum(self.uptime_checks) / len(self.uptime_checks)
        p99_latency = sorted(self.latencies)[int(len(self.latencies) * 0.99)] if self.latencies else 0
        error_rate = sum(self.errors) / len(self.errors)

        return {
            "availability": {
                "current": availability,
                "target": self.sla.target_availability,
                "compliant": availability >= self.sla.target_availability
            },
            "latency_p99": {
                "current": p99_latency,
                "target": self.sla.max_latency_p99_ms,
                "compliant": p99_latency <= self.sla.max_latency_p99_ms
            },
            "error_rate": {
                "current": error_rate,
                "target": self.sla.max_error_rate,
                "compliant": error_rate <= self.sla.max_error_rate
            },
            "overall_compliant": (
                availability >= self.sla.target_availability and
                p99_latency <= self.sla.max_latency_p99_ms and
                error_rate <= self.sla.max_error_rate
            )
        }
```

Tomorrow, we'll explore compliance considerations for AI systems!\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
