---
title: Scaling Machine Learning with Azure ML Compute Clusters
author: Michael John Pena
draft: false
date: 2021-09-02
tags:
  - Azure
  - Machine Learning
  - Azure ML
  - MLOps
  - Distributed Computing

---

I wrote "2021-09-02-azure-ml-compute-clusters" to share practical, production-minded guidance on this topic.

## Understanding Compute Clusters

Compute clusters are managed compute infrastructure that allows you to create single or multi-node compute for training and batch inferencing. Key features include:

- Auto-scaling from 0 to N nodes
- Support for low-priority VMs (up to 80% cost savings)
- Dedicated or shared compute across team members
- Built-in job scheduling and queuing

## Creating a Compute Cluster

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import AmlCompute
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
ml_client = MLClient(
    credential=credential,
    subscription_id="your-subscription-id",
    resource_group_name="myresourcegroup",
    workspace_name="myworkspace"
)

# Create a compute cluster
cluster = AmlCompute(
    name="gpu-cluster",
    type="amlcompute",
    size="Standard_NC6",  # GPU VM
    min_instances=0,
    max_instances=4,
    idle_time_before_scale_down=120,  # seconds
    tier="Dedicated"  # or "LowPriority" for cost savings
)

ml_client.compute.begin_create_or_update(cluster).result()
print("Compute cluster created!")
```

## Running a Training Job on the Cluster

```python
from azure.ai.ml import command, Input

# Define a training job
training_job = command(
    code="./src",
    command="python train.py --data ${{inputs.training_data}} --epochs ${{inputs.epochs}}",
    inputs={
        "training_data": Input(type="uri_folder", path="azureml://datastores/workspaceblobstore/paths/data/"),
        "epochs": 50
    },
    environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu@latest",
    compute="gpu-cluster",
    experiment_name="my-training-experiment",
    display_name="training-run-001"
)

# Submit the job
returned_job = ml_client.jobs.create_or_update(training_job)
print(f"Job submitted: {returned_job.name}")
```

## Distributed Training Configuration

For large models, you can configure distributed training across multiple nodes:

```python
from azure.ai.ml import command, MpiDistribution

distributed_job = command(
    code="./src",
    command="python train_distributed.py",
    environment="AzureML-pytorch-1.9-ubuntu18.04-py37-cuda11-gpu@latest",
    compute="gpu-cluster",
    instance_count=4,  # Number of nodes
    distribution=MpiDistribution(process_count_per_instance=1),
    experiment_name="distributed-training"
)

ml_client.jobs.create_or_update(distributed_job)
```

## Training Script Example

```python
# train.py
import argparse
import os
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score
import joblib
import mlflow

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=str, required=True)
    parser.add_argument("--epochs", type=int, default=100)
    args = parser.parse_args()

    # Start MLflow run
    mlflow.start_run()

    # Load data
    data_path = os.path.join(args.data, "training_data.csv")
    df = pd.read_csv(data_path)

    X = df.drop("target", axis=1)
    y = df["target"]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)

    # Train model
    model = RandomForestClassifier(n_estimators=args.epochs)
    model.fit(X_train, y_train)

    # Evaluate
    predictions = model.predict(X_test)
    accuracy = accuracy_score(y_test, predictions)

    # Log metrics
    mlflow.log_metric("accuracy", accuracy)
    mlflow.log_param("n_estimators", args.epochs)

    # Save model
    os.makedirs("outputs", exist_ok=True)
    joblib.dump(model, "outputs/model.pkl")
    mlflow.sklearn.log_model(model, "model")

    mlflow.end_run()
    print(f"Training complete. Accuracy: {accuracy}")

if __name__ == "__main__":
    main()
```

## Cost Management with Low-Priority VMs

```python
# Create a cost-effective cluster with low-priority VMs
low_priority_cluster = AmlCompute(
    name="training-cluster-lowpri",
    size="Standard_NC6",
    min_instances=0,
    max_instances=10,
    tier="LowPriority",
    idle_time_before_scale_down=300
)

ml_client.compute.begin_create_or_update(low_priority_cluster)
```

Low-priority VMs can be preempted, so they're best for:
- Fault-tolerant training jobs with checkpointing
- Hyperparameter tuning experiments
- Non-time-critical batch processing

## Monitoring Cluster Usage

```python
# Get cluster status
cluster = ml_client.compute.get("gpu-cluster")
print(f"Current nodes: {cluster.current_node_count}")
print(f"State: {cluster.provisioning_state}")

# List all running jobs on the cluster
jobs = ml_client.jobs.list()
for job in jobs:
    if job.compute == "gpu-cluster" and job.status.running:
        print(f"Running job: {job.name}")
```

Compute clusters are essential for production ML workloads. Their ability to scale dynamically and support distributed training makes them the backbone of enterprise machine learning operations.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
