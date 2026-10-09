---
title: "Azure DNS Private Resolver: Hybrid DNS for the Cloud Era"
description: "DNS Private Resolver solves this without virtual machines."
author: Michael John Peña
draft: false
date: 2022-03-29
tags:
  - Azure
  - DNS
  - Networking
  - Hybrid Cloud
  - Private Link
---

## The Hybrid DNS Challenge

When using private endpoints:
- Azure Private DNS zones resolve correctly within Azure
- On-premises clients need to resolve Azure private IPs
- Traditional solutions require running DNS servers on VMs

DNS Private Resolver solves this without virtual machines.

## Architecture

```
On-Premises                    Azure
┌─────────────────┐           ┌──────────────────────────────────┐
│                 │           │                                  │
│  ┌───────────┐  │           │  ┌──────────────────────────┐   │
│  │ On-Prem   │  │           │  │  DNS Private Resolver    │   │
│  │   DNS     │  │           │  │                          │   │
│  │  Server   │──┼───────────┼──│  ┌────────┐  ┌────────┐ │   │
│  └───────────┘  │           │  │  │Inbound │  │Outbound│ │   │
│                 │  Conditional │  │Endpoint│  │Endpoint│ │   │
│  Forward        │  Forwarding  │  │10.0.1.4│  │10.0.2.4│ │   │
│  privatelink.*  │           │  │  └────────┘  └────────┘ │   │
│  to 10.0.1.4    │           │  └──────────────────────────┘   │
│                 │           │              │                   │
│                 │           │  ┌───────────┴────────────┐     │
│                 │           │  │  Private DNS Zones     │     │
│                 │           │  │  privatelink.blob...   │     │
│                 │           │  └────────────────────────┘     │
└─────────────────┘           └──────────────────────────────────┘
```

## Creating DNS Private Resolver

### Using Azure CLI

```bash
# Create DNS Private Resolver
az dns-resolver create \
    --name my-dns-resolver \
    --resource-group networking-rg \
    --location eastus \
    --virtual-network-id "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Network/virtualNetworks/hub-vnet"

# Create inbound endpoint (for on-prem to Azure resolution)
az dns-resolver inbound-endpoint create \
    --name inbound-endpoint \
    --dns-resolver-name my-dns-resolver \
    --resource-group networking-rg \
    --location eastus \
    --ip-configurations "[{\"private-ip-address\":\"10.0.1.4\",\"private-ip-allocation-method\":\"Static\",\"id\":\"/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Network/virtualNetworks/hub-vnet/subnets/inbound-subnet\"}]"

# Create outbound endpoint (for Azure to on-prem resolution)
az dns-resolver outbound-endpoint create \
    --name outbound-endpoint \
    --dns-resolver-name my-dns-resolver \
    --resource-group networking-rg \
    --location eastus \
    --subnet-id "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Network/virtualNetworks/hub-vnet/subnets/outbound-subnet"
```

### Terraform Configuration

```hcl
# DNS Private Resolver
resource "azurerm_private_dns_resolver" "this" {
  name                = "dns-resolver"
  resource_group_name = var.resource_group_name
  location            = var.location
  virtual_network_id  = azurerm_virtual_network.hub.id

  tags = var.tags
}

# Inbound Endpoint (on-prem to Azure)
resource "azurerm_private_dns_resolver_inbound_endpoint" "this" {
  name                    = "inbound"
  private_dns_resolver_id = azurerm_private_dns_resolver.this.id
  location                = var.location

  ip_configurations {
    private_ip_allocation_method = "Static"
    private_ip_address           = "10.0.1.4"
    subnet_id                    = azurerm_subnet.inbound.id
  }
}

# Outbound Endpoint (Azure to on-prem)
resource "azurerm_private_dns_resolver_outbound_endpoint" "this" {
  name                    = "outbound"
  private_dns_resolver_id = azurerm_private_dns_resolver.this.id
  location                = var.location
  subnet_id               = azurerm_subnet.outbound.id
}
```

## Subnet Requirements

```hcl
# Inbound endpoint subnet
resource "azurerm_subnet" "inbound" {
  name                 = "snet-dns-inbound"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.hub.name
  address_prefixes     = ["10.0.1.0/28"]

  delegation {
    name = "dns-resolver-delegation"
    service_delegation {
      name    = "Microsoft.Network/dnsResolvers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# Outbound endpoint subnet
resource "azurerm_subnet" "outbound" {
  name                 = "snet-dns-outbound"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.hub.name
  address_prefixes     = ["10.0.2.0/28"]

  delegation {
    name = "dns-resolver-delegation"
    service_delegation {
      name    = "Microsoft.Network/dnsResolvers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}
```

## DNS Forwarding Rules

Create forwarding rules for outbound resolution:

```hcl
# Forwarding ruleset
resource "azurerm_private_dns_resolver_dns_forwarding_ruleset" "this" {
  name                                       = "ruleset"
  resource_group_name                        = var.resource_group_name
  location                                   = var.location
  private_dns_resolver_outbound_endpoint_ids = [azurerm_private_dns_resolver_outbound_endpoint.this.id]
}

# Link ruleset to VNets
resource "azurerm_private_dns_resolver_virtual_network_link" "spoke" {
  for_each                  = var.spoke_vnets
  name                      = "link-${each.key}"
  dns_forwarding_ruleset_id = azurerm_private_dns_resolver_dns_forwarding_ruleset.this.id
  virtual_network_id        = each.value.id
}

# Forwarding rule for on-premises domain
resource "azurerm_private_dns_resolver_forwarding_rule" "onprem" {
  name                      = "onprem-forward"
  dns_forwarding_ruleset_id = azurerm_private_dns_resolver_dns_forwarding_ruleset.this.id
  domain_name               = "corp.contoso.com."
  enabled                   = true

  target_dns_servers {
    ip_address = "192.168.1.10"  # On-prem DNS server
    port       = 53
  }

  target_dns_servers {
    ip_address = "192.168.1.11"  # Secondary on-prem DNS
    port       = 53
  }
}
```

## On-Premises Configuration

### Windows DNS Server

```powershell
# Add conditional forwarder for Azure Private DNS zones
$azureResolverIP = "10.0.1.4"  # Inbound endpoint IP

$privateLinkZones = @(
    "privatelink.blob.core.windows.net",
    "privatelink.dfs.core.windows.net",
    "privatelink.database.windows.net",
    "privatelink.vaultcore.azure.net",
    "privatelink.datafactory.azure.net",
    "privatelink.azuredatabricks.net",
    "privatelink.sql.azuresynapse.net"
)

foreach ($zone in $privateLinkZones) {
    Add-DnsServerConditionalForwarderZone `
        -Name $zone `
        -MasterServers $azureResolverIP `
        -ReplicationScope Forest
}
```

### BIND DNS Server

```bash
# /etc/bind/named.conf.local

zone "privatelink.blob.core.windows.net" {
    type forward;
    forward only;
    forwarders { 10.0.1.4; };
};

zone "privatelink.database.windows.net" {
    type forward;
    forward only;
    forwarders { 10.0.1.4; };
};

zone "privatelink.vaultcore.azure.net" {
    type forward;
    forward only;
    forwarders { 10.0.1.4; };
};

# Add other privatelink zones as needed
```

## Multi-Region Setup

```hcl
locals {
  regions = {
    primary = {
      location = "eastus"
      vnet_id  = azurerm_virtual_network.hub_east.id
    }
    secondary = {
      location = "westus2"
      vnet_id  = azurerm_virtual_network.hub_west.id
    }
  }
}

# Deploy resolver in each region
resource "azurerm_private_dns_resolver" "regional" {
  for_each            = local.regions
  name                = "dns-resolver-${each.key}"
  resource_group_name = var.resource_group_name
  location            = each.value.location
  virtual_network_id  = each.value.vnet_id
}

# Inbound endpoints in each region
resource "azurerm_private_dns_resolver_inbound_endpoint" "regional" {
  for_each                = local.regions
  name                    = "inbound-${each.key}"
  private_dns_resolver_id = azurerm_private_dns_resolver.regional[each.key].id
  location                = each.value.location

  ip_configurations {
    private_ip_allocation_method = "Dynamic"
    subnet_id                    = azurerm_subnet.inbound[each.key].id
  }
}
```

## Integration with Private DNS Zones

```hcl
# Link Private DNS zones to resolver VNet
resource "azurerm_private_dns_zone_virtual_network_link" "resolver" {
  for_each              = var.private_dns_zones
  name                  = "link-resolver"
  resource_group_name   = var.resource_group_name
  private_dns_zone_name = each.value
  virtual_network_id    = azurerm_virtual_network.hub.id
  registration_enabled  = false
}
```

## Testing DNS Resolution

```bash
# From on-premises
nslookup mystorageaccount.blob.core.windows.net
# Should return private IP (e.g., 10.x.x.x)

# From Azure VM
nslookup corp.contoso.com
# Should resolve on-premises resource

# Test with specific DNS server
nslookup mystorageaccount.blob.core.windows.net 10.0.1.4
```

## Monitoring

```python
# Query DNS resolver metrics
from azure.mgmt.monitor import MonitorManagementClient

metrics = monitor_client.metrics.list(
    resource_uri=resolver_resource_id,
    timespan="PT1H",
    interval="PT5M",
    metricnames="InboundEndpointQueriesPerSecond,OutboundEndpointQueriesPerSecond",
    aggregation="Average"
)

for item in metrics.value:
    print(f"{item.name.value}: {item.timeseries[0].data[-1].average} queries/sec")
```

## Troubleshooting

### Common Issues

```bash
# Verify inbound endpoint is reachable
Test-NetConnection -ComputerName 10.0.1.4 -Port 53

# Check DNS resolution path
Resolve-DnsName -Name "mystorageaccount.blob.core.windows.net" -Server 10.0.1.4 -DnsOnly

# Verify Private DNS zone configuration
az network private-dns record-set list \
    --zone-name privatelink.blob.core.windows.net \
    --resource-group dns-rg
```

### DNS Resolution Flow

1. On-prem client queries local DNS
2. Local DNS forwards privatelink.* to Azure resolver
3. Azure resolver queries linked Private DNS zone
4. Private IP returned to client

## Best Practices

1. **Use static IPs**: Configure static IPs for inbound endpoints
2. **Deploy in hub VNet**: Centralize resolver in hub for spoke access
3. **Plan for redundancy**: Deploy in multiple regions
4. **Monitor query rates**: Alert on unusual patterns
5. **Document zones**: Maintain list of all forwarded zones
6. **Test failover**: Verify resolution during outages

## Conclusion

Azure DNS Private Resolver simplifies hybrid DNS:
- No VM-based DNS servers required
- Native integration with Private DNS zones
- Bidirectional resolution (Azure to on-prem and vice versa)
- High availability and managed service

For organizations with hybrid connectivity and private endpoints, DNS Private Resolver is the recommended solution.

## Resources

- [DNS Private Resolver Documentation](https://docs.microsoft.com/en-us/azure/dns/dns-private-resolver-overview)
- [Hybrid DNS with Private Resolver](https://docs.microsoft.com/en-us/azure/dns/dns-private-resolver-get-started-portal)
- [DNS Architecture Patterns](https://docs.microsoft.com/en-us/azure/private-link/private-endpoint-dns)
