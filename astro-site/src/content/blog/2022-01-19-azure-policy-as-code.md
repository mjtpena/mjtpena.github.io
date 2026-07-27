---
title: "Azure Policy as Code: Governance at Scale"
author: Michael John Peña
draft: false
date: 2022-01-19
url: /blog/azure-policy-as-code/
tags:
  - azure
  - governance
  - policy
  - compliance

---

I wrote "Azure Policy as Code: Governance at Scale" to share practical, production-minded guidance on this topic.

## Policy Structure

A policy definition consists of rules that evaluate resources:

```json
{
  "properties": {
    "displayName": "Require HTTPS for Storage Accounts",
    "description": "Ensures storage accounts only accept HTTPS traffic",
    "mode": "Indexed",
    "metadata": {
      "category": "Storage",
      "version": "1.0.0"
    },
    "parameters": {},
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
    }
  }
}
```

## Deploying Policies with Bicep

```bicep
// policies/require-https-storage.bicep
targetScope = 'subscription'

resource policyDefinition 'Microsoft.Authorization/policyDefinitions@2021-06-01' = {
  name: 'require-https-storage'
  properties: {
    displayName: 'Require HTTPS for Storage Accounts'
    description: 'Storage accounts must only accept HTTPS traffic'
    policyType: 'Custom'
    mode: 'Indexed'
    metadata: {
      category: 'Storage'
      version: '1.0.0'
    }
    parameters: {}
    policyRule: {
      if: {
        allOf: [
          {
            field: 'type'
            equals: 'Microsoft.Storage/storageAccounts'
          }
          {
            field: 'Microsoft.Storage/storageAccounts/supportsHttpsTrafficOnly'
            notEquals: true
          }
        ]
      }
      then: {
        effect: 'deny'
      }
    }
  }
}

resource policyAssignment 'Microsoft.Authorization/policyAssignments@2021-06-01' = {
  name: 'require-https-storage-assignment'
  properties: {
    displayName: 'Require HTTPS for Storage'
    policyDefinitionId: policyDefinition.id
    enforcementMode: 'Default'
  }
}
```

## Policy Initiatives (Policy Sets)

Group related policies together:

```bicep
// policies/security-initiative.bicep
targetScope = 'subscription'

resource initiative 'Microsoft.Authorization/policySetDefinitions@2021-06-01' = {
  name: 'security-baseline'
  properties: {
    displayName: 'Security Baseline'
    description: 'Core security policies for all resources'
    policyType: 'Custom'
    metadata: {
      category: 'Security'
      version: '1.0.0'
    }
    parameters: {
      allowedLocations: {
        type: 'Array'
        metadata: {
          displayName: 'Allowed Locations'
          description: 'The list of allowed locations for resources'
        }
        defaultValue: [
          'australiaeast'
          'australiasoutheast'
        ]
      }
    }
    policyDefinitions: [
      {
        policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/e765b5de-1225-4ba3-bd56-1ac6695af988'  // Built-in: Allowed locations
        parameters: {
          listOfAllowedLocations: {
            value: '[parameters(\'allowedLocations\')]'
          }
        }
      }
      {
        policyDefinitionReferenceId: 'requireHttpsStorage'
        policyDefinitionId: policyDefinition.id
      }
      {
        policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/404c3081-a854-4457-ae30-26a93ef643f9'  // Built-in: Secure transfer for storage
      }
    ]
  }
}
```

## Custom Policy for Tags

```json
{
  "properties": {
    "displayName": "Require specific tags on resources",
    "mode": "Indexed",
    "parameters": {
      "requiredTags": {
        "type": "Array",
        "metadata": {
          "displayName": "Required Tags",
          "description": "List of required tag names"
        },
        "defaultValue": ["environment", "costCenter", "owner"]
      }
    },
    "policyRule": {
      "if": {
        "anyOf": [
          {
            "count": {
              "value": "[parameters('requiredTags')]",
              "name": "tagName",
              "where": {
                "field": "[concat('tags[', current('tagName'), ']')]",
                "exists": false
              }
            },
            "greater": 0
          }
        ]
      },
      "then": {
        "effect": "deny"
      }
    }
  }
}
```

## Testing Policies

```powershell
# Test policy compliance
$testCases = @(
    @{
        Name = 'Compliant Storage Account'
        Resource = @{
            type = 'Microsoft.Storage/storageAccounts'
            properties = @{
                supportsHttpsTrafficOnly = $true
            }
        }
        Expected = 'Compliant'
    }
    @{
        Name = 'Non-Compliant Storage Account'
        Resource = @{
            type = 'Microsoft.Storage/storageAccounts'
            properties = @{
                supportsHttpsTrafficOnly = $false
            }
        }
        Expected = 'NonCompliant'
    }
)

foreach ($test in $testCases) {
    $result = Test-AzPolicyEvaluation `
        -PolicyDefinition $policyDefinition `
        -Resource $test.Resource

    if ($result.ComplianceState -eq $test.Expected) {
        Write-Host "PASS: $($test.Name)" -ForegroundColor Green
    } else {
        Write-Host "FAIL: $($test.Name)" -ForegroundColor Red
    }
}
```

## CI/CD for Policy Deployment

```yaml
# .github/workflows/policy-deployment.yml
name: Deploy Policies

on:
  push:
    branches: [main]
    paths:
      - 'policies/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Deploy Policy Definitions
        run: |
          for policy in policies/definitions/*.json; do
            name=$(basename "$policy" .json)
            az policy definition create \
              --name "$name" \
              --rules "$policy" \
              --subscription ${{ secrets.SUBSCRIPTION_ID }}
          done

      - name: Deploy Policy Assignments
        run: |
          az deployment sub create \
            --location australiaeast \
            --template-file policies/assignments.bicep
```

Azure Policy as Code ensures consistent, auditable governance across your entire Azure estate.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
