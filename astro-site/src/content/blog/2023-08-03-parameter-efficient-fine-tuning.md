---
title: "Parameter-Efficient Fine-Tuning: A Comprehensive Guide"
author: Michael John Peña
draft: false
date: 2023-08-03
tags:
  - PEFT
  - Fine-Tuning
  - LLM
  - Machine Learning

---

I wrote "Parameter-Efficient Fine-Tuning: A Comprehensive Guide" to share practical, production-minded guidance on this topic.

## PEFT Overview

```python
# Why PEFT matters
peft_benefits = {
    "memory_efficient": "Train on consumer GPUs",
    "storage_efficient": "Small adapter files (MBs vs GBs)",
    "modular": "Swap adapters without reloading base model",
    "fast": "Quicker training iterations",
    "prevents_forgetting": "Base model knowledge preserved"
}

# PEFT method categories
peft_categories = {
    "additive": ["Adapters", "Prefix Tuning", "Prompt Tuning"],
    "selective": ["BitFit", "Diff Pruning"],
    "reparameterization": ["LoRA", "AdaLoRA", "DoRA"]
}
```

## Adapter Methods

### Standard Adapters

```python
from peft import AdapterConfig, get_peft_model

# Adapter configuration
adapter_config = AdapterConfig(
    adapter_size=64,           # Size of adapter layers
    adapter_act="relu",        # Activation function
    adapter_dropout=0.1        # Dropout probability
)

# Apply adapters
model = get_peft_model(base_model, adapter_config)

# How adapters work:
"""
Original layer:
    output = layer(input)

With adapter:
    hidden = layer(input)
    adapter_output = down_project(hidden)  # Reduce dimension
    adapter_output = activation(adapter_output)
    adapter_output = up_project(adapter_output)  # Restore dimension
    output = hidden + adapter_output  # Residual connection
"""
```

### Parallel Adapters

```python
# Parallel adapters process input alongside the original layer
parallel_adapter_config = AdapterConfig(
    adapter_size=64,
    parallel=True  # Process in parallel instead of serial
)

# Benefits:
# - Can be more expressive
# - Better gradient flow
# - Slightly more compute
```

## Prefix Tuning

```python
from peft import PrefixTuningConfig

# Prefix tuning adds trainable vectors to attention
prefix_config = PrefixTuningConfig(
    num_virtual_tokens=20,    # Number of prefix tokens
    encoder_hidden_size=768,  # Hidden size for prefix encoding
    prefix_projection=True    # Use MLP to generate prefix
)

model = get_peft_model(base_model, prefix_config)

# How it works:
"""
Normal attention:
    attention(Q, K, V)

With prefix:
    K' = concat(prefix_K, K)
    V' = concat(prefix_V, V)
    attention(Q, K', V')

The prefix tokens are learned during training.
"""
```

## Prompt Tuning

```python
from peft import PromptTuningConfig, PromptTuningInit

# Soft prompt tuning
prompt_config = PromptTuningConfig(
    num_virtual_tokens=20,
    prompt_tuning_init=PromptTuningInit.TEXT,
    prompt_tuning_init_text="Classify the sentiment of the following text:",
    tokenizer_name_or_path=model_name
)

model = get_peft_model(base_model, prompt_config)

# How it works:
"""
Instead of discrete tokens: "Classify sentiment:"
Learn continuous embeddings that serve the same purpose
but are optimized for the specific task.

Input: [learned_prompt_embeddings] + [actual_input_embeddings]
"""
```

## P-Tuning

```python
from peft import PromptEncoderConfig, TaskType

# P-Tuning v2 configuration
p_tuning_config = PromptEncoderConfig(
    num_virtual_tokens=20,
    encoder_hidden_size=128,
    encoder_num_layers=2,
    encoder_dropout=0.1,
    task_type=TaskType.CAUSAL_LM
)

model = get_peft_model(base_model, p_tuning_config)

# Difference from prompt tuning:
# - Uses an encoder (MLP/LSTM) to generate prompt embeddings
# - More expressive but more parameters
# - Better for complex tasks
```

## IA3 (Infused Adapter by Inhibiting and Amplifying Inner Activations)

```python
from peft import IA3Config

# IA3 configuration
ia3_config = IA3Config(
    target_modules=["k_proj", "v_proj", "down_proj"],
    feedforward_modules=["down_proj"]
)

model = get_peft_model(base_model, ia3_config)

# How it works:
"""
Instead of adding new layers:
    output = activation * learned_vector

Very few parameters (just scaling vectors)
But effective for many tasks.
"""
```

## Comparing PEFT Methods

```python
comparison_table = """
| Method          | Params Added | Memory  | Quality | Use Case |
|-----------------|--------------|---------|---------|----------|
| Full Fine-tune  | 100%         | Highest | Best    | Unlimited resources |
| LoRA            | ~0.1%        | Medium  | High    | General purpose |
| QLoRA           | ~0.1%        | Low     | Good    | Limited GPU memory |
| Adapters        | ~1-5%        | Medium  | High    | Multi-task |
| Prefix Tuning   | ~0.1%        | Low     | Good    | NLU tasks |
| Prompt Tuning   | <0.1%        | Lowest  | Moderate| Simple classification |
| IA3             | <0.01%       | Lowest  | Good    | Memory constrained |
"""
```

## Choosing the Right Method

```python
def recommend_peft_method(scenario):
    recommendations = {
        "limited_gpu_memory": {
            "method": "QLoRA",
            "reasoning": "4-bit quantization minimizes memory"
        },
        "multiple_tasks": {
            "method": "Adapters",
            "reasoning": "Easy to swap task-specific adapters"
        },
        "simple_classification": {
            "method": "Prompt Tuning",
            "reasoning": "Minimal parameters, fast training"
        },
        "generation_task": {
            "method": "LoRA",
            "reasoning": "Good balance of quality and efficiency"
        },
        "instruction_following": {
            "method": "LoRA or QLoRA",
            "reasoning": "Well-suited for instruction tuning"
        },
        "knowledge_intensive": {
            "method": "Full fine-tune or LoRA with high rank",
            "reasoning": "Need more capacity for new knowledge"
        }
    }
    return recommendations.get(scenario, "LoRA as default choice")
```

## Combining PEFT Methods

```python
from peft import PeftModel, LoraConfig, AdapterConfig

# You can combine multiple PEFT methods
# Example: LoRA for attention + Adapters for FFN

lora_config = LoraConfig(
    r=8,
    target_modules=["q_proj", "v_proj"]
)

# Apply LoRA first
model = get_peft_model(base_model, lora_config)

# Note: Combining methods requires careful implementation
# and isn't always beneficial
```

## Training Tips

```python
training_tips = {
    "learning_rate": {
        "peft_general": "Higher than full fine-tuning (1e-4 to 3e-4)",
        "prompt_tuning": "Can be even higher (1e-3)",
        "lora": "2e-4 is a good starting point"
    },
    "batch_size": {
        "guidance": "Use gradient accumulation if memory limited",
        "example": "batch_size=1, gradient_accumulation_steps=16"
    },
    "epochs": {
        "small_dataset": "More epochs (5-10)",
        "large_dataset": "Fewer epochs (1-3)"
    },
    "regularization": {
        "dropout": "Use dropout in PEFT layers",
        "weight_decay": "Small amount (0.01) helps"
    }
}
```

## Evaluation

```python
def evaluate_peft_model(model, test_data, task_type="classification"):
    """Evaluate PEFT model performance."""
    predictions = []
    labels = []

    for example in test_data:
        # Generate prediction
        output = model.generate(example["input"])
        predictions.append(output)
        labels.append(example["label"])

    if task_type == "classification":
        accuracy = sum(p == l for p, l in zip(predictions, labels)) / len(labels)
        return {"accuracy": accuracy}

    elif task_type == "generation":
        # Use appropriate metrics (BLEU, ROUGE, etc.)
        from evaluate import load
        bleu = load("bleu")
        score = bleu.compute(predictions=predictions, references=labels)
        return {"bleu": score}
```

Tomorrow we'll explore PEFT libraries and their practical usage.

## Resources

- [PEFT Library Documentation](https://huggingface.co/docs/peft)
- [Adapter Transformers](https://adapterhub.ml/)
- [PEFT Methods Survey](https://arxiv.org/abs/2303.15647)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
