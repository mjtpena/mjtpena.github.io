---
title: "Azure Hybrid Benefit: Maximize Your Existing Microsoft Licenses"
description: "If you have Windows Server or SQL Server licenses with Software Assurance, you can bring them to Azure instead of paying for new licenses."
author: Michael John Peña
draft: false
date: 2022-01-09
tags:
  - Azure
  - Licensing
  - cost-optimization
  - hybrid-benefit
---

## Understanding Azure Hybrid Benefit

If you have Windows Server or SQL Server licenses with Software Assurance, you can bring them to Azure instead of paying for new licenses.

## Enabling for Windows Server VMs

```bicep
resource windowsVM 'Microsoft.Compute/virtualMachines@2021-11-01' = {
  name: 'windows-vm'
  location: location
  properties: {
    licenseType: 'Windows_Server'  // Enable Hybrid Benefit
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
      computerName: 'winvm'
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

## Enabling for SQL Server VMs

```bicep
resource sqlVM 'Microsoft.SqlVirtualMachine/sqlVirtualMachines@2021-11-01-preview' = {
  name: 'sql-vm'
  location: location
  properties: {
    virtualMachineResourceId: vm.id
    sqlServerLicenseType: 'AHUB'  // Azure Hybrid Benefit
    sqlManagement: 'Full'
    sqlImageSku: 'Enterprise'
  }
}
```

## Azure SQL Database with Hybrid Benefit

```bicep
resource sqlDatabase 'Microsoft.Sql/servers/databases@2021-11-01' = {
  parent: sqlServer
  name: 'mydb'
  location: location
  sku: {
    name: 'GP_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 4
  }
  properties: {
    licenseType: 'BasePrice'  // Hybrid Benefit - bring your own license
    // 'LicenseIncluded' for pay-as-you-go
  }
}
```

## Checking Hybrid Benefit Status

```powershell
# Check all VMs for Hybrid Benefit status
Get-AzVM | ForEach-Object {
    [PSCustomObject]@{
        Name = $_.Name
        ResourceGroup = $_.ResourceGroupName
        LicenseType = $_.LicenseType
        HybridBenefit = if ($_.LicenseType -eq 'Windows_Server') { 'Enabled' } else { 'Disabled' }
    }
} | Format-Table

# Enable Hybrid Benefit on existing VM
$vm = Get-AzVM -ResourceGroupName 'myRG' -Name 'myVM'
$vm.LicenseType = 'Windows_Server'
Update-AzVM -ResourceGroupName 'myRG' -VM $vm
```

## Azure Policy for Enforcement

Ensure all new VMs use Hybrid Benefit:

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
          "field": "Microsoft.Compute/virtualMachines/storageProfile.imageReference.publisher",
          "equals": "MicrosoftWindowsServer"
        },
        {
          "field": "Microsoft.Compute/virtualMachines/licenseType",
          "notEquals": "Windows_Server"
        }
      ]
    },
    "then": {
      "effect": "audit"
    }
  }
}
```

## License Counting

```powershell
# Count cores for licensing requirements
$vms = Get-AzVM | Where-Object { $_.LicenseType -eq 'Windows_Server' }

$totalCores = 0
foreach ($vm in $vms) {
    $vmSize = Get-AzVMSize -Location $vm.Location |
              Where-Object { $_.Name -eq $vm.HardwareProfile.VmSize }
    $totalCores += $vmSize.NumberOfCores
}

# Windows Server licenses cover 16 cores minimum per 2-pack
$licensesNeeded = [Math]::Ceiling($totalCores / 16) * 2
Write-Host "Total cores: $totalCores"
Write-Host "Licenses needed (2-packs): $licensesNeeded"
```

## Combining with Reserved Instances

You can stack Hybrid Benefit with Reserved Instances for maximum savings:

```
Pay-as-you-go:     $1000/month
With RIs (3-year): $400/month (60% savings)
With Hybrid:       $600/month (40% savings)
Both combined:     $240/month (76% savings!)
```

## Best Practices

1. **Audit existing licenses** - Work with your SAM team
2. **Track usage** - Ensure compliance
3. **Automate enablement** - Use policies
4. **Combine with RIs** - Stack discounts
5. **Review regularly** - License needs change

Azure Hybrid Benefit is one of the simplest ways to reduce Azure costs if you have existing Microsoft licenses.
