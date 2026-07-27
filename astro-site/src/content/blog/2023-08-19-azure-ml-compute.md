---
title: "Azure ML Compute: Choosing the Right Infrastructure"
author: Michael John Peña
draft: false
date: 2023-08-19
tags:
  - Azure ML
  - Compute
  - GPU
  - Cloud
---

Azure ML offers three distinct compute experiences, and choosing the right one makes a significant difference to both cost and development friction. For interactive development — experimentation, notebook-based exploration, debugging — Compute Instances (single-node VMs with Jupyter and VS Code pre-configured) are the right tool; the DS3_v2 or DS5_v2 sizes work for CPU workloads and NV-series for GPU work that doesn't need the largest models. For training jobs — QLoRA fine-tuning of Llama 2, distributed training with Accelerate — Compute Clusters are the right choice: they scale to zero when idle (you pay only for active jobs) and can use spot/low-priority instances for up to 80% cost reduction with preemption handling. For inference serving, Managed Online Endpoints abstract the Kubernetes deployment and autoscaling, and Batch Endpoints handle the asynchronous high-throughput scoring scenarios. The mistake I see most often: using a Compute Instance for training jobs instead of a Cluster, running up compute costs for idle time.

## Compute Options Overview

```python
compute_types = {
    "compute_instance": {
        "use": "Development, notebooks",
        "scaling": "Single VM",
        "cost": "Pay while running"
    },
    "compute_cluster": {
        "use": "Training jobs",
        "scaling": "Auto-scale 0 to N nodes",
        "cost": "Pay per use"
    },
    "serverless_compute": {
        "use": "Quick experiments",
        "scaling": "Automatic",
        "cost": "Pay per job"
    },
    "kubernetes": {
        "use": "Production deployment",
        "scaling": "Kubernetes-managed",
        "cost": "AKS pricing"
    }
}
```

## Creating Compute Clusters

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import AmlCompute
from azure.identity import DefaultAzureCredential

# Connect to workspace
ml_client = MLClient(
    DefaultAzureCredential(),
    subscription_id="your-subscription",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Create GPU compute cluster
gpu_cluster = AmlCompute(
    name="gpu-cluster",
    type="amlcompute",
    size="Standard_NC6s_v3",  # T4 GPU
    min_instances=0,
    max_instances=4,
    idle_time_before_scale_down=300,
    tier="Dedicated"
)

ml_client.compute.begin_create_or_update(gpu_cluster).result()
```

## GPU VM Sizes

```python
gpu_sizes = {
    # Entry-level
    "Standard_NC6s_v3": {
        "gpu": "1x V100 16GB",
        "vcpu": 6,
        "memory": "112 GB",
        "use": "Fine-tuning small models"
    },
    # Mid-range
    "Standard_NC12s_v3": {
        "gpu": "2x V100 16GB",
        "vcpu": 12,
        "memory": "224 GB",
        "use": "Training medium models"
    },
    # High-end
    "Standard_NC24ads_A100_v4": {
        "gpu": "1x A100 80GB",
        "vcpu": 24,
        "memory": "220 GB",
        "use": "Large model training"
    },
    "Standard_ND96asr_v4": {
        "gpu": "8x A100 40GB",
        "vcpu": 96,
        "memory": "900 GB",
        "use": "Distributed training"
    }
}
```

## Submitting Training Jobs

```python
from azure.ai.ml import command, Input

# Define training job
job = command(
    code="./src",
    command="python train.py --model-name ${{inputs.model}} --epochs ${{inputs.epochs}}",
    inputs={
        "model": "meta-llama/Llama-2-7b-hf",
        "epochs": 3
    },
    environment="AzureML-pytorch-2.0-cuda11.7@latest",
    compute="gpu-cluster",
    instance_count=1,
    distribution={
        "type": "PyTorch",
        "process_count_per_instance": 1
    }
)

# Submit job
submitted_job = ml_client.jobs.create_or_update(job)
print(f"Job submitted: {submitted_job.name}")

# Monitor
ml_client.jobs.stream(submitted_job.name)
```

## Distributed Training Configuration

```python
from azure.ai.ml import command
from azure.ai.ml.entities import ResourceConfiguration

# Multi-GPU job
distributed_job = command(
    code="./src",
    command="torchrun --nproc_per_node=4 train.py",
    environment="AzureML-pytorch-2.0-cuda11.7@latest",
    compute="gpu-cluster",
    resources=ResourceConfiguration(
        instance_count=2,  # 2 nodes
        instance_type="Standard_NC24ads_A100_v4"
    ),
    distribution={
        "type": "PyTorch",
        "process_count_per_instance": 4  # 4 GPUs per node
    }
)

ml_client.jobs.create_or_update(distributed_job)
```

## Cost Optimization

```python
# Use spot instances for training
spot_cluster = AmlCompute(
    name="spot-gpu-cluster",
    size="Standard_NC24ads_A100_v4",
    min_instances=0,
    max_instances=4,
    tier="LowPriority",  # Spot instances
    idle_time_before_scale_down=120
)

# Cost comparison
cost_comparison = {
    "Standard_NC6s_v3": {
        "dedicated": "$0.90/hour",
        "spot": "$0.27/hour",
        "savings": "70%"
    },
    "Standard_NC24ads_A100_v4": {
        "dedicated": "$3.67/hour",
        "spot": "$1.10/hour",
        "savings": "70%"
    }
}
```

## Managed Online Endpoints

```python
from azure.ai.ml.entities import (
    ManagedOnlineEndpoint,
    ManagedOnlineDeployment,
    Model
)

# Create endpoint
endpoint = ManagedOnlineEndpoint(
    name="llm-endpoint",
    auth_mode="key"
)
ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# Deploy model
deployment = ManagedOnlineDeployment(
    name="llm-deployment",
    endpoint_name="llm-endpoint",
    model=Model(path="./model"),
    instance_type="Standard_NC6s_v3",
    instance_count=1,
    environment="AzureML-pytorch-2.0-cuda11.7@latest",
    code_configuration=CodeConfiguration(
        code="./score",
        scoring_script="score.py"
    )
)
ml_client.online_deployments.begin_create_or_update(deployment).result()
```

## Monitoring Compute

```python
# Get compute status
compute = ml_client.compute.get("gpu-cluster")
print(f"State: {compute.provisioning_state}")
print(f"Current nodes: {compute.current_instance_count}")

# List running jobs
jobs = ml_client.jobs.list()
for job in jobs:
    if job.status == "Running":
        print(f"{job.name}: {job.status}")
```

Tomorrow we'll explore spot instances for ML workloads.

## Resources

- [Azure ML Compute](https://learn.microsoft.com/en-us/azure/machine-learning/concept-compute-target)
- [GPU VM Sizes](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes-gpu)
- [Cost Optimization](https://learn.microsoft.com/en-us/azure/machine-learning/how-to-manage-optimize-cost)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
