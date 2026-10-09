---
title: "Azure DevTest Labs: Managed Development Environments"
description: "Every consultancy I've worked at has the same problem: developers need a sandbox, finance needs to not get a heart attack, and three months later there are…"
author: Michael John Peña
draft: false
date: 2020-11-26
tags:
  - Azure
  - DevTest Labs
  - Development
  - DevOps
---

Every consultancy I've worked at has the same problem: developers need a sandbox, finance needs to not get a heart attack, and three months later there are 47 orphan VMs. DevTest Labs solves this far better than naming conventions and good intentions. Developers self-serve from approved images, policies enforce auto-shutdown, and you get a per-lab cost ceiling. It's not glamorous; it's just the right tool for "give the team room to experiment without losing the budget."

## Creating a Lab

```bash
az lab create \
    --resource-group myRG \
    --name my-devtest-lab \
    --location eastus
```

## Custom Images

```bash
# Create image from VM
az lab custom-image create \
    --lab-name my-devtest-lab \
    --resource-group myRG \
    --name "dev-environment-v1" \
    --source-vm-id /subscriptions/.../virtualMachines/template-vm \
    --os-type Windows \
    --os-state Generalized \
    --description "Standard dev environment with VS 2019, Docker, .NET 5"
```

## Formulas (Reusable Configurations)

```json
{
    "name": "web-dev-formula",
    "description": "Web development environment",
    "formulaContent": {
        "properties": {
            "size": "Standard_D4s_v3",
            "userName": "devuser",
            "galleryImageReference": {
                "offer": "visualstudio2019latest",
                "publisher": "microsoftvisualstudio",
                "sku": "vs-2019-comm-latest-ws2019",
                "osType": "Windows",
                "version": "latest"
            },
            "artifacts": [
                {
                    "artifactId": "/artifacts/Windows-vscode"
                },
                {
                    "artifactId": "/artifacts/Windows-docker"
                }
            ]
        }
    }
}
```

## Artifacts (Software Installers)

```json
{
    "name": "install-nodejs",
    "description": "Installs Node.js",
    "targetOsType": "Windows",
    "parameters": [
        {
            "name": "version",
            "type": "string",
            "defaultValue": "14.x",
            "allowedValues": ["12.x", "14.x", "16.x"]
        }
    ],
    "runCommand": {
        "commandToExecute": "powershell.exe -File install-nodejs.ps1 -Version $version"
    }
}
```

## Cost Management

### Auto-Shutdown

```bash
az lab vm set-schedule \
    --lab-name my-devtest-lab \
    --resource-group myRG \
    --name my-dev-vm \
    --daily-recurrence '{"time": "1900"}' \
    --time-zone-id "Pacific Standard Time" \
    --status Enabled
```

### Quotas

```bash
# Set per-user VM limits
az lab policy set \
    --lab-name my-devtest-lab \
    --resource-group myRG \
    --name UserOwnedLabVmsCount \
    --threshold 5

# Set allowed VM sizes
az lab policy set \
    --lab-name my-devtest-lab \
    --resource-group myRG \
    --name AllowedVmSizesInLab \
    --threshold '["Standard_D2s_v3", "Standard_D4s_v3"]'
```

### Cost Tracking

```bash
# Get lab costs
az lab cost get \
    --lab-name my-devtest-lab \
    --resource-group myRG \
    --name TargetCost
```

## Claimable VMs

Pre-create VMs for quick access:

```bash
# Create claimable pool
az lab vm create \
    --lab-name my-devtest-lab \
    --resource-group myRG \
    --name "dev-pool" \
    --image "Visual Studio 2019" \
    --size Standard_D4s_v3 \
    --notes "Claimable dev environment" \
    --allow-claim true
```

## Virtual Networks

```bash
# Add existing VNet
az lab vnet set \
    --lab-name my-devtest-lab \
    --resource-group myRG \
    --name my-lab-vnet \
    --virtual-network-id /subscriptions/.../virtualNetworks/dev-vnet \
    --subnet-name dev-subnet \
    --enabled-for-vm-creation true
```

## Environments (ARM Templates)

```bash
# Create environment from repo
az lab environment create \
    --lab-name my-devtest-lab \
    --resource-group myRG \
    --name my-environment \
    --arm-template-id /subscriptions/.../artifactsources/repo/armtemplates/webapp
```

## CLI for Users

```bash
# List my VMs
az lab vm list \
    --lab-name my-devtest-lab \
    --resource-group myRG \
    --query "[?contains(ownerObjectId, 'myuserid')]"

# Claim a VM
az lab vm claim \
    --lab-name my-devtest-lab \
    --resource-group myRG \
    --name dev-pool-001

# Start/Stop VM
az lab vm start --lab-name my-devtest-lab --resource-group myRG --name my-vm
az lab vm stop --lab-name my-devtest-lab --resource-group myRG --name my-vm
```

DevTest Labs: self-service environments with guardrails.
