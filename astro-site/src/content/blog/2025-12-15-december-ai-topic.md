---
title: "The Complete Guide to AI Model Fine-Tuning on Azure"
description: "Fine-tuning is powerful but expensive. Validate the ROI before investing in training infrastructure."
author: Michael John Peña
draft: false
date: 2025-12-15
tags:
  - Fine-Tuning
  - Azure
  - OpenAI
  - AI
  - ML
---

## When to Fine-Tune

Fine-tune when you need:
- Consistent output format/style
- Domain-specific terminology
- Reduced prompt length (lower costs)
- Specific behavior patterns

Don't fine-tune when:
- RAG can solve your problem
- You lack quality training data
- Your requirements change frequently

## Preparing Training Data

Quality data is essential. Here's the format:

```python
import json

def create_training_example(system: str, user: str, assistant: str) -> dict:
    return {
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
            {"role": "assistant", "content": assistant}
        ]
    }

# Generate training file
training_data = [
    create_training_example(
        system="You are a technical support agent for Azure services.",
        user="My Azure Function is timing out after 30 seconds",
        assistant="Azure Functions have a default timeout of 30 seconds for Consumption plan. To resolve this:\n\n1. **Increase timeout**: In host.json, set `functionTimeout` to a higher value (max 10 minutes for Consumption)\n2. **Switch to Premium plan**: For longer execution, Premium plan supports up to 60 minutes\n3. **Optimize code**: Consider async operations or breaking into smaller functions\n\nWhich approach would you like help implementing?"
    ),
    # Add 50-100 more examples...
]

with open("training_data.jsonl", "w") as f:
    for example in training_data:
        f.write(json.dumps(example) + "\n")
```

## Uploading to Azure OpenAI

```python
from openai import AzureOpenAI

client = AzureOpenAI(
    azure_endpoint="https://your-endpoint.openai.azure.com/",
    api_key="your-key",
    api_version="2024-10-01-preview"
)

# Upload training file
with open("training_data.jsonl", "rb") as f:
    training_file = client.files.create(
        file=f,
        purpose="fine-tune"
    )

print(f"File ID: {training_file.id}")
```

## Creating Fine-Tuning Job

```python
# Start fine-tuning
fine_tune_job = client.fine_tuning.jobs.create(
    training_file=training_file.id,
    model="gpt-4o-mini-2024-07-18",
    hyperparameters={
        "n_epochs": 3,
        "batch_size": 4,
        "learning_rate_multiplier": 1.0
    },
    suffix="azure-support-v1"
)

print(f"Job ID: {fine_tune_job.id}")

# Monitor progress
import time

while True:
    job = client.fine_tuning.jobs.retrieve(fine_tune_job.id)
    print(f"Status: {job.status}")

    if job.status in ["succeeded", "failed", "cancelled"]:
        break

    time.sleep(60)

if job.status == "succeeded":
    print(f"Fine-tuned model: {job.fine_tuned_model}")
```

## Deploying the Model

```bash
# Deploy via Azure CLI
az cognitiveservices account deployment create \
  --name your-openai-resource \
  --resource-group your-rg \
  --deployment-name azure-support-ft \
  --model-name your-fine-tuned-model-name \
  --model-version "1" \
  --model-format OpenAI \
  --sku-capacity 10 \
  --sku-name Standard
```

## Using the Fine-Tuned Model

```python
response = client.chat.completions.create(
    model="azure-support-ft",  # Your deployment name
    messages=[
        {"role": "system", "content": "You are a technical support agent for Azure services."},
        {"role": "user", "content": "How do I enable Application Insights for my Function App?"}
    ]
)

print(response.choices[0].message.content)
```

## Cost Considerations

| Item | Cost |
|------|------|
| Training | $0.008/1K tokens |
| Hosting | $1.70/hour (while deployed) |
| Inference | 2-3x base model pricing |

Fine-tuning is powerful but expensive. Validate the ROI before investing in training infrastructure.
