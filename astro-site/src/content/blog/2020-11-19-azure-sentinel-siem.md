---
title: "Azure Sentinel: Cloud-Native SIEM"
description: "SIEM used to mean a rack of appliances, a forwarder per data source, and a six-figure annual licence. Sentinel rewrites that economics. It's a SIEM that…"
author: Michael John Peña
draft: false
date: 2020-11-19
tags:
  - Azure
  - Security
  - Sentinel
  - SIEM
---

SIEM used to mean a rack of appliances, a forwarder per data source, and a six-figure annual licence. Sentinel rewrites that economics. It's a SIEM that lives natively in Azure, ingests from connectors instead of agents, queries with KQL, and bolts on UEBA and SOAR. The pricing still surprises people (per-GB ingestion adds up fast), but the speed from "I need to investigate this" to "I have a workbook" is unrecognisable from the on-prem world.

## Architecture

```
Data Sources → Log Analytics → Sentinel → Alerts/Incidents
                                  │
                                  ├── Analytics Rules
                                  ├── Workbooks
                                  ├── Hunting Queries
                                  └── Playbooks (Logic Apps)
```

## Enabling Sentinel

```bash
# Create Log Analytics workspace
az monitor log-analytics workspace create \
    --resource-group myRG \
    --workspace-name sentinel-workspace \
    --location eastus

# Enable Sentinel
az sentinel workspace create \
    --resource-group myRG \
    --workspace-name sentinel-workspace
```

## Data Connectors

### Azure AD

```bash
az sentinel data-connector create \
    --resource-group myRG \
    --workspace-name sentinel-workspace \
    --name AzureActiveDirectory \
    --data-types SignInLogs AuditLogs
```

### Microsoft 365

```json
{
    "kind": "Office365",
    "properties": {
        "tenantId": "{tenant-id}",
        "dataTypes": {
            "exchange": {"state": "Enabled"},
            "sharePoint": {"state": "Enabled"},
            "teams": {"state": "Enabled"}
        }
    }
}
```

### Syslog (Linux)

```bash
# Install Log Analytics agent
wget https://raw.githubusercontent.com/Microsoft/OMS-Agent-for-Linux/master/installer/scripts/onboard_agent.sh
sh onboard_agent.sh -w <workspace-id> -s <key> -d opinsights.azure.com
```

## Analytics Rules

### Scheduled Query Rule

```json
{
    "kind": "Scheduled",
    "displayName": "Multiple Failed Logins",
    "description": "Detects multiple failed login attempts",
    "severity": "Medium",
    "enabled": true,
    "query": "SigninLogs | where ResultType != 0 | summarize FailedAttempts = count() by UserPrincipalName, bin(TimeGenerated, 1h) | where FailedAttempts > 10",
    "queryFrequency": "PT1H",
    "queryPeriod": "PT1H",
    "triggerOperator": "GreaterThan",
    "triggerThreshold": 0,
    "tactics": ["CredentialAccess"],
    "incidentConfiguration": {
        "createIncident": true,
        "groupingConfiguration": {
            "enabled": true,
            "lookbackDuration": "PT5H",
            "matchingMethod": "AllEntities"
        }
    }
}
```

### KQL Detection Queries

```kusto
// Brute force detection
SigninLogs
| where TimeGenerated > ago(1h)
| where ResultType == 50126  // Invalid username or password
| summarize FailedAttempts = count(), TargetAccounts = dcount(UserPrincipalName)
    by IPAddress, bin(TimeGenerated, 5m)
| where FailedAttempts > 20 or TargetAccounts > 5
| project TimeGenerated, IPAddress, FailedAttempts, TargetAccounts

// Impossible travel
let threshold = 500;  // km/hr
SigninLogs
| where TimeGenerated > ago(1d)
| project UserPrincipalName, Location, Latitude = todouble(LocationDetails.geoCoordinates.latitude),
    Longitude = todouble(LocationDetails.geoCoordinates.longitude), TimeGenerated
| order by UserPrincipalName, TimeGenerated
| serialize
| extend PrevLocation = prev(Location), PrevLat = prev(Latitude), PrevLon = prev(Longitude),
    PrevTime = prev(TimeGenerated), PrevUser = prev(UserPrincipalName)
| where UserPrincipalName == PrevUser
| extend Distance = geo_distance_2points(Longitude, Latitude, PrevLon, PrevLat) / 1000
| extend TimeDiff = datetime_diff('hour', TimeGenerated, PrevTime)
| extend Speed = Distance / TimeDiff
| where Speed > threshold
```

## Playbooks (Automated Response)

```json
{
    "definition": {
        "triggers": {
            "Microsoft_Sentinel_incident": {
                "type": "ApiConnectionWebhook",
                "inputs": {
                    "host": {
                        "connection": { "name": "@parameters('$connections')['azuresentinel']['connectionId']" }
                    },
                    "body": { "callback_url": "@{listCallbackUrl()}" },
                    "path": "/incident-creation"
                }
            }
        },
        "actions": {
            "Block_IP_in_Firewall": {
                "type": "ApiConnection",
                "inputs": { }
            },
            "Send_Teams_Alert": {
                "type": "ApiConnection",
                "inputs": { }
            },
            "Add_comment_to_incident": {
                "type": "ApiConnection",
                "inputs": { }
            }
        }
    }
}
```

## Hunting Queries

```kusto
// Hunt for suspicious PowerShell
SecurityEvent
| where EventID == 4688
| where Process has "powershell.exe"
| where CommandLine has_any ("-enc", "-e ", "bypass", "hidden", "downloadstring")
| project TimeGenerated, Computer, Account, CommandLine
```

Sentinel: AI-powered security operations at cloud scale.
