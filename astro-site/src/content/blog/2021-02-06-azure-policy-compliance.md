---
title: Enforcing Cloud Governance with Azure Policy
description: "The tagging policy conversation is the one I have in every landing zone engagement. Someone inevitably says \"we'll just ask people to tag resources…"
author: Michael John Peña
draft: false
date: 2021-02-06
url: /blog/azure-policy-compliance/
tags:
  - Azure
  - Governance
  - Compliance
  - Azure Policy
  - Cloud Management
---

The tagging policy conversation is the one I have in every landing zone engagement. Someone inevitably says "we'll just ask people to tag resources correctly." That lasts two sprints. Azure Policy is how you enforce it. Deny policies for the absolute rules, audit for the ones you want visibility on, and DeployIfNotExists for the remediation tasks that shouldn't require a ticket (like enabling Defender on newly created SQL servers). The initiative model lets you group related policies, assign them at management group scope, and track compliance across every subscription at once.

## How Azure Policy Works

Azure Policy evaluates resources in Azure by comparing their properties against business rules defined as policy definitions. These rules are written in JSON format and can:

- **Audit** resources that don't comply
- **Deny** creation of non-compliant resources
- **Deploy** missing configurations automatically
- **Modify** existing resources to add compliance

## Creating Custom Policy Definitions

Let's create a policy that requires specific tags on all resources:

```json
{
    "mode": "Indexed",
    "policyRule": {
        "if": {
            "anyOf": [
                {
                    "field": "tags['Environment']",
                    "exists": "false"
                },
                {
                    "field": "tags['CostCenter']",
                    "exists": "false"
                },
                {
                    "field": "tags['Owner']",
                    "exists": "false"
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

Deploy this policy using Azure CLI:

```bash
# Create the policy definition
az policy definition create \
    --name "require-mandatory-tags" \
    --display-name "Require mandatory tags on resources" \
    --description "Ensures all resources have Environment, CostCenter, and Owner tags" \
    --mode Indexed \
    --rules @mandatory-tags-policy.json

# Assign the policy to a subscription
az policy assignment create \
    --name "require-tags-assignment" \
    --display-name "Require Mandatory Tags" \
    --policy "require-mandatory-tags" \
    --scope "/subscriptions/{subscription-id}"
```

## Common Policy Patterns

### Allowed Locations

Restrict resource deployment to specific regions:

```json
{
    "mode": "Indexed",
    "policyRule": {
        "if": {
            "allOf": [
                {
                    "field": "location",
                    "notIn": "[parameters('allowedLocations')]"
                },
                {
                    "field": "location",
                    "notEquals": "global"
                }
            ]
        },
        "then": {
            "effect": "deny"
        }
    },
    "parameters": {
        "allowedLocations": {
            "type": "Array",
            "metadata": {
                "displayName": "Allowed Locations",
                "description": "The list of allowed locations for resources"
            },
            "defaultValue": ["eastus", "westus2", "australiaeast"]
        }
    }
}
```

### Allowed VM SKUs

Control costs by limiting VM sizes:

```json
{
    "mode": "Indexed",
    "policyRule": {
        "if": {
            "allOf": [
                {
                    "field": "type",
                    "equals": "Microsoft.Compute/virtualMachines"
                },
                {
                    "not": {
                        "field": "Microsoft.Compute/virtualMachines/sku.name",
                        "in": "[parameters('allowedSKUs')]"
                    }
                }
            ]
        },
        "then": {
            "effect": "deny"
        }
    },
    "parameters": {
        "allowedSKUs": {
            "type": "Array",
            "metadata": {
                "displayName": "Allowed VM SKUs",
                "description": "The list of VM SKUs that can be deployed"
            },
            "defaultValue": [
                "Standard_B1s",
                "Standard_B2s",
                "Standard_D2s_v3",
                "Standard_D4s_v3"
            ]
        }
    }
}
```

### Enforce HTTPS on Storage Accounts

```json
{
    "mode": "Indexed",
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
```

### Auto-Deploy Diagnostic Settings

Use the `deployIfNotExists` effect to automatically configure resources:

```json
{
    "mode": "Indexed",
    "policyRule": {
        "if": {
            "field": "type",
            "equals": "Microsoft.Compute/virtualMachines"
        },
        "then": {
            "effect": "deployIfNotExists",
            "details": {
                "type": "Microsoft.Insights/diagnosticSettings",
                "existenceCondition": {
                    "field": "Microsoft.Insights/diagnosticSettings/logs.enabled",
                    "equals": "true"
                },
                "roleDefinitionIds": [
                    "/providers/Microsoft.Authorization/roleDefinitions/749f88d5-cbae-40b8-bcfc-e573ddc772fa"
                ],
                "deployment": {
                    "properties": {
                        "mode": "incremental",
                        "template": {
                            "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
                            "contentVersion": "1.0.0.0",
                            "parameters": {
                                "vmName": {
                                    "type": "string"
                                },
                                "location": {
                                    "type": "string"
                                },
                                "logAnalyticsWorkspace": {
                                    "type": "string"
                                }
                            },
                            "resources": [
                                {
                                    "type": "Microsoft.Compute/virtualMachines/providers/diagnosticSettings",
                                    "apiVersion": "2017-05-01-preview",
                                    "name": "[concat(parameters('vmName'), '/Microsoft.Insights/diagSettings')]",
                                    "location": "[parameters('location')]",
                                    "properties": {
                                        "workspaceId": "[parameters('logAnalyticsWorkspace')]",
                                        "metrics": [
                                            {
                                                "category": "AllMetrics",
                                                "enabled": true
                                            }
                                        ]
                                    }
                                }
                            ]
                        },
                        "parameters": {
                            "vmName": {
                                "value": "[field('name')]"
                            },
                            "location": {
                                "value": "[field('location')]"
                            },
                            "logAnalyticsWorkspace": {
                                "value": "[parameters('logAnalyticsWorkspaceId')]"
                            }
                        }
                    }
                }
            }
        }
    },
    "parameters": {
        "logAnalyticsWorkspaceId": {
            "type": "String",
            "metadata": {
                "displayName": "Log Analytics Workspace ID",
                "description": "The resource ID of the Log Analytics workspace"
            }
        }
    }
}
```

## Policy Initiatives (Policy Sets)

Group related policies into initiatives for easier management:

```json
{
    "properties": {
        "displayName": "Security Baseline Initiative",
        "description": "Collection of policies for security compliance",
        "policyDefinitions": [
            {
                "policyDefinitionId": "/providers/Microsoft.Authorization/policyDefinitions/require-https-storage",
                "parameters": {}
            },
            {
                "policyDefinitionId": "/providers/Microsoft.Authorization/policyDefinitions/require-tls-sql",
                "parameters": {}
            },
            {
                "policyDefinitionId": "/providers/Microsoft.Authorization/policyDefinitions/require-encryption-disks",
                "parameters": {}
            }
        ]
    }
}
```

Create and assign the initiative:

```bash
# Create initiative definition
az policy set-definition create \
    --name "security-baseline" \
    --display-name "Security Baseline Initiative" \
    --definitions @security-initiative.json

# Assign initiative
az policy assignment create \
    --name "security-baseline-assignment" \
    --display-name "Security Baseline" \
    --policy-set-definition "security-baseline" \
    --scope "/subscriptions/{subscription-id}" \
    --mi-system-assigned \
    --location eastus
```

## Checking Compliance Status

Query compliance status using Azure CLI:

```bash
# Get compliance summary for a subscription
az policy state summarize \
    --subscription {subscription-id}

# Get non-compliant resources for a specific policy
az policy state list \
    --subscription {subscription-id} \
    --policy-assignment "require-tags-assignment" \
    --filter "complianceState eq 'NonCompliant'" \
    --output table

# Trigger a compliance evaluation
az policy state trigger-scan \
    --subscription {subscription-id}
```

## Automating Compliance Reports

Create a compliance report using Python:

```python
from azure.identity import DefaultAzureCredential
from azure.mgmt.policyinsights import PolicyInsightsClient
import pandas as pd
from datetime import datetime

def get_compliance_report(subscription_id):
    """Generate a compliance report for a subscription."""

    credential = DefaultAzureCredential()
    client = PolicyInsightsClient(credential, subscription_id)

    # Get policy states
    query_results = client.policy_states.list_query_results_for_subscription(
        policy_states_resource="latest",
        subscription_id=subscription_id
    )

    results = []
    for state in query_results:
        results.append({
            "Resource": state.resource_id.split("/")[-1],
            "ResourceType": state.resource_type,
            "ResourceGroup": state.resource_group,
            "Policy": state.policy_definition_name,
            "ComplianceState": state.compliance_state,
            "Timestamp": state.timestamp
        })

    df = pd.DataFrame(results)

    # Summary statistics
    summary = df.groupby(["Policy", "ComplianceState"]).size().unstack(fill_value=0)

    return df, summary

def export_report(subscription_id, output_path):
    """Export compliance report to Excel."""

    details, summary = get_compliance_report(subscription_id)

    with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
        summary.to_excel(writer, sheet_name='Summary')
        details.to_excel(writer, sheet_name='Details', index=False)

        # Non-compliant resources only
        non_compliant = details[details['ComplianceState'] == 'NonCompliant']
        non_compliant.to_excel(writer, sheet_name='Non-Compliant', index=False)

    print(f"Report exported to {output_path}")

# Usage
subscription_id = "your-subscription-id"
export_report(subscription_id, f"compliance_report_{datetime.now():%Y%m%d}.xlsx")
```

## Exemptions

Sometimes you need to exempt specific resources from policies:

```bash
# Create a policy exemption
az policy exemption create \
    --name "legacy-app-exemption" \
    --display-name "Legacy Application Exemption" \
    --policy-assignment "require-tags-assignment" \
    --exemption-category "Waiver" \
    --scope "/subscriptions/{sub-id}/resourceGroups/legacy-rg" \
    --description "Legacy application pending migration" \
    --expires-on "2021-06-30"
```

## Best Practices

1. **Start with Audit Mode**: Use audit effect first to understand impact before enforcing
2. **Use Management Groups**: Apply policies at management group level for consistency
3. **Leverage Built-in Policies**: Check Azure's built-in policies before creating custom ones
4. **Document Exemptions**: Always document why exemptions are granted
5. **Regular Reviews**: Schedule periodic compliance reviews
6. **Combine with Azure Blueprints**: Use Blueprints for full environment governance

## Conclusion

Azure Policy is essential for maintaining governance and compliance in your Azure environment. By combining policy definitions into initiatives and applying them consistently across your organization, you can ensure that all resources meet your security and operational requirements.

Start with the built-in policies, then create custom policies as needed for your specific requirements.
