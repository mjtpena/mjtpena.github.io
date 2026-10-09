---
title: "Spot Instances for ML: Cost-Effective Training at Scale"
author: Michael John Peña
draft: false
date: 2023-08-20
tags:
  - Spot Instances
  - Cost Optimization
  - Azure
  - Machine Learning
---

## Understanding Spot Instances

```python
spot_overview = {
    "pricing": "60-90% cheaper than on-demand",
    "risk": "Can be preempted with 30s notice",
    "best_for": [
        "Training jobs with checkpointing",
        "Hyperparameter tuning",
        "Batch processing",
        "Development and experimentation"
    ]
}
```

## Azure Spot Configuration

```python
from azure.ai.ml.entities import AmlCompute

# Spot compute cluster
spot_cluster = AmlCompute(
    name="spot-gpu-training",
    size="Standard_NC24ads_A100_v4",
    min_instances=0,
    max_instances=8,
    tier="LowPriority",
    idle_time_before_scale_down=120
)

ml_client.compute.begin_create_or_update(spot_cluster).result()
```

## Checkpoint-Based Training

```python
import os
import torch
from transformers import Trainer, TrainingArguments

class CheckpointTrainer(Trainer):
    def __init__(self, *args, checkpoint_dir="./checkpoints", **kwargs):
        super().__init__(*args, **kwargs)
        self.checkpoint_dir = checkpoint_dir

    def training_step(self, model, inputs):
        loss = super().training_step(model, inputs)

        # Save checkpoint periodically
        if self.state.global_step % 500 == 0:
            self.save_checkpoint()

        return loss

    def save_checkpoint(self):
        checkpoint_path = os.path.join(
            self.checkpoint_dir,
            f"checkpoint-{self.state.global_step}"
        )
        self.save_model(checkpoint_path)
        torch.save({
            "optimizer": self.optimizer.state_dict(),
            "scheduler": self.lr_scheduler.state_dict(),
            "step": self.state.global_step,
            "epoch": self.state.epoch
        }, os.path.join(checkpoint_path, "training_state.pt"))

    @classmethod
    def resume_from_checkpoint(cls, checkpoint_path, *args, **kwargs):
        trainer = cls(*args, **kwargs)

        # Load model
        trainer.model.load_state_dict(
            torch.load(os.path.join(checkpoint_path, "pytorch_model.bin"))
        )

        # Load training state
        state = torch.load(os.path.join(checkpoint_path, "training_state.pt"))
        trainer.optimizer.load_state_dict(state["optimizer"])
        trainer.lr_scheduler.load_state_dict(state["scheduler"])
        trainer.state.global_step = state["step"]

        return trainer
```

## Handling Preemption

```python
import signal
import sys

class PreemptionHandler:
    def __init__(self, trainer, checkpoint_dir):
        self.trainer = trainer
        self.checkpoint_dir = checkpoint_dir
        signal.signal(signal.SIGTERM, self.handle_preemption)

    def handle_preemption(self, signum, frame):
        print("Preemption signal received. Saving checkpoint...")
        self.trainer.save_checkpoint()
        sys.exit(0)

# Usage
handler = PreemptionHandler(trainer, "./checkpoints")
trainer.train()
```

## Automatic Resume Job

```python
# Training script with auto-resume
def main():
    # Check for existing checkpoint
    checkpoint_dir = "./checkpoints"
    latest_checkpoint = find_latest_checkpoint(checkpoint_dir)

    if latest_checkpoint:
        print(f"Resuming from {latest_checkpoint}")
        trainer = Trainer.resume_from_checkpoint(latest_checkpoint, ...)
    else:
        print("Starting fresh training")
        trainer = Trainer(...)

    try:
        trainer.train()
    except Exception as e:
        print(f"Training interrupted: {e}")
        trainer.save_checkpoint()
        raise

def find_latest_checkpoint(checkpoint_dir):
    if not os.path.exists(checkpoint_dir):
        return None

    checkpoints = [
        d for d in os.listdir(checkpoint_dir)
        if d.startswith("checkpoint-")
    ]

    if not checkpoints:
        return None

    latest = max(checkpoints, key=lambda x: int(x.split("-")[1]))
    return os.path.join(checkpoint_dir, latest)
```

## Cost Analysis

```python
def calculate_spot_savings(job_hours, vm_size):
    pricing = {
        "Standard_NC6s_v3": {"ondemand": 0.90, "spot": 0.27},
        "Standard_NC24ads_A100_v4": {"ondemand": 3.67, "spot": 1.10},
        "Standard_ND96asr_v4": {"ondemand": 27.20, "spot": 8.16}
    }

    if vm_size not in pricing:
        return None

    ondemand_cost = pricing[vm_size]["ondemand"] * job_hours
    spot_cost = pricing[vm_size]["spot"] * job_hours

    # Account for potential restarts (assume 20% overhead)
    spot_cost_with_overhead = spot_cost * 1.2

    return {
        "ondemand_cost": f"${ondemand_cost:.2f}",
        "spot_cost": f"${spot_cost_with_overhead:.2f}",
        "savings": f"${ondemand_cost - spot_cost_with_overhead:.2f}",
        "savings_percent": f"{(1 - spot_cost_with_overhead/ondemand_cost)*100:.0f}%"
    }

# Example: 100 hour training job on A100
print(calculate_spot_savings(100, "Standard_NC24ads_A100_v4"))
# {'ondemand_cost': '$367.00', 'spot_cost': '$132.00', 'savings': '$235.00', 'savings_percent': '64%'}
```

## Best Practices

```python
spot_best_practices = {
    "checkpointing": {
        "frequency": "Every 10-30 minutes",
        "storage": "Use Azure Blob for durability",
        "cleanup": "Remove old checkpoints to save storage"
    },
    "job_design": {
        "modular": "Break into smaller jobs",
        "resumable": "Always support resume from checkpoint",
        "idempotent": "Jobs should be safely restartable"
    },
    "monitoring": {
        "alerts": "Set up preemption alerts",
        "logging": "Log checkpoint saves",
        "metrics": "Track training progress externally"
    }
}
```

Tomorrow we'll explore cost optimization strategies for AI workloads.

## Resources

- [Azure Spot VMs](https://learn.microsoft.com/en-us/azure/virtual-machines/spot-vms)
- [Checkpointing Best Practices](https://pytorch.org/tutorials/recipes/recipes/saving_and_loading_a_general_checkpoint.html)
- [Azure ML Cost Management](https://learn.microsoft.com/en-us/azure/machine-learning/how-to-manage-optimize-cost)
