---
title: "Model Fine-Tuning on Azure: When and How to Customize LLMs"
author: Michael John Peña
draft: false
date: 2025-11-14
tags:
  - Fine-tuning
  - Azure OpenAI
  - Machine Learning
  - LLM
  - Customization

---

I wrote "Model Fine-Tuning on Azure: When and How to Customize LLMs" to share practical, production-minded guidance on this topic.

## When to Fine-Tune

Fine-tuning makes sense when you need consistent style, specialized terminology, or improved performance on specific tasks that prompt engineering cannot achieve effectively.

## Preparing Training Data

Quality training data is the most important factor in fine-tuning success:

```python
import json
from typing import Generator

def prepare_fine_tuning_data(
    examples: list[dict],
    system_prompt: str
) -> Generator[dict, None, None]:
    """Convert examples to OpenAI fine-tuning format."""
    for example in examples:
        yield {
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": example["input"]},
                {"role": "assistant", "content": example["output"]}
            ]
        }

def validate_training_file(file_path: str) -> dict:
    """Validate training data format and quality."""
    issues = []
    examples = []

    with open(file_path, 'r') as f:
        for line_num, line in enumerate(f, 1):
            try:
                data = json.loads(line)
                examples.append(data)

                # Validate structure
                if "messages" not in data:
                    issues.append(f"Line {line_num}: Missing 'messages' key")
                    continue

                messages = data["messages"]
                roles = [m.get("role") for m in messages]

                # Must have system, user, assistant sequence
                if roles != ["system", "user", "assistant"]:
                    issues.append(f"Line {line_num}: Invalid role sequence {roles}")

                # Check content length
                for msg in messages:
                    if len(msg.get("content", "")) < 10:
                        issues.append(f"Line {line_num}: Very short content in {msg['role']}")

            except json.JSONDecodeError as e:
                issues.append(f"Line {line_num}: Invalid JSON - {e}")

    return {
        "total_examples": len(examples),
        "issues": issues,
        "valid": len(issues) == 0
    }

# Create training data
system_prompt = """You are a technical support assistant for Contoso software products.
Provide accurate, helpful responses using proper technical terminology.
Always include relevant documentation links when applicable."""

training_examples = [
    {
        "input": "How do I reset my password?",
        "output": "To reset your password in Contoso Suite:\n\n1. Click 'Forgot Password' on the login screen\n2. Enter your registered email address\n3. Check your email for the reset link (valid for 24 hours)\n4. Create a new password meeting security requirements\n\nFor more details, see: docs.contoso.com/password-reset"
    },
    # Add more examples...
]

# Write to JSONL file
with open("training_data.jsonl", "w") as f:
    for record in prepare_fine_tuning_data(training_examples, system_prompt):
        f.write(json.dumps(record) + "\n")
```

## Starting Fine-Tuning on Azure

Upload data and initiate the fine-tuning job:

```python
from openai import AzureOpenAI

client = AzureOpenAI(
    api_version="2024-08-01-preview",
    azure_endpoint="https://your-resource.openai.azure.com/"
)

# Upload training file
with open("training_data.jsonl", "rb") as f:
    training_file = client.files.create(file=f, purpose="fine-tune")

# Create fine-tuning job
job = client.fine_tuning.jobs.create(
    training_file=training_file.id,
    model="gpt-4o-mini-2024-07-18",  # Base model
    hyperparameters={
        "n_epochs": 3,
        "batch_size": 4,
        "learning_rate_multiplier": 1.0
    },
    suffix="contoso-support"  # Custom model name suffix
)

# Monitor progress
while True:
    status = client.fine_tuning.jobs.retrieve(job.id)
    print(f"Status: {status.status}")

    if status.status in ["succeeded", "failed", "cancelled"]:
        break

    time.sleep(60)

# Deploy fine-tuned model
print(f"Fine-tuned model: {status.fine_tuned_model}")
```

## Evaluating Fine-Tuned Models

Compare fine-tuned model performance against the base model:

```python
def evaluate_model(model_name: str, test_cases: list[dict]) -> dict:
    """Evaluate model on test cases."""
    scores = []

    for test in test_cases:
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": test["input"]}
            ]
        )

        # Score response quality
        score = calculate_similarity(
            response.choices[0].message.content,
            test["expected_output"]
        )
        scores.append(score)

    return {
        "model": model_name,
        "average_score": sum(scores) / len(scores),
        "min_score": min(scores),
        "max_score": max(scores)
    }
```

Fine-tuning is a powerful tool but requires careful data preparation and evaluation. Start with prompt engineering and only fine-tune when you have clear evidence of improvement needs and sufficient quality training data.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
