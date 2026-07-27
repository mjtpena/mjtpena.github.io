---
title: "Azure OpenAI Fine-Tuning GA: Production-Ready Customization"
author: "Michael John Peña"
draft: false
date: 2024-03-11
tags: ["Azure", "OpenAI", "Fine-tuning", "Machine Learning", "AI"]

---

I wrote "Azure OpenAI Fine-Tuning GA: Production-Ready Customization" to share practical, production-minded guidance on this topic.

Azure OpenAI fine-tuning is now generally available, bringing enterprise-grade model customization to the Azure platform. This comprehensive guide covers everything you need to get started.

## What's New in GA

- **GPT-3.5 Turbo fine-tuning**: Customize the latest chat models
- **Improved training speeds**: Faster iteration cycles
- **Better cost controls**: Pay only for what you use
- **Enterprise compliance**: Full Azure security and compliance

## Prerequisites

```bash
# Install required packages
pip install openai azure-identity

# Set environment variables
export AZURE_OPENAI_API_KEY="your-api-key"
export AZURE_OPENAI_ENDPOINT="https://your-resource.openai.azure.com"
```

## Step 1: Prepare Training Data

```python
import json
from typing import List, Dict

def create_training_example(
    system_prompt: str,
    user_message: str,
    assistant_response: str
) -> Dict:
    """Create a single training example in the required format"""
    return {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
            {"role": "assistant", "content": assistant_response}
        ]
    }

def prepare_training_file(
    examples: List[Dict],
    output_path: str
) -> None:
    """Save training examples to JSONL format"""
    with open(output_path, 'w') as f:
        for example in examples:
            f.write(json.dumps(example) + '\n')

# Example: Customer service classifier
training_examples = [
    create_training_example(
        system_prompt="You are a customer service classifier. Classify inquiries into: billing, technical, general, urgent.",
        user_message="My credit card was charged twice for the same order!",
        assistant_response="Category: billing\nPriority: high\nReasoning: Duplicate charge requires immediate attention."
    ),
    create_training_example(
        system_prompt="You are a customer service classifier. Classify inquiries into: billing, technical, general, urgent.",
        user_message="How do I reset my password?",
        assistant_response="Category: technical\nPriority: medium\nReasoning: Standard account access issue."
    ),
    # Add at least 10 examples for effective fine-tuning
]

prepare_training_file(training_examples, "training_data.jsonl")
```

## Step 2: Validate Training Data

```python
import json
from collections import defaultdict

def validate_training_file(file_path: str) -> dict:
    """Validate training data format and quality"""
    stats = defaultdict(int)
    errors = []

    with open(file_path, 'r') as f:
        for i, line in enumerate(f, 1):
            try:
                example = json.loads(line)

                # Check required structure
                if "messages" not in example:
                    errors.append(f"Line {i}: Missing 'messages' key")
                    continue

                messages = example["messages"]

                # Validate message roles
                roles = [m["role"] for m in messages]
                if roles[-1] != "assistant":
                    errors.append(f"Line {i}: Last message must be from assistant")

                # Count tokens (approximate)
                total_tokens = sum(len(m["content"].split()) * 1.3 for m in messages)
                stats["total_tokens"] += int(total_tokens)
                stats["examples"] += 1

            except json.JSONDecodeError:
                errors.append(f"Line {i}: Invalid JSON")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "stats": dict(stats)
    }

validation = validate_training_file("training_data.jsonl")
print(f"Valid: {validation['valid']}")
print(f"Examples: {validation['stats']['examples']}")
print(f"Total tokens: {validation['stats']['total_tokens']}")
if validation['errors']:
    print(f"Errors: {validation['errors'][:5]}")  # Show first 5 errors
```

## Step 3: Upload and Fine-Tune

```python
from openai import AzureOpenAI
import os
import time

client = AzureOpenAI(
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    api_version="2024-02-15-preview",
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT")
)

# Upload training file
print("Uploading training file...")
with open("training_data.jsonl", "rb") as f:
    training_file = client.files.create(
        file=f,
        purpose="fine-tune"
    )
print(f"File ID: {training_file.id}")

# Wait for file processing
while True:
    file_status = client.files.retrieve(training_file.id)
    if file_status.status == "processed":
        break
    print(f"File status: {file_status.status}")
    time.sleep(10)

# Create fine-tuning job
print("Creating fine-tuning job...")
job = client.fine_tuning.jobs.create(
    training_file=training_file.id,
    model="gpt-35-turbo-0613",
    hyperparameters={
        "n_epochs": 3,
        "batch_size": 1,
        "learning_rate_multiplier": 1.0
    },
    suffix="customer-service"  # Custom model name suffix
)
print(f"Job ID: {job.id}")

# Monitor training
while True:
    job_status = client.fine_tuning.jobs.retrieve(job.id)
    print(f"Status: {job_status.status}")

    if job_status.status == "succeeded":
        print(f"Fine-tuned model: {job_status.fine_tuned_model}")
        break
    elif job_status.status == "failed":
        print(f"Training failed: {job_status.error}")
        break

    # Print training metrics if available
    events = client.fine_tuning.jobs.list_events(job.id, limit=5)
    for event in events.data:
        if event.message:
            print(f"  {event.message}")

    time.sleep(60)
```

## Step 4: Deploy the Model

```bash
# Using Azure CLI to deploy the fine-tuned model
az cognitiveservices account deployment create \
    --resource-group your-resource-group \
    --name your-openai-resource \
    --deployment-name customer-service-classifier \
    --model-name gpt-35-turbo-0613.ft-customer-service \
    --model-version "1" \
    --sku-capacity 10 \
    --sku-name "Standard"
```

## Step 5: Use the Fine-Tuned Model

```python
# Using the deployed fine-tuned model
client = AzureOpenAI(
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    api_version="2024-02-15-preview",
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT")
)

def classify_inquiry(inquiry: str) -> str:
    response = client.chat.completions.create(
        model="customer-service-classifier",  # Your deployment name
        messages=[
            {
                "role": "system",
                "content": "You are a customer service classifier. Classify inquiries into: billing, technical, general, urgent."
            },
            {"role": "user", "content": inquiry}
        ],
        temperature=0.3,
        max_tokens=100
    )
    return response.choices[0].message.content

# Test the model
test_inquiries = [
    "I can't log into my account after the update",
    "When will my refund be processed?",
    "The server is down and we're losing money every minute!"
]

for inquiry in test_inquiries:
    print(f"Inquiry: {inquiry}")
    print(f"Classification: {classify_inquiry(inquiry)}\n")
```

## Cost Management

```python
# Estimate fine-tuning costs
def estimate_fine_tuning_cost(
    training_tokens: int,
    epochs: int,
    monthly_inference_tokens: int
) -> dict:
    """Estimate Azure OpenAI fine-tuning costs"""

    # Pricing (as of March 2024)
    training_cost_per_1k = 0.008  # GPT-3.5 Turbo
    inference_cost_per_1k = 0.012  # Fine-tuned model

    training_cost = (training_tokens / 1000) * training_cost_per_1k * epochs
    monthly_inference_cost = (monthly_inference_tokens / 1000) * inference_cost_per_1k

    return {
        "training_cost": training_cost,
        "monthly_inference_cost": monthly_inference_cost,
        "total_first_month": training_cost + monthly_inference_cost
    }

costs = estimate_fine_tuning_cost(
    training_tokens=100_000,
    epochs=3,
    monthly_inference_tokens=1_000_000
)
print(f"Training cost: ${costs['training_cost']:.2f}")
print(f"Monthly inference: ${costs['monthly_inference_cost']:.2f}")
```

## Best Practices

1. **Start with at least 50-100 high-quality examples**
2. **Use consistent formatting** in training data
3. **Monitor training metrics** during the job
4. **Evaluate thoroughly** before production deployment
5. **Version your training data** alongside your models

## Conclusion

Azure OpenAI fine-tuning provides a production-ready path to customizing GPT models for your specific use cases. With proper data preparation and monitoring, you can achieve significant improvements in task-specific performance.

