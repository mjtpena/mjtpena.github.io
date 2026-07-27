---
title: "LLM Fine-Tuning Strategies: When and How to Customize Models"
author: Michael John Peña
draft: false
date: 2023-08-01
tags:
  - LLM
  - Fine-Tuning
  - Machine Learning
  - AI
---

Fine-tuning is the right answer to fewer questions than the hype suggests, and I want to be precise about when it actually makes sense before diving into the how. In August 2023, Azure OpenAI fine-tuning is available for gpt-35-turbo, babbage-002, and davinci-002 — not GPT-4, which hasn't opened for fine-tuning yet. For open-source models like Llama 2 (released by Meta on July 18, 2023, in 7B, 13B, and 70B sizes), fine-tuning is more tractable on your own infrastructure. The cases where fine-tuning clearly beats prompt engineering: consistent output format that prompt engineering can't reliably produce, domain-specific terminology adaptation, and task-specific models that need to be smaller and cheaper to serve than a general-purpose GPT-4. The cases where it's the wrong choice: you want the model to know new facts (use RAG), the task is general (prompt engineering suffices), or you lack quality training data.

## When to Fine-Tune

```python
# Decision framework for fine-tuning
fine_tuning_decision = {
    "consider_fine_tuning_when": [
        "Specific domain terminology needed",
        "Consistent output format required",
        "Task requires specialized knowledge",
        "Prompt engineering alone isn't sufficient",
        "Cost reduction needed (shorter prompts)"
    ],
    "avoid_fine_tuning_when": [
        "Prompt engineering achieves goals",
        "RAG provides needed context",
        "Limited training data available",
        "Task changes frequently",
        "Base model already performs well"
    ]
}

# The hierarchy of customization
customization_hierarchy = [
    "1. Prompt engineering (start here)",
    "2. Few-shot examples in context",
    "3. RAG (Retrieval Augmented Generation)",
    "4. Fine-tuning (when above insufficient)"
]
```

## Fine-Tuning Approaches

### Full Fine-Tuning

```python
# Full fine-tuning updates all model parameters
full_finetuning = {
    "description": "Update all model weights",
    "requirements": {
        "compute": "Very high (multiple GPUs)",
        "memory": "Full model must fit in memory",
        "data": "Large high-quality dataset",
        "time": "Hours to days"
    },
    "pros": [
        "Maximum flexibility",
        "Best potential performance",
        "Full adaptation to domain"
    ],
    "cons": [
        "Very expensive",
        "Risk of catastrophic forgetting",
        "Requires significant infrastructure"
    ]
}
```

### Parameter-Efficient Fine-Tuning (PEFT)

```python
# PEFT methods update only a small subset of parameters
peft_methods = {
    "lora": {
        "name": "Low-Rank Adaptation",
        "params_trained": "< 1% of total",
        "memory": "Much lower than full",
        "quality": "Near full fine-tuning quality"
    },
    "qlora": {
        "name": "Quantized LoRA",
        "params_trained": "< 1% of total",
        "memory": "4-bit quantization + LoRA",
        "quality": "Good, with memory efficiency"
    },
    "prefix_tuning": {
        "name": "Prefix Tuning",
        "params_trained": "Prefix tokens only",
        "memory": "Very low",
        "quality": "Task-specific optimization"
    },
    "adapters": {
        "name": "Adapter Layers",
        "params_trained": "Small adapter modules",
        "memory": "Low",
        "quality": "Good for multi-task"
    }
}
```

## Preparing Training Data

### Data Format

```python
# Standard fine-tuning data format
training_examples = [
    {
        "messages": [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "What is the capital of France?"},
            {"role": "assistant", "content": "The capital of France is Paris."}
        ]
    },
    {
        "messages": [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Summarize this text: ..."},
            {"role": "assistant", "content": "Summary: ..."}
        ]
    }
]

# Save as JSONL
import json

with open("training_data.jsonl", "w") as f:
    for example in training_examples:
        f.write(json.dumps(example) + "\n")
```

### Data Quality Guidelines

```python
data_quality_guidelines = {
    "quantity": {
        "minimum": "50-100 examples for simple tasks",
        "recommended": "500-1000 for complex tasks",
        "more_is_better": "But quality > quantity"
    },
    "quality": {
        "accuracy": "All examples must be correct",
        "consistency": "Same format and style throughout",
        "diversity": "Cover edge cases and variations",
        "relevance": "Only include task-relevant examples"
    },
    "format": {
        "clear_instructions": "System prompts define behavior",
        "realistic_inputs": "Match real-world usage",
        "ideal_outputs": "Show exactly what you want"
    }
}

# Data validation
def validate_training_data(examples):
    issues = []

    for i, example in enumerate(examples):
        # Check structure
        if "messages" not in example:
            issues.append(f"Example {i}: Missing 'messages' key")
            continue

        messages = example["messages"]

        # Check roles
        roles = [m["role"] for m in messages]
        if "assistant" not in roles:
            issues.append(f"Example {i}: Missing assistant response")

        # Check content length
        for msg in messages:
            if len(msg["content"]) < 10:
                issues.append(f"Example {i}: Very short content detected")

    return issues
```

## Fine-Tuning with Azure OpenAI

```python
from openai import AzureOpenAI

client = AzureOpenAI(
    azure_endpoint="https://your-resource.openai.azure.com/",
    api_key="your-api-key",
    api_version="2024-02-15-preview"
)

# Upload training file
with open("training_data.jsonl", "rb") as f:
    training_file = client.files.create(
        file=f,
        purpose="fine-tune"
    )

print(f"Training file ID: {training_file.id}")

# Create fine-tuning job
job = client.fine_tuning.jobs.create(
    training_file=training_file.id,
    model="gpt-35-turbo-0613",  # Base model
    hyperparameters={
        "n_epochs": 3,
        "batch_size": 4,
        "learning_rate_multiplier": 0.1
    }
)

print(f"Job ID: {job.id}")
print(f"Status: {job.status}")

# Monitor job progress
import time

while job.status not in ["succeeded", "failed", "cancelled"]:
    time.sleep(60)
    job = client.fine_tuning.jobs.retrieve(job.id)
    print(f"Status: {job.status}")

if job.status == "succeeded":
    print(f"Fine-tuned model: {job.fine_tuned_model}")
```

## Hyperparameter Tuning

```python
# Key hyperparameters
hyperparameters = {
    "n_epochs": {
        "description": "Number of training passes",
        "default": 3,
        "guidance": "Start with 3, increase if underfitting"
    },
    "batch_size": {
        "description": "Examples per training step",
        "default": 4,
        "guidance": "Larger = more stable, smaller = more updates"
    },
    "learning_rate_multiplier": {
        "description": "Learning rate scaling",
        "default": 1.0,
        "guidance": "Lower for more subtle changes"
    }
}

# Experimentation strategy
def hyperparameter_search():
    experiments = [
        {"n_epochs": 2, "learning_rate_multiplier": 0.1},
        {"n_epochs": 3, "learning_rate_multiplier": 0.1},
        {"n_epochs": 3, "learning_rate_multiplier": 0.5},
        {"n_epochs": 4, "learning_rate_multiplier": 0.1},
    ]

    results = []
    for params in experiments:
        job = train_model(params)
        metrics = evaluate_model(job.fine_tuned_model)
        results.append({"params": params, "metrics": metrics})

    return sorted(results, key=lambda x: x["metrics"]["accuracy"], reverse=True)
```

## Evaluation

```python
# Evaluation dataset (separate from training)
evaluation_examples = [
    {"input": "...", "expected_output": "..."},
    # ... more examples
]

def evaluate_fine_tuned_model(model_name, test_data):
    correct = 0
    total = len(test_data)

    for example in test_data:
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "user", "content": example["input"]}
            ]
        )

        actual = response.choices[0].message.content
        expected = example["expected_output"]

        # Your evaluation logic
        if evaluate_match(actual, expected):
            correct += 1

    accuracy = correct / total
    return {"accuracy": accuracy, "correct": correct, "total": total}

# Compare base vs fine-tuned
base_results = evaluate_fine_tuned_model("gpt-35-turbo", test_data)
finetuned_results = evaluate_fine_tuned_model("ft:gpt-35-turbo:...", test_data)

print(f"Base model accuracy: {base_results['accuracy']:.2%}")
print(f"Fine-tuned accuracy: {finetuned_results['accuracy']:.2%}")
```

## Best Practices

```python
best_practices = {
    "data": {
        "clean_data": "Ensure training data is accurate",
        "diverse_examples": "Cover the full range of use cases",
        "balanced": "Don't over-represent any category",
        "hold_out_test": "Keep evaluation data separate"
    },
    "training": {
        "start_small": "Begin with fewer epochs",
        "monitor_loss": "Watch for overfitting",
        "validate_early": "Test during training if possible"
    },
    "deployment": {
        "a_b_test": "Compare against base model",
        "monitor_performance": "Track real-world metrics",
        "iterate": "Fine-tune again with new data"
    }
}
```

Tomorrow we'll dive deep into LoRA and QLoRA techniques.

## Resources

- [Azure OpenAI Fine-Tuning](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/fine-tuning)
- [OpenAI Fine-Tuning Guide](https://platform.openai.com/docs/guides/fine-tuning)
- [Hugging Face PEFT](https://huggingface.co/docs/peft)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
