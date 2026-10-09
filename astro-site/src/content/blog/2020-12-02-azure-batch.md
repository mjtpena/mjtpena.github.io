---
title: "Azure Batch: Large-Scale Parallel Computing"
description: "Embarrassingly parallel workloads are the ones I most enjoy moving to Azure. Render farms, Monte Carlo simulations, batch image processing, genomic…"
author: Michael John Peña
draft: false
date: 2020-12-02
tags:
  - Azure
  - Batch
  - HPC
  - Compute
---

Embarrassingly parallel workloads are the ones I most enjoy moving to Azure. Render farms, Monte Carlo simulations, batch image processing, genomic pipelines—work that's painful to schedule on a fixed cluster and obvious on Batch. Pool sizes scale automatically, low-priority VMs cut the cost, and the job/task abstraction is simple enough that scientists who don't want to learn Kubernetes can be productive on it.

## Batch Concepts

```
Batch Account
└── Pool (compute nodes)
    └── Job (collection of tasks)
        └── Task (unit of work)
```

## Creating Batch Account

```bash
az batch account create \
    --name mybatch \
    --resource-group myRG \
    --location eastus \
    --storage-account mystorageaccount
```

## Creating a Pool

```python
from azure.batch import BatchServiceClient
from azure.batch.models import *

# Pool configuration
pool = PoolAddParameter(
    id="render-pool",
    vm_size="Standard_D4s_v3",
    target_dedicated_nodes=10,
    virtual_machine_configuration=VirtualMachineConfiguration(
        image_reference=ImageReference(
            publisher="canonical",
            offer="0001-com-ubuntu-server-focal",
            sku="20_04-lts",
            version="latest"
        ),
        node_agent_sku_id="batch.node.ubuntu 20.04"
    ),
    start_task=StartTask(
        command_line="/bin/bash -c 'apt-get update && apt-get install -y ffmpeg'",
        user_identity=UserIdentity(
            auto_user=AutoUserSpecification(
                scope=AutoUserScope.pool,
                elevation_level=ElevationLevel.admin
            )
        ),
        wait_for_success=True
    )
)

batch_client.pool.add(pool)
```

## Auto-Scaling

```
# Auto-scale formula
$samples = $ActiveTasks.GetSamplePercent(TimeInterval_Minute * 5);
$tasks = $samples < 70 ? max(0, $ActiveTasks.GetSample(1)) : max($ActiveTasks.GetSample(1), avg($ActiveTasks.GetSample(TimeInterval_Minute * 5)));
$targetVMs = min(100, max(0, $tasks / 4));
$TargetDedicatedNodes = $targetVMs;
$NodeDeallocationOption = taskcompletion;
```

```python
pool.enable_auto_scale = True
pool.auto_scale_formula = formula
pool.auto_scale_evaluation_interval = timedelta(minutes=5)
```

## Creating Jobs and Tasks

```python
# Create job
job = JobAddParameter(
    id="video-processing-job",
    pool_info=PoolInformation(pool_id="render-pool")
)
batch_client.job.add(job)

# Add tasks
tasks = []
for i, video_file in enumerate(video_files):
    task = TaskAddParameter(
        id=f"task-{i}",
        command_line=f"/bin/bash -c 'ffmpeg -i {video_file} -vf scale=1920:1080 output-{i}.mp4'",
        resource_files=[
            ResourceFile(
                http_url=f"https://mystorageaccount.blob.core.windows.net/input/{video_file}",
                file_path=video_file
            )
        ],
        output_files=[
            OutputFile(
                file_pattern="output-*.mp4",
                destination=OutputFileDestination(
                    container=OutputFileBlobContainerDestination(
                        container_url="https://mystorageaccount.blob.core.windows.net/output?sas"
                    )
                ),
                upload_options=OutputFileUploadOptions(
                    upload_condition=OutputFileUploadCondition.task_success
                )
            )
        ]
    )
    tasks.append(task)

batch_client.task.add_collection(job.id, tasks)
```

## Task Dependencies

```python
# Task with dependencies
task = TaskAddParameter(
    id="final-merge",
    command_line="merge-videos.sh",
    depends_on=TaskDependencies(
        task_ids=["task-0", "task-1", "task-2"],
        task_id_ranges=[TaskIdRange(start=3, end=99)]
    )
)
```

## Multi-Instance Tasks (MPI)

```python
# MPI task across multiple nodes
task = TaskAddParameter(
    id="mpi-task",
    command_line="mpirun -np 16 ./my-mpi-app",
    multi_instance_settings=MultiInstanceSettings(
        number_of_instances=4,
        coordination_command_line="/bin/bash -c 'echo coordination'",
        common_resource_files=[
            ResourceFile(http_url="...", file_path="my-mpi-app")
        ]
    )
)
```

## Monitoring Tasks

```python
# Wait for tasks to complete
while True:
    tasks = batch_client.task.list(job.id)
    incomplete = [t for t in tasks if t.state != TaskState.completed]

    if not incomplete:
        break

    print(f"Tasks remaining: {len(incomplete)}")
    time.sleep(30)

# Check results
for task in batch_client.task.list(job.id):
    if task.execution_info.result == TaskExecutionResult.failure:
        print(f"Task {task.id} failed: {task.execution_info.failure_info.message}")
```

## Container Support

```python
pool = PoolAddParameter(
    id="container-pool",
    vm_size="Standard_D4s_v3",
    virtual_machine_configuration=VirtualMachineConfiguration(
        image_reference=ImageReference(
            publisher="microsoft-azure-batch",
            offer="ubuntu-server-container",
            sku="20-04-lts",
            version="latest"
        ),
        container_configuration=ContainerConfiguration(
            container_image_names=["myacr.azurecr.io/myapp:latest"],
            container_registries=[
                ContainerRegistry(
                    registry_server="myacr.azurecr.io",
                    user_name="myacr",
                    password="xxx"
                )
            ]
        )
    )
)
```

Azure Batch: unlimited compute on demand.
