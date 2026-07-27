---
title: Azure Lighthouse for Multi-Tenant Management
author: Michael John Peña
draft: false
date: 2021-06-15
url: /blog/azure-lighthouse/
tags:
  - Azure
  - Lighthouse
  - Multi-Tenant
  - MSP

---

I wrote "2021-06-15-azure-lighthouse" to share practical, production-minded guidance on this topic.

## Understanding Azure Lighthouse

### Key Concepts

```markdown
**Managing Tenant**: Your organization's Azure AD tenant
**Customer Tenant**: The tenant you're managing (customer or subsidiary)
**Delegation**: Permission grant from customer to managing tenant
**Authorization**: Specific RBAC roles granted to managing tenant users/groups

Benefits:
- Single pane of glass for multiple tenants
- No context switching between directories
- Automated at-scale operations
- Audit trail across tenants
```

## Onboarding Customers

### ARM Template for Delegation

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-08-01/subscriptionDeploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "mspOfferName": {
      "type": "string",
      "metadata": {
        "description": "Managed Service Provider offer name"
      },
      "defaultValue": "Contoso Managed Services"
    },
    "mspOfferDescription": {
      "type": "string",
      "metadata": {
        "description": "Description of the MSP offer"
      },
      "defaultValue": "Provides monitoring, security, and management services"
    },
    "managedByTenantId": {
      "type": "string",
      "metadata": {
        "description": "Managing tenant ID"
      }
    },
    "authorizations": {
      "type": "array",
      "metadata": {
        "description": "Array of authorization objects"
      }
    }
  },
  "variables": {
    "mspRegistrationName": "[guid(parameters('mspOfferName'))]",
    "mspAssignmentName": "[guid(parameters('mspOfferName'))]"
  },
  "resources": [
    {
      "type": "Microsoft.ManagedServices/registrationDefinitions",
      "apiVersion": "2020-02-01-preview",
      "name": "[variables('mspRegistrationName')]",
      "properties": {
        "registrationDefinitionName": "[parameters('mspOfferName')]",
        "description": "[parameters('mspOfferDescription')]",
        "managedByTenantId": "[parameters('managedByTenantId')]",
        "authorizations": "[parameters('authorizations')]"
      }
    },
    {
      "type": "Microsoft.ManagedServices/registrationAssignments",
      "apiVersion": "2020-02-01-preview",
      "name": "[variables('mspAssignmentName')]",
      "dependsOn": [
        "[resourceId('Microsoft.ManagedServices/registrationDefinitions', variables('mspRegistrationName'))]"
      ],
      "properties": {
        "registrationDefinitionId": "[resourceId('Microsoft.ManagedServices/registrationDefinitions', variables('mspRegistrationName'))]"
      }
    }
  ],
  "outputs": {
    "registrationDefinitionId": {
      "type": "string",
      "value": "[resourceId('Microsoft.ManagedServices/registrationDefinitions', variables('mspRegistrationName'))]"
    }
  }
}
```

### Parameters File

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "mspOfferName": {
      "value": "Contoso Managed Services"
    },
    "mspOfferDescription": {
      "value": "Infrastructure monitoring and management services"
    },
    "managedByTenantId": {
      "value": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    },
    "authorizations": {
      "value": [
        {
          "principalId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          "roleDefinitionId": "acdd72a7-3385-48ef-bd42-f606fba81ae7",
          "principalIdDisplayName": "MSP Operators Group"
        },
        {
          "principalId": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          "roleDefinitionId": "b24988ac-6180-42a0-ab88-20f7382dd24c",
          "principalIdDisplayName": "MSP Administrators Group"
        },
        {
          "principalId": "cccccccc-cccc-cccc-cccc-cccccccccccc",
          "roleDefinitionId": "91c1777a-f3dc-4fae-b103-61d183457e46",
          "principalIdDisplayName": "MSP Security Team",
          "delegatedRoleDefinitionIds": [
            "a]7ffa36-a066-4b39-a5ea-ed1dbe8e3e6c"
          ]
        }
      ]
    }
  }
}
```

## Deploying Delegation

### PowerShell Deployment

```powershell
# Deploy to customer subscription
$customerSubscriptionId = "customer-subscription-id"

# Connect to customer tenant
Connect-AzAccount -Tenant "customer-tenant-id" -Subscription $customerSubscriptionId

# Deploy the delegation template
New-AzSubscriptionDeployment `
  -Location "australiaeast" `
  -TemplateFile "./lighthouse-delegation.json" `
  -TemplateParameterFile "./lighthouse-params.json" `
  -Name "ContosoDelegation"
```

### Azure CLI Deployment

```bash
# Login to customer context
az login --tenant customer-tenant-id

# Set subscription
az account set --subscription customer-subscription-id

# Deploy delegation
az deployment sub create \
  --location australiaeast \
  --template-file lighthouse-delegation.json \
  --parameters @lighthouse-params.json \
  --name ContosoDelegation
```

## Managing Delegated Resources

### Listing Delegated Subscriptions

```powershell
# From managing tenant
Connect-AzAccount -Tenant "managing-tenant-id"

# List all delegated subscriptions
Get-AzSubscription | ForEach-Object {
    $sub = $_
    $delegation = Get-AzManagedServicesAssignment -Scope "/subscriptions/$($sub.Id)" -ErrorAction SilentlyContinue
    if ($delegation) {
        [PSCustomObject]@{
            SubscriptionName = $sub.Name
            SubscriptionId = $sub.Id
            TenantId = $sub.TenantId
            OfferName = $delegation.Properties.RegistrationDefinitionName
        }
    }
}
```

### Cross-Tenant Azure CLI Commands

```bash
# List VMs across all delegated subscriptions
az vm list --query "[].{Name:name, ResourceGroup:resourceGroup, Location:location}" --output table

# Query with Resource Graph across delegated subscriptions
az graph query -q "
Resources
| where type =~ 'microsoft.compute/virtualmachines'
| project name, resourceGroup, subscriptionId, location
| limit 100"
```

## Automation with Azure Lighthouse

### Azure Automation Runbook

```powershell
# Runbook: Start-DelegatedVMs.ps1
param(
    [Parameter(Mandatory=$false)]
    [string]$TagName = "AutoStart",
    [Parameter(Mandatory=$false)]
    [string]$TagValue = "True"
)

# Authenticate using Managed Identity
Connect-AzAccount -Identity

# Get all delegated subscriptions
$subscriptions = Get-AzSubscription

foreach ($sub in $subscriptions) {
    Set-AzContext -SubscriptionId $sub.Id

    # Find VMs with specific tag
    $vms = Get-AzVM | Where-Object {
        $_.Tags[$TagName] -eq $TagValue
    }

    foreach ($vm in $vms) {
        Write-Output "Starting VM: $($vm.Name) in subscription $($sub.Name)"

        Start-AzVM -ResourceGroupName $vm.ResourceGroupName `
                   -Name $vm.Name -NoWait
    }
}
```

### Azure Policy at Scale

```powershell
# Apply policy to all delegated subscriptions
$policyDefinitionId = "/providers/Microsoft.Authorization/policyDefinitions/0015ea4d-51ff-4ce3-8d8c-f3f8f0179a56"

$subscriptions = Get-AzSubscription

foreach ($sub in $subscriptions) {
    Set-AzContext -SubscriptionId $sub.Id

    $existingAssignment = Get-AzPolicyAssignment -Name "DiagnosticSettings" -Scope "/subscriptions/$($sub.Id)" -ErrorAction SilentlyContinue

    if (-not $existingAssignment) {
        New-AzPolicyAssignment `
            -Name "DiagnosticSettings" `
            -DisplayName "Enable Diagnostic Settings" `
            -PolicyDefinition (Get-AzPolicyDefinition -Id $policyDefinitionId) `
            -Scope "/subscriptions/$($sub.Id)"

        Write-Output "Policy assigned to: $($sub.Name)"
    }
}
```

## Azure Functions for Multi-Tenant Operations

```csharp
using Azure.Identity;
using Azure.ResourceManager;
using Azure.ResourceManager.Compute;

public class CrossTenantVmService
{
    private readonly ArmClient _armClient;

    public CrossTenantVmService()
    {
        // Uses Managed Identity - works across delegated subscriptions
        _armClient = new ArmClient(new DefaultAzureCredential());
    }

    public async Task<IList<VmInfo>> GetAllVmsAsync()
    {
        var vms = new List<VmInfo>();

        await foreach (var subscription in _armClient.GetSubscriptions())
        {
            await foreach (var vm in subscription.GetVirtualMachinesAsync())
            {
                vms.Add(new VmInfo
                {
                    Name = vm.Data.Name,
                    SubscriptionId = subscription.Id,
                    ResourceGroup = vm.Id.ResourceGroupName,
                    Location = vm.Data.Location,
                    PowerState = vm.Data.InstanceView?.Statuses?
                        .FirstOrDefault(s => s.Code?.StartsWith("PowerState/") == true)?.Code
                });
            }
        }

        return vms;
    }

    public async Task StartVmAsync(string subscriptionId, string resourceGroup, string vmName)
    {
        var subscription = await _armClient.GetSubscriptions()
            .GetAsync(subscriptionId);

        var vm = await subscription.Value.GetResourceGroups()
            .GetAsync(resourceGroup)
            .Result.Value.GetVirtualMachines()
            .GetAsync(vmName);

        await vm.Value.PowerOnAsync(Azure.WaitUntil.Started);
    }
}

public record VmInfo
{
    public string Name { get; init; }
    public string SubscriptionId { get; init; }
    public string ResourceGroup { get; init; }
    public string Location { get; init; }
    public string PowerState { get; init; }
}
```

## Monitoring Delegated Resources

### Log Analytics Workspace Query

```kusto
// Query across all delegated workspaces
union withsource=SubscriptionId *
| where TimeGenerated > ago(24h)
| where Category == "Administrative"
| summarize EventCount = count() by SubscriptionId, OperationName
| order by EventCount desc
```

### Azure Monitor Alerts

```json
{
  "type": "Microsoft.Insights/scheduledQueryRules",
  "apiVersion": "2021-08-01",
  "name": "CrossTenantAlert",
  "location": "australiaeast",
  "properties": {
    "displayName": "Critical Events Across Tenants",
    "severity": 1,
    "enabled": true,
    "evaluationFrequency": "PT5M",
    "windowSize": "PT5M",
    "scopes": [
      "/subscriptions/{subscription-id}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/{workspace}"
    ],
    "criteria": {
      "allOf": [
        {
          "query": "AzureActivity | where Level == 'Critical' | summarize count() by SubscriptionId",
          "timeAggregation": "Count",
          "operator": "GreaterThan",
          "threshold": 0
        }
      ]
    },
    "actions": {
      "actionGroups": ["/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Insights/actionGroups/ops-team"]
    }
  }
}
```

## Best Practices

```markdown
1. **Use Azure AD Groups** - Assign roles to groups, not individuals
2. **Principle of Least Privilege** - Grant minimum required permissions
3. **Separate Environments** - Different delegations for prod/non-prod
4. **Audit Regularly** - Review delegation assignments
5. **Document Authorizations** - Maintain clear records
6. **Use Eligible Roles** - Enable PIM for sensitive operations
7. **Automate Onboarding** - Use templates for consistency
```

## Conclusion

Azure Lighthouse transforms multi-tenant management from a fragmented experience to a unified operational model. Whether you're a managed service provider or an enterprise with multiple subsidiaries, Lighthouse enables efficient, secure, and auditable cross-tenant operations. Combined with Azure Policy and automation, it provides the foundation for scalable governance.

## References

- [Azure Lighthouse Documentation](https://docs.microsoft.com/en-us/azure/lighthouse/)
- [Onboard Customers to Azure Lighthouse](https://docs.microsoft.com/en-us/azure/lighthouse/how-to/onboard-customer)

