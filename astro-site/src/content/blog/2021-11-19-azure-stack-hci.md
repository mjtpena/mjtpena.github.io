---
title: "Azure Stack HCI: Hyperconverged Infrastructure with Azure Integration"
description: "Azure Stack HCI provides a modern hyperconverged infrastructure platform with deep Azure integration. It's ideal for organizations that need on-premises…"
author: Michael John Pena
draft: false
date: 2021-11-19
tags:
  - Azure
  - Azure Stack
  - HCI
  - Hybrid Cloud
  - Infrastructure
---

## What is Azure Stack HCI?

Azure Stack HCI provides:

- **Hyperconverged infrastructure**: Compute, storage, and networking in one solution
- **Azure integration**: Manage from Azure portal
- **Hybrid workloads**: Run VMs, containers, and Azure services on-premises
- **Stretched clusters**: Multi-site deployments for disaster recovery

## Architecture Overview

```plaintext
                    ┌─────────────────────────────────────────┐
                    │              Azure Cloud                 │
                    │  ┌─────────────┐  ┌─────────────────┐   │
                    │  │ Azure Portal│  │ Azure Arc       │   │
                    │  └─────────────┘  └─────────────────┘   │
                    │  ┌─────────────┐  ┌─────────────────┐   │
                    │  │ Azure Update│  │ Azure Monitor   │   │
                    │  │ Management  │  │                 │   │
                    │  └─────────────┘  └─────────────────┘   │
                    └───────────────────▲──────────────────────┘
                                        │ Azure Arc
                    ┌───────────────────┼──────────────────────┐
                    │   Azure Stack HCI Cluster                │
                    │  ┌────────────────┴─────────────────────┐│
                    │  │    Windows Admin Center              ││
                    │  └──────────────────────────────────────┘│
                    │  ┌──────────┐ ┌──────────┐ ┌──────────┐  │
                    │  │  Node 1  │ │  Node 2  │ │  Node 3  │  │
                    │  │  ┌────┐  │ │  ┌────┐  │ │  ┌────┐  │  │
                    │  │  │VMs │  │ │  │VMs │  │ │  │VMs │  │  │
                    │  │  └────┘  │ │  └────┘  │ │  └────┘  │  │
                    │  │ Storage │ │ Storage  │ │ Storage  │  │
                    │  │ Spaces  │ │ Spaces   │ │ Spaces   │  │
                    │  │ Direct  │ │ Direct   │ │ Direct   │  │
                    │  └──────────┘ └──────────┘ └──────────┘  │
                    └─────────────────────────────────────────┘
```

## Registering with Azure

### Register the Cluster

```powershell
# Install required modules
Install-Module -Name Az.StackHCI

# Register cluster with Azure
Register-AzStackHCI `
    -SubscriptionId "your-subscription-id" `
    -ResourceName "hci-cluster-01" `
    -ResourceGroupName "rg-azure-stack-hci" `
    -Region "eastus" `
    -TenantId "your-tenant-id"

# Verify registration
Get-AzStackHCI
```

### Enable Azure Services

```powershell
# Enable Azure Arc integration
Enable-AzStackHCIArcIntegration `
    -ResourceGroupName "rg-azure-stack-hci"

# Enable Azure Kubernetes Service
Install-AksHci

# Enable Azure Benefits (Extended Security Updates, etc.)
Set-AzStackHCI `
    -EnableAzureArcServer $true `
    -DiagnosticLevel Full
```

## Deploying Virtual Machines

### PowerShell VM Management

```powershell
# Create a new VM
$VMName = "web-server-01"
$VMPath = "C:\ClusterStorage\Volume1\VMs"

New-VM `
    -Name $VMName `
    -Generation 2 `
    -MemoryStartupBytes 4GB `
    -NewVHDPath "$VMPath\$VMName\$VMName.vhdx" `
    -NewVHDSizeBytes 100GB `
    -SwitchName "ConvergedSwitch"

# Configure VM
Set-VM -Name $VMName `
    -ProcessorCount 4 `
    -DynamicMemory `
    -MemoryMinimumBytes 2GB `
    -MemoryMaximumBytes 8GB

# Enable nested virtualization (for AKS-HCI)
Set-VMProcessor -VMName $VMName `
    -ExposeVirtualizationExtensions $true

# Add VM to cluster
Add-ClusterVirtualMachineRole `
    -VMName $VMName `
    -Cluster "hci-cluster"

# Start VM
Start-VM -Name $VMName
```

### ARM Templates for VMs

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "customLocationId": {
      "type": "string",
      "metadata": {
        "description": "Azure Stack HCI custom location ID"
      }
    },
    "vmName": {
      "type": "string"
    }
  },
  "resources": [
    {
      "type": "Microsoft.AzureStackHCI/virtualMachines",
      "apiVersion": "2021-09-01-preview",
      "name": "[parameters('vmName')]",
      "location": "eastus",
      "extendedLocation": {
        "type": "CustomLocation",
        "name": "[parameters('customLocationId')]"
      },
      "properties": {
        "hardwareProfile": {
          "vmSize": "Standard_D4s_v3",
          "processors": 4,
          "memoryGB": 16
        },
        "storageProfile": {
          "imageReference": {
            "name": "Windows Server 2022 Datacenter"
          },
          "osDisk": {
            "createOption": "FromImage",
            "diskSizeGB": 127
          },
          "dataDisks": [
            {
              "createOption": "Empty",
              "diskSizeGB": 256
            }
          ]
        },
        "osProfile": {
          "computerName": "[parameters('vmName')]",
          "adminUsername": "azureuser",
          "adminPassword": "[parameters('adminPassword')]"
        },
        "networkProfile": {
          "networkInterfaces": [
            {
              "name": "[concat(parameters('vmName'), '-nic')]"
            }
          ]
        }
      }
    }
  ]
}
```

## Azure Kubernetes Service on HCI

### Deploy AKS-HCI

```powershell
# Initialize AKS-HCI
Initialize-AksHciNode

# Configure networking
$vnet = New-AksHciNetworkSetting `
    -name "aksnet" `
    -vSwitchName "ConvergedSwitch" `
    -k8sNodeIpPoolStart "10.0.1.100" `
    -k8sNodeIpPoolEnd "10.0.1.200" `
    -vipPoolStart "10.0.1.201" `
    -vipPoolEnd "10.0.1.250" `
    -ipAddressPrefix "10.0.1.0/24" `
    -gateway "10.0.1.1" `
    -dnsServers "10.0.1.10"

# Set configuration
Set-AksHciConfig `
    -imageDir "C:\ClusterStorage\Volume1\AKS\Images" `
    -workingDir "C:\ClusterStorage\Volume1\AKS\Working" `
    -cloudConfigLocation "C:\ClusterStorage\Volume1\AKS\Config" `
    -vnet $vnet

# Install AKS-HCI management cluster
Install-AksHci

# Create workload cluster
New-AksHciCluster `
    -name "aks-workload-01" `
    -nodePoolName "nodepool1" `
    -nodeCount 3 `
    -osType Linux `
    -nodeVmSize Standard_D4s_v3

# Get kubeconfig
Get-AksHciCredential -name "aks-workload-01"
```

### Connect to Azure Arc

```powershell
# Enable Arc for AKS-HCI cluster
Enable-AksHciArcConnection `
    -name "aks-workload-01" `
    -resourceGroup "rg-arc-kubernetes" `
    -location "eastus" `
    -subscriptionId "your-subscription-id" `
    -tenantId "your-tenant-id"
```

## Storage Spaces Direct

### Configure Storage

```powershell
# Enable Storage Spaces Direct
Enable-ClusterStorageSpacesDirect `
    -PoolFriendlyName "S2D Pool" `
    -CacheState Disabled

# Create tiered volumes
New-Volume `
    -FriendlyName "Volume1" `
    -FileSystem CSVFS_ReFS `
    -StoragePoolFriendlyName "S2D Pool" `
    -Size 1TB `
    -ResiliencySettingName Mirror

# Create stretched volume (for multi-site)
New-Volume `
    -FriendlyName "StretchedVolume" `
    -FileSystem CSVFS_ReFS `
    -StoragePoolFriendlyName "S2D Pool" `
    -Size 500GB `
    -ResiliencySettingName Mirror `
    -NumberOfDataCopies 4 `
    -NumberOfGroups 2
```

### Monitor Storage Health

```powershell
# Get storage health
Get-StorageSubSystem -FriendlyName "Clustered*" |
    Get-StorageHealthReport

# Get volume status
Get-Volume | Where-Object {$_.FileSystemType -eq 'CSVFS'} |
    Select-Object FriendlyName, HealthStatus, SizeRemaining, Size

# Performance metrics
Get-ClusterPerformanceHistory -ClusterName "hci-cluster" |
    Where-Object MetricName -eq "Volume.IOPS.Total"
```

## Windows Admin Center

### Deploy WAC Gateway

```powershell
# Install Windows Admin Center
$wacPort = 443
$cert = Get-ChildItem -Path Cert:\LocalMachine\My |
    Where-Object { $_.Subject -match "CN=wac.contoso.com" }

msiexec /i WindowsAdminCenter.msi /qn `
    SME_PORT=$wacPort `
    SSL_CERTIFICATE_OPTION=installed `
    SME_THUMBPRINT=$($cert.Thumbprint)

# Register with Azure
Register-WindowsAdminCenter `
    -TenantId "your-tenant-id" `
    -GatewayEndpoint "https://wac.contoso.com"
```

### REST API for Automation

```powershell
# Get auth token
$token = Get-WACAccessToken -GatewayUri "https://wac.contoso.com"

# Query cluster nodes
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

$response = Invoke-RestMethod `
    -Uri "https://wac.contoso.com/api/nodes/all/features/servers/inventory" `
    -Headers $headers `
    -Method Get

$response.servers | Format-Table Name, Status, Memory
```

## Monitoring with Azure Monitor

### Configure Insights

```powershell
# Enable Azure Monitor for cluster
$workspace = Get-AzOperationalInsightsWorkspace `
    -ResourceGroupName "rg-monitoring" `
    -Name "log-analytics-workspace"

# Install monitoring extension on each node
$nodes = Get-ClusterNode

foreach ($node in $nodes) {
    Set-AzVMExtension `
        -ResourceGroupName "rg-azure-stack-hci" `
        -VMName $node.Name `
        -Name "MicrosoftMonitoringAgent" `
        -Publisher "Microsoft.EnterpriseCloud.Monitoring" `
        -Type "MicrosoftMonitoringAgent" `
        -TypeHandlerVersion "1.0" `
        -Settings @{
            workspaceId = $workspace.CustomerId
        } `
        -ProtectedSettings @{
            workspaceKey = (Get-AzOperationalInsightsWorkspaceSharedKey `
                -ResourceGroupName "rg-monitoring" `
                -Name "log-analytics-workspace").PrimarySharedKey
        }
}
```

### KQL Queries for HCI

```kql
// Cluster node health
Perf
| where ObjectName == "Cluster Shared Volume"
| where CounterName == "Volume Available %"
| summarize AvgAvailable = avg(CounterValue) by Computer, InstanceName
| where AvgAvailable < 20

// VM performance
Perf
| where ObjectName == "Hyper-V Dynamic Memory VM"
| where CounterName == "Guest Visible Physical Memory"
| summarize AvgMemory = avg(CounterValue) by Computer, InstanceName, bin(TimeGenerated, 1h)
| render timechart

// Storage latency
Perf
| where ObjectName == "Cluster Shared Volume"
| where CounterName == "Read Latency" or CounterName == "Write Latency"
| summarize AvgLatency = avg(CounterValue) by CounterName, bin(TimeGenerated, 5m)
| render timechart
```

Azure Stack HCI provides a modern hyperconverged infrastructure platform with deep Azure integration. It's ideal for organizations that need on-premises infrastructure with cloud management capabilities.

## Resources

- [Azure Stack HCI Documentation](https://docs.microsoft.com/en-us/azure-stack/hci/overview)
- [AKS on Azure Stack HCI](https://docs.microsoft.com/en-us/azure-stack/aks-hci/overview)
- [Windows Admin Center](https://docs.microsoft.com/en-us/windows-server/manage/windows-admin-center/overview)
