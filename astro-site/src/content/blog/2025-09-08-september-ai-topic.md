---
title: "Fine-Tuning GPT Models: When and How to Customize"
author: Michael John Peña
draft: false
date: 2025-09-08
tags:
  - Fine-Tuning
  - GPT
  - Azure OpenAI
  - LLM
  - Customization

---

I wrote "Fine-Tuning GPT Models: When and How to Customize" to share practical, production-minded guidance on this topic.

## When to Fine-Tune

Fine-tuning makes sense when you need consistent formatting, domain-specific terminology, or significant behavior changes that prompting cannot achieve reliably.

## Preparing Training Data

```python
import json
from typing import List, Dict
from dataclasses import dataclass
import tiktoken

@dataclass
class TrainingExample:
    system: str
    user: str
    assistant: str

def prepare_training_file(examples: List[TrainingExample],
                          output_path: str) -> Dict[str, int]:
    """Prepare JSONL file for fine-tuning with validation."""

    encoding = tiktoken.encoding_for_model("gpt-4o")
    stats = {"total_examples": 0, "total_tokens": 0, "errors": []}

    with open(output_path, 'w') as f:
        for i, example in enumerate(examples):
            # Validate example
            if not example.user or not example.assistant:
                stats["errors"].append(f"Example {i}: Missing required fields")
                continue

            message = {
                "messages": [
                    {"role": "system", "content": example.system},
                    {"role": "user", "content": example.user},
                    {"role": "assistant", "content": example.assistant}
                ]
            }

            # Count tokens
            text = json.dumps(message)
            tokens = len(encoding.encode(text))

            if tokens > 16000:
                stats["errors"].append(f"Example {i}: Exceeds token limit ({tokens})")
                continue

            f.write(json.dumps(message) + '\n')
            stats["total_examples"] += 1
            stats["total_tokens"] += tokens

    return stats

# Example usage
examples = [
    TrainingExample(
        system="You are a legal document analyst. Extract key terms precisely.",
        user="Analyze this contract clause: 'The indemnifying party shall...'",
        assistant="**Key Terms Extracted:**\n- Indemnifying Party: [Party A]\n- Obligation: Hold harmless..."
    ),
    # Add hundreds more examples...
]

stats = prepare_training_file(examples, "training_data.jsonl")
print(f"Prepared {stats['total_examples']} examples, {stats['total_tokens']} total tokens")
```

## Launching Fine-Tuning in Azure

```python
from openai import AzureOpenAI
import time

client = AzureOpenAI(
    api_key=os.environ["AZURE_OPENAI_KEY"],
    api_version="2024-06-01",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"]
)

# Upload training file
with open("training_data.jsonl", "rb") as f:
    training_file = client.files.create(file=f, purpose="fine-tune")

# Create fine-tuning job
job = client.fine_tuning.jobs.create(
    training_file=training_file.id,
    model="gpt-4o-mini",
    hyperparameters={
        "n_epochs": 3,
        "learning_rate_multiplier": 0.1
    }
)

print(f"Fine-tuning job created: {job.id}")
```

## Evaluation is Critical

Always hold out a test set. Compare fine-tuned model performance against the base model with good prompts. Sometimes prompt engineering achieves 90% of the benefit at 10% of the cost.

Fine-tuning is a powerful tool, but use it judiciously. Start with prompting, and only fine-tune when you have clear evidence it will provide meaningful improvement.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
