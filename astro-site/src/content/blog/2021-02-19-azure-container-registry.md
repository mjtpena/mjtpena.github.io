---
title: Container Management with Azure Container Registry
author: Michael John Peña
draft: false
date: 2021-02-19
url: /blog/azure-container-registry/
tags:
  - Azure
  - Containers
  - Docker
  - DevOps
  - ACR
---

## Creating an Azure Container Registry

```bash
# Create a premium registry for advanced features
az acr create \
    --name myregistryacr2021 \
    --resource-group rg-containers \
    --location eastus \
    --sku Premium \
    --admin-enabled false

# Enable content trust
az acr config content-trust update \
    --registry myregistryacr2021 \
    --status enabled
```

## Building and Pushing Images

### Local Build and Push

```bash
# Login to ACR
az acr login --name myregistryacr2021

# Build image locally
docker build -t myregistryacr2021.azurecr.io/myapp:v1.0 .

# Push to ACR
docker push myregistryacr2021.azurecr.io/myapp:v1.0

# List images
az acr repository list --name myregistryacr2021 --output table

# Show tags for a repository
az acr repository show-tags \
    --name myregistryacr2021 \
    --repository myapp \
    --output table
```

### ACR Tasks for Cloud Builds

```bash
# Quick build using ACR Tasks
az acr build \
    --registry myregistryacr2021 \
    --image myapp:v1.0 \
    --file Dockerfile \
    .

# Build with build arguments
az acr build \
    --registry myregistryacr2021 \
    --image myapp:v1.0 \
    --build-arg VERSION=1.0 \
    --build-arg BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
    .
```

### Multi-step ACR Task

```yaml
# acr-task.yaml
version: v1.1.0
steps:
  # Build application image
  - build: -t $Registry/myapp:$Run.ID -t $Registry/myapp:latest -f Dockerfile .

  # Run tests
  - cmd: $Registry/myapp:$Run.ID npm test
    id: test

  # Push only if tests pass
  - push:
      - $Registry/myapp:$Run.ID
      - $Registry/myapp:latest
    when: ["test"]

  # Scan for vulnerabilities
  - cmd: trivy image --exit-code 1 --severity HIGH,CRITICAL $Registry/myapp:$Run.ID
    id: scan
```

Run the task:

```bash
az acr run \
    --registry myregistryacr2021 \
    --file acr-task.yaml \
    .
```

## Automated Builds with ACR Tasks

### Git Trigger

```bash
# Create task triggered by Git commits
az acr task create \
    --registry myregistryacr2021 \
    --name build-on-commit \
    --image myapp:{{.Run.ID}} \
    --context https://github.com/myorg/myrepo.git \
    --file Dockerfile \
    --git-access-token $GITHUB_TOKEN \
    --commit-trigger-enabled true \
    --branch main
```

### Base Image Update Trigger

```bash
# Rebuild when base image updates
az acr task create \
    --registry myregistryacr2021 \
    --name rebuild-on-base-update \
    --image myapp:{{.Run.ID}} \
    --context https://github.com/myorg/myrepo.git \
    --file Dockerfile \
    --git-access-token $GITHUB_TOKEN \
    --base-image-trigger-enabled true \
    --base-image-trigger-type All
```

### Scheduled Builds

```bash
# Weekly security rebuild
az acr task create \
    --registry myregistryacr2021 \
    --name weekly-rebuild \
    --image myapp:weekly-{{.Run.ID}} \
    --context https://github.com/myorg/myrepo.git \
    --file Dockerfile \
    --git-access-token $GITHUB_TOKEN \
    --schedule "0 0 * * 0"  # Every Sunday at midnight
```

## Geo-Replication

```bash
# Add replications for global distribution
az acr replication create \
    --registry myregistryacr2021 \
    --location westeurope

az acr replication create \
    --registry myregistryacr2021 \
    --location southeastasia

# List replications
az acr replication list \
    --registry myregistryacr2021 \
    --output table
```

## Security and Access Control

### Managed Identity Access

```python
from azure.identity import DefaultAzureCredential
from azure.containerregistry import ContainerRegistryClient
from azure.containerregistry.aio import ContainerRegistryClient as AsyncContainerRegistryClient

# Sync client
credential = DefaultAzureCredential()
client = ContainerRegistryClient(
    endpoint="https://myregistryacr2021.azurecr.io",
    credential=credential
)

# List repositories
for repo_name in client.list_repository_names():
    print(f"Repository: {repo_name}")

    # Get repository properties
    repo_client = client.get_repository(repo_name)
    for artifact in repo_client.list_manifest_properties():
        print(f"  Digest: {artifact.digest}")
        print(f"  Tags: {artifact.tags}")
        print(f"  Size: {artifact.size_in_bytes}")

# Delete old images
import datetime

cutoff_date = datetime.datetime.now() - datetime.timedelta(days=30)

for repo_name in client.list_repository_names():
    repo_client = client.get_repository(repo_name)
    for artifact in repo_client.list_manifest_properties():
        if artifact.created_on < cutoff_date and not artifact.tags:
            print(f"Deleting untagged manifest: {artifact.digest}")
            repo_client.delete_manifest(artifact.digest)
```

### Service Principal Access

```bash
# Create service principal with push/pull access
ACR_ID=$(az acr show --name myregistryacr2021 --query id -o tsv)

SP_INFO=$(az ad sp create-for-rbac \
    --name sp-acr-push \
    --scopes $ACR_ID \
    --role acrpush \
    --query "{appId:appId, password:password}" -o json)

# For pull-only access
az ad sp create-for-rbac \
    --name sp-acr-pull \
    --scopes $ACR_ID \
    --role acrpull
```

### Token-based Access

```bash
# Create scope map for specific repository access
az acr scope-map create \
    --registry myregistryacr2021 \
    --name myapp-read-write \
    --repository myapp content/read content/write metadata/read

# Create token
az acr token create \
    --registry myregistryacr2021 \
    --name myapp-token \
    --scope-map myapp-read-write

# Generate password for token
az acr token credential generate \
    --registry myregistryacr2021 \
    --name myapp-token \
    --password1
```

## Image Scanning and Security

```bash
# Enable Defender for Container Registries
az security pricing create \
    --name ContainerRegistry \
    --tier Standard

# View scan results
az acr repository show-manifests \
    --name myregistryacr2021 \
    --repository myapp \
    --detail

# Query vulnerability findings
az acr repository show \
    --name myregistryacr2021 \
    --image myapp:latest \
    --query "[quarantineDetails, lastUpdateTime]"
```

## Helm Chart Repository

```bash
# Enable Helm chart support
az acr helm repo add --name myregistryacr2021

# Package and push Helm chart
helm package ./mychart
az acr helm push \
    --name myregistryacr2021 \
    mychart-1.0.0.tgz

# List Helm charts
az acr helm list --name myregistryacr2021

# Pull and install chart
helm repo add myacr https://myregistryacr2021.azurecr.io/helm/v1/repo
helm install myrelease myacr/mychart
```

## OCI Artifact Support

```bash
# Push OCI artifact (e.g., WASM module)
oras push myregistryacr2021.azurecr.io/myartifact:v1.0 \
    --artifact-type application/vnd.wasm.content.layer.v1+wasm \
    ./module.wasm

# Pull OCI artifact
oras pull myregistryacr2021.azurecr.io/myartifact:v1.0

# Push Bicep module
az bicep publish \
    --file main.bicep \
    --target br:myregistryacr2021.azurecr.io/bicep/modules/webapp:v1.0
```

## Lifecycle Management

```python
from azure.containerregistry import ContainerRegistryClient
from azure.identity import DefaultAzureCredential
from datetime import datetime, timedelta

def cleanup_old_images(registry_url, days_old=30, keep_latest=5):
    """Clean up old untagged images from ACR."""

    credential = DefaultAzureCredential()
    client = ContainerRegistryClient(endpoint=registry_url, credential=credential)

    cutoff_date = datetime.now() - timedelta(days=days_old)

    for repo_name in client.list_repository_names():
        print(f"\nProcessing repository: {repo_name}")
        repo = client.get_repository(repo_name)

        # Get all manifests sorted by date
        manifests = list(repo.list_manifest_properties(order_by="timedesc"))

        # Keep latest N tagged images
        tagged_count = 0
        for manifest in manifests:
            if manifest.tags:
                tagged_count += 1
                if tagged_count <= keep_latest:
                    print(f"  Keeping: {manifest.tags[0]} ({manifest.digest[:12]})")
                    continue

            # Delete if old and untagged, or excess tagged images
            if manifest.created_on < cutoff_date or (manifest.tags and tagged_count > keep_latest):
                print(f"  Deleting: {manifest.digest[:12]} (created {manifest.created_on})")
                try:
                    repo.delete_manifest(manifest.digest)
                except Exception as e:
                    print(f"    Error: {e}")

# Usage
cleanup_old_images("https://myregistryacr2021.azurecr.io", days_old=30, keep_latest=5)
```

## Best Practices

1. **Use Premium SKU** for production with geo-replication and security features
2. **Enable content trust** for image signing
3. **Implement lifecycle policies** to manage storage costs
4. **Use managed identities** for authentication when possible
5. **Scan images** for vulnerabilities before deployment
6. **Enable firewall rules** to restrict network access

## Conclusion

Azure Container Registry provides a secure, scalable platform for managing container images and OCI artifacts. Its tight integration with Azure services and enterprise features like geo-replication and vulnerability scanning make it an excellent choice for containerized applications.

Start with the Basic SKU for development and upgrade to Premium for production workloads requiring advanced features.
