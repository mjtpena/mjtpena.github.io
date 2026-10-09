---
title: "Azure Bastion: Secure VM Access Without Public IPs"
description: "Jump boxes are one of those legacy patterns I keep finding in environments I inherit. A Windows VM with RDP open to the internet, \"for admin access only,\"…"
author: Michael John Peña
draft: false
date: 2020-12-21
tags:
  - Azure
  - Bastion
  - Security
  - Networking
---

Jump boxes are one of those legacy patterns I keep finding in environments I inherit. A Windows VM with RDP open to the internet, "for admin access only," last patched in 2018. Bastion is the cure. Browser-based RDP/SSH through the Azure portal, no public IP on the target VM, MFA via Azure AD, full session logging. It costs more than a self-managed jump box; that math flips the first time you avoid an incident.

## How Bastion Works

```
User → Azure Portal → Bastion → VM (Private IP)
         HTTPS            Private Network
```

- No public IP on VMs
- No exposed RDP/SSH ports
- Traffic stays in Azure backbone
- SSL/TLS encrypted

## Creating Bastion

```bash
# Create AzureBastionSubnet (required name)
az network vnet subnet create \
    --resource-group myRG \
    --vnet-name myVNet \
    --name AzureBastionSubnet \
    --address-prefix 10.0.255.0/27

# Create public IP for Bastion
az network public-ip create \
    --resource-group myRG \
    --name bastion-pip \
    --sku Standard \
    --allocation-method Static

# Create Bastion
az network bastion create \
    --name my-bastion \
    --resource-group myRG \
    --vnet-name myVNet \
    --public-ip-address bastion-pip \
    --sku Standard
```

## SKU Comparison

| Feature | Basic | Standard |
|---------|-------|----------|
| Concurrent sessions | 25 | 50+ (scale units) |
| Native client | No | Yes |
| Upload/download | No | Yes |
| Shareable link | No | Yes |
| Kerberos auth | No | Yes |

## Connect via Portal

1. Navigate to VM in Azure Portal
2. Click "Connect" → "Bastion"
3. Enter username and password
4. Click "Connect"

Browser opens RDP/SSH session directly.

## Native Client Connection

```bash
# Enable native client
az network bastion update \
    --name my-bastion \
    --resource-group myRG \
    --enable-tunneling true

# RDP via native client
az network bastion rdp \
    --name my-bastion \
    --resource-group myRG \
    --target-resource-id /subscriptions/.../virtualMachines/myVM

# SSH via native client
az network bastion ssh \
    --name my-bastion \
    --resource-group myRG \
    --target-resource-id /subscriptions/.../virtualMachines/myVM \
    --auth-type password \
    --username azureuser
```

## Tunnel for Custom Tools

```bash
# Create tunnel
az network bastion tunnel \
    --name my-bastion \
    --resource-group myRG \
    --target-resource-id /subscriptions/.../virtualMachines/myVM \
    --resource-port 22 \
    --port 2222

# Connect through tunnel
ssh azureuser@localhost -p 2222
```

## Shareable Links

```bash
# Create shareable link (temporary access)
az network bastion shareable-link create \
    --bastion-host-name my-bastion \
    --resource-group myRG \
    --vms "/subscriptions/.../virtualMachines/myVM"

# List shareable links
az network bastion shareable-link list \
    --bastion-host-name my-bastion \
    --resource-group myRG

# Delete shareable link
az network bastion shareable-link delete \
    --bastion-host-name my-bastion \
    --resource-group myRG \
    --vms "/subscriptions/.../virtualMachines/myVM"
```

## Scale Units (Standard SKU)

```bash
# Scale for more connections
az network bastion update \
    --name my-bastion \
    --resource-group myRG \
    --scale-units 4
```

| Scale Units | Max Sessions |
|-------------|--------------|
| 2 (default) | 50 |
| 4 | 100 |
| 10 | 250 |
| 50 | 1250 |

## Monitoring

```kusto
// Bastion connection logs
AzureDiagnostics
| where Category == "BastionAuditLogs"
| project TimeGenerated, UserName = userName_s, TargetVMIPAddress = targetVMIPAddress_s,
    Protocol = protocol_s, Duration = duration_s
| order by TimeGenerated desc
```

## Best Practices

1. Use NSG on AzureBastionSubnet
2. Enable diagnostic logging
3. Use JIT access with Bastion
4. Rotate shareable links regularly
5. Monitor failed connection attempts

Azure Bastion: secure, private VM access made simple.
