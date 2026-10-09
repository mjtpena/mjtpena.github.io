---
title: "Azure Stack Updates - Edge and Hybrid Computing"
description: "Azure Stack HCI is a hyperconverged infrastructure solution for running virtualized workloads on-premises with Azure integration."
author: "Michael John Peña"
draft: false
date: 2022-10-05
tags: ["Azure", "Azure Stack", "Edge Computing", "HCI"]
---

## Azure Stack Portfolio

### Azure Stack HCI

Azure Stack HCI is a hyperconverged infrastructure solution for running virtualized workloads on-premises with Azure integration.

```powershell
# Register Azure Stack HCI cluster
Register-AzStackHCI `
    -SubscriptionId "subscription-id" `
    -ResourceGroupName "HCI-Resources" `
    -Region "eastus" `
    -ResourceName "hci-cluster-01"

# Enable Azure benefits
Enable-AzStackHCIAttestation `
    -ClusterName "hci-cluster-01"

# Deploy Azure Kubernetes Service on HCI
Install-AksHci -Config $aksConfig

# Create AKS-HCI cluster
New-AksHciCluster `
    -Name "aks-workload-cluster" `
    -NodePoolName "nodepool1" `
    -NodeCount 3 `
    -OSType Linux `
    -VMSize "Standard_D4s_v3"
```

### Azure Stack Hub

```python
# Azure Stack Hub management with Python SDK
from azure.identity import ClientSecretCredential
from azure.mgmt.compute import ComputeManagementClient

# Azure Stack Hub endpoint
arm_endpoint = "https://management.local.azurestack.external"

credential = ClientSecretCredential(
    tenant_id="your-tenant-id",
    client_id="your-client-id",
    client_secret="your-client-secret",
    authority_host="https://login.local.azurestack.external"
)

compute_client = ComputeManagementClient(
    credential,
    "your-subscription-id",
    base_url=arm_endpoint
)

# List VMs on Azure Stack Hub
vms = compute_client.virtual_machines.list_all()
for vm in vms:
    print(f"VM: {vm.name}, Status: {vm.provisioning_state}")
```

### Azure Stack Edge

```csharp
// Deploying workloads to Azure Stack Edge
public class StackEdgeDeploymentService
{
    private readonly ArmClient _armClient;

    public async Task DeployIoTModuleAsync(string deviceName, string resourceGroup)
    {
        var edgeDevice = await GetStackEdgeDeviceAsync(deviceName, resourceGroup);

        // Deploy IoT Edge module
        var moduleConfig = new IoTEdgeModuleConfig
        {
            Name = "sensor-processor",
            Image = "mcr.microsoft.com/azure-iot/sensor-processor:latest",
            CreateOptions = new ContainerCreateOptions
            {
                HostConfig = new HostConfig
                {
                    Binds = new[] { "/data:/app/data" }
                }
            },
            DesiredProperties = new
            {
                SamplingInterval = 1000,
                DataRetention = 3600
            }
        };

        await DeployModuleAsync(edgeDevice, moduleConfig);
    }

    public async Task DeployKubernetesWorkloadAsync(string deviceName, string resourceGroup)
    {
        var edgeDevice = await GetStackEdgeDeviceAsync(deviceName, resourceGroup);

        // Deploy Kubernetes workload
        var deployment = new V1Deployment
        {
            Metadata = new V1ObjectMeta { Name = "edge-workload" },
            Spec = new V1DeploymentSpec
            {
                Replicas = 2,
                Selector = new V1LabelSelector
                {
                    MatchLabels = new Dictionary<string, string>
                    {
                        ["app"] = "edge-workload"
                    }
                },
                Template = new V1PodTemplateSpec
                {
                    Metadata = new V1ObjectMeta
                    {
                        Labels = new Dictionary<string, string>
                        {
                            ["app"] = "edge-workload"
                        }
                    },
                    Spec = new V1PodSpec
                    {
                        Containers = new List<V1Container>
                        {
                            new V1Container
                            {
                                Name = "main",
                                Image = "myregistry.azurecr.io/edge-app:latest",
                                Resources = new V1ResourceRequirements
                                {
                                    Requests = new Dictionary<string, ResourceQuantity>
                                    {
                                        ["cpu"] = new ResourceQuantity("500m"),
                                        ["memory"] = new ResourceQuantity("512Mi")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };

        await _kubernetesClient.AppsV1.CreateNamespacedDeploymentAsync(
            deployment, "default");
    }
}
```

### VM Management on Azure Stack HCI

```powershell
# Create VM on Azure Stack HCI with Azure CLI
az stack-hci-vm create `
    --resource-group "HCI-VMs" `
    --name "web-server-01" `
    --custom-location "hci-custom-location" `
    --hardware-profile memory-mb=8192 processors=4 `
    --storage-profile `
        image-reference="microsoftwindowsserver:windowsserver:2022-datacenter-azure-edition:latest" `
    --network-profile `
        network-interfaces="/subscriptions/.../networkInterfaces/web-nic"

# Enable Azure Arc on HCI VM
az connectedmachine connect `
    --resource-group "HCI-VMs" `
    --name "web-server-01" `
    --location "eastus"

# Apply Azure Policy to HCI VMs
az policy assignment create `
    --name "hci-vm-security" `
    --scope "/subscriptions/.../resourceGroups/HCI-VMs" `
    --policy "deploy-defender-for-servers"
```

### Monitoring Azure Stack

```kusto
// Azure Monitor queries for Azure Stack
// Query Azure Stack HCI cluster health
AzureStackHCIClusterHealth
| where TimeGenerated > ago(1h)
| summarize
    HealthyNodes = countif(NodeStatus == "Healthy"),
    UnhealthyNodes = countif(NodeStatus != "Healthy")
    by ClusterName, bin(TimeGenerated, 5m)
| render timechart

// Azure Stack Edge device metrics
AzureStackEdgeMetrics
| where TimeGenerated > ago(24h)
| where MetricName in ("CPUUtilization", "MemoryUtilization", "DiskUtilization")
| summarize avg(MetricValue) by MetricName, DeviceName, bin(TimeGenerated, 1h)
| render timechart

// Azure Stack Hub resource utilization
AzureStackHubCapacity
| where TimeGenerated > ago(7d)
| summarize
    AvgCPU = avg(CPUUtilization),
    AvgMemory = avg(MemoryUtilization),
    AvgStorage = avg(StorageUtilization)
    by bin(TimeGenerated, 1d)
```

### Azure Arc Integration

```yaml
# GitOps configuration for Azure Stack environments
apiVersion: v1
kind: ConfigMap
metadata:
  name: stack-config
  namespace: arc-system
data:
  environment: "edge"
  location: "factory-floor"
  connectivity: "intermittent"
```
