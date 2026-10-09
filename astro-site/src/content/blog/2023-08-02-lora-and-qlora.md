---
title: "LoRA and QLoRA: Efficient Fine-Tuning for Large Language Models"
author: Michael John Peña
draft: false
date: 2023-08-02
tags:
  - LoRA
  - QLoRA
  - Fine-Tuning
  - LLM
---

## Understanding LoRA

```python
# LoRA key concepts
lora_explained = {
    "core_idea": "Instead of updating all weights, learn low-rank decomposition",
    "math": "W' = W + BA where B (d x r) and A (r x k), r << d, k",
    "parameters": "Only train B and A matrices",
    "savings": "Typically 0.1-1% of original parameters"
}

# Why LoRA works
lora_benefits = {
    "efficiency": "Train millions instead of billions of parameters",
    "memory": "Dramatically reduced GPU memory requirements",
    "speed": "Faster training iterations",
    "modularity": "LoRA adapters can be swapped without reloading base model",
    "quality": "Near full fine-tuning performance for many tasks"
}
```

## LoRA Implementation

### Basic LoRA Setup

```python
from peft import LoraConfig, get_peft_model, TaskType
from transformers import AutoModelForCausalLM, AutoTokenizer

# Load base model
model_name = "meta-llama/Llama-2-7b-hf"
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype=torch.float16,
    device_map="auto"
)
tokenizer = AutoTokenizer.from_pretrained(model_name)

# Configure LoRA
lora_config = LoraConfig(
    r=8,                      # Rank of the update matrices
    lora_alpha=32,            # Scaling factor
    target_modules=[          # Which layers to adapt
        "q_proj",
        "k_proj",
        "v_proj",
        "o_proj"
    ],
    lora_dropout=0.05,        # Dropout for regularization
    bias="none",              # Don't train biases
    task_type=TaskType.CAUSAL_LM
)

# Create PEFT model
peft_model = get_peft_model(model, lora_config)

# Check trainable parameters
peft_model.print_trainable_parameters()
# Output: trainable params: 4,194,304 || all params: 6,742,609,920 || trainable%: 0.06%
```

### LoRA Hyperparameters

```python
# Key LoRA hyperparameters explained
lora_hyperparameters = {
    "r": {
        "description": "Rank of the LoRA update matrices",
        "values": [4, 8, 16, 32, 64],
        "guidance": "Higher = more capacity but more parameters",
        "default": 8
    },
    "lora_alpha": {
        "description": "Scaling factor for LoRA weights",
        "values": [8, 16, 32, 64],
        "guidance": "Often set to 2*r",
        "effect": "alpha/r determines actual scaling"
    },
    "target_modules": {
        "description": "Which layers to apply LoRA",
        "common_choices": {
            "attention_only": ["q_proj", "v_proj"],
            "full_attention": ["q_proj", "k_proj", "v_proj", "o_proj"],
            "mlp_included": ["q_proj", "v_proj", "gate_proj", "up_proj", "down_proj"]
        },
        "guidance": "More modules = more capacity, more parameters"
    },
    "lora_dropout": {
        "description": "Dropout probability for LoRA layers",
        "values": [0.0, 0.05, 0.1],
        "guidance": "Helps prevent overfitting"
    }
}
```

## QLoRA: Quantized LoRA

```python
# QLoRA combines quantization with LoRA
qlora_explained = {
    "innovation": "4-bit quantized base model + LoRA adapters",
    "memory_savings": "Run 65B model on single 48GB GPU",
    "key_techniques": [
        "4-bit NormalFloat quantization",
        "Double quantization",
        "Paged optimizers"
    ]
}
```

### QLoRA Implementation

```python
from transformers import BitsAndBytesConfig
import torch

# Configure 4-bit quantization
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",           # NormalFloat 4-bit
    bnb_4bit_compute_dtype=torch.float16, # Compute in fp16
    bnb_4bit_use_double_quant=True        # Double quantization
)

# Load quantized model
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    quantization_config=bnb_config,
    device_map="auto"
)

# Apply LoRA on top
lora_config = LoraConfig(
    r=64,                     # Can use higher rank with QLoRA
    lora_alpha=16,
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj"
    ],
    lora_dropout=0.05,
    bias="none",
    task_type=TaskType.CAUSAL_LM
)

peft_model = get_peft_model(model, lora_config)
peft_model.print_trainable_parameters()
```

## Training Loop

```python
from transformers import TrainingArguments, Trainer
from datasets import load_dataset

# Load dataset
dataset = load_dataset("json", data_files="training_data.jsonl")

# Tokenize
def tokenize_function(examples):
    return tokenizer(
        examples["text"],
        padding="max_length",
        truncation=True,
        max_length=512
    )

tokenized_dataset = dataset.map(tokenize_function, batched=True)

# Training arguments
training_args = TrainingArguments(
    output_dir="./lora_output",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,
    warmup_steps=100,
    learning_rate=2e-4,
    fp16=True,
    logging_steps=10,
    save_strategy="epoch",
    evaluation_strategy="epoch",
    load_best_model_at_end=True
)

# Create trainer
trainer = Trainer(
    model=peft_model,
    args=training_args,
    train_dataset=tokenized_dataset["train"],
    eval_dataset=tokenized_dataset["test"],
    tokenizer=tokenizer
)

# Train
trainer.train()

# Save adapter
peft_model.save_pretrained("./lora_adapter")
```

## Saving and Loading Adapters

```python
# Save only the LoRA adapter (small file)
peft_model.save_pretrained("./my_lora_adapter")

# Load base model + adapter later
from peft import PeftModel

base_model = AutoModelForCausalLM.from_pretrained(model_name)
model_with_adapter = PeftModel.from_pretrained(base_model, "./my_lora_adapter")

# Merge adapter into base model for inference
merged_model = model_with_adapter.merge_and_unload()
```

## Multiple Adapters

```python
# LoRA supports multiple adapters for different tasks
from peft import PeftModel

# Load base model
base_model = AutoModelForCausalLM.from_pretrained(model_name)

# Load multiple adapters
model = PeftModel.from_pretrained(base_model, "./adapter_task1", adapter_name="task1")
model.load_adapter("./adapter_task2", adapter_name="task2")
model.load_adapter("./adapter_task3", adapter_name="task3")

# Switch between adapters
model.set_adapter("task1")  # Use task1 adapter
response1 = generate(model, prompt)

model.set_adapter("task2")  # Switch to task2
response2 = generate(model, prompt)
```

## Comparison: LoRA vs QLoRA vs Full Fine-Tuning

```python
comparison = {
    "full_fine_tuning": {
        "memory_7b": "~112 GB",
        "parameters_trained": "100%",
        "quality": "Highest",
        "gpu_required": "4-8x A100"
    },
    "lora": {
        "memory_7b": "~28 GB",
        "parameters_trained": "~0.1%",
        "quality": "Near full fine-tuning",
        "gpu_required": "1x A100 or 2x RTX 4090"
    },
    "qlora": {
        "memory_7b": "~6 GB",
        "parameters_trained": "~0.1%",
        "quality": "Good for most tasks",
        "gpu_required": "1x RTX 3090/4090"
    }
}
```

## Best Practices

```python
best_practices = {
    "rank_selection": {
        "simple_tasks": "r=8 usually sufficient",
        "complex_tasks": "Try r=16 or r=32",
        "start_low": "Begin with r=8, increase if needed"
    },
    "target_modules": {
        "minimum": "q_proj, v_proj for attention",
        "recommended": "All attention projections",
        "maximum": "Include MLP layers for more capacity"
    },
    "learning_rate": {
        "lora": "2e-4 to 3e-4 typical",
        "qlora": "1e-4 to 2e-4 typical",
        "lower_if": "Overfitting observed"
    },
    "data_quality": {
        "priority": "Quality over quantity",
        "examples": "500-1000 high-quality examples",
        "diversity": "Cover all expected use cases"
    }
}
```

Tomorrow we'll explore parameter-efficient fine-tuning methods in more depth.

## Resources

- [LoRA Paper](https://arxiv.org/abs/2106.09685)
- [QLoRA Paper](https://arxiv.org/abs/2305.14314)
- [PEFT Library](https://huggingface.co/docs/peft)
- [Hugging Face LoRA Guide](https://huggingface.co/docs/peft/conceptual_guides/lora)
