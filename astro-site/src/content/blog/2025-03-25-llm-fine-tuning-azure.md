---
title: "LLM Fine-Tuning on Azure: When and How to Customize Models"
author: Michael John Peña
draft: false
date: 2025-03-25
tags:
  - AI
  - Fine-Tuning
  - Azure
  - LLM
  - Customization

---

I wrote "LLM Fine-Tuning on Azure: When and How to Customize Models" to share practical, production-minded guidance on this topic.

## Fine-Tuning on Azure OpenAI

```python
from azure.ai.openai import AzureOpenAI
import json

class FineTuningPipeline:
    def __init__(self, client: AzureOpenAI):
        self.client = client

    def prepare_training_data(self, examples: list[dict]) -> str:
        """Prepare data in JSONL format for fine-tuning."""
        jsonl_lines = []

        for example in examples:
            training_example = {
                "messages": [
                    {"role": "system", "content": example["system"]},
                    {"role": "user", "content": example["user"]},
                    {"role": "assistant", "content": example["assistant"]}
                ]
            }
            jsonl_lines.append(json.dumps(training_example))

        return "\n".join(jsonl_lines)

    async def upload_training_file(self, jsonl_content: str) -> str:
        """Upload training file to Azure."""
        response = await self.client.files.create(
            file=jsonl_content.encode(),
            purpose="fine-tune"
        )
        return response.id

    async def create_fine_tune_job(
        self,
        training_file_id: str,
        model: str = "gpt-4o-mini",
        hyperparameters: dict = None
    ) -> str:
        """Create fine-tuning job."""
        params = hyperparameters or {
            "n_epochs": 3,
            "batch_size": "auto",
            "learning_rate_multiplier": "auto"
        }

        response = await self.client.fine_tuning.jobs.create(
            training_file=training_file_id,
            model=model,
            hyperparameters=params
        )
        return response.id

    async def monitor_job(self, job_id: str) -> dict:
        """Monitor fine-tuning job status."""
        job = await self.client.fine_tuning.jobs.retrieve(job_id)
        return {
            "status": job.status,
            "trained_tokens": job.trained_tokens,
            "fine_tuned_model": job.fine_tuned_model
        }

    async def evaluate_fine_tuned(self, model_id: str, test_cases: list[dict]) -> dict:
        """Evaluate fine-tuned model against test cases."""
        results = []

        for case in test_cases:
            response = await self.client.chat.completions.create(
                model=model_id,
                messages=case["messages"]
            )

            results.append({
                "expected": case["expected"],
                "actual": response.choices[0].message.content,
                "match": self.evaluate_match(case["expected"], response)
            })

        accuracy = sum(r["match"] for r in results) / len(results)
        return {"accuracy": accuracy, "results": results}

# When to fine-tune vs prompt engineering
# Fine-tune when:
# - Consistent style/format needed
# - Domain-specific terminology
# - Cost optimization for high volume
# - Latency requirements (smaller fine-tuned model)
#
# Use prompting when:
# - Limited training data (<100 examples)
# - Rapidly changing requirements
# - Need model flexibility
# - Quick iteration needed
```

Fine-tuning is a powerful tool when used appropriately, but prompt engineering often achieves similar results faster.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
