---
title: "Azure OpenAI Fine-Tuning: Preview and Patterns"
description: "Fine-tuning is powerful but requires careful data preparation and evaluation. Start with prompt engineering, use RAG when you need sources, and fine-tune…"
author: Michael John Pena
draft: false
date: 2023-03-28
tags:
  - Azure
  - OpenAI
  - AI
  - Fine-Tuning
  - Machine Learning
---

## When to Fine-Tune

Fine-tuning makes sense when:
- You have consistent format requirements
- Prompt engineering doesn't achieve desired quality
- You need to reduce prompt length (save tokens)
- You have domain-specific terminology

Don't fine-tune when:
- Few-shot prompting works well
- You don't have quality training data
- Requirements change frequently
- You need to cite sources (use RAG instead)

## Training Data Preparation

```python
import json
from dataclasses import dataclass
from typing import Optional

@dataclass
class TrainingExample:
    prompt: str
    completion: str
    system_prompt: Optional[str] = None

class FineTuningDataset:
    """Prepare data for fine-tuning."""

    def __init__(self):
        self.examples: list[TrainingExample] = []

    def add_example(
        self,
        prompt: str,
        completion: str,
        system_prompt: str = None
    ):
        """Add a training example."""
        self.examples.append(TrainingExample(
            prompt=prompt,
            completion=completion,
            system_prompt=system_prompt
        ))

    def validate(self) -> dict:
        """Validate dataset for fine-tuning."""
        issues = []

        # Check minimum examples
        if len(self.examples) < 10:
            issues.append(f"Need at least 10 examples, have {len(self.examples)}")

        # Check for duplicates
        prompts = [e.prompt for e in self.examples]
        if len(prompts) != len(set(prompts)):
            issues.append("Dataset contains duplicate prompts")

        # Check completion lengths
        short_completions = sum(1 for e in self.examples if len(e.completion) < 10)
        if short_completions > len(self.examples) * 0.2:
            issues.append(f"{short_completions} examples have very short completions")

        # Check for empty values
        empty = sum(1 for e in self.examples if not e.prompt or not e.completion)
        if empty > 0:
            issues.append(f"{empty} examples have empty prompt or completion")

        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "stats": {
                "total_examples": len(self.examples),
                "avg_prompt_length": sum(len(e.prompt) for e in self.examples) / len(self.examples),
                "avg_completion_length": sum(len(e.completion) for e in self.examples) / len(self.examples)
            }
        }

    def export_jsonl(self, path: str, format: str = "chat"):
        """Export to JSONL format for Azure OpenAI."""
        with open(path, 'w') as f:
            for example in self.examples:
                if format == "chat":
                    # Chat format for GPT-3.5-turbo fine-tuning
                    messages = []
                    if example.system_prompt:
                        messages.append({"role": "system", "content": example.system_prompt})
                    messages.append({"role": "user", "content": example.prompt})
                    messages.append({"role": "assistant", "content": example.completion})

                    f.write(json.dumps({"messages": messages}) + "\n")
                else:
                    # Completion format for davinci
                    f.write(json.dumps({
                        "prompt": example.prompt,
                        "completion": example.completion
                    }) + "\n")

    @classmethod
    def from_conversations(cls, conversations: list[dict]) -> "FineTuningDataset":
        """Create dataset from conversation logs."""
        dataset = cls()

        for conv in conversations:
            # Extract user query and assistant response
            messages = conv.get("messages", [])
            user_msg = next((m for m in messages if m["role"] == "user"), None)
            asst_msg = next((m for m in messages if m["role"] == "assistant"), None)

            if user_msg and asst_msg:
                dataset.add_example(
                    prompt=user_msg["content"],
                    completion=asst_msg["content"]
                )

        return dataset
```

## Data Quality Improvement

```python
class DataQualityEnhancer:
    """Improve training data quality."""

    def __init__(self, client):
        self.client = client

    async def enhance_example(
        self,
        example: TrainingExample,
        guidelines: str
    ) -> TrainingExample:
        """Improve a single training example."""

        prompt = f"""Improve this training example to better match the guidelines.

Guidelines:
{guidelines}

Original Example:
Prompt: {example.prompt}
Completion: {example.completion}

Provide improved versions that:
1. Make the completion more consistent with guidelines
2. Add detail if too brief
3. Fix any errors

Return JSON: {{"prompt": "...", "completion": "..."}}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3
        )

        try:
            improved = json.loads(response.content)
            return TrainingExample(
                prompt=improved["prompt"],
                completion=improved["completion"]
            )
        except:
            return example

    async def generate_variations(
        self,
        example: TrainingExample,
        num_variations: int = 3
    ) -> list[TrainingExample]:
        """Generate variations of an example for data augmentation."""

        prompt = f"""Generate {num_variations} variations of this training example.
Vary the phrasing while keeping the same meaning.

Original:
Prompt: {example.prompt}
Completion: {example.completion}

Return JSON array: [{{"prompt": "...", "completion": "..."}}, ...]"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7
        )

        try:
            variations = json.loads(response.content)
            return [TrainingExample(v["prompt"], v["completion"]) for v in variations]
        except:
            return []

    async def filter_quality(
        self,
        examples: list[TrainingExample],
        quality_threshold: float = 0.7
    ) -> list[TrainingExample]:
        """Filter examples by quality score."""

        scored = []
        for example in examples:
            score = await self._score_example(example)
            if score >= quality_threshold:
                scored.append(example)

        return scored

    async def _score_example(self, example: TrainingExample) -> float:
        """Score example quality 0-1."""
        prompt = f"""Rate the quality of this training example from 0 to 1.

Consider:
- Clarity of the prompt
- Completeness of the completion
- Consistency and correctness

Prompt: {example.prompt}
Completion: {example.completion}

Return only a number between 0 and 1."""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        try:
            return float(response.content.strip())
        except:
            return 0.5
```

## Fine-Tuning Process

```python
from azure.ai.ml import MLClient
from azure.identity import DefaultAzureCredential

class AzureFineTuningManager:
    """Manage Azure OpenAI fine-tuning jobs."""

    def __init__(self, subscription_id: str, resource_group: str, workspace: str):
        self.credential = DefaultAzureCredential()
        # Note: API may change as feature moves from preview to GA

    async def upload_training_data(
        self,
        dataset: FineTuningDataset,
        purpose: str = "fine-tune"
    ) -> str:
        """Upload training data to Azure OpenAI."""

        # Export to temp file
        import tempfile
        with tempfile.NamedTemporaryFile(suffix='.jsonl', delete=False) as f:
            dataset.export_jsonl(f.name)
            temp_path = f.name

        # Upload via Azure OpenAI API
        # Actual implementation depends on Azure OpenAI SDK
        # This is conceptual

        return "file-id"

    async def create_fine_tune_job(
        self,
        training_file_id: str,
        model: str = "gpt-35-turbo",
        hyperparameters: dict = None
    ) -> dict:
        """Create a fine-tuning job."""

        default_hyperparameters = {
            "n_epochs": 3,
            "batch_size": 4,
            "learning_rate_multiplier": 0.1
        }

        params = {**default_hyperparameters, **(hyperparameters or {})}

        # Submit fine-tuning job
        job = {
            "training_file": training_file_id,
            "model": model,
            "hyperparameters": params
        }

        # Return job details
        return {"job_id": "ft-job-xxx", "status": "pending", "model": model}

    async def monitor_job(self, job_id: str) -> dict:
        """Monitor fine-tuning job progress."""
        # Poll job status
        # Return progress metrics
        return {
            "status": "running",
            "progress": 0.5,
            "metrics": {
                "training_loss": 0.25,
                "validation_loss": 0.28
            }
        }
```

## Evaluation Framework

```python
class FineTunedModelEvaluator:
    """Evaluate fine-tuned models."""

    def __init__(self, client):
        self.client = client

    async def evaluate(
        self,
        base_model: str,
        fine_tuned_model: str,
        test_examples: list[TrainingExample]
    ) -> dict:
        """Compare base vs fine-tuned model."""

        results = {
            "base_model": {"correct": 0, "total": 0, "responses": []},
            "fine_tuned": {"correct": 0, "total": 0, "responses": []}
        }

        for example in test_examples:
            # Test base model
            base_response = await self._get_response(base_model, example.prompt)
            base_score = await self._score_response(base_response, example.completion)
            results["base_model"]["responses"].append({
                "prompt": example.prompt,
                "expected": example.completion,
                "actual": base_response,
                "score": base_score
            })
            results["base_model"]["total"] += 1
            if base_score > 0.8:
                results["base_model"]["correct"] += 1

            # Test fine-tuned model
            ft_response = await self._get_response(fine_tuned_model, example.prompt)
            ft_score = await self._score_response(ft_response, example.completion)
            results["fine_tuned"]["responses"].append({
                "prompt": example.prompt,
                "expected": example.completion,
                "actual": ft_response,
                "score": ft_score
            })
            results["fine_tuned"]["total"] += 1
            if ft_score > 0.8:
                results["fine_tuned"]["correct"] += 1

        # Calculate summary stats
        for model in ["base_model", "fine_tuned"]:
            r = results[model]
            r["accuracy"] = r["correct"] / r["total"] if r["total"] > 0 else 0
            r["avg_score"] = sum(x["score"] for x in r["responses"]) / len(r["responses"])

        results["improvement"] = (
            results["fine_tuned"]["accuracy"] - results["base_model"]["accuracy"]
        )

        return results

    async def _score_response(
        self,
        actual: str,
        expected: str
    ) -> float:
        """Score response against expected."""
        prompt = f"""Score how well the actual response matches the expected response.
Return a number from 0 to 1.

Expected: {expected}
Actual: {actual}

Score:"""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        try:
            return float(response.content.strip())
        except:
            return 0.5
```

## Best Practices

1. **Start with at least 50-100 high-quality examples**
2. **Ensure diversity in training data**
3. **Include edge cases**
4. **Validate data quality before training**
5. **Use held-out test set for evaluation**
6. **Monitor training metrics for overfitting**
7. **Compare against base model systematically**

Fine-tuning is powerful but requires careful data preparation and evaluation. Start with prompt engineering, use RAG when you need sources, and fine-tune when you need consistent, formatted outputs.
