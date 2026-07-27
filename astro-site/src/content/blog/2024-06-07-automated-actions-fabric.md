---
title: "Automated Actions in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-06-07
tags:
  - Microsoft Fabric
  - Automation
  - Power Automate
  - Data Activator
  - Integration
---

Automated actions are what make Data Activator powerful. Today I'm exploring all the ways you can respond to data conditions automatically.

## Action Types

```
Available Actions:
├── Email (built-in)
├── Microsoft Teams (built-in)
├── Power Automate (extensible)
├── Webhook (custom integrations)
└── Fabric Items (pipelines, notebooks)
```

## Email Actions

Data Activator actions are configured through the Fabric UI. Here's how to set up email notifications.

### Basic Email (via UI)

Configure in the Data Activator trigger editor:

```json
// Email action configuration (created via UI)
{
  "type": "email",
  "recipients": ["team@company.com", "manager@company.com"],
  "subject": "Alert: {{TriggerName}}",
  "body": "<h2>Alert Details</h2><p><strong>Object:</strong> {{ObjectName}}</p><p><strong>Value:</strong> {{CurrentValue}}</p><p><strong>Threshold:</strong> {{ThresholdValue}}</p><p><strong>Time:</strong> {{TriggerTime}}</p><a href='{{DashboardUrl}}'>View Dashboard</a>",
  "format": "html"
}
```

### Dynamic Recipients via Power Automate

For dynamic recipient routing, use Power Automate:

```python
import requests

# Power Automate HTTP trigger for dynamic routing
FLOW_WEBHOOK = "https://prod-xx.westus.logic.azure.com/workflows/..."

def send_dynamic_alert(alert_data: dict):
    """Route alerts dynamically based on data properties."""
    response = requests.post(
        FLOW_WEBHOOK,
        json={
            "triggerName": alert_data["TriggerName"],
            "objectId": alert_data["ObjectId"],
            "currentValue": alert_data["CurrentValue"],
            "region": alert_data["Region"],
            "ownerEmail": alert_data["OwnerEmail"],
            "severity": alert_data["Severity"]
        },
        headers={"Content-Type": "application/json"}
    )
    return response.status_code == 202
```

### Templated Emails

Create HTML templates for consistent formatting:

```html
<!-- Email template for Data Activator alerts -->
<!DOCTYPE html>
<html>
<head>
    <style>
        .alert-box { padding: 20px; border-radius: 8px; }
        .critical { background: #ff4444; color: white; }
        .warning { background: #ffaa00; color: black; }
        .info { background: #4488ff; color: white; }
    </style>
</head>
<body>
    <div class="alert-box {{SeverityClass}}">
        <h1>{{TriggerName}}</h1>
        <table>
            <tr><td>Object</td><td>{{ObjectId}}</td></tr>
            <tr><td>Value</td><td>{{CurrentValue}}</td></tr>
            <tr><td>Time</td><td>{{TriggerTime}}</td></tr>
        </table>
    </div>
    <p>
        <a href="{{ActionUrl}}">Take Action</a> |
        <a href="{{DashboardUrl}}">View Dashboard</a> |
        <a href="{{MuteUrl}}">Mute for 24h</a>
    </p>
</body>
</html>
```

## Teams Actions

### Channel Message (via UI)

Configure Teams notifications in Data Activator:

```json
// Teams action configuration
{
  "type": "teams",
  "destination": "channel",
  "teamId": "team-guid",
  "channelId": "channel-guid",
  "messageFormat": "adaptiveCard",
  "card": {
    "type": "AdaptiveCard",
    "body": [
      {
        "type": "TextBlock",
        "text": "{{TriggerName}}",
        "weight": "bolder",
        "size": "large"
      },
      {
        "type": "FactSet",
        "facts": [
          {"title": "Device", "value": "{{DeviceId}}"},
          {"title": "Value", "value": "{{CurrentValue}}"},
          {"title": "Time", "value": "{{TriggerTime}}"}
        ]
      }
    ],
    "actions": [
      {
        "type": "Action.OpenUrl",
        "title": "View Dashboard",
        "url": "{{DashboardUrl}}"
      }
    ]
  }
}
```

### Send Adaptive Card via Power Automate

```python
import requests

# Teams webhook connector
TEAMS_WEBHOOK = "https://outlook.office.com/webhook/..."

def send_teams_card(alert_data: dict):
    """Send an Adaptive Card to Teams."""
    card = {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        "themeColor": "FF0000" if alert_data["severity"] == "critical" else "FFA500",
        "summary": f"Alert: {alert_data['triggerName']}",
        "sections": [{
            "activityTitle": alert_data["triggerName"],
            "facts": [
                {"name": "Device", "value": alert_data["deviceId"]},
                {"name": "Value", "value": str(alert_data["currentValue"])},
                {"name": "Time", "value": alert_data["timestamp"]}
            ],
            "markdown": True
        }],
        "potentialAction": [{
            "@type": "OpenUri",
            "name": "View Dashboard",
            "targets": [{"os": "default", "uri": alert_data["dashboardUrl"]}]
        }]
    }

    response = requests.post(TEAMS_WEBHOOK, json=card)
    return response.status_code == 200
```

## Power Automate Integration

### Calling a Flow from Data Activator

Set up an HTTP-triggered Power Automate flow:

```json
{
  "definition": {
    "triggers": {
      "manual": {
        "type": "Request",
        "kind": "Http",
        "inputs": {
          "schema": {
            "type": "object",
            "properties": {
              "alertType": {"type": "string"},
              "deviceId": {"type": "string"},
              "currentValue": {"type": "number"},
              "timestamp": {"type": "string"}
            }
          }
        }
      }
    },
    "actions": {
      "Create_ServiceNow_Incident": {
        "type": "ApiConnection",
        "inputs": {
          "host": {"connectionName": "servicenow"},
          "method": "post",
          "path": "/api/now/table/incident",
          "body": {
            "short_description": "Alert: @{triggerBody()?['alertType']}",
            "description": "Device @{triggerBody()?['deviceId']} reported value @{triggerBody()?['currentValue']}",
            "urgency": 2,
            "impact": 2
          }
        }
      },
      "Send_Slack_Message": {
        "type": "ApiConnection",
        "inputs": {
          "host": {"connectionName": "slack"},
          "method": "post",
          "path": "/chat.postMessage",
          "body": {
            "channel": "#alerts",
            "text": "New incident created for @{triggerBody()?['deviceId']}"
          }
        }
      }
    }
  }
}
```

### Python Client to Trigger Power Automate

```python
import requests
import json
from datetime import datetime

class PowerAutomateClient:
    """Client for triggering Power Automate flows."""

    def __init__(self, flow_url: str):
        self.flow_url = flow_url

    def trigger_flow(self, parameters: dict, wait_for_completion: bool = False) -> dict:
        """Trigger a Power Automate flow with parameters."""
        response = requests.post(
            self.flow_url,
            json=parameters,
            headers={"Content-Type": "application/json"},
            timeout=30 if wait_for_completion else 5
        )

        return {
            "status": response.status_code,
            "accepted": response.status_code == 202,
            "response": response.json() if response.content else None
        }

# Example usage
flow_client = PowerAutomateClient(
    flow_url="https://prod-xx.westus.logic.azure.com/workflows/..."
)

result = flow_client.trigger_flow({
    "alertType": "LowStock",
    "deviceId": "DEVICE-001",
    "currentValue": 5,
    "threshold": 10,
    "timestamp": datetime.utcnow().isoformat(),
    "metadata": {
        "region": "West US",
        "owner": "operations@company.com"
    }
})

print(f"Flow triggered: {result['accepted']}")
```

## Webhook Actions

### Basic Webhook Configuration

Configure webhooks in Data Activator:

```json
// Webhook action configuration
{
  "type": "webhook",
  "url": "https://api.example.com/alerts",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json",
    "Authorization": "Bearer {{secrets.API_KEY}}"
  },
  "body": {
    "alert": {
      "type": "{{TriggerName}}",
      "source": "Fabric Data Activator",
      "timestamp": "{{TriggerTime}}",
      "object": {
        "type": "{{ObjectType}}",
        "id": "{{ObjectId}}"
      },
      "data": {
        "currentValue": "{{CurrentValue}}",
        "threshold": "{{ThresholdValue}}"
      }
    }
  }
}
```

### PagerDuty Integration

```python
import requests
import os

def create_pagerduty_incident(alert_data: dict):
    """Create a PagerDuty incident from an alert."""
    response = requests.post(
        "https://events.pagerduty.com/v2/enqueue",
        json={
            "routing_key": os.environ["PAGERDUTY_KEY"],
            "event_action": "trigger",
            "dedup_key": f"{alert_data['objectId']}-{alert_data['triggerName']}",
            "payload": {
                "summary": f"{alert_data['triggerName']} - {alert_data['objectId']}",
                "severity": alert_data.get("severity", "warning"),
                "source": "Fabric Data Activator",
                "timestamp": alert_data["timestamp"],
                "custom_details": {
                    "device_id": alert_data["objectId"],
                    "value": alert_data["currentValue"],
                    "threshold": alert_data["threshold"]
                }
            }
        },
        headers={"Content-Type": "application/json"}
    )
    return response.json()
```

## Fabric Item Actions

### Trigger Pipeline via REST API

```python
import requests
from azure.identity import DefaultAzureCredential

def trigger_fabric_pipeline(workspace_id: str, pipeline_name: str, parameters: dict):
    """Trigger a Fabric pipeline from an alert."""
    credential = DefaultAzureCredential()
    token = credential.get_token("https://api.fabric.microsoft.com/.default")

    headers = {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json"
    }

    # Get pipeline ID
    response = requests.get(
        f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items?type=DataPipeline",
        headers=headers
    )
    pipelines = response.json()

    pipeline_id = None
    for p in pipelines.get("value", []):
        if p["displayName"] == pipeline_name:
            pipeline_id = p["id"]
            break

    if not pipeline_id:
        raise ValueError(f"Pipeline {pipeline_name} not found")

    # Trigger pipeline run
    run_response = requests.post(
        f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items/{pipeline_id}/jobs/instances?jobType=Pipeline",
        headers=headers,
        json={"executionData": {"parameters": parameters}}
    )

    return run_response.json()
```

### Run Notebook via REST API

```python
def trigger_fabric_notebook(workspace_id: str, notebook_name: str, parameters: dict):
    """Trigger a Fabric notebook from an alert."""
    credential = DefaultAzureCredential()
    token = credential.get_token("https://api.fabric.microsoft.com/.default")

    headers = {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json"
    }

    # Get notebook ID
    response = requests.get(
        f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items?type=Notebook",
        headers=headers
    )
    notebooks = response.json()

    notebook_id = None
    for nb in notebooks.get("value", []):
        if nb["displayName"] == notebook_name:
            notebook_id = nb["id"]
            break

    if not notebook_id:
        raise ValueError(f"Notebook {notebook_name} not found")

    # Trigger notebook run
    run_response = requests.post(
        f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items/{notebook_id}/jobs/instances?jobType=RunNotebook",
        headers=headers,
        json={"executionData": {"parameters": parameters}}
    )

    return run_response.json()
```

## Composite Actions via Power Automate

### Multiple Actions Flow

```json
{
  "definition": {
    "triggers": {
      "When_alert_received": {
        "type": "Request",
        "kind": "Http"
      }
    },
    "actions": {
      "Parallel_Actions": {
        "type": "Parallel",
        "branches": [
          {
            "actions": {
              "Post_to_Teams": {
                "type": "ApiConnection",
                "inputs": {
                  "host": {"connectionName": "teams"},
                  "method": "post",
                  "path": "/v1.0/teams/{teamId}/channels/{channelId}/messages"
                }
              }
            }
          },
          {
            "actions": {
              "Send_Email": {
                "type": "ApiConnection",
                "inputs": {
                  "host": {"connectionName": "office365"},
                  "method": "post",
                  "path": "/v2/Mail"
                }
              }
            }
          },
          {
            "actions": {
              "Call_Webhook": {
                "type": "Http",
                "inputs": {
                  "method": "POST",
                  "uri": "https://api.example.com/log"
                }
              }
            }
          }
        ]
      }
    }
  }
}
```

### Conditional Actions Flow

```json
{
  "definition": {
    "actions": {
      "Switch_on_Severity": {
        "type": "Switch",
        "expression": "@triggerBody()?['severity']",
        "cases": {
          "critical": {
            "actions": {
              "Teams_Urgent": {
                "type": "ApiConnection",
                "inputs": {"urgency": "important"}
              },
              "PagerDuty": {"type": "Http"},
              "Call_Flow": {"type": "Workflow"}
            }
          },
          "high": {
            "actions": {
              "Teams_Normal": {"type": "ApiConnection"},
              "Email": {"type": "ApiConnection"}
            }
          },
          "medium": {
            "actions": {
              "Email_Only": {"type": "ApiConnection"}
            }
          }
        },
        "default": {
          "actions": {
            "Log_Event": {"type": "Compose"}
          }
        }
      }
    }
  }
}
```

## Error Handling

```python
import requests
from tenacity import retry, stop_after_attempt, wait_exponential

class AlertActionHandler:
    """Handle alert actions with retry and fallback."""

    def __init__(self, primary_webhook: str, fallback_email: str):
        self.primary_webhook = primary_webhook
        self.fallback_email = fallback_email

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
    def send_primary(self, alert_data: dict):
        """Send to primary webhook with retry."""
        response = requests.post(
            self.primary_webhook,
            json=alert_data,
            timeout=10
        )
        response.raise_for_status()
        return response

    def send_with_fallback(self, alert_data: dict):
        """Send alert with fallback on failure."""
        try:
            return self.send_primary(alert_data)
        except Exception as e:
            # Log the error
            print(f"Primary webhook failed: {e}")

            # Send to fallback
            return self.send_fallback_email(alert_data)

    def send_fallback_email(self, alert_data: dict):
        """Send fallback email notification."""
        # Use Power Automate or direct email API
        # ...
        pass
```

## Best Practices

1. **Use appropriate urgency** - Don't cry wolf
2. **Include actionable info** - What should recipient do?
3. **Implement fallbacks** - Actions can fail
4. **Rate limit notifications** - Prevent spam
5. **Track action success** - Monitor delivery

## What's Next

Tomorrow I'll cover Fabric Copilot updates.

## Resources

- [Data Activator Actions](https://learn.microsoft.com/fabric/data-activator/data-activator-actions)
- [Power Automate Connectors](https://learn.microsoft.com/connectors/)
- [Adaptive Cards](https://adaptivecards.io/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
