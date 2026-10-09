---
title: "Task-Specific Evaluation for LLMs: Beyond Generic Benchmarks"
description: "Generic benchmarks like MMLU and HumanEval don't predict performance on your specific use cases. This guide covers how to design and implement task-specific…"
author: "Michael John Peña"
draft: false
date: 2024-03-17
tags: ["AI", "LLM", "Evaluation", "Machine Learning", "Testing"]
---

Generic benchmarks like MMLU and HumanEval don't predict performance on your specific use cases. This guide covers how to design and implement task-specific evaluation pipelines.

## Why Task-Specific Evaluation?

```python
from dataclasses import dataclass
from typing import List, Dict, Callable, Any
from enum import Enum

class TaskType(Enum):
    CLASSIFICATION = "classification"
    EXTRACTION = "extraction"
    GENERATION = "generation"
    SUMMARIZATION = "summarization"
    TRANSLATION = "translation"
    QA = "question_answering"
    CHAT = "conversational"

@dataclass
class EvaluationTask:
    name: str
    task_type: TaskType
    description: str
    metrics: List[str]
    sample_size: int

# Define your specific tasks
my_tasks = [
    EvaluationTask(
        name="customer_intent_classification",
        task_type=TaskType.CLASSIFICATION,
        description="Classify customer messages into intent categories",
        metrics=["accuracy", "f1_macro", "confusion_matrix"],
        sample_size=500
    ),
    EvaluationTask(
        name="contract_clause_extraction",
        task_type=TaskType.EXTRACTION,
        description="Extract key clauses from legal contracts",
        metrics=["precision", "recall", "f1", "exact_match"],
        sample_size=200
    ),
    EvaluationTask(
        name="technical_documentation",
        task_type=TaskType.GENERATION,
        description="Generate API documentation from code",
        metrics=["bleu", "rouge_l", "human_rating"],
        sample_size=100
    )
]
```

## Building a Custom Evaluation Framework

```python
import json
from abc import ABC, abstractmethod
from typing import Optional
import anthropic

class TaskEvaluator(ABC):
    """Base class for task-specific evaluators"""

    def __init__(self, task: EvaluationTask):
        self.task = task
        self.results = []

    @abstractmethod
    def prepare_prompt(self, example: dict) -> str:
        """Prepare the prompt for the model"""
        pass

    @abstractmethod
    def parse_response(self, response: str) -> Any:
        """Parse the model's response"""
        pass

    @abstractmethod
    def score(self, prediction: Any, ground_truth: Any) -> Dict[str, float]:
        """Score the prediction against ground truth"""
        pass

    def evaluate(
        self,
        model: str,
        examples: List[dict],
        client: anthropic.Anthropic
    ) -> Dict[str, float]:
        """Run evaluation on all examples"""

        for example in examples:
            prompt = self.prepare_prompt(example)

            response = client.messages.create(
                model=model,
                max_tokens=1000,
                messages=[{"role": "user", "content": prompt}]
            )

            prediction = self.parse_response(response.content[0].text)
            scores = self.score(prediction, example['ground_truth'])

            self.results.append({
                "example_id": example.get('id'),
                "prediction": prediction,
                "ground_truth": example['ground_truth'],
                "scores": scores
            })

        return self.aggregate_scores()

    def aggregate_scores(self) -> Dict[str, float]:
        """Aggregate scores across all examples"""
        if not self.results:
            return {}

        metric_sums = {}
        for result in self.results:
            for metric, value in result['scores'].items():
                metric_sums[metric] = metric_sums.get(metric, 0) + value

        return {
            metric: total / len(self.results)
            for metric, total in metric_sums.items()
        }
```

## Classification Evaluator

```python
from sklearn.metrics import accuracy_score, f1_score, confusion_matrix
import numpy as np

class ClassificationEvaluator(TaskEvaluator):
    def __init__(self, task: EvaluationTask, categories: List[str]):
        super().__init__(task)
        self.categories = categories

    def prepare_prompt(self, example: dict) -> str:
        categories_str = ", ".join(self.categories)
        return f"""Classify the following text into one of these categories: {categories_str}

Text: {example['text']}

Respond with only the category name, nothing else."""

    def parse_response(self, response: str) -> str:
        response = response.strip().lower()
        # Find best matching category
        for cat in self.categories:
            if cat.lower() in response:
                return cat
        return response  # Return as-is if no match

    def score(self, prediction: str, ground_truth: str) -> Dict[str, float]:
        return {
            "correct": 1.0 if prediction.lower() == ground_truth.lower() else 0.0
        }

    def aggregate_scores(self) -> Dict[str, float]:
        predictions = [r['prediction'].lower() for r in self.results]
        ground_truths = [r['ground_truth'].lower() for r in self.results]

        return {
            "accuracy": accuracy_score(ground_truths, predictions),
            "f1_macro": f1_score(ground_truths, predictions, average='macro', zero_division=0),
            "f1_weighted": f1_score(ground_truths, predictions, average='weighted', zero_division=0)
        }

# Usage
intent_evaluator = ClassificationEvaluator(
    task=my_tasks[0],
    categories=["billing", "technical", "sales", "general"]
)
```

## Extraction Evaluator

```python
from typing import Set

class ExtractionEvaluator(TaskEvaluator):
    def __init__(self, task: EvaluationTask, extraction_schema: dict):
        super().__init__(task)
        self.schema = extraction_schema

    def prepare_prompt(self, example: dict) -> str:
        schema_str = json.dumps(self.schema, indent=2)
        return f"""Extract information from the following document according to this schema:

{schema_str}

Document:
{example['document']}

Return a JSON object with the extracted information."""

    def parse_response(self, response: str) -> dict:
        try:
            # Extract JSON from response
            start = response.find('{')
            end = response.rfind('}') + 1
            if start >= 0 and end > start:
                return json.loads(response[start:end])
        except json.JSONDecodeError:
            pass
        return {}

    def score(self, prediction: dict, ground_truth: dict) -> Dict[str, float]:
        # Calculate field-level metrics
        all_fields = set(ground_truth.keys())
        correct_fields = 0
        total_fields = len(all_fields)

        for field in all_fields:
            pred_value = prediction.get(field, "")
            true_value = ground_truth.get(field, "")

            if str(pred_value).strip().lower() == str(true_value).strip().lower():
                correct_fields += 1

        precision = correct_fields / len(prediction) if prediction else 0
        recall = correct_fields / total_fields if total_fields else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

        return {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "exact_match": 1.0 if prediction == ground_truth else 0.0
        }

# Usage
contract_schema = {
    "parties": "List of party names",
    "effective_date": "Contract start date",
    "term_length": "Duration of contract",
    "payment_terms": "Payment conditions",
    "termination_clause": "Conditions for termination"
}

contract_evaluator = ExtractionEvaluator(
    task=my_tasks[1],
    extraction_schema=contract_schema
)
```

## Generation Evaluator with LLM Judge

```python
class GenerationEvaluator(TaskEvaluator):
    def __init__(self, task: EvaluationTask, criteria: List[str]):
        super().__init__(task)
        self.criteria = criteria
        self.judge_client = anthropic.Anthropic()

    def prepare_prompt(self, example: dict) -> str:
        return f"""Generate technical documentation for the following code:

```python
{example['code']}
```

Include:
- Function description
- Parameters with types
- Return value
- Usage example"""

    def parse_response(self, response: str) -> str:
        return response.strip()

    def score(self, prediction: str, ground_truth: str) -> Dict[str, float]:
        # Use LLM as judge
        scores = {}

        for criterion in self.criteria:
            judge_prompt = f"""Rate the following generated documentation on {criterion}.

Reference (ideal):
{ground_truth}

Generated:
{prediction}

Score from 1-5 where:
1 = Very poor
2 = Poor
3 = Acceptable
4 = Good
5 = Excellent

Respond with only the number."""

            response = self.judge_client.messages.create(
                model="claude-3-sonnet-20240229",
                max_tokens=10,
                messages=[{"role": "user", "content": judge_prompt}]
            )

            try:
                score = int(response.content[0].text.strip())
                scores[criterion] = score / 5.0
            except:
                scores[criterion] = 0.5

        return scores

## Usage
doc_evaluator = GenerationEvaluator(
    task=my_tasks[2],
    criteria=["accuracy", "completeness", "clarity", "code_quality"]
)
```

## Running Full Evaluation Suite

```python
class EvaluationSuite:
    def __init__(self, evaluators: List[TaskEvaluator]):
        self.evaluators = evaluators
        self.client = anthropic.Anthropic()

    def run(
        self,
        models: List[str],
        datasets: Dict[str, List[dict]]
    ) -> Dict[str, Dict[str, Dict[str, float]]]:
        """Run all evaluators on all models"""

        results = {}

        for model in models:
            results[model] = {}

            for evaluator in self.evaluators:
                task_name = evaluator.task.name
                examples = datasets.get(task_name, [])

                if examples:
                    scores = evaluator.evaluate(model, examples, self.client)
                    results[model][task_name] = scores

        return results

    def generate_report(self, results: Dict) -> str:
        report = "# Task-Specific Evaluation Report\n\n"

        for model, tasks in results.items():
            report += f"## {model}\n\n"
            for task, scores in tasks.items():
                report += f"### {task}\n"
                for metric, value in scores.items():
                    report += f"- {metric}: {value:.3f}\n"
                report += "\n"

        return report

# Run evaluation
suite = EvaluationSuite([
    intent_evaluator,
    contract_evaluator,
    doc_evaluator
])

# results = suite.run(
#     models=["claude-3-opus-20240229", "claude-3-sonnet-20240229"],
#     datasets=my_datasets
# )
```

## Conclusion

Task-specific evaluation provides actionable insights that generic benchmarks cannot. Invest in building evaluation datasets that reflect your actual use cases and iterate on both your prompts and evaluation criteria.
