---
title: "Optimizing GPU Utilization for AI Workloads on Azure"
description: "Many organizations run GPU workloads at 30-40% utilization, paying for idle compute. Understanding workload patterns and implementing optimization…"
author: Michael John Peña
draft: false
date: 2025-11-04
tags:
  - Azure
  - GPU
  - Infrastructure
  - Cost Optimization
  - Deep Learning
---

## The GPU Utilization Challenge

Many organizations run GPU workloads at 30-40% utilization, paying for idle compute. Understanding workload patterns and implementing optimization techniques can double effective utilization.

## Monitoring GPU Metrics

Start by instrumenting your workloads to understand actual resource consumption:

```python
import torch
import GPUtil
from azure.monitor.opentelemetry import configure_azure_monitor
from opentelemetry import metrics

configure_azure_monitor(connection_string="InstrumentationKey=xxx")
meter = metrics.get_meter(__name__)

gpu_utilization = meter.create_gauge(
    "gpu.utilization",
    description="GPU utilization percentage"
)

gpu_memory_used = meter.create_gauge(
    "gpu.memory.used",
    description="GPU memory used in MB"
)

class GPUMonitor:
    def __init__(self, interval_seconds: int = 10):
        self.interval = interval_seconds

    def collect_metrics(self):
        """Collect and emit GPU metrics to Azure Monitor."""
        gpus = GPUtil.getGPUs()

        for gpu in gpus:
            attributes = {"gpu_id": str(gpu.id), "gpu_name": gpu.name}

            gpu_utilization.set(gpu.load * 100, attributes)
            gpu_memory_used.set(gpu.memoryUsed, attributes)

            # Log warning for underutilization
            if gpu.load < 0.5:
                logger.warning(
                    f"GPU {gpu.id} underutilized: {gpu.load*100:.1f}%"
                )

    def optimize_batch_size(self, model, sample_input):
        """Find optimal batch size for GPU memory."""
        torch.cuda.empty_cache()

        batch_size = 1
        max_batch = 1

        while True:
            try:
                batch = sample_input.repeat(batch_size, 1, 1, 1)
                with torch.no_grad():
                    _ = model(batch.cuda())

                max_batch = batch_size
                batch_size *= 2
                torch.cuda.empty_cache()

            except RuntimeError:  # Out of memory
                break

        # Use 80% of max to leave headroom
        return int(max_batch * 0.8)
```

## Multi-Tenancy with CUDA MPS

For inference workloads, NVIDIA Multi-Process Service allows multiple processes to share a single GPU:

```bash
# Enable MPS on Azure NC-series VMs
export CUDA_VISIBLE_DEVICES=0
nvidia-cuda-mps-control -d

# Configure memory limits per process
echo "set_default_active_thread_percentage 25" | nvidia-cuda-mps-control

# Run multiple inference services on single GPU
python inference_service.py --port 8001 &
python inference_service.py --port 8002 &
python inference_service.py --port 8003 &
python inference_service.py --port 8004 &
```

## Spot Instances for Training

Azure Spot VMs offer up to 90% cost savings for interruptible training workloads:

```python
from azure.ai.ml.entities import AmlCompute

gpu_cluster = AmlCompute(
    name="spot-gpu-training",
    type="amlcompute",
    size="Standard_NC24ads_A100_v4",
    min_instances=0,
    max_instances=10,
    tier="LowPriority",  # Spot instances
    idle_time_before_scale_down=120
)
```

Implement checkpointing every epoch to resume training after spot evictions. The combination of proper monitoring, batch optimization, and spot instances can reduce GPU costs by 60-70% for many workloads.
