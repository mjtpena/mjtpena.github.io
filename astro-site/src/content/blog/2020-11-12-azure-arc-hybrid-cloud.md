---
title: "Azure Arc: Manage Resources Anywhere"
description: "Most enterprises I work with aren't \"going to the cloud\"—they're running half their estate on-prem, a slice on AWS, a dev environment on a colleague's…"
author: Michael John Peña
draft: false
date: 2020-11-12
tags:
  - Azure
  - Azure Arc
  - Hybrid Cloud
  - Multi-Cloud
---

Most enterprises I work with aren't "going to the cloud"—they're running half their estate on-prem, a slice on AWS, a dev environment on a colleague's laptop, and a SQL instance nobody can find an owner for. Azure Arc is Microsoft's answer to that mess. Project on-prem servers, Kubernetes clusters, and SQL instances into the Azure control plane and manage them with the same RBAC, Policy, and Monitor you already use.

## Arc-Enabled Services

- **Servers**: Windows and Linux machines
- **Kubernetes**: Any conformant K8s cluster
- **SQL Server**: On-premises SQL instances
- **Data Services**: Azure SQL MI and PostgreSQL anywhere

## Arc-Enabled Servers

```bash
# Download and run the onboarding script
wget https://aka.ms/azcmagent-linux
chmod +x azcmagent-linux

# Connect to Azure Arc
./azcmagent connect \
    --resource-group myRG \
    --location eastus \
    --subscription-id {sub-id} \
    --tenant-id {tenant-id} \
    --service-principal-id {sp-id} \
    --service-principal-secret {secret}
```

## Arc-Enabled Kubernetes

```bash
# Install connectedk8s extension
az extension add --name connectedk8s

# Connect cluster
az connectedk8s connect \
    --name my-onprem-cluster \
    --resource-group myRG \
    --location eastus

# Verify connection
az connectedk8s show \
    --name my-onprem-cluster \
    --resource-group myRG
```

## GitOps with Flux

```bash
# Create GitOps configuration
az k8s-configuration flux create \
    --name cluster-config \
    --cluster-name my-onprem-cluster \
    --resource-group myRG \
    --cluster-type connectedClusters \
    --scope cluster \
    --namespace flux-system \
    --url https://github.com/myorg/k8s-config \
    --branch main \
    --kustomization name=infra path=./infrastructure prune=true \
    --kustomization name=apps path=./apps prune=true depends_on=["infra"]
```

## Azure Policy for Arc

```bash
# Assign policy to Arc-enabled servers
az policy assignment create \
    --name "audit-ssh-posture" \
    --policy "audit-linux-ssh-settings" \
    --scope "/subscriptions/{sub}/resourceGroups/myRG"
```

## Arc-Enabled SQL Server

```bash
# Register SQL Server with Arc
az sql server-arc create \
    --name sql-onprem-001 \
    --resource-group myRG \
    --location eastus \
    --license-type Paid \
    --cores-limit 8
```

Benefits:
- Azure Defender for SQL (threat detection)
- Azure Policy guest configurations
- Inventory and assessment
- Best practices recommendations

## Arc Data Services

Run Azure data services anywhere:

```bash
# Create data controller
az arcdata dc create \
    --name arc-dc \
    --resource-group myRG \
    --location eastus \
    --connectivity-mode indirect \
    --namespace arc

# Deploy SQL Managed Instance
az sql mi-arc create \
    --name sql-mi-arc \
    --resource-group myRG \
    --location eastus \
    --data-controller-name arc-dc \
    --cores-limit 4 \
    --memory-limit 8Gi
```

## VM Extensions on Arc Servers

```bash
# Install Log Analytics agent
az connectedmachine extension create \
    --machine-name my-server \
    --resource-group myRG \
    --name MicrosoftMonitoringAgent \
    --type MicrosoftMonitoringAgent \
    --publisher Microsoft.EnterpriseCloud.Monitoring \
    --settings '{"workspaceId":"xxx"}' \
    --protected-settings '{"workspaceKey":"xxx"}'
```

## Unified Operations

```
┌─────────────────────────────────────────────────┐
│                 Azure Portal                      │
│  (Single pane of glass)                          │
├─────────────────────────────────────────────────┤
│                                                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐         │
│  │ Azure   │  │ On-Prem │  │  AWS    │         │
│  │ VMs     │  │ Servers │  │  EC2    │         │
│  └─────────┘  └─────────┘  └─────────┘         │
│                                                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐         │
│  │  AKS    │  │ VMware  │  │  EKS    │         │
│  │         │  │ K8s     │  │         │         │
│  └─────────┘  └─────────┘  └─────────┘         │
└─────────────────────────────────────────────────┘
```

Azure Arc: your hybrid cloud, unified.
