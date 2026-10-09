---
title: "Microsoft Dev Box Preview: Cloud-Based Developer Workstations"
description: "Microsoft Dev Box provides self-service, high-performance, cloud-based workstations pre-configured with project-specific tools, source code, and settings.…"
author: Michael John Peña
draft: false
date: 2022-05-01
tags:
  - Azure
  - dev-box
  - developer-tools
  - Cloud
---

## What is Microsoft Dev Box?

Microsoft Dev Box provides self-service, high-performance, cloud-based workstations pre-configured with project-specific tools, source code, and settings. Think of it as a cloud PC optimized specifically for developers.

## Key Benefits

### Instant Onboarding

New team members can get a fully configured development environment in minutes:

```powershell
# Using Azure CLI to create a Dev Box
az devcenter dev-box create \
    --name "my-dev-box" \
    --project "frontend-project" \
    --pool "standard-pool" \
    --user-id "me"
```

### Consistent Environments

Define your development environment as code using configuration files:

```yaml
# dev-box-definition.yaml
name: dotnet-web-dev
compute:
  sku: general_i_8c32gb256ssd_v2
storage:
  osDisk:
    sizeGB: 256
software:
  - name: Visual Studio 2022
    version: 17.2
  - name: .NET 6 SDK
    version: 6.0.300
  - name: Node.js
    version: 18.0.0
  - name: Git
    version: 2.36.0
```

### Cost Management

Dev Boxes can be configured to auto-hibernate and auto-shutdown:

```json
{
  "schedules": [
    {
      "name": "weekday-schedule",
      "time": "19:00",
      "timeZone": "America/Los_Angeles",
      "state": "Hibernate",
      "frequency": "Daily"
    },
    {
      "name": "weekend-shutdown",
      "time": "18:00",
      "timeZone": "America/Los_Angeles",
      "state": "Stop",
      "days": ["Saturday", "Sunday"]
    }
  ]
}
```

## Integration with Azure Active Directory

Dev Box integrates seamlessly with Azure AD for authentication and authorization:

```csharp
using Azure.Identity;
using Azure.ResourceManager;
using Azure.ResourceManager.DevCenter;

// Authenticate using default Azure credentials
var credential = new DefaultAzureCredential();
var armClient = new ArmClient(credential);

// Get the Dev Center
var subscription = await armClient.GetDefaultSubscriptionAsync();
var devCenters = subscription.GetDevCenters();

await foreach (var devCenter in devCenters)
{
    Console.WriteLine($"Dev Center: {devCenter.Data.Name}");
    Console.WriteLine($"Location: {devCenter.Data.Location}");
}
```

## Creating a Dev Box Pool

Administrators can create pools that define the available configurations:

```bicep
resource devCenter 'Microsoft.DevCenter/devcenters@2022-03-01-preview' = {
  name: 'contoso-devcenter'
  location: resourceGroup().location
  properties: {}
}

resource project 'Microsoft.DevCenter/devcenters/projects@2022-03-01-preview' = {
  parent: devCenter
  name: 'web-project'
  properties: {
    description: 'Web development project'
  }
}

resource pool 'Microsoft.DevCenter/projects/pools@2022-03-01-preview' = {
  parent: project
  name: 'standard-pool'
  properties: {
    devBoxDefinitionName: 'dotnet-web-dev'
    networkConnectionName: 'default-network'
    licenseType: 'Windows_Client'
    localAdministrator: 'Enabled'
  }
}
```

## Network Configuration

Connect Dev Boxes to your corporate network:

```bicep
resource networkConnection 'Microsoft.DevCenter/networkConnections@2022-03-01-preview' = {
  name: 'corp-network-connection'
  location: resourceGroup().location
  properties: {
    domainJoinType: 'AzureADJoin'
    subnetId: virtualNetwork.properties.subnets[0].id
    networkingResourceGroupName: 'dev-box-networking-rg'
  }
}
```

## Developer Self-Service Portal

Developers can manage their Dev Boxes through a self-service portal or CLI:

```bash
# List available pools
az devcenter dev-box pool list --project "web-project"

# Create a new Dev Box
az devcenter dev-box create \
    --name "feature-auth" \
    --project "web-project" \
    --pool "standard-pool"

# Start a Dev Box
az devcenter dev-box start --name "feature-auth"

# Connect to Dev Box via RDP
az devcenter dev-box connect --name "feature-auth"
```

## Use Cases

1. **Onboarding**: New developers get productive on day one
2. **Contractors**: Temporary access with proper governance
3. **Multi-project teams**: Switch between project configurations
4. **Compliance**: Centralized security and auditing

## Summary

Microsoft Dev Box addresses the long-standing challenge of developer environment provisioning. By combining cloud infrastructure with self-service capabilities, organizations can:

- Reduce onboarding time from days to minutes
- Ensure consistent, reproducible environments
- Maintain security and compliance
- Optimize costs with auto-shutdown capabilities

As we approach Build 2022, expect more details on pricing, availability, and integration with other Azure services.
