---
title: "Quantization Basics: Reducing Model Size and Improving Speed"
author: Michael John Peña
draft: false
date: 2023-08-11
tags:
  - Quantization
  - Model Optimization
  - Performance
  - Machine Learning
---

## Understanding Quantization

```python
# Precision levels
precision_levels = {
    "FP32": {"bits": 32, "range": "3.4e38", "typical_use": "Training"},
    "FP16": {"bits": 16, "range": "6.5e4", "typical_use": "Mixed precision training"},
    "BF16": {"bits": 16, "range": "3.4e38", "typical_use": "Training (A100+)"},
    "INT8": {"bits": 8, "range": "-128 to 127", "typical_use": "Inference"},
    "INT4": {"bits": 4, "range": "-8 to 7", "typical_use": "LLM inference"}
}

# Memory savings example (7B parameter model)
memory_comparison = {
    "FP32": "28 GB",
    "FP16": "14 GB",
    "INT8": "7 GB",
    "INT4": "3.5 GB"
}
```

## Quantization Types

```python
# Post-Training Quantization (PTQ)
# - Applied after training
# - No additional training required
# - May have accuracy loss

# Quantization-Aware Training (QAT)
# - Model trained with quantization simulation
# - Better accuracy preservation
# - Requires retraining

# Dynamic Quantization
# - Weights quantized, activations computed in FP32
# - Simple to apply
# - Good for CPU inference

# Static Quantization
# - Both weights and activations quantized
# - Requires calibration data
# - Best performance
```

## PyTorch Dynamic Quantization

```python
import torch
from transformers import AutoModelForSequenceClassification

# Load model
model = AutoModelForSequenceClassification.from_pretrained(
    "distilbert-base-uncased-finetuned-sst-2-english"
)
model.eval()

# Apply dynamic quantization
quantized_model = torch.quantization.quantize_dynamic(
    model,
    {torch.nn.Linear, torch.nn.Embedding},  # Layers to quantize
    dtype=torch.qint8
)

# Compare sizes
def model_size_mb(model):
    torch.save(model.state_dict(), "temp.p")
    import os
    size = os.path.getsize("temp.p") / 1e6
    os.remove("temp.p")
    return size

print(f"Original: {model_size_mb(model):.1f} MB")
print(f"Quantized: {model_size_mb(quantized_model):.1f} MB")
```

## Static Quantization with Calibration

```python
import torch
from torch.quantization import prepare, convert, get_default_qconfig

# Prepare model for static quantization
model = AutoModelForSequenceClassification.from_pretrained(model_name)
model.eval()

# Set quantization config
model.qconfig = get_default_qconfig('fbgemm')  # or 'qnnpack' for ARM

# Prepare model (inserts observers)
prepared_model = prepare(model)

# Calibrate with representative data
def calibrate(model, data_loader, num_batches=100):
    model.eval()
    with torch.no_grad():
        for i, batch in enumerate(data_loader):
            if i >= num_batches:
                break
            model(**batch)

calibrate(prepared_model, calibration_loader)

# Convert to quantized model
quantized_model = convert(prepared_model)
```

## Using bitsandbytes for LLMs

```python
from transformers import AutoModelForCausalLM, BitsAndBytesConfig
import torch

# 8-bit quantization
config_8bit = BitsAndBytesConfig(
    load_in_8bit=True,
    llm_int8_threshold=6.0,
    llm_int8_skip_modules=["lm_head"]
)

model_8bit = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-7b-hf",
    quantization_config=config_8bit,
    device_map="auto"
)

# 4-bit quantization (NF4)
config_4bit = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",           # NormalFloat4
    bnb_4bit_compute_dtype=torch.float16,
    bnb_4bit_use_double_quant=True       # Nested quantization
)

model_4bit = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-7b-hf",
    quantization_config=config_4bit,
    device_map="auto"
)
```

## GPTQ Quantization

```python
# GPTQ: Accurate Post-Training Quantization
# pip install auto-gptq

from transformers import AutoTokenizer
from auto_gptq import AutoGPTQForCausalLM, BaseQuantizeConfig

# Load tokenizer
tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-2-7b-hf")

# Quantization config
quantize_config = BaseQuantizeConfig(
    bits=4,
    group_size=128,
    desc_act=False
)

# Load and quantize model
model = AutoGPTQForCausalLM.from_pretrained(
    "meta-llama/Llama-2-7b-hf",
    quantize_config
)

# Prepare examples for calibration
examples = [tokenizer(text, return_tensors="pt") for text in calibration_texts]

# Quantize
model.quantize(examples)

# Save
model.save_quantized("./llama-7b-gptq")
```

## AWQ Quantization

```python
# AWQ: Activation-aware Weight Quantization
# pip install autoawq

from awq import AutoAWQForCausalLM
from transformers import AutoTokenizer

# Load model and tokenizer
model_path = "meta-llama/Llama-2-7b-hf"
quant_path = "./llama-7b-awq"

model = AutoAWQForCausalLM.from_pretrained(model_path)
tokenizer = AutoTokenizer.from_pretrained(model_path)

# Quantize
quant_config = {"zero_point": True, "q_group_size": 128, "w_bit": 4}
model.quantize(tokenizer, quant_config=quant_config)

# Save
model.save_quantized(quant_path)
```

## Accuracy vs Speed Trade-offs

```python
# Benchmark function
def evaluate_model(model, tokenizer, test_data):
    correct = 0
    total_time = 0

    for text, label in test_data:
        inputs = tokenizer(text, return_tensors="pt")

        start = time.time()
        outputs = model(**inputs)
        total_time += time.time() - start

        predicted = outputs.logits.argmax(-1).item()
        if predicted == label:
            correct += 1

    accuracy = correct / len(test_data)
    avg_latency = total_time / len(test_data)

    return {"accuracy": accuracy, "latency_ms": avg_latency * 1000}

# Compare quantization methods
results = {
    "FP32": evaluate_model(model_fp32, tokenizer, test_data),
    "FP16": evaluate_model(model_fp16, tokenizer, test_data),
    "INT8": evaluate_model(model_int8, tokenizer, test_data),
    "INT4": evaluate_model(model_int4, tokenizer, test_data)
}

for method, metrics in results.items():
    print(f"{method}: Accuracy={metrics['accuracy']:.2%}, Latency={metrics['latency_ms']:.1f}ms")
```

## Best Practices

```python
quantization_best_practices = {
    "choice": {
        "cpu_inference": "INT8 dynamic quantization",
        "gpu_inference": "FP16 or INT8",
        "memory_constrained": "INT4 (GPTQ/AWQ)",
        "accuracy_critical": "FP16 or calibrated INT8"
    },
    "calibration": {
        "data": "Use representative samples",
        "size": "100-1000 samples usually sufficient",
        "diversity": "Cover all input types"
    },
    "validation": {
        "always_test": "Compare accuracy before/after",
        "edge_cases": "Test on difficult examples",
        "latency": "Measure actual speedup"
    }
}
```

Tomorrow we'll explore INT8 quantization in more detail.

## Resources

- [PyTorch Quantization](https://pytorch.org/docs/stable/quantization.html)
- [bitsandbytes](https://github.com/TimDettmers/bitsandbytes)
- [GPTQ Paper](https://arxiv.org/abs/2210.17323)
