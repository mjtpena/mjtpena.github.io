---
title: "Azure Lighthouse: Multi-Tenant Management"
author: Michael John Peña
draft: false
date: 2020-12-24
tags:
  - Azure
  - Lighthouse
  - Multi-Tenant
  - MSP

---


"Can you log in to my tenant and fix it?" used to mean a guest account, an awkward password share, and a privileged role for a partner that frequently outlived the engagement. Lighthouse changes the model. Customers delegate scoped Azure roles to a partner tenant; the partner's engineers see the customer's resources alongside their own without a tenant switch. For MSPs and consultancies (the world I live in), it's the cleanest thing to happen to multi-tenant operations in years.

## How Lighthouse Works

```
Service Provider Tenant          Customer Tenants
┌─────────────────────┐         ┌─────────────┐
│                     │   ───▶  │ Customer A  │
│  Management Portal  │   ───▶  │ Customer B  │
│                     │   ───▶  │ Customer C  │
└─────────────────────┘         └─────────────┘
                                Delegated Access
```

## Create Lighthouse Offer

```json
// managedServiceOffer.json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-08-01/managementGroupDeploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "mspOfferName": {
            "type": "string",
            "defaultValue": "Managed Services"
        },
        "mspOfferDescription": {
            "type": "string",
            "defaultValue": "24/7 infrastructure management"
        }
    },
    "variables": {
        "managedByTenantId": "service-provider-tenant-id",
        "authorizations": [
            {
                "principalId": "group-or-user-id",
                "roleDefinitionId": "acdd72a7-3385-48ef-bd42-f606fba81ae7",
                "principalIdDisplayName": "Tier 1 Support"
            },
            {
                "principalId": "group-or-user-id",
                "roleDefinitionId": "b24988ac-6180-42a0-ab88-20f7382dd24c",
                "principalIdDisplayName": "Tier 2 Engineers"
            }
        ]
    },
    "resources": [
        {
            "type": "Microsoft.ManagedServices/registrationDefinitions",
            "apiVersion": "2020-02-01-preview",
            "name": "[guid(parameters('mspOfferName'))]",
            "properties": {
                "registrationDefinitionName": "[parameters('mspOfferName')]",
                "description": "[parameters('mspOfferDescription')]",
                "managedByTenantId": "[variables('managedByTenantId')]",
                "authorizations": "[variables('authorizations')]"
            }
        }
    ]
}
```

## Deploy to Customer

```bash
# Customer deploys template
az deployment sub create \
    --location eastus \
    --template-file managedServiceOffer.json \
    --subscription customer-subscription-id
```

## View Delegated Resources

```powershell
# From service provider tenant
Get-AzManagedServicesDefinition
Get-AzManagedServicesAssignment

# List all delegated subscriptions
Get-AzSubscription | Where-Object { $_.HomeTenantId -ne $_.TenantId }
```

## Cross-Tenant Operations

```powershell
# Query across all customers
$customers = Get-AzSubscription | Where-Object { $_.HomeTenantId -ne $_.TenantId }

foreach ($customer in $customers) {
    Set-AzContext -Subscription $customer.Id

    # Get VMs across all customers
    Get-AzVM | Select-Object Name, ResourceGroupName, @{N='Customer';E={$customer.Name}}

    # Apply policy
    New-AzPolicyAssignment -Name "require-tag" -PolicyDefinition $policy -Scope "/subscriptions/$($customer.Id)"
}
```

## Azure Resource Graph

```kusto
// Query all delegated resources
resources
| where subscriptionId in~ (
    resourcecontainers
    | where type == 'microsoft.resources/subscriptions'
    | where tenantId != 'your-tenant-id'
    | project subscriptionId
)
| summarize count() by type
```

## Monitoring Across Tenants

```bash
# Create Log Analytics workspace in provider tenant
# Configure customers to send logs there

# Or use Azure Monitor for cross-tenant views
az monitor log-analytics workspace create \
    --name multi-tenant-logs \
    --resource-group provider-rg
```

## Security Best Practices

1. Use security groups, not individual users
2. Apply least-privilege roles
3. Use Privileged Identity Management (PIM)
4. Enable MFA for all provider users
5. Audit cross-tenant operations

## Customer Controls

Customers can:
- View delegated access
- Remove provider access anytime
- See all provider activity in logs

```powershell
# Customer: View delegated access
Get-AzManagedServicesAssignment

# Customer: Remove delegation
Remove-AzManagedServicesAssignment -Id assignment-id
```

## Eligible Authorizations (PIM)

```json
{
    "principalId": "group-id",
    "roleDefinitionId": "contributor-role-id",
    "principalIdDisplayName": "Elevated Access Group",
    "delegatedRoleDefinitionIds": ["contributor-role-id"],
    "justInTimeAccessPolicy": {
        "multiFactorAuthProvider": "Azure",
        "maximumActivationDuration": "PT8H"
    }
}
```

Azure Lighthouse: scale your managed services business.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n

