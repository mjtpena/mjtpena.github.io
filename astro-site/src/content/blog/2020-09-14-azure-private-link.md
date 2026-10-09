---
title: "Azure Private Link: Secure Access to PaaS Services"
description: "By default, Azure PaaS services (Storage, SQL, Cosmos DB) have public endpoints. Even with firewall rules, data transits the public internet."
author: Michael John Peña
draft: false
date: 2020-09-14
tags:
  - Azure
  - Networking
  - Security
  - Private Link
---

## The Problem

By default, Azure PaaS services (Storage, SQL, Cosmos DB) have public endpoints. Even with firewall rules, data transits the public internet.

## Private Endpoint Setup

```hcl
resource "azurerm_private_endpoint" "storage" {
  name                = "storage-private-endpoint"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  subnet_id           = azurerm_subnet.endpoints.id

  private_service_connection {
    name                           = "storage-connection"
    private_connection_resource_id = azurerm_storage_account.main.id
    subresource_names              = ["blob"]
    is_manual_connection           = false
  }
}

resource "azurerm_private_dns_zone" "blob" {
  name                = "privatelink.blob.core.windows.net"
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "blob" {
  name                  = "blob-dns-link"
  resource_group_name   = azurerm_resource_group.main.name
  private_dns_zone_name = azurerm_private_dns_zone.blob.name
  virtual_network_id    = azurerm_virtual_network.main.id
}
```

## How It Works

1. Create private endpoint in your subnet
2. Azure assigns a private IP from your VNet
3. Configure private DNS zone for name resolution
4. Applications resolve to private IP instead of public

## Supported Services

- Azure Storage (blob, file, table, queue)
- Azure SQL Database
- Azure Cosmos DB
- Azure Key Vault
- Azure Container Registry
- Azure Kubernetes Service
- And many more...

## Disable Public Access

```bash
# Disable public access to storage
az storage account update \
    --name mystorageaccount \
    --resource-group myrg \
    --default-action Deny \
    --public-network-access Disabled
```

Now the storage account is only accessible from within your VNet. Zero exposure to the internet.
