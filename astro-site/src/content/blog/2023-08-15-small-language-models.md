---
title: "Small Language Models: When Bigger Isn't Better"
author: Michael John Peña
draft: false
date: 2023-08-15
tags:
  - Small Language Models
  - SLM
  - AI
  - Edge Deployment
---

## The Case for Small Models

```python
slm_benefits = {
    "latency": "Faster inference (10-100x)",
    "cost": "Lower compute costs",
    "privacy": "Can run on-device",
    "deployment": "Edge/mobile compatible",
    "fine_tuning": "Easier to customize"
}

# Model size comparison
model_sizes = {
    "GPT-4": "~1.7T parameters",
    "LLaMA-70B": "70B parameters",
    "LLaMA-7B": "7B parameters",
    "Mistral-7B": "7B parameters",
    "Phi-2": "2.7B parameters",
    "TinyLlama": "1.1B parameters",
    "DistilBERT": "66M parameters"
}
```

## Popular Small Models

```python
from transformers import AutoModelForCausalLM, AutoTokenizer

# Phi-2 (2.7B) - Microsoft's efficient model
phi2 = AutoModelForCausalLM.from_pretrained(
    "microsoft/phi-2",
    torch_dtype=torch.float16,
    device_map="auto"
)

# TinyLlama (1.1B)
tiny_llama = AutoModelForCausalLM.from_pretrained(
    "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
    torch_dtype=torch.float16
)

# StableLM (3B)
stable_lm = AutoModelForCausalLM.from_pretrained(
    "stabilityai/stablelm-3b-4e1t",
    torch_dtype=torch.float16
)

# Smaller BERT variants
distilbert = AutoModelForSequenceClassification.from_pretrained(
    "distilbert-base-uncased"
)  # 66M params

# MiniLM
minilm = AutoModel.from_pretrained(
    "sentence-transformers/all-MiniLM-L6-v2"
)  # 22M params
```

## Choosing the Right Size

```python
def recommend_model_size(use_case):
    recommendations = {
        "classification": {
            "model": "DistilBERT/MiniLM",
            "params": "22-66M",
            "reason": "Task-specific, efficient"
        },
        "embeddings": {
            "model": "all-MiniLM-L6-v2",
            "params": "22M",
            "reason": "Fast similarity search"
        },
        "simple_generation": {
            "model": "Phi-2/TinyLlama",
            "params": "1-3B",
            "reason": "Good quality/size ratio"
        },
        "complex_reasoning": {
            "model": "Mistral-7B/LLaMA-7B",
            "params": "7B",
            "reason": "Still manageable, good capability"
        },
        "on_device": {
            "model": "TinyLlama quantized",
            "params": "<1B quantized",
            "reason": "Mobile/edge deployment"
        }
    }
    return recommendations.get(use_case, recommendations["simple_generation"])
```

## Optimizing Small Models for Deployment

```python
import torch
from transformers import AutoModelForCausalLM, BitsAndBytesConfig

# 4-bit quantized small model
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.float16
)

model = AutoModelForCausalLM.from_pretrained(
    "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
    quantization_config=bnb_config,
    device_map="auto"
)

# Memory footprint
# Original TinyLlama: ~2.2GB
# 4-bit quantized: ~600MB
```

## Fine-tuning Small Models

```python
from peft import LoraConfig, get_peft_model

# LoRA for efficient fine-tuning
lora_config = LoraConfig(
    r=8,
    lora_alpha=16,
    target_modules=["q_proj", "v_proj"],
    lora_dropout=0.05,
    task_type="CAUSAL_LM"
)

model = AutoModelForCausalLM.from_pretrained("microsoft/phi-2")
peft_model = get_peft_model(model, lora_config)

# Fine-tuning is fast due to small model size
# Typical: 1-2 hours on single GPU for small dataset
```

## Performance Comparison

```python
def compare_models(models, test_prompts, task_evaluator):
    """Compare different sized models on same task."""
    results = {}

    for name, model in models.items():
        # Measure latency
        start = time.time()
        outputs = [model.generate(p) for p in test_prompts]
        latency = (time.time() - start) / len(test_prompts)

        # Measure quality
        quality_score = task_evaluator(outputs, test_prompts)

        results[name] = {
            "latency_ms": latency * 1000,
            "quality": quality_score,
            "params": get_param_count(model)
        }

    return results

# Example results
"""
Model          | Params | Latency | Quality
---------------|--------|---------|-----
```
