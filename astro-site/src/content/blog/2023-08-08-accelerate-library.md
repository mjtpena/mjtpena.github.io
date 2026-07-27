---
title: "Accelerate Library: Distributed Training Made Simple"
author: Michael John Peña
draft: false
date: 2023-08-08
tags:
  - Accelerate
  - Distributed Training
  - PyTorch
  - Deep Learning

---

I wrote "Accelerate Library: Distributed Training Made Simple" to share practical, production-minded guidance on this topic.

## Why Accelerate?

```python
# Accelerate benefits
benefits = {
    "simplicity": "Minimal code changes for distributed training",
    "flexibility": "Works with any PyTorch code",
    "compatibility": "CPU, single GPU, multi-GPU, TPU",
    "mixed_precision": "Built-in FP16/BF16 support",
    "integration": "Works with Transformers and PEFT"
}

# Installation
# pip install accelerate
```

## Basic Usage

```python
from accelerate import Accelerator

# Initialize accelerator
accelerator = Accelerator()

# Prepare model, optimizer, and dataloader
model, optimizer, train_dataloader = accelerator.prepare(
    model, optimizer, train_dataloader
)

# Training loop (nearly unchanged!)
for batch in train_dataloader:
    optimizer.zero_grad()
    outputs = model(**batch)
    loss = outputs.loss

    # Use accelerator for backward
    accelerator.backward(loss)
    optimizer.step()
```

## Configuration

```python
from accelerate import Accelerator

# Configure mixed precision
accelerator = Accelerator(
    mixed_precision="fp16"  # or "bf16", "no"
)

# Configure gradient accumulation
accelerator = Accelerator(
    gradient_accumulation_steps=4
)

# Configure logging
accelerator = Accelerator(
    log_with="tensorboard",  # or "wandb", "all"
    project_dir="./logs"
)

# Combined configuration
accelerator = Accelerator(
    mixed_precision="fp16",
    gradient_accumulation_steps=4,
    log_with=["tensorboard", "wandb"],
    project_dir="./output"
)
```

## Full Training Script

```python
import torch
from torch.utils.data import DataLoader
from accelerate import Accelerator
from transformers import AutoModelForCausalLM, AutoTokenizer, get_scheduler
from datasets import load_dataset

def train():
    # Initialize accelerator
    accelerator = Accelerator(
        mixed_precision="fp16",
        gradient_accumulation_steps=4
    )

    # Load model and tokenizer
    model = AutoModelForCausalLM.from_pretrained("gpt2")
    tokenizer = AutoTokenizer.from_pretrained("gpt2")
    tokenizer.pad_token = tokenizer.eos_token

    # Load and prepare dataset
    dataset = load_dataset("wikitext", "wikitext-2-raw-v1")

    def tokenize_function(examples):
        return tokenizer(
            examples["text"],
            truncation=True,
            max_length=512,
            padding="max_length"
        )

    tokenized_dataset = dataset.map(tokenize_function, batched=True)
    tokenized_dataset.set_format("torch")

    train_dataloader = DataLoader(
        tokenized_dataset["train"],
        batch_size=8,
        shuffle=True
    )

    # Setup optimizer and scheduler
    optimizer = torch.optim.AdamW(model.parameters(), lr=5e-5)
    num_training_steps = len(train_dataloader) * 3  # 3 epochs
    scheduler = get_scheduler(
        "linear",
        optimizer=optimizer,
        num_warmup_steps=100,
        num_training_steps=num_training_steps
    )

    # Prepare with accelerator
    model, optimizer, train_dataloader, scheduler = accelerator.prepare(
        model, optimizer, train_dataloader, scheduler
    )

    # Training loop
    model.train()
    for epoch in range(3):
        total_loss = 0
        for step, batch in enumerate(train_dataloader):
            with accelerator.accumulate(model):
                outputs = model(
                    input_ids=batch["input_ids"],
                    attention_mask=batch["attention_mask"],
                    labels=batch["input_ids"]
                )
                loss = outputs.loss
                accelerator.backward(loss)

                optimizer.step()
                scheduler.step()
                optimizer.zero_grad()

                total_loss += loss.detach().float()

            if step % 100 == 0:
                accelerator.print(f"Epoch {epoch}, Step {step}, Loss: {loss.item():.4f}")

        avg_loss = total_loss / len(train_dataloader)
        accelerator.print(f"Epoch {epoch} completed. Avg Loss: {avg_loss:.4f}")

    # Save model
    accelerator.wait_for_everyone()
    unwrapped_model = accelerator.unwrap_model(model)
    unwrapped_model.save_pretrained(
        "./output",
        save_function=accelerator.save
    )

if __name__ == "__main__":
    train()
```

## Launching Distributed Training

```bash
# Single GPU
python train.py

# Multiple GPUs on single machine
accelerate launch --num_processes 4 train.py

# Using config file
accelerate config  # Creates configuration interactively
accelerate launch train.py

# Specify config
accelerate launch --config_file config.yaml train.py
```

## Configuration File

```yaml
# config.yaml
compute_environment: LOCAL_MACHINE
distributed_type: MULTI_GPU
downcast_bf16: 'no'
gpu_ids: all
machine_rank: 0
main_training_function: main
mixed_precision: fp16
num_machines: 1
num_processes: 4
rdzv_backend: static
same_network: true
tpu_env: []
tpu_use_cluster: false
tpu_use_sudo: false
use_cpu: false
```

## DeepSpeed Integration

```python
from accelerate import Accelerator

# Use DeepSpeed
accelerator = Accelerator(
    deepspeed_plugin=DeepSpeedPlugin(
        zero_stage=2,
        gradient_accumulation_steps=4,
        gradient_clipping=1.0,
        offload_optimizer_device="cpu",
        offload_param_device="cpu"
    )
)

# Or via config file:
# accelerate launch --use_deepspeed train.py
```

## FSDP Integration

```python
from accelerate import Accelerator, FullyShardedDataParallelPlugin
from torch.distributed.fsdp import FullStateDictConfig, StateDictType

# Configure FSDP
fsdp_plugin = FullyShardedDataParallelPlugin(
    state_dict_config=FullStateDictConfig(
        offload_to_cpu=True,
        rank0_only=True
    ),
    sharding_strategy="FULL_SHARD"
)

accelerator = Accelerator(fsdp_plugin=fsdp_plugin)
```

## Checkpointing

```python
# Save checkpoint
accelerator.save_state("./checkpoint")

# Load checkpoint
accelerator.load_state("./checkpoint")

# Save with custom logic
if accelerator.is_main_process:
    accelerator.save({
        "model": accelerator.unwrap_model(model).state_dict(),
        "optimizer": optimizer.state_dict(),
        "epoch": epoch,
        "step": step
    }, "./checkpoint.pt")
```

## Useful Utilities

```python
# Check device
device = accelerator.device

# Check if main process
if accelerator.is_main_process:
    print("This runs only on main process")

# Wait for all processes
accelerator.wait_for_everyone()

# Gather tensors from all processes
gathered = accelerator.gather(tensor)

# Print only on main process
accelerator.print("This prints only once")

# Get the number of processes
num_processes = accelerator.num_processes
```

Tomorrow we'll explore ONNX Runtime for model optimization.

## Resources

- [Accelerate Documentation](https://huggingface.co/docs/accelerate)
- [Accelerate GitHub](https://github.com/huggingface/accelerate)
- [Distributed Training Guide](https://huggingface.co/docs/accelerate/basic_tutorials/launch)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
