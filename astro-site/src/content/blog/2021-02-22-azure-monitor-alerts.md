---
title: Proactive Monitoring with Azure Monitor Alerts
author: Michael John Peña
draft: false
date: 2021-02-22
url: /blog/azure-monitor-alerts/
tags:
  - Azure
  - Monitoring
  - Alerts
  - DevOps
  - Observability

---

I wrote "2021-02-22-azure-monitor-alerts" to share practical, production-minded guidance on this topic.

## Types of Alerts

Azure Monitor supports several alert types:

- **Metric alerts** - Based on metric values crossing thresholds
- **Log alerts** - Based on Log Analytics query results
- **Activity log alerts** - Based on Azure activity log events
- **Smart detection alerts** - AI-powered anomaly detection

## Creating Metric Alerts

```bash
# Create an action group for notifications
az monitor action-group create \
    --name ag-ops-team \
    --resource-group rg-monitoring \
    --short-name ops-team \
    --action email ops-email ops@company.com \
    --action webhook ops-webhook "https://hooks.slack.com/services/xxx"

# Create a metric alert for high CPU
az monitor metrics alert create \
    --name "High CPU Alert" \
    --resource-group rg-monitoring \
    --scopes "/subscriptions/{sub-id}/resourceGroups/rg-app/providers/Microsoft.Web/sites/mywebapp" \
    --condition "avg Percentage CPU > 80" \
    --window-size 5m \
    --evaluation-frequency 1m \
    --action ag-ops-team \
    --severity 2 \
    --description "Alert when CPU exceeds 80% for 5 minutes"

# Create alert for multiple conditions
az monitor metrics alert create \
    --name "App Health Alert" \
    --resource-group rg-monitoring \
    --scopes "/subscriptions/{sub-id}/resourceGroups/rg-app/providers/Microsoft.Web/sites/mywebapp" \
    --condition "avg Http5xx > 10" \
    --condition "avg ResponseTime > 5" \
    --window-size 5m \
    --evaluation-frequency 1m \
    --action ag-ops-team \
    --severity 1
```

## Log-Based Alerts

### Creating Log Alerts with ARM

```json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "resources": [
        {
            "type": "microsoft.insights/scheduledqueryrules",
            "apiVersion": "2021-08-01",
            "name": "High Error Rate Alert",
            "location": "eastus",
            "properties": {
                "displayName": "High Error Rate Alert",
                "description": "Alert when error rate exceeds threshold",
                "severity": 1,
                "enabled": true,
                "evaluationFrequency": "PT5M",
                "windowSize": "PT15M",
                "scopes": [
                    "[resourceId('Microsoft.OperationalInsights/workspaces', 'myloganalytics')]"
                ],
                "criteria": {
                    "allOf": [
                        {
                            "query": "AppRequests | where ResultCode >= 500 | summarize ErrorCount = count() by bin(TimeGenerated, 5m)",
                            "timeAggregation": "Total",
                            "metricMeasureColumn": "ErrorCount",
                            "operator": "GreaterThan",
                            "threshold": 50,
                            "failingPeriods": {
                                "numberOfEvaluationPeriods": 3,
                                "minFailingPeriodsToAlert": 2
                            }
                        }
                    ]
                },
                "actions": {
                    "actionGroups": [
                        "[resourceId('microsoft.insights/actionGroups', 'ag-ops-team')]"
                    ],
                    "customProperties": {
                        "Team": "Platform",
                        "Priority": "P1"
                    }
                }
            }
        }
    ]
}
```

### Common Log Alert Queries

```kusto
// High exception rate
AppExceptions
| where TimeGenerated > ago(15m)
| summarize ExceptionCount = count() by AppRoleInstance
| where ExceptionCount > 100

// Slow database queries
AppDependencies
| where TimeGenerated > ago(15m)
| where DependencyType == "SQL"
| where DurationMs > 5000
| summarize SlowQueries = count(), AvgDuration = avg(DurationMs)
| where SlowQueries > 10

// Memory pressure
Perf
| where TimeGenerated > ago(5m)
| where ObjectName == "Memory" and CounterName == "% Committed Bytes In Use"
| summarize AvgMemory = avg(CounterValue) by Computer
| where AvgMemory > 90

// Failed logins
SigninLogs
| where TimeGenerated > ago(1h)
| where ResultType != 0
| summarize FailedAttempts = count() by UserPrincipalName, IPAddress
| where FailedAttempts > 10
```

## Activity Log Alerts

```bash
# Alert on service health incidents
az monitor activity-log alert create \
    --name "Service Health Alert" \
    --resource-group rg-monitoring \
    --condition category=ServiceHealth \
    --action-group ag-ops-team \
    --scope "/subscriptions/{sub-id}"

# Alert on resource deletion
az monitor activity-log alert create \
    --name "Resource Deletion Alert" \
    --resource-group rg-monitoring \
    --condition category=Administrative \
    --condition operationName="Microsoft.Resources/subscriptions/resourceGroups/delete" \
    --action-group ag-ops-team \
    --scope "/subscriptions/{sub-id}"
```

## Smart Detection Alerts

Configure Application Insights smart detection:

```python
from azure.identity import DefaultAzureCredential
from azure.mgmt.applicationinsights import ApplicationInsightsManagementClient

credential = DefaultAzureCredential()
client = ApplicationInsightsManagementClient(credential, subscription_id)

# Get smart detection rules
rules = client.proactive_detection_configurations.list(
    resource_group_name="rg-app",
    resource_name="myappinsights"
)

for rule in rules:
    print(f"Rule: {rule.name}")
    print(f"  Enabled: {rule.enabled}")
    print(f"  Send emails to subscription owners: {rule.send_emails_to_subscription_owners}")

# Update a rule
client.proactive_detection_configurations.update(
    resource_group_name="rg-app",
    resource_name="myappinsights",
    configuration_id="degradationindependencyduration",
    proactive_detection_configuration_properties={
        "enabled": True,
        "send_emails_to_subscription_owners": True,
        "custom_emails": ["oncall@company.com"]
    }
)
```

## Action Groups Configuration

```json
{
    "type": "microsoft.insights/actionGroups",
    "apiVersion": "2021-09-01",
    "name": "ag-comprehensive",
    "location": "Global",
    "properties": {
        "groupShortName": "ops-all",
        "enabled": true,
        "emailReceivers": [
            {
                "name": "ops-team-email",
                "emailAddress": "ops@company.com",
                "useCommonAlertSchema": true
            }
        ],
        "smsReceivers": [
            {
                "name": "oncall-sms",
                "countryCode": "1",
                "phoneNumber": "5551234567"
            }
        ],
        "webhookReceivers": [
            {
                "name": "slack-webhook",
                "serviceUri": "https://hooks.slack.com/services/xxx",
                "useCommonAlertSchema": true,
                "useAadAuth": false
            },
            {
                "name": "pagerduty-webhook",
                "serviceUri": "https://events.pagerduty.com/integration/xxx/enqueue",
                "useCommonAlertSchema": true
            }
        ],
        "azureFunctionReceivers": [
            {
                "name": "auto-remediation",
                "functionAppResourceId": "/subscriptions/{sub-id}/resourceGroups/rg-app/providers/Microsoft.Web/sites/func-alerts",
                "functionName": "HandleAlert",
                "httpTriggerUrl": "https://func-alerts.azurewebsites.net/api/HandleAlert",
                "useCommonAlertSchema": true
            }
        ],
        "logicAppReceivers": [
            {
                "name": "incident-workflow",
                "resourceId": "/subscriptions/{sub-id}/resourceGroups/rg-app/providers/Microsoft.Logic/workflows/IncidentWorkflow",
                "callbackUrl": "https://xxx.logic.azure.com:443/workflows/xxx",
                "useCommonAlertSchema": true
            }
        ],
        "armRoleReceivers": [
            {
                "name": "notify-owners",
                "roleId": "8e3af657-a8ff-443c-a75c-2fe8c4bcb635",
                "useCommonAlertSchema": true
            }
        ]
    }
}
```

## Auto-Remediation with Azure Functions

```python
# Azure Function for auto-remediation
import azure.functions as func
from azure.identity import DefaultAzureCredential
from azure.mgmt.compute import ComputeManagementClient
from azure.mgmt.web import WebSiteManagementClient
import json
import logging

def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info('Alert handler triggered')

    try:
        alert_data = req.get_json()
        alert_type = alert_data.get('data', {}).get('essentials', {}).get('alertRule')
        affected_resource = alert_data.get('data', {}).get('essentials', {}).get('alertTargetIDs', [])[0]

        logging.info(f"Alert: {alert_type}, Resource: {affected_resource}")

        credential = DefaultAzureCredential()

        if "High CPU" in alert_type:
            remediation_result = scale_out_app_service(credential, affected_resource)
        elif "Memory Pressure" in alert_type:
            remediation_result = restart_vm(credential, affected_resource)
        elif "Disk Space" in alert_type:
            remediation_result = clear_temp_files(credential, affected_resource)
        else:
            remediation_result = {"action": "none", "reason": "Unknown alert type"}

        return func.HttpResponse(
            json.dumps(remediation_result),
            mimetype="application/json"
        )

    except Exception as e:
        logging.error(f"Error: {str(e)}")
        return func.HttpResponse(str(e), status_code=500)

def scale_out_app_service(credential, resource_id):
    """Scale out App Service Plan."""
    parts = resource_id.split('/')
    subscription_id = parts[2]
    resource_group = parts[4]
    site_name = parts[8]

    client = WebSiteManagementClient(credential, subscription_id)

    # Get current site
    site = client.web_apps.get(resource_group, site_name)
    plan_parts = site.server_farm_id.split('/')
    plan_name = plan_parts[-1]

    # Get current plan
    plan = client.app_service_plans.get(resource_group, plan_name)

    # Scale out
    new_capacity = min(plan.sku.capacity + 1, 10)
    plan.sku.capacity = new_capacity

    client.app_service_plans.begin_create_or_update(
        resource_group,
        plan_name,
        plan
    ).result()

    return {
        "action": "scale_out",
        "resource": plan_name,
        "new_capacity": new_capacity
    }

def restart_vm(credential, resource_id):
    """Restart a virtual machine."""
    parts = resource_id.split('/')
    subscription_id = parts[2]
    resource_group = parts[4]
    vm_name = parts[8]

    client = ComputeManagementClient(credential, subscription_id)
    client.virtual_machines.begin_restart(resource_group, vm_name).result()

    return {
        "action": "restart_vm",
        "resource": vm_name
    }
```

## Alert Management Dashboard

Create a workbook for alert visibility:

```json
{
    "version": "Notebook/1.0",
    "items": [
        {
            "type": 1,
            "content": {
                "json": "# Alert Management Dashboard"
            }
        },
        {
            "type": 3,
            "content": {
                "version": "KqlItem/1.0",
                "query": "AlertsManagementResources\n| where type == 'microsoft.alertsmanagement/alerts'\n| where properties.essentials.startDateTime > ago(24h)\n| summarize Count = count() by Severity = tostring(properties.essentials.severity)\n| order by Severity",
                "size": 0,
                "title": "Alerts by Severity (24h)",
                "queryType": 1,
                "resourceType": "microsoft.resourcegraph/resources",
                "visualization": "piechart"
            }
        },
        {
            "type": 3,
            "content": {
                "version": "KqlItem/1.0",
                "query": "AlertsManagementResources\n| where type == 'microsoft.alertsmanagement/alerts'\n| where properties.essentials.alertState == 'New'\n| project \n    Name = name,\n    Severity = properties.essentials.severity,\n    Resource = properties.essentials.targetResourceName,\n    Time = properties.essentials.startDateTime\n| order by Time desc",
                "size": 0,
                "title": "Active Alerts",
                "queryType": 1,
                "resourceType": "microsoft.resourcegraph/resources",
                "visualization": "table"
            }
        }
    ]
}
```

## Best Practices

1. **Start with critical alerts** - Don't alert on everything
2. **Use appropriate thresholds** - Avoid alert fatigue
3. **Configure action groups thoughtfully** - Right people, right channel
4. **Implement auto-remediation** where possible
5. **Review and tune alerts** regularly
6. **Use dynamic thresholds** for adaptive alerting

## Conclusion

Azure Monitor Alerts are essential for proactive system management. By combining metric, log, and activity log alerts with appropriate action groups and auto-remediation, you can maintain system health and minimize downtime.

Start with essential alerts for your most critical resources and expand coverage as you understand your system's behavior patterns.

