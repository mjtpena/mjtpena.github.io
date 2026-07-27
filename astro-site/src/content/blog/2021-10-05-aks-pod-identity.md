---
title: "Secure Azure Access with AKS Pod Identity"
author: "Michael John Peña"
draft: false
date: 2021-10-05
tags: ["Azure", "Kubernetes", "AKS", "Security", "Identity"]

---

I wrote "Secure Azure Access with AKS Pod Identity" to share practical, production-minded guidance on this topic.

AAD Pod Identity was the original mechanism for giving Kubernetes pods an Azure AD identity so they could access Azure resources—Key Vault secrets, Storage Accounts, Cosmos DB—without storing credentials anywhere. The architecture: a NMI DaemonSet intercepted IMDS requests from pods and exchanged them for tokens scoped to the pod's assigned Managed Identity. It worked, but the NMI DaemonSet approach added latency to identity requests and required privileged cluster access. By October 2021, Microsoft had already released the Workload Identity preview as the successor—it was worth understanding Pod Identity because most production clusters were still running it, but new deployments should have evaluated Workload Identity. The core concept both share—pods getting Managed Identity tokens without secrets—is the right security posture for AKS applications accessing Azure services.

## Understanding Pod Identity

Pod Identity assigns Azure managed identities to pods, enabling:
- Secretless authentication to Azure services
- Fine-grained access control per workload
- Automatic credential rotation
- Audit trail in Azure AD

## Installing AAD Pod Identity

### Using Helm

```bash
# Add the AAD Pod Identity Helm repo
helm repo add aad-pod-identity https://raw.githubusercontent.com/Azure/aad-pod-identity/master/charts
helm repo update

# Install in managed mode (recommended for managed AKS)
helm install aad-pod-identity aad-pod-identity/aad-pod-identity \
    --namespace kube-system \
    --set operationMode=managed \
    --set forceNamespaced=true
```

### Verify Installation

```bash
kubectl get pods -n kube-system | grep aad-pod-identity

# Should see:
# aad-pod-identity-mic-xxx   Running
# aad-pod-identity-nmi-xxx   Running
```

## Creating an Azure Identity

```bash
# Create a user-assigned managed identity
az identity create \
    --resource-group myResourceGroup \
    --name myPodIdentity

# Get the identity resource ID and client ID
IDENTITY_RESOURCE_ID=$(az identity show \
    --resource-group myResourceGroup \
    --name myPodIdentity \
    --query id -o tsv)

IDENTITY_CLIENT_ID=$(az identity show \
    --resource-group myResourceGroup \
    --name myPodIdentity \
    --query clientId -o tsv)
```

## Assigning Permissions

Grant the identity access to Azure resources:

```bash
# Example: Grant access to Key Vault
az keyvault set-policy \
    --name myKeyVault \
    --object-id $(az identity show --resource-group myResourceGroup --name myPodIdentity --query principalId -o tsv) \
    --secret-permissions get list

# Example: Grant access to Storage Account
az role assignment create \
    --role "Storage Blob Data Reader" \
    --assignee $(az identity show --resource-group myResourceGroup --name myPodIdentity --query principalId -o tsv) \
    --scope /subscriptions/{subscription-id}/resourceGroups/myResourceGroup/providers/Microsoft.Storage/storageAccounts/mystorageaccount
```

## Creating AzureIdentity and AzureIdentityBinding

```yaml
apiVersion: aadpodidentity.k8s.io/v1
kind: AzureIdentity
metadata:
  name: my-pod-identity
  namespace: default
spec:
  type: 0  # 0 = User Assigned, 1 = Service Principal
  resourceID: /subscriptions/{subscription-id}/resourceGroups/myResourceGroup/providers/Microsoft.ManagedIdentity/userAssignedIdentities/myPodIdentity
  clientID: {client-id-guid}\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
