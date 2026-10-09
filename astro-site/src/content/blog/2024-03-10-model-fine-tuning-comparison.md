---
title: "Model Fine-Tuning Comparison: OpenAI vs Azure vs Open Source"
description: "Fine-tuning allows you to customize LLMs for specific tasks. This guide compares the major approaches available today."
author: "Michael John Peña"
draft: false
date: 2024-03-10
tags:
  - AI
  - Fine-Tuning
  - Azure
  - OpenAI
  - Machine Learning
---

Fine-tuning allows you to customize LLMs for specific tasks. This guide compares the major approaches available today.

## When to Fine-Tune

```python
from dataclasses import dataclass
from typing import List

@dataclass
class UseCase:
    name: str
    data_volume: str  # "small", "medium", "large"
    specialization_needed: str  # "low", "medium", "high"
    latency_requirement: str  # "flexible", "strict"

def should_fine_tune(use_case: UseCase) -> dict:
    """Determine if fine-tuning is appropriate"""

    recommendation = {
        "fine_tune": False,
        "reasoning": [],
        "alternatives": []
    }

    # Check conditions
    if use_case.specialization_needed == "high":
        recommendation["fine_tune"] = True
        recommendation["reasoning"].append("High specialization requires fine-tuning")

    if use_case.data_volume in ["medium", "large"]:
        recommendation["fine_tune"] = True
        recommendation["reasoning"].append("Sufficient data for effective fine-tuning")

    if use_case.latency_requirement == "strict":
        recommendation["fine_tune"] = True
        recommendation["reasoning"].append("Fine-tuned smaller models can reduce latency")

    # Suggest alternatives if not fine-tuning
    if not recommendation["fine_tune"]:
        recommendation["alternatives"] = [
            "Few-shot prompting",
            "RAG with domain documents",
            "System prompt engineering"
        ]

    return recommendation

# Example
use_case = UseCase(
    name="Legal document classification",
    data_volume="large",
    specialization_needed="high",
    latency_requirement="flexible"
)
print(should_fine_tune(use_case))
```

## OpenAI Fine-Tuning

```python
from openai import OpenAI

client = OpenAI()

# 1. Prepare training data (JSONL format)
training_data = [
    {
        "messages": [
            {"role": "system", "content": "You classify legal documents."},
            {"role": "user", "content": "Contract for software development services..."},
            {"role": "assistant", "content": "Category: Service Agreement"}
        ]
    },
    # More examples...
]

# Save to JSONL
import json
with open("training_data.jsonl", "w") as f:
    for item in training_data:
        f.write(json.dumps(item) + "\n")

# 2. Upload training file
training_file = client.files.create(
    file=open("training_data.jsonl", "rb"),
    purpose="fine-tune"
)

# 3. Create fine-tuning job
job = client.fine_tuning.jobs.create(
    training_file=training_file.id,
    model="gpt-3.5-turbo",
    hyperparameters={
        "n_epochs": 3,
        "learning_rate_multiplier": 1.0
    }
)

# 4. Monitor progress
import time
while True:
    status = client.fine_tuning.jobs.retrieve(job.id)
    print(f"Status: {status.status}")
    if status.status in ["succeeded", "failed"]:
        break
    time.sleep(60)

# 5. Use fine-tuned model
fine_tuned_model = status.fine_tuned_model
response = client.chat.completions.create(
    model=fine_tuned_model,
    messages=[
        {"role": "user", "content": "Classify: Amendment to lease agreement..."}
    ]
)
```

## Azure OpenAI Fine-Tuning

```python
from openai import AzureOpenAI
import os

client = AzureOpenAI(
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    api_version="2024-02-15-preview",
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT")
)

# 1. Upload training file
training_file = client.files.create(
    file=open("training_data.jsonl", "rb"),
    purpose="fine-tune"
)

# 2. Create fine-tuning job
job = client.fine_tuning.jobs.create(
    training_file=training_file.id,
    model="gpt-35-turbo-0613",  # Azure model name format
    hyperparameters={
        "n_epochs": 3
    }
)

# 3. Monitor and deploy
while True:
    status = client.fine_tuning.jobs.retrieve(job.id)
    if status.status == "succeeded":
        # Deploy the fine-tuned model
        # This requires Azure CLI or portal
        break
    time.sleep(60)
```

```bash
# Deploy fine-tuned model via Azure CLI
az cognitiveservices account deployment create \
    --resource-group your-rg \
    --name your-openai-resource \
    --deployment-name legal-classifier \
    --model-name your-fine-tuned-model-id \
    --model-version "1" \
    --sku-capacity 10 \
    --sku-name "Standard"
```

## Open Source Fine-Tuning (Llama 2)

```python
# Using Hugging Face Transformers and PEFT

from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TrainingArguments,
    Trainer,
    BitsAndBytesConfig
)
from peft import (
    LoraConfig,
    get_peft_model,
    prepare_model_for_kbit_training
)
import torch

# 1. Load base model with 4-bit quantization
quantization_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_compute_dtype=torch.float16,
    bnb_4bit_quant_type="nf4"
)

model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-7b-chat-hf",
    quantization_config=quantization_config,
    device_map="auto"
)

tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-2-7b-chat-hf")
tokenizer.pad_token = tokenizer.eos_token

# 2. Configure LoRA
lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    target_modules=["q_proj", "v_proj", "k_proj", "o_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM"
)

model = prepare_model_for_kbit_training(model)
model = get_peft_model(model, lora_config)

# 3. Prepare dataset
def format_example(example):
    return {
        "text": f"[INST] {example['instruction']} [/INST] {example['response']}"
    }

dataset = load_dataset("your-dataset")
dataset = dataset.map(format_example)

# 4. Training arguments
training_args = TrainingArguments(
    output_dir="./llama-2-fine-tuned",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,
    learning_rate=2e-4,
    fp16=True,
    logging_steps=10,
    save_strategy="epoch"
)

# 5. Train
trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=dataset["train"],
    tokenizer=tokenizer
)

trainer.train()

# 6. Save model
model.save_pretrained("./llama-2-legal-classifier")
```

## Cost Comparison

```python
# Fine-tuning cost comparison

fine_tuning_costs = {
    "openai_gpt35": {
        "training": 0.008,  # per 1K tokens
        "inference": 0.012,  # per 1K tokens (fine-tuned)
        "min_examples": 10,
        "data_prep_hours": 4
    },
    "azure_openai": {
        "training": 0.008,
        "inference": 0.012,
        "hosting": 0,  # Included in training
        "min_examples": 10,
        "data_prep_hours": 4
    },
    "llama_2_7b": {
        "compute_per_hour": 3.0,  # A100 40GB
        "training_hours": 8,
        "inference_per_hour": 1.5,  # Smaller GPU for inference
        "min_examples": 100,
        "data_prep_hours": 8
    }
}

def calculate_fine_tuning_cost(
    platform: str,
    training_tokens: int,
    monthly_inference_tokens: int
) -> dict:
    costs = fine_tuning_costs[platform]

    if platform in ["openai_gpt35", "azure_openai"]:
        training_cost = (training_tokens / 1000) * costs["training"]
        monthly_inference = (monthly_inference_tokens / 1000) * costs["inference"]
    else:  # Open source
        training_cost = costs["compute_per_hour"] * costs["training_hours"]
        # Assuming 24/7 deployment
        monthly_inference = costs["inference_per_hour"] * 24 * 30

    return {
        "training_cost": training_cost,
        "monthly_inference": monthly_inference,
        "data_prep_hours": costs["data_prep_hours"]
    }

# Compare
for platform in fine_tuning_costs.keys():
    result = calculate_fine_tuning_cost(
        platform,
        training_tokens=1_000_000,
        monthly_inference_tokens=10_000_000
    )
    print(f"{platform}: Training ${result['training_cost']:.0f}, Monthly ${result['monthly_inference']:.0f}")
```

## Conclusion

| Approach | Best For | Complexity | Cost |
|----------|----------|------------|------|
| OpenAI | Quick deployment, GPT quality | Low | Medium |
| Azure OpenAI | Enterprise, compliance | Low | Medium |
| Open Source | Full control, high volume | High | Variable |

Choose based on your data sensitivity requirements, volume, and team expertise.
