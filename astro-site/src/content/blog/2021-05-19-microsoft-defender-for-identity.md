---
title: "Microsoft Defender for Identity: Protecting Your Active Directory"
author: Michael John Peña
draft: false
date: 2021-05-19
tags:
  - Azure
  - Security
  - Identity
  - Active Directory
  - Defender
---

## What Defender for Identity Detects

The service identifies:
- **Reconnaissance**: Attackers gathering information about your environment
- **Compromised credentials**: Pass-the-hash, pass-the-ticket, brute force
- **Lateral movement**: Attackers moving through your network
- **Domain dominance**: Attacks aimed at full domain control

## Architecture Overview

```
On-Premises                          Cloud
+------------------+                 +------------------+
| Domain           |                 | Microsoft 365    |
| Controllers      |                 | Defender Portal  |
|                  |                 |                  |
| +-------------+  |   HTTPS/443     | +-------------+  |
| | Defender    |--|---------------->| | Defender    |  |
| | Sensor      |  |                 | | for Identity|  |
| +-------------+  |                 | | Service     |  |
+------------------+                 +------------------+
```

## Deployment

### Create Defender for Identity Instance

```powershell
# Connect to Microsoft 365 Defender
Connect-MsolService

# Verify licensing
Get-MsolAccountSku | Where-Object {$_.AccountSkuId -like "*ATP*" -or $_.AccountSkuId -like "*E5*"}
```

### Install Sensor on Domain Controllers

```powershell
# Download sensor installer from portal
# Run installation
$InstallerPath = "C:\Temp\AzureATPSensor.exe"
$AccessKey = "your-workspace-access-key"

Start-Process -FilePath $InstallerPath -ArgumentList "/quiet", "AccessKey=$AccessKey" -Wait

# Verify sensor service
Get-Service "Azure Advanced Threat Protection Sensor"
```

### Configure Sensor via PowerShell

```powershell
# Get sensor configuration
$SensorConfig = @{
    DomainController = "dc01.contoso.com"
    AccessKey = "workspace-access-key"
    ProxyUrl = "http://proxy.contoso.com:8080"  # If needed
}

# Install with configuration
& "C:\Temp\AzureATPSensor.exe" /quiet `
    AccessKey=$($SensorConfig.AccessKey) `
    ProxyUrl=$($SensorConfig.ProxyUrl)
```

## Configuring Entity Tags

Tag sensitive accounts for enhanced monitoring:

```python
import requests

# Microsoft Graph API for Defender for Identity
base_url = "https://graph.microsoft.com/beta/security"
headers = {
    "Authorization": f"Bearer {access_token}",
    "Content-Type": "application/json"
}

# Tag a sensitive user
sensitive_user = {
    "displayName": "Admin Account",
    "upn": "admin@contoso.com",
    "tags": ["Sensitive", "Honeypot"]
}

response = requests.patch(
    f"{base_url}/identities/{user_id}",
    headers=headers,
    json={"tags": sensitive_user["tags"]}
)
```

## Detection Tuning

Reduce false positives by configuring exclusions:

```json
{
  "exclusions": {
    "sensitiveAccounts": {
      "description": "Service accounts that perform expected suspicious activities",
      "accounts": [
        {
          "samAccountName": "svc_backup",
          "excludeFrom": ["PassTheHash", "BruteForce"]
        },
        {
          "samAccountName": "svc_monitoring",
          "excludeFrom": ["LdapEnumeration"]
        }
      ]
    },
    "ipAddresses": {
      "description": "Known scanner IP addresses",
      "addresses": ["10.0.1.50", "10.0.1.51"],
      "excludeFrom": ["Reconnaissance"]
    }
  }
}
```

## Alert Handling

### Query Alerts via API

```python
import requests
from datetime import datetime, timedelta

def get_defender_alerts(hours_back=24):
    """Retrieve recent Defender for Identity alerts"""
    url = "https://graph.microsoft.com/beta/security/alerts"

    filter_time = (datetime.utcnow() - timedelta(hours=hours_back)).isoformat() + "Z"

    params = {
        "$filter": f"vendorInformation/provider eq 'Azure Advanced Threat Protection' and createdDateTime gt {filter_time}",
        "$orderby": "createdDateTime desc",
        "$top": 100
    }

    response = requests.get(url, headers=headers, params=params)
    return response.json().get("value", [])

# Process alerts
alerts = get_defender_alerts()

for alert in alerts:
    print(f"Alert: {alert['title']}")
    print(f"Severity: {alert['severity']}")
    print(f"Category: {alert['category']}")
    print(f"Description: {alert['description']}")
    print(f"User: {alert.get('userStates', [{}])[0].get('userPrincipalName', 'N/A')}")
    print("---")
```

### Automated Response

```python
def respond_to_alert(alert):
    """Automated response based on alert type"""
    alert_type = alert.get("title", "")
    severity = alert.get("severity", "")

    responses = {
        "Suspected Brute Force attack (LDAP)": {
            "action": "disable_account",
            "severity_threshold": "high"
        },
        "Suspected identity theft (Pass-the-Hash)": {
            "action": "isolate_machine",
            "severity_threshold": "high"
        },
        "Reconnaissance using LDAP queries": {
            "action": "log_and_notify",
            "severity_threshold": "medium"
        }
    }

    response_config = responses.get(alert_type)

    if response_config and severity.lower() >= response_config["severity_threshold"]:
        if response_config["action"] == "disable_account":
            disable_user_account(alert)
        elif response_config["action"] == "isolate_machine":
            isolate_machine(alert)
        elif response_config["action"] == "log_and_notify":
            send_notification(alert)

def disable_user_account(alert):
    """Disable compromised user account"""
    user_states = alert.get("userStates", [])
    for user in user_states:
        upn = user.get("userPrincipalName")
        if upn:
            # Disable via Graph API
            requests.patch(
                f"https://graph.microsoft.com/v1.0/users/{upn}",
                headers=headers,
                json={"accountEnabled": False}
            )
            print(f"Disabled account: {upn}")
```

## Integration with SIEM

Export alerts to your SIEM:

```python
from azure.eventhub import EventHubProducerClient
import json

def export_to_eventhub(alert):
    """Export alert to Event Hub for SIEM ingestion"""
    producer = EventHubProducerClient.from_connection_string(
        conn_str="Endpoint=sb://...",
        eventhub_name="security-alerts"
    )

    event_data = json.dumps({
        "source": "DefenderForIdentity",
        "timestamp": alert.get("createdDateTime"),
        "alertId": alert.get("id"),
        "title": alert.get("title"),
        "severity": alert.get("severity"),
        "category": alert.get("category"),
        "description": alert.get("description"),
        "affectedUsers": [u.get("userPrincipalName") for u in alert.get("userStates", [])],
        "affectedHosts": [h.get("hostName") for h in alert.get("hostStates", [])]
    })

    with producer:
        batch = producer.create_batch()
        batch.add(event_data)
        producer.send_batch(batch)
```

## Hunting Queries

Use Advanced Hunting to investigate:

```kusto
// Find potential pass-the-hash activity
IdentityLogonEvents
| where Timestamp > ago(7d)
| where LogonType == "Interactive"
| where Protocol == "NTLM"
| summarize
    LogonCount = count(),
    UniqueDevices = dcount(DeviceName),
    Devices = make_set(DeviceName)
    by AccountName, AccountDomain
| where UniqueDevices > 3
| order by UniqueDevices desc

// Detect LDAP reconnaissance
IdentityQueryEvents
| where Timestamp > ago(1d)
| where QueryType == "Ldap"
| where QueryTarget contains "CN=Users" or QueryTarget contains "CN=Computers"
| summarize
    QueryCount = count(),
    UniqueQueries = dcount(QueryTarget)
    by AccountName, DeviceName
| where QueryCount > 100

// Identify lateral movement patterns
IdentityLogonEvents
| where Timestamp > ago(7d)
| where LogonType in ("RemoteInteractive", "NetworkCleartext")
| summarize
    TargetDevices = make_set(DeviceName),
    TargetCount = dcount(DeviceName)
    by AccountName
| where TargetCount > 5
| order by TargetCount desc
```

## Health Monitoring

Monitor sensor health:

```python
def check_sensor_health():
    """Check health of Defender for Identity sensors"""
    url = "https://graph.microsoft.com/beta/security/tiIndicators"

    # Query sensor health metrics
    health_query = """
    IdentityInfo
    | where Timestamp > ago(1h)
    | summarize LastSeen = max(Timestamp) by SensorName
    | extend IsHealthy = LastSeen > ago(15m)
    """

    # Alert if sensor offline
    sensors = execute_query(health_query)
    for sensor in sensors:
        if not sensor["IsHealthy"]:
            send_alert(f"Sensor {sensor['SensorName']} appears offline")
```

## Resources

- [Defender for Identity Documentation](https://docs.microsoft.com/en-us/defender-for-identity/)
- [Deployment Guide](https://docs.microsoft.com/en-us/defender-for-identity/install-step1)
- [Alert Reference](https://docs.microsoft.com/en-us/defender-for-identity/alerts-overview)
