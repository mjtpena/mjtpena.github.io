---
title: "Azure Private DNS Zones: Name Resolution in VNets"
description: "The first time a Private Endpoint refused to resolve correctly because the VNet was using Azure-provided DNS, I learned this lesson the hard way: private…"
author: Michael John Peña
draft: false
date: 2020-11-18
tags:
  - Azure
  - DNS
  - Networking
  - Private Link
---

The first time a Private Endpoint refused to resolve correctly because the VNet was using Azure-provided DNS, I learned this lesson the hard way: private connectivity is a DNS problem more often than a networking one. Private DNS Zones are how you fix it. Custom internal domains, automatic registration of VMs, and the linkage that makes Private Endpoints actually private end to end.

## Creating Private DNS Zone

```bash
# Create private DNS zone
az network private-dns zone create \
    --resource-group myRG \
    --name privatelink.blob.core.windows.net

# Link to VNet
az network private-dns link vnet create \
    --resource-group myRG \
    --zone-name privatelink.blob.core.windows.net \
    --name vnet-link \
    --virtual-network myVNet \
    --registration-enabled false
```

## Custom Private DNS

```bash
# Create zone for internal services
az network private-dns zone create \
    --resource-group myRG \
    --name internal.mycompany.com

# Link to VNet with auto-registration
az network private-dns link vnet create \
    --resource-group myRG \
    --zone-name internal.mycompany.com \
    --name vnet-link \
    --virtual-network myVNet \
    --registration-enabled true
```

## DNS Records

```bash
# A record
az network private-dns record-set a create \
    --resource-group myRG \
    --zone-name internal.mycompany.com \
    --name api

az network private-dns record-set a add-record \
    --resource-group myRG \
    --zone-name internal.mycompany.com \
    --record-set-name api \
    --ipv4-address 10.0.1.50

# CNAME record
az network private-dns record-set cname create \
    --resource-group myRG \
    --zone-name internal.mycompany.com \
    --name www

az network private-dns record-set cname set-record \
    --resource-group myRG \
    --zone-name internal.mycompany.com \
    --record-set-name www \
    --cname api.internal.mycompany.com
```

## Private Endpoints DNS

```bash
# Create private endpoint for storage
az network private-endpoint create \
    --name storage-endpoint \
    --resource-group myRG \
    --vnet-name myVNet \
    --subnet private-endpoints \
    --private-connection-resource-id $(az storage account show -n mystorageaccount -g myRG --query id -o tsv) \
    --group-id blob \
    --connection-name storage-connection

# Create DNS zone group (auto-manages A records)
az network private-endpoint dns-zone-group create \
    --endpoint-name storage-endpoint \
    --resource-group myRG \
    --name default \
    --private-dns-zone $(az network private-dns zone show -g myRG -n privatelink.blob.core.windows.net --query id -o tsv) \
    --zone-name privatelink.blob.core.windows.net
```

## Common Private Link Zones

| Service | DNS Zone |
|---------|----------|
| Blob Storage | privatelink.blob.core.windows.net |
| SQL Database | privatelink.database.windows.net |
| Key Vault | privatelink.vaultcore.azure.net |
| Cosmos DB | privatelink.documents.azure.com |
| ACR | privatelink.azurecr.io |
| Event Hubs | privatelink.servicebus.windows.net |

## Split-Horizon DNS

```
Public DNS (internet)          Private DNS (VNet)
┌──────────────────┐          ┌──────────────────┐
│ api.company.com  │          │ api.company.com  │
│ → 203.0.113.50   │          │ → 10.0.1.50      │
│ (Public IP)      │          │ (Private IP)     │
└──────────────────┘          └──────────────────┘
```

## Terraform Configuration

```hcl
resource "azurerm_private_dns_zone" "internal" {
  name                = "internal.mycompany.com"
  resource_group_name = azurerm_resource_group.rg.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "link" {
  name                  = "vnet-link"
  resource_group_name   = azurerm_resource_group.rg.name
  private_dns_zone_name = azurerm_private_dns_zone.internal.name
  virtual_network_id    = azurerm_virtual_network.vnet.id
  registration_enabled  = true
}

resource "azurerm_private_dns_a_record" "api" {
  name                = "api"
  zone_name           = azurerm_private_dns_zone.internal.name
  resource_group_name = azurerm_resource_group.rg.name
  ttl                 = 300
  records             = ["10.0.1.50"]
}
```

## DNS Forwarding

For hybrid scenarios with on-premises DNS:

```bash
# Azure DNS Private Resolver
az dns-resolver create \
    --name my-resolver \
    --resource-group myRG \
    --location eastus \
    --id /subscriptions/.../virtualNetworks/myVNet

# Inbound endpoint (on-prem → Azure)
az dns-resolver inbound-endpoint create \
    --name inbound \
    --dns-resolver-name my-resolver \
    --resource-group myRG \
    --ip-configurations '[{"private-ip-address":"10.0.1.4","private-ip-allocation-method":"Static","subnet":{"id":"/subscriptions/.../subnets/dns-inbound"}}]'
```

Private DNS: seamless name resolution for private networks.
