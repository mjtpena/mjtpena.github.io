---
title: "Azure Hybrid Benefit as Code: Only Claim Licences You Can Prove"
description: "Set Azure Hybrid Benefit in Bicep, audit it with Resource Graph and Azure Policy, and size core licences so the discount never becomes a compliance finding."
author: Michael John Peña
draft: false
date: 2022-01-09
tags:
  - Azure
  - Licensing
  - Cost Optimization
  - Governance
  - Bicep
---

Azure Hybrid Benefit is usually sold as a discount switch: flip `licenseType` and the Windows or SQL Server licence charge disappears from the bill. Anyone who signs off a Microsoft true-up should read it differently. Setting the flag is a declaration that you own eligible licences with Software Assurance (or qualifying subscriptions) and have assigned them to that workload. Get it right in code and you save money every hour; apply it blindly and you've built an audit finding into your landing zone.

I covered the basics and the savings maths in [Maximizing Value with Azure Hybrid Benefit](/blog/2021-02-27-azure-hybrid-benefit/). This post is about the engineering side: where the flag lives on each resource type (Windows Server and SQL Server in depth, Linux briefly), how to declare it in Bicep, how to see your whole estate's licence posture in one query, and how to stop the flag being set by people who can't prove the entitlement.

## What the flag actually means

Hybrid Benefit is not one setting. Each resource type exposes its own property with its own values, and each maps to different licence rules.

| Resource | Property | Hybrid Benefit value | Pay-as-you-go value |
|---|---|---|---|
| Virtual machine (Windows Server) | `licenseType` | `Windows_Server` | not set |
| Virtual machine (RHEL / SLES pay-as-you-go image) | `licenseType` | `RHEL_BYOS` / `SLES_BYOS` | not set (or `None`) |
| SQL Server on Azure VM (`Microsoft.SqlVirtualMachine`) | `sqlServerLicenseType` | `AHUB` (or `DR` for a passive replica) | `PAYG` |
| Azure SQL Database / Managed Instance (vCore) | `licenseType` | `BasePrice` | `LicenseIncluded` |

For RHEL and SLES, Hybrid Benefit converts a pay-as-you-go marketplace VM to your own Red Hat (Cloud Access) or SUSE subscription without redeploying. As of January 2022 it is available to all customers for pay-as-you-go RHEL and SLES marketplace images, but not for BYOS or custom images. Red Hat requires the Azure subscription to be enabled in Red Hat Cloud Access first, and SUSE subscriptions must be activated in the SUSE Customer Center for use in Azure ([Azure Hybrid Benefit for Linux](https://learn.microsoft.com/azure/virtual-machines/linux/azure-hybrid-benefit-linux)).

The licence rules behind those values, per the [Windows Server Hybrid Benefit documentation](https://learn.microsoft.com/azure/virtual-machines/windows/hybrid-use-benefit-licensing) and the [Azure SQL Hybrid Benefit documentation](https://learn.microsoft.com/azure/azure-sql/azure-hybrid-benefit):

- **Windows Server:** each set of 16 core licences (Standard or Datacenter, with Software Assurance) covers two VMs of up to 8 cores each, or one VM of up to 16 cores. Every VM needs at least 8 core licences, even a 2-vCPU one.
- **Datacenter vs Standard:** Datacenter licences can be used on-premises and in Azure at the same time. Standard licences are used in one place or the other, with 180 days of overlap allowed while you migrate.
- **SQL Server in Azure SQL Database and Managed Instance:** one Enterprise core with Software Assurance covers four General Purpose vCores or one Business Critical vCore. One Standard core covers one General Purpose vCore, and four Standard cores cover one Business Critical vCore. Serverless databases and DTU-based tiers aren't eligible.
- **SQL Server on Azure VMs:** licences map one core to one vCPU, with a four-core minimum per VM.
- **RHEL and SLES:** the entitlement is a subscription, not a pool of cores, so there is no per-core maths. What you track is which Red Hat or SUSE subscriptions back which VMs, and that each converted VM is registered with the vendor for updates.

The point of the table is that "Hybrid Benefit coverage" can't be a single percentage on a dashboard. A 2-vCPU Windows jump box consumes 8 core licences. A 4-vCore Business Critical database consumes 4 Enterprise cores, while the same size on General Purpose consumes 1. Those ratios should drive your design choices before anyone looks at the discount.

## Declaring it in Bicep

The flag belongs in the template next to the VM size, because the two are coupled: resizing a VM changes how many licences it consumes. This fragment shows the relevant properties on a Windows Server 2022 Datacenter: Azure Edition VM. It assumes `location`, `adminUsername`, `adminPassword` (as a `@secure()` parameter) and a network interface `nic` are declared elsewhere in the file.

```bicep
@description('Set to true only when a Windows Server licence with Software Assurance has been assigned to this VM.')
param useHybridBenefit bool = false

@description('Licence agreement or SA reference backing the claim')
param entitlementReference string = ''

resource windowsVm 'Microsoft.Compute/virtualMachines@2021-07-01' = {
  name: 'vm-app-01'
  location: location
  tags: {
    'ahb-entitlement': useHybridBenefit ? entitlementReference : 'none'
  }
  properties: {
    licenseType: useHybridBenefit ? 'Windows_Server' : null
    hardwareProfile: {
      vmSize: 'Standard_D4s_v3'
    }
    storageProfile: {
      imageReference: {
        publisher: 'MicrosoftWindowsServer'
        offer: 'WindowsServer'
        sku: '2022-datacenter-azure-edition'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
      }
    }
    osProfile: {
      computerName: 'vmapp01'
      adminUsername: adminUsername
      adminPassword: adminPassword
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: nic.id
        }
      ]
    }
  }
}
```

Two deliberate choices here. The parameter defaults to `false`, so the safe path is pay-as-you-go and someone has to opt in. And the tag records which agreement the licence came from, which is what your licensing team will ask for at true-up time. Treat the tag value as a reference, not a secret: an agreement number is enough. If someone sets `useHybridBenefit` but leaves `entitlementReference` empty, the tag is written as an empty string, and the policy later in this post treats that the same as a missing tag.

For SQL Server on a VM, the licence model lives on the SQL IaaS Agent extension's resource, not the VM. For Azure SQL Database it sits on the database (or elastic pool) itself:

```bicep
param location string = resourceGroup().location
param sqlServerName string = '<your-sql-server-name>'
param sqlVmName string = '<your-sql-vm-name>'

resource sqlServer 'Microsoft.Sql/servers@2021-02-01-preview' existing = {
  name: sqlServerName
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2021-02-01-preview' = {
  parent: sqlServer
  name: 'db-orders'
  location: location
  sku: {
    name: 'GP_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 4
  }
  properties: {
    licenseType: 'BasePrice'
  }
}

resource sqlVm 'Microsoft.SqlVirtualMachine/sqlVirtualMachines@2017-03-01-preview' = {
  name: sqlVmName
  location: location
  properties: {
    virtualMachineResourceId: resourceId('Microsoft.Compute/virtualMachines', sqlVmName)
    sqlServerLicenseType: 'AHUB'
    sqlManagement: 'LightWeight'
  }
}
```

The `sqlVirtualMachines` resource name has to match the VM name, and the VM must be running a SQL Server image or have SQL Server installed. If you deployed from a pay-as-you-go SQL Server marketplace image, switching to `AHUB` changes billing without redeploying; that's covered in [the SQL Server on Azure VM licence model guide](https://learn.microsoft.com/azure/azure-sql/virtual-machines/windows/licensing-model-azure-hybrid-benefit-ahb-change). I use `LightWeight` management mode here because it is enough to change the licence type and doesn't touch SQL Server; `Full` mode restarts the SQL Server service, so only switch to it inside a maintenance window. `sqlServerLicenseType` also accepts `DR` for a passive disaster-recovery secondary, which needs no licence of its own when the primary is covered by Software Assurance. Flag it as `DR` rather than `AHUB` so the replica doesn't consume cores from your pool.

## Seeing the whole estate in one query

Before you enforce anything, find out what is already claimed. Azure Resource Graph reads these properties across every subscription you can see, which beats looping over `Get-AzVM` per subscription:

```kusto
resources
| where type =~ 'microsoft.compute/virtualmachines'
| extend licenseType = tostring(properties.licenseType),
         vmSize = tostring(properties.hardwareProfile.vmSize),
         osType = tostring(properties.storageProfile.osDisk.osType),
         entitlement = tostring(tags['ahb-entitlement'])
| where osType =~ 'Windows'
| summarize vms = count() by licenseType, vmSize, hasEntitlementTag = isnotempty(entitlement) and entitlement != 'none'
| order by vms desc
```

Run it in the portal's Resource Graph Explorer or with `Search-AzGraph`. The interesting rows are `Windows_Server` with `hasEntitlementTag == false`: someone claimed the benefit and nobody recorded why. Swap the type to `microsoft.sqlvirtualmachine/sqlvirtualmachines` and project `properties.sqlServerLicenseType` to do the same for SQL VMs. For Linux, drop the `osType` filter and look for `licenseType in ('RHEL_BYOS', 'SLES_BYOS')`; those are the VMs whose Red Hat or SUSE subscriptions your team needs to account for.

## Turning vCPUs into licence demand

The query tells you what is flagged. Your licensing team needs to know how many core licences that consumes, applying the per-VM minimums. This PowerShell script uses the `Az.ResourceGraph` and `Az.Compute` modules and counts each Windows VM at the larger of its vCPU count or 8, rounded up to whole 2-core packs:

```powershell
# Requires: Install-Module Az.ResourceGraph, Az.Compute; Connect-AzAccount
$query = @"
resources
| where type =~ 'microsoft.compute/virtualmachines'
| where tostring(properties.licenseType) == 'Windows_Server'
| project name, location, vmSize = tostring(properties.hardwareProfile.vmSize)
"@

$vms = Search-AzGraph -Query $query -First 1000
$sizeCache = @{}
$totalLicences = 0

foreach ($vm in $vms) {
    if (-not $sizeCache.ContainsKey($vm.location)) {
        $sizeCache[$vm.location] = Get-AzVMSize -Location $vm.location
    }
    # Get-AzVMSize runs in the current subscription context; sizes not offered there come back empty.
    $size = $sizeCache[$vm.location] | Where-Object { $_.Name -eq $vm.vmSize }
    if (-not $size) {
        Write-Warning "Size $($vm.vmSize) not found in $($vm.location); counting the 8-core minimum, check it manually."
    }
    $vCpus = $size.NumberOfCores
    $needed = [Math]::Max(8, $vCpus)
    $needed = [Math]::Ceiling($needed / 2) * 2
    $totalLicences += $needed
    [PSCustomObject]@{ Name = $vm.name; Size = $vm.vmSize; vCPUs = $vCpus; CoreLicences = $needed }
}

Write-Host "Windows Server core licences claimed by Hybrid Benefit VMs: $totalLicences"
```

Treat the output as an estimate to reconcile with your licence records, not a compliance statement. It doesn't know which VMs are covered by Datacenter dual-use rights, and `-First 1000` caps the result, so a larger estate needs paging with `-SkipToken`. Any warnings about unknown sizes mean that VM was counted at the 8-core floor, which can understate demand.

## Enforcing it with Azure Policy

The common advice is a policy that audits every Windows VM *without* Hybrid Benefit. I'd do the opposite first. Missing a discount costs money; claiming licences you don't have costs money and credibility with your auditor. Audit the claims that have no recorded entitlement:

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
          "field": "Microsoft.Compute/licenseType",
          "equals": "Windows_Server"
        },
        {
          "anyOf": [
            {
              "field": "tags['ahb-entitlement']",
              "exists": "false"
            },
            {
              "field": "tags['ahb-entitlement']",
              "equals": ""
            },
            {
              "field": "tags['ahb-entitlement']",
              "equals": "none"
            }
          ]
        }
      ]
    },
    "then": {
      "effect": "audit"
    }
  }
}
```

`Microsoft.Compute/licenseType` is the policy alias for the VM property. Start with `audit`, clean up what it finds, then move to `deny` in subscriptions where your platform team controls deployments. Once claims are trustworthy, a second policy that audits Windows VMs *not* using the benefit becomes a useful savings report rather than a compliance hazard. The same rule works for Linux if you change the `licenseType` condition to `"in": ["RHEL_BYOS", "SLES_BYOS"]` and record the Red Hat or SUSE subscription in the tag. The [Azure Policy policy rule docs](https://learn.microsoft.com/azure/governance/policy/concepts/definition-structure-policy-rule#conditions) cover the `exists`, `equals` and `in` conditions used here.

## When not to switch it on

- **You can't name the licence.** If procurement can't confirm Software Assurance or subscription coverage for a specific pool of cores, leave the VM on pay-as-you-go. The licence-included rate is the price of certainty.
- **Small, short-lived VMs.** The 8-core minimum means a fleet of 2-vCPU build agents or test boxes burns licences four times faster than their size suggests. Pay-as-you-go is often the better use of those cores.
- **Standard licences still running on-premises.** Outside the 180-day migration window, a Standard licence can't be in both places. If the on-premises server hasn't been decommissioned, the Azure claim is a double use.
- **Serverless or DTU databases.** There's nothing to apply it to; move to provisioned vCore only if the workload justifies it, not to chase the benefit.

## The decision

Hybrid Benefit is worth having on every workload you can back with a licence, and it stacks with [Azure Reservations](/blog/2021-02-26-azure-reservations/), which discount the compute while Hybrid Benefit removes the licence charge. I covered sizing those commitments in [planning Azure reserved instances](/blog/2022-01-08-azure-reserved-instances-planning/). But design it as a controlled declaration: default off in templates, opt in with a recorded entitlement, report demand in core licences rather than VM counts, and audit unproven claims before you audit missed savings. That order keeps finance and your licensing team on the same side.
