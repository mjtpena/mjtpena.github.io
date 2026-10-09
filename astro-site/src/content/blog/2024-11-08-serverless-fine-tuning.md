---
title: "Serverless Fine-Tuning in Azure AI: Customizing Models Without Infrastructure"
description: "Serverless fine-tuning removes the infrastructure barrier to custom model development. Start experimenting with your domain-specific use cases today."
author: Michael John Peña
draft: false
date: 2024-11-08
tags:
  - Azure
  - AI
  - Fine-Tuning
  - Serverless
  - Machine Learning
---

## Serverless vs Traditional Fine-Tuning

| Aspect | Serverless | Traditional |
|--------|------------|-------------|
| Infrastructure | Managed | Self-managed |
| Cost model | Pay per training | Pay for compute time |
| Setup time | Minutes | Hours to days |
| GPU management | None | Required |
| Scaling | Automatic | Manual |
| Best for | Quick experiments | Large-scale training |

## Getting Started with Serverless Fine-Tuning

```python
from azure.ai.foundry import AIFoundryClient
from azure.ai.foundry.fine_tuning import (
    ServerlessFineTuningJob,
    TrainingDataset,
    HyperParameters
)

client = AIFoundryClient(...)

# Prepare your training data
training_data = [
    {
        "messages": [
            {"role": "system", "content": "You are a Fabric data engineer assistant."},
            {"role": "user", "content": "How do I create a lakehouse?"},
            {"role": "assistant", "content": "To create a lakehouse in Microsoft Fabric:\n\n1. Navigate to your Fabric workspace\n2. Click 'New' > 'Lakehouse'\n3. Enter a name for your lakehouse\n4. Click 'Create'\n\nThe lakehouse will be provisioned with:\n- A SQL analytics endpoint\n- OneLake storage\n- Delta table support"}
        ]
    },
    {
        "messages": [
            {"role": "system", "content": "You are a Fabric data engineer assistant."},
            {"role": "user", "content": "What's the difference between a lakehouse and warehouse?"},
            {"role": "assistant", "content": "Key differences in Microsoft Fabric:\n\n**Lakehouse:**\n- Delta Lake format\n- Supports both structured and unstructured data\n- Use Spark and SQL\n- Better for data engineering\n\n**Warehouse:**\n- Traditional SQL warehouse\n- Structured data only\n- T-SQL only\n- Better for BI workloads\n\nChoose lakehouse for flexibility, warehouse for familiar SQL patterns."}
        ]
    },
    # Add 50-500 more examples...
]

# Upload training dataset
dataset = TrainingDataset.from_examples(
    examples=training_data,
    name="fabric-assistant-training-v1"
)

uploaded = client.datasets.upload(dataset)
print(f"Dataset ID: {uploaded.id}")
```

## Creating a Serverless Fine-Tuning Job

```python
# Configure hyperparameters
hyperparams = HyperParameters(
    n_epochs=3,
    batch_size="auto",  # Let Azure optimize
    learning_rate_multiplier="auto"
)

# Create the fine-tuning job
job = ServerlessFineTuningJob(
    base_model="gpt-4o-mini",  # Starting model
    training_dataset_id=uploaded.id,
    validation_split=0.1,  # 10% for validation
    hyperparameters=hyperparams,
    suffix="fabric-assistant"
)

# Submit the job
submitted_job = client.fine_tuning.create(job)
print(f"Job ID: {submitted_job.id}")
print(f"Status: {submitted_job.status}")
print(f"Estimated cost: ${submitted_job.estimated_cost:.2f}")
```

## Monitoring Training Progress

```python
import time

def monitor_fine_tuning_job(job_id: str):
    """Monitor serverless fine-tuning job progress."""

    while True:
        job = client.fine_tuning.get(job_id)

        print(f"\n=== Job Status: {job.status} ===")
        print(f"Progress: {job.progress_percent}%")

        if job.training_metrics:
            print(f"Training Loss: {job.training_metrics.loss:.4f}")
            print(f"Validation Loss: {job.training_metrics.val_loss:.4f}")

        if job.status == "succeeded":
            print(f"\nFine-tuned model: {job.fine_tuned_model}")
            print(f"Total cost: ${job.actual_cost:.2f}")
            return job.fine_tuned_model

        elif job.status == "failed":
            print(f"Error: {job.error_message}")
            return None

        elif job.status == "cancelled":
            print("Job was cancelled")
            return None

        time.sleep(60)

model_name = monitor_fine_tuning_job(submitted_job.id)
```

## Automatic Deployment

```python
# Serverless models can be deployed instantly
if model_name:
    deployment = client.models.deploy_serverless(
        model_name=model_name,
        deployment_name="fabric-assistant-v1",
        auto_scale=True,
        min_instances=0,  # Scale to zero when not in use
        max_instances=5
    )

    print(f"Deployment endpoint: {deployment.endpoint}")
    print(f"Ready for inference!")
```

## Using Your Fine-Tuned Model

```python
# Use exactly like any other model
response = client.chat.complete(
    model="fabric-assistant-v1",  # Your deployment name
    messages=[
        {"role": "user", "content": "How do I optimize a lakehouse for query performance?"}
    ]
)

print(response.choices[0].message.content)
```

## Cost Optimization Strategies

```python
class FineTuningCostOptimizer:
    """Optimize fine-tuning costs with serverless."""

    PRICING = {
        "gpt-4o-mini": {"training_per_1m": 3.00, "inference_per_1m": 0.30},
        "gpt-4o": {"training_per_1m": 25.00, "inference_per_1m": 5.00},
        "gpt-3.5-turbo": {"training_per_1m": 0.80, "inference_per_1m": 0.30}
    }

    def estimate_training_cost(
        self,
        base_model: str,
        num_examples: int,
        avg_tokens_per_example: int,
        epochs: int
    ) -> dict:
        """Estimate training cost."""

        pricing = self.PRICING[base_model]
        total_tokens = num_examples * avg_tokens_per_example * epochs
        training_cost = (total_tokens / 1_000_000) * pricing["training_per_1m"]

        return {
            "total_tokens": total_tokens,
            "estimated_cost": training_cost,
            "recommendation": self.get_recommendation(
                num_examples, base_model, training_cost
            )
        }

    def get_recommendation(
        self,
        num_examples: int,
        model: str,
        cost: float
    ) -> str:
        if num_examples < 50:
            return "Consider adding more examples for better results"
        elif num_examples > 500 and model == "gpt-4o":
            return "Consider using gpt-4o-mini for initial experiments"
        elif cost > 100:
            return "Consider starting with fewer epochs or smaller model"
        return "Configuration looks good"

    def compare_serverless_vs_managed(
        self,
        training_hours: float,
        base_model: str
    ) -> dict:
        """Compare serverless vs managed compute costs."""

        # Serverless pricing
        serverless_cost = training_hours * 10  # Approximate hourly rate

        # Managed compute (NC24ads_A100_v4)
        managed_hourly = 4.50  # Approximate
        managed_setup_hours = 2  # Time to set up
        managed_cost = (training_hours + managed_setup_hours) * managed_hourly

        return {
            "serverless": {
                "cost": serverless_cost,
                "setup_time": "minutes",
                "management": "none"
            },
            "managed": {
                "cost": managed_cost,
                "setup_time": "hours",
                "management": "required"
            },
            "recommendation": "serverless" if serverless_cost < managed_cost * 1.5 else "managed"
        }

# Usage
optimizer = FineTuningCostOptimizer()

estimate = optimizer.estimate_training_cost(
    base_model="gpt-4o-mini",
    num_examples=200,
    avg_tokens_per_example=500,
    epochs=3
)

print(f"Estimated cost: ${estimate['estimated_cost']:.2f}")
print(f"Recommendation: {estimate['recommendation']}")
```

## Best Practices for Serverless Fine-Tuning

### 1. Data Quality Over Quantity

```python
def validate_training_data(examples: list) -> dict:
    """Validate training data quality."""

    issues = []

    for i, example in enumerate(examples):
        messages = example.get("messages", [])

        # Check structure
        if not messages:
            issues.append(f"Example {i}: No messages")
            continue

        # Check for system message
        has_system = any(m["role"] == "system" for m in messages)
        if not has_system:
            issues.append(f"Example {i}: Missing system message")

        # Check assistant response length
        assistant_msgs = [m for m in messages if m["role"] == "assistant"]
        for msg in assistant_msgs:
            if len(msg["content"]) < 50:
                issues.append(f"Example {i}: Short assistant response")

    return {
        "total_examples": len(examples),
        "issues": issues,
        "valid": len(issues) == 0
    }

validation = validate_training_data(training_data)
if not validation["valid"]:
    print("Issues found:")
    for issue in validation["issues"][:10]:
        print(f"  - {issue}")
```

### 2. Iterative Refinement

```python
# Start small, iterate
iteration_plan = [
    {"examples": 50, "epochs": 1, "purpose": "Quick validation"},
    {"examples": 100, "epochs": 2, "purpose": "Initial training"},
    {"examples": 200, "epochs": 3, "purpose": "Production candidate"},
]

for iteration in iteration_plan:
    print(f"\n=== {iteration['purpose']} ===")
    # Train and evaluate
    # Add more data based on evaluation results
```

Serverless fine-tuning removes the infrastructure barrier to custom model development. Start experimenting with your domain-specific use cases today.

## Resources

- [Serverless Fine-Tuning Guide](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/fine-tuning)
- [Training Data Best Practices](https://platform.openai.com/docs/guides/fine-tuning/preparing-your-dataset)
- [Cost Calculator](https://azure.microsoft.com/en-us/pricing/calculator/)
