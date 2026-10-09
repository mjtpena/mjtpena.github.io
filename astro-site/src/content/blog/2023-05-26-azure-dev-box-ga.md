---
title: "Azure Dev Box GA: Cloud-Powered Developer Workstations"
description: "Dev Box simplifies developer onboarding and ensures consistent development environments. Tomorrow, I will cover Azure Deployment Environments."
author: Michael John Peña
draft: false
date: 2023-05-26
tags:
  - Azure Dev Box
  - Developer Tools
  - Cloud Development
  - Azure
  - DevOps
---

## What is Azure Dev Box?

Azure Dev Box provides self-service, high-performance, cloud-based workstations pre-configured for specific projects or teams:

```
┌─────────────────────────────────────────────────────┐
│                  Azure Dev Box                       │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────┐    ┌─────────────────────────────┐ │
│  │   Admin     │───▶│  Dev Center                 │ │
│  │   Portal    │    │  - Projects                 │ │
│  └─────────────┘    │  - Pools                    │ │
│                     │  - Definitions              │ │
│                     └─────────────────────────────┘ │
│                              │                      │
│                              ▼                      │
│  ┌─────────────┐    ┌─────────────────────────────┐ │
│  │  Developer  │───▶│  Dev Box                    │ │
│  │  Portal     │    │  - Windows 11               │ │
│  └─────────────┘    │  - Pre-installed tools      │ │
│                     │  - Project repos            │ │
│                     └─────────────────────────────┘ │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Setting Up Dev Center

### Create Dev Center

```bash
# Create resource group
az group create --name devbox-rg --location eastus

# Create dev center
az devcenter admin devcenter create \
    --name mydevcenter \
    --resource-group devbox-rg \
    --location eastus

# Create network connection
az devcenter admin network-connection create \
    --name devbox-network \
    --resource-group devbox-rg \
    --location eastus \
    --subnet-id "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Network/virtualNetworks/{vnet}/subnets/{subnet}" \
    --domain-join-type AzureADJoin
```

### Create Dev Box Definitions

```python
from azure.mgmt.devcenter import DevCenterMgmtClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
client = DevCenterMgmtClient(credential, subscription_id)

# Create dev box definition
definition = client.dev_box_definitions.begin_create_or_update(
    resource_group_name="devbox-rg",
    dev_center_name="mydevcenter",
    dev_box_definition_name="frontend-dev",
    body={
        "location": "eastus",
        "properties": {
            "imageReference": {
                "id": "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.DevCenter/devcenters/mydevcenter/galleries/default/images/microsoftvisualstudio_visualstudioplustools_vs-2022-ent-general-win11-m365-gen2"
            },
            "sku": {
                "name": "general_i_8c32gb256ssd_v2"
            },
            "hibernateSupport": "Enabled"
        }
    }
).result()

print(f"Created definition: {definition.name}")
```

### SKU Options

```python
# Available Dev Box SKUs
dev_box_skus = {
    "general_i_8c32gb256ssd_v2": {
        "vcpus": 8,
        "memory_gb": 32,
        "storage_gb": 256,
        "use_case": "Standard development"
    },
    "general_i_8c32gb512ssd_v2": {
        "vcpus": 8,
        "memory_gb": 32,
        "storage_gb": 512,
        "use_case": "Standard with more storage"
    },
    "general_i_16c64gb256ssd_v2": {
        "vcpus": 16,
        "memory_gb": 64,
        "storage_gb": 256,
        "use_case": "Heavy workloads"
    },
    "general_i_32c128gb512ssd_v2": {
        "vcpus": 32,
        "memory_gb": 128,
        "storage_gb": 512,
        "use_case": "Large projects, ML development"
    }
}
```

## Creating Custom Images

### Using Azure Image Builder

```json
{
  "type": "Microsoft.VirtualMachineImages/imageTemplates",
  "apiVersion": "2022-02-14",
  "location": "eastus",
  "properties": {
    "source": {
      "type": "PlatformImage",
      "publisher": "MicrosoftWindowsDesktop",
      "offer": "Windows-11",
      "sku": "win11-22h2-ent",
      "version": "latest"
    },
    "customize": [
      {
        "type": "PowerShell",
        "name": "InstallVisualStudio",
        "runElevated": true,
        "inline": [
          "choco install visualstudio2022enterprise -y",
          "choco install visualstudio2022-workload-azure -y",
          "choco install visualstudio2022-workload-netweb -y"
        ]
      },
      {
        "type": "PowerShell",
        "name": "InstallDevTools",
        "runElevated": true,
        "inline": [
          "choco install git -y",
          "choco install nodejs-lts -y",
          "choco install python3 -y",
          "choco install docker-desktop -y",
          "choco install azure-cli -y",
          "choco install vscode -y",
          "choco install postman -y"
        ]
      },
      {
        "type": "PowerShell",
        "name": "InstallVSCodeExtensions",
        "inline": [
          "code --install-extension ms-python.python",
          "code --install-extension ms-azuretools.vscode-docker",
          "code --install-extension ms-vscode.azure-account"
        ]
      },
      {
        "type": "WindowsRestart",
        "restartTimeout": "10m"
      }
    ],
    "distribute": [
      {
        "type": "SharedImage",
        "galleryImageId": "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Compute/galleries/devboxGallery/images/customDevImage",
        "runOutputName": "customDevImage",
        "replicationRegions": ["eastus"]
      }
    ]
  }
}
```

### PowerShell Setup Script

```powershell
# setup-devbox.ps1
# Run as administrator during image build

# Install Chocolatey
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Refresh environment
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Install development tools
$packages = @(
    "git",
    "gh",
    "nodejs-lts",
    "python3",
    "dotnet-sdk",
    "azure-cli",
    "terraform",
    "docker-desktop",
    "vscode",
    "postman",
    "7zip",
    "curl",
    "jq"
)

foreach ($package in $packages) {
    choco install $package -y --no-progress
}

# Configure Git
git config --global init.defaultBranch main
git config --global core.autocrlf true

# Install VS Code extensions
$extensions = @(
    "ms-python.python",
    "ms-azuretools.vscode-docker",
    "ms-azure-devops.azure-pipelines",
    "ms-vscode.azure-account",
    "ms-dotnettools.csharp",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "hashicorp.terraform"
)

foreach ($ext in $extensions) {
    code --install-extension $ext
}

# Create standard directory structure
$dirs = @(
    "$env:USERPROFILE\repos",
    "$env:USERPROFILE\.ssh"
)

foreach ($dir in $dirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir
    }
}

Write-Host "Dev Box setup complete!"
```

## Project and Pool Setup

```python
# Create project
project = client.projects.begin_create_or_update(
    resource_group_name="devbox-rg",
    project_name="frontend-project",
    body={
        "location": "eastus",
        "properties": {
            "devCenterId": f"/subscriptions/{sub}/resourceGroups/devbox-rg/providers/Microsoft.DevCenter/devcenters/mydevcenter",
            "description": "Frontend development project"
        }
    }
).result()

# Create pool
pool = client.pools.begin_create_or_update(
    resource_group_name="devbox-rg",
    project_name="frontend-project",
    pool_name="frontend-pool",
    body={
        "location": "eastus",
        "properties": {
            "devBoxDefinitionName": "frontend-dev",
            "networkConnectionName": "devbox-network",
            "licenseType": "Windows_Client",
            "localAdministrator": "Enabled",
            "stopOnDisconnect": {
                "status": "Enabled",
                "gracePeriodMinutes": 60
            }
        }
    }
).result()

print(f"Created pool: {pool.name}")
```

## Developer Self-Service

```python
from azure.developer.devcenter import DevCenterClient

# Developer creates their own dev box
dev_client = DevCenterClient(
    endpoint="https://devcenter-endpoint.azure.com",
    credential=DefaultAzureCredential()
)

# Create dev box
dev_box = dev_client.dev_boxes.begin_create_dev_box(
    project_name="frontend-project",
    user_id="me",
    dev_box_name="my-frontend-box",
    body={
        "poolName": "frontend-pool"
    }
).result()

print(f"Dev Box created: {dev_box.name}")
print(f"State: {dev_box.provisioning_state}")

# Get connection info
remote_connection = dev_client.dev_boxes.get_remote_connection(
    project_name="frontend-project",
    user_id="me",
    dev_box_name="my-frontend-box"
)

print(f"Web URL: {remote_connection.web_url}")
print(f"RDP URL: {remote_connection.rdp_connection_url}")
```

## Lifecycle Management

```python
# Stop dev box (hibernate)
dev_client.dev_boxes.begin_stop(
    project_name="frontend-project",
    user_id="me",
    dev_box_name="my-frontend-box",
    hibernate=True
)

# Start dev box
dev_client.dev_boxes.begin_start(
    project_name="frontend-project",
    user_id="me",
    dev_box_name="my-frontend-box"
)

# Delete dev box
dev_client.dev_boxes.begin_delete(
    project_name="frontend-project",
    user_id="me",
    dev_box_name="my-frontend-box"
)
```

## Auto-Stop Policies

```python
# Configure auto-stop schedule
schedule = client.schedules.begin_create_or_update(
    resource_group_name="devbox-rg",
    project_name="frontend-project",
    pool_name="frontend-pool",
    schedule_name="default",
    body={
        "properties": {
            "type": "StopDevBox",
            "frequency": "Daily",
            "time": "19:00",
            "timeZone": "America/Los_Angeles",
            "state": "Enabled"
        }
    }
).result()
```

Dev Box simplifies developer onboarding and ensures consistent development environments. Tomorrow, I will cover Azure Deployment Environments.

## Resources

- [Dev Box Documentation](https://learn.microsoft.com/en-us/azure/dev-box/)
- [Dev Box Quickstart](https://learn.microsoft.com/en-us/azure/dev-box/quickstart-create-dev-box)
- [Custom Images](https://learn.microsoft.com/en-us/azure/dev-box/how-to-configure-dev-box-images)
