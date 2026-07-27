---
title: "Azure ExpressRoute: Private Connectivity to Azure"
author: Michael John Peña
draft: false
date: 2020-11-27
tags:
  - Azure
  - ExpressRoute
  - Networking
  - Hybrid

---

I wrote "Azure ExpressRoute: Private Connectivity to Azure" to share practical, production-minded guidance on this topic.

## ExpressRoute Models

| Model | Description |
|-------|-------------|
| CloudExchange | Co-location at exchange provider |
| Point-to-Point | Ethernet connection to Azure |
| Any-to-Any | MPLS/IPVPN integration |
| ExpressRoute Direct | Direct 10/100 Gbps ports |

## Creating ExpressRoute Circuit

```bash
# Create circuit
az network express-route create \
    --name my-expressroute \
    --resource-group myRG \
    --location eastus \
    --bandwidth 1000 \
    --peering-location "Silicon Valley" \
    --provider "Equinix" \
    --sku-tier Standard \
    --sku-family MeteredData
```

## Peerings

### Azure Private Peering

```bash
# Connect to VNets
az network express-route peering create \
    --circuit-name my-expressroute \
    --resource-group myRG \
    --peering-type AzurePrivatePeering \
    --peer-asn 65100 \
    --primary-peer-subnet 192.168.1.0/30 \
    --secondary-peer-subnet 192.168.2.0/30 \
    --vlan-id 100 \
    --shared-key "secretkey123"
```

### Microsoft Peering

```bash
# Connect to Microsoft 365, Dynamics
az network express-route peering create \
    --circuit-name my-expressroute \
    --resource-group myRG \
    --peering-type MicrosoftPeering \
    --peer-asn 65100 \
    --primary-peer-subnet 203.0.113.0/30 \
    --secondary-peer-subnet 203.0.113.4/30 \
    --vlan-id 200 \
    --advertised-public-prefixes 203.0.113.0/24
```

## Link to Virtual Network

```bash
# Create gateway subnet
az network vnet subnet create \
    --vnet-name myVNet \
    --resource-group myRG \
    --name GatewaySubnet \
    --address-prefix 10.0.255.0/27

# Create ExpressRoute gateway
az network vnet-gateway create \
    --name myERGateway \
    --resource-group myRG \
    --vnet myVNet \
    --gateway-type ExpressRoute \
    --sku Standard

# Create connection
az network vpn-connection create \
    --name myERConnection \
    --resource-group myRG \
    --vnet-gateway myERGateway \
    --express-route-circuit2 /subscriptions/.../expressRouteCircuits/my-expressroute
```

## ExpressRoute Global Reach

Connect circuits across regions:

```bash
az network express-route peering connection create \
    --circuit-name circuit1 \
    --peering-name AzurePrivatePeering \
    --resource-group myRG \
    --name globalreach-connection \
    --peer-circuit /subscriptions/.../expressRouteCircuits/circuit2 \
    --address-prefix 10.0.0.0/29
```

## FastPath

Ultra-low latency for performance-critical workloads:

```bash
az network vpn-connection update \
    --name myERConnection \
    --resource-group myRG \
    --express-route-gateway-bypass true
```

## Redundancy

```
On-Premises          Azure
┌─────────┐         ┌─────────┐
│         │ Circuit1│         │
│  Router ├────────→│ ER GW   │
│    1    │         │    1    │
└─────────┘         └─────────┘
┌─────────┐         ┌─────────┐
│         │ Circuit2│         │
│  Router ├────────→│ ER GW   │
│    2    │         │    2    │
└─────────┘         └─────────┘
```

## Monitoring

```bash
# Get circuit stats
az network express-route get-stats \
    --name my-expressroute \
    --resource-group myRG

# Check peering state
az network express-route peering show \
    --circuit-name my-expressroute \
    --resource-group myRG \
    --name AzurePrivatePeering \
    --query "peeringState"
```

## Bandwidth SKUs

| Bandwidth | Monthly Cost (MeteredData) |
|-----------|---------------------------|
| 50 Mbps | ~$55 |
| 100 Mbps | ~$110 |
| 200 Mbps | ~$220 |
| 500 Mbps | ~$550 |
| 1 Gbps | ~$1,100 |
| 10 Gbps | ~$5,500 |

ExpressRoute: enterprise-grade private connectivity to Azure.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
