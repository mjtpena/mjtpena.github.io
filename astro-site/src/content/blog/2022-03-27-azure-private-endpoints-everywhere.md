---
title: "Private Endpoints Everywhere: Securing Your Azure Data Platform"
author: Michael John Peña
draft: false
date: 2022-03-27
tags:
  - Azure
  - Private Endpoints
  - Networking
  - Security
  - Data Engineering

---

I wrote "Private Endpoints Everywhere: Securing Your Azure Data Platform" to share practical, production-minded guidance on this topic.

## Understanding Private Endpoints

A private endpoint:
- Creates a network interface with a private IP in your VNet
- Maps to a specific Azure resource (or sub-resource)
- Enables DNS resolution to the private IP
- Blocks public access when properly configured

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Virtual Network                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ PE: Storage │  │ PE: SQL DB  │  │ PE: Key Vault│     │
│  │ 10.0.1.4    │  │ 10.0.1.5    │  │ 10.0.1.6    │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                │                │             │
│  ┌──────┴────────────────┴────────────────┴──────┐     │
│  │              Private DNS Zones                  │     │
│  │ privatelink.blob.core.windows.net              │     │
│  │ privatelink.database.windows.net               │     │
│  │ privatelink.vaultcore.azure.net                │     │
│  └────────────────────────────────────────────────┘     │
│                          │                              │
│  ┌───────────────────────┴────────────────────────┐    │
│  │              Data Factory / Databricks          │    │
│  │              (Managed VNet or VNet Injected)    │    │
│  └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Creating Private Endpoints

### Azure Storage

```bash
# Create private endpoint for blob
az network private-endpoint create \
    --name storage-pe \
    --resource-group myRG \
    --vnet-name myVNet \
    --subnet data-subnet \
    --private-connection-resource-id "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Storage/storageAccounts/mystorageaccount" \
    --group-id blob \
    --connection-name storage-connection

# Create private endpoint for dfs (Data Lake)
az network private-endpoint create \
    --name storage-dfs-pe \
    --resource-group myRG \
    --vnet-name myVNet \
    --subnet data-subnet \
    --private-connection-resource-id "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Storage/storageAccounts/mystorageaccount" \
    --group-id dfs \
    --connection-name storage-dfs-connection
```

### Azure SQL Database

```bash
az network private-endpoint create \
    --name sql-pe \
    --resource-group myRG \
    --vnet-name myVNet \
    --subnet data-subnet \
    --private-connection-resource-id "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Sql/servers/mysqlserver" \
    --group-id sqlServer \
    --connection-name sql-connection
```

### Azure Key Vault

```bash
az network private-endpoint create \
    --name keyvault-pe \
    --resource-group myRG \
    --vnet-name myVNet \
    --subnet data-subnet \
    --private-connection-resource-id "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.KeyVault/vaults/mykeyvault" \
    --group-id vault \
    --connection-name keyvault-connection
```

## Terraform Configuration

```hcl
# Private Endpoint Module
module "private_endpoint" {
  source = "./modules/private_endpoint"

  for_each = {
    storage_blob = {
      resource_id     = azurerm_storage_account.main.id
      subresource_name = "blob"
      dns_zone_id     = azurerm_private_dns_zone.blob.id
    }
    storage_dfs = {
      resource_id     = azurerm_storage_account.main.id
      subresource_name = "dfs"
      dns_zone_id     = azurerm_private_dns_zone.dfs.id
    }
    sql = {
      resource_id     = azurerm_mssql_server.main.id
      subresource_name = "sqlServer"
      dns_zone_id     = azurerm_private_dns_zone.sql.id
    }
    keyvault = {
      resource_id     = azurerm_key_vault.main.id
      subresource_name = "vault"
      dns_zone_id     = azurerm_private_dns_zone.vault.id
    }
  }

  name                = "pe-${each.key}"
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = azurerm_subnet.data.id
  resource_id         = each.value.resource_id
  subresource_name    = each.value.subresource_name
  dns_zone_id         = each.value.dns_zone_id
}

# Module definition
resource "azurerm_private_endpoint" "this" {
  name                = var.name
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = var.subnet_id

  private_service_connection {
    name                           = "${var.name}-connection"
    private_connection_resource_id = var.resource_id
    is_manual_connection           = false
    subresource_names             = [var.subresource_name]
  }

  private_dns_zone_group {
    name                 = "dns-zone-group"
    private_dns_zone_ids = [var.dns_zone_id]
  }
}
```

## DNS Configuration

### Private DNS Zones

```bash
# Create private DNS zones
zones=(
    "privatelink.blob.core.windows.net"
    "privatelink.dfs.core.windows.net"
    "privatelink.database.windows.net"
    "privatelink.vaultcore.azure.net"
    "privatelink.datafactory.azure.net"
    "privatelink.adf.azure.com"
    "privatelink.azuredatabricks.net"
)

for zone in "${zones[@]}"; do
    az network private-dns zone create \
        --resource-group myRG \
        --name "$zone"

    # Link to VNet
    az network private-dns link vnet create \
        --resource-group myRG \
        --zone-name "$zone" \
        --name "vnet-link" \
        --virtual-network myVNet \
        --registration-enabled false
done
```

### DNS Zone Configuration (Terraform)

```hcl
locals {
  dns_zones = {
    blob       = "privatelink.blob.core.windows.net"
    dfs        = "privatelink.dfs.core.windows.net"
    sql        = "privatelink.database.windows.net"
    vault      = "privatelink.vaultcore.azure.net"
    datafactory = "privatelink.datafactory.azure.net"
    synapse    = "privatelink.sql.azuresynapse.net"
    databricks = "privatelink.azuredatabricks.net"
  }
}

resource "azurerm_private_dns_zone" "zones" {
  for_each            = local.dns_zones
  name                = each.value
  resource_group_name = var.resource_group_name
}

resource "azurerm_private_dns_zone_virtual_network_link" "links" {
  for_each              = local.dns_zones
  name                  = "vnet-link-${each.key}"
  resource_group_name   = var.resource_group_name
  private_dns_zone_name = azurerm_private_dns_zone.zones[each.key].name
  virtual_network_id    = azurerm_virtual_network.main.id
  registration_enabled  = false
}
```

## Disabling Public Access

After private endpoints are configured, disable public access:

### Storage Account

```bash
az storage account update \
    --name mystorageaccount \
    --resource-group myRG \
    --public-network-access Disabled
```

### Azure SQL

```bash
az sql server update \
    --name mysqlserver \
    --resource-group myRG \
    --public-network-access Disabled
```

### Key Vault

```bash
az keyvault update \
    --name mykeyvault \
    --resource-group myRG \
    --public-network-access Disabled
```

## Private Endpoints for Data Services

### Azure Databricks

```hcl
resource "azurerm_databricks_workspace" "this" {
  name                        = "databricks-private"
  resource_group_name         = var.resource_group_name
  location                    = var.location
  sku                         = "premium"

  public_network_access_enabled         = false
  network_security_group_rules_required = "NoAzureDatabricksRules"

  custom_parameters {
    no_public_ip                                         = true
    virtual_network_id                                   = azurerm_virtual_network.main.id
    private_subnet_name                                  = azurerm_subnet.databricks_private.name
    public_subnet_name                                   = azurerm_subnet.databricks_public.name
    private_subnet_network_security_group_association_id = azurerm_subnet_network_security_group_association.private.id
    public_subnet_network_security_group_association_id  = azurerm_subnet_network_security_group_association.public.id
  }
}

# Private endpoints for Databricks
resource "azurerm_private_endpoint" "databricks_ui" {
  name                = "pe-databricks-ui"
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = azurerm_subnet.endpoints.id

  private_service_connection {
    name                           = "databricks-ui-connection"
    private_connection_resource_id = azurerm_databricks_workspace.this.id
    subresource_names             = ["databricks_ui_api"]
    is_manual_connection           = false
  }
}
```

### Azure Synapse Analytics

```hcl
resource "azurerm_synapse_workspace" "this" {
  name                                 = "synapse-private"
  resource_group_name                  = var.resource_group_name
  location                             = var.location
  storage_data_lake_gen2_filesystem_id = azurerm_storage_data_lake_gen2_filesystem.synapse.id
  sql_administrator_login              = var.sql_admin_user
  sql_administrator_login_password     = var.sql_admin_password

  managed_virtual_network_enabled = true

  identity {
    type = "SystemAssigned"
  }
}

# Private endpoints for Synapse
resource "azurerm_synapse_managed_private_endpoint" "storage" {
  name                 = "pe-storage"
  synapse_workspace_id = azurerm_synapse_workspace.this.id
  target_resource_id   = azurerm_storage_account.main.id
  subresource_name     = "dfs"
}
```

## Testing Connectivity

```python
# Python script to test private endpoint connectivity
import socket
import dns.resolver

def test_private_dns(hostname):
    """Verify DNS resolves to private IP"""
    try:
        answers = dns.resolver.resolve(hostname, 'A')
        for rdata in answers:
            ip = str(rdata)
            print(f"{hostname} -> {ip}")
            # Check if IP is private
            if ip.startswith(('10.', '172.', '192.168.')):
                print("  [OK] Resolves to private IP")
            else:
                print("  [WARN] Resolves to public IP")
    except Exception as e:
        print(f"DNS resolution failed: {e}")

# Test your resources
test_private_dns("mystorageaccount.blob.core.windows.net")
test_private_dns("mysqlserver.database.windows.net")
test_private_dns("mykeyvault.vault.azure.net")
```

## Network Security Groups

```hcl
resource "azurerm_network_security_group" "private_endpoints" {
  name                = "nsg-private-endpoints"
  location            = var.location
  resource_group_name = var.resource_group_name

  # Allow all VNet traffic
  security_rule {
    name                       = "AllowVNetInbound"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "VirtualNetwork"
    destination_address_prefix = "VirtualNetwork"
  }

  # Deny all other inbound
  security_rule {
    name                       = "DenyAllInbound"
    priority                   = 4096
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}
```

## Best Practices

1. **Create DNS zones first**: Ensure DNS is ready before creating endpoints
2. **Use consistent naming**: pe-{service}-{resource}
3. **Disable public access**: After verifying private connectivity
4. **Monitor endpoint health**: Use Azure Monitor for connection status
5. **Document subnet usage**: Track which subnets host which endpoints
6. **Use managed identities**: Combine with private endpoints for credential-free access

## Conclusion

Private endpoints are essential for secure Azure data platforms:
- Eliminate public internet exposure
- Enable compliance with data residency requirements
- Reduce attack surface
- Maintain full functionality

Plan your private endpoint strategy early - retrofitting is possible but adds complexity.

## Resources

- [Private Endpoint Documentation](https://docs.microsoft.com/en-us/azure/private-link/private-endpoint-overview)
- [Private DNS Zones](https://docs.microsoft.com/en-us/azure/private-link/private-endpoint-dns)
- [Azure Private Link](https://docs.microsoft.com/en-us/azure/private-link/)

