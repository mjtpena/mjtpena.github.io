---
title: "Azure Container Instances: Serverless Containers"
author: Michael John Peña
draft: false
date: 2020-09-12
tags:
  - Azure
  - Containers
  - Docker
  - Serverless
---

For "I need to run this container for an hour to crunch some data," ACI is the right answer roughly nine times out of ten. AKS is overkill, App Service for Containers feels heavy, and writing a Function host wrapper is fiddly. ACI just runs the container, charges per second, and disappears. The trade-off is no autoscaling and a cap on size — so it's perfect for batch and burst workloads, less so for long-running services.

## Quick Deployment

```bash
az container create \
    --resource-group myResourceGroup \
    --name mycontainer \
    --image mcr.microsoft.com/azuredocs/aci-helloworld \
    --dns-name-label mydemo \
    --ports 80
```

Container running in seconds.

## Use Cases

### 1. Batch Processing

```python
# Run a data processing job
az container create \
    --resource-group batch-rg \
    --name data-processor \
    --image myregistry.azurecr.io/data-processor:latest \
    --restart-policy Never \
    --environment-variables \
        INPUT_BLOB="https://storage/input/data.csv" \
        OUTPUT_BLOB="https://storage/output/result.csv"
```

### 2. Build Agents

```yaml
# Azure DevOps pipeline with ACI
pool:
  vmImage: 'ubuntu-latest'
steps:
  - task: AzureCLI@2
    inputs:
      azureSubscription: 'MySubscription'
      scriptType: 'bash'
      scriptLocation: 'inlineScript'
      inlineScript: |
        az container create \
          --resource-group build-rg \
          --name build-$(Build.BuildId) \
          --image myregistry.azurecr.io/build-agent:latest \
          --restart-policy Never
```

### 3. Sidecar Containers

```yaml
apiVersion: '2019-12-01'
location: eastus
type: Microsoft.ContainerInstance/containerGroups
properties:
  containers:
    - name: main-app
      properties:
        image: myapp:latest
        ports: [{port: 80}]
    - name: log-shipper
      properties:
        image: fluent/fluentd:latest
        volumeMounts: [{name: logs, mountPath: /var/log}]
  volumes:
    - name: logs
      emptyDir: {}
```

## Limitations

- No auto-scaling (use AKS for that)
- Maximum 4 vCPUs, 16 GB RAM per container
- Ephemeral by default (use Azure Files for persistence)

ACI is perfect for short-lived, burst workloads where Kubernetes would be overkill.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
