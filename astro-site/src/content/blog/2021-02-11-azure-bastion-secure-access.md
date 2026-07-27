---
title: Secure VM Access with Azure Bastion
author: Michael John Peña
draft: false
date: 2021-02-11
url: /blog/azure-bastion-secure-access/
tags:
  - Azure
  - Security
  - Networking
  - Bastion
  - Remote Access
---

I keep writing about Bastion because I keep finding jump boxes I have to replace. VM with a public IP, port 3389 open, "admin" password in a sticky note in OneNote somewhere. Bastion is the argument you make to get those shut down: browser-based RDP and SSH through the Azure portal, managed by Microsoft, MFA via Azure AD, no public IP on the target VM, and session logging through Diagnostic Settings. The audit trail alone has justified the cost on two projects I've been on.

## Why Azure Bastion?

Traditional remote access to VMs requires either:
- Public IP addresses with NSG rules (security risk)
- VPN connections (complex setup)
- Jump boxes (additional management overhead)

Azure Bastion solves these challenges by providing:

- **No public IP required** - VMs remain private
- **Protection against port scanning** - No exposed ports
- **Hardened bastion service** - Managed and patched by Microsoft
- **HTML5 browser experience** - No client software needed
- **Integrated with Azure AD** - Use MFA and conditional access

## Deploying Azure Bastion

Create Azure Bastion using the Azure CLI:

```bash
# Create a resource group
az group create --name rg-bastion-demo --location eastus

# Create a virtual network with AzureBastionSubnet
az network vnet create \
    --name vnet-bastion \
    --resource-group rg-bastion-demo \
    --address-prefix 10.0.0.0/16 \
    --subnet-name workload-subnet \
    --subnet-prefix 10.0.1.0/24

# Create the AzureBastionSubnet (minimum /27)
az network vnet subnet create \
    --name AzureBastionSubnet \
    --resource-group rg-bastion-demo \
    --vnet-name vnet-bastion \
    --address-prefix 10.0.255.0/27

# Create a public IP for Bastion
az network public-ip create \
    --name pip-bastion \
    --resource-group rg-bastion-demo \
    --sku Standard \
    --allocation-method Static

# Create Azure Bastion
az network bastion create \
    --name bastion-demo \
    --resource-group rg-bastion-demo \
    --vnet-name vnet-bastion \
    --public-ip-address pip-bastion \
    --location eastus \
    --sku Standard
```

## Bastion SKU Comparison

| Feature | Basic | Standard |
|---------|-------|----------|
| Manual scaling | No | Yes (2-50 instances) |
| Native client support | No | Yes |
| Upload/download files | No | Yes |
| Shareable link | No | Yes |
| Kerberos authentication | No | Yes |

## Configuring Standard SKU Features

Enable advanced features with Standard SKU:

```bash
# Upgrade to Standard SKU
az network bastion update \
    --name bastion-demo \
    --resource-group rg-bastion-demo \
    --sku Standard

# Enable native client support
az network bastion update \
    --name bastion-demo \
    --resource-group rg-bastion-demo \
    --enable-tunneling true

# Enable IP-based connection (connect without Azure Portal)
az network bastion update \
    --name bastion-demo \
    --resource-group rg-bastion-demo \
    --enable-ip-connect true

# Scale bastion instances
az network bastion update \
    --name bastion-demo \
    --resource-group rg-bastion-demo \
    --scale-units 4
```

## Native Client Connection

With Standard SKU, connect using native RDP/SSH clients:

```bash
# Connect via SSH using native client
az network bastion ssh \
    --name bastion-demo \
    --resource-group rg-bastion-demo \
    --target-resource-id /subscriptions/{sub-id}/resourceGroups/rg-bastion-demo/providers/Microsoft.Compute/virtualMachines/vm-linux \
    --auth-type ssh-key \
    --username azureuser \
    --ssh-key ~/.ssh/id_rsa

# Connect via RDP using native client
az network bastion rdp \
    --name bastion-demo \
    --resource-group rg-bastion-demo \
    --target-resource-id /subscriptions/{sub-id}/resourceGroups/rg-bastion-demo/providers/Microsoft.Compute/virtualMachines/vm-windows

# Tunnel a specific port
az network bastion tunnel \
    --name bastion-demo \
    --resource-group rg-bastion-demo \
    --target-resource-id /subscriptions/{sub-id}/resourceGroups/rg-bastion-demo/providers/Microsoft.Compute/virtualMachines/vm-linux \
    --resource-port 22 \
    --port 2222
```

## ARM Template for Bastion Deployment

```json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "bastionHostName": {
            "type": "string",
            "defaultValue": "bastion-host"
        },
        "vnetName": {
            "type": "string"
        },
        "bastionSubnetPrefix": {
            "type": "string",
            "defaultValue": "10.0.255.0/27"
        }
    },
    "variables": {
        "publicIpName": "[concat(parameters('bastionHostName'), '-pip')]"
    },
    "resources": [
        {
            "type": "Microsoft.Network/virtualNetworks/subnets",
            "apiVersion": "2020-11-01",
            "name": "[concat(parameters('vnetName'), '/AzureBastionSubnet')]",
            "properties": {
                "addressPrefix": "[parameters('bastionSubnetPrefix')]"
            }
        },
        {
            "type": "Microsoft.Network/publicIPAddresses",
            "apiVersion": "2020-11-01",
            "name": "[variables('publicIpName')]",
            "location": "[resourceGroup().location]",
            "sku": {
                "name": "Standard"
            },
            "properties": {
                "publicIPAllocationMethod": "Static"
            }
        },
        {
            "type": "Microsoft.Network/bastionHosts",
            "apiVersion": "2020-11-01",
            "name": "[parameters('bastionHostName')]",
            "location": "[resourceGroup().location]",
            "dependsOn": [
                "[resourceId('Microsoft.Network/publicIPAddresses', variables('publicIpName'))]",
                "[resourceId('Microsoft.Network/virtualNetworks/subnets', parameters('vnetName'), 'AzureBastionSubnet')]"
            ],
            "sku": {
                "name": "Standard"
            },
            "properties": {
                "enableTunneling": true,
                "enableIpConnect": true,
                "scaleUnits": 2,
                "ipConfigurations": [
                    {
                        "name": "IpConf",
                        "properties": {
                            "subnet": {
                                "id": "[resourceId('Microsoft.Network/virtualNetworks/subnets', parameters('vnetName'), 'AzureBastionSubnet')]"
                            },
                            "publicIPAddress": {
                                "id": "[resourceId('Microsoft.Network/publicIPAddresses', variables('publicIpName'))]"
                            }
                        }
                    }
                ]
            }
        }
    ]
}
```

## Shareable Links

Create shareable links for temporary access:

```python
import requests
from azure.identity import DefaultAzureCredential
from datetime import datetime, timedelta

def create_shareable_link(subscription_id, resource_group, bastion_name, vm_resource_id):
    """Create a shareable Bastion link for a VM."""

    credential = DefaultAzureCredential()
    token = credential.get_token("https://management.azure.com/.default")

    url = f"https://management.azure.com/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/bastionHosts/{bastion_name}/createShareableLinks?api-version=2021-02-01"

    body = {
        "vms": [
            {
                "vm": {
                    "id": vm_resource_id
                }
            }
        ]
    }

    headers = {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json"
    }

    response = requests.post(url, json=body, headers=headers)

    if response.status_code == 202:
        # Check operation status
        operation_url = response.headers.get("Azure-AsyncOperation")
        # Poll for completion
        return poll_operation(operation_url, headers)

    return response.json()

def get_shareable_links(subscription_id, resource_group, bastion_name):
    """Get all shareable links for a Bastion host."""

    credential = DefaultAzureCredential()
    token = credential.get_token("https://management.azure.com/.default")

    url = f"https://management.azure.com/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/bastionHosts/{bastion_name}/GetShareableLinks?api-version=2021-02-01"

    headers = {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json"
    }

    body = {"vms": []}

    response = requests.post(url, json=body, headers=headers)
    return response.json()

def delete_shareable_links(subscription_id, resource_group, bastion_name, vm_resource_ids):
    """Delete shareable links for specified VMs."""

    credential = DefaultAzureCredential()
    token = credential.get_token("https://management.azure.com/.default")

    url = f"https://management.azure.com/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/bastionHosts/{bastion_name}/deleteShareableLinks?api-version=2021-02-01"

    body = {
        "vms": [{"vm": {"id": vm_id}} for vm_id in vm_resource_ids]
    }

    headers = {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json"
    }

    response = requests.post(url, json=body, headers=headers)
    return response.status_code == 202
```

## Network Security Configuration

Secure the Bastion subnet with NSG rules:

```bash
# Create NSG for AzureBastionSubnet
az network nsg create \
    --name nsg-bastion \
    --resource-group rg-bastion-demo

# Required inbound rules
az network nsg rule create \
    --nsg-name nsg-bastion \
    --resource-group rg-bastion-demo \
    --name AllowHttpsInbound \
    --priority 120 \
    --direction Inbound \
    --access Allow \
    --protocol Tcp \
    --source-address-prefix Internet \
    --source-port-range '*' \
    --destination-address-prefix '*' \
    --destination-port-range 443

az network nsg rule create \
    --nsg-name nsg-bastion \
    --resource-group rg-bastion-demo \
    --name AllowGatewayManagerInbound \
    --priority 130 \
    --direction Inbound \
    --access Allow \
    --protocol Tcp \
    --source-address-prefix GatewayManager \
    --source-port-range '*' \
    --destination-address-prefix '*' \
    --destination-port-range 443

az network nsg rule create \
    --nsg-name nsg-bastion \
    --resource-group rg-bastion-demo \
    --name AllowAzureLoadBalancerInbound \
    --priority 140 \
    --direction Inbound \
    --access Allow \
    --protocol Tcp \
    --source-address-prefix AzureLoadBalancer \
    --source-port-range '*' \
    --destination-address-prefix '*' \
    --destination-port-range 443

az network nsg rule create \
    --nsg-name nsg-bastion \
    --resource-group rg-bastion-demo \
    --name AllowBastionHostCommunication \
    --priority 150 \
    --direction Inbound \
    --access Allow \
    --protocol '*' \
    --source-address-prefix VirtualNetwork \
    --source-port-range '*' \
    --destination-address-prefix VirtualNetwork \
    --destination-port-ranges 8080 5701

# Required outbound rules
az network nsg rule create \
    --nsg-name nsg-bastion \
    --resource-group rg-bastion-demo \
    --name AllowSshRdpOutbound \
    --priority 100 \
    --direction Outbound \
    --access Allow \
    --protocol '*' \
    --source-address-prefix '*' \
    --source-port-range '*' \
    --destination-address-prefix VirtualNetwork \
    --destination-port-ranges 22 3389

az network nsg rule create \
    --nsg-name nsg-bastion \
    --resource-group rg-bastion-demo \
    --name AllowAzureCloudOutbound \
    --priority 110 \
    --direction Outbound \
    --access Allow \
    --protocol Tcp \
    --source-address-prefix '*' \
    --source-port-range '*' \
    --destination-address-prefix AzureCloud \
    --destination-port-range 443

az network nsg rule create \
    --nsg-name nsg-bastion \
    --resource-group rg-bastion-demo \
    --name AllowBastionCommunication \
    --priority 120 \
    --direction Outbound \
    --access Allow \
    --protocol '*' \
    --source-address-prefix VirtualNetwork \
    --source-port-range '*' \
    --destination-address-prefix VirtualNetwork \
    --destination-port-ranges 8080 5701

# Associate NSG with AzureBastionSubnet
az network vnet subnet update \
    --name AzureBastionSubnet \
    --resource-group rg-bastion-demo \
    --vnet-name vnet-bastion \
    --network-security-group nsg-bastion
```

## Monitoring Bastion Sessions

Enable diagnostic logging:

```bash
# Create Log Analytics workspace
az monitor log-analytics workspace create \
    --workspace-name law-bastion \
    --resource-group rg-bastion-demo

# Enable diagnostic settings
az monitor diagnostic-settings create \
    --name bastion-diagnostics \
    --resource "/subscriptions/{sub-id}/resourceGroups/rg-bastion-demo/providers/Microsoft.Network/bastionHosts/bastion-demo" \
    --workspace law-bastion \
    --logs '[{"category": "BastionAuditLogs", "enabled": true}]'
```

Query Bastion audit logs:

```kusto
// All Bastion sessions
MicrosoftAzureBastionAuditLogs
| where TimeGenerated > ago(24h)
| project TimeGenerated, UserName, ClientIpAddress, TargetVMIPAddress, Protocol, SessionStartTime, Duration
| order by TimeGenerated desc

// Failed connection attempts
MicrosoftAzureBastionAuditLogs
| where TimeGenerated > ago(24h)
| where Message contains "failed" or Message contains "error"
| project TimeGenerated, UserName, ClientIpAddress, Message
| order by TimeGenerated desc

// Session duration statistics
MicrosoftAzureBastionAuditLogs
| where TimeGenerated > ago(7d)
| where isnotempty(Duration)
| summarize
    AvgDuration = avg(Duration),
    MaxDuration = max(Duration),
    SessionCount = count()
    by bin(TimeGenerated, 1d)
| render timechart
```

## Best Practices

1. **Use Standard SKU** for production workloads requiring native client support
2. **Scale appropriately** based on concurrent session requirements
3. **Enable MFA** through Azure AD Conditional Access
4. **Monitor sessions** with diagnostic logging
5. **Combine with JIT** for additional security layer
6. **Use shareable links** for temporary access instead of permanent permissions

## Conclusion

Azure Bastion eliminates the security risks associated with traditional remote access methods while providing a seamless user experience. The Standard SKU's native client support makes it practical for daily operations, while shareable links enable secure temporary access for contractors and support personnel.

Start with Basic SKU for development environments and upgrade to Standard for production workloads requiring advanced features.
