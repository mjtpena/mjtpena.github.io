---
title: "Kubernetes Cost Optimization on AKS: Lessons from 2025"
author: Michael John Peña
draft: false
date: 2025-12-07
tags:
  - Kubernetes
  - AKS
  - Cost-Optimization
  - Azure
  - DevOps

---

I wrote "Kubernetes Cost Optimization on AKS: Lessons from 2025" to share practical, production-minded guidance on this topic.

## Right-Sizing Workloads

The biggest cost savings come from accurate resource requests:

```yaml
# Before optimization - over-provisioned
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
spec:
  replicas: 5
  template:
    spec:
      containers:
      - name: api
        resources:
          requests:
            memory: "2Gi"
            cpu: "1000m"
          limits:
            memory: "4Gi"
            cpu: "2000m"

# After optimization - based on actual metrics
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: api
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
```

## Implementing KEDA for Scale-to-Zero

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: queue-processor-scaler
spec:
  scaleTargetRef:
    name: queue-processor
  minReplicaCount: 0  # Scale to zero during off-hours
  maxReplicaCount: 20
  triggers:
  - type: azure-servicebus
    metadata:
      queueName: orders
      messageCount: "5"
      connectionFromEnv: SERVICEBUS_CONNECTION
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleDown:
          stabilizationWindowSeconds: 300
          policies:
          - type: Percent
            value: 50
            periodSeconds: 60
```

## Spot Instances for Non-Critical Workloads

```bash
# Create spot node pool for batch processing
az aks nodepool add \
  --resource-group myRG \
  --cluster-name myAKS \
  --name spotnodes \
  --priority Spot \
  --eviction-policy Delete \
  --spot-max-price -1 \
  --node-count 3 \
  --node-vm-size Standard_D4s_v3 \
  --labels workload-type=batch
```

```yaml
# Schedule batch jobs on spot nodes
apiVersion: batch/v1
kind: Job
metadata:
  name: data-processing
spec:
  template:
    spec:
      nodeSelector:
        workload-type: batch
      tolerations:
      - key: "kubernetes.azure.com/scalesetpriority"
        operator: "Equal"
        value: "spot"
        effect: "NoSchedule"
      containers:
      - name: processor
        image: myregistry/processor:latest
```

## Cost Monitoring Dashboard

```sql
-- KQL query for cost analysis
ContainerInventory
| where TimeGenerated > ago(7d)
| summarize
    AvgCPU = avg(CPUPercentage),
    AvgMemory = avg(MemoryUsedPercentage),
    TotalGB = sum(ImageSize) / 1024 / 1024 / 1024
by ContainerName, bin(TimeGenerated, 1h)
| where AvgCPU < 10 or AvgMemory < 20
| project ContainerName, AvgCPU, AvgMemory
```

## Key Metrics to Track

1. **CPU/Memory utilization ratio** - Target 60-70%
2. **Node count vs workload** - Minimize idle nodes
3. **Spot vs on-demand ratio** - Aim for 40% spot for suitable workloads
4. **Egress costs** - Often overlooked but significant

Kubernetes cost optimization is continuous. Review these metrics weekly and adjust based on actual usage patterns.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
