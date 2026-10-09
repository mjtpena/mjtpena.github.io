---
title: "Azure Arc-Enabled Kubernetes: Manage Kubernetes Clusters Anywhere"
author: Michael John Pena
draft: false
date: 2021-11-17
tags:
  - Azure
  - Kubernetes
  - Azure Arc
  - Containers
  - Hybrid Cloud
---

## What is Arc-Enabled Kubernetes?

Arc-enabled Kubernetes provides:

- **Inventory and grouping**: Organize clusters in Azure Resource Manager
- **GitOps configurations**: Deploy applications using Git repositories
- **Azure Policy**: Enforce security and configuration standards
- **Azure Monitor**: Unified monitoring for all clusters
- **Azure Defender**: Security posture management

## Connecting a Cluster

### Prerequisites

```bash
# Install required CLI extensions
az extension add --name connectedk8s
az extension add --name k8s-configuration
az extension add --name k8s-extension

# Register providers
az provider register --namespace Microsoft.Kubernetes
az provider register --namespace Microsoft.KubernetesConfiguration
az provider register --namespace Microsoft.ExtendedLocation
```

### Connect the Cluster

```bash
# Connect an existing cluster
az connectedk8s connect \
    --name my-cluster \
    --resource-group rg-arc-k8s \
    --location eastus \
    --tags Environment=Production Tier=Gold

# Verify connection
az connectedk8s show \
    --name my-cluster \
    --resource-group rg-arc-k8s \
    --query "connectivityStatus"

# View Arc agents
kubectl get pods -n azure-arc
```

For air-gapped environments:

```bash
# Export agent images
az connectedk8s connect \
    --name my-cluster \
    --resource-group rg-arc-k8s \
    --proxy-https https://proxy.example.com:3128 \
    --proxy-http http://proxy.example.com:3128 \
    --proxy-skip-range 10.0.0.0/8,kubernetes.default.svc
```

## GitOps with Flux

### Create GitOps Configuration

```bash
# Create a Flux configuration
az k8s-configuration flux create \
    --name app-config \
    --cluster-name my-cluster \
    --resource-group rg-arc-k8s \
    --cluster-type connectedClusters \
    --namespace flux-system \
    --scope cluster \
    --url https://github.com/myorg/kubernetes-configs \
    --branch main \
    --kustomization name=infrastructure path=./infrastructure prune=true \
    --kustomization name=apps path=./apps prune=true dependsOn=["infrastructure"]
```

### Repository Structure

```plaintext
kubernetes-configs/
├── infrastructure/
│   ├── namespaces.yaml
│   ├── network-policies.yaml
│   └── kustomization.yaml
├── apps/
│   ├── frontend/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── kustomization.yaml
│   ├── backend/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── kustomization.yaml
│   └── kustomization.yaml
└── clusters/
    ├── production/
    │   └── kustomization.yaml
    └── staging/
        └── kustomization.yaml
```

### Kustomization Files

```yaml
# apps/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: default
resources:
  - frontend/
  - backend/
```

```yaml
# apps/frontend/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
      - name: frontend
        image: myregistry.azurecr.io/frontend:v1.2.3
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 500m
            memory: 256Mi
```

### Monitor GitOps Status

```bash
# Check configuration status
az k8s-configuration flux show \
    --name app-config \
    --cluster-name my-cluster \
    --resource-group rg-arc-k8s \
    --cluster-type connectedClusters

# List kustomizations
az k8s-configuration flux kustomization list \
    --name app-config \
    --cluster-name my-cluster \
    --resource-group rg-arc-k8s \
    --cluster-type connectedClusters

# View in cluster
kubectl get gitrepositories -n flux-system
kubectl get kustomizations -n flux-system
```

## Azure Policy for Kubernetes

### Built-in Policies

```bash
# List available Kubernetes policies
az policy definition list \
    --query "[?contains(displayName, 'Kubernetes')]" \
    --output table

# Assign built-in policy
az policy assignment create \
    --name "k8s-https-ingress" \
    --display-name "Kubernetes cluster should only use HTTPS ingress" \
    --policy "1a5b4dca-0b6f-4cf5-907c-56316bc1bf3d" \
    --scope "/subscriptions/your-sub/resourceGroups/rg-arc-k8s"
```

### Custom Policy Definition

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
      "effect": "[parameters('effect')]",
      "details": {
        "templateInfo": {
          "sourceType": "Base64Encoded",
          "content": "[base64(concat('apiVersion: templates.gatekeeper.sh/v1beta1\nkind: ConstraintTemplate\nmetadata:\n  name: k8srequiredlabels\nspec:\n  crd:\n    spec:\n      names:\n        kind: K8sRequiredLabels\n      validation:\n        openAPIV3Schema:\n          properties:\n            labels:\n              type: array\n              items:\n                type: string\n  targets:\n    - target: admission.k8s.gatekeeper.sh\n      rego: |\n        package k8srequiredlabels\n        violation[{\"msg\": msg}] {\n          provided := {label | input.review.object.metadata.labels[label]}\n          required := {label | label := input.parameters.labels[_]}\n          missing := required - provided\n          count(missing) > 0\n          msg := sprintf(\"Missing required labels: %v\", [missing])\n        }'))]"
        },
        "constraint": {
          "apiVersion": "constraints.gatekeeper.sh/v1beta1",
          "kind": "K8sRequiredLabels",
          "spec": {
            "match": {
              "kinds": [
                {
                  "apiGroups": [""],
                  "kinds": ["Namespace"]
                }
              ]
            },
            "parameters": {
              "labels": "[parameters('requiredLabels')]"
            }
          }
        }
      }
    }
  },
  "parameters": {
    "effect": {
      "type": "String",
      "metadata": {
        "displayName": "Effect",
        "description": "Audit or Deny"
      },
      "allowedValues": ["Audit", "Deny"],
      "defaultValue": "Audit"
    },
    "requiredLabels": {
      "type": "Array",
      "metadata": {
        "displayName": "Required Labels",
        "description": "Labels that must be present on namespaces"
      },
      "defaultValue": ["costcenter", "environment"]
    }
  }
}
```

## Cluster Extensions

### Deploy Azure Monitor Extension

```bash
# Install monitoring extension
az k8s-extension create \
    --name azuremonitor-containers \
    --extension-type Microsoft.AzureMonitor.Containers \
    --cluster-name my-cluster \
    --resource-group rg-arc-k8s \
    --cluster-type connectedClusters \
    --configuration-settings \
        logAnalyticsWorkspaceResourceID="/subscriptions/.../workspaces/my-workspace"
```

### Deploy Azure Key Vault Secrets Provider

```bash
# Install secrets store CSI driver
az k8s-extension create \
    --name azure-secrets-store \
    --extension-type Microsoft.AzureKeyVaultSecretsProvider \
    --cluster-name my-cluster \
    --resource-group rg-arc-k8s \
    --cluster-type connectedClusters \
    --configuration-settings \
        secrets-store-csi-driver.enableSecretRotation=true \
        secrets-store-csi-driver.rotationPollInterval=2m
```

Use secrets in pods:

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: azure-kvname
spec:
  provider: azure
  parameters:
    usePodIdentity: "false"
    useVMManagedIdentity: "true"
    userAssignedIdentityID: ""
    keyvaultName: "my-keyvault"
    objects: |
      array:
        - |
          objectName: db-password
          objectType: secret
        - |
          objectName: api-key
          objectType: secret
    tenantId: "your-tenant-id"
```
