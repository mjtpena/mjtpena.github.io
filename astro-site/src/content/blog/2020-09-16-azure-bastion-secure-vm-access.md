---
title: "Azure Bastion: Secure VM Access Without Public IPs"
author: Michael John Peña
draft: false
date: 2020-09-16
tags:
  - Azure
  - Security
  - Bastion
  - VMs

---

I wrote "Azure Bastion: Secure VM Access Without Public IPs" to share practical, production-minded guidance on this topic.

## The Security Problem

Traditional VM access:
1. Public IP on VM
2. NSG allowing 3389 (RDP) or 22 (SSH)
3. Constant brute-force attempts
4. Jump box management overhead

## Bastion Architecture

```
User → Azure Portal → Bastion (in AzureBastionSubnet) → VM (private IP only)
```

## Deployment

```hcl
resource "azurerm_subnet" "bastion" {
  name                 = "AzureBastionSubnet"  # Must be this exact name
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.255.0/27"]  # Minimum /27
}

resource "azurerm_public_ip" "bastion" {
  name                = "bastion-pip"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_bastion_host" "main" {
  name                = "mybastion"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  ip_configuration {
    name                 = "configuration"
    subnet_id            = azurerm_subnet.bastion.id
    public_ip_address_id = azurerm_public_ip.bastion.id
  }
}
```

## Usage

1. Navigate to VM in Azure portal
2. Click "Connect" → "Bastion"
3. Enter credentials
4. Browser opens RDP/SSH session

## Benefits

- No public IPs on VMs
- No NSG rules for RDP/SSH
- Azure AD authentication support
- Session recording (audit)
- No client software needed

## Premium Features

- Native client support (not just browser)
- File transfer
- Shareable links

The extra cost of Bastion is worth the security posture improvement.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
