---
title: Extending Azure Management with Azure Arc
description: "Azure Arc is the product I've recommended most in 2021 that clients are slowest to adopt. Not because they don't need it—they do—but because \"manage your…"
author: Michael John Peña
draft: false
date: 2021-02-28
url: /blog/azure-arc-hybrid-management/
tags:
  - Azure
  - Azure Arc
  - Hybrid Cloud
  - Multi-Cloud
  - Kubernetes
---

Azure Arc is the product I've recommended most in 2021 that clients are slowest to adopt. Not because they don't need it—they do—but because "manage your non-Azure infrastructure from Azure" requires trust in a direction that's emotionally hard for infrastructure teams who've been told Azure is the destination, not the control plane. The use cases that close the conversation: Azure Policy on an on-prem Windows Server (compliance evidence without SCCM), Arc-enabled Kubernetes bringing GitOps and Defender to a cluster that can't move to AKS, and Arc-enabled SQL Server that gets Defender for SQL and Azure AD auth on a legacy instance in a data centre.

## What is Azure Arc?

Azure Arc enables:

- **Azure Arc-enabled servers** - Manage Windows and Linux servers anywhere
- **Azure Arc-enabled Kubernetes** - Attach and manage Kubernetes clusters
- **Azure Arc-enabled data services** - Run Azure data services on any infrastructure
- **Azure Arc-enabled SQL Server** - Manage SQL Server instances anywhere

## Arc-Enabled Servers

### Onboarding Servers

```bash
# Download and install the Connected Machine agent
# For Linux:
wget https://aka.ms/azcmagent -O install_linux_azcmagent.sh
bash install_linux_azcmagent.sh

# Connect to Azure Arc
azcmagent connect \
    --resource-group rg-arc-servers \
    --tenant-id {tenant-id} \
    --location eastus \
    --subscription-id {subscription-id} \
    --resource-name myserver \
    --tags "Environment=Production,Application=WebServer"
```

### Bulk Onboarding with Service Principal

```bash
# Create service principal for Arc onboarding
az ad sp create-for-rbac \
    --name sp-arc-onboarding \
    --role "Azure Connected Machine Onboarding" \
    --scopes "/subscriptions/{subscription-id}/resourceGroups/rg-arc-servers"

# Generate onboarding script
az connectedmachine generate-script \
    --resource-group rg-arc-servers \
    --subscription {subscription-id} \
    --location eastus \
    --resource-name "{COMPUTERNAME}" \
    --service-principal-id {sp-app-id} \
    --service-principal-secret {sp-secret}
```

### PowerShell for Windows Servers

```powershell
# Bulk onboarding script for Windows
param(
    [string]$ResourceGroup = "rg-arc-servers",
    [string]$SubscriptionId,
    [string]$TenantId,
    [string]$ServicePrincipalId,
    [string]$ServicePrincipalSecret,
    [string]$Location = "eastus"
)

# Download agent
Invoke-WebRequest -Uri "https://aka.ms/AzureConnectedMachineAgent" -OutFile "AzureConnectedMachineAgent.msi"

# Install agent
msiexec /i AzureConnectedMachineAgent.msi /qn

# Connect to Azure
& "$env:ProgramFiles\AzureConnectedMachineAgent\azcmagent.exe" connect `
    --resource-group $ResourceGroup `
    --subscription-id $SubscriptionId `
    --tenant-id $TenantId `
    --location $Location `
    --service-principal-id $ServicePrincipalId `
    --service-principal-secret $ServicePrincipalSecret `
    --resource-name $env:COMPUTERNAME `
    --cloud AzureCloud
```

## Managing Arc-Enabled Servers

### Apply Azure Policy

```bash
# Assign policy to Arc servers
az policy assignment create \
    --name "audit-log-analytics" \
    --display-name "Audit Log Analytics agent" \
    --policy "/providers/Microsoft.Authorization/policyDefinitions/32133ab0-ee4b-4b44-98d6-042180979d50" \
    --scope "/subscriptions/{subscription-id}/resourceGroups/rg-arc-servers"

# Deploy extensions via policy
az policy assignment create \
    --name "deploy-mma-extension" \
    --display-name "Deploy Log Analytics agent" \
    --policy "/providers/Microsoft.Authorization/policyDefinitions/053d3325-282c-4e5c-b944-24faffd30d77" \
    --scope "/subscriptions/{subscription-id}/resourceGroups/rg-arc-servers" \
    --params '{
        "logAnalytics": {
            "value": "/subscriptions/{sub-id}/resourceGroups/rg-monitoring/providers/Microsoft.OperationalInsights/workspaces/myworkspace"
        }
    }' \
    --mi-system-assigned \
    --location eastus
```

### Install Extensions

```bash
# Install Log Analytics agent
az connectedmachine extension create \
    --name MicrosoftMonitoringAgent \
    --publisher Microsoft.EnterpriseCloud.Monitoring \
    --type MicrosoftMonitoringAgent \
    --machine-name myserver \
    --resource-group rg-arc-servers \
    --settings '{
        "workspaceId": "{workspace-id}"
    }' \
    --protected-settings '{
        "workspaceKey": "{workspace-key}"
    }'

# Install Dependency agent
az connectedmachine extension create \
    --name DependencyAgentWindows \
    --publisher Microsoft.Azure.Monitoring.DependencyAgent \
    --type DependencyAgentWindows \
    --machine-name myserver \
    --resource-group rg-arc-servers

# Install Custom Script Extension
az connectedmachine extension create \
    --name CustomScriptExtension \
    --publisher Microsoft.Compute \
    --type CustomScriptExtension \
    --machine-name myserver \
    --resource-group rg-arc-servers \
    --settings '{
        "commandToExecute": "powershell.exe -ExecutionPolicy Bypass -File configure.ps1"
    }'
```

## Arc-Enabled Kubernetes

### Connect a Kubernetes Cluster

```bash
# Install Azure Arc agents on cluster
az connectedk8s connect \
    --name myaks-cluster \
    --resource-group rg-arc-kubernetes \
    --location eastus \
    --distribution k8s \
    --infrastructure generic

# Verify connection
az connectedk8s show \
    --name myaks-cluster \
    --resource-group rg-arc-kubernetes

# List connected clusters
az connectedk8s list --output table
```

### Enable GitOps Configuration

```bash
# Create GitOps configuration
az k8s-configuration flux create \
    --name gitops-demo \
    --cluster-name myaks-cluster \
    --resource-group rg-arc-kubernetes \
    --cluster-type connectedClusters \
    --scope cluster \
    --namespace flux-system \
    --url https://github.com/myorg/gitops-repo \
    --branch main \
    --kustomization name=apps path=./apps prune=true

# Check configuration status
az k8s-configuration flux show \
    --name gitops-demo \
    --cluster-name myaks-cluster \
    --resource-group rg-arc-kubernetes \
    --cluster-type connectedClusters
```

### Deploy Azure Policy for Kubernetes

```bash
# Enable Azure Policy extension
az k8s-extension create \
    --name azurepolicy \
    --extension-type Microsoft.PolicyInsights \
    --cluster-name myaks-cluster \
    --resource-group rg-arc-kubernetes \
    --cluster-type connectedClusters

# Assign a policy
az policy assignment create \
    --name "no-privileged-containers" \
    --display-name "Do not allow privileged containers" \
    --policy "/providers/Microsoft.Authorization/policyDefinitions/95edb821-ddaf-4404-9732-666045e056b4" \
    --scope "/subscriptions/{sub-id}/resourceGroups/rg-arc-kubernetes/providers/Microsoft.Kubernetes/connectedClusters/myaks-cluster"
```

## Arc-Enabled Data Services

### Deploy Data Controller

```bash
# Create custom location
az customlocation create \
    --name my-custom-location \
    --resource-group rg-arc-data \
    --namespace arc-data \
    --host-resource-id "/subscriptions/{sub-id}/resourceGroups/rg-arc-kubernetes/providers/Microsoft.Kubernetes/connectedClusters/myaks-cluster" \
    --cluster-extension-ids "/subscriptions/{sub-id}/resourceGroups/rg-arc-kubernetes/providers/Microsoft.Kubernetes/connectedClusters/myaks-cluster/providers/Microsoft.KubernetesConfiguration/extensions/arc-data-services"

# Deploy data controller
az arcdata dc create \
    --name arc-dc \
    --resource-group rg-arc-data \
    --custom-location my-custom-location \
    --connectivity-mode indirect \
    --storage-class managed-premium \
    --infrastructure kubernetes
```

### Deploy SQL Managed Instance

```bash
# Create SQL Managed Instance
az sql mi-arc create \
    --name sql-mi-arc \
    --resource-group rg-arc-data \
    --custom-location my-custom-location \
    --storage-class-data managed-premium \
    --storage-class-logs managed-premium \
    --storage-class-backups managed-premium \
    --volume-size-data 5Gi \
    --volume-size-logs 5Gi \
    --cores-limit 4 \
    --cores-request 2 \
    --memory-limit 8Gi \
    --memory-request 4Gi \
    --tier GeneralPurpose

# Get connection endpoint
az sql mi-arc show \
    --name sql-mi-arc \
    --resource-group rg-arc-data \
    --query "status.endpoints"
```

## Monitoring Arc Resources

```python
from azure.identity import DefaultAzureCredential
from azure.mgmt.hybridcompute import HybridComputeManagementClient
from azure.mgmt.kubernetesconfiguration import SourceControlConfigurationClient

def audit_arc_resources(subscription_id):
    """Audit all Azure Arc resources."""

    credential = DefaultAzureCredential()

    # Arc-enabled servers
    compute_client = HybridComputeManagementClient(credential, subscription_id)
    servers = list(compute_client.machines.list_by_subscription())

    print("Arc-Enabled Servers:")
    for server in servers:
        print(f"  {server.name}")
        print(f"    Status: {server.status}")
        print(f"    OS: {server.os_name} {server.os_version}")
        print(f"    Agent Version: {server.agent_version}")
        print(f"    Last Heartbeat: {server.last_status_change}")

    # Arc-enabled Kubernetes
    k8s_client = SourceControlConfigurationClient(credential, subscription_id)
    # List configurations per cluster

    return {
        "servers": len(servers),
        "servers_list": [s.name for s in servers]
    }

# Run audit
results = audit_arc_resources(subscription_id)
```

### Log Analytics Queries

```kusto
// Arc server health status
Heartbeat
| where ResourceProvider == "Microsoft.HybridCompute"
| summarize LastHeartbeat = max(TimeGenerated) by Computer, ResourceGroup
| extend Status = iff(LastHeartbeat < ago(5m), "Offline", "Online")
| project Computer, ResourceGroup, LastHeartbeat, Status

// Arc server agent versions
ConfigurationData
| where ConfigDataType == "Software"
| where SoftwareName contains "Azure Connected Machine Agent"
| summarize arg_max(TimeGenerated, *) by Computer
| project Computer, AgentVersion = ProductVersion

// Policy compliance for Arc servers
PolicyComplianceCI
| where ResourceProvider == "Microsoft.HybridCompute"
| summarize
    Compliant = countif(ComplianceState == "Compliant"),
    NonCompliant = countif(ComplianceState == "NonCompliant")
    by PolicyDefinitionName
```

## ARM Template for Arc Onboarding

```json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "machineName": {
            "type": "string"
        },
        "location": {
            "type": "string",
            "defaultValue": "eastus"
        }
    },
    "resources": [
        {
            "type": "Microsoft.HybridCompute/machines",
            "apiVersion": "2021-05-20",
            "name": "[parameters('machineName')]",
            "location": "[parameters('location')]",
            "kind": "VMware",
            "properties": {},
            "tags": {
                "Environment": "Production"
            }
        },
        {
            "type": "Microsoft.HybridCompute/machines/extensions",
            "apiVersion": "2021-05-20",
            "name": "[concat(parameters('machineName'), '/MicrosoftMonitoringAgent')]",
            "location": "[parameters('location')]",
            "dependsOn": [
                "[resourceId('Microsoft.HybridCompute/machines', parameters('machineName'))]"
            ],
            "properties": {
                "publisher": "Microsoft.EnterpriseCloud.Monitoring",
                "type": "MicrosoftMonitoringAgent",
                "autoUpgradeMinorVersion": true,
                "settings": {
                    "workspaceId": "[parameters('workspaceId')]"
                },
                "protectedSettings": {
                    "workspaceKey": "[listKeys(parameters('workspaceResourceId'), '2020-08-01').primarySharedKey]"
                }
            }
        }
    ]
}
```

## Best Practices

1. **Use service principals** for automated onboarding
2. **Apply consistent tagging** for organization
3. **Enable Azure Policy** for governance
4. **Configure monitoring** with Log Analytics
5. **Use GitOps** for Kubernetes configuration management
6. **Plan network connectivity** for agent communication

## Conclusion

Azure Arc provides a unified management plane for hybrid and multi-cloud environments. By projecting on-premises and other cloud resources into Azure, you can leverage Azure's management capabilities, policies, and monitoring across your entire infrastructure.

Start with Arc-enabled servers for your most critical on-premises workloads, then expand to Kubernetes clusters and data services as you mature your hybrid strategy.
