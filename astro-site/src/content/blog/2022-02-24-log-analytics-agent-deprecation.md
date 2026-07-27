---
title: "Log Analytics Agent Deprecation: Migration Planning"
author: Michael John Peña
draft: false
date: 2022-02-24
url: /blog/log-analytics-agent-deprecation/
tags:
  - azure
  - monitoring
  - migration
  - deprecation

---

I wrote "Log Analytics Agent Deprecation: Migration Planning" to share practical, production-minded guidance on this topic.

## Deprecation Timeline

- **Now**: Azure Monitor Agent is GA and recommended
- **August 2024**: Log Analytics agent will be retired
- **Action Required**: Migrate all workloads to AMA

## Identifying Affected Resources

```kusto
// Find VMs using legacy agent
Heartbeat
| where TimeGenerated > ago(7d)
| where Category == "Direct Agent"
| distinct Computer, OSType, Version
| extend AgentType = case(
    Version contains "10.20", "MMA",
    Version contains "1.13", "OMS Linux",
    "Unknown"
)
| project Computer, OSType, AgentType, Version
```

```powershell
# Inventory script
$results = @()

Get-AzSubscription | ForEach-Object {
    Set-AzContext -SubscriptionId $_.Id | Out-Null

    Get-AzVM | ForEach-Object {
        $vm = $_
        $extensions = Get-AzVMExtension -ResourceGroupName $vm.ResourceGroupName -VMName $vm.Name

        $mma = $extensions | Where-Object { $_.ExtensionType -eq 'MicrosoftMonitoringAgent' }
        $oms = $extensions | Where-Object { $_.ExtensionType -eq 'OmsAgentForLinux' }
        $ama = $extensions | Where-Object {
            $_.ExtensionType -eq 'AzureMonitorWindowsAgent' -or
            $_.ExtensionType -eq 'AzureMonitorLinuxAgent'
        }

        $results += [PSCustomObject]@{
            Subscription = $_.Name
            ResourceGroup = $vm.ResourceGroupName
            VMName = $vm.Name
            OS = $vm.StorageProfile.OsDisk.OsType
            HasMMA = [bool]$mma
            HasOMS = [bool]$oms
            HasAMA = [bool]$ama
            NeedsMigration = ([bool]$mma -or [bool]$oms) -and -not [bool]$ama
        }
    }
}

$results | Where-Object { $_.NeedsMigration } | Export-Csv "migration-required.csv"
```

## Feature Parity Check

| Feature | MMA/OMS | AMA | Notes |
|---------|---------|-----|-------|
| Performance counters | Yes | Yes | DCR-based |
| Event logs | Yes | Yes | DCR-based |
| Syslog | Yes | Yes | DCR-based |
| Custom logs | Yes | Yes | Custom tables |
| IIS logs | Yes | Yes | DCR-based |
| Change tracking | Yes | Yes | Via solutions |
| Update management | Yes | Yes | Via solutions |
| Sentinel | Yes | Yes | Full support |
| VM Insights | Yes | Yes | Full support |

## Migration Steps

### Step 1: Deploy AMA in Parallel

```bicep
// Deploy AMA alongside existing agent
resource amaExtension 'Microsoft.Compute/virtualMachines/extensions@2021-11-01' = {
  parent: virtualMachine
  name: 'AzureMonitorWindowsAgent'
  location: location
  properties: {
    publisher: 'Microsoft.Azure.Monitor'
    type: 'AzureMonitorWindowsAgent'
    typeHandlerVersion: '1.0'
    autoUpgradeMinorVersion: true
    enableAutomaticUpgrade: true
  }
}

// Create DCR for same data collection
resource migrationDCR 'Microsoft.Insights/dataCollectionRules@2021-09-01-preview' = {
  name: 'dcr-migration'
  location: location
  properties: {
    // Mirror existing MMA configuration
    dataSources: {
      performanceCounters: [
        {
          name: 'perfCounters'
          streams: ['Microsoft-Perf']
          samplingFrequencyInSeconds: 60
          counterSpecifiers: [
            '\\Processor(_Total)\\% Processor Time'
            '\\Memory\\Available MBytes'
            '\\LogicalDisk(_Total)\\% Free Space'
          ]
        }
      ]
      windowsEventLogs: [
        {
          name: 'eventLogs'
          streams: ['Microsoft-Event']
          xPathQueries: [
            'Application!*[System[(Level=1 or Level=2 or Level=3)]]'
            'System!*[System[(Level=1 or Level=2 or Level=3)]]'
          ]
        }
      ]
    }
    destinations: {
      logAnalytics: [
        {
          workspaceResourceId: existingWorkspace.id
          name: 'workspace'
        }
      ]
    }
    dataFlows: [
      {
        streams: ['Microsoft-Perf', 'Microsoft-Event']
        destinations: ['workspace']
      }
    ]
  }
}
```

### Step 2: Validate Data Collection

```kusto
// Compare data from both agents
let MMAData = Perf
| where TimeGenerated > ago(1h)
| where _ResourceId has "Microsoft.Compute/virtualMachines"
| summarize MMA_AvgValue = avg(CounterValue) by Computer, CounterName;

let AMAData = Perf
| where TimeGenerated > ago(1h)
| where _ResourceId has "Microsoft.Insights/dataCollectionRules"
| summarize AMA_AvgValue = avg(CounterValue) by Computer, CounterName;

MMAData
| join kind=fullouter AMAData on Computer, CounterName
| extend Difference = abs(MMA_AvgValue - AMA_AvgValue)
| where Difference > 0.1 or isempty(MMA_AvgValue) or isempty(AMA_AvgValue)
```

### Step 3: Remove Legacy Agent

```powershell
# Remove MMA from a VM (after validation)
Remove-AzVMExtension `
    -ResourceGroupName $resourceGroup `
    -VMName $vmName `
    -Name "MicrosoftMonitoringAgent" `
    -Force

# Remove OMS from Linux VM
Remove-AzVMExtension `
    -ResourceGroupName $resourceGroup `
    -VMName $vmName `
    -Name "OmsAgentForLinux" `
    -Force
```

## Automation Script

```powershell
# Automated migration script
param(
    [Parameter(Mandatory)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory)]
    [string]$DataCollectionRuleId,

    [switch]$RemoveLegacyAgent
)

$vms = Get-AzVM -ResourceGroupName $ResourceGroupName

foreach ($vm in $vms) {
    Write-Host "Processing: $($vm.Name)"

    # Deploy AMA
    $amaParams = @{
        ResourceGroupName = $vm.ResourceGroupName
        VMName = $vm.Name
        Name = if ($vm.StorageProfile.OsDisk.OsType -eq 'Windows') {
            'AzureMonitorWindowsAgent'
        } else {
            'AzureMonitorLinuxAgent'
        }
        Publisher = 'Microsoft.Azure.Monitor'
        ExtensionType = if ($vm.StorageProfile.OsDisk.OsType -eq 'Windows') {
            'AzureMonitorWindowsAgent'
        } else {
            'AzureMonitorLinuxAgent'
        }
        TypeHandlerVersion = '1.0'
        EnableAutomaticUpgrade = $true
    }

    Set-AzVMExtension @amaParams

    # Associate DCR
    $dcrAssociation = New-AzDataCollectionRuleAssociation `
        -TargetResourceId $vm.Id `
        -AssociationName "dcr-association" `
        -RuleId $DataCollectionRuleId

    if ($RemoveLegacyAgent) {
        # Remove legacy agent after AMA is confirmed working
        Start-Sleep -Seconds 300  # Wait for AMA to start collecting

        $legacyExtension = Get-AzVMExtension -ResourceGroupName $vm.ResourceGroupName -VMName $vm.Name |
            Where-Object { $_.ExtensionType -in @('MicrosoftMonitoringAgent', 'OmsAgentForLinux') }

        if ($legacyExtension) {
            Remove-AzVMExtension `
                -ResourceGroupName $vm.ResourceGroupName `
                -VMName $vm.Name `
                -Name $legacyExtension.Name `
                -Force
        }
    }
}
```

Plan your migration early to ensure a smooth transition before the deprecation deadline.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
