---
title: "Azure Monitor Alerts and Action Groups"
description: "Alerts should be actionable. If you can't do anything about it, it's noise."
author: Michael John Peña
draft: false
date: 2020-09-15
tags:
  - Azure
  - Monitoring
  - Alerts
  - DevOps
---

## Alert Types

1. **Metric Alerts**: CPU > 80% for 5 minutes
2. **Log Alerts**: Error count > 100 in last hour
3. **Activity Log Alerts**: VM stopped, deployment failed
4. **Smart Alerts**: AI-detected anomalies

## Creating a Metric Alert

```bash
az monitor metrics alert create \
    --name "High CPU Alert" \
    --resource-group myResourceGroup \
    --scopes /subscriptions/.../Microsoft.Compute/virtualMachines/myVM \
    --condition "avg Percentage CPU > 80" \
    --window-size 5m \
    --evaluation-frequency 1m \
    --action /subscriptions/.../actionGroups/myActionGroup
```

## Log Alert with KQL

```bash
az monitor scheduled-query create \
    --name "Error Rate Alert" \
    --resource-group myResourceGroup \
    --scopes /subscriptions/.../Microsoft.OperationalInsights/workspaces/myWorkspace \
    --condition "count 'requests | where resultCode >= 500' > 100" \
    --condition-query "requests | where resultCode >= 500 | summarize count()" \
    --window-size 60 \
    --evaluation-frequency 5 \
    --action /subscriptions/.../actionGroups/myActionGroup
```

## Action Groups

```json
{
  "emailReceivers": [
    {"name": "oncall", "emailAddress": "oncall@company.com"}
  ],
  "smsReceivers": [
    {"name": "emergency", "countryCode": "61", "phoneNumber": "400000000"}
  ],
  "webhookReceivers": [
    {"name": "pagerduty", "serviceUri": "https://events.pagerduty.com/..."}
  ],
  "azureFunctionReceivers": [
    {
      "name": "auto-remediate",
      "functionAppResourceId": "/subscriptions/.../sites/myfunction",
      "functionName": "HandleAlert"
    }
  ]
}
```

## Best Practices

1. **Start with severity levels** (Sev 0-4)
2. **Route to appropriate teams** based on severity
3. **Include runbook links** in alert description
4. **Suppress during maintenance windows**
5. **Auto-remediate when possible**

Alerts should be actionable. If you can't do anything about it, it's noise.
