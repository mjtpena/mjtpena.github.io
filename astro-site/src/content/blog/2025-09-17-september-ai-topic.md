---
title: "Fine-Tuning with LoRA: Efficient Model Customization"
description: "Instead of updating all model weights, LoRA injects trainable low-rank matrices into transformer layers. These adapters capture task-specific knowledge…"
author: Michael John Peña
draft: false
date: 2025-09-17
tags:
  - Fine-Tuning
  - LoRA
  - LLM
  - Efficient Training
  - PEFT
---

## Understanding LoRA

Instead of updating all model weights, LoRA injects trainable low-rank matrices into transformer layers. These adapters capture task-specific knowledge without modifying the original model.

```python
from peft import LoraConfig, get_peft_model, TaskType
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
from datasets import load_dataset
import torch

# Load base model
model_name = "microsoft/phi-2"
base_model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype=torch.float16,
    device_map="auto"
)
tokenizer = AutoTokenizer.from_pretrained(model_name)
tokenizer.pad_token = tokenizer.eos_token

# Configure LoRA
lora_config = LoraConfig(
    task_type=TaskType.CAUSAL_LM,
    r=16,  # Rank of update matrices
    lora_alpha=32,  # Scaling factor
    lora_dropout=0.1,
    target_modules=["q_proj", "k_proj", "v_proj", "dense"],
    bias="none"
)

# Apply LoRA to model
model = get_peft_model(base_model, lora_config)

# Check trainable parameters
def print_trainable_parameters(model):
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"Trainable: {trainable:,} / {total:,} ({100 * trainable / total:.2f}%)")

print_trainable_parameters(model)
# Output: Trainable: 4,194,304 / 2,780,000,000 (0.15%)
```

## Training with LoRA

```python
from trl import SFTTrainer

def prepare_dataset(examples):
    """Format examples for instruction fine-tuning."""
    prompts = []
    for instruction, response in zip(examples["instruction"], examples["response"]):
        prompt = f"### Instruction:\n{instruction}\n\n### Response:\n{response}"
        prompts.append(prompt)
    return {"text": prompts}

# Load and prepare dataset
dataset = load_dataset("json", data_files="training_data.json")
dataset = dataset.map(prepare_dataset, batched=True)

# Training configuration
training_args = TrainingArguments(
    output_dir="./lora-output",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,
    learning_rate=2e-4,
    warmup_steps=100,
    logging_steps=10,
    save_strategy="epoch",
    fp16=True
)

# Initialize trainer
trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=dataset["train"],
    tokenizer=tokenizer,
    dataset_text_field="text",
    max_seq_length=512
)

# Train
trainer.train()

# Save LoRA adapters (small file!)
model.save_pretrained("./lora-adapters")
```

## Merging and Deployment

```python
from peft import PeftModel

# Load base model and merge LoRA weights
base_model = AutoModelForCausalLM.from_pretrained(model_name)
lora_model = PeftModel.from_pretrained(base_model, "./lora-adapters")

# Merge adapters into base model
merged_model = lora_model.merge_and_unload()

# Save merged model for deployment
merged_model.save_pretrained("./merged-model")
```

LoRA enables rapid experimentation with model customization. Train multiple adapters for different tasks and swap them at inference time without reloading the base model.
