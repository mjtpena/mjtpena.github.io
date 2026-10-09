---
title: "Azure Blueprints Deprecation: Migration Strategies"
description: "The move away from Blueprints leads to more flexible, testable, and maintainable infrastructure governance."
author: Michael John Peña
draft: false
date: 2022-01-20
url: /blog/azure-blueprints-deprecation/
tags:
  - Azure
  - Governance
  - Blueprints
  - landing-zones
---

## Why Blueprints Are Being Deprecated

Azure Blueprints had limitations:
- Complex versioning model
- Limited integration with CI/CD
- Difficult to test
- Overlapping functionality with other services

## Migration Path Overview

| Blueprint Feature | Modern Alternative |
|------------------|-------------------|
| ARM Templates | Template Specs / Bicep |
| Policy Assignments | Azure Policy as Code |
| Role Assignments | Bicep RBAC assignments |
| Resource Groups | Subscription-level Bicep |
| Locking | Deployment Stacks |

## Exporting Blueprint Definitions

```powershell
# Export existing Blueprint
$blueprint = Get-AzBlueprint -ManagementGroupId "myMG" -Name "security-baseline"

# Export artifacts
$artifacts = Get-AzBlueprintArtifact -Blueprint $blueprint

# Convert to Bicep structure
$blueprintExport = @{
    Name = $blueprint.Name
    Parameters = $blueprint.Parameters
    ResourceGroups = $blueprint.ResourceGroups
    Artifacts = @()
}

foreach ($artifact in $artifacts) {
    $blueprintExport.Artifacts += @{
        Name = $artifact.Name
        Type = $artifact.Type
        Properties = $artifact.Properties
    }
}

$blueprintExport | ConvertTo-Json -Depth 10 | Out-File "blueprint-export.json"
```

## Converting to Template Specs

```bicep
// template-specs/security-baseline.bicep
targetScope = 'subscription'

param location string = 'australiaeast'
param environment string

// Resource Group (was Blueprint resource group)
resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: 'rg-security-${environment}'
  location: location
  tags: {
    environment: environment
  }
}

// Policy Assignment (was Blueprint artifact)
module policies 'modules/policy-assignments.bicep' = {
  name: 'policy-deployment'
  params: {
    environment: environment
  }
}

// Role Assignments (was Blueprint artifact)
module rbac 'modules/rbac-assignments.bicep' = {
  name: 'rbac-deployment'
  scope: rg
  params: {
    principalId: securityGroupId
  }
}

// Infrastructure (was Blueprint ARM artifact)
module infrastructure 'modules/infrastructure.bicep' = {
  name: 'infra-deployment'
  scope: rg
  params: {
    location: location
    environment: environment
  }
}
```

Create the Template Spec:

```bash
az ts create \
  --name security-baseline \
  --version 1.0.0 \
  --resource-group rg-template-specs \
  --location australiaeast \
  --template-file security-baseline.bicep
```

## Using Deployment Stacks

Deployment Stacks provide Blueprint-like locking and lifecycle management:

```bicep
// deployment-stack.bicep
targetScope = 'subscription'

param stackName string = 'landing-zone-stack'

resource deploymentStack 'Microsoft.Resources/deploymentStacks@2022-08-01-preview' = {
  name: stackName
  location: 'australiaeast'
  properties: {
    description: 'Landing zone deployment stack'
    denySettings: {
      mode: 'DenyDelete'  // Prevent deletion of managed resources
      excludedPrincipals: [
        'principalId-of-admin'
      ]
    }
    template: {
      // Inline template or reference
    }
  }
}
```

Create via CLI:

```bash
# Create deployment stack at subscription level
az stack sub create \
  --name landing-zone-stack \
  --location australiaeast \
  --template-file landing-zone.bicep \
  --deny-settings-mode DenyDelete \
  --deny-settings-excluded-principals "admin-group-id"
```

## Recreating Blueprint Locking

```bicep
// locking.bicep
param lockLevel string = 'CanNotDelete'  // or 'ReadOnly'

resource lock 'Microsoft.Authorization/locks@2020-05-01' = {
  name: 'blueprint-migration-lock'
  properties: {
    level: lockLevel
    notes: 'Migrated from Azure Blueprints'
  }
}
```

## CI/CD for Landing Zone Deployment

```yaml
# .github/workflows/landing-zone.yml
name: Deploy Landing Zone

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment'
        required: true
        type: choice
        options:
          - dev
          - staging
          - prod

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - uses: actions/checkout@v3

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Deploy Template Spec
        run: |
          # Deploy using Template Spec (like Blueprint assignment)
          az deployment sub create \
            --location australiaeast \
            --template-spec "/subscriptions/${{ secrets.SUBSCRIPTION_ID }}/resourceGroups/rg-template-specs/providers/Microsoft.Resources/templateSpecs/security-baseline/versions/1.0.0" \
            --parameters environment=${{ inputs.environment }}

      - name: Apply Locks
        run: |
          az lock create \
            --name managed-resources-lock \
            --resource-group rg-security-${{ inputs.environment }} \
            --lock-type CanNotDelete
```

## Migration Checklist

1. Export existing Blueprint definitions
2. Convert ARM artifacts to Bicep
3. Create Template Specs for reusable infrastructure
4. Convert policy artifacts to Azure Policy as Code
5. Implement RBAC via Bicep
6. Use Deployment Stacks for locking (when GA)
7. Update CI/CD pipelines
8. Delete old Blueprint assignments
9. Delete Blueprint definitions

The move away from Blueprints leads to more flexible, testable, and maintainable infrastructure governance.
