---
title: "Azure Defender: Cloud Security Posture Management"
description: "Azure Defender: security visibility across your entire estate."
author: Michael John Peña
draft: false
date: 2020-11-08
tags:
  - Azure
  - Security
  - Azure Defender
  - Security Center
---

## Secure Score

Track security posture:

```
Secure Score: 76%

Recommendations:
├── High Impact
│   ├── Enable MFA (10 points)
│   ├── Apply system updates (8 points)
│   └── Enable encryption (6 points)
├── Medium Impact
│   ├── Restrict network access (4 points)
│   └── Enable diagnostic logs (3 points)
└── Low Impact
    └── Configure backup (2 points)
```

## Enable Defender Plans

```bash
# Enable Defender for Servers
az security pricing create \
    --name VirtualMachines \
    --tier Standard

# Enable Defender for SQL
az security pricing create \
    --name SqlServers \
    --tier Standard

# Enable Defender for Storage
az security pricing create \
    --name StorageAccounts \
    --tier Standard
```

## Security Recommendations

```bash
# List security recommendations
az security task list \
    --query "[].{Name:name, State:state, RecommendationType:recommendationType}" \
    --output table
```

## Just-In-Time VM Access

```bash
# Enable JIT access
az security jit-policy create \
    --resource-group myRG \
    --name myVM-jit \
    --vm-id /subscriptions/.../virtualMachines/myVM \
    --ports '[{
        "number": 22,
        "protocol": "TCP",
        "allowedSourceAddressPrefix": ["*"],
        "maxRequestAccessDuration": "PT3H"
    }]'

# Request JIT access
az security jit-policy request \
    --resource-group myRG \
    --name myVM-jit \
    --virtual-machines '[{
        "id": "/subscriptions/.../virtualMachines/myVM",
        "ports": [{"number": 22, "duration": "PT1H"}]
    }]'
```

## Adaptive Application Controls

```bash
# Review application control recommendations
az security adaptive-application-controls list \
    --query "[].{Group:name, Status:protectionMode}"
```

## Threat Protection Alerts

```bash
# List security alerts
az security alert list \
    --query "[?status=='Active'].{Name:alertDisplayName, Severity:severity, Status:status}" \
    --output table
```

Alert types:
- Brute force attacks
- Suspicious process execution
- Anomalous data access
- Malware detection
- Privilege escalation

## Regulatory Compliance

Built-in standards:
- Azure Security Benchmark
- CIS Benchmarks
- PCI DSS 3.2.1
- ISO 27001
- SOC 2

```bash
# Get compliance status
az security regulatory-compliance-standards list \
    --query "[].{Standard:name, PassedControls:passedControls, FailedControls:failedControls}"
```

## Workflow Automation

```json
{
    "name": "AlertToTeams",
    "type": "Microsoft.Security/automations",
    "properties": {
        "scopes": ["/subscriptions/{sub-id}"],
        "sources": [{
            "eventSource": "Alerts",
            "ruleSets": [{
                "rules": [{
                    "propertyJPath": "Severity",
                    "propertyType": "String",
                    "expectedValue": "High",
                    "operator": "Equals"
                }]
            }]
        }],
        "actions": [{
            "actionType": "LogicApp",
            "logicAppResourceId": "/subscriptions/.../Microsoft.Logic/workflows/AlertTeams"
        }]
    }
}
```

## Multi-Cloud Support

Connect AWS and GCP:

```bash
# Add AWS connector
az security connector create \
    --name aws-connector \
    --environment-name AWS \
    --offerings DefenderForServers
```

Azure Defender: security visibility across your entire estate.
