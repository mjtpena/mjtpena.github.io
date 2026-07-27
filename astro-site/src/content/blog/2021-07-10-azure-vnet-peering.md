---
title: Azure Virtual Network Peering - Connecting Your Networks
author: Michael John Peña
draft: false
date: 2021-07-10
url: /blog/azure-vnet-peering/
tags:
  - Azure
  - Networking
  - VNet
  - Infrastructure
  - Cloud Architecture
---

VNet peering is the network connectivity primitive I configure in almost every Azure architecture. The pitch is simple: two virtual networks, connected via Microsoft's backbone, with traffic that never traverses the public internet, at low latency and with no bandwidth limits per connection (you pay egress). The two variants—regional peering within the same region, and global peering across regions—have different latency profiles but otherwise behave identically from a routing perspective. The complexity arrives when you have more than a handful of VNets: the number of peering connections grows as O(n²), hub-spoke topologies avoid that with a central hub VNet, and Azure Virtual WAN extends the hub-spoke model to manage the routing automatically. This post covers the scenarios where direct peering is appropriate and the routing configuration that makes it work correctly.

# Types of VNet Peering

Azure supports two types of peering:

- **Regional VNet Peering**: Connects VNets in the same Azure region
- **Global VNet Peering**: Connects VNets across different Azure regions

# Creating VNet Peering

Set up peering between two virtual networks:

```bash
# Create first virtual network
az network vnet create \
    --resource-group rg-networking \
    --name vnet-hub \
    --address-prefix 10.0.0.0/16 \
    --subnet-name subnet-shared \
    --subnet-prefix 10.0.1.0/24

# Create second virtual network
az network vnet create \
    --resource-group rg-workloads \
    --name vnet-spoke-app \
    --address-prefix 10.1.0.0/16 \
    --subnet-name subnet-app \
    --subnet-prefix 10.1.1.0/24

# Create peering from hub to spoke
az network vnet peering create \
    --resource-group rg-networking \
    --name hub-to-spoke-app \
    --vnet-name vnet-hub \
    --remote-vnet /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-workloads/providers/Microsoft.Network/virtualNetworks/vnet-spoke-app \
    --allow-vnet-access \
    --allow-forwarded-traffic \
    --allow-gateway-transit

# Create peering from spoke to hub
az network vnet peering create \
    --resource-group rg-workloads \
    --name spoke-app-to-hub \
    --vnet-name vnet-spoke-app \
    --remote-vnet /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-networking/providers/Microsoft.Network/virtualNetworks/vnet-hub \
    --allow-vnet-access \
    --allow-forwarded-traffic \
    --use-remote-gateways
```

# Terraform Configuration for Hub-Spoke Topology

Implement a complete hub-spoke network architecture:

```hcl
# Hub Virtual Network
resource "azurerm_virtual_network" "hub" {
  name                = "vnet-hub"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location
  address_space       = ["10.0.0.0/16"]

  tags = {
    Environment = "Production"
    Role        = "Hub"
  }
}

resource "azurerm_subnet" "hub_gateway" {
  name                 = "GatewaySubnet"
  resource_group_name  = azurerm_resource_group.networking.name
  virtual_network_name = azurerm_virtual_network.hub.name
  address_prefixes     = ["10.0.0.0/24"]
}

resource "azurerm_subnet" "hub_firewall" {
  name                 = "AzureFirewallSubnet"
  resource_group_name  = azurerm_resource_group.networking.name
  virtual_network_name = azurerm_virtual_network.hub.name
  address_prefixes     = ["10.0.1.0/24"]
}

resource "azurerm_subnet" "hub_shared" {
  name                 = "SharedServicesSubnet"
  resource_group_name  = azurerm_resource_group.networking.name
  virtual_network_name = azurerm_virtual_network.hub.name
  address_prefixes     = ["10.0.2.0/24"]
}

# Spoke Virtual Networks
resource "azurerm_virtual_network" "spoke" {
  for_each = {
    "app" = {
      address_space = ["10.1.0.0/16"]
      subnets = {
        "web"  = "10.1.1.0/24"
        "api"  = "10.1.2.0/24"
        "data" = "10.1.3.0/24"
      }
    }
    "data" = {
      address_space = ["10.2.0.0/16"]
      subnets = {
        "sql"      = "10.2.1.0/24"
        "analytics" = "10.2.2.0/24"
      }
    }
    "dev" = {
      address_space = ["10.3.0.0/16"]
      subnets = {
        "compute" = "10.3.1.0/24"
      }
    }
  }

  name                = "vnet-spoke-${each.key}"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location
  address_space       = each.value.address_space

  tags = {
    Environment = "Production"
    Role        = "Spoke"
    Workload    = each.key
  }
}

# Hub to Spoke Peering
resource "azurerm_virtual_network_peering" "hub_to_spoke" {
  for_each = azurerm_virtual_network.spoke

  name                         = "hub-to-${each.key}"
  resource_group_name          = azurerm_resource_group.networking.name
  virtual_network_name         = azurerm_virtual_network.hub.name
  remote_virtual_network_id    = each.value.id
  allow_virtual_network_access = true
  allow_forwarded_traffic      = true
  allow_gateway_transit        = true
}

# Spoke to Hub Peering
resource "azurerm_virtual_network_peering" "spoke_to_hub" {
  for_each = azurerm_virtual_network.spoke

  name                         = "${each.key}-to-hub"
  resource_group_name          = azurerm_resource_group.networking.name
  virtual_network_name         = each.value.name
  remote_virtual_network_id    = azurerm_virtual_network.hub.id
  allow_virtual_network_access = true
  allow_forwarded_traffic      = true
  use_remote_gateways          = true

  depends_on = [azurerm_virtual_network_gateway.hub]
}
```

# Global VNet Peering

Connect networks across regions:

```python
from azure.mgmt.network import NetworkManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
network_client = NetworkManagementClient(credential, subscription_id)

# Create global peering between East US and West Europe
def create_global_peering(source_rg, source_vnet, dest_subscription, dest_rg, dest_vnet, peering_name):
    peering = network_client.virtual_network_peerings.begin_create_or_update(
        resource_group_name=source_rg,
        virtual_network_name=source_vnet,
        virtual_network_peering_name=peering_name,
        virtual_network_peering_parameters={
            "properties": {
                "remoteVirtualNetwork": {
                    "id": f"/subscriptions/{dest_subscription}/resourceGroups/{dest_rg}/providers/Microsoft.Network/virtualNetworks/{dest_vnet}"
                },
                "allowVirtualNetworkAccess": True,
                "allowForwardedTraffic": True,
                "allowGatewayTransit": False,
                "useRemoteGateways": False
            }
        }
    ).result()
    return peering

# Create bidirectional global peering
# East US to West Europe
create_global_peering(
    "rg-eastus", "vnet-eastus",
    subscription_id, "rg-westeurope", "vnet-westeurope",
    "eastus-to-westeurope"
)

# West Europe to East US
create_global_peering(
    "rg-westeurope", "vnet-westeurope",
    subscription_id, "rg-eastus", "vnet-eastus",
    "westeurope-to-eastus"
)
```

# Route Tables for Spoke-to-Spoke Communication

Enable communication between spokes through the hub:

```hcl
# Route table for spoke networks
resource "azurerm_route_table" "spoke" {
  for_each = azurerm_virtual_network.spoke

  name                = "rt-spoke-${each.key}"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location

  route {
    name                   = "to-internet"
    address_prefix         = "0.0.0.0/0"
    next_hop_type          = "VirtualAppliance"
    next_hop_in_ip_address = azurerm_firewall.hub.ip_configuration[0].private_ip_address
  }

  # Routes to other spokes through firewall
  dynamic "route" {
    for_each = { for k, v in azurerm_virtual_network.spoke : k => v if k != each.key }
    content {
      name                   = "to-spoke-${route.key}"
      address_prefix         = route.value.address_space[0]
      next_hop_type          = "VirtualAppliance"
      next_hop_in_ip_address = azurerm_firewall.hub.ip_configuration[0].private_ip_address
    }
  }

  # Route to on-premises through gateway
  route {
    name                   = "to-onprem"
    address_prefix         = "192.168.0.0/16"
    next_hop_type          = "VirtualNetworkGateway"
  }
}

# Associate route tables with spoke subnets
resource "azurerm_subnet_route_table_association" "spoke" {
  for_each = {
    for item in flatten([
      for spoke_key, spoke in azurerm_virtual_network.spoke : [
        for subnet_key, subnet in azurerm_subnet.spoke_subnets : {
          spoke_key  = spoke_key
          subnet_key = subnet_key
          subnet_id  = subnet.id
        } if subnet.virtual_network_name == spoke.name
      ]
    ]) : "${item.spoke_key}-${item.subnet_key}" => item
  }

  subnet_id      = each.value.subnet_id
  route_table_id = azurerm_route_table.spoke[each.value.spoke_key].id
}
```

# Cross-Subscription Peering

Peer networks across different subscriptions:

```python
# Subscription A - Owner creates authorization
subscription_a = "subscription-a-id"
subscription_b = "subscription-b-id"

client_a = NetworkManagementClient(credential, subscription_a)
client_b = NetworkManagementClient(credential, subscription_b)

# Get VNet details from both subscriptions
vnet_a = client_a.virtual_networks.get("rg-sub-a", "vnet-sub-a")
vnet_b = client_b.virtual_networks.get("rg-sub-b", "vnet-sub-b")

# Create peering from Subscription A
peering_a = client_a.virtual_network_peerings.begin_create_or_update(
    resource_group_name="rg-sub-a",
    virtual_network_name="vnet-sub-a",
    virtual_network_peering_name="sub-a-to-sub-b",
    virtual_network_peering_parameters={
        "properties": {
            "remoteVirtualNetwork": {
                "id": vnet_b.id
            },
            "allowVirtualNetworkAccess": True,
            "allowForwardedTraffic": True
        }
    }
).result()

# Create peering from Subscription B
peering_b = client_b.virtual_network_peerings.begin_create_or_update(
    resource_group_name="rg-sub-b",
    virtual_network_name="vnet-sub-b",
    virtual_network_peering_name="sub-b-to-sub-a",
    virtual_network_peering_parameters={
        "properties": {
            "remoteVirtualNetwork": {
                "id": vnet_a.id
            },
            "allowVirtualNetworkAccess": True,
            "allowForwardedTraffic": True
        }
    }
).result()

print(f"Peering A status: {peering_a.peering_state}")
print(f"Peering B status: {peering_b.peering_state}")
```

# Monitoring VNet Peering

Monitor peering health and traffic:

```python
from azure.mgmt.monitor import MonitorManagementClient

monitor_client = MonitorManagementClient(credential, subscription_id)

# Check peering status
peerings = network_client.virtual_network_peerings.list("rg-networking", "vnet-hub")

for peering in peerings:
    print(f"Peering: {peering.name}")
    print(f"  State: {peering.peering_state}")
    print(f"  Remote VNet: {peering.remote_virtual_network.id}")
    print(f"  Allow VNet Access: {peering.allow_virtual_network_access}")
    print(f"  Allow Forwarded Traffic: {peering.allow_forwarded_traffic}")
    print(f"  Allow Gateway Transit: {peering.allow_gateway_transit}")
    print(f"  Use Remote Gateways: {peering.use_remote_gateways}")
    print()

# Get VNet metrics
def get_vnet_metrics(resource_group, vnet_name):
    resource_uri = f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/virtualNetworks/{vnet_name}"

    metrics = monitor_client.metrics.list(
        resource_uri=resource_uri,
        metricnames="BytesInPeering,BytesOutPeering",
        timespan="PT1H",
        interval="PT5M",
        aggregation="Total"
    )

    for metric in metrics.value:
        print(f"\n{metric.name.value}:")
        for ts in metric.timeseries:
            for data in ts.data:
                if data.total:
                    print(f"  {data.time_stamp}: {data.total / (1024*1024):.2f} MB")

get_vnet_metrics("rg-networking", "vnet-hub")
```

# Troubleshooting Peering Issues

Diagnose and resolve common peering problems:

```bash
# Check peering status
az network vnet peering show \
    --resource-group rg-networking \
    --vnet-name vnet-hub \
    --name hub-to-spoke-app \
    --query "{state: peeringState, remoteVnet: remoteVirtualNetwork.id}"

# Verify effective routes
az network nic show-effective-route-table \
    --resource-group rg-workloads \
    --name vm-app-nic \
    --output table

# Test connectivity
az network watcher test-ip-flow \
    --resource-group rg-workloads \
    --vm vm-app \
    --direction Outbound \
    --local 10.1.1.4:* \
    --remote 10.0.2.4:443 \
    --protocol TCP

# Check for address space overlaps
az network vnet list \
    --query "[].{name: name, addressSpace: addressSpace.addressPrefixes}" \
    --output table
```

# Conclusion

Azure VNet peering is a fundamental building block for cloud network architectures. Whether you are implementing a simple hub-spoke topology or complex multi-region, multi-subscription networks, understanding peering options and configurations is essential.

Key points to remember: peering is non-transitive by default, address spaces cannot overlap, and both sides of the peering must be configured. With proper route tables and network virtual appliances, you can enable sophisticated traffic flows while maintaining security and performance.
