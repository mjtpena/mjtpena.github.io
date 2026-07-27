---
title: Configuring Azure Service Health Alerts
author: Michael John Peña
draft: false
date: 2021-07-24
url: /blog/service-health-alerts/
tags:
  - Azure
  - Monitoring
  - DevOps
  - Operations
  - Alerts

---

I wrote "2021-07-24-service-health-alerts" to share practical, production-minded guidance on this topic.

# Service Health Event Types

Service Health tracks three types of events:

- **Service Issues**: Active problems affecting Azure services
- **Planned Maintenance**: Upcoming maintenance that might affect availability
- **Health Advisories**: Changes requiring action (feature deprecations, etc.)

# Creating Service Health Alerts

Set up alerts using Azure CLI:

```bash
# Create action group for notifications
az monitor action-group create \
    --resource-group rg-monitoring \
    --name service-health-ag \
    --short-name svchealth \
    --email-receiver name=ops-team email=ops@company.com \
    --sms-receiver name=oncall country-code=1 phone-number=5551234567 \
    --webhook-receiver name=incident-webhook uri=https://incident.company.com/webhook

# Create Service Health alert for service issues
az monitor activity-log alert create \
    --resource-group rg-monitoring \
    --name service-issue-alert \
    --description "Alert for Azure service issues" \
    --scope /subscriptions/$SUBSCRIPTION_ID \
    --condition category=ServiceHealth and properties.incidentType=Incident \
    --action-group /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-monitoring/providers/Microsoft.Insights/actionGroups/service-health-ag

# Create alert for planned maintenance
az monitor activity-log alert create \
    --resource-group rg-monitoring \
    --name maintenance-alert \
    --description "Alert for planned maintenance" \
    --scope /subscriptions/$SUBSCRIPTION_ID \
    --condition category=ServiceHealth and properties.incidentType=Maintenance \
    --action-group /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-monitoring/providers/Microsoft.Insights/actionGroups/service-health-ag
```

# Terraform Configuration

Comprehensive Service Health alerting with Terraform:

```hcl
# Action Group for Service Health
resource "azurerm_monitor_action_group" "service_health" {
  name                = "service-health-alerts"
  resource_group_name = azurerm_resource_group.monitoring.name
  short_name          = "svchlth"

  email_receiver {
    name                    = "ops-team"
    email_address           = "ops@company.com"
    use_common_alert_schema = true
  }

  email_receiver {
    name                    = "management"
    email_address           = "management@company.com"
    use_common_alert_schema = true
  }

  sms_receiver {
    name         = "oncall-sms"
    country_code = "1"
    phone_number = "5551234567"
  }

  webhook_receiver {
    name                    = "incident-management"
    service_uri             = "https://incident.company.com/api/webhook/azure"
    use_common_alert_schema = true
  }

  webhook_receiver {
    name                    = "slack-notifications"
    service_uri             = "https://hooks.slack.com/services/xxx/yyy/zzz"
    use_common_alert_schema = false
  }

  logic_app_receiver {
    name                    = "automation-logic-app"
    resource_id             = azurerm_logic_app_workflow.incident_automation.id
    callback_url            = azurerm_logic_app_trigger_http_request.webhook.callback_url
    use_common_alert_schema = true
  }

  tags = {
    Purpose = "Service Health Alerts"
  }
}

# Service Issues Alert (Outages)
resource "azurerm_monitor_activity_log_alert" "service_issues" {
  name                = "service-issues-alert"
  resource_group_name = azurerm_resource_group.monitoring.name
  scopes              = [data.azurerm_subscription.current.id]
  description         = "Alert for Azure service issues affecting our resources"

  criteria {
    category = "ServiceHealth"

    service_health {
      events    = ["Incident"]
      locations = ["Global", "East US", "West US 2", "West Europe"]
      services  = [
        "Virtual Machines",
        "SQL Database",
        "App Service",
        "Azure Active Directory",
        "Azure Storage",
        "Key Vault",
        "Azure Kubernetes Service"
      ]
    }
  }

  action {
    action_group_id = azurerm_monitor_action_group.service_health.id
  }

  tags = {
    Severity = "Critical"
  }
}

# Planned Maintenance Alert
resource "azurerm_monitor_activity_log_alert" "planned_maintenance" {
  name                = "planned-maintenance-alert"
  resource_group_name = azurerm_resource_group.monitoring.name
  scopes              = [data.azurerm_subscription.current.id]
  description         = "Alert for upcoming Azure maintenance"

  criteria {
    category = "ServiceHealth"

    service_health {
      events = ["Maintenance"]
      locations = ["Global", "East US", "West US 2", "West Europe"]
    }
  }

  action {
    action_group_id = azurerm_monitor_action_group.service_health.id
  }

  tags = {
    Severity = "Warning"
  }
}

# Health Advisories Alert
resource "azurerm_monitor_activity_log_alert" "health_advisories" {
  name                = "health-advisories-alert"
  resource_group_name = azurerm_resource_group.monitoring.name
  scopes              = [data.azurerm_subscription.current.id]
  description         = "Alert for Azure health advisories"

  criteria {
    category = "ServiceHealth"

    service_health {
      events = ["Informational", "ActionRequired"]
    }
  }

  action {
    action_group_id = azurerm_monitor_action_group.service_health.id
  }

  tags = {
    Severity = "Informational"
  }
}

# Security Advisories Alert
resource "azurerm_monitor_activity_log_alert" "security_advisories" {
  name                = "security-advisories-alert"
  resource_group_name = azurerm_resource_group.monitoring.name
  scopes              = [data.azurerm_subscription.current.id]
  description         = "Alert for Azure security advisories"

  criteria {
    category = "ServiceHealth"

    service_health {
      events = ["Security"]
    }
  }

  action {
    action_group_id = azurerm_monitor_action_group.service_health.id
  }

  tags = {
    Severity = "High"
  }
}
```

# Querying Service Health Events

Access Service Health data programmatically:

```python
from azure.mgmt.resourcehealth import ResourceHealthMgmtClient
from azure.identity import DefaultAzureCredential
from datetime import datetime, timedelta

credential = DefaultAzureCredential()

def get_service_health_events(days=7):
    """Get recent Service Health events."""

    # Query Activity Log for ServiceHealth category
    from azure.mgmt.monitor import MonitorManagementClient

    monitor_client = MonitorManagementClient(credential, subscription_id)

    end_time = datetime.utcnow()
    start_time = end_time - timedelta(days=days)

    filter_str = (
        f"eventTimestamp ge '{start_time.isoformat()}Z' and "
        f"eventTimestamp le '{end_time.isoformat()}Z' and "
        "category eq 'ServiceHealth'"
    )

    events = monitor_client.activity_logs.list(filter=filter_str)

    results = []
    for event in events:
        properties = event.properties or {}

        results.append({
            "event_timestamp": event.event_timestamp,
            "incident_type": properties.get("incidentType"),
            "title": properties.get("title"),
            "service": properties.get("service"),
            "region": properties.get("region"),
            "impact": properties.get("impact"),
            "status": properties.get("status"),
            "communication": properties.get("communication"),
            "tracking_id": properties.get("trackingId")
        })

    return results

def analyze_service_health_impact(days=30):
    """Analyze service health events and their impact."""

    events = get_service_health_events(days)

    print(f"\nService Health Analysis (Last {days} days)")
    print("=" * 50)

    # Group by incident type
    by_type = {}
    for event in events:
        inc_type = event["incident_type"] or "Unknown"
        by_type[inc_type] = by_type.get(inc_type, 0) + 1

    print("\nEvents by Type:")
    for inc_type, count in sorted(by_type.items(), key=lambda x: x[1], reverse=True):
        print(f"  {inc_type}: {count}")

    # Group by service
    by_service = {}
    for event in events:
        service = event["service"] or "Unknown"
        by_service[service] = by_service.get(service, 0) + 1

    print("\nEvents by Service:")
    for service, count in sorted(by_service.items(), key=lambda x: x[1], reverse=True)[:10]:
        print(f"  {service}: {count}")

    # List active incidents
    active = [e for e in events if e["status"] == "Active"]
    if active:
        print(f"\nActive Incidents ({len(active)}):")
        for incident in active:
            print(f"  [{incident['tracking_id']}] {incident['title']}")
            print(f"    Service: {incident['service']}, Region: {incident['region']}")

    return events

# Run analysis
analyze_service_health_impact(days=30)
```

# Logic App for Automated Response

Create automated workflows for Service Health events:

```json
{
    "definition": {
        "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
        "triggers": {
            "manual": {
                "type": "Request",
                "kind": "Http",
                "inputs": {
                    "schema": {
                        "type": "object",
                        "properties": {
                            "schemaId": {"type": "string"},
                            "data": {
                                "type": "object",
                                "properties": {
                                    "essentials": {
                                        "type": "object",
                                        "properties": {
                                            "alertId": {"type": "string"},
                                            "alertRule": {"type": "string"},
                                            "severity": {"type": "string"},
                                            "signalType": {"type": "string"},
                                            "firedDateTime": {"type": "string"}
                                        }
                                    },
                                    "alertContext": {
                                        "type": "object",
                                        "properties": {
                                            "properties": {
                                                "type": "object",
                                                "properties": {
                                                    "title": {"type": "string"},
                                                    "service": {"type": "string"},
                                                    "region": {"type": "string"},
                                                    "incidentType": {"type": "string"},
                                                    "trackingId": {"type": "string"}
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        "actions": {
            "Parse_Alert": {
                "type": "ParseJson",
                "inputs": {
                    "content": "@triggerBody()",
                    "schema": {}
                }
            },
            "Check_Incident_Type": {
                "type": "Switch",
                "expression": "@body('Parse_Alert')?['data']?['alertContext']?['properties']?['incidentType']",
                "cases": {
                    "Incident": {
                        "case": "Incident",
                        "actions": {
                            "Create_High_Priority_Ticket": {
                                "type": "Http",
                                "inputs": {
                                    "method": "POST",
                                    "uri": "https://servicenow.company.com/api/now/table/incident",
                                    "headers": {
                                        "Content-Type": "application/json",
                                        "Authorization": "Basic @{base64(concat(variables('ServiceNowUser'), ':', variables('ServiceNowPassword')))}"
                                    },
                                    "body": {
                                        "short_description": "Azure Service Issue: @{body('Parse_Alert')?['data']?['alertContext']?['properties']?['title']}",
                                        "urgency": "1",
                                        "impact": "1",
                                        "category": "Cloud Services",
                                        "description": "Service: @{body('Parse_Alert')?['data']?['alertContext']?['properties']?['service']}\nRegion: @{body('Parse_Alert')?['data']?['alertContext']?['properties']?['region']}\nTracking ID: @{body('Parse_Alert')?['data']?['alertContext']?['properties']?['trackingId']}"
                                    }
                                }
                            },
                            "Page_On_Call": {
                                "type": "Http",
                                "inputs": {
                                    "method": "POST",
                                    "uri": "https://events.pagerduty.com/v2/enqueue",
                                    "body": {
                                        "routing_key": "@{variables('PagerDutyKey')}",
                                        "event_action": "trigger",
                                        "payload": {
                                            "summary": "Azure Service Issue: @{body('Parse_Alert')?['data']?['alertContext']?['properties']?['title']}",
                                            "severity": "critical",
                                            "source": "Azure Service Health"
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "Maintenance": {
                        "case": "Maintenance",
                        "actions": {
                            "Send_Maintenance_Notification": {
                                "type": "Http",
                                "inputs": {
                                    "method": "POST",
                                    "uri": "@{variables('SlackWebhookUrl')}",
                                    "body": {
                                        "text": "Planned Azure Maintenance",
                                        "attachments": [{
                                            "color": "warning",
                                            "title": "@{body('Parse_Alert')?['data']?['alertContext']?['properties']?['title']}",
                                            "fields": [
                                                {"title": "Service", "value": "@{body('Parse_Alert')?['data']?['alertContext']?['properties']?['service']}", "short": true},
                                                {"title": "Region", "value": "@{body('Parse_Alert')?['data']?['alertContext']?['properties']?['region']}", "short": true}
                                            ]
                                        }]
                                    }
                                }
                            }
                        }
                    }
                },
                "default": {
                    "actions": {
                        "Log_Event": {
                            "type": "Compose",
                            "inputs": "Received Service Health event: @{body('Parse_Alert')}"
                        }
                    }
                }
            }
        }
    }
}
```

# Service Health Dashboard

Create a status dashboard:

```kusto
// KQL query for Service Health dashboard
AzureActivity
| where CategoryValue == "ServiceHealth"
| where TimeGenerated > ago(30d)
| extend IncidentType = tostring(parse_json(Properties).incidentType)
| extend Title = tostring(parse_json(Properties).title)
| extend Service = tostring(parse_json(Properties).service)
| extend Region = tostring(parse_json(Properties).region)
| extend Status = tostring(parse_json(Properties).status)
| extend TrackingId = tostring(parse_json(Properties).trackingId)
| project TimeGenerated, IncidentType, Title, Service, Region, Status, TrackingId
| order by TimeGenerated desc

// Summary by incident type
AzureActivity
| where CategoryValue == "ServiceHealth"
| where TimeGenerated > ago(30d)
| extend IncidentType = tostring(parse_json(Properties).incidentType)
| summarize Count = count() by IncidentType
| render piechart

// Timeline of incidents
AzureActivity
| where CategoryValue == "ServiceHealth"
| where TimeGenerated > ago(30d)
| extend IncidentType = tostring(parse_json(Properties).incidentType)
| summarize Count = count() by bin(TimeGenerated, 1d), IncidentType
| render timechart
```

# Conclusion

Service Health alerts are essential for proactive operations in Azure. By configuring comprehensive alerts for service issues, planned maintenance, and health advisories, you ensure your team is informed about platform-level issues that could impact your applications.

Combine Service Health alerts with automated workflows in Logic Apps or Azure Functions to streamline incident response. This integration enables automatic ticket creation, on-call paging, and stakeholder communication when Azure platform issues occur.

