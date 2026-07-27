---
title: "Azure Policy: Governance at Scale"
author: Michael John Peña
draft: false
date: 2020-10-03
tags:
  - Azure
  - Governance
  - Policy
  - Compliance
---

Every Azure environment I've inherited from someone else has the same three problems: storage accounts created without encryption-at-rest configuration, resources deployed in unexpected regions, and tags missing or inconsistent. Azure Policy is how you stop those problems from re-occurring — assign policies at the management group level, audit first to understand the blast radius, then move to deny once your team has cleaned up what's already there.

## Built-in Policies

```bash
# List built-in policies
az policy definition list --query "[?policyType=='BuiltIn'].{Name:displayName, Category:metadata.category}" -o table
```

Common policies:
- Allowed locations
- Allowed VM SKUs
- Require tags
- Enforce encryption

## Custom Policy

```json
{
  "mode": "All",
  "policyRule": {
    "if": {
      "allOf": [
        {
          "field": "type",
          "equals": "Microsoft.Storage/storageAccounts"
        },
        {
          "field": "Microsoft.Storage/storageAccounts/supportsHttpsTrafficOnly",
          "notEquals": true
        }
      ]
    },
    "then": {
      "effect": "deny"
    }
  },
  "parameters": {}
}
```

## Effects

| Effect | Description |
|--------|-------------|
| Deny | Block non-compliant creation/update |
| Audit | Log non-compliance |
| Append | Add fields (e.g., tags) |
| DeployIfNotExists | Deploy missing resources |
| Modify | Change resource properties |
| Disabled | Policy not enforced |

## Policy Initiatives

Group related policies:

```bash
# Create initiative from multiple policies
az policy set-definition create \
    --name "SecurityBaseline" \
    --definitions '[
        {"policyDefinitionId": "/providers/Microsoft.Authorization/policyDefinitions/..."},
        {"policyDefinitionId": "/providers/Microsoft.Authorization/policyDefinitions/..."}
    ]'
```

## Assignment

```bash
# Assign to subscription
az policy assignment create \
    --name "enforce-tags" \
    --policy "/providers/Microsoft.Authorization/policyDefinitions/require-tag" \
    --params '{"tagName": {"value": "CostCenter"}}' \
    --scope "/subscriptions/xxx"
```

## Compliance Dashboard

Azure Portal → Policy → Compliance shows:
- Overall compliance percentage
- Non-compliant resources
- Remediation tasks

Start with Audit effect, move to Deny once you understand impact.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
