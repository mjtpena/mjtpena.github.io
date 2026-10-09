---
title: "Azure Resource Graph: Query All Your Azure Resources"
description: "Resource Graph is essential for understanding your Azure estate at scale."
author: Michael John Peña
draft: false
date: 2020-10-05
tags:
  - Azure
  - Resource Graph
  - KQL
  - Inventory
---

## Basic Queries

```kql
// All resources
Resources
| project name, type, location, resourceGroup

// Count by type
Resources
| summarize count() by type
| order by count_ desc

// VMs by size
Resources
| where type == 'microsoft.compute/virtualmachines'
| extend vmSize = properties.hardwareProfile.vmSize
| summarize count() by tostring(vmSize)
```

## Cross-Subscription Query

```kql
// Resources across all subscriptions
Resources
| where subscriptionId in ('sub1', 'sub2', 'sub3')
| summarize count() by subscriptionId
```

## Cost Optimization Queries

```kql
// Stopped VMs still incurring costs
Resources
| where type == 'microsoft.compute/virtualmachines'
| extend powerState = properties.extended.instanceView.powerState.code
| where powerState == 'PowerState/stopped'
| project name, resourceGroup, subscriptionId, powerState

// Unattached disks
Resources
| where type == 'microsoft.compute/disks'
| where managedBy == ''
| project name, resourceGroup, diskSizeGb = properties.diskSizeGB
```

## Security Queries

```kql
// Public IPs
Resources
| where type == 'microsoft.network/publicipaddresses'
| project name, ipAddress = properties.ipAddress, resourceGroup

// Storage accounts without HTTPS enforcement
Resources
| where type == 'microsoft.storage/storageaccounts'
| where properties.supportsHttpsTrafficOnly == false
| project name, resourceGroup
```

## Using in Scripts

```bash
# Azure CLI
az graph query -q "Resources | where type == 'microsoft.compute/virtualmachines' | count"

# PowerShell
Search-AzGraph -Query "Resources | summarize count() by location"
```

## Visualization

Resource Graph integrates with:
- Azure Workbooks for dashboards
- Power BI for executive reports
- Azure Monitor for alerting

Resource Graph is essential for understanding your Azure estate at scale.
