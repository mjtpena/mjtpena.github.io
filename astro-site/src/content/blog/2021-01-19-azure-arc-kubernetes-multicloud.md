---
title: Azure Arc for Kubernetes - Managing Multi-Cloud Clusters
description: "Most enterprises I work with have Kubernetes in three places they didn't plan for: an on-prem cluster the platform team built, an EKS estate from an…"
author: Michael John Pena
draft: false
date: 2021-01-19
url: /blog/azure-arc-kubernetes-multicloud/
tags:
  - Azure
  - Azure Arc
  - Kubernetes
  - Multi-Cloud
  - GitOps
---

Most enterprises I work with have Kubernetes in three places they didn't plan for: an on-prem cluster the platform team built, an EKS estate from an acquisition, and "that AKS cluster the data team spun up." Arc-enabled Kubernetes is how you get a single management plane across all of them. Onboard with a Helm chart, get Azure Policy and GitOps via Flux, and apply consistent governance regardless of where the cluster runs. Today I'm demonstrating onboarding plus a real GitOps deployment flow.

## Understanding Azure Arc for Kubernetes

Azure Arc enabled Kubernetes allows you to:
- Inventory and organize clusters across environments
- Apply Azure Policy for consistent governance
- Deploy applications using GitOps
- Enable Azure Monitor for containers
- Implement Azure Defender for security

## Onboarding a Kubernetes Cluster

First, ensure you have the Azure CLI extensions installed:

```bash
# Install required extensions
az extension add --name connectedk8s
az extension add --name k8s-configuration

# Register providers
az provider register --namespace Microsoft.Kubernetes
az provider register --namespace Microsoft.KubernetesConfiguration
az provider register --namespace Microsoft.ExtendedLocation
```

Connect your cluster to Azure Arc:

```bash
# Set variables
RESOURCE_GROUP="arc-clusters-rg"
CLUSTER_NAME="production-cluster-aws"
LOCATION="eastus"

# Create resource group
az group create --name $RESOURCE_GROUP --location $LOCATION

# Connect the cluster
az connectedk8s connect \
    --name $CLUSTER_NAME \
    --resource-group $RESOURCE_GROUP \
    --location $LOCATION \
    --tags "environment=production" "cloud=aws"

# Verify connection
az connectedk8s show \
    --name $CLUSTER_NAME \
    --resource-group $RESOURCE_GROUP
```

## Implementing GitOps with Flux

Azure Arc uses Flux for GitOps. Here is how to set up a configuration:

```bash
# Create a GitOps configuration
az k8s-configuration create \
    --name cluster-config \
    --cluster-name $CLUSTER_NAME \
    --resource-group $RESOURCE_GROUP \
    --cluster-type connectedClusters \
    --scope cluster \
    --operator-instance-name cluster-config \
    --operator-namespace cluster-config \
    --operator-params "--git-readonly --git-path=clusters/production" \
    --repository-url https://github.com/myorg/kubernetes-configs \
    --enable-helm-operator \
    --helm-operator-params "--set helm.versions=v3"
```

## GitOps Repository Structure

Organize your GitOps repository for multi-cluster management:

```
kubernetes-configs/
├── base/
│   ├── namespaces/
│   │   └── kustomization.yaml
│   ├── monitoring/
│   │   ├── prometheus.yaml
│   │   └── grafana.yaml
│   └── networking/
│       └── ingress-nginx.yaml
├── clusters/
│   ├── production/
│   │   ├── kustomization.yaml
│   │   ├── namespace.yaml
│   │   └── apps/
│   │       ├── app1/
│   │       │   ├── deployment.yaml
│   │       │   ├── service.yaml
│   │       │   └── kustomization.yaml
│   │       └── app2/
│   │           └── ...
│   ├── staging/
│   │   └── ...
│   └── development/
│       └── ...
└── helm-releases/
    ├── cert-manager.yaml
    └── external-dns.yaml
```

Example Kustomization file for production cluster:

```yaml
# clusters/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: production

resources:
  - namespace.yaml
  - ../../base/monitoring
  - ../../base/networking
  - apps/app1
  - apps/app2

patchesStrategicMerge:
  - production-patches.yaml

configMapGenerator:
  - name: cluster-config
    literals:
      - ENVIRONMENT=production
      - LOG_LEVEL=info

images:
  - name: myapp
    newTag: v1.2.3
```

## Azure Policy for Kubernetes

Apply consistent policies across all Arc-enabled clusters:

```json
{
  "mode": "Microsoft.Kubernetes.Data",
  "policyRule": {
    "if": {
      "field": "type",
      "in": [
        "Microsoft.Kubernetes/connectedClusters",
        "Microsoft.ContainerService/managedClusters"
      ]
    },
    "then": {
      "effect": "deployIfNotExists",
      "details": {
        "type": "Microsoft.KubernetesConfiguration/extensions",
        "existenceCondition": {
          "allOf": [
            {
              "field": "Microsoft.KubernetesConfiguration/extensions/extensionType",
              "equals": "microsoft.azuredefender.kubernetes"
            },
            {
              "field": "Microsoft.KubernetesConfiguration/extensions/provisioningState",
              "equals": "Succeeded"
            }
          ]
        },
        "roleDefinitionIds": [
          "/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c"
        ],
        "deployment": {
          "properties": {
            "mode": "incremental",
            "template": {
              "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
              "contentVersion": "1.0.0.0",
              "parameters": {
                "clusterResourceId": {
                  "type": "string"
                }
              },
              "resources": [
                {
                  "type": "Microsoft.KubernetesConfiguration/extensions",
                  "apiVersion": "2020-07-01-preview",
                  "name": "azuredefender",
                  "properties": {
                    "extensionType": "microsoft.azuredefender.kubernetes",
                    "configurationSettings": {},
                    "configurationProtectedSettings": {}
                  },
                  "scope": "[parameters('clusterResourceId')]"
                }
              ]
            },
            "parameters": {
              "clusterResourceId": {
                "value": "[field('id')]"
              }
            }
          }
        }
      }
    }
  }
}
```

## Monitoring with Azure Monitor

Enable Container Insights for your Arc-enabled clusters:

```bash
# Enable monitoring
az k8s-extension create \
    --name azuremonitor-containers \
    --cluster-name $CLUSTER_NAME \
    --resource-group $RESOURCE_GROUP \
    --cluster-type connectedClusters \
    --extension-type Microsoft.AzureMonitor.Containers \
    --configuration-settings \
        logAnalyticsWorkspaceResourceID="/subscriptions/xxx/resourceGroups/xxx/providers/Microsoft.OperationalInsights/workspaces/xxx"
```

Create custom alerts for multi-cluster monitoring:

```kusto
// KQL query to find pods in CrashLoopBackOff across all clusters
ContainerInventory
| where TimeGenerated > ago(1h)
| where ContainerState == "Failed"
| summarize FailedCount = count() by ClusterName, Namespace, ContainerName
| where FailedCount > 3
| project ClusterName, Namespace, ContainerName, FailedCount
| order by FailedCount desc
```

## Terraform Configuration for Arc

Automate Arc cluster onboarding with Terraform:

```hcl
terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 2.90"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.7"
    }
  }
}

provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "arc" {
  name     = "arc-clusters-rg"
  location = "East US"
}

resource "azurerm_arc_kubernetes_cluster" "external" {
  name                         = "external-cluster"
  resource_group_name          = azurerm_resource_group.arc.name
  location                     = azurerm_resource_group.arc.location
  agent_public_key_certificate = var.agent_public_key

  identity {
    type = "SystemAssigned"
  }

  tags = {
    Environment = "Production"
    Cloud       = "AWS"
  }
}

resource "azurerm_arc_kubernetes_flux_configuration" "gitops" {
  name       = "cluster-gitops"
  cluster_id = azurerm_arc_kubernetes_cluster.external.id
  namespace  = "flux-system"
  scope      = "cluster"

  git_repository {
    url             = "https://github.com/myorg/kubernetes-configs"
    reference_type  = "branch"
    reference_value = "main"
    sync_interval_in_seconds = 60
  }

  kustomizations {
    name                       = "infrastructure"
    path                       = "./clusters/production/infrastructure"
    sync_interval_in_seconds   = 120
    retry_interval_in_seconds  = 60
    prune                      = true
  }

  kustomizations {
    name                       = "apps"
    path                       = "./clusters/production/apps"
    sync_interval_in_seconds   = 120
    depends_on                 = ["infrastructure"]
    prune                      = true
  }
}
```

## Multi-Cluster Deployment Pattern

Here is a Python script to deploy across multiple Arc-enabled clusters:

```python
from azure.identity import DefaultAzureCredential
from azure.mgmt.kubernetesconfiguration import SourceControlConfigurationClient
import asyncio

credential = DefaultAzureCredential()
subscription_id = "your-subscription-id"

client = SourceControlConfigurationClient(credential, subscription_id)

async def deploy_to_clusters(clusters, config_name, repo_url, path):
    """
    Deploy a configuration to multiple Arc-enabled clusters.
    """
    tasks = []

    for cluster in clusters:
        task = deploy_config(
            cluster['resource_group'],
            cluster['name'],
            config_name,
            repo_url,
            path
        )
        tasks.append(task)

    results = await asyncio.gather(*tasks, return_exceptions=True)

    for cluster, result in zip(clusters, results):
        if isinstance(result, Exception):
            print(f"Failed to deploy to {cluster['name']}: {result}")
        else:
            print(f"Successfully deployed to {cluster['name']}")

async def deploy_config(resource_group, cluster_name, config_name, repo_url, path):
    """
    Deploy a single GitOps configuration.
    """
    config = {
        "repository_url": repo_url,
        "operator_namespace": config_name,
        "operator_instance_name": config_name,
        "operator_type": "Flux",
        "operator_params": f"--git-path={path} --git-readonly",
        "enable_helm_operator": True,
        "helm_operator_properties": {
            "chart_version": "1.2.0",
            "chart_values": "--set helm.versions=v3"
        }
    }

    return client.source_control_configurations.create_or_update(
        resource_group_name=resource_group,
        cluster_rp="Microsoft.Kubernetes",
        cluster_resource_name="connectedClusters",
        cluster_name=cluster_name,
        source_control_configuration_name=config_name,
        source_control_configuration=config
    )

# Define your clusters
clusters = [
    {"name": "prod-aws-east", "resource_group": "arc-clusters-rg"},
    {"name": "prod-gcp-west", "resource_group": "arc-clusters-rg"},
    {"name": "prod-onprem-dc1", "resource_group": "arc-clusters-rg"},
]

# Deploy
asyncio.run(deploy_to_clusters(
    clusters,
    "app-deployment",
    "https://github.com/myorg/app-configs",
    "clusters/production"
))
```

## Best Practices

1. **Consistent Naming**: Use a naming convention that identifies cloud provider and region
2. **Tagging Strategy**: Apply consistent tags for cost allocation and governance
3. **Network Connectivity**: Ensure outbound HTTPS connectivity to Azure endpoints
4. **RBAC**: Use Azure RBAC for consistent access control across clusters
5. **Secrets Management**: Use Azure Key Vault with the Secrets Store CSI Driver

Azure Arc for Kubernetes provides a unified control plane for multi-cloud and hybrid Kubernetes environments. Combined with GitOps, it enables consistent, auditable deployments across your entire infrastructure.
