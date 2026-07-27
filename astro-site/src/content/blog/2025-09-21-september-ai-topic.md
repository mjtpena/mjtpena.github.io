---
title: "Microsoft Fabric Data Activator: Event-Driven Data Alerts"
author: Michael John Peña
draft: false
date: 2025-09-21
tags:
  - Microsoft Fabric
  - Data Activator
  - Event-Driven
  - Alerting
  - Real-Time

---

I wrote "Microsoft Fabric Data Activator: Event-Driven Data Alerts" to share practical, production-minded guidance on this topic.

## Understanding Data Activator

Data Activator monitors data streams and triggers actions based on conditions you define. It connects to Power BI reports, Eventstreams, and Fabric data sources.

## Creating Triggers

```python
# Data Activator configuration is primarily UI-driven, but here's how
# to structure the underlying logic programmatically

from dataclasses import dataclass
from typing import List, Dict, Callable, Any
from enum import Enum
import asyncio

class TriggerCondition(Enum):
    EQUALS = "equals"
    GREATER_THAN = "greater_than"
    LESS_THAN = "less_than"
    CHANGES_BY = "changes_by"
    ENTERS_RANGE = "enters_range"
    EXITS_RANGE = "exits_range"

class ActionType(Enum):
    EMAIL = "email"
    TEAMS_MESSAGE = "teams_message"
    POWER_AUTOMATE = "power_automate"
    CUSTOM_WEBHOOK = "webhook"

@dataclass
class TriggerRule:
    name: str
    object_type: str  # e.g., "SalesOrder", "SensorReading"
    object_id_field: str  # Field that identifies unique objects
    measure_field: str  # Field to monitor
    condition: TriggerCondition
    threshold: Any
    actions: List[Dict]

@dataclass
class DataActivatorConfig:
    name: str
    source_type: str  # "eventstream", "powerbi", "kql"
    source_connection: Dict
    triggers: List[TriggerRule]

# Example: Sales alert configuration
sales_alert = TriggerRule(
    name="Large Order Alert",
    object_type="SalesOrder",
    object_id_field="OrderId",
    measure_field="TotalAmount",
    condition=TriggerCondition.GREATER_THAN,
    threshold=50000,
    actions=[
        {
            "type": ActionType.TEAMS_MESSAGE,
            "channel": "sales-alerts",
            "template": "New large order: {{OrderId}} for ${{TotalAmount}} from {{CustomerName}}"
        },
        {
            "type": ActionType.POWER_AUTOMATE,
            "flow_id": "create-priority-ticket",
            "parameters": {"priority": "high"}
        }
    ]
)
```

## Implementing Custom Monitoring Logic

```python
class DataMonitor:
    """Simulate Data Activator monitoring logic."""

    def __init__(self, rules: List[TriggerRule]):
        self.rules = rules
        self.object_states: Dict[str, Dict] = {}  # Track state for change detection

    async def process_event(self, event: Dict) -> List[Dict]:
        """Process incoming event and check all trigger rules."""
        triggered_actions = []

        for rule in self.rules:
            if self._matches_object_type(event, rule):
                object_id = event.get(rule.object_id_field)
                measure_value = event.get(rule.measure_field)

                if self._evaluate_condition(rule, object_id, measure_value):
                    # Record triggered state
                    triggered_actions.extend(
                        self._prepare_actions(rule, event)
                    )

                # Update state tracking
                self._update_state(rule, object_id, measure_value)

        return triggered_actions

    def _evaluate_condition(self, rule: TriggerRule,
                           object_id: str, value: Any) -> bool:
        """Evaluate if trigger condition is met."""

        if rule.condition == TriggerCondition.GREATER_THAN:
            return value > rule.threshold

        elif rule.condition == TriggerCondition.LESS_THAN:
            return value < rule.threshold

        elif rule.condition == TriggerCondition.CHANGES_BY:
            prev = self.object_states.get(f"{rule.name}:{object_id}", {}).get("value")
            if prev is not None:
                return abs(value - prev) >= rule.threshold
            return False

        elif rule.condition == TriggerCondition.ENTERS_RANGE:
            low, high = rule.threshold
            prev = self.object_states.get(f"{rule.name}:{object_id}", {}).get("value")
            was_outside = prev is None or prev < low or prev > high
            is_inside = low <= value <= high
            return was_outside and is_inside

        return False
```

Data Activator transforms passive data into proactive insights. Define once, and let the system continuously monitor for conditions that matter to your business.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
