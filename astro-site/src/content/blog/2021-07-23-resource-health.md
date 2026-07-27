---
title: Monitoring Azure Resource Health for Proactive Operations
author: Michael John Peña
draft: false
date: 2021-07-23
url: /blog/resource-health/
tags:
  - Azure
  - Monitoring
  - DevOps
  - Operations
  - High Availability

---

I wrote "2021-07-23-resource-health" to share practical, production-minded guidance on this topic.

# Understanding Resource Health States

Resource Health reports four possible states:

- **Available**: Resource is healthy and operating normally
- **Unavailable**: Resource is not healthy due to Azure or customer action
- **Degraded**: Resource has reduced performance but is still operational
- **Unknown**: Health signal not received (typically transient)

# Querying Resource Health

Access Resource Health using the Azure CLI:

```bash
# Get health status for a specific resource
az resource show \
    --ids /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-compute/providers/Microsoft.Compute/virtualMachines/vm-web-01 \
    --query "properties.instanceView.statuses"

# List all unhealthy resources using Resource Graph
az graph query -q "
    healthresources
    | where type == 'microsoft.resourcehealth/availabilitystatuses'
    | where properties.availabilityState != 'Available'
    | project resourceId=id, state=properties.availabilityState, reason=properties.reasonType, summary=properties.summary
"
```

# Python SDK for Resource Health

Monitor resource health programmatically:

```python
from azure.mgmt.resourcehealth import ResourceHealthMgmtClient
from azure.identity import DefaultAzureCredential
from datetime import datetime, timedelta

credential = DefaultAzureCredential()
health_client = ResourceHealthMgmtClient(credential, subscription_id)

def get_availability_status(resource_id):
    """Get current availability status for a resource."""

    status = health_client.availability_statuses.get_by_resource(resource_id)

    return {
        "resource_id": resource_id,
        "availability_state": status.properties.availability_state,
        "summary": status.properties.summary,
        "reason_type": status.properties.reason_type,
        "reason_chronicity": status.properties.reason_chronicity,
        "occurred_time": status.properties.occurred_time,
        "reported_time": status.properties.reported_time
    }

def list_all_availability_statuses():
    """List availability status for all resources in subscription."""

    statuses = health_client.availability_statuses.list_by_subscription_id()

    results = []
    for status in statuses:
        results.append({
            "resource_id": status.id.replace("/providers/Microsoft.ResourceHealth/availabilityStatuses/current", ""),
            "availability_state": status.properties.availability_state,
            "summary": status.properties.summary,
            "reason_type": status.properties.reason_type
        })

    return results

def get_unhealthy_resources():
    """Get all resources that are not in Available state."""

    all_statuses = list_all_availability_statuses()
    unhealthy = [s for s in all_statuses if s["availability_state"] != "Available"]

    print(f"Found {len(unhealthy)} unhealthy resources:")
    for resource in unhealthy:
        print(f"  {resource['resource_id']}")
        print(f"    State: {resource['availability_state']}")
        print(f"    Reason: {resource['reason_type']}")
        print(f"    Summary: {resource['summary']}")
        print()

    return unhealthy

# Check specific resources
vm_id = f"/subscriptions/{subscription_id}/resourceGroups/rg-compute/providers/Microsoft.Compute/virtualMachines/vm-web-01"
status = get_availability_status(vm_id)
print(f"VM Status: {status['availability_state']}")

# Get all unhealthy resources
unhealthy = get_unhealthy_resources()
```

# Historical Health Events

Query historical health events for root cause analysis:

```python
def get_health_history(resource_id, days=30):
    """Get historical health events for a resource."""

    # Use availability statuses history
    events = health_client.availability_statuses.list(resource_id)

    history = []
    for event in events:
        if event.properties.occurred_time:
            if event.properties.occurred_time > datetime.utcnow() - timedelta(days=days):
                history.append({
                    "occurred_time": event.properties.occurred_time,
                    "reported_time": event.properties.reported_time,
                    "state": event.properties.availability_state,
                    "summary": event.properties.summary,
                    "reason_type": event.properties.reason_type,
                    "root_cause_attribution_time": event.properties.root_cause_attribution_time
                })

    # Sort by occurred time
    history.sort(key=lambda x: x["occurred_time"], reverse=True)

    return history

def analyze_outage_pattern(resource_id, days=90):
    """Analyze outage patterns for a resource."""

    history = get_health_history(resource_id, days)

    # Calculate availability
    total_time = timedelta(days=days)
    unavailable_time = timedelta()

    for i, event in enumerate(history):
        if event["state"] == "Unavailable":
            # Find when it became available again
            end_time = datetime.utcnow()
            for j in range(i-1, -1, -1):
                if history[j]["state"] == "Available":
                    end_time = history[j]["occurred_time"]
                    break

            duration = end_time - event["occurred_time"]
            unavailable_time += duration

    availability_percentage = ((total_time - unavailable_time) / total_time) * 100

    print(f"\nAvailability Analysis for {days} days:")
    print(f"  Total Outages: {len([e for e in history if e['state'] == 'Unavailable'])}")
    print(f"  Total Downtime: {unavailable_time}")
    print(f"  Availability: {availability_percentage:.3f}%")

    # Group by reason
    reasons = {}
    for event in history:
        if event["state"] == "Unavailable":
            reason = event["reason_type"] or "Unknown"
            reasons[reason] = reasons.get(reason, 0) + 1

    print("\n  Outages by Reason:")
    for reason, count in sorted(reasons.items(), key=lambda x: x[1], reverse=True):
        print(f"    {reason}: {count}")

    return history

# Analyze SQL database availability
sql_id = f"/subscriptions/{subscription_id}/resourceGroups/rg-sql/providers/Microsoft.Sql/servers/sqlserver/databases/mydb"
analyze_outage_pattern(sql_id, days=90)
```

# Setting Up Resource Health Alerts

Create alerts for resource health changes:

```python
from azure.mgmt.monitor import MonitorManagementClient

monitor_client = MonitorManagementClient(credential, subscription_id)

def create_resource_health_alert(name, resource_type, severity=2):
    """Create an alert for resource health changes."""

    alert = monitor_client.activity_log_alerts.create_or_update(
        resource_group_name="rg-monitoring",
        activity_log_alert_name=name,
        activity_log_alert={
            "location": "global",
            "scopes": [f"/subscriptions/{subscription_id}"],
            "enabled": True,
            "condition": {
                "allOf": [
                    {
                        "field": "category",
                        "equals": "ResourceHealth"
                    },
                    {
                        "field": "resourceType",
                        "equals": resource_type
                    },
                    {
                        "anyOf": [
                            {
                                "field": "properties.currentHealthStatus",
                                "equals": "Unavailable"
                            },
                            {
                                "field": "properties.currentHealthStatus",
                                "equals": "Degraded"
                            }
                        ]
                    }
                ]
            },
            "actions": {
                "actionGroups": [{
                    "actionGroupId": f"/subscriptions/{subscription_id}/resourceGroups/rg-monitoring/providers/Microsoft.Insights/actionGroups/ops-team"
                }]
            },
            "description": f"Alert when {resource_type} becomes unhealthy"
        }
    )

    return alert

# Create alerts for critical resource types
resource_types = [
    ("vm-health-alert", "Microsoft.Compute/virtualMachines"),
    ("sql-health-alert", "Microsoft.Sql/servers/databases"),
    ("storage-health-alert", "Microsoft.Storage/storageAccounts"),
    ("appservice-health-alert", "Microsoft.Web/sites")
]

for name, resource_type in resource_types:
    create_resource_health_alert(name, resource_type)
    print(f"Created alert: {name}")
```

# Resource Health Dashboard

Query Resource Health using Resource Graph:

```python
from azure.mgmt.resourcegraph import ResourceGraphClient
from azure.mgmt.resourcegraph.models import QueryRequest

graph_client = ResourceGraphClient(credential)

def query_resource_health():
    """Query resource health across subscription using Resource Graph."""

    query = """
    healthresources
    | where type == 'microsoft.resourcehealth/availabilitystatuses'
    | extend resourceId = tolower(tostring(id))
    | extend availabilityState = tostring(properties.availabilityState)
    | extend reasonType = tostring(properties.reasonType)
    | extend summary = tostring(properties.summary)
    | project resourceId, availabilityState, reasonType, summary
    | order by availabilityState asc
    """

    request = QueryRequest(
        subscriptions=[subscription_id],
        query=query
    )

    response = graph_client.resources(request)

    return response.data

def get_health_summary():
    """Get summary of resource health across subscription."""

    query = """
    healthresources
    | where type == 'microsoft.resourcehealth/availabilitystatuses'
    | extend availabilityState = tostring(properties.availabilityState)
    | summarize count() by availabilityState
    """

    request = QueryRequest(
        subscriptions=[subscription_id],
        query=query
    )

    response = graph_client.resources(request)

    summary = {}
    for row in response.data:
        summary[row["availabilityState"]] = row["count_"]

    print("\nResource Health Summary:")
    print(f"  Available: {summary.get('Available', 0)}")
    print(f"  Unavailable: {summary.get('Unavailable', 0)}")
    print(f"  Degraded: {summary.get('Degraded', 0)}")
    print(f"  Unknown: {summary.get('Unknown', 0)}")

    return summary

def get_unhealthy_by_type():
    """Get count of unhealthy resources by type."""

    query = """
    healthresources
    | where type == 'microsoft.resourcehealth/availabilitystatuses'
    | extend availabilityState = tostring(properties.availabilityState)
    | where availabilityState != 'Available'
    | extend resourceType = tostring(split(id, '/providers/')[1])
    | extend resourceType = tostring(split(resourceType, '/providers/Microsoft.ResourceHealth')[0])
    | summarize count() by resourceType, availabilityState
    | order by count_ desc
    """

    request = QueryRequest(
        subscriptions=[subscription_id],
        query=query
    )

    response = graph_client.resources(request)

    print("\nUnhealthy Resources by Type:")
    for row in response.data:
        print(f"  {row['resourceType']}: {row['count_']} ({row['availabilityState']})")

    return response.data

# Get health overview
get_health_summary()
get_unhealthy_by_type()
```

# Integrating with Incident Management

Automate incident creation from Resource Health:

```python
def handle_resource_health_event(event):
    """Handle resource health event for incident management."""

    resource_id = event["resource_id"]
    current_state = event["current_health_status"]
    previous_state = event["previous_health_status"]
    summary = event["summary"]

    if current_state == "Unavailable" and previous_state == "Available":
        # Create incident
        incident = {
            "title": f"Resource Unavailable: {resource_id.split('/')[-1]}",
            "severity": "High" if "production" in resource_id.lower() else "Medium",
            "description": summary,
            "affected_resource": resource_id,
            "detected_time": datetime.utcnow().isoformat(),
            "category": "Availability"
        }

        # Send to incident management system
        create_incident(incident)

        # Notify on-call team
        send_pager_alert(incident)

    elif current_state == "Available" and previous_state == "Unavailable":
        # Resolve incident
        resolve_incident(resource_id)

        # Send recovery notification
        send_recovery_notification(resource_id, summary)

def create_incident(incident):
    """Create incident in your incident management system."""
    # Integration with ServiceNow, PagerDuty, etc.
    print(f"Creating incident: {incident['title']}")

def send_pager_alert(incident):
    """Send alert to on-call responder."""
    print(f"Paging on-call for: {incident['title']}")

def resolve_incident(resource_id):
    """Resolve existing incident."""
    print(f"Resolving incident for: {resource_id}")

def send_recovery_notification(resource_id, summary):
    """Send recovery notification."""
    print(f"Resource recovered: {resource_id}")
```

# Conclusion

Azure Resource Health provides critical visibility into the health of your individual resources. By monitoring health status changes, analyzing historical patterns, and setting up proactive alerts, you can quickly identify and respond to availability issues.

Combining Resource Health with Service Health gives you a complete picture of both platform-level issues and resource-specific problems. Use Resource Graph for efficient querying across large environments, and integrate with your incident management processes for streamlined operations.

