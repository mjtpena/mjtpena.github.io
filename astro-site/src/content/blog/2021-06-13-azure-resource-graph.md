---
title: Azure Resource Graph for Cross-Subscription Queries
description: "Azure Resource Graph is the query service that answers \"what do we actually have in Azure?\" at enterprise scale in milliseconds. The ARM APIs query each…"
author: Michael John Peña
draft: false
date: 2021-06-13
url: /blog/azure-resource-graph/
tags:
  - Azure
  - Resource Graph
  - Governance
  - KQL
---

Azure Resource Graph is the query service that answers "what do we actually have in Azure?" at enterprise scale in milliseconds. The ARM APIs query each resource provider individually and can take minutes to paginate through large estates; Resource Graph indexes all resources centrally and queries KQL against that index. A query to find all storage accounts without HTTPS-only enforcement, across all subscriptions in a Management Group, returns in under a second. I use it for compliance reporting, security posture checks, and cost attribution queries that the Cost Management UI can't filter by resource-level tag combinations. The KQL you know from Log Analytics works here too.

## Getting Started

### Basic Queries with Azure CLI

```bash
# Query all virtual machines
az graph query -q "Resources | where type =~ 'microsoft.compute/virtualmachines'"

# Count resources by type
az graph query -q "Resources | summarize count() by type | order by count_ desc"

# Query specific subscriptions
az graph query -q "Resources | where type =~ 'microsoft.compute/virtualmachines'" \
  --subscriptions sub1-id sub2-id
```

### Basic Queries with PowerShell

```powershell
# Install module
Install-Module -Name Az.ResourceGraph

# Query all VMs
Search-AzGraph -Query "Resources | where type =~ 'microsoft.compute/virtualmachines'"

# Query across management groups
Search-AzGraph -Query "Resources | summarize count() by subscriptionId" `
  -ManagementGroup "mg-production"
```

## Resource Graph Query Language (KQL)

### Filtering Resources

```kusto
// Find VMs in specific region
Resources
| where type =~ 'microsoft.compute/virtualmachines'
| where location == 'australiaeast'
| project name, resourceGroup, location, properties.hardwareProfile.vmSize

// Find resources with specific tags
Resources
| where tags.Environment == 'Production'
| project name, type, resourceGroup, tags

// Find resources without required tags
Resources
| where isempty(tags.CostCenter)
| project name, type, resourceGroup, subscriptionId
```

### Joining Tables

```kusto
// Join VMs with their network interfaces
Resources
| where type =~ 'microsoft.compute/virtualmachines'
| extend nics = array_length(properties.networkProfile.networkInterfaces)
| mv-expand nic = properties.networkProfile.networkInterfaces
| extend nicId = tostring(nic.id)
| join kind=leftouter (
    Resources
    | where type =~ 'microsoft.network/networkinterfaces'
    | extend ipConfigs = properties.ipConfigurations
    | mv-expand ipConfig = ipConfigs
    | extend privateIp = ipConfig.properties.privateIPAddress
    | extend publicIpId = tostring(ipConfig.properties.publicIPAddress.id)
    | project nicId = id, privateIp, publicIpId
) on nicId
| project vmName = name, resourceGroup, privateIp, publicIpId
```

### Aggregations and Statistics

```kusto
// Resource count by subscription and type
Resources
| summarize ResourceCount = count() by subscriptionId, type
| order by ResourceCount desc

// Storage account sizes
Resources
| where type =~ 'microsoft.storage/storageaccounts'
| extend tier = properties.sku.tier
| summarize count() by tier

// VM sizes distribution
Resources
| where type =~ 'microsoft.compute/virtualmachines'
| extend vmSize = tostring(properties.hardwareProfile.vmSize)
| summarize count() by vmSize
| order by count_ desc
```

## Advanced Query Patterns

### Security and Compliance

```kusto
// Find public IP addresses
Resources
| where type =~ 'microsoft.network/publicipaddresses'
| extend ipAddress = properties.ipAddress
| project name, resourceGroup, subscriptionId, ipAddress

// Find storage accounts with public access
Resources
| where type =~ 'microsoft.storage/storageaccounts'
| where properties.allowBlobPublicAccess == true
| project name, resourceGroup, subscriptionId

// Find VMs without disk encryption
Resources
| where type =~ 'microsoft.compute/virtualmachines'
| extend
    osDisk = properties.storageProfile.osDisk,
    dataDisks = properties.storageProfile.dataDisks
| where isnull(osDisk.encryptionSettings) or osDisk.encryptionSettings.enabled == false
| project name, resourceGroup, subscriptionId

// Find SQL servers without Azure AD admin
Resources
| where type =~ 'microsoft.sql/servers'
| where isnull(properties.administrators.azureADOnlyAuthentication)
    or properties.administrators.azureADOnlyAuthentication == false
| project name, resourceGroup, subscriptionId
```

### Cost Optimization

```kusto
// Find unattached disks
Resources
| where type =~ 'microsoft.compute/disks'
| where managedBy == ''
| extend diskSizeGB = properties.diskSizeGB
| extend diskState = properties.diskState
| where diskState == 'Unattached'
| project name, resourceGroup, subscriptionId, diskSizeGB
| order by diskSizeGB desc

// Find stopped VMs (still incurring storage costs)
Resources
| where type =~ 'microsoft.compute/virtualmachines'
| extend powerState = tostring(properties.extended.instanceView.powerState.code)
| where powerState == 'PowerState/deallocated'
| project name, resourceGroup, subscriptionId

// Find unused public IPs
Resources
| where type =~ 'microsoft.network/publicipaddresses'
| where isnull(properties.ipConfiguration)
| project name, resourceGroup, subscriptionId
```

### Networking

```kusto
// Find all subnets with their address ranges
Resources
| where type =~ 'microsoft.network/virtualnetworks'
| mv-expand subnet = properties.subnets
| extend subnetName = subnet.name
| extend addressPrefix = subnet.properties.addressPrefix
| project vnetName = name, subnetName, addressPrefix, resourceGroup

// Find NSG rules allowing inbound from internet
Resources
| where type =~ 'microsoft.network/networksecuritygroups'
| mv-expand rule = properties.securityRules
| where rule.properties.direction == 'Inbound'
| where rule.properties.sourceAddressPrefix in ('*', 'Internet')
| where rule.properties.access == 'Allow'
| project nsgName = name, ruleName = rule.name,
    destinationPort = rule.properties.destinationPortRange,
    resourceGroup, subscriptionId
```

## Using Resource Graph with C#

```csharp
using Azure.Identity;
using Azure.ResourceManager;
using Azure.ResourceManager.ResourceGraph;
using Azure.ResourceManager.ResourceGraph.Models;

public class ResourceGraphService
{
    private readonly ArmClient _armClient;

    public ResourceGraphService()
    {
        _armClient = new ArmClient(new DefaultAzureCredential());
    }

    public async Task<IList<IDictionary<string, object>>> QueryResourcesAsync(
        string query,
        IEnumerable<string>? subscriptionIds = null)
    {
        var tenantResource = _armClient.GetTenants().First();

        var queryContent = new ResourceQueryContent(query);

        if (subscriptionIds != null)
        {
            foreach (var subId in subscriptionIds)
            {
                queryContent.Subscriptions.Add(subId);
            }
        }

        var response = await tenantResource.GetResourcesAsync(queryContent);

        var results = new List<IDictionary<string, object>>();

        if (response.Value.Data is IEnumerable<object> rows)
        {
            foreach (var row in rows)
            {
                if (row is IDictionary<string, object> dict)
                {
                    results.Add(dict);
                }
            }
        }

        return results;
    }
}

// Usage
var service = new ResourceGraphService();

// Find all VMs
var vms = await service.QueryResourcesAsync(
    @"Resources
      | where type =~ 'microsoft.compute/virtualmachines'
      | project name, resourceGroup, location");

// Find non-compliant resources
var nonCompliant = await service.QueryResourcesAsync(
    @"Resources
      | where isempty(tags.CostCenter)
      | project name, type, resourceGroup");
```

## Integration with Azure Functions

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Azure.Identity;
using Azure.ResourceManager;
using Azure.ResourceManager.ResourceGraph;
using Azure.ResourceManager.ResourceGraph.Models;

public class ComplianceFunction
{
    [Function("CheckCompliance")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Function, "get")] HttpRequestData req)
    {
        var armClient = new ArmClient(new DefaultAzureCredential());
        var tenant = armClient.GetTenants().First();

        var query = @"
            Resources
            | where isempty(tags.Environment) or isempty(tags.CostCenter)
            | project name, type, resourceGroup, subscriptionId, tags
            | limit 100";

        var queryContent = new ResourceQueryContent(query);
        var result = await tenant.GetResourcesAsync(queryContent);

        var response = req.CreateResponse(System.Net.HttpStatusCode.OK);
        await response.WriteAsJsonAsync(result.Value.Data);

        return response;
    }
}
```

## Resource Graph in Azure Policy

```json
{
  "mode": "All",
  "policyRule": {
    "if": {
      "allOf": [
        {
          "field": "type",
          "equals": "Microsoft.Compute/virtualMachines"
        },
        {
          "field": "tags['Environment']",
          "exists": "false"
        }
      ]
    },
    "then": {
      "effect": "audit"
    }
  },
  "metadata": {
    "category": "Tags"
  }
}
```

## Scheduled Compliance Reports

```powershell
# PowerShell script for scheduled compliance check
$query = @"
Resources
| where isempty(tags.CostCenter)
| summarize NonCompliantCount = count() by type, subscriptionId
| order by NonCompliantCount desc
"@

$results = Search-AzGraph -Query $query

# Export to CSV
$results | Export-Csv -Path "compliance-report-$(Get-Date -Format 'yyyy-MM-dd').csv"

# Send email alert if non-compliant resources found
if ($results.Count -gt 0) {
    $body = $results | ConvertTo-Html -Fragment
    # Send email via Logic App or SendGrid
}
```

## Conclusion

Azure Resource Graph transforms how you explore and govern Azure resources. The ability to query across subscriptions instantly enables real-time compliance checking, cost optimization, and security auditing. By combining Resource Graph with Azure Functions or Logic Apps, you can build automated governance solutions that scale across your entire Azure estate.

## References

- [Azure Resource Graph Documentation](https://docs.microsoft.com/en-us/azure/governance/resource-graph/)
- [KQL Quick Reference](https://docs.microsoft.com/en-us/azure/data-explorer/kql-quick-reference)
