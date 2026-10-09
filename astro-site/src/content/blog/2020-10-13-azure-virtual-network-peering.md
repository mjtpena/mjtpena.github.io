---
title: "Azure Virtual Network Peering: Connect VNets Seamlessly"
description: "Share VPN/ExpressRoute gateway across peered VNets. VNet peering is the foundation of Azure network architecture."
author: Michael John Peña
draft: false
date: 2020-10-13
tags:
  - Azure
  - Networking
  - VNet
  - Infrastructure
---

## Peering Types

- **Regional VNet Peering**: Same Azure region
- **Global VNet Peering**: Across regions

## Creating a Peering

```bash
# Peer VNet1 to VNet2
az network vnet peering create \
    --name VNet1-to-VNet2 \
    --resource-group rg-network \
    --vnet-name VNet1 \
    --remote-vnet /subscriptions/{sub}/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/VNet2 \
    --allow-vnet-access

# Peer VNet2 to VNet1 (peering must be created in both directions)
az network vnet peering create \
    --name VNet2-to-VNet1 \
    --resource-group rg-network \
    --vnet-name VNet2 \
    --remote-vnet /subscriptions/{sub}/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/VNet1 \
    --allow-vnet-access
```

## Terraform Configuration

```hcl
resource "azurerm_virtual_network" "vnet1" {
  name                = "vnet-hub"
  address_space       = ["10.0.0.0/16"]
  location            = "eastus"
  resource_group_name = azurerm_resource_group.rg.name
}

resource "azurerm_virtual_network" "vnet2" {
  name                = "vnet-spoke"
  address_space       = ["10.1.0.0/16"]
  location            = "eastus"
  resource_group_name = azurerm_resource_group.rg.name
}

resource "azurerm_virtual_network_peering" "hub-to-spoke" {
  name                      = "hub-to-spoke"
  resource_group_name       = azurerm_resource_group.rg.name
  virtual_network_name      = azurerm_virtual_network.vnet1.name
  remote_virtual_network_id = azurerm_virtual_network.vnet2.id
  allow_virtual_network_access = true
  allow_forwarded_traffic      = true
  allow_gateway_transit        = true
}

resource "azurerm_virtual_network_peering" "spoke-to-hub" {
  name                      = "spoke-to-hub"
  resource_group_name       = azurerm_resource_group.rg.name
  virtual_network_name      = azurerm_virtual_network.vnet2.name
  remote_virtual_network_id = azurerm_virtual_network.vnet1.id
  allow_virtual_network_access = true
  allow_forwarded_traffic      = true
  use_remote_gateways          = true
}
```

## Hub-and-Spoke Topology

```
         ┌─────────┐
         │   Hub   │
         │  VNet   │
         │10.0.0.0 │
         └────┬────┘
              │
    ┌─────────┼─────────┐
    │         │         │
┌───┴───┐ ┌───┴───┐ ┌───┴───┐
│Spoke 1│ │Spoke 2│ │Spoke 3│
│10.1.0 │ │10.2.0 │ │10.3.0 │
└───────┘ └───────┘ └───────┘
```

## Gateway Transit

Share VPN/ExpressRoute gateway across peered VNets.

```bash
# Hub: Allow gateway transit
az network vnet peering update \
    --name hub-to-spoke \
    --vnet-name hub-vnet \
    --resource-group rg-network \
    --set allowGatewayTransit=true

# Spoke: Use remote gateway
az network vnet peering update \
    --name spoke-to-hub \
    --vnet-name spoke-vnet \
    --resource-group rg-network \
    --set useRemoteGateways=true
```

## Important Considerations

| Aspect | Details |
|--------|---------|
| IP overlap | Address spaces cannot overlap |
| Transitivity | Peering is non-transitive (A↔B and B↔C doesn't mean A↔C) |
| Cross-subscription | Supported with proper permissions |
| Pricing | Regional: free; Global: data transfer charges |

## Verifying Connectivity

```bash
# Check peering status
az network vnet peering show \
    --name VNet1-to-VNet2 \
    --vnet-name VNet1 \
    --resource-group rg-network \
    --query peeringState

# Should return "Connected"
```

VNet peering is the foundation of Azure network architecture.
