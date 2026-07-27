---
title: "Model Optimization Techniques for Production Deployment"
author: Michael John Peña
draft: false
date: 2023-08-10
tags:
  - Model Optimization
  - Machine Learning
  - Performance
  - Deployment

---

I wrote "Model Optimization Techniques for Production Deployment" to share practical, production-minded guidance on this topic.

## Optimization Overview

```python
optimization_techniques = {
    "quantization": "Reduce numerical precision",
    "pruning": "Remove unnecessary weights",
    "distillation": "Train smaller student model",
    "compilation": "Optimize computation graph",
    "batching": "Process multiple inputs together"
}
```

## Quantization Strategies

```python
import torch
from transformers import AutoModelForCausalLM

# Dynamic Quantization (Post-training)
model = AutoModelForCausalLM.from_pretrained("gpt2")
quantized_model = torch.quantization.quantize_dynamic(
    model,
    {torch.nn.Linear},
    dtype=torch.qint8
)

# Static Quantization (requires calibration)
# 1. Prepare model
model.qconfig = torch.quantization.get_default_qconfig('fbgemm')
torch.quantization.prepare(model, inplace=True)

# 2. Calibrate with representative data
for data in calibration_loader:
    model(data)

# 3. Convert
torch.quantization.convert(model, inplace=True)
```

## Using bitsandbytes

```python
from transformers import AutoModelForCausalLM, BitsAndBytesConfig
import torch

# 8-bit quantization
model_8bit = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-7b-hf",
    load_in_8bit=True,
    device_map="auto"
)

# 4-bit quantization
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.float16,
    bnb_4bit_use_double_quant=True
)

model_4bit = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-7b-hf",
    quantization_config=bnb_config,
    device_map="auto"
)

# Memory comparison
def get_model_size(model):
    param_size = sum(p.nelement() * p.element_size() for p in model.parameters())
    buffer_size = sum(b.nelement() * b.element_size() for b in model.buffers())
    return (param_size + buffer_size) / 1024 / 1024  # MB

print(f"8-bit model: {get_model_size(model_8bit):.0f} MB")
print(f"4-bit model: {get_model_size(model_4bit):.0f} MB")
```

## Model Pruning

```python
import torch.nn.utils.prune as prune

# Magnitude-based pruning
model = AutoModelForCausalLM.from_pretrained("gpt2")

# Prune 30% of weights in linear layers
for name, module in model.named_modules():
    if isinstance(module, torch.nn.Linear):
        prune.l1_unstructured(module, name='weight', amount=0.3)

# Make pruning permanent
for name, module in model.named_modules():
    if isinstance(module, torch.nn.Linear):
        prune.remove(module, 'weight')

# Structured pruning (entire channels/heads)
for name, module in model.named_modules():
    if isinstance(module, torch.nn.Linear):
        prune.ln_structured(module, name='weight', amount=0.2, n=2, dim=0)
```

## Torch Compile (PyTorch 2.0+)

```python
import torch

model = AutoModelForCausalLM.from_pretrained("gpt2")

# Compile model for faster execution
compiled_model = torch.compile(model)

# Different compilation modes
model_default = torch.compile(model, mode="default")
model_reduce_overhead = torch.compile(model, mode="reduce-overhead")
model_max_autotune = torch.compile(model, mode="max-autotune")

# Benchmark
import time

def benchmark(model, inputs, num_runs=100):
    # Warmup
    for _ in range(10):
        model(**inputs)

    torch.cuda.synchronize()
    start = time.perf_counter()
    for _ in range(num_runs):
        model(**inputs)
    torch.cuda.synchronize()

    return (time.perf_counter() - start) / num_runs * 1000

inputs = tokenizer("Hello world", return_tensors="pt").to("cuda")
print(f"Original: {benchmark(model.to('cuda'), inputs):.2f}ms")
print(f"Compiled: {benchmark(compiled_model.to('cuda'), inputs):.2f}ms")
```

## Flash Attention

```python
# Flash Attention provides memory-efficient attention
from transformers import AutoModelForCausalLM

# Enable Flash Attention 2
model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-7b-hf",
    torch_dtype=torch.float16,
    attn_implementation="flash_attention_2",
    device_map="auto"
)

# Benefits:
# - O(N) memory instead of O(N^2)
# - Faster for long sequences
# - Built into many modern models
```

## KV Cache Optimization

```python
# For autoregressive generation, cache key-value pairs
model = AutoModelForCausalLM.from_pretrained("gpt2")

# Enable KV caching
outputs = model.generate(
    input_ids,
    max_length=100,
    use_cache=True,  # Enable KV cache
    past_key_values=None  # Or pass previous cache
)

# The model caches attention KV pairs to avoid recomputation
# Essential for efficient generation
```

## Batching Strategies

```python
# Static batching
def batch_inference(model, texts, batch_size=8):
    results = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i+batch_size]
        inputs = tokenizer(batch, padding=True, return_tensors="pt")
        outputs = model(**inputs)
        results.extend(outputs.logits.tolist())
    return results

# Dynamic batching with padding optimization
def dynamic_batch(model, texts, max_batch_tokens=4096):
    # Sort by length for efficient padding
    sorted_texts = sorted(enumerate(texts), key=lambda x: len(x[1]))

    results = [None] * len(texts)
    batch = []
    batch_tokens = 0

    for idx, text in sorted_texts:
        text_tokens = len(tokenizer.encode(text))
        if batch_tokens + text_tokens > max_batch_tokens and batch:
            # Process current batch
            process_batch(batch, results)
            batch = []
            batch_tokens = 0

        batch.append((idx, text))
        batch_tokens += text_tokens

    if batch:
        process_batch(batch, results)

    return results
```

## Optimization Checklist

```python
optimization_checklist = {
    "model_level": [
        "Apply quantization (INT8/INT4)",
        "Enable Flash Attention",
        "Use torch.compile",
        "Consider model distillation"
    ],
    "inference_level": [
        "Enable KV caching",
        "Use optimal batch sizes",
        "Implement request batching",
        "Use continuous batching for serving"
    ],
    "hardware_level": [
        "Use appropriate GPU/accelerator",
        "Optimize memory allocation",
        "Use tensor parallelism for large models"
    ]
}
```

Tomorrow we'll explore quantization basics in more detail.

## Resources

- [PyTorch Quantization](https://pytorch.org/docs/stable/quantization.html)
- [Flash Attention](https://github.com/Dao-AILab/flash-attention)
- [torch.compile](https://pytorch.org/tutorials/intermediate/torch_compile_tutorial.html)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
