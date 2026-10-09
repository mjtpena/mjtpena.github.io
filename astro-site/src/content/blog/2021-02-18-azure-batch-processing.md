---
title: Scalable Compute with Azure Batch
description: "Batch is underused. Every time I describe it to an engineering team—\"managed pool of VMs, automatic scaling, job and task model, retry on failure…"
author: Michael John Peña
draft: false
date: 2021-02-18
url: /blog/azure-batch-processing/
tags:
  - Azure
  - Batch
  - HPC
  - Compute
  - Parallel Processing
---

Batch is underused. Every time I describe it to an engineering team—"managed pool of VMs, automatic scaling, job and task model, retry on failure, low-priority VMs for 60–80% cost savings"—the response is usually "we've been doing that with a queue and a Functions Premium plan." Batch is the cleaner alternative for the class of work that's genuinely parallel and compute-heavy: video transcoding, Monte Carlo simulations, document processing at scale, anything where you want to fan out to hundreds of cores for minutes and then scale to zero. The economics change significantly when you factor in spot/low-priority pricing.

## When to Use Azure Batch

Azure Batch excels at:

- **Embarrassingly parallel workloads** - Independent tasks that can run simultaneously
- **HPC simulations** - Rendering, financial modeling, scientific computing
- **Batch processing** - Image/video processing, data transformation
- **Machine learning training** - Distributed hyperparameter tuning

## Setting Up Azure Batch

```bash
# Create a Batch account
az batch account create \
    --name batchdemo2021 \
    --resource-group rg-batch \
    --location eastus

# Create a Storage account for input/output
az storage account create \
    --name stbatchdemo2021 \
    --resource-group rg-batch \
    --location eastus \
    --sku Standard_LRS

# Link Storage to Batch account
az batch account set \
    --name batchdemo2021 \
    --resource-group rg-batch \
    --storage-account stbatchdemo2021
```

## Creating Pools, Jobs, and Tasks with Python

```python
from azure.batch import BatchServiceClient
from azure.batch.batch_auth import SharedKeyCredentials
from azure.batch import models as batchmodels
from azure.storage.blob import BlobServiceClient, ContainerSasPermissions, generate_container_sas
from datetime import datetime, timedelta
import os

# Configuration
BATCH_ACCOUNT_NAME = "batchdemo2021"
BATCH_ACCOUNT_KEY = os.environ["BATCH_KEY"]
BATCH_ACCOUNT_URL = f"https://{BATCH_ACCOUNT_NAME}.eastus.batch.azure.com"
STORAGE_ACCOUNT_NAME = "stbatchdemo2021"
STORAGE_ACCOUNT_KEY = os.environ["STORAGE_KEY"]

# Create clients
credentials = SharedKeyCredentials(BATCH_ACCOUNT_NAME, BATCH_ACCOUNT_KEY)
batch_client = BatchServiceClient(credentials, batch_url=BATCH_ACCOUNT_URL)

blob_service = BlobServiceClient(
    account_url=f"https://{STORAGE_ACCOUNT_NAME}.blob.core.windows.net",
    credential=STORAGE_ACCOUNT_KEY
)

def create_pool(pool_id, vm_size, node_count):
    """Create a pool of compute nodes."""

    # Define the image reference
    image_reference = batchmodels.ImageReference(
        publisher="canonical",
        offer="0001-com-ubuntu-server-focal",
        sku="20_04-lts",
        version="latest"
    )

    # Define the VM configuration
    vm_config = batchmodels.VirtualMachineConfiguration(
        image_reference=image_reference,
        node_agent_sku_id="batch.node.ubuntu 20.04"
    )

    # Define start task to install dependencies
    start_task = batchmodels.StartTask(
        command_line="/bin/bash -c 'apt-get update && apt-get install -y python3-pip && pip3 install pandas numpy scikit-learn'",
        wait_for_success=True,
        user_identity=batchmodels.UserIdentity(
            auto_user=batchmodels.AutoUserSpecification(
                scope=batchmodels.AutoUserScope.pool,
                elevation_level=batchmodels.ElevationLevel.admin
            )
        )
    )

    # Create the pool
    pool = batchmodels.PoolAddParameter(
        id=pool_id,
        virtual_machine_configuration=vm_config,
        vm_size=vm_size,
        target_dedicated_nodes=node_count,
        start_task=start_task,
        enable_auto_scale=False
    )

    batch_client.pool.add(pool)
    print(f"Pool {pool_id} created with {node_count} {vm_size} nodes")

def create_auto_scale_pool(pool_id, vm_size, min_nodes, max_nodes):
    """Create an auto-scaling pool."""

    image_reference = batchmodels.ImageReference(
        publisher="canonical",
        offer="0001-com-ubuntu-server-focal",
        sku="20_04-lts",
        version="latest"
    )

    vm_config = batchmodels.VirtualMachineConfiguration(
        image_reference=image_reference,
        node_agent_sku_id="batch.node.ubuntu 20.04"
    )

    # Auto-scale formula
    auto_scale_formula = f"""
        // Get pending tasks
        $samples = $ActiveTasks.GetSamplePercent(TimeInterval_Minute * 5);
        $tasks = $samples < 70 ? max(0, $ActiveTasks.GetSample(1)) : max($ActiveTasks.GetSample(1), avg($ActiveTasks.GetSample(TimeInterval_Minute * 5)));

        // Scale based on tasks
        $targetNodes = min({max_nodes}, max({min_nodes}, $tasks));
        $targetDedicatedNodes = $targetNodes;
        $nodeDeallocationOption = taskcompletion;
    """

    pool = batchmodels.PoolAddParameter(
        id=pool_id,
        virtual_machine_configuration=vm_config,
        vm_size=vm_size,
        enable_auto_scale=True,
        auto_scale_formula=auto_scale_formula,
        auto_scale_evaluation_interval=timedelta(minutes=5)
    )

    batch_client.pool.add(pool)
    print(f"Auto-scaling pool {pool_id} created")

def upload_input_files(container_name, files):
    """Upload input files to blob storage."""

    container_client = blob_service.get_container_client(container_name)

    # Create container if not exists
    try:
        container_client.create_container()
    except Exception:
        pass

    resource_files = []
    for file_path in files:
        file_name = os.path.basename(file_path)
        blob_client = container_client.get_blob_client(file_name)

        with open(file_path, "rb") as data:
            blob_client.upload_blob(data, overwrite=True)

        # Generate SAS URL
        sas_token = generate_container_sas(
            account_name=STORAGE_ACCOUNT_NAME,
            container_name=container_name,
            account_key=STORAGE_ACCOUNT_KEY,
            permission=ContainerSasPermissions(read=True),
            expiry=datetime.utcnow() + timedelta(hours=24)
        )

        blob_url = f"https://{STORAGE_ACCOUNT_NAME}.blob.core.windows.net/{container_name}/{file_name}?{sas_token}"

        resource_files.append(
            batchmodels.ResourceFile(
                http_url=blob_url,
                file_path=file_name
            )
        )

    return resource_files

def create_job(job_id, pool_id):
    """Create a job."""

    job = batchmodels.JobAddParameter(
        id=job_id,
        pool_info=batchmodels.PoolInformation(pool_id=pool_id),
        on_all_tasks_complete=batchmodels.OnAllTasksComplete.terminate_job
    )

    batch_client.job.add(job)
    print(f"Job {job_id} created")

def create_tasks(job_id, resource_files, output_container_url):
    """Create tasks for processing."""

    tasks = []
    for i, resource_file in enumerate(resource_files):
        task_id = f"task-{i}"

        # Command to process file and upload output
        command = f"""
        python3 -c "
import pandas as pd
import json

# Process input file
df = pd.read_csv('{resource_file.file_path}')
result = {{
    'file': '{resource_file.file_path}',
    'rows': len(df),
    'columns': list(df.columns),
    'summary': df.describe().to_dict()
}}

# Save output
with open('output_{i}.json', 'w') as f:
    json.dump(result, f)
        "
        """

        # Output files configuration
        output_files = [
            batchmodels.OutputFile(
                file_pattern=f"output_{i}.json",
                destination=batchmodels.OutputFileDestination(
                    container=batchmodels.OutputFileBlobContainerDestination(
                        container_url=output_container_url,
                        path=f"results/output_{i}.json"
                    )
                ),
                upload_options=batchmodels.OutputFileUploadOptions(
                    upload_condition=batchmodels.OutputFileUploadCondition.task_success
                )
            )
        ]

        task = batchmodels.TaskAddParameter(
            id=task_id,
            command_line=f"/bin/bash -c '{command}'",
            resource_files=[resource_file],
            output_files=output_files
        )

        tasks.append(task)

    batch_client.task.add_collection(job_id, tasks)
    print(f"Added {len(tasks)} tasks to job {job_id}")

def wait_for_job_completion(job_id, timeout=3600):
    """Wait for all tasks in a job to complete."""
    import time

    start_time = time.time()
    while time.time() - start_time < timeout:
        tasks = list(batch_client.task.list(job_id))
        completed = sum(1 for t in tasks if t.state == batchmodels.TaskState.completed)
        total = len(tasks)

        print(f"Tasks: {completed}/{total} completed")

        if completed == total:
            # Check for failures
            failed = sum(1 for t in tasks if t.execution_info.result == batchmodels.TaskExecutionResult.failure)
            if failed > 0:
                print(f"Warning: {failed} tasks failed")
            return True

        time.sleep(10)

    return False

# Main execution
if __name__ == "__main__":
    pool_id = "process-pool"
    job_id = f"process-job-{datetime.now():%Y%m%d-%H%M%S}"

    # Create pool
    create_pool(pool_id, "Standard_D2s_v3", 4)

    # Upload input files
    input_files = ["data1.csv", "data2.csv", "data3.csv", "data4.csv"]
    resource_files = upload_input_files("input", input_files)

    # Get output container URL
    output_sas = generate_container_sas(
        account_name=STORAGE_ACCOUNT_NAME,
        container_name="output",
        account_key=STORAGE_ACCOUNT_KEY,
        permission=ContainerSasPermissions(write=True),
        expiry=datetime.utcnow() + timedelta(hours=24)
    )
    output_container_url = f"https://{STORAGE_ACCOUNT_NAME}.blob.core.windows.net/output?{output_sas}"

    # Create job and tasks
    create_job(job_id, pool_id)
    create_tasks(job_id, resource_files, output_container_url)

    # Wait for completion
    wait_for_job_completion(job_id)
```

## Batch with Docker Containers

```python
def create_container_pool(pool_id, vm_size, node_count):
    """Create a pool that runs Docker containers."""

    image_reference = batchmodels.ImageReference(
        publisher="microsoft-azure-batch",
        offer="ubuntu-server-container",
        sku="20-04-lts",
        version="latest"
    )

    container_configuration = batchmodels.ContainerConfiguration(
        type="DockerCompatible",
        container_image_names=["python:3.9-slim", "mcr.microsoft.com/azureml/base:latest"],
        container_registries=[
            batchmodels.ContainerRegistry(
                registry_server="myregistry.azurecr.io",
                user_name="myregistry",
                password=os.environ["ACR_PASSWORD"]
            )
        ]
    )

    vm_config = batchmodels.VirtualMachineConfiguration(
        image_reference=image_reference,
        node_agent_sku_id="batch.node.ubuntu 20.04",
        container_configuration=container_configuration
    )

    pool = batchmodels.PoolAddParameter(
        id=pool_id,
        virtual_machine_configuration=vm_config,
        vm_size=vm_size,
        target_dedicated_nodes=node_count
    )

    batch_client.pool.add(pool)

def create_container_task(job_id, task_id, image, command):
    """Create a task that runs in a container."""

    container_settings = batchmodels.TaskContainerSettings(
        image_name=image,
        container_run_options="--rm",
        working_directory=batchmodels.ContainerWorkingDirectory.task_working_directory
    )

    task = batchmodels.TaskAddParameter(
        id=task_id,
        command_line=command,
        container_settings=container_settings
    )

    batch_client.task.add(job_id, task)
```

## Monitoring Batch Jobs

```python
def get_job_statistics(job_id):
    """Get detailed statistics for a job."""

    tasks = list(batch_client.task.list(job_id))

    stats = {
        "total": len(tasks),
        "active": 0,
        "running": 0,
        "completed": 0,
        "succeeded": 0,
        "failed": 0,
        "total_wall_time": timedelta(),
        "total_user_time": timedelta()
    }

    for task in tasks:
        state = task.state
        if state == batchmodels.TaskState.active:
            stats["active"] += 1
        elif state == batchmodels.TaskState.running:
            stats["running"] += 1
        elif state == batchmodels.TaskState.completed:
            stats["completed"] += 1
            if task.execution_info:
                if task.execution_info.result == batchmodels.TaskExecutionResult.success:
                    stats["succeeded"] += 1
                else:
                    stats["failed"] += 1

                # Add timing
                if task.execution_info.start_time and task.execution_info.end_time:
                    wall_time = task.execution_info.end_time - task.execution_info.start_time
                    stats["total_wall_time"] += wall_time

    return stats

def monitor_pool(pool_id):
    """Monitor pool node status."""

    pool = batch_client.pool.get(pool_id)

    print(f"Pool: {pool_id}")
    print(f"  State: {pool.state}")
    print(f"  Allocation State: {pool.allocation_state}")
    print(f"  Target Dedicated: {pool.target_dedicated_nodes}")
    print(f"  Current Dedicated: {pool.current_dedicated_nodes}")

    nodes = list(batch_client.compute_node.list(pool_id))
    state_counts = {}
    for node in nodes:
        state = str(node.state)
        state_counts[state] = state_counts.get(state, 0) + 1

    print(f"  Node States: {state_counts}")
```

## Best Practices

1. **Right-size your VMs** based on workload requirements
2. **Use auto-scaling** for variable workloads
3. **Leverage low-priority nodes** for cost savings (up to 80%)
4. **Pre-load dependencies** in start tasks or custom images
5. **Use application packages** for versioned software deployment
6. **Implement retry logic** for transient failures

## Conclusion

Azure Batch provides a powerful platform for running large-scale parallel workloads. By abstracting the complexity of cluster management, job scheduling, and fault tolerance, it allows you to focus on your compute logic while Azure handles the infrastructure.

Start with simple embarrassingly parallel workloads and expand to more complex HPC scenarios as needed.
