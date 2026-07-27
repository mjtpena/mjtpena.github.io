---
title: "GPT-4o Fine-Tuning for Enterprise: A Practical Guide"
author: Michael John Peña
draft: false
date: 2024-11-02
tags:
  - Azure
  - AI
  - GPT-4o
  - Fine-tuning
  - Machine Learning

---

I wrote "GPT-4o Fine-Tuning for Enterprise: A Practical Guide" to share practical, production-minded guidance on this topic.

## When to Fine-Tune GPT-4o

Fine-tuning makes sense when:
- You need consistent formatting or style
- Domain-specific terminology is critical
- You want to reduce prompt length for cost savings
- Specific behaviors need to be learned, not just described

## Preparing Your Training Data

Quality training data is the most important factor:

```python
import json
from typing import List, Dict

def prepare_training_data(examples: List[Dict]) -> str:
    """Convert examples to JSONL format for fine-tuning."""
    formatted_examples = []

    for example in examples:
        formatted = {
            "messages": [
                {
                    "role": "system",
                    "content": "You are a financial analyst assistant specializing in Azure cost optimization."
                },
                {
                    "role": "user",
                    "content": example["question"]
                },
                {
                    "role": "assistant",
                    "content": example["answer"]
                }
            ]
        }
        formatted_examples.append(json.dumps(formatted))

    return "\n".join(formatted_examples)

# Example training data
training_examples = [
    {
        "question": "Our Azure Synapse costs increased 40% this month. What should we check?",
        "answer": """I'll analyze the potential causes systematically:

**Immediate Checks:**
1. **DWU scaling** - Check if auto-scale triggered higher DWU allocations
2. **Query patterns** - Review queries with highest resource consumption
3. **Data movement** - Integration runtime costs from data flows

**SQL Pool Analysis:**
```sql
SELECT
    request_id,
    command,
    resource_class,
    total_elapsed_time_ms / 1000.0 / 60.0 as duration_minutes
FROM sys.dm_pdw_exec_requests
WHERE start_time >= DATEADD(day, -30, GETDATE())
ORDER BY total_elapsed_time_ms DESC;
```

**Recommendations:**
- Enable result set caching for repeated queries
- Consider workload management groups
- Review pause/resume schedules"""
    },
    # Add more examples...
]

training_jsonl = prepare_training_data(training_examples)
with open("training_data.jsonl", "w") as f:
    f.write(training_jsonl)
```

## Uploading and Creating the Fine-Tuning Job

```python
from openai import AzureOpenAI
import time

client = AzureOpenAI(
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    api_version="2024-10-01-preview",
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT")
)

# Upload training file
training_file = client.files.create(
    file=open("training_data.jsonl", "rb"),
    purpose="fine-tune"
)

print(f"Training file ID: {training_file.id}")

# Optional: Upload validation file
validation_file = client.files.create(
    file=open("validation_data.jsonl", "rb"),
    purpose="fine-tune"
)

# Create fine-tuning job
fine_tuning_job = client.fine_tuning.jobs.create(
    training_file=training_file.id,
    validation_file=validation_file.id,
    model="gpt-4o-2024-08-06",
    hyperparameters={
        "n_epochs": 3,
        "batch_size": 4,
        "learning_rate_multiplier": 1.0
    },
    suffix="azure-cost-advisor"
)

print(f"Fine-tuning job ID: {fine_tuning_job.id}")
```

## Monitoring Training Progress

```python
def monitor_fine_tuning(job_id: str):
    """Monitor fine-tuning job progress."""
    while True:
        job = client.fine_tuning.jobs.retrieve(job_id)

        print(f"Status: {job.status}")
        print(f"Trained tokens: {job.trained_tokens}")

        if job.status == "succeeded":
            print(f"Fine-tuned model: {job.fine_tuned_model}")
            return job.fine_tuned_model
        elif job.status == "failed":
            print(f"Error: {job.error}")
            return None

        # Check training metrics
        events = client.fine_tuning.jobs.list_events(job_id, limit=5)
        for event in events.data:
            print(f"  {event.created_at}: {event.message}")

        time.sleep(60)

model_name = monitor_fine_tuning(fine_tuning_job.id)
```

## Deploying the Fine-Tuned Model

```python
from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient
from azure.mgmt.cognitiveservices.models import Deployment, DeploymentProperties, DeploymentModel

# Deploy the fine-tuned model
deployment = Deployment(
    properties=DeploymentProperties(
        model=DeploymentModel(
            format="OpenAI",
            name=model_name,
            version="1"
        ),
        scale_settings={
            "scale_type": "Standard",
            "capacity": 10  # TPM in thousands
        }
    )
)

mgmt_client.deployments.begin_create_or_update(
    resource_group_name="rg-ai-production",
    account_name="aoai-production",
    deployment_name="gpt4o-cost-advisor",
    deployment=deployment
).result()
```

## Using Your Fine-Tuned Model

```python
# Use the fine-tuned model
response = client.chat.completions.create(
    model="gpt4o-cost-advisor",  # Your deployment name
    messages=[
        {"role": "user", "content": "Our Data Factory costs doubled. What's happening?"}
    ],
    max_tokens=500
)

print(response.choices[0].message.content)
```

## Cost Considerations

Fine-tuning costs include:
- **Training**: ~$25 per 1M tokens (GPT-4o)
- **Hosting**: Per-hour cost while deployed
- **Inference**: Higher than base model (~2x)

Calculate ROI based on:
- Reduced prompt tokens (shorter system prompts)
- Improved accuracy (fewer retries)
- Better consistency (less post-processing)

## Best Practices

1. **Start with 50-100 high-quality examples** - Quality over quantity
2. **Include edge cases** - Train for the hard scenarios
3. **Validate on held-out data** - Measure actual improvement
4. **A/B test in production** - Compare against base model
5. **Monitor for drift** - Re-evaluate periodically

Fine-tuning GPT-4o opens new possibilities for enterprise AI. The key is starting with clear objectives and high-quality data.

## Resources

- [Fine-tuning Documentation](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/fine-tuning)
- [Data Preparation Guide](https://platform.openai.com/docs/guides/fine-tuning)
- [Pricing Details](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
