---
title: "Model Distillation: Creating Efficient Specialized Models"
author: Michael John Peña
draft: false
date: 2025-03-26
tags:
  - AI
  - Distillation
  - Optimization
  - Models
  - Efficiency

---

I wrote "Model Distillation: Creating Efficient Specialized Models" to share practical, production-minded guidance on this topic.

## Distillation Pipeline

```python
from azure.ai.openai import AzureOpenAI
import json
from typing import List, Dict

class DistillationPipeline:
    def __init__(self, teacher_client: AzureOpenAI, student_client: AzureOpenAI):
        self.teacher = teacher_client
        self.student = student_client

    async def generate_training_data(
        self,
        prompts: List[str],
        teacher_model: str = "gpt-4o"
    ) -> List[Dict]:
        """Generate training data from teacher model."""
        training_data = []

        for prompt in prompts:
            # Get high-quality response from teacher
            response = await self.teacher.chat.completions.create(
                model=teacher_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0  # Deterministic for consistency
            )

            training_data.append({
                "messages": [
                    {"role": "user", "content": prompt},
                    {"role": "assistant", "content": response.choices[0].message.content}
                ]
            })

        return training_data

    async def generate_reasoning_data(
        self,
        prompts: List[str],
        teacher_model: str = "gpt-4o"
    ) -> List[Dict]:
        """Generate data with reasoning traces for better distillation."""
        training_data = []

        for prompt in prompts:
            # Get reasoning from teacher
            response = await self.teacher.chat.completions.create(
                model=teacher_model,
                messages=[
                    {"role": "system", "content": "Think step by step and show your reasoning."},
                    {"role": "user", "content": prompt}
                ]
            )

            training_data.append({
                "messages": [
                    {"role": "user", "content": prompt},
                    {"role": "assistant", "content": response.choices[0].message.content}
                ]
            })

        return training_data

    async def fine_tune_student(
        self,
        training_data: List[Dict],
        student_model: str = "gpt-4o-mini"
    ) -> str:
        """Fine-tune student model on teacher outputs."""
        # Upload training data
        jsonl = "\n".join([json.dumps(d) for d in training_data])
        file_response = await self.student.files.create(
            file=jsonl.encode(),
            purpose="fine-tune"
        )

        # Create fine-tuning job
        job = await self.student.fine_tuning.jobs.create(
            training_file=file_response.id,
            model=student_model
        )

        return job.id

    async def evaluate_distillation(
        self,
        test_prompts: List[str],
        teacher_model: str,
        student_model: str
    ) -> Dict:
        """Compare teacher and distilled student performance."""
        results = {"teacher": [], "student": []}

        for prompt in test_prompts:
            teacher_response = await self.teacher.chat.completions.create(
                model=teacher_model,
                messages=[{"role": "user", "content": prompt}]
            )

            student_response = await self.student.chat.completions.create(
                model=student_model,
                messages=[{"role": "user", "content": prompt}]
            )

            # Compare quality, latency, cost
            results["teacher"].append(self.evaluate_response(teacher_response))
            results["student"].append(self.evaluate_response(student_response))

        return self.aggregate_results(results)
```

Distillation enables production deployment with 10x cost reduction while maintaining quality.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
