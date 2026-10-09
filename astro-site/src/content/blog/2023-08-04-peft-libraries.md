---
title: "PEFT Libraries: Practical Tools for Efficient Fine-Tuning"
author: Michael John Peña
draft: false
date: 2023-08-04
tags:
  - PEFT
  - Hugging Face
  - Fine-Tuning
  - Python
---

## Hugging Face PEFT Library

```python
# Install
# pip install peft transformers accelerate

from peft import (
    get_peft_model,
    LoraConfig,
    TaskType,
    PeftModel,
    prepare_model_for_kbit_training
)
from transformers import AutoModelForCausalLM, AutoTokenizer

# Basic workflow
model_name = "meta-llama/Llama-2-7b-hf"

# 1. Load base model
model = AutoModelForCausalLM.from_pretrained(model_name)
tokenizer = AutoTokenizer.from_pretrained(model_name)

# 2. Configure PEFT method
config = LoraConfig(
    task_type=TaskType.CAUSAL_LM,
    r=8,
    lora_alpha=32,
    lora_dropout=0.1,
    target_modules=["q_proj", "v_proj"]
)

# 3. Create PEFT model
peft_model = get_peft_model(model, config)

# 4. Train (using standard training loop or Trainer)
# 5. Save adapter
peft_model.save_pretrained("./my_adapter")
```

## PEFT Configuration Options

```python
from peft import (
    LoraConfig,
    PrefixTuningConfig,
    PromptTuningConfig,
    AdaLoraConfig,
    IA3Config
)

# LoRA Configuration
lora_config = LoraConfig(
    r=8,                           # Rank
    lora_alpha=32,                 # Scaling
    target_modules=["q_proj", "v_proj", "k_proj", "o_proj"],
    lora_dropout=0.05,
    bias="none",                   # Don't train biases
    task_type=TaskType.CAUSAL_LM,
    inference_mode=False           # Training mode
)

# Prefix Tuning Configuration
prefix_config = PrefixTuningConfig(
    task_type=TaskType.SEQ_2_SEQ_LM,
    num_virtual_tokens=20,
    encoder_hidden_size=128,
    prefix_projection=True
)

# Prompt Tuning Configuration
prompt_config = PromptTuningConfig(
    task_type=TaskType.CAUSAL_LM,
    num_virtual_tokens=8,
    prompt_tuning_init="TEXT",
    prompt_tuning_init_text="Classify if this is positive or negative:",
    tokenizer_name_or_path=model_name
)

# AdaLoRA Configuration (Adaptive LoRA)
adalora_config = AdaLoraConfig(
    init_r=12,                     # Initial rank
    target_r=8,                    # Target rank
    beta1=0.85,
    beta2=0.85,
    tinit=200,
    tfinal=1000,
    deltaT=10,
    lora_alpha=32,
    lora_dropout=0.1,
    target_modules=["q_proj", "v_proj"],
    task_type=TaskType.CAUSAL_LM
)

# IA3 Configuration
ia3_config = IA3Config(
    task_type=TaskType.CAUSAL_LM,
    target_modules=["k_proj", "v_proj", "down_proj"],
    feedforward_modules=["down_proj"]
)
```

## Training with Hugging Face Trainer

```python
from transformers import TrainingArguments, Trainer, DataCollatorForLanguageModeling
from datasets import load_dataset

# Load and prepare dataset
dataset = load_dataset("json", data_files="train.jsonl")

def tokenize_function(examples):
    return tokenizer(
        examples["text"],
        truncation=True,
        max_length=512,
        padding="max_length"
    )

tokenized_dataset = dataset.map(
    tokenize_function,
    batched=True,
    remove_columns=dataset["train"].column_names
)

# Data collator
data_collator = DataCollatorForLanguageModeling(
    tokenizer=tokenizer,
    mlm=False  # Causal LM
)

# Training arguments
training_args = TrainingArguments(
    output_dir="./peft_output",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,
    learning_rate=2e-4,
    warmup_ratio=0.1,
    logging_steps=10,
    save_strategy="epoch",
    fp16=True,
    optim="adamw_torch",
    report_to="none"  # or "wandb", "tensorboard"
)

# Create trainer
trainer = Trainer(
    model=peft_model,
    args=training_args,
    train_dataset=tokenized_dataset["train"],
    data_collator=data_collator
)

# Train
trainer.train()
```

## Loading and Using Adapters

```python
from peft import PeftModel, PeftConfig

# Method 1: Load adapter onto base model
base_model = AutoModelForCausalLM.from_pretrained("meta-llama/Llama-2-7b-hf")
peft_model = PeftModel.from_pretrained(base_model, "./my_adapter")

# Method 2: Auto-detect and load
config = PeftConfig.from_pretrained("./my_adapter")
base_model = AutoModelForCausalLM.from_pretrained(config.base_model_name_or_path)
peft_model = PeftModel.from_pretrained(base_model, "./my_adapter")

# Method 3: From Hub
peft_model = PeftModel.from_pretrained(base_model, "username/my-adapter")

# Merge adapter into base model
merged_model = peft_model.merge_and_unload()
merged_model.save_pretrained("./merged_model")
```

## Using with bitsandbytes

```python
from transformers import BitsAndBytesConfig
import torch

# 4-bit quantization config
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.float16,
    bnb_4bit_use_double_quant=True
)

# Load quantized model
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    quantization_config=bnb_config,
    device_map="auto"
)

# Prepare for k-bit training
model = prepare_model_for_kbit_training(model)

# Apply PEFT
peft_model = get_peft_model(model, lora_config)
```

## Adapter Fusion

```python
# Combine multiple adapters
from peft import PeftModel

# Load base model
base_model = AutoModelForCausalLM.from_pretrained(model_name)

# Load first adapter
model = PeftModel.from_pretrained(base_model, "./adapter1", adapter_name="task1")

# Load additional adapters
model.load_adapter("./adapter2", adapter_name="task2")
model.load_adapter("./adapter3", adapter_name="task3")

# List loaded adapters
print(model.peft_config.keys())  # ['task1', 'task2', 'task3']

# Switch active adapter
model.set_adapter("task1")
output1 = model.generate(...)

model.set_adapter("task2")
output2 = model.generate(...)

# Combine adapters with weighted merging
model.add_weighted_adapter(
    adapters=["task1", "task2"],
    weights=[0.7, 0.3],
    adapter_name="merged"
)
model.set_adapter("merged")
```

## Integration with TRL

```python
# TRL (Transformer Reinforcement Learning) integration
from trl import SFTTrainer
from peft import LoraConfig

# Configure LoRA
peft_config = LoraConfig(
    r=16,
    lora_alpha=32,
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM"
)

# SFT Trainer handles PEFT automatically
trainer = SFTTrainer(
    model=model_name,
    train_dataset=dataset,
    peft_config=peft_config,
    dataset_text_field="text",
    max_seq_length=512,
    args=TrainingArguments(
        output_dir="./sft_output",
        per_device_train_batch_size=4,
        num_train_epochs=3,
        learning_rate=2e-4
    )
)

trainer.train()
```

## Debugging PEFT Models

```python
# Check trainable parameters
def print_trainable_params(model):
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"Trainable: {trainable:,} / {total:,} = {trainable/total:.2%}")

print_trainable_params(peft_model)

# Inspect PEFT configuration
print(peft_model.peft_config)

# Check which modules have PEFT applied
for name, module in peft_model.named_modules():
    if "lora" in name.lower():
        print(f"LoRA module: {name}")

# Get adapter state dict
adapter_state = peft_model.get_adapter_state_dict("default")
print(f"Adapter parameters: {len(adapter_state)}")
```

Tomorrow we'll explore Hugging Face integration with Azure.

## Resources

- [PEFT Documentation](https://huggingface.co/docs/peft)
- [PEFT GitHub](https://github.com/huggingface/peft)
- [TRL Library](https://huggingface.co/docs/trl)
