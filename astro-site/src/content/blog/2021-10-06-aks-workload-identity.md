---
title: "Azure AD Workload Identity for AKS: The Future of Pod Identity"
description: "Azure AD Workload Identity is the architecture-level improvement over AAD Pod Identity that removes the NMI DaemonSet and uses Kubernetes native service…"
author: "Michael John Peña"
draft: false
date: 2021-10-06
tags: ["Azure", "Kubernetes", "AKS", "Security", "Identity", "OIDC"]
---

Azure AD Workload Identity is the architecture-level improvement over AAD Pod Identity that removes the NMI DaemonSet and uses Kubernetes native service account token projection with OIDC federation to obtain Azure AD tokens. The mechanism: Kubernetes projects a short-lived service account token into the pod; the Azure Identity SDK exchanges that token with Azure AD through a federated credential trust; Azure AD returns an Azure access token scoped to the Managed Identity. No DaemonSet, no IMDS interception, no privileged node-level component. The federation is configured by linking the AKS cluster's OIDC issuer URL to an Azure AD Managed Identity as a federated credential. In October 2021 this was in preview; it reached GA in late 2022 and became the recommended approach for all new AKS identity-to-Azure-resource patterns.

## Why Workload Identity?

Compared to AAD Pod Identity, Workload Identity offers:
- No node-level dependencies (no NMI DaemonSet)
- Works with Windows containers
- Compatible with Azure Arc-enabled Kubernetes
- Smaller attack surface
- Faster pod startup times
- Support for custom clouds

## How It Works

1. Kubernetes issues a service account token to the pod
2. The application exchanges the token for an Azure AD token using OIDC federation
3. Azure AD validates the token against the AKS OIDC issuer
4. Application receives an Azure AD access token

## Prerequisites

Enable OIDC issuer on your AKS cluster:

```bash
# Update existing cluster
az aks update \
    --resource-group myResourceGroup \
    --name myAKSCluster \
    --enable-oidc-issuer

# Get the OIDC issuer URL
OIDC_ISSUER=$(az aks show \
    --resource-group myResourceGroup \
    --name myAKSCluster \
    --query oidcIssuerProfile.issuerUrl -o tsv)

echo $OIDC_ISSUER
```

## Creating a Managed Identity with Federation

```bash
# Create a user-assigned managed identity
az identity create \
    --resource-group myResourceGroup \
    --name workload-identity-demo

# Get the identity details
IDENTITY_CLIENT_ID=$(az identity show \
    --resource-group myResourceGroup \
    --name workload-identity-demo \
    --query clientId -o tsv)

IDENTITY_TENANT_ID=$(az identity show \
    --resource-group myResourceGroup \
    --name workload-identity-demo \
    --query tenantId -o tsv)
```

## Establishing Federated Credential

Link the Kubernetes service account to the Azure identity:

```bash
# Create federated credential
az identity federated-credential create \
    --name my-app-federated \
    --identity-name workload-identity-demo \
    --resource-group myResourceGroup \
    --issuer $OIDC_ISSUER \
    --subject system:serviceaccount:default:my-app-sa \
    --audience api://AzureADTokenExchange
```

## Creating the Service Account

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-app-sa
  namespace: default
  annotations:
    azure.workload.identity/client-id: "{client-id-guid}"
  labels:
    azure.workload.identity/use: "true"
```

## Installing the Workload Identity Webhook

```bash
# Add Helm repo
helm repo add azure-workload-identity https://azure.github.io/azure-workload-identity/charts
helm repo update

# Install the webhook
helm install workload-identity-webhook azure-workload-identity/workload-identity-webhook \
    --namespace azure-workload-identity-system \
    --create-namespace \
    --set azureTenantID="${IDENTITY_TENANT_ID}"
```

## Deploying a Pod with Workload Identity

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: default
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
        azure.workload.identity/use: "true"
    spec:
      serviceAccountName: my-app-sa
      containers:
      - name: app
        image: myregistry.azurecr.io/my-app:v1
        env:
        - name: AZURE_TENANT_ID
          value: "{tenant-id}"
        - name: AZURE_CLIENT_ID
          value: "{client-id}"
```

The webhook automatically injects:
- `AZURE_CLIENT_ID` environment variable
- `AZURE_TENANT_ID` environment variable
- `AZURE_FEDERATED_TOKEN_FILE` pointing to the projected token
- A volume with the service account token

## Using Workload Identity in Code

### Python Example

```python
from azure.identity import WorkloadIdentityCredential
from azure.keyvault.secrets import SecretClient

# Automatically uses AZURE_CLIENT_ID, AZURE_TENANT_ID, and AZURE_FEDERATED_TOKEN_FILE
credential = WorkloadIdentityCredential()

client = SecretClient(
    vault_url="https://mykeyvault.vault.azure.net",
    credential=credential
)

secret = client.get_secret("my-secret")
print(f"Retrieved secret: {secret.name}")
```

### .NET Example

```csharp
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;

// Automatically uses environment variables set by the webhook
var credential = new WorkloadIdentityCredential();

var client = new SecretClient(
    new Uri("https://mykeyvault.vault.azure.net"),
    credential
);

KeyVaultSecret secret = await client.GetSecretAsync("my-secret");
Console.WriteLine($"Retrieved secret: {secret.Name}");
```

### Go Example

```go
package main

import (
    "context"
    "fmt"

    "github.com/Azure/azure-sdk-for-go/sdk/azidentity"
    "github.com/Azure/azure-sdk-for-go/sdk/keyvault/azsecrets"
)

func main() {
    cred, err := azidentity.NewWorkloadIdentityCredential(nil)
    if err != nil {
        panic(err)
    }

    client, err := azsecrets.NewClient(
        "https://mykeyvault.vault.azure.net",
        cred,
        nil,
    )
    if err != nil {
        panic(err)
    }

    resp, err := client.GetSecret(context.Background(), "my-secret", "", nil)
    if err != nil {
        panic(err)
    }

    fmt.Printf("Secret value: %s\n", *resp.Value)
}
```

## Assigning Azure Permissions

```bash
# Grant Key Vault access
az keyvault set-policy \
    --name myKeyVault \
    --spn $IDENTITY_CLIENT_ID \
    --secret-permissions get list

# Grant Storage access
az role assignment create \
    --role "Storage Blob Data Reader" \
    --assignee $IDENTITY_CLIENT_ID \
    --scope /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Storage/storageAccounts/{account}

# Grant SQL access
az sql server ad-admin create \
    --resource-group myResourceGroup \
    --server myserver \
    --display-name "Workload Identity" \
    --object-id $(az identity show -g myResourceGroup -n workload-identity-demo --query principalId -o tsv)
```

## Terraform Configuration

```hcl
resource "azurerm_user_assigned_identity" "workload" {
  name                = "workload-identity-demo"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
}

resource "azurerm_federated_identity_credential" "workload" {
  name                = "my-app-federated"
  resource_group_name = azurerm_resource_group.main.name
  parent_id           = azurerm_user_assigned_identity.workload.id
  audience            = ["api://AzureADTokenExchange"]
  issuer              = azurerm_kubernetes_cluster.main.oidc_issuer_url
  subject             = "system:serviceaccount:default:my-app-sa"
}

resource "kubernetes_service_account" "my_app" {
  metadata {
    name      = "my-app-sa"
    namespace = "default"
    annotations = {
      "azure.workload.identity/client-id" = azurerm_user_assigned_identity.workload.client_id
    }
    labels = {
      "azure.workload.identity/use" = "true"
    }
  }
}
```

## Debugging

### Check Token Projection

```bash
kubectl exec -it my-app-pod -- cat /var/run/secrets/azure/tokens/azure-identity-token
```

### Verify Environment Variables

```bash
kubectl exec -it my-app-pod -- env | grep AZURE
```

### Test Authentication

```bash
# Inside the pod
curl -H "Authorization: Bearer $(cat /var/run/secrets/azure/tokens/azure-identity-token)" \
    "https://management.azure.com/subscriptions?api-version=2020-01-01"
```

## Migration from Pod Identity

1. Create federated credentials for existing identities
2. Update service accounts with workload identity annotations
3. Update applications to use WorkloadIdentityCredential
4. Test thoroughly
5. Remove AAD Pod Identity components

## Conclusion

Azure AD Workload Identity represents the future of identity management in AKS. Its use of standard Kubernetes features and Azure AD federation provides a more secure, portable, and efficient solution compared to traditional pod identity.

Tomorrow, we'll explore Container Insights for comprehensive AKS monitoring.
