---
title: Getting Started with Azure Machine Learning Compute Instances
description: "Azure ML Compute Instances are the development environment that removes the \"I can't reproduce the team's ML environment\" problem for data science teams.…"
author: Michael John Pena
draft: false
date: 2021-09-01
tags:
  - Azure
  - Machine Learning
  - Azure ML
  - Data Science
  - Cloud Computing
---

Azure ML Compute Instances are the development environment that removes the "I can't reproduce the team's ML environment" problem for data science teams. Rather than each data scientist managing their own Python environment, GPU drivers, and Jupyter configuration locally, a Compute Instance is a cloud VM pre-configured with Jupyter, JupyterLab, VS Code (browser), RStudio, and the popular ML frameworks (PyTorch, TensorFlow, scikit-learn, XGBoost)—standardised and versioned at the workspace level. The practical benefits: the data lives in Azure Storage and doesn't need to travel to a local machine, the environment is reproducible, and the instance can be shared (or shut down when not in use to stop billing). For teams working with sensitive data, keeping compute and data co-located in Azure eliminates the governance challenge of data leaving the cloud boundary to local laptops.

## What is a Compute Instance?

A compute instance is a managed cloud-based workstation optimized for machine learning development. It includes Jupyter, JupyterLab, VS Code (web), RStudio, and a terminal. The instance comes pre-installed with popular ML frameworks like PyTorch, TensorFlow, and scikit-learn.

## Creating a Compute Instance via Azure CLI

```bash
# Install the Azure ML extension
az extension add -n ml

# Create a compute instance
az ml compute create --name my-compute-instance \
  --type ComputeInstance \
  --size Standard_DS3_v2 \
  --resource-group myresourcegroup \
  --workspace-name myworkspace
```

## Creating via Python SDK

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import ComputeInstance
from azure.identity import DefaultAzureCredential

# Initialize ML client
credential = DefaultAzureCredential()
ml_client = MLClient(
    credential=credential,
    subscription_id="your-subscription-id",
    resource_group_name="myresourcegroup",
    workspace_name="myworkspace"
)

# Define compute instance configuration
compute_instance = ComputeInstance(
    name="my-compute-instance",
    size="Standard_DS3_v2",
    idle_time_before_shutdown="PT30M",  # Auto-shutdown after 30 min idle
    setup_scripts={
        "creation_script": {
            "script_source": "inline",
            "script": "pip install pandas numpy"
        }
    }
)

# Create the compute instance
ml_client.compute.begin_create_or_update(compute_instance).result()
print("Compute instance created successfully!")
```

## Configuring Auto-Shutdown

One of the best features for cost management is the auto-shutdown capability:

```python
from azure.ai.ml.entities import ComputeInstance, ComputeSchedules, ComputeStartStopSchedule
from azure.ai.ml.constants import TimeZone

# Create schedule for auto-shutdown
schedules = ComputeSchedules(
    compute_start_stop=[
        ComputeStartStopSchedule(
            trigger={"type": "Recurrence", "frequency": "Day", "interval": 1},
            action="Stop",
            schedule={"hours": 19, "minutes": 0, "time_zone": TimeZone.PACIFIC_STANDARD_TIME}
        )
    ]
)

compute_instance = ComputeInstance(
    name="scheduled-instance",
    size="Standard_DS3_v2",
    schedules=schedules
)
```

## Accessing Your Compute Instance

Once created, you can access your compute instance through multiple interfaces:

1. **Jupyter Notebooks**: Navigate to the Azure ML Studio and click on "Notebooks"
2. **JupyterLab**: Full JupyterLab experience with extensions
3. **VS Code Web**: Browser-based VS Code experience
4. **Terminal**: SSH access for command-line operations

## Best Practices

1. **Choose the right VM size**: Start with smaller instances like DS3_v2 for development, scale up for training
2. **Enable auto-shutdown**: Always configure idle shutdown to manage costs
3. **Use setup scripts**: Automate your environment configuration
4. **Leverage SSH access**: Connect from your local VS Code for a seamless experience

## Cost Optimization Tips

```python
# List all compute instances to audit
computes = ml_client.compute.list()
for compute in computes:
    if compute.type == "ComputeInstance":
        print(f"Instance: {compute.name}, State: {compute.state}, Size: {compute.size}")

# Stop idle instances
ml_client.compute.begin_stop("my-compute-instance").result()
```

Compute instances are the perfect starting point for your Azure ML journey. They provide everything you need to explore data, build models, and collaborate with your team - all in a managed, secure environment.
