---
title: "Azure Virtual WAN: Enterprise-Scale Networking"
description: "The hub-and-spoke topology I've drawn on whiteboards for years is what Virtual WAN turns into a deployable resource. A managed hub per region, automatic…"
author: Michael John Peña
draft: false
date: 2020-12-08
tags:
  - Azure
  - Virtual WAN
  - Networking
  - Enterprise
---

The hub-and-spoke topology I've drawn on whiteboards for years is what Virtual WAN turns into a deployable resource. A managed hub per region, automatic transit between VNets, branch connectivity (VPN, ExpressRoute, SD-WAN), and—if you want—Azure Firewall in the same hub. For multi-region enterprises, it removes a lot of the bespoke route-table tetris that used to be a quarterly maintenance chore.

## Virtual WAN Architecture

```
                    ┌─────────────────────────────────┐
                    │        Azure Virtual WAN        │
                    │                                 │
    ┌───────────────┼───────────────┬────────────────┤
    │               │               │                │
┌───┴───┐      ┌───┴───┐      ┌───┴───┐       ┌───┴───┐
│Hub US │      │Hub EU │      │Hub Asia│       │Hub AU │
│       │      │       │      │        │       │       │
└───┬───┘      └───┬───┘      └───┬───┘       └───┬───┘
    │              │              │               │
┌───┴───┐      ┌───┴───┐      ┌───┴───┐       ┌───┴───┐
│ VNets │      │ VNets │      │ VNets  │       │ VNets │
│Branches│     │Branches│     │Branches│       │Branches│
└───────┘      └───────┘      └────────┘       └───────┘
```

## Creating Virtual WAN

```bash
# Create Virtual WAN
az network vwan create \
    --name my-vwan \
    --resource-group myRG \
    --type Standard \
    --disable-vpn-encryption false

# Create hub
az network vhub create \
    --name hub-eastus \
    --resource-group myRG \
    --vwan my-vwan \
    --location eastus \
    --address-prefix 10.1.0.0/24
```

## VPN Gateway (Site-to-Site)

```bash
# Create VPN gateway in hub
az network vpn-gateway create \
    --name vpn-gateway-eastus \
    --resource-group myRG \
    --vhub hub-eastus \
    --scale-unit 1

# Create VPN site (branch)
az network vpn-site create \
    --name branch-office-ny \
    --resource-group myRG \
    --virtual-wan my-vwan \
    --address-prefixes 192.168.1.0/24 \
    --device-vendor Cisco \
    --ip-address 203.0.113.50 \
    --link-speed-in-mbps 100

# Connect site to gateway
az network vpn-gateway connection create \
    --name connection-ny \
    --resource-group myRG \
    --gateway-name vpn-gateway-eastus \
    --remote-vpn-site branch-office-ny \
    --shared-key "supersecretkey"
```

## ExpressRoute Gateway

```bash
# Create ExpressRoute gateway
az network express-route-gateway create \
    --name er-gateway-eastus \
    --resource-group myRG \
    --vhub hub-eastus \
    --scale-units 1

# Connect ExpressRoute circuit
az network express-route-gateway connection create \
    --name er-connection \
    --resource-group myRG \
    --gateway-name er-gateway-eastus \
    --peering /subscriptions/.../peerings/AzurePrivatePeering
```

## Connect VNets

```bash
# Connect VNet to hub
az network vhub connection create \
    --name vnet-connection \
    --resource-group myRG \
    --vhub-name hub-eastus \
    --remote-vnet /subscriptions/.../virtualNetworks/my-vnet \
    --enable-internet-security true
```

## Routing

```bash
# Create custom route table
az network vhub route-table create \
    --name custom-routes \
    --resource-group myRG \
    --vhub-name hub-eastus \
    --labels production

# Add static route
az network vhub route-table route add \
    --name to-firewall \
    --resource-group myRG \
    --vhub-name hub-eastus \
    --route-table-name custom-routes \
    --destinations 0.0.0.0/0 \
    --destination-type CIDR \
    --next-hop /subscriptions/.../azureFirewalls/my-firewall
```

## Secured Hub (with Azure Firewall)

```bash
# Create Azure Firewall in hub
az network firewall create \
    --name hub-firewall \
    --resource-group myRG \
    --vhub hub-eastus \
    --sku AZFW_Hub \
    --public-ip-count 1
```

## Point-to-Site VPN

```bash
# Create P2S gateway
az network p2s-vpn-gateway create \
    --name p2s-gateway \
    --resource-group myRG \
    --vhub hub-eastus \
    --scale-unit 1 \
    --vpn-server-config /subscriptions/.../vpnServerConfigurations/my-config
```

## Global Transit

With hub mesh enabled:
- Any-to-any connectivity
- Branch-to-branch via Azure
- VNet-to-VNet across regions

```bash
# Enable hub-to-hub
az network vwan update \
    --name my-vwan \
    --resource-group myRG \
    --allow-vnet-to-vnet-traffic true \
    --allow-branch-to-branch-traffic true
```

Virtual WAN: software-defined WAN for the cloud era.
