---
title: Azure Private DNS Zones for Internal Name Resolution
author: Michael John Peña
draft: false
date: 2021-07-13
url: /blog/private-dns-zones/
tags:
  - Azure
  - Networking
  - DNS
  - Private Link
  - Infrastructure
---

## Creating Private DNS Zones

Set up a private DNS zone for your organization:

```bash
# Create private DNS zone
az network private-dns zone create \
    --resource-group rg-dns \
    --name contoso.internal

# Link DNS zone to virtual network
az network private-dns link vnet create \
    --resource-group rg-dns \
    --zone-name contoso.internal \
    --name hub-vnet-link \
    --virtual-network /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-networking/providers/Microsoft.Network/virtualNetworks/vnet-hub \
    --registration-enabled true

# Create DNS records
az network private-dns record-set a create \
    --resource-group rg-dns \
    --zone-name contoso.internal \
    --name api

az network private-dns record-set a add-record \
    --resource-group rg-dns \
    --zone-name contoso.internal \
    --record-set-name api \
    --ipv4-address 10.0.1.10
```

## Terraform Configuration

Complete Private DNS setup with Terraform:

```hcl
# Private DNS Zone
resource "azurerm_private_dns_zone" "internal" {
  name                = "contoso.internal"
  resource_group_name = azurerm_resource_group.dns.name

  tags = {
    Environment = "Production"
    ManagedBy   = "Terraform"
  }
}

# Link to Hub VNet with auto-registration
resource "azurerm_private_dns_zone_virtual_network_link" "hub" {
  name                  = "hub-vnet-link"
  resource_group_name   = azurerm_resource_group.dns.name
  private_dns_zone_name = azurerm_private_dns_zone.internal.name
  virtual_network_id    = azurerm_virtual_network.hub.id
  registration_enabled  = true

  tags = {
    Environment = "Production"
  }
}

# Link to Spoke VNets (without auto-registration)
resource "azurerm_private_dns_zone_virtual_network_link" "spokes" {
  for_each = toset(["app", "data", "dev"])

  name                  = "${each.key}-vnet-link"
  resource_group_name   = azurerm_resource_group.dns.name
  private_dns_zone_name = azurerm_private_dns_zone.internal.name
  virtual_network_id    = azurerm_virtual_network.spoke[each.key].id
  registration_enabled  = false

  tags = {
    Environment = "Production"
    Spoke       = each.key
  }
}

# A Records
resource "azurerm_private_dns_a_record" "services" {
  for_each = {
    "api"      = "10.0.1.10"
    "web"      = "10.0.1.20"
    "database" = "10.0.2.10"
    "cache"    = "10.0.2.20"
  }

  name                = each.key
  zone_name           = azurerm_private_dns_zone.internal.name
  resource_group_name = azurerm_resource_group.dns.name
  ttl                 = 300
  records             = [each.value]
}

# CNAME Records
resource "azurerm_private_dns_cname_record" "aliases" {
  for_each = {
    "www"     = "web.contoso.internal"
    "backend" = "api.contoso.internal"
  }

  name                = each.key
  zone_name           = azurerm_private_dns_zone.internal.name
  resource_group_name = azurerm_resource_group.dns.name
  ttl                 = 300
  record              = each.value
}
```

## Private DNS Zones for Private Link

Create DNS zones for Azure Private Link services:

```hcl
# Private DNS zones for Azure services
locals {
  private_link_dns_zones = {
    "blob"          = "privatelink.blob.core.windows.net"
    "file"          = "privatelink.file.core.windows.net"
    "queue"         = "privatelink.queue.core.windows.net"
    "table"         = "privatelink.table.core.windows.net"
    "dfs"           = "privatelink.dfs.core.windows.net"
    "sql"           = "privatelink.database.windows.net"
    "cosmos_sql"    = "privatelink.documents.azure.com"
    "keyvault"      = "privatelink.vaultcore.azure.net"
    "acr"           = "privatelink.azurecr.io"
    "eventhub"      = "privatelink.servicebus.windows.net"
    "servicebus"    = "privatelink.servicebus.windows.net"
    "cognitive"     = "privatelink.cognitiveservices.azure.com"
    "datafactory"   = "privatelink.datafactory.azure.net"
    "synapse"       = "privatelink.sql.azuresynapse.net"
    "synapse_dev"   = "privatelink.dev.azuresynapse.net"
  }
}

resource "azurerm_private_dns_zone" "private_link" {
  for_each = local.private_link_dns_zones

  name                = each.value
  resource_group_name = azurerm_resource_group.dns.name

  tags = {
    Purpose = "Private Link"
    Service = each.key
  }
}

resource "azurerm_private_dns_zone_virtual_network_link" "private_link" {
  for_each = local.private_link_dns_zones

  name                  = "hub-link-${each.key}"
  resource_group_name   = azurerm_resource_group.dns.name
  private_dns_zone_name = azurerm_private_dns_zone.private_link[each.key].name
  virtual_network_id    = azurerm_virtual_network.hub.id
  registration_enabled  = false
}
```

## Creating Private Endpoints with DNS

Integrate private endpoints with DNS zones:

```python
from azure.mgmt.network import NetworkManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
network_client = NetworkManagementClient(credential, subscription_id)

def create_private_endpoint_with_dns(config):
    """Create private endpoint and configure DNS."""

    # Create private endpoint
    pe = network_client.private_endpoints.begin_create_or_update(
        resource_group_name=config["resource_group"],
        private_endpoint_name=config["pe_name"],
        parameters={
            "location": config["location"],
            "properties": {
                "subnet": {
                    "id": config["subnet_id"]
                },
                "privateLinkServiceConnections": [{
                    "name": f"{config['pe_name']}-connection",
                    "properties": {
                        "privateLinkServiceId": config["target_resource_id"],
                        "groupIds": config["group_ids"]
                    }
                }]
            }
        }
    ).result()

    # Get private IP from the endpoint
    private_ip = pe.custom_dns_configs[0].ip_addresses[0]

    # Create DNS record in private DNS zone
    from azure.mgmt.privatedns import PrivateDnsManagementClient
    dns_client = PrivateDnsManagementClient(credential, subscription_id)

    dns_client.record_sets.create_or_update(
        resource_group_name=config["dns_resource_group"],
        private_zone_name=config["dns_zone_name"],
        relative_record_set_name=config["dns_record_name"],
        record_type="A",
        parameters={
            "ttl": 300,
            "a_records": [{"ipv4_address": private_ip}]
        }
    )

    return pe, private_ip

# Create private endpoint for Storage Account
storage_pe = create_private_endpoint_with_dns({
    "resource_group": "rg-privatelink",
    "pe_name": "pe-storage-blob",
    "location": "eastus",
    "subnet_id": f"/subscriptions/{subscription_id}/resourceGroups/rg-networking/providers/Microsoft.Network/virtualNetworks/vnet-hub/subnets/subnet-privatelink",
    "target_resource_id": f"/subscriptions/{subscription_id}/resourceGroups/rg-storage/providers/Microsoft.Storage/storageAccounts/mystorageaccount",
    "group_ids": ["blob"],
    "dns_resource_group": "rg-dns",
    "dns_zone_name": "privatelink.blob.core.windows.net",
    "dns_record_name": "mystorageaccount"
})
```

## Auto-Registration

Enable automatic DNS registration for VMs:

```hcl
# VNet link with auto-registration
resource "azurerm_private_dns_zone_virtual_network_link" "auto_register" {
  name                  = "vnet-auto-register"
  resource_group_name   = azurerm_resource_group.dns.name
  private_dns_zone_name = azurerm_private_dns_zone.internal.name
  virtual_network_id    = azurerm_virtual_network.hub.id
  registration_enabled  = true  # VMs will auto-register
}

# When a VM is created in this VNet, its hostname will be
# automatically registered in the DNS zone
resource "azurerm_linux_virtual_machine" "example" {
  name                = "vm-web-01"
  resource_group_name = azurerm_resource_group.compute.name
  location            = azurerm_resource_group.compute.location
  size                = "Standard_D2s_v3"

  # VM will be accessible as: vm-web-01.contoso.internal
  computer_name = "vm-web-01"

  network_interface_ids = [azurerm_network_interface.example.id]

  # ... other VM configuration
}
```

## DNS Forwarding

Set up DNS forwarding for hybrid scenarios:

```python
# Configure Azure Firewall as DNS proxy
def configure_dns_forwarding(firewall_policy_name, resource_group, dns_servers):
    """Configure Azure Firewall DNS settings for forwarding."""

    from azure.mgmt.network import NetworkManagementClient

    network_client = NetworkManagementClient(credential, subscription_id)

    # Get firewall policy
    policy = network_client.firewall_policies.get(resource_group, firewall_policy_name)

    # Update DNS settings
    policy.dns_settings = {
        "servers": dns_servers,  # On-premises DNS servers
        "enable_proxy": True
    }

    result = network_client.firewall_policies.begin_create_or_update(
        resource_group,
        firewall_policy_name,
        policy
    ).result()

    return result

# Configure forwarding to on-premises DNS
configure_dns_forwarding(
    "firewall-policy-hub",
    "rg-networking",
    ["192.168.1.10", "192.168.1.11"]  # On-prem DNS servers
)

# Alternative: Using Azure DNS Private Resolver (Preview)
def create_dns_resolver(resource_group, name, vnet_id, location):
    """Create DNS Private Resolver for hybrid DNS."""

    resolver = network_client.dns_resolvers.begin_create_or_update(
        resource_group,
        name,
        {
            "location": location,
            "properties": {
                "virtualNetwork": {
                    "id": vnet_id
                }
            }
        }
    ).result()

    return resolver
```

## Querying DNS Records

Manage DNS records programmatically:

```python
from azure.mgmt.privatedns import PrivateDnsManagementClient

dns_client = PrivateDnsManagementClient(credential, subscription_id)

# List all record sets in a zone
def list_dns_records(resource_group, zone_name):
    records = dns_client.record_sets.list(resource_group, zone_name)

    for record in records:
        print(f"\nRecord: {record.name}")
        print(f"  Type: {record.type.split('/')[-1]}")
        print(f"  TTL: {record.ttl}")

        if record.a_records:
            for a in record.a_records:
                print(f"  A: {a.ipv4_address}")

        if record.cname_record:
            print(f"  CNAME: {record.cname_record.cname}")

        if record.txt_records:
            for txt in record.txt_records:
                print(f"  TXT: {txt.value}")

list_dns_records("rg-dns", "contoso.internal")

# Create SRV record for service discovery
srv_record = dns_client.record_sets.create_or_update(
    resource_group_name="rg-dns",
    private_zone_name="contoso.internal",
    relative_record_set_name="_http._tcp",
    record_type="SRV",
    parameters={
        "ttl": 300,
        "srv_records": [
            {
                "priority": 10,
                "weight": 60,
                "port": 80,
                "target": "web-01.contoso.internal"
            },
            {
                "priority": 10,
                "weight": 40,
                "port": 80,
                "target": "web-02.contoso.internal"
            }
        ]
    }
)
```

## Monitoring DNS

Monitor DNS zone activity:

```bash
# Enable diagnostic logging
az monitor diagnostic-settings create \
    --resource /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-dns/providers/Microsoft.Network/privateDnsZones/contoso.internal \
    --name dns-diagnostics \
    --workspace /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-monitoring/providers/Microsoft.OperationalInsights/workspaces/log-analytics-ws \
    --logs '[
        {
            "category": "RecordSetChangeAuditLogs",
            "enabled": true
        },
        {
            "category": "VirtualNetworkLinkChangeAuditLogs",
            "enabled": true
        }
    ]'
```

```python
# Query DNS audit logs
def query_dns_changes(workspace_id, zone_name, days=7):
    """Query Log Analytics for DNS changes."""

    query = f"""
    AzureDiagnostics
    | where ResourceProvider == "MICROSOFT.NETWORK"
    | where Resource contains "{zone_name}"
    | where TimeGenerated > ago({days}d)
    | project TimeGenerated, OperationName, Resource, CallerIpAddress, ResultType
    | order by TimeGenerated desc
    """

    from azure.monitor.query import LogsQueryClient

    logs_client = LogsQueryClient(credential)
    result = logs_client.query_workspace(workspace_id, query)

    for row in result.tables[0].rows:
        print(f"{row[0]}: {row[1]} - {row[4]}")

    return result
```

## Conclusion

Azure Private DNS zones are fundamental for internal name resolution and Private Link integration. They provide a managed DNS solution that eliminates the need for custom DNS infrastructure while supporting advanced scenarios like auto-registration and hybrid DNS forwarding.

Key points to remember: each zone can be linked to multiple VNets, only one VNet link per zone can have auto-registration enabled, and Private Link services require specific DNS zone names to work correctly. Proper DNS planning is essential for a well-functioning Azure network architecture.
