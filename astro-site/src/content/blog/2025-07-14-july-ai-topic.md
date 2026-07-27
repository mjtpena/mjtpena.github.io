---
title: "Fine-Tuning GPT-4o for Domain-Specific Tasks on Azure"
author: Michael John Peña
draft: false
date: 2025-07-14
tags:
  - Fine-Tuning
  - GPT-4o
  - Azure OpenAI
  - MLOps
  - Python

---

I wrote "Fine-Tuning GPT-4o for Domain-Specific Tasks on Azure" to share practical, production-minded guidance on this topic.

## Preparing Training Data

Quality training data is critical. Structure your examples to demonstrate the exact behavior you want:

```python
import json
from pathlib import Path

def prepare_training_data(examples: list[dict]) -> str:
    """Format examples for Azure OpenAI fine-tuning."""
    training_lines = []

    for ex in examples:
        training_example = {
            "messages": [
                {"role": "system", "content": ex["system_prompt"]},
                {"role": "user", "content": ex["user_input"]},
                {"role": "assistant", "content": ex["expected_output"]}
            ]
        }
        training_lines.append(json.dumps(training_example))

    return "\n".join(training_lines)

# Example: Legal document analysis
legal_examples = [
    {
        "system_prompt": "You are a legal document analyst. Extract key terms and obligations.",
        "user_input": "Analyze this contract clause: 'The Licensee shall pay...'",
        "expected_output": '{"obligation_type": "payment", "party": "Licensee", ...}'
    },
    # 50-100 high-quality examples recommended
]

training_data = prepare_training_data(legal_examples)
Path("training_data.jsonl").write_text(training_data)
```

## Initiating Fine-Tuning

Use the Azure OpenAI SDK to manage the fine-tuning process:

```python
from openai import AzureOpenAI

client = AzureOpenAI(
    api_key=api_key,
    api_version="2024-12-01-preview",
    azure_endpoint=endpoint
)

# Upload training file
with open("training_data.jsonl", "rb") as f:
    training_file = client.files.create(file=f, purpose="fine-tune")

# Create fine-tuning job
job = client.fine_tuning.jobs.create(
    training_file=training_file.id,
    model="gpt-4o-2024-08-06",
    hyperparameters={
        "n_epochs": 3,
        "batch_size": 4,
        "learning_rate_multiplier": 0.5
    },
    suffix="legal-analyst"
)

print(f"Fine-tuning job created: {job.id}")
```

## Evaluation and Deployment

After training completes, evaluate on a held-out test set before deploying. Monitor the fine-tuned model's performance against the base model to ensure improvements justify the additional cost.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
