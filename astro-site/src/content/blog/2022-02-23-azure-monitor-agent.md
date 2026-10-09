---
title: "Azure Monitor Agent: The Future of Azure Monitoring"
description: "Azure Monitor Agent provides a unified, secure, and flexible foundation for all monitoring needs."
author: Michael John Peña
draft: false
date: 2022-02-23
url: /blog/azure-monitor-agent/
tags:
  - Azure
  - Monitoring
  - Agents
  - Observability
---

## Why Azure Monitor Agent?

AMA replaces:
- Log Analytics agent (MMA/OMS)
- Diagnostics extension (WAD/LAD)
- Telegraf agent

Benefits:
- Single agent for all data collection
- Data Collection Rules for configuration
- Enhanced security (managed identity)
- Better performance and reliability

## Installing AMA

### Via Bicep

```bicep
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
    settings: {
      authentication: {
        managedIdentity: {
          'identifier-name': 'mi_res_id'
          'identifier-value': userAssignedIdentity.id
        }
      }
    }
  }
}

// Linux version
resource amaLinuxExtension 'Microsoft.Compute/virtualMachines/extensions@2021-11-01' = {
  parent: linuxVM
  name: 'AzureMonitorLinuxAgent'
  location: location
  properties: {
    publisher: 'Microsoft.Azure.Monitor'
    type: 'AzureMonitorLinuxAgent'
    typeHandlerVersion: '1.0'
    autoUpgradeMinorVersion: true
    enableAutomaticUpgrade: true
  }
}
```

### Via Azure Policy

```json
{
  "displayName": "Deploy Azure Monitor Agent to Windows VMs",
  "policyType": "BuiltIn",
  "mode": "Indexed",
  "parameters": {
    "effect": {
      "type": "String",
      "defaultValue": "DeployIfNotExists"
    }
  },
  "policyRule": {
    "if": {
      "allOf": [
        {
          "field": "type",
          "equals": "Microsoft.Compute/virtualMachines"
        },
        {
          "field": "Microsoft.Compute/virtualMachines/storageProfile.osDisk.osType",
          "equals": "Windows"
        }
      ]
    },
    "then": {
      "effect": "[parameters('effect')]",
      "details": {
        "type": "Microsoft.Compute/virtualMachines/extensions",
        "existenceCondition": {
          "allOf": [
            {
              "field": "Microsoft.Compute/virtualMachines/extensions/type",
              "equals": "AzureMonitorWindowsAgent"
            },
            {
              "field": "Microsoft.Compute/virtualMachines/extensions/publisher",
              "equals": "Microsoft.Azure.Monitor"
            },
            {
              "field": "Microsoft.Compute/virtualMachines/extensions/provisioningState",
              "equals": "Succeeded"
            }
          ]
        },
        "roleDefinitionIds": [
          "/providers/microsoft.authorization/roleDefinitions/9980e02c-c2be-4d73-94e8-173b1dc7cf3c"
        ],
        "deployment": {
          "properties": {
            "mode": "incremental",
            "template": {
              // ARM template for extension deployment
            }
          }
        }
      }
    }
  }
}
```

## Complete DCR for AMA

```bicep
resource comprehensiveDCR 'Microsoft.Insights/dataCollectionRules@2021-09-01-preview' = {
  name: 'dcr-comprehensive-monitoring'
  location: location
  kind: 'Windows'
  properties: {
    dataSources: {
      windowsEventLogs: [
        {
          name: 'applicationEvents'
          streams: ['Microsoft-Event']
          xPathQueries: [
            'Application!*[System[(Level=1 or Level=2 or Level=3 or Level=4)]]'
          ]
        }
        {
          name: 'systemEvents'
          streams: ['Microsoft-Event']
          xPathQueries: [
            'System!*[System[(Level=1 or Level=2 or Level=3)]]'
          ]
        }
        {
          name: 'securityEvents'
          streams: ['Microsoft-SecurityEvent']
          xPathQueries: [
            'Security!*[System[(EventID=4624 or EventID=4625 or EventID=4648 or EventID=4672)]]'
          ]
        }
      ]
      performanceCounters: [
        {
          name: 'vmPerformance'
          streams: ['Microsoft-Perf']
          samplingFrequencyInSeconds: 60
          counterSpecifiers: [
            '\\Processor Information(_Total)\\% Processor Time'
            '\\Processor Information(_Total)\\% Privileged Time'
            '\\Memory\\Available Bytes'
            '\\Memory\\% Committed Bytes In Use'
            '\\Memory\\Page Faults/sec'
            '\\LogicalDisk(_Total)\\% Disk Time'
            '\\LogicalDisk(_Total)\\% Free Space'
            '\\LogicalDisk(_Total)\\Disk Read Bytes/sec'
            '\\LogicalDisk(_Total)\\Disk Write Bytes/sec'
            '\\Network Interface(*)\\Bytes Total/sec'
          ]
        }
      ]
      iisLogs: [
        {
          name: 'iisLogs'
          streams: ['Microsoft-W3CIISLog']
          logDirectories: [
            'C:\\inetpub\\logs\\LogFiles\\W3SVC1'
          ]
        }
      ]
    }
    destinations: {
      logAnalytics: [
        {
          workspaceResourceId: logAnalyticsWorkspace.id
          name: 'workspace'
        }
      ]
      azureMonitorMetrics: {
        name: 'azureMonitor'
      }
    }
    dataFlows: [
      {
        streams: [
          'Microsoft-Event'
          'Microsoft-SecurityEvent'
        ]
        destinations: ['workspace']
      }
      {
        streams: ['Microsoft-Perf']
        destinations: ['workspace', 'azureMonitor']
      }
      {
        streams: ['Microsoft-W3CIISLog']
        destinations: ['workspace']
      }
    ]
  }
}
```

## Migration from Legacy Agents

```powershell
# Check current agents
$vms = Get-AzVM
foreach ($vm in $vms) {
    $extensions = Get-AzVMExtension -ResourceGroupName $vm.ResourceGroupName -VMName $vm.Name

    $legacyAgent = $extensions | Where-Object {
        $_.ExtensionType -eq 'MicrosoftMonitoringAgent' -or
        $_.ExtensionType -eq 'OmsAgentForLinux'
    }

    $ama = $extensions | Where-Object {
        $_.ExtensionType -eq 'AzureMonitorWindowsAgent' -or
        $_.ExtensionType -eq 'AzureMonitorLinuxAgent'
    }

    [PSCustomObject]@{
        VMName = $vm.Name
        ResourceGroup = $vm.ResourceGroupName
        LegacyAgent = if ($legacyAgent) { $legacyAgent.ExtensionType } else { 'None' }
        AMA = if ($ama) { $ama.ExtensionType } else { 'None' }
        MigrationStatus = if ($ama -and -not $legacyAgent) { 'Complete' }
                         elseif ($ama -and $legacyAgent) { 'Parallel' }
                         else { 'Pending' }
    }
}
```

## Troubleshooting AMA

```powershell
# Check AMA status on Windows
Get-Service -Name 'AzureMonitorAgent'

# View AMA logs
Get-WinEvent -LogName 'Microsoft-AzureMonitor-Agent/Operational' -MaxEvents 50

# Test connectivity
Test-NetConnection -ComputerName 'global.handler.control.monitor.azure.com' -Port 443
```

```bash
# Check AMA status on Linux
systemctl status azuremonitoragent

# View logs
journalctl -u azuremonitoragent -n 100

# Configuration location
cat /etc/opt/microsoft/azuremonitoragent/config-cache/configchunks/*
```

Azure Monitor Agent provides a unified, secure, and flexible foundation for all monitoring needs.
