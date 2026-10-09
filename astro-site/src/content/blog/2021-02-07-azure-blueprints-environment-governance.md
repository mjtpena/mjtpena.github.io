---
title: Environment Governance with Azure Blueprints
description: "The first time I helped a platform team stand up a new environment from scratch, we got it right on the third try. The first two tries had a RBAC assignment…"
author: Michael John Peña
draft: false
date: 2021-02-07
url: /blog/azure-blueprints-environment-governance/
tags:
  - Azure
  - Governance
  - Blueprints
  - Infrastructure as Code
  - Cloud Management
---

The first time I helped a platform team stand up a new environment from scratch, we got it right on the third try. The first two tries had a RBAC assignment missing, a Policy in the wrong scope, and a Log Analytics workspace in the wrong region. Blueprints solves this class of problem: bundle ARM templates, Policy assignments, RBAC assignments, and resource groups into a single definition, assign it to a subscription, and track which assignment deployed which version. Unlike standalone ARM, the Blueprint tracks the relationship through lifecycle—update the definition, push a new version to the assignment.

## Understanding Azure Blueprints

A Blueprint can include:

- **Role Assignments** - Assign Azure RBAC roles to users, groups, or service principals
- **Policy Assignments** - Apply Azure Policies to enforce standards
- **ARM Templates** - Deploy Azure resources
- **Resource Groups** - Create resource group structure

The key differentiator from ARM templates is that Blueprints maintain the relationship between what should be deployed and what was deployed, enabling governance at scale.

## Creating a Blueprint

Let's create a blueprint for a secure landing zone:

```json
{
    "properties": {
        "displayName": "Secure Landing Zone Blueprint",
        "description": "Deploys a secure landing zone with networking, monitoring, and security controls",
        "targetScope": "subscription",
        "parameters": {
            "organization": {
                "type": "string",
                "metadata": {
                    "displayName": "Organization Prefix",
                    "description": "Prefix for resource naming"
                }
            },
            "environment": {
                "type": "string",
                "allowedValues": ["dev", "test", "prod"],
                "metadata": {
                    "displayName": "Environment"
                }
            },
            "logRetentionDays": {
                "type": "int",
                "defaultValue": 90,
                "metadata": {
                    "displayName": "Log Retention Days"
                }
            }
        },
        "resourceGroups": {
            "NetworkingRG": {
                "metadata": {
                    "displayName": "Networking Resource Group"
                }
            },
            "SecurityRG": {
                "metadata": {
                    "displayName": "Security Resource Group"
                }
            },
            "MonitoringRG": {
                "metadata": {
                    "displayName": "Monitoring Resource Group"
                }
            }
        }
    }
}
```

Create the blueprint using Azure CLI:

```bash
# Create blueprint definition
az blueprint create \
    --name "SecureLandingZone" \
    --management-group "MyManagementGroup" \
    --parameters @blueprint-params.json
```

## Adding Artifacts

### Resource Group Artifact

```json
{
    "kind": "resourceGroup",
    "properties": {
        "displayName": "Networking Resource Group",
        "description": "Contains all networking resources",
        "resourceGroupName": "[concat(parameters('organization'), '-', parameters('environment'), '-network-rg')]",
        "location": "[parameters('location')]"
    }
}
```

### ARM Template Artifact for Virtual Network

```json
{
    "kind": "template",
    "properties": {
        "displayName": "Hub Virtual Network",
        "description": "Deploys the hub virtual network with subnets",
        "dependsOn": ["NetworkingRG"],
        "resourceGroup": "NetworkingRG",
        "template": {
            "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
            "contentVersion": "1.0.0.0",
            "parameters": {
                "vnetAddressPrefix": {
                    "type": "string",
                    "defaultValue": "10.0.0.0/16"
                },
                "organization": {
                    "type": "string"
                },
                "environment": {
                    "type": "string"
                }
            },
            "variables": {
                "vnetName": "[concat(parameters('organization'), '-', parameters('environment'), '-hub-vnet')]"
            },
            "resources": [
                {
                    "type": "Microsoft.Network/virtualNetworks",
                    "apiVersion": "2020-11-01",
                    "name": "[variables('vnetName')]",
                    "location": "[resourceGroup().location]",
                    "properties": {
                        "addressSpace": {
                            "addressPrefixes": ["[parameters('vnetAddressPrefix')]"]
                        },
                        "subnets": [
                            {
                                "name": "GatewaySubnet",
                                "properties": {
                                    "addressPrefix": "10.0.0.0/24"
                                }
                            },
                            {
                                "name": "AzureFirewallSubnet",
                                "properties": {
                                    "addressPrefix": "10.0.1.0/24"
                                }
                            },
                            {
                                "name": "AzureBastionSubnet",
                                "properties": {
                                    "addressPrefix": "10.0.2.0/24"
                                }
                            },
                            {
                                "name": "ManagementSubnet",
                                "properties": {
                                    "addressPrefix": "10.0.3.0/24",
                                    "networkSecurityGroup": {
                                        "id": "[resourceId('Microsoft.Network/networkSecurityGroups', concat(variables('vnetName'), '-mgmt-nsg'))]"
                                    }
                                }
                            }
                        ]
                    }
                },
                {
                    "type": "Microsoft.Network/networkSecurityGroups",
                    "apiVersion": "2020-11-01",
                    "name": "[concat(variables('vnetName'), '-mgmt-nsg')]",
                    "location": "[resourceGroup().location]",
                    "properties": {
                        "securityRules": [
                            {
                                "name": "AllowBastionInbound",
                                "properties": {
                                    "priority": 100,
                                    "direction": "Inbound",
                                    "access": "Allow",
                                    "protocol": "Tcp",
                                    "sourceAddressPrefix": "10.0.2.0/24",
                                    "sourcePortRange": "*",
                                    "destinationAddressPrefix": "*",
                                    "destinationPortRanges": ["22", "3389"]
                                }
                            }
                        ]
                    }
                }
            ]
        },
        "parameters": {
            "organization": {
                "value": "[parameters('organization')]"
            },
            "environment": {
                "value": "[parameters('environment')]"
            }
        }
    }
}
```

### Log Analytics Workspace Artifact

```json
{
    "kind": "template",
    "properties": {
        "displayName": "Log Analytics Workspace",
        "description": "Central logging and monitoring workspace",
        "dependsOn": ["MonitoringRG"],
        "resourceGroup": "MonitoringRG",
        "template": {
            "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
            "contentVersion": "1.0.0.0",
            "parameters": {
                "organization": {
                    "type": "string"
                },
                "environment": {
                    "type": "string"
                },
                "retentionDays": {
                    "type": "int"
                }
            },
            "variables": {
                "workspaceName": "[concat(parameters('organization'), '-', parameters('environment'), '-logs')]"
            },
            "resources": [
                {
                    "type": "Microsoft.OperationalInsights/workspaces",
                    "apiVersion": "2020-10-01",
                    "name": "[variables('workspaceName')]",
                    "location": "[resourceGroup().location]",
                    "properties": {
                        "sku": {
                            "name": "PerGB2018"
                        },
                        "retentionInDays": "[parameters('retentionDays')]",
                        "features": {
                            "enableLogAccessUsingOnlyResourcePermissions": true
                        }
                    }
                },
                {
                    "type": "Microsoft.OperationalInsights/workspaces/dataSources",
                    "apiVersion": "2020-08-01",
                    "name": "[concat(variables('workspaceName'), '/SecurityEventCollectionConfiguration')]",
                    "dependsOn": [
                        "[resourceId('Microsoft.OperationalInsights/workspaces', variables('workspaceName'))]"
                    ],
                    "kind": "SecurityEventCollectionConfiguration",
                    "properties": {
                        "tier": "All",
                        "tierSetMethod": "Custom"
                    }
                }
            ],
            "outputs": {
                "workspaceId": {
                    "type": "string",
                    "value": "[resourceId('Microsoft.OperationalInsights/workspaces', variables('workspaceName'))]"
                }
            }
        },
        "parameters": {
            "organization": {
                "value": "[parameters('organization')]"
            },
            "environment": {
                "value": "[parameters('environment')]"
            },
            "retentionDays": {
                "value": "[parameters('logRetentionDays')]"
            }
        }
    }
}
```

### Policy Assignment Artifact

```json
{
    "kind": "policyAssignment",
    "properties": {
        "displayName": "Require Tag on Resources",
        "description": "Ensures all resources have required tags",
        "policyDefinitionId": "/providers/Microsoft.Authorization/policyDefinitions/1e30110a-5ceb-460c-a204-c1c3969c6d62",
        "parameters": {
            "tagName": {
                "value": "Environment"
            }
        }
    }
}
```

### Role Assignment Artifact

```json
{
    "kind": "roleAssignment",
    "properties": {
        "displayName": "Network Contributors",
        "description": "Assigns Network Contributor role",
        "roleDefinitionId": "/providers/Microsoft.Authorization/roleDefinitions/4d97b98b-1d4f-4787-a291-c67834d212e7",
        "principalIds": "[parameters('networkAdminGroupId')]"
    }
}
```

## Publishing and Assigning

```bash
# Add artifacts to blueprint
az blueprint artifact template create \
    --blueprint-name "SecureLandingZone" \
    --management-group "MyManagementGroup" \
    --artifact-name "hubVnet" \
    --template @hub-vnet-template.json \
    --parameters @hub-vnet-params.json \
    --resource-group-art "NetworkingRG"

# Publish the blueprint
az blueprint publish \
    --blueprint-name "SecureLandingZone" \
    --management-group "MyManagementGroup" \
    --version "1.0"

# Assign the blueprint to a subscription
az blueprint assignment create \
    --name "SecureLandingZone-Prod" \
    --subscription "00000000-0000-0000-0000-000000000000" \
    --blueprint-version "/providers/Microsoft.Management/managementGroups/MyManagementGroup/providers/Microsoft.Blueprint/blueprints/SecureLandingZone/versions/1.0" \
    --parameters '{
        "organization": {"value": "contoso"},
        "environment": {"value": "prod"},
        "logRetentionDays": {"value": 365}
    }' \
    --identity-type SystemAssigned \
    --location eastus
```

## Managing Blueprint Assignments with Python

```python
from azure.identity import DefaultAzureCredential
from azure.mgmt.blueprint import BlueprintManagementClient
import json

def list_blueprint_assignments(subscription_id):
    """List all blueprint assignments for a subscription."""
    credential = DefaultAzureCredential()
    client = BlueprintManagementClient(credential, subscription_id)

    assignments = client.assignments.list(
        scope=f"/subscriptions/{subscription_id}"
    )

    for assignment in assignments:
        print(f"Name: {assignment.name}")
        print(f"Blueprint: {assignment.blueprint_id}")
        print(f"Status: {assignment.provisioning_state}")
        print(f"Locks: {assignment.locks.mode}")
        print("-" * 40)

def get_assignment_status(subscription_id, assignment_name):
    """Get detailed status of a blueprint assignment."""
    credential = DefaultAzureCredential()
    client = BlueprintManagementClient(credential, subscription_id)

    assignment = client.assignments.get(
        scope=f"/subscriptions/{subscription_id}",
        assignment_name=assignment_name
    )

    return {
        "name": assignment.name,
        "status": assignment.provisioning_state,
        "blueprintId": assignment.blueprint_id,
        "parameters": assignment.parameters,
        "resourceGroups": assignment.resource_groups,
        "locks": assignment.locks.mode if assignment.locks else None
    }

def update_assignment(subscription_id, assignment_name, new_version):
    """Update a blueprint assignment to a new version."""
    credential = DefaultAzureCredential()
    client = BlueprintManagementClient(credential, subscription_id)

    # Get current assignment
    current = client.assignments.get(
        scope=f"/subscriptions/{subscription_id}",
        assignment_name=assignment_name
    )

    # Update to new version
    current.blueprint_id = current.blueprint_id.rsplit('/versions/', 1)[0] + f'/versions/{new_version}'

    updated = client.assignments.create_or_update(
        scope=f"/subscriptions/{subscription_id}",
        assignment_name=assignment_name,
        assignment=current
    )

    return updated.provisioning_state

# Usage
subscription_id = "your-subscription-id"
list_blueprint_assignments(subscription_id)
```

## Blueprint Locking

Blueprints can lock resources to prevent accidental changes:

```json
{
    "locks": {
        "mode": "AllResourcesDoNotDelete",
        "excludedPrincipals": [
            "00000000-0000-0000-0000-000000000000"
        ],
        "excludedActions": [
            "*/read",
            "Microsoft.Insights/diagnosticSettings/write"
        ]
    }
}
```

Lock modes:
- **None** - No locks applied
- **AllResourcesReadOnly** - All resources are read-only
- **AllResourcesDoNotDelete** - Resources can be modified but not deleted

## Best Practices

1. **Version Your Blueprints**: Use semantic versioning for blueprint versions
2. **Start Simple**: Begin with basic blueprints and add complexity gradually
3. **Use Parameters**: Make blueprints reusable with parameters
4. **Test in Dev First**: Always test blueprint changes in non-production first
5. **Document Dependencies**: Clearly document artifact dependencies
6. **Regular Updates**: Keep blueprints updated with latest security practices

## Blueprint vs ARM Templates vs Terraform

| Feature | Blueprints | ARM Templates | Terraform |
|---------|------------|---------------|-----------|
| Relationship tracking | Yes | No | State file |
| Policy assignments | Native | Separate | Separate |
| Role assignments | Native | Separate | Separate |
| Multi-subscription | Yes | Limited | Yes |
| Locking | Native | No | No |
| Versioning | Built-in | Manual | State |

## Conclusion

Azure Blueprints provide a powerful way to standardize and govern your Azure environments. By combining resource deployments with policies and role assignments in a single, versioned package, you can ensure consistent, compliant environments across your organization.

Start with the built-in blueprint samples and customize them for your organization's specific needs.
