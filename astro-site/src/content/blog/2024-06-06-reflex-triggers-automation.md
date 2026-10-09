---
title: "Reflex Triggers: Building Automated Data Workflows"
description: "Reflex triggers are the heart of Data Activator. Today I'm diving deep into building sophisticated automated workflows that respond to your data."
author: Michael John Peña
draft: false
date: 2024-06-06
tags:
  - Microsoft Fabric
  - Data Activator
  - Reflex
  - Automation
  - Triggers
---

Reflex triggers are the heart of Data Activator. Today I'm diving deep into building sophisticated automated workflows that respond to your data.

## Trigger Architecture

```
Data Flow → Object Detection → Property Evaluation → Trigger Condition → Action Execution
                                                           ↓
                                                    Cooldown/Dedup
```

## Building Effective Triggers

Data Activator triggers are configured through the Fabric UI, not via SDK. Here's how the workflow typically looks.

### Basic Trigger Pattern (via Fabric UI)

In the Data Activator experience:

1. **Create a Reflex item** in your Fabric workspace
2. **Connect your data source** (EventStream, Power BI, or custom events)
3. **Define objects** to monitor (e.g., Products, Sensors, Customers)
4. **Set up trigger conditions** using the visual designer

```json
// Conceptual trigger configuration (created via UI)
{
  "name": "LowStockAlert",
  "object": "Product",
  "keyProperty": "ProductId",
  "monitoredProperties": {
    "StockLevel": {"type": "numeric", "path": "$.inventory.quantity"},
    "LastRestocked": {"type": "datetime", "path": "$.inventory.lastUpdate"},
    "Category": {"type": "string", "path": "$.category"}
  },
  "condition": {
    "property": "StockLevel",
    "operator": "lessThan",
    "value": 10
  },
  "action": {
    "type": "email",
    "recipients": ["inventory@company.com"],
    "subject": "Low Stock Alert: {{ProductId}}",
    "body": "Product {{ProductId}} has only {{StockLevel}} units remaining."
  }
}
```

### Integrating with Power Automate

For programmatic access, use Power Automate flows triggered by Data Activator:

```python
import requests
import json

# Power Automate HTTP trigger endpoint
POWER_AUTOMATE_WEBHOOK = "https://prod-xx.westus.logic.azure.com/workflows/..."

def send_alert_to_power_automate(alert_data: dict):
    """Send alert data to Power Automate for processing."""
    response = requests.post(
        POWER_AUTOMATE_WEBHOOK,
        json={
            "alertType": "LowStockAlert",
            "productId": alert_data["ProductId"],
            "stockLevel": alert_data["StockLevel"],
            "category": alert_data["Category"],
            "timestamp": alert_data["Timestamp"]
        },
        headers={"Content-Type": "application/json"}
    )
    return response.status_code == 202
```

### Threshold with Hysteresis

Prevent alert flapping by configuring hysteresis in the UI:

```json
// Configured via Data Activator UI
{
  "name": "TemperatureAlert",
  "object": "Sensor",
  "condition": {
    "type": "threshold_with_hysteresis",
    "property": "Temperature",
    "high_threshold": 80,
    "low_threshold": 70,
    "initial_state": "normal"
  },
  "action": {
    "type": "teams",
    "channel": "alerts",
    "message": "Temperature {{state}}: {{Temperature}}C"
  }
}
```

### Using Fabric REST APIs

For programmatic management, use the Fabric REST APIs:

```python
import requests
from azure.identity import DefaultAzureCredential

# Authenticate using Azure credentials
credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default")

headers = {
    "Authorization": f"Bearer {token.token}",
    "Content-Type": "application/json"
}

# List Reflex items in a workspace
workspace_id = "your-workspace-id"
response = requests.get(
    f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items?type=Reflex",
    headers=headers
)
reflex_items = response.json()

# Get Reflex item details
for item in reflex_items.get("value", []):
    print(f"Reflex: {item['displayName']}, ID: {item['id']}")
```

### Comparison Triggers

Compare current vs historical values:

```json
// Configured via Data Activator UI
{
  "name": "SalesDropAlert",
  "object": "Store",
  "condition": {
    "type": "comparison",
    "property": "HourlySales",
    "compare_to": {
      "type": "historical",
      "period": "same_hour_last_week"
    },
    "operator": "lessThan",
    "threshold_percent": 30
  },
  "action": {
    "type": "email",
    "recipients": ["sales@company.com"],
    "subject": "Sales Alert for {{StoreName}}"
  }
}
```

## Complex Conditions

### AND Logic

In the Data Activator UI, you can combine multiple conditions:

```json
{
  "name": "CriticalCondition",
  "object": "Machine",
  "condition": {
    "type": "compound",
    "operator": "AND",
    "conditions": [
      {"property": "Temperature", "operator": "greaterThan", "value": 90},
      {"property": "Vibration", "operator": "greaterThan", "value": 5},
      {"property": "Runtime", "operator": "greaterThan", "value": 8}
    ]
  },
  "action": {
    "type": "teams",
    "channel": "critical-alerts",
    "urgency": "important",
    "message": "CRITICAL: Machine {{MachineId}} requires immediate attention"
  }
}
```

### OR Logic

```json
{
  "name": "AnyAnomalyAlert",
  "object": "Device",
  "condition": {
    "type": "compound",
    "operator": "OR",
    "conditions": [
      {"property": "Temperature", "type": "anomaly", "sensitivity": "high"},
      {"property": "Pressure", "type": "anomaly", "sensitivity": "high"},
      {"property": "Vibration", "type": "anomaly", "sensitivity": "high"}
    ]
  },
  "action": {
    "type": "email",
    "recipients": ["maintenance@company.com"]
  }
}
```

## Time-Based Triggers

### Schedule-Based

Configure scheduled triggers in the UI:

```json
// Daily summary trigger
{
  "name": "DailyReport",
  "schedule": {
    "type": "cron",
    "expression": "0 8 * * *",
    "timezone": "America/Los_Angeles"
  },
  "query": {
    "aggregate": "all",
    "object": "Store",
    "measures": ["TotalSales", "OrderCount", "AvgOrderValue"]
  },
  "action": {
    "type": "email",
    "recipients": ["leadership@company.com"],
    "template": "daily-summary-report"
  }
}
```

### Duration-Based

```json
// Only alert if condition persists
{
  "name": "SustainedHighUsage",
  "object": "Server",
  "condition": {
    "property": "CPUUsage",
    "operator": "greaterThan",
    "value": 90,
    "duration": {
      "min": "5m",
      "check_interval": "30s"
    }
  },
  "action": {
    "type": "teams",
    "channel": "infra-alerts"
  }
}
```

## Cooldown and Deduplication

Configure via the Data Activator UI:

```json
{
  "name": "AlertWithCooldown",
  "object": "Device",
  "condition": {
    "property": "ErrorCount",
    "operator": "greaterThan",
    "value": 0
  },
  "cooldown": {
    "duration": "1h",
    "scope": "per_object"
  },
  "deduplication": {
    "enabled": true,
    "window": "15m",
    "key_properties": ["ErrorType"]
  },
  "action": {
    "type": "email",
    "recipients": ["support@company.com"]
  }
}
```

## Power Automate Flow for Dynamic Actions

```json
{
  "definition": {
    "triggers": {
      "When_Data_Activator_fires": {
        "type": "Request",
        "kind": "Http",
        "inputs": {
          "schema": {
            "type": "object",
            "properties": {
              "alertType": {"type": "string"},
              "objectId": {"type": "string"},
              "severity": {"type": "string"},
              "currentValue": {"type": "number"}
            }
          }
        }
      }
    },
    "actions": {
      "Switch_on_Severity": {
        "type": "Switch",
        "expression": "@triggerBody()?['severity']",
        "cases": {
          "critical": {
            "actions": {
              "Post_to_Teams": {"type": "ApiConnection"},
              "Create_PagerDuty_Incident": {"type": "Http"}
            }
          },
          "high": {
            "actions": {
              "Send_Email": {"type": "ApiConnection"}
            }
          }
        },
        "default": {
          "actions": {
            "Log_to_Table": {"type": "ApiConnection"}
          }
        }
      }
    }
  }
}
```

## Testing Triggers

Use the Data Activator UI to test triggers:

1. **Open your Reflex item** in Fabric
2. **Navigate to the trigger** you want to test
3. **Click "Test"** and provide sample data
4. **Review the evaluation result** and action preview

For automated testing, send test events to your EventStream:

```python
from azure.eventhub import EventHubProducerClient, EventData
import json

# Send test event
producer = EventHubProducerClient.from_connection_string(
    conn_str="your-eventhub-connection-string",
    eventhub_name="your-eventhub-name"
)

test_data = {
    "ProductId": "P001",
    "StockLevel": 5,
    "Category": "Electronics",
    "Timestamp": "2024-06-06T10:30:00Z"
}

with producer:
    event_batch = producer.create_batch()
    event_batch.add(EventData(json.dumps(test_data)))
    producer.send_batch(event_batch)
    print("Test event sent - check Data Activator for trigger evaluation")
```

## Monitoring Triggers

Use Fabric workspace monitoring and Azure Monitor:

```python
from azure.monitor.query import LogsQueryClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
client = LogsQueryClient(credential)

# Query trigger execution logs
query = """
FabricActivity
| where Category == "DataActivator"
| where OperationName == "TriggerFired"
| summarize
    TotalEvaluations = count(),
    TimesFired = countif(Result == "Fired"),
    ActionSucceeded = countif(ActionResult == "Success"),
    ActionFailed = countif(ActionResult == "Failed")
  by TriggerName
| order by TimesFired desc
"""

response = client.query_workspace(
    workspace_id="your-log-analytics-workspace-id",
    query=query,
    timespan="P7D"
)

for row in response.tables[0].rows:
    print(f"Trigger: {row[0]}, Fired: {row[2]}, Success: {row[3]}, Failed: {row[4]}")
```

## Best Practices

1. **Start with simple triggers** - Add complexity gradually
2. **Use appropriate cooldowns** - Prevent alert storms
3. **Test thoroughly** - Use the UI test feature before production
4. **Monitor performance** - Track latency and failures
5. **Document trigger logic** - Future you will thank you

## What's Next

Tomorrow I'll cover automated actions in more depth.

## Resources

- [Data Activator Triggers](https://learn.microsoft.com/fabric/data-activator/data-activator-triggers)
- [Condition Types](https://learn.microsoft.com/fabric/data-activator/data-activator-conditions)
- [Best Practices](https://learn.microsoft.com/fabric/data-activator/data-activator-best-practices)
