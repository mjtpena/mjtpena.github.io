---
title: "Service Connections in Azure DevOps"
author: "Michael John Peña"
draft: false
date: 2022-10-26
tags: ["Azure", "Azure DevOps", "Service Connections", "Security"]

---

I wrote "Service Connections in Azure DevOps" to share practical, production-minded guidance on this topic.

## Azure Service Connection

```yaml
# Using Azure service connection
trigger: [main]

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: AzureCLI@2
    inputs:
      azureSubscription: 'MyAzureConnection'  # Service connection name
      scriptType: 'bash'
      scriptLocation: 'inlineScript'
      inlineScript: |
        az webapp list --output table
        az storage account list --output table
```

## Connection Types

```yaml
# Common service connections
connections:
  azure_resource_manager:
    authentication: ['Service Principal', 'Managed Identity', 'Workload Identity']
    scope: ['Subscription', 'Resource Group', 'Management Group']

  kubernetes:
    authentication: ['Kubeconfig', 'Azure Subscription', 'Service Account']

  docker_registry:
    registries: ['Docker Hub', 'ACR', 'Other']

  github:
    authentication: ['Personal Access Token', 'GitHub App', 'OAuth']

  generic:
    types: ['REST API', 'SSH', 'npm', 'NuGet']
```

## Workload Identity Federation

```yaml
# Modern authentication without secrets
service_connection:
  name: 'AzureWorkloadIdentity'
  type: 'Azure Resource Manager'
  authentication: 'Workload Identity Federation'
  subscription: 'xxx-xxx-xxx'
  servicePrincipalId: 'app-id'
  tenantId: 'tenant-id'
  # No secret required - uses OIDC
```

Service connections provide secure, manageable access to external resources.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
