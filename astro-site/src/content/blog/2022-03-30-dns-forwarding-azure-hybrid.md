---
title: "DNS Forwarding Strategies for Azure Hybrid Architectures"
author: Michael John Peña
draft: false
date: 2022-03-30
tags:
  - Azure
  - DNS
  - Hybrid Cloud
  - Networking
  - Architecture

---

I wrote "DNS Forwarding Strategies for Azure Hybrid Architectures" to share practical, production-minded guidance on this topic.

## DNS Forwarding Patterns

### Pattern 1: On-Prem Primary, Azure Forward

```
On-Premises DNS (Primary)
         │
         ├── corp.contoso.com (authoritative)
         │
         └── Forward to Azure:
             ├── privatelink.blob.core.windows.net
             ├── privatelink.database.windows.net
             └── *.azure.com (optional)
```

### Pattern 2: Azure Primary, On-Prem Forward

```
Azure DNS Private Resolver (Primary)
         │
         ├── Azure Private DNS Zones (auto-resolved)
         │
         └── Forward to On-Prem:
             ├── corp.contoso.com
             ├── internal.contoso.com
             └── legacy.local
```

### Pattern 3: Split-Horizon DNS

```
Same domain, different resolution based on source:

External Users → Public DNS → Public IPs
Internal Users → Private DNS → Private IPs

Example: api.contoso.com
  External: 52.x.x.x (public)
  Internal: 10.x.x.x (private endpoint)
```

## Implementing Forwarding Rules

### Azure DNS Private Resolver

```hcl
# Forwarding ruleset for outbound queries
resource "azurerm_private_dns_resolver_dns_forwarding_ruleset" "main" {
  name                                       = "forwarding-ruleset"
  resource_group_name                        = var.resource_group_name
  location                                   = var.location
  private_dns_resolver_outbound_endpoint_ids = [azurerm_private_dns_resolver_outbound_endpoint.main.id]
}

# Rule: Forward on-premises domain
resource "azurerm_private_dns_resolver_forwarding_rule" "onprem" {
  name                      = "onprem-domain"
  dns_forwarding_ruleset_id = azurerm_private_dns_resolver_dns_forwarding_ruleset.main.id
  domain_name               = "corp.contoso.com."
  enabled                   = true

  target_dns_servers {
    ip_address = var.onprem_dns_primary
    port       = 53
  }
  target_dns_servers {
    ip_address = var.onprem_dns_secondary
    port       = 53
  }
}

# Rule: Forward legacy domain
resource "azurerm_private_dns_resolver_forwarding_rule" "legacy" {
  name                      = "legacy-domain"
  dns_forwarding_ruleset_id = azurerm_private_dns_resolver_dns_forwarding_ruleset.main.id
  domain_name               = "legacy.local."
  enabled                   = true

  target_dns_servers {
    ip_address = var.legacy_dns
    port       = 53
  }
}

# Link ruleset to VNets that need this resolution
resource "azurerm_private_dns_resolver_virtual_network_link" "spokes" {
  for_each                  = var.spoke_vnets
  name                      = "link-${each.key}"
  dns_forwarding_ruleset_id = azurerm_private_dns_resolver_dns_forwarding_ruleset.main.id
  virtual_network_id        = each.value.id
}
```

### Windows DNS Conditional Forwarders

```powershell
# Configuration script for Windows DNS
param(
    [string]$AzureResolverIP = "10.0.1.4"
)

# Private Link zones to forward
$zones = @(
    "privatelink.blob.core.windows.net",
    "privatelink.dfs.core.windows.net",
    "privatelink.file.core.windows.net",
    "privatelink.queue.core.windows.net",
    "privatelink.table.core.windows.net",
    "privatelink.web.core.windows.net",
    "privatelink.database.windows.net",
    "privatelink.sql.azuresynapse.net",
    "privatelink.dev.azuresynapse.net",
    "privatelink.azuresynapse.net",
    "privatelink.vaultcore.azure.net",
    "privatelink.datafactory.azure.net",
    "privatelink.adf.azure.com",
    "privatelink.azuredatabricks.net",
    "privatelink.documents.azure.com",
    "privatelink.mongo.cosmos.azure.com",
    "privatelink.cassandra.cosmos.azure.com",
    "privatelink.gremlin.cosmos.azure.com",
    "privatelink.table.cosmos.azure.com",
    "privatelink.postgres.database.azure.com",
    "privatelink.mysql.database.azure.com",
    "privatelink.mariadb.database.azure.com",
    "privatelink.redis.cache.windows.net",
    "privatelink.servicebus.windows.net",
    "privatelink.eventgrid.azure.net",
    "privatelink.azurecr.io",
    "privatelink.azurewebsites.net",
    "privatelink.api.azureml.ms",
    "privatelink.notebooks.azure.net",
    "privatelink.purview.azure.com",
    "privatelink.purviewstudio.azure.com",
    "privatelink.search.windows.net",
    "privatelink.cognitiveservices.azure.com",
    "privatelink.openai.azure.com"
)

# Add conditional forwarders
foreach ($zone in $zones) {
    try {
        # Remove existing forwarder if present
        $existing = Get-DnsServerConditionalForwarderZone -Name $zone -ErrorAction SilentlyContinue
        if ($existing) {
            Remove-DnsServerConditionalForwarderZone -Name $zone -Force
        }

        # Add new forwarder
        Add-DnsServerConditionalForwarderZone `
            -Name $zone `
            -MasterServers $AzureResolverIP `
            -ReplicationScope Forest `
            -PassThru

        Write-Host "Added forwarder for $zone" -ForegroundColor Green
    }
    catch {
        Write-Host "Failed to add forwarder for $zone : $_" -ForegroundColor Red
    }
}

Write-Host "DNS forwarding configuration complete"
```

### BIND Configuration

```bash
# /etc/bind/named.conf.options
options {
    directory "/var/cache/bind";

    forwarders {
        8.8.8.8;  # Public DNS for non-forwarded queries
        8.8.4.4;
    };

    forward only;
    dnssec-validation auto;
    listen-on { any; };
    allow-query { any; };
};

# /etc/bind/named.conf.local
# Azure Private Link zones
zone "privatelink.blob.core.windows.net" {
    type forward;
    forward only;
    forwarders { 10.0.1.4; };
};

zone "privatelink.dfs.core.windows.net" {
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

# Add additional zones as needed
# Use include for maintainability
include "/etc/bind/privatelink-zones.conf";
```

## VNet DNS Configuration

### Custom DNS Servers

```hcl
# Configure VNet to use custom DNS
resource "azurerm_virtual_network" "spoke" {
  name                = "spoke-vnet"
  location            = var.location
  resource_group_name = var.resource_group_name
  address_space       = ["10.1.0.0/16"]

  # Point to DNS Private Resolver or custom DNS
  dns_servers = [
    "10.0.1.4",  # Primary (Azure DNS Resolver)
    "10.0.1.5"   # Secondary
  ]
}

# For hub VNet with resolver
resource "azurerm_virtual_network" "hub" {
  name                = "hub-vnet"
  location            = var.location
  resource_group_name = var.resource_group_name
  address_space       = ["10.0.0.0/16"]

  # Use Azure default DNS - resolver handles forwarding
  dns_servers = []  # Azure default
}
```

### Azure Firewall DNS Proxy

```hcl
# Azure Firewall as DNS proxy
resource "azurerm_firewall" "main" {
  name                = "hub-firewall"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku_name            = "AZFW_VNet"
  sku_tier            = "Standard"

  dns_servers = ["10.0.1.4"]  # DNS Resolver
  dns_proxy_enabled   = true

  ip_configuration {
    name                 = "configuration"
    subnet_id            = azurerm_subnet.firewall.id
    public_ip_address_id = azurerm_public_ip.firewall.id
  }
}

# Spoke VNets point to Firewall for DNS
resource "azurerm_virtual_network" "spoke" {
  dns_servers = [azurerm_firewall.main.ip_configuration[0].private_ip_address]
}
```

## Troubleshooting DNS Resolution

### Diagnostic Commands

```bash
# Test resolution from specific server
nslookup mystorageaccount.blob.core.windows.net 10.0.1.4

# Trace DNS resolution path
dig +trace mystorageaccount.blob.core.windows.net

# Check DNS server response
dig @10.0.1.4 mystorageaccount.blob.core.windows.net

# PowerShell detailed resolution
Resolve-DnsName -Name "mystorageaccount.blob.core.windows.net" -DnsOnly -Server 10.0.1.4
```

### Common Issues

```python
# Diagnostic script
import dns.resolver
import socket

def diagnose_dns(hostname, dns_servers):
    results = {}

    for server in dns_servers:
        resolver = dns.resolver.Resolver()
        resolver.nameservers = [server]
        resolver.timeout = 5
        resolver.lifetime = 5

        try:
            answers = resolver.resolve(hostname, 'A')
            ips = [str(rdata) for rdata in answers]
            results[server] = {
                'status': 'success',
                'ips': ips,
                'private': all(ip.startswith(('10.', '172.', '192.168.')) for ip in ips)
            }
        except dns.resolver.NXDOMAIN:
            results[server] = {'status': 'NXDOMAIN'}
        except dns.resolver.NoAnswer:
            results[server] = {'status': 'NoAnswer'}
        except dns.exception.Timeout:
            results[server] = {'status': 'Timeout'}
        except Exception as e:
            results[server] = {'status': 'Error', 'message': str(e)}

    return results

# Test
hostname = "mystorageaccount.blob.core.windows.net"
servers = ["10.0.1.4", "168.63.129.16", "8.8.8.8"]

for server, result in diagnose_dns(hostname, servers).items():
    print(f"{server}: {result}")
```

## Multi-Domain Forwarding

```hcl
# Complex forwarding scenario
locals {
  forwarding_rules = {
    # On-premises domains
    "corp.contoso.com" = {
      servers = ["192.168.1.10", "192.168.1.11"]
      enabled = true
    }
    "internal.contoso.com" = {
      servers = ["192.168.1.10", "192.168.1.11"]
      enabled = true
    }
    # Partner domains
    "partner.example.com" = {
      servers = ["10.100.1.10"]
      enabled = true
    }
    # Legacy systems
    "legacy.local" = {
      servers = ["192.168.100.5"]
      enabled = true
    }
  }
}

resource "azurerm_private_dns_resolver_forwarding_rule" "rules" {
  for_each = local.forwarding_rules

  name                      = replace(each.key, ".", "-")
  dns_forwarding_ruleset_id = azurerm_private_dns_resolver_dns_forwarding_ruleset.main.id
  domain_name               = "${each.key}."
  enabled                   = each.value.enabled

  dynamic "target_dns_servers" {
    for_each = each.value.servers
    content {
      ip_address = target_dns_servers.value
      port       = 53
    }
  }
}
```

## Best Practices

1. **Document all forwarding rules**: Maintain a central registry
2. **Use redundant DNS servers**: Always specify multiple targets
3. **Monitor DNS query latency**: Alert on degradation
4. **Plan zone hierarchy carefully**: Avoid overlapping zones
5. **Test from all network segments**: Verify resolution works everywhere
6. **Implement DNS logging**: Enable diagnostic logs for troubleshooting

## Conclusion

DNS forwarding is the backbone of hybrid Azure architectures:
- Enables seamless resolution across environments
- Supports private endpoint scenarios
- Provides flexibility for complex domain structures

Invest time in proper DNS design - it's foundational for hybrid cloud success.

## Resources

- [Azure DNS Forwarding](https://docs.microsoft.com/en-us/azure/dns/dns-private-resolver-overview)
- [Private Endpoint DNS](https://docs.microsoft.com/en-us/azure/private-link/private-endpoint-dns)
- [DNS Best Practices](https://docs.microsoft.com/en-us/azure/virtual-network/virtual-networks-name-resolution-for-vms-and-role-instances)

