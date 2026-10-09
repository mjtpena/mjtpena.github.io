---
title: "Azure Blueprints: Repeatable Environment Templates"
description: "Blueprints ensure every environment starts from a known, compliant state."
author: Michael John Peña
draft: false
date: 2020-10-04
tags:
  - Azure
  - Blueprints
  - Governance
  - DevOps
---

## Blueprint Components

- **Role Assignments**: RBAC permissions
- **Policy Assignments**: Governance rules
- **ARM Templates**: Infrastructure definitions
- **Resource Groups**: Organizational structure

## Creating a Blueprint

```json
{
  "properties": {
    "displayName": "Data Platform Blueprint",
    "description": "Standard data platform environment",
    "targetScope": "subscription",
    "parameters": {
      "environment": {
        "type": "string",
        "allowedValues": ["dev", "test", "prod"]
      },
      "costCenter": {
        "type": "string"
      }
    },
    "resourceGroups": {
      "DataPlatform-RG": {
        "name": "[concat('data-platform-', parameters('environment'), '-rg')]",
        "location": "australiaeast"
      }
    }
  }
}
```

## Adding Artifacts

```powershell
# Add ARM template
New-AzBlueprintArtifact -Blueprint $blueprint -Name 'StorageAccount' -Type TemplateArtifact `
    -TemplateFile ./storage.json -ResourceGroupName 'DataPlatform-RG'

# Add policy assignment
New-AzBlueprintArtifact -Blueprint $blueprint -Name 'RequireTags' -Type PolicyAssignmentArtifact `
    -PolicyDefinitionId '/providers/Microsoft.Authorization/policyDefinitions/...'

# Add role assignment
New-AzBlueprintArtifact -Blueprint $blueprint -Name 'ContributorAccess' -Type RoleAssignmentArtifact `
    -RoleDefinitionId '/providers/Microsoft.Authorization/roleDefinitions/...' `
    -PrincipalIds @('group-object-id')
```

## Publishing and Assigning

```powershell
# Publish version
Publish-AzBlueprint -Blueprint $blueprint -Version '1.0'

# Assign to subscription
New-AzBlueprintAssignment -Blueprint $blueprint -Name 'DataPlatformDev' `
    -Location 'australiaeast' -SubscriptionId 'xxx' `
    -Parameter @{environment='dev'; costCenter='IT'}
```

## Locking

Blueprints support resource locking:
- **Don't Lock**: Normal operation
- **Read Only**: Prevent modifications
- **Do Not Delete**: Prevent deletion

Blueprints ensure every environment starts from a known, compliant state.
