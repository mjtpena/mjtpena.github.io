---
title: "Azure Arc-Enabled Servers: Manage Any Server from Azure"
author: Michael John Pena
draft: false
date: 2021-11-16
tags:
  - Azure
  - Azure Arc
  - Hybrid Cloud
  - Infrastructure
  - Management

---

I wrote "Azure Arc-Enabled Servers: Manage Any Server from Azure" to share practical, production-minded guidance on this topic.

## What is Azure Arc-Enabled Servers?

Arc-enabled servers project your non-Azure machines into Azure Resource Manager, enabling:

- **Unified management**: Single pane of glass for all servers
- **Azure Policy**: Enforce configurations across hybrid environments
- **Azure Monitor**: Centralized monitoring and alerting
- **Microsoft Defender**: Security posture across all machines

## Onboarding Servers

### Single Server Onboarding

Generate onboarding script from Azure portal or CLI:

```bash
# Download and run the onboarding script
curl -L https://aka.ms/azcmagent -o install_arc_agent.sh
chmod +x install_arc_agent.sh

# Run with your credentials
./install_arc_agent.sh \
    --tenant-id "your-tenant-id" \
    --subscription-id "your-subscription-id" \
    --resource-group "rg-arc-servers" \
    --location "eastus" \
    --service-principal-id "sp-client-id" \
    --service-principal-secret "sp-secret"
```

Windows PowerShell:

```powershell
# Download the agent
Invoke-WebRequest -Uri "https://aka.ms/AzureConnectedMachineAgent" -OutFile "AzureConnectedMachineAgent.msi"

# Install the agent
msiexec /i AzureConnectedMachineAgent.msi /qn

# Connect to Azure
& "$env:ProgramFiles\AzureConnectedMachineAgent\azcmagent.exe" connect `
    --tenant-id "your-tenant-id" `
    --subscription-id "your-subscription-id" `
    --resource-group "rg-arc-servers" `
    --location "eastus" `
    --service-principal-id "sp-client-id" `
    --service-principal-secret "sp-secret"
```

### At-Scale Onboarding

Use automation for multiple servers:

```powershell
# generate-onboarding-script.ps1
param(
    [string]$TenantId,
    [string]$SubscriptionId,
    [string]$ResourceGroup,
    [string]$Location,
    [string]$ServicePrincipalId,
    [string]$ServicePrincipalSecret,
    [string[]]$ServerList
)

# Create service principal for onboarding
$sp = az ad sp create-for-rbac `
    --name "arc-onboarding-sp" `
    --role "Azure Connected Machine Onboarding" `
    --scopes "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup"

$spInfo = $sp | ConvertFrom-Json

foreach ($server in $ServerList) {
    Write-Host "Onboarding $server..."

    Invoke-Command -ComputerName $server -ScriptBlock {
        param($TenantId, $SubscriptionId, $ResourceGroup, $Location, $SpId, $SpSecret)

        # Download and install agent
        Invoke-WebRequest -Uri "https://aka.ms/AzureConnectedMachineAgent" -OutFile "$env:TEMP\AzureConnectedMachineAgent.msi"
        msiexec /i "$env:TEMP\AzureConnectedMachineAgent.msi" /qn /l*v "$env:TEMP\arc_install.log"

        # Wait for installation
        Start-Sleep -Seconds 30

        # Connect to Azure
        & "$env:ProgramFiles\AzureConnectedMachineAgent\azcmagent.exe" connect `
            --tenant-id $TenantId `
            --subscription-id $SubscriptionId `
            --resource-group $ResourceGroup `
            --location $Location `
            --service-principal-id $SpId `
            --service-principal-secret $SpSecret

    } -ArgumentList $TenantId, $SubscriptionId, $ResourceGroup, $Location, $spInfo.appId, $spInfo.password
}
```

## Managing Arc Servers

### Using Azure CLI

```bash
# List all Arc-enabled servers
az connectedmachine list \
    --resource-group rg-arc-servers \
    --output table

# Get detailed information
az connectedmachine show \
    --name my-server \
    --resource-group rg-arc-servers

# Check agent status
az connectedmachine show \
    --name my-server \
    --resource-group rg-arc-servers \
    --query "status"

# Add tags
az connectedmachine update \
    --name my-server \
    --resource-group rg-arc-servers \
    --tags Environment=Production Role=WebServer
```

### Querying with Resource Graph

```bash
# Find all Arc servers by OS
az graph query -q "
    Resources
    | where type == 'microsoft.hybridcompute/machines'
    | summarize count() by tostring(properties.osName)
"

# Find servers not reporting
az graph query -q "
    Resources
    | where type == 'microsoft.hybridcompute/machines'
    | where properties.status != 'Connected'
    | project name, resourceGroup, properties.status, properties.lastStatusChange
"

# Servers without specific tag
az graph query -q "
    Resources
    | where type == 'microsoft.hybridcompute/machines'
    | where tags.Environment == ''
    | project name, resourceGroup, location
"
```

## Azure Policy for Hybrid

Apply policies across all servers:

```json
{
  "mode": "Indexed",
  "policyRule": {
    "if": {
      "allOf": [
        {
          "field": "type",
          "equals": "Microsoft.HybridCompute/machines"
        },
        {
          "field": "Microsoft.HybridCompute/machines/osType",
          "equals": "linux"
        }
      ]
    },
    "then": {
      "effect": "deployIfNotExists",
      "details": {
        "type": "Microsoft.HybridCompute/machines/extensions",
        "existenceCondition": {
          "allOf": [
            {
              "field": "Microsoft.HybridCompute/machines/extensions/type",
              "equals": "AzureMonitorLinuxAgent"
            },
            {
              "field": "Microsoft.HybridCompute/machines/extensions/provisioningState",
              "equals": "Succeeded"
            }
          ]
        },
        "roleDefinitionIds": [
          "/providers/Microsoft.Authorization/roleDefinitions/9980e02c-c2be-4d73-94e8-173b1dc7cf3c"
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
                }
              },
              "resources": [
                {
                  "type": "Microsoft.HybridCompute/machines/extensions",
                  "apiVersion": "2021-05-20",
                  "name": "[concat(parameters('vmName'), '/AzureMonitorLinuxAgent')]",
                  "location": "[parameters('location')]",
                  "properties": {
                    "publisher": "Microsoft.Azure.Monitor",
                    "type": "AzureMonitorLinuxAgent",
                    "autoUpgradeMinorVersion": true
                  }
                }
              ]
            }
          }
        }
      }
    }
  }
}
```

Assign the policy:

```bash
# Create policy definition
az policy definition create \
    --name "deploy-azure-monitor-agent-linux" \
    --display-name "Deploy Azure Monitor Agent on Arc-enabled Linux servers" \
    --mode Indexed \
    --rules @policy-rule.json

# Assign to resource group
az policy assignment create \
    --name "arc-monitor-agent" \
    --policy "deploy-azure-monitor-agent-linux" \
    --scope "/subscriptions/your-sub/resourceGroups/rg-arc-servers" \
    --mi-system-assigned \
    --location eastus
```

## Extensions for Arc Servers

### Deploy VM Extensions

```bash
# Install monitoring extension
az connectedmachine extension create \
    --machine-name my-server \
    --resource-group rg-arc-servers \
    --name AzureMonitorLinuxAgent \
    --type AzureMonitorLinuxAgent \
    --publisher Microsoft.Azure.Monitor \
    --auto-upgrade-minor-version true

# Install Custom Script extension
az connectedmachine extension create \
    --machine-name my-server \
    --resource-group rg-arc-servers \
    --name CustomScript \
    --type CustomScript \
    --publisher Microsoft.Azure.Extensions \
    --settings '{"commandToExecute": "apt-get update && apt-get install -y nginx"}'

# List installed extensions
az connectedmachine extension list \
    --machine-name my-server \
    --resource-group rg-arc-servers \
    --output table
```

### Bicep Template for Extensions

```bicep
param machineName string
param location string

resource arcMachine 'Microsoft.HybridCompute/machines@2021-05-20' existing = {
  name: machineName
}

resource monitoringExtension 'Microsoft.HybridCompute/machines/extensions@2021-05-20' = {
  parent: arcMachine
  name: 'AzureMonitorWindowsAgent'
  location: location
  properties: {
    publisher: 'Microsoft.Azure.Monitor'
    type: 'AzureMonitorWindowsAgent'
    autoUpgradeMinorVersion: true
  }
}

resource dependencyAgent 'Microsoft.HybridCompute/machines/extensions@2021-05-20' = {
  parent: arcMachine
  name: 'DependencyAgentWindows'
  location: location
  properties: {
    publisher: 'Microsoft.Azure.Monitoring.DependencyAgent'
    type: 'DependencyAgentWindows'
    autoUpgradeMinorVersion: true
  }
  dependsOn: [
    monitoringExtension
  ]
}
```

## Azure Monitor Integration

### Data Collection Rules

```json
{
  "location": "eastus",
  "properties": {
    "dataSources": {
      "performanceCounters": [
        {
          "name": "perfCounterDataSource",
          "streams": ["Microsoft-Perf"],
          "samplingFrequencyInSeconds": 60,
          "counterSpecifiers": [
            "\\Processor(_Total)\\% Processor Time",
            "\\Memory\\Available Bytes",
            "\\LogicalDisk(_Total)\\% Free Space",
            "\\Network Interface(*)\\Bytes Total/sec"
          ]
        }
      ],
      "syslog": [
        {
          "name": "syslogDataSource",
          "streams": ["Microsoft-Syslog"],
          "facilityNames": ["auth", "authpriv", "daemon", "syslog"],
          "logLevels": ["Warning", "Error", "Critical"]
        }
      ]
    },
    "destinations": {
      "logAnalytics": [
        {
          "workspaceResourceId": "/subscriptions/.../workspaces/my-workspace",
          "name": "la-destination"
        }
      ]
    },
    "dataFlows": [
      {
        "streams": ["Microsoft-Perf", "Microsoft-Syslog"],
        "destinations": ["la-destination"]
      }
    ]
  }
}
```

### KQL Queries for Arc Servers

```kql
// Arc server health overview
Heartbeat
| where ResourceType == "Microsoft.HybridCompute/machines"
| summarize LastHeartbeat = max(TimeGenerated) by Computer
| extend Status = iff(LastHeartbeat < ago(5m), "Offline", "Online")
| project Computer, LastHeartbeat, Status

// Performance across hybrid estate
Perf
| where ObjectName == "Processor" and CounterName == "% Processor Time"
| where Computer in (
    Resources
    | where type == "microsoft.hybridcompute/machines"
    | project name
)
| summarize AvgCPU = avg(CounterValue) by Computer, bin(TimeGenerated, 1h)
| render timechart

// Security events from Arc servers
SecurityEvent
| where Computer in (
    Resources
    | where type == "microsoft.hybridcompute/machines"
    | project name
)
| where EventID in (4624, 4625, 4648)  // Logon events
| summarize Count = count() by Computer, EventID
| render barchart
```

## Microsoft Defender Integration

Enable Defender for Cloud on Arc servers:

```bash
# Enable Defender for Servers
az security pricing create \
    --name VirtualMachines \
    --tier Standard

# Check Defender status on Arc server
az connectedmachine show \
    --name my-server \
    --resource-group rg-arc-servers \
    --query "identity"

# View security recommendations
az security recommendation list \
    --query "[?contains(resourceDetails.id, 'Microsoft.HybridCompute')]"
```

Security assessment query:

```kql
// Vulnerabilities on Arc servers
SecurityRecommendation
| where RecommendationName contains "vulnerability"
| where ResourceId contains "Microsoft.HybridCompute"
| project Computer = tostring(split(ResourceId, "/")[-1]),
          Recommendation = RecommendationName,
          Severity = RecommendationSeverity,
          State = RecommendationState
| where State != "Healthy"
```

Azure Arc-enabled servers bring Azure's management capabilities to your entire server estate, regardless of where those servers run. This unified management plane simplifies operations and improves security posture across hybrid environments.

## Resources

- [Azure Arc Documentation](https://docs.microsoft.com/en-us/azure/azure-arc/servers/overview)
- [Azure Arc Jumpstart](https://azurearcjumpstart.io/)
- [Arc-Enabled Servers Best Practices](https://docs.microsoft.com/en-us/azure/azure-arc/servers/manage-agent)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
