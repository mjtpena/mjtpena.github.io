---
title: "Data Activator (Reflex) Alerts: Event-Driven Actions in Fabric"
author: Michael John Peña
draft: false
date: 2024-01-21
tags:
  - Data Activator
  - Reflex
  - Microsoft Fabric
  - Alerts
  - Automation
---

Data Activator (Reflex) brought event-driven automation to Fabric. In projects where real-time alerts matter, I've used Reflex to reduce mean time to detect; below are the core concepts and setup notes I rely on.

## Core Concepts

Data Activator consists of:
- **Objects**: Represent real-world entities (devices, customers, orders)
- **Triggers**: Define conditions that activate actions
- **Actions**: What happens when triggers fire (email, Teams, Power Automate)

## Setting Up Data Activator

### Creating Your First Reflex

```python
# Conceptual API for Reflex configuration
reflex_config = {
    "name": "Production Monitoring Reflex",
    "description": "Monitor production line sensors",
    "data_sources": [
        {
            "type": "KqlDatabase",
            "database": "TelemetryDB",
            "table": "SensorReadings"
        },
        {
            "type": "Eventstream",
            "eventstream": "production-events"
        }
    ]
}
```

### Defining Objects

Objects represent the things you want to monitor:

```python
# Object definition
object_definition = {
    "name": "ProductionLine",
    "id_column": "line_id",
    "properties": [
        {
            "name": "CurrentTemperature",
            "source_column": "temperature",
            "aggregation": "latest"
        },
        {
            "name": "AverageTemperature",
            "source_column": "temperature",
            "aggregation": "avg",
            "window": "5m"
        },
        {
            "name": "AlertCount",
            "source_column": "alert_flag",
            "aggregation": "sum",
            "window": "1h"
        },
        {
            "name": "Status",
            "source_column": "status",
            "aggregation": "latest"
        }
    ]
}
```

## Trigger Patterns

### Pattern 1: Threshold Alert

```yaml
trigger:
  name: High Temperature Alert
  object: ProductionLine
  condition:
    property: CurrentTemperature
    operator: greaterThan
    value: 85
  action:
    type: email
    recipients:
      - operations@company.com
    subject: "High Temperature Alert: {{object.line_id}}"
    body: |
      Production line {{object.line_id}} has exceeded temperature threshold.

      Current Temperature: {{object.CurrentTemperature}}°C
      Threshold: 85°C
      Time: {{trigger.timestamp}}

      Please investigate immediately.
```

### Pattern 2: Trend-Based Alert

```yaml
trigger:
  name: Temperature Rising Alert
  object: ProductionLine
  condition:
    type: trend
    property: AverageTemperature
    direction: increasing
    threshold: 10  # 10% increase
    window: 30m
  action:
    type: teams
    channel: production-alerts
    message: |
      **Temperature Trend Alert**
      Line: {{object.line_id}}
      Trend: Rising {{trend.percent_change}}% over 30 minutes
      Current: {{object.CurrentTemperature}}°C
```

### Pattern 3: Absence Detection

```yaml
trigger:
  name: Device Offline Alert
  object: Sensor
  condition:
    type: absence
    property: LastReading
    duration: 5m
  action:
    type: email
    recipients:
      - iot-support@company.com
    subject: "Sensor Offline: {{object.sensor_id}}"
    body: |
      Sensor {{object.sensor_id}} has not reported data for 5 minutes.

      Last reading: {{object.LastReading}}
      Last seen: {{object.LastSeenTimestamp}}
```

### Pattern 4: Compound Conditions

```yaml
trigger:
  name: Critical Production Alert
  object: ProductionLine
  condition:
    type: compound
    operator: and
    conditions:
      - property: CurrentTemperature
        operator: greaterThan
        value: 80
      - property: Status
        operator: equals
        value: "Running"
      - property: AlertCount
        operator: greaterThan
        value: 5
  action:
    type: powerAutomate
    flow: "Critical Production Response"
    parameters:
      line_id: "{{object.line_id}}"
      temperature: "{{object.CurrentTemperature}}"
      alert_count: "{{object.AlertCount}}"
```

### Pattern 5: State Change Detection

```yaml
trigger:
  name: Status Change Alert
  object: ProductionLine
  condition:
    type: stateChange
    property: Status
    from: "Running"
    to: "Stopped"
  action:
    type: teams
    channel: production-ops
    message: |
      **Production Line Status Change**
      Line: {{object.line_id}}
      Previous Status: Running
      New Status: Stopped
      Time: {{trigger.timestamp}}

      Investigate cause of stoppage.
```

## Action Types

### Email Actions

```python
email_action = {
    "type": "email",
    "recipients": ["team@company.com"],
    "cc": ["manager@company.com"],
    "subject": "Alert: {{trigger.name}}",
    "body": """
    Alert Details:
    - Object: {{object.id}}
    - Condition: {{trigger.condition}}
    - Value: {{trigger.value}}
    - Time: {{trigger.timestamp}}
    """,
    "priority": "high"
}
```

### Teams Actions

```python
teams_action = {
    "type": "teams",
    "webhook_url": "https://company.webhook.office.com/...",
    "adaptive_card": {
        "type": "AdaptiveCard",
        "body": [
            {
                "type": "TextBlock",
                "text": "Alert: {{trigger.name}}",
                "weight": "bolder",
                "size": "large"
            },
            {
                "type": "FactSet",
                "facts": [
                    {"title": "Object", "value": "{{object.id}}"},
                    {"title": "Value", "value": "{{trigger.value}}"},
                    {"title": "Time", "value": "{{trigger.timestamp}}"}
                ]
            }
        ],
        "actions": [
            {
                "type": "Action.OpenUrl",
                "title": "View Dashboard",
                "url": "https://app.fabric.microsoft.com/..."
            }
        ]
    }
}
```

### Power Automate Integration

```python
power_automate_action = {
    "type": "powerAutomate",
    "flow_name": "Handle Production Alert",
    "trigger_url": "https://prod-xx.westus.logic.azure.com/...",
    "parameters": {
        "alert_type": "{{trigger.name}}",
        "object_id": "{{object.id}}",
        "current_value": "{{trigger.value}}",
        "threshold": "{{trigger.threshold}}",
        "timestamp": "{{trigger.timestamp}}"
    }
}
```

## Real-World Example: E-Commerce Monitoring

```python
# Complete Reflex configuration for e-commerce monitoring

ecommerce_reflex = {
    "name": "E-Commerce Monitoring",

    "objects": [
        {
            "name": "Order",
            "id_column": "order_id",
            "properties": [
                {"name": "Status", "column": "status", "agg": "latest"},
                {"name": "TotalValue", "column": "total", "agg": "sum"},
                {"name": "ItemCount", "column": "items", "agg": "count"}
            ]
        },
        {
            "name": "Product",
            "id_column": "product_id",
            "properties": [
                {"name": "StockLevel", "column": "stock", "agg": "latest"},
                {"name": "SalesVelocity", "column": "sales", "agg": "sum", "window": "1h"}
            ]
        },
        {
            "name": "Customer",
            "id_column": "customer_id",
            "properties": [
                {"name": "OrderCount", "column": "order_id", "agg": "count", "window": "24h"},
                {"name": "TotalSpend", "column": "total", "agg": "sum", "window": "24h"}
            ]
        }
    ],

    "triggers": [
        {
            "name": "High Value Order",
            "object": "Order",
            "condition": {"property": "TotalValue", "op": ">", "value": 1000},
            "action": {"type": "email", "to": "vip-sales@company.com"}
        },
        {
            "name": "Low Stock Alert",
            "object": "Product",
            "condition": {
                "type": "compound",
                "op": "and",
                "conditions": [
                    {"property": "StockLevel", "op": "<", "value": 10},
                    {"property": "SalesVelocity", "op": ">", "value": 5}
                ]
            },
            "action": {"type": "teams", "channel": "inventory"}
        },
        {
            "name": "VIP Customer Activity",
            "object": "Customer",
            "condition": {"property": "TotalSpend", "op": ">", "value": 5000},
            "action": {"type": "powerAutomate", "flow": "VIP Customer Handler"}
        }
    ]
}
```

## Best Practices

### 1. Alert Fatigue Prevention

```python
# Configure alert throttling
trigger_config = {
    "name": "Temperature Alert",
    "condition": {"property": "Temperature", "op": ">", "value": 80},
    "throttling": {
        "max_alerts_per_hour": 2,
        "cooldown_minutes": 30,
        "group_by": "object_id"
    }
}
```

### 2. Escalation Patterns

```python
# Multi-level escalation
escalation_pattern = {
    "levels": [
        {
            "delay": "0m",
            "action": {"type": "email", "to": "on-call@company.com"}
        },
        {
            "delay": "15m",
            "condition": "not_acknowledged",
            "action": {"type": "teams", "channel": "urgent"}
        },
        {
            "delay": "30m",
            "condition": "not_acknowledged",
            "action": {"type": "phone", "to": "manager"}
        }
    ]
}
```

### 3. Testing Triggers

```python
# Test trigger logic before deployment
def test_trigger(trigger_config: dict, test_data: list[dict]) -> list[dict]:
    """Test trigger conditions against sample data."""

    results = []

    for record in test_data:
        triggered = evaluate_condition(trigger_config["condition"], record)

        results.append({
            "record": record,
            "triggered": triggered,
            "trigger_name": trigger_config["name"]
        })

    return results

# Test data
test_data = [
    {"line_id": "L1", "temperature": 75, "status": "Running"},
    {"line_id": "L2", "temperature": 90, "status": "Running"},
    {"line_id": "L3", "temperature": 85, "status": "Stopped"}
]

results = test_trigger(high_temp_trigger, test_data)
```

## Conclusion

Data Activator brings proactive intelligence to your data platform:

1. **Define objects** that represent business entities
2. **Create triggers** for conditions that matter
3. **Configure actions** to respond automatically
4. **Prevent alert fatigue** with throttling and escalation

The combination of Eventstreams, KQL databases, and Data Activator creates a complete real-time intelligence stack - from data ingestion to automated response.
