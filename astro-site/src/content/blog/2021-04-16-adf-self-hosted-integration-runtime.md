---
title: ADF Self-Hosted Integration Runtime - Connecting On-Premises Data
description: "The Self-Hosted Integration Runtime is the component that makes ADF viable for the majority of real enterprise projects—the ones where the source database…"
author: Michael John Peña
draft: false
date: 2021-04-16
url: /blog/adf-self-hosted-integration-runtime/
tags:
  - Azure
  - Data Factory
  - Integration Runtime
  - Hybrid
  - On-Premises
---

The Self-Hosted Integration Runtime is the component that makes ADF viable for the majority of real enterprise projects—the ones where the source database is still on-premises, or in an Azure VNet with no public endpoint, or on a legacy system behind a firewall. SHIR is a lightweight agent you install on a Windows server inside the network; ADF communicates with it through outbound HTTPS from the agent, so you don't open inbound ports. The operational pattern that works: install SHIR on at least two nodes for HA, put it on a server sized for your peak extract load (I usually start with 8 vCores, 32 GB), and monitor SHIR metrics in Azure Monitor rather than relying on green/red status in the ADF UI.

## Understanding Integration Runtime Types

Azure Data Factory supports three IR types:

1. **Azure IR** - Fully managed, for cloud-to-cloud scenarios
2. **Self-Hosted IR** - Customer managed, for on-premises or private networks
3. **Azure-SSIS IR** - For running SSIS packages in Azure

## When to Use Self-Hosted IR

Use SHIR when connecting to:

- On-premises SQL Server, Oracle, SAP
- Private network resources (VNet, VPN)
- File systems behind firewalls
- Legacy systems without public endpoints
- Data sources requiring Windows authentication

## Setting Up Self-Hosted IR

### Step 1: Create IR in Azure

```powershell
# Using PowerShell
$integrationRuntime = Set-AzDataFactoryV2IntegrationRuntime `
    -ResourceGroupName "myResourceGroup" `
    -DataFactoryName "myDataFactory" `
    -Name "OnPremisesIR" `
    -Type SelfHosted `
    -Description "Integration runtime for on-premises data"

# Get authentication keys
$authKeys = Get-AzDataFactoryV2IntegrationRuntimeKey `
    -ResourceGroupName "myResourceGroup" `
    -DataFactoryName "myDataFactory" `
    -Name "OnPremisesIR"

Write-Host "Auth Key 1: $($authKeys.AuthKey1)"
```

### Step 2: Install on Windows Server

```powershell
# Download and install silently
$downloadUrl = "https://go.microsoft.com/fwlink/?linkid=839822"
$installerPath = "$env:TEMP\IntegrationRuntime.msi"

Invoke-WebRequest -Uri $downloadUrl -OutFile $installerPath
Start-Process msiexec.exe -Wait -ArgumentList "/i $installerPath /quiet"

# Register with authentication key
$irPath = "C:\Program Files\Microsoft Integration Runtime\5.0\Shared"
& "$irPath\dmgcmd.exe" -Key "IR@xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx@myDataFactory@myResourceGroup@xxxxxxxxxxxxxxxxxxxxxxxx"
```

### Step 3: Verify Registration

```powershell
# Check IR status
& "$irPath\dmgcmd.exe" -Status

# Expected output:
# Integration Runtime (Self-hosted) is connected.
# Name: OnPremisesIR
# Version: 5.x.xxxx.x
# Status: Online
```

## High Availability Configuration

### Multi-Node Setup

```powershell
# On additional nodes, use the same auth key
& "C:\Program Files\Microsoft Integration Runtime\5.0\Shared\dmgcmd.exe" `
    -Key "IR@xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx@myDataFactory@myResourceGroup@xxxxxxxxxxxxxxxxxxxxxxxx"
```

### Node Management

```powershell
# List nodes
Get-AzDataFactoryV2IntegrationRuntimeNode `
    -ResourceGroupName "myResourceGroup" `
    -DataFactoryName "myDataFactory" `
    -IntegrationRuntimeName "OnPremisesIR"

# Remove a node
Remove-AzDataFactoryV2IntegrationRuntimeNode `
    -ResourceGroupName "myResourceGroup" `
    -DataFactoryName "myDataFactory" `
    -IntegrationRuntimeName "OnPremisesIR" `
    -NodeName "Node_1"
```

### Load Balancing Configuration

```json
{
  "name": "OnPremisesIR",
  "type": "SelfHosted",
  "typeProperties": {
    "linkedInfo": {
      "resourceId": "/subscriptions/.../integrationRuntimes/SharedIR"
    }
  }
}
```

## Network Configuration

### Firewall Rules

```
Outbound ports required:
- 443 (HTTPS) - Communication with ADF service
- 1433 - Azure SQL (if using)
- 10000-20000 - Data movement (configurable)

Endpoints to allow:
- *.servicebus.windows.net
- *.frontend.clouddatahub.net
- *.core.windows.net
- login.microsoftonline.com
```

### Proxy Configuration

```powershell
# Configure proxy settings
$irConfig = @{
    ProxyUrl = "http://proxy.company.com:8080"
    ProxyUsername = "domain\proxyuser"
    ProxyPassword = "proxypassword"
    BypassProxyForLocalAddress = $true
}

& "$irPath\dmgcmd.exe" -ConfigureProxy @irConfig
```

### Express Route Configuration

```hcl
# Terraform example for private link
resource "azurerm_data_factory_integration_runtime_self_hosted" "main" {
  name            = "OnPremisesIR"
  data_factory_id = azurerm_data_factory.main.id
}

resource "azurerm_private_endpoint" "adf" {
  name                = "adf-private-endpoint"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  subnet_id           = azurerm_subnet.private.id

  private_service_connection {
    name                           = "adf-connection"
    private_connection_resource_id = azurerm_data_factory.main.id
    subresource_names              = ["dataFactory"]
    is_manual_connection           = false
  }
}
```

## Connecting to Data Sources

### SQL Server (Windows Auth)

```json
{
  "name": "OnPremSqlServer",
  "type": "Microsoft.DataFactory/factories/linkedservices",
  "properties": {
    "type": "SqlServer",
    "typeProperties": {
      "connectionString": "Server=sqlserver.company.local;Database=SalesDB;Integrated Security=True;",
      "userName": "domain\\serviceaccount",
      "password": {
        "type": "SecureString",
        "value": "password"
      }
    },
    "connectVia": {
      "referenceName": "OnPremisesIR",
      "type": "IntegrationRuntimeReference"
    }
  }
}
```

### Oracle Database

```json
{
  "name": "OnPremOracle",
  "properties": {
    "type": "Oracle",
    "typeProperties": {
      "connectionString": "Host=oracleserver.company.local;Port=1521;ServiceName=ORCL;",
      "authenticationType": "Basic",
      "username": "oracleuser",
      "password": {
        "type": "SecureString",
        "value": "password"
      }
    },
    "connectVia": {
      "referenceName": "OnPremisesIR",
      "type": "IntegrationRuntimeReference"
    }
  }
}
```

### File System

```json
{
  "name": "OnPremFileSystem",
  "properties": {
    "type": "FileServer",
    "typeProperties": {
      "host": "\\\\fileserver\\share",
      "userId": "domain\\fileuser",
      "password": {
        "type": "SecureString",
        "value": "password"
      }
    },
    "connectVia": {
      "referenceName": "OnPremisesIR",
      "type": "IntegrationRuntimeReference"
    }
  }
}
```

### SAP HANA

```json
{
  "name": "SapHana",
  "properties": {
    "type": "SapHana",
    "typeProperties": {
      "server": "saphana.company.local:30015",
      "authenticationType": "Basic",
      "userName": "SAPUSER",
      "password": {
        "type": "SecureString",
        "value": "password"
      }
    },
    "connectVia": {
      "referenceName": "OnPremisesIR",
      "type": "IntegrationRuntimeReference"
    }
  }
}
```

## Performance Optimization

### Node Sizing Guidelines

```yaml
Small workload (< 1 TB/day):
  CPU: 4 cores
  Memory: 8 GB
  Network: 100 Mbps

Medium workload (1-10 TB/day):
  CPU: 8 cores
  Memory: 16 GB
  Network: 1 Gbps

Large workload (> 10 TB/day):
  CPU: 16+ cores
  Memory: 32+ GB
  Network: 10 Gbps
  Multiple nodes recommended
```

### Concurrent Job Configuration

```powershell
# Set concurrent jobs limit
& "$irPath\dmgcmd.exe" -SetConcurrentJobsLimit 20

# Monitor concurrent jobs
& "$irPath\dmgcmd.exe" -GetConcurrentJobsLimit
```

### Data Movement Optimization

```json
{
  "name": "CopyFromOnPrem",
  "type": "Copy",
  "typeProperties": {
    "source": {
      "type": "SqlServerSource",
      "sqlReaderQuery": "SELECT * FROM Sales WHERE ModifiedDate > @lastWatermark"
    },
    "sink": {
      "type": "AzureBlobFSSource"
    },
    "parallelCopies": 32,
    "dataIntegrationUnits": 256,
    "enableStaging": true,
    "stagingSettings": {
      "linkedServiceName": {
        "referenceName": "StagingBlob",
        "type": "LinkedServiceReference"
      },
      "path": "staging"
    }
  }
}
```

## Monitoring and Troubleshooting

### Integration Runtime Monitor

```powershell
# Get detailed status
$irStatus = Get-AzDataFactoryV2IntegrationRuntime `
    -ResourceGroupName "myResourceGroup" `
    -DataFactoryName "myDataFactory" `
    -Name "OnPremisesIR" `
    -Status

$irStatus | Select-Object Name, State, Version, @{
    N='Nodes'; E={$_.Nodes.Count}
}, @{
    N='ConcurrentJobs'; E={$_.Nodes[0].ConcurrentJobsRunning}
}
```

### Event Logs

```powershell
# Check Windows Event Logs
Get-EventLog -LogName Application -Source "Integration Runtime" -Newest 50 |
    Where-Object { $_.EntryType -eq "Error" } |
    Select-Object TimeGenerated, Message

# Check IR logs directly
Get-ChildItem "C:\ProgramData\Microsoft\DataTransfer\Gateway\Trace" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 10
```

### Common Issues and Solutions

```powershell
# Issue: Connection timeout
# Solution: Check network connectivity
Test-NetConnection -ComputerName "sqlserver.company.local" -Port 1433

# Issue: Authentication failure
# Solution: Verify credentials
$cred = Get-Credential
$conn = New-Object System.Data.SqlClient.SqlConnection
$conn.ConnectionString = "Server=sqlserver.company.local;Database=master;Integrated Security=False;User ID=$($cred.UserName);Password=$($cred.GetNetworkCredential().Password)"
$conn.Open()
$conn.Close()

# Issue: IR offline
# Solution: Restart service
Restart-Service "DIAHostService"
```

### Azure Monitor Integration

```json
{
  "type": "Microsoft.Insights/diagnosticSettings",
  "properties": {
    "logs": [
      {
        "category": "IntegrationRuntimeLogs",
        "enabled": true
      },
      {
        "category": "IntegrationRuntimeAvailabilityLogs",
        "enabled": true
      }
    ],
    "metrics": [
      {
        "category": "AllMetrics",
        "enabled": true
      }
    ],
    "workspaceId": "/subscriptions/.../workspaces/myworkspace"
  }
}
```

## Sharing Integration Runtime

### Create Shared IR

```powershell
# Primary factory - create IR
$sharedIR = Set-AzDataFactoryV2IntegrationRuntime `
    -ResourceGroupName "centralRG" `
    -DataFactoryName "centralFactory" `
    -Name "SharedIR" `
    -Type SelfHosted `
    -Description "Shared IR for multiple factories"

# Get resource ID
$sharedIRId = $sharedIR.Id
```

### Link to Other Factories

```powershell
# Linked factory - reference shared IR
Set-AzDataFactoryV2IntegrationRuntime `
    -ResourceGroupName "projectRG" `
    -DataFactoryName "projectFactory" `
    -Name "LinkedSharedIR" `
    -Type SelfHosted `
    -SharedIntegrationRuntimeResourceId $sharedIRId
```

## Best Practices

1. **Deploy multiple nodes** for high availability
2. **Use dedicated service accounts** with minimum permissions
3. **Monitor resource utilization** and scale as needed
4. **Keep IR updated** to latest version
5. **Secure network communication** with ExpressRoute or VPN
6. **Configure proper timeout** values
7. **Enable diagnostic logging** for troubleshooting
8. **Document firewall rules** and network requirements

## Conclusion

The Self-Hosted Integration Runtime is essential for hybrid data integration scenarios. By properly configuring high availability, network settings, and performance optimization, you can build reliable data pipelines that bridge your on-premises and cloud environments. The key is planning your deployment architecture and monitoring for issues proactively.
