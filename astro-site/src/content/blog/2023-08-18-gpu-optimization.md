---
title: "GPU Optimization for LLM Workloads"
author: Michael John Peña
draft: false
date: 2023-08-18
tags:
  - GPU
  - Optimization
  - CUDA
  - Performance

---

I wrote "GPU Optimization for LLM Workloads" to share practical, production-minded guidance on this topic.

## GPU Memory Management

```python
import torch

# Check GPU memory
def print_gpu_memory():
    if torch.cuda.is_available():
        print(f"Allocated: {torch.cuda.memory_allocated() / 1e9:.2f} GB")
        print(f"Reserved: {torch.cuda.memory_reserved() / 1e9:.2f} GB")
        print(f"Max allocated: {torch.cuda.max_memory_allocated() / 1e9:.2f} GB")

# Clear cache
torch.cuda.empty_cache()
torch.cuda.reset_peak_memory_stats()

# Memory efficient model loading
model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-7b-hf",
    torch_dtype=torch.float16,      # Half precision
    low_cpu_mem_usage=True,         # Efficient loading
    device_map="auto"               # Automatic placement
)
```

## Multi-GPU Strategies

```python
# Device map for model parallelism
device_map = {
    "model.embed_tokens": 0,
    "model.layers.0": 0,
    "model.layers.1": 0,
    # ... more layers on GPU 0
    "model.layers.16": 1,
    "model.layers.17": 1,
    # ... more layers on GPU 1
    "model.norm": 1,
    "lm_head": 1
}

model = AutoModelForCausalLM.from_pretrained(
    model_name,
    device_map=device_map,
    torch_dtype=torch.float16
)

# Automatic device map
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    device_map="auto",  # Accelerate handles distribution
    torch_dtype=torch.float16
)

# Balanced device map
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    device_map="balanced",  # Equal distribution
    torch_dtype=torch.float16
)
```

## CUDA Optimization Tips

```python
# Enable TF32 for faster matmuls (Ampere+ GPUs)
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True

# Use cuDNN benchmark for consistent input sizes
torch.backends.cudnn.benchmark = True

# Compile model for faster execution (PyTorch 2.0+)
model = torch.compile(model, mode="reduce-overhead")

# Inference mode context
with torch.inference_mode():
    outputs = model.generate(**inputs)

# Disable gradient computation
@torch.no_grad()
def generate(model, inputs):
    return model.generate(**inputs)
```

## Memory-Efficient Attention

```python
# Flash Attention 2 (much faster and memory efficient)
model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-7b-hf",
    attn_implementation="flash_attention_2",
    torch_dtype=torch.float16,
    device_map="auto"
)

# Benefits:
# - O(N) memory instead of O(N^2)
# - 2-4x faster for long sequences
# - Native in transformers for supported models
```

## Gradient Checkpointing (Training)

```python
# For training: trade compute for memory
from transformers import TrainingArguments

training_args = TrainingArguments(
    gradient_checkpointing=True,  # Recompute activations
    per_device_train_batch_size=1,
    gradient_accumulation_steps=16,
    # ... other args
)

# Manual gradient checkpointing
model.gradient_checkpointing_enable()
```

## Profiling GPU Usage

```python
import torch.profiler

# Profile model execution
with torch.profiler.profile(
    activities=[
        torch.profiler.ProfilerActivity.CPU,
        torch.profiler.ProfilerActivity.CUDA,
    ],
    record_shapes=True,
    profile_memory=True,
    with_stack=True
) as prof:
    outputs = model.generate(**inputs, max_new_tokens=50)

# Print results
print(prof.key_averages().table(sort_by="cuda_time_total", row_limit=10))

# Export for visualization
prof.export_chrome_trace("trace.json")
```

## Optimizing Batch Inference

```python
def optimize_batch_inference(model, tokenizer, texts, batch_size=8):
    """Optimized batch inference with proper GPU utilization."""

    # Sort by length to minimize padding
    indexed_texts = [(i, t, len(tokenizer.encode(t))) for i, t in enumerate(texts)]
    sorted_texts = sorted(indexed_texts, key=lambda x: x[2])

    results = [None] * len(texts)

    with torch.inference_mode():
        for i in range(0, len(sorted_texts), batch_size):
            batch = sorted_texts[i:i+batch_size]
            batch_texts = [t[1] for t in batch]
            batch_indices = [t[0] for t in batch]

            # Tokenize with dynamic padding
            inputs = tokenizer(
                batch_texts,
                padding=True,
                truncation=True,
                return_tensors="pt"
            ).to(model.device)

            # Generate
            outputs = model.generate(
                **inputs,
                max_new_tokens=100,
                pad_token_id=tokenizer.eos_token_id
            )

            # Decode and store
            for j, idx in enumerate(batch_indices):
                results[idx] = tokenizer.decode(outputs[j], skip_special_tokens=True)

            # Clear cache between batches if needed
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

    return results
```

## GPU Selection Guide

```python
gpu_recommendations = {
    "inference_small": {
        "gpus": ["RTX 3090", "RTX 4090"],
        "models": "7B with quantization",
        "vram": "24GB"
    },
    "inference_medium": {
        "gpus": ["A100 40GB", "A6000"],
        "models": "7B-13B FP16",
        "vram": "40-48GB"
    },
    "inference_large": {
        "gpus": ["A100 80GB", "H100"],
        "models": "70B with quantization",
        "vram": "80GB+"
    },
    "training": {
        "gpus": ["A100", "H100"],
        "consideration": "Need multiple for large models",
        "vram": "80GB per GPU"
    }
}
```

Tomorrow we'll explore Azure ML compute options.

## Resources

- [PyTorch CUDA Semantics](https://pytorch.org/docs/stable/notes/cuda.html)
- [Flash Attention](https://github.com/Dao-AILab/flash-attention)
- [NVIDIA Optimization Guide](https://developer.nvidia.com/deep-learning-performance-training-inference)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
