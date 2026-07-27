---
title: "Fine-Tuning Azure OpenAI Models: When and How to Customize"
author: Michael John Peña
draft: false
date: 2025-10-13
tags:
  - Azure OpenAI
  - Fine-Tuning
  - LLM
  - Machine Learning
  - Customization

---

I wrote "Fine-Tuning Azure OpenAI Models: When and How to Customize" to share practical, production-minded guidance on this topic.

## When to Consider Fine-Tuning

Fine-tuning is appropriate when you need consistent formatting, domain-specific language understanding, or reduced prompt lengths. However, it requires significant data preparation and ongoing maintenance.

## Preparing Training Data

Structure your training data in the required JSONL format:

```python
import json
from dataclasses import dataclass
from typing import List
import random

@dataclass
class TrainingExample:
    system_prompt: str
    user_message: str
    assistant_response: str

class TrainingDataPreparer:
    def __init__(self, examples: List[TrainingExample]):
        self.examples = examples

    def to_jsonl(self, output_path: str, validation_split: float = 0.2):
        """Convert examples to fine-tuning format with train/validation split."""

        random.shuffle(self.examples)
        split_idx = int(len(self.examples) * (1 - validation_split))

        train_examples = self.examples[:split_idx]
        val_examples = self.examples[split_idx:]

        self._write_jsonl(f"{output_path}_train.jsonl", train_examples)
        self._write_jsonl(f"{output_path}_val.jsonl", val_examples)

        return {
            "train_count": len(train_examples),
            "validation_count": len(val_examples)
        }

    def _write_jsonl(self, path: str, examples: List[TrainingExample]):
        with open(path, 'w') as f:
            for example in examples:
                line = {
                    "messages": [
                        {"role": "system", "content": example.system_prompt},
                        {"role": "user", "content": example.user_message},
                        {"role": "assistant", "content": example.assistant_response}
                    ]
                }
                f.write(json.dumps(line) + '\n')

    def validate_examples(self) -> dict:
        """Validate training data quality."""
        issues = []

        for i, ex in enumerate(self.examples):
            if len(ex.assistant_response) < 10:
                issues.append(f"Example {i}: Response too short")
            if len(ex.user_message) < 5:
                issues.append(f"Example {i}: User message too short")

        return {"valid": len(issues) == 0, "issues": issues}
```

## Creating Fine-Tuning Jobs

Submit and monitor fine-tuning jobs via the API:

```python
from openai import AzureOpenAI

class FineTuningManager:
    def __init__(self, client: AzureOpenAI):
        self.client = client

    def create_fine_tuning_job(
        self,
        training_file_id: str,
        validation_file_id: str,
        model: str = "gpt-4o-mini-2024-07-18",
        hyperparameters: dict = None
    ) -> str:
        """Create a fine-tuning job."""

        job = self.client.fine_tuning.jobs.create(
            training_file=training_file_id,
            validation_file=validation_file_id,
            model=model,
            hyperparameters=hyperparameters or {"n_epochs": 3, "batch_size": 4, "learning_rate_multiplier": 1.0}
        )

        return job.id

    def monitor_job(self, job_id: str) -> dict:
        """Check fine-tuning job status."""
        job = self.client.fine_tuning.jobs.retrieve(job_id)
        return {"status": job.status, "fine_tuned_model": job.fine_tuned_model, "trained_tokens": job.trained_tokens}
```

## Evaluating Fine-Tuned Models

Always compare fine-tuned models against base models with optimized prompts to ensure the fine-tuning investment delivers measurable improvements.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
