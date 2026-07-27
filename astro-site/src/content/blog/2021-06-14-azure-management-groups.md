---
title: Azure Management Groups for Enterprise Hierarchy
author: Michael John Peña
draft: false
date: 2021-06-14
url: /blog/azure-management-groups/
tags:
  - Azure
  - Management Groups
  - Governance
  - Enterprise
---

Azure Management Groups are the first thing I help clients set up when their Azure estate starts involving more than two or three subscriptions. Without Management Groups, policy and RBAC assignments have to be replicated across every subscription individually—you inevitably miss one, and the security finding or compliance gap that creates shows up at audit time. Management Groups let you assign Azure Policy and RBAC at a level above subscriptions and have those assignments inherit downward. The hierarchy design is the important work: Environment (Production, Non-Production), Geography (APAC, EMEA), Department—whichever dimension reflects how governance decisions are actually made in your organisation.

## Management Group Fundamentals

### Hierarchy Structure

```
Tenant Root Group
├── Platform
│   ├── Identity
│   ├── Management
│   └── Connectivity
├── Landing Zones
│   ├── Production
│   │   ├── Business Unit A
│   │   └── Business Unit B
│   ├── Non-Production
│   │   ├── Development
│   │   └── Testing
│   └── Sandbox
└── Decommissioned
```

### Creating Management Groups

```bash
# Create root level management group
az account management-group create \
  --name "Platform" \
  --display-name "Platform"

# Create child management groups
az account management-group create \
  --name "mg-identity" \
  --display-name "Identity" \
  --parent "Platform"

az account management-group create \
  --name "mg-management" \
  --display-name "Management" \
  --parent "Platform"

az account management-group create \
  --name "mg-connectivity" \
  --display-name "Connectivity" \
  --parent "Platform"

# Create landing zone hierarchy
az account management-group create \
  --name "LandingZones" \
  --display-name "Landing Zones"

az account management-group create \
  --name "mg-production" \
  --display-name "Production" \
  --parent "LandingZones"

az account management-group create \
  --name "mg-nonproduction" \
  --display-name "Non-Production" \
  --parent "LandingZones"
```

### Moving Subscriptions

```bash
# Move subscription to management group
az account management-group subscription add \
  --name "mg-production" \
  --subscription "Production-Subscription-Id"

# List subscriptions in management group
az account management-group subscription show \
  --name "mg-production"
```

## Implementing with ARM/Bicep

### Bicep Management Group Deployment

```bicep
// managementGroups.bicep
targetScope = 'tenant'

@description('Root management group ID')
param rootManagementGroupId string = 'mg-enterprise'

// Root Management Group
resource rootMg 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: rootManagementGroupId
  properties: {
    displayName: 'Enterprise'
  }
}

// Platform Management Group
resource platformMg 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: 'mg-platform'
  properties: {
    displayName: 'Platform'
    details: {
      parent: {
        id: rootMg.id
      }
    }
  }
}

// Identity Management Group
resource identityMg 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: 'mg-identity'
  properties: {
    displayName: 'Identity'
    details: {
      parent: {
        id: platformMg.id
      }
    }
  }
}

// Management Management Group
resource managementMg 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: 'mg-management'
  properties: {
    displayName: 'Management'
    details: {
      parent: {
        id: platformMg.id
      }
    }
  }
}

// Connectivity Management Group
resource connectivityMg 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: 'mg-connectivity'
  properties: {
    displayName: 'Connectivity'
    details: {
      parent: {
        id: platformMg.id
      }
    }
  }
}

// Landing Zones Management Group
resource landingZonesMg 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: 'mg-landingzones'
  properties: {
    displayName: 'Landing Zones'
    details: {
      parent: {
        id: rootMg.id
      }
    }
  }
}

// Production Landing Zone
resource productionMg 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: 'mg-production'
  properties: {
    displayName: 'Production'
    details: {
      parent: {
        id: landingZonesMg.id
      }
    }
  }
}

// Non-Production Landing Zone
resource nonproductionMg 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: 'mg-nonproduction'
  properties: {
    displayName: 'Non-Production'
    details: {
      parent: {
        id: landingZonesMg.id
      }
    }
  }
}

// Sandbox Landing Zone
resource sandboxMg 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: 'mg-sandbox'
  properties: {
    displayName: 'Sandbox'
    details: {
      parent: {
        id: landingZonesMg.id
      }
    }
  }
}

output rootMgId string = rootMg.id
output platformMgId string = platformMg.id
output landingZonesMgId string = landingZonesMg.id
```

## Applying Policies at Management Group Level

### Policy Assignment

```bicep
// policyAssignments.bicep
targetScope = 'managementGroup'

@description('Management group ID to assign policies')
param managementGroupId string

// Require tag policy
resource requireTagPolicy 'Microsoft.Authorization/policyAssignments@2021-06-01' = {
  name: 'require-costcenter-tag'
  properties: {
    displayName: 'Require CostCenter tag on resources'
    policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/96670d01-0a4d-4649-9c89-2d3abc0a5025'
    parameters: {
      tagName: {
        value: 'CostCenter'
      }
    }
    enforcementMode: 'Default'
  }
}

// Allowed locations policy
resource allowedLocationsPolicy 'Microsoft.Authorization/policyAssignments@2021-06-01' = {
  name: 'allowed-locations'
  properties: {
    displayName: 'Allowed locations for resources'
    policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c'
    parameters: {
      listOfAllowedLocations: {
        value: [
          'australiaeast'
          'australiasoutheast'
        ]
      }
    }
    enforcementMode: 'Default'
  }
}

// Deny public IP policy for production
resource denyPublicIpPolicy 'Microsoft.Authorization/policyAssignments@2021-06-01' = {
  name: 'deny-public-ip'
  properties: {
    displayName: 'Deny public IP addresses'
    policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/6c112d4e-5bc7-47ae-a041-ea2d9dccd749'
    enforcementMode: 'Default'
  }
}
```

### Custom Policy Initiative

```json
{
  "properties": {
    "displayName": "Enterprise Security Baseline",
    "description": "Security policies for all landing zones",
    "metadata": {
      "category": "Security"
    },
    "parameters": {},
    "policyDefinitions": [
      {
        "policyDefinitionId": "/providers/Microsoft.Authorization/policyDefinitions/0015ea4d-51ff-4ce3-8d8c-f3f8f0179a56",
        "policyDefinitionReferenceId": "auditDiagnosticSetting"
      },
      {
        "policyDefinitionId": "/providers/Microsoft.Authorization/policyDefinitions/404c3081-a854-4457-ae30-26a93ef643f9",
        "policyDefinitionReferenceId": "secureTransferToStorageAccounts"
      },
      {
        "policyDefinitionId": "/providers/Microsoft.Authorization/policyDefinitions/22bee202-a82f-4305-9a2a-6d7f44d4dedb",
        "policyDefinitionReferenceId": "onlySecureConnectionsToRedis"
      }
    ]
  }
}
```

## RBAC at Management Group Level

### Role Assignments

```bash
# Assign Reader role at management group level
az role assignment create \
  --assignee "security-team@company.com" \
  --role "Reader" \
  --scope "/providers/Microsoft.Management/managementGroups/mg-landingzones"

# Assign custom role for landing zone owners
az role assignment create \
  --assignee "landing-zone-admins@company.com" \
  --role "Landing Zone Owner" \
  --scope "/providers/Microsoft.Management/managementGroups/mg-production"
```

### Custom Role Definition

```json
{
  "Name": "Landing Zone Owner",
  "Description": "Can manage resources in landing zone but not modify governance",
  "Actions": [
    "Microsoft.Resources/subscriptions/resourceGroups/*",
    "Microsoft.Compute/*",
    "Microsoft.Network/*",
    "Microsoft.Storage/*",
    "Microsoft.Web/*",
    "Microsoft.Sql/*",
    "Microsoft.KeyVault/*"
  ],
  "NotActions": [
    "Microsoft.Authorization/policyAssignments/*",
    "Microsoft.Authorization/policyDefinitions/*",
    "Microsoft.Authorization/roleAssignments/*",
    "Microsoft.Authorization/roleDefinitions/*"
  ],
  "AssignableScopes": [
    "/providers/Microsoft.Management/managementGroups/mg-landingzones"
  ]
}
```

## Querying Management Group Hierarchy

```kusto
// Resource Graph query for hierarchy
ResourceContainers
| where type == 'microsoft.management/managementgroups'
| project name, displayName = properties.displayName,
    parent = properties.details.parent.id

// Count subscriptions per management group
ResourceContainers
| where type == 'microsoft.resources/subscriptions'
| extend mgParent = properties.managementGroupAncestorsChain
| mv-expand mg = mgParent
| summarize SubscriptionCount = count() by tostring(mg.name)
```

## Best Practices

### Hierarchy Design Principles

```markdown
1. **Limit depth to 6 levels** - Includes root tenant group
2. **Avoid complex branching** - Keep structure simple
3. **Separate platform and workloads** - Different governance needs
4. **Consider compliance boundaries** - Regulatory requirements
5. **Plan for scale** - Future business units
```

### Implementation Checklist

```markdown
- [ ] Define management group hierarchy
- [ ] Create platform management groups (Identity, Management, Connectivity)
- [ ] Create landing zone management groups (Production, Non-Production, Sandbox)
- [ ] Apply baseline policies at root level
- [ ] Apply environment-specific policies at landing zone level
- [ ] Configure RBAC inheritance
- [ ] Move existing subscriptions
- [ ] Document governance model
- [ ] Train operations team
```

## Terraform Implementation

```hcl
# Management Group hierarchy
resource "azurerm_management_group" "root" {
  display_name = "Enterprise"
  name         = "mg-enterprise"
}

resource "azurerm_management_group" "platform" {
  display_name               = "Platform"
  name                       = "mg-platform"
  parent_management_group_id = azurerm_management_group.root.id
}

resource "azurerm_management_group" "landing_zones" {
  display_name               = "Landing Zones"
  name                       = "mg-landingzones"
  parent_management_group_id = azurerm_management_group.root.id
}

resource "azurerm_management_group" "production" {
  display_name               = "Production"
  name                       = "mg-production"
  parent_management_group_id = azurerm_management_group.landing_zones.id

  subscription_ids = [
    data.azurerm_subscription.prod_sub1.subscription_id,
    data.azurerm_subscription.prod_sub2.subscription_id
  ]
}

# Policy assignment at management group level
resource "azurerm_management_group_policy_assignment" "allowed_locations" {
  name                 = "allowed-locations"
  management_group_id  = azurerm_management_group.landing_zones.id
  policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c"

  parameters = jsonencode({
    listOfAllowedLocations = {
      value = ["australiaeast", "australiasoutheast"]
    }
  })
}
```

## Conclusion

Azure Management Groups are foundational for enterprise Azure governance. By creating a well-designed hierarchy, you enable consistent policy application, simplified RBAC management, and clear organizational boundaries. Start with the Cloud Adoption Framework's recommended structure and adapt it to your organization's needs.

## References

- [Azure Management Groups Documentation](https://docs.microsoft.com/en-us/azure/governance/management-groups/)
- [Cloud Adoption Framework - Management Group Design](https://docs.microsoft.com/en-us/azure/cloud-adoption-framework/ready/enterprise-scale/management-group-and-subscription-organization)
