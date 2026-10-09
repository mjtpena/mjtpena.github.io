---
title: Enterprise Network Architecture with Azure Virtual WAN
author: Michael John Peña
draft: false
date: 2021-02-12
url: /blog/azure-virtual-wan/
tags:
  - Azure
  - Networking
  - Virtual WAN
  - Hub and Spoke
  - Enterprise
---

## Understanding Virtual WAN Architecture

Virtual WAN simplifies enterprise networking by providing:

- **Hub-and-spoke architecture** - Automated connectivity between hubs and spokes
- **Branch connectivity** - VPN and ExpressRoute integration
- **Routing automation** - Simplified routing between all connected networks
- **Security integration** - Azure Firewall and third-party NVAs in the hub
- **Global reach** - Multi-region connectivity with optimized routing

## Creating a Virtual WAN

```bash
# Create a resource group
az group create --name rg-vwan-demo --location eastus

# Create a Virtual WAN
az network vwan create \
    --name vwan-enterprise \
    --resource-group rg-vwan-demo \
    --type Standard \
    --branch-to-branch-traffic true \
    --office365-category Optimize

# Create a Virtual Hub (East US)
az network vhub create \
    --name hub-eastus \
    --resource-group rg-vwan-demo \
    --vwan vwan-enterprise \
    --address-prefix 10.0.0.0/24 \
    --location eastus \
    --sku Standard

# Create a second Virtual Hub (West Europe)
az network vhub create \
    --name hub-westeurope \
    --resource-group rg-vwan-demo \
    --vwan vwan-enterprise \
    --address-prefix 10.1.0.0/24 \
    --location westeurope \
    --sku Standard
```

## Connecting Spoke VNets

```bash
# Create spoke VNets
az network vnet create \
    --name vnet-spoke-app \
    --resource-group rg-vwan-demo \
    --location eastus \
    --address-prefix 10.10.0.0/16 \
    --subnet-name subnet-app \
    --subnet-prefix 10.10.1.0/24

az network vnet create \
    --name vnet-spoke-data \
    --resource-group rg-vwan-demo \
    --location eastus \
    --address-prefix 10.20.0.0/16 \
    --subnet-name subnet-data \
    --subnet-prefix 10.20.1.0/24

# Connect spokes to Virtual Hub
az network vhub connection create \
    --name conn-spoke-app \
    --resource-group rg-vwan-demo \
    --vhub-name hub-eastus \
    --remote-vnet vnet-spoke-app \
    --internet-security true

az network vhub connection create \
    --name conn-spoke-data \
    --resource-group rg-vwan-demo \
    --vhub-name hub-eastus \
    --remote-vnet vnet-spoke-data \
    --internet-security true
```

## Configuring Site-to-Site VPN

Connect branch offices via VPN:

```bash
# Create VPN Gateway in the hub
az network vpn-gateway create \
    --name vpn-gateway-eastus \
    --resource-group rg-vwan-demo \
    --vhub hub-eastus \
    --location eastus \
    --scale-unit 1

# Create VPN site (represents branch office)
az network vpn-site create \
    --name site-branch-nyc \
    --resource-group rg-vwan-demo \
    --virtual-wan vwan-enterprise \
    --location eastus \
    --ip-address 203.0.113.10 \
    --address-prefixes 192.168.1.0/24 \
    --device-vendor Cisco \
    --device-model ISR4451 \
    --link-speed 100

# Connect VPN site to gateway
az network vpn-gateway connection create \
    --name conn-branch-nyc \
    --resource-group rg-vwan-demo \
    --gateway-name vpn-gateway-eastus \
    --remote-vpn-site site-branch-nyc \
    --vpn-site-link site-branch-nyc \
    --shared-key "YourSecureSharedKey123!" \
    --connection-bandwidth 100
```

## Adding Azure Firewall to Virtual Hub

```bash
# Create Azure Firewall Policy
az network firewall policy create \
    --name fw-policy-vwan \
    --resource-group rg-vwan-demo \
    --location eastus \
    --sku Premium

# Create rule collection group
az network firewall policy rule-collection-group create \
    --name rcg-network-rules \
    --policy-name fw-policy-vwan \
    --resource-group rg-vwan-demo \
    --priority 200

# Add network rules
az network firewall policy rule-collection-group collection add-filter-collection \
    --resource-group rg-vwan-demo \
    --policy-name fw-policy-vwan \
    --rule-collection-group-name rcg-network-rules \
    --name allow-spoke-traffic \
    --collection-priority 100 \
    --action Allow \
    --rule-name allow-internal \
    --rule-type NetworkRule \
    --source-addresses "10.10.0.0/16" "10.20.0.0/16" \
    --destination-addresses "10.10.0.0/16" "10.20.0.0/16" \
    --destination-ports '*' \
    --ip-protocols Any

# Deploy Azure Firewall in Virtual Hub
az network firewall create \
    --name fw-hub-eastus \
    --resource-group rg-vwan-demo \
    --vhub hub-eastus \
    --sku AZFW_Hub \
    --firewall-policy fw-policy-vwan \
    --public-ip-count 1
```

## Routing Configuration

Configure routing intent and policies:

```python
import requests
from azure.identity import DefaultAzureCredential

def configure_routing_intent(subscription_id, resource_group, vhub_name):
    """Configure routing intent for the Virtual Hub."""

    credential = DefaultAzureCredential()
    token = credential.get_token("https://management.azure.com/.default")

    url = f"https://management.azure.com/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/virtualHubs/{vhub_name}/routingIntent/hubRoutingIntent?api-version=2021-05-01"

    body = {
        "properties": {
            "routingPolicies": [
                {
                    "name": "InternetTraffic",
                    "destinations": ["Internet"],
                    "nextHop": f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/azureFirewalls/fw-hub-eastus"
                },
                {
                    "name": "PrivateTraffic",
                    "destinations": ["PrivateTraffic"],
                    "nextHop": f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/azureFirewalls/fw-hub-eastus"
                }
            ]
        }
    }

    headers = {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json"
    }

    response = requests.put(url, json=body, headers=headers)
    return response.json()

def get_effective_routes(subscription_id, resource_group, vhub_name, connection_name):
    """Get effective routes for a VNet connection."""

    credential = DefaultAzureCredential()
    token = credential.get_token("https://management.azure.com/.default")

    url = f"https://management.azure.com/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/virtualHubs/{vhub_name}/hubVirtualNetworkConnections/{connection_name}/effectiveRoutes?api-version=2021-05-01"

    headers = {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json"
    }

    # This is an async operation
    response = requests.post(url, headers=headers, json={})
    return response.json()
```

## ARM Template for Complete Deployment

```json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "vwanName": {
            "type": "string",
            "defaultValue": "vwan-enterprise"
        },
        "hubLocations": {
            "type": "array",
            "defaultValue": ["eastus", "westeurope"]
        },
        "hubAddressPrefixes": {
            "type": "array",
            "defaultValue": ["10.0.0.0/24", "10.1.0.0/24"]
        }
    },
    "variables": {
        "hubs": [
            {
                "name": "[concat('hub-', parameters('hubLocations')[0])]",
                "location": "[parameters('hubLocations')[0]]",
                "addressPrefix": "[parameters('hubAddressPrefixes')[0]]"
            },
            {
                "name": "[concat('hub-', parameters('hubLocations')[1])]",
                "location": "[parameters('hubLocations')[1]]",
                "addressPrefix": "[parameters('hubAddressPrefixes')[1]]"
            }
        ]
    },
    "resources": [
        {
            "type": "Microsoft.Network/virtualWans",
            "apiVersion": "2021-05-01",
            "name": "[parameters('vwanName')]",
            "location": "[resourceGroup().location]",
            "properties": {
                "type": "Standard",
                "allowBranchToBranchTraffic": true,
                "allowVnetToVnetTraffic": true
            }
        },
        {
            "type": "Microsoft.Network/virtualHubs",
            "apiVersion": "2021-05-01",
            "name": "[variables('hubs')[copyIndex()].name]",
            "location": "[variables('hubs')[copyIndex()].location]",
            "dependsOn": [
                "[resourceId('Microsoft.Network/virtualWans', parameters('vwanName'))]"
            ],
            "copy": {
                "name": "hubCopy",
                "count": "[length(variables('hubs'))]"
            },
            "properties": {
                "virtualWan": {
                    "id": "[resourceId('Microsoft.Network/virtualWans', parameters('vwanName'))]"
                },
                "addressPrefix": "[variables('hubs')[copyIndex()].addressPrefix]",
                "sku": "Standard"
            }
        }
    ],
    "outputs": {
        "vwanId": {
            "type": "string",
            "value": "[resourceId('Microsoft.Network/virtualWans', parameters('vwanName'))]"
        }
    }
}
```

## Monitoring Virtual WAN

Configure monitoring and alerts:

```kusto
// Hub traffic analysis
AzureDiagnostics
| where Category == "TunnelDiagnosticLog"
| where TimeGenerated > ago(24h)
| summarize
    BytesSent = sum(todouble(egressBytes_d)),
    BytesReceived = sum(todouble(ingressBytes_d))
    by bin(TimeGenerated, 1h), Resource
| render timechart

// VPN connection status
AzureDiagnostics
| where Category == "RouteDiagnosticLog"
| where TimeGenerated > ago(1h)
| project TimeGenerated, Resource, Message, remoteIP_s
| order by TimeGenerated desc

// Firewall traffic in secured hub
AzureDiagnostics
| where Category == "AzureFirewallNetworkRule"
| where TimeGenerated > ago(1h)
| summarize Count = count() by Rule_s, Action_s
| order by Count desc
```

## Best Practices

1. **Use Standard SKU** for production deployments requiring full features
2. **Deploy hubs close to workloads** for optimal latency
3. **Enable branch-to-branch** for direct branch communication
4. **Integrate Azure Firewall** for centralized security
5. **Plan IP addressing** to avoid overlaps across all connected networks
6. **Use routing intent** for simplified traffic management

## Conclusion

Azure Virtual WAN simplifies complex enterprise networking by providing a unified platform for connectivity and security. The automated routing and integrated security features reduce operational complexity while providing global-scale connectivity.

Start with a pilot deployment connecting a few spoke VNets, then expand to include branch offices and additional regions as you validate the architecture.
