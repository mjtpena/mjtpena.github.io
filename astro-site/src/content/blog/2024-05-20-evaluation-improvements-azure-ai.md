---
title: "Evaluation Improvements in Azure AI Studio"
author: Michael John Peña
draft: false
date: 2024-05-20
tags:
  - Azure
  - AI Evaluation
  - LLMOps
  - Quality Assurance
  - Azure AI
---

## Why Evaluation Matters

Without proper evaluation:
- Models may hallucinate without detection
- Quality degrades silently over time
- Compliance violations go unnoticed
- User experience suffers

## Evaluation Framework Overview

```
Input Data
    ↓
┌─────────────────────────────────────┐
│         Evaluation Pipeline         │
├─────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────┐ │
│  │Relevance│  │Grounded-│  │Coher│ │
│  │         │  │  ness   │  │ence │ │
│  └────┬────┘  └────┬────┘  └──┬──┘ │
│       │            │          │     │
│  ┌────┴────────────┴──────────┴──┐  │
│  │        Aggregation            │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
    ↓
Quality Metrics & Alerts
```

## Built-in Evaluators

### Relevance Evaluator

Measures if the answer addresses the question:

```python
from azure.ai.evaluation import RelevanceEvaluator

# Configure with model
relevance_eval = RelevanceEvaluator(model_config={
    "azure_endpoint": os.environ["AZURE_OPENAI_ENDPOINT"],
    "api_key": os.environ["AZURE_OPENAI_KEY"],
    "azure_deployment": "gpt-4o",
    "api_version": "2024-05-01-preview"
})

# Single evaluation
result = relevance_eval(
    question="What are the benefits of microservices?",
    answer="Microservices enable independent deployment, scaling, and technology choices."
)

print(f"Relevance score: {result['relevance']}")  # 1-5 scale
print(f"Reason: {result['relevance_reason']}")
```

### Groundedness Evaluator

Checks if the answer is based on provided context:

```python
from azure.ai.evaluation import GroundednessEvaluator

groundedness_eval = GroundednessEvaluator(model_config)

result = groundedness_eval(
    question="What is the company's revenue?",
    answer="The company reported $5 billion in revenue.",
    context="Annual Report 2023: Total revenue was $5 billion, up 15% from 2022."
)

print(f"Groundedness score: {result['groundedness']}")
print(f"Ungrounded statements: {result.get('ungrounded_statements', [])}")
```

### Coherence Evaluator

Assesses logical flow and clarity:

```python
from azure.ai.evaluation import CoherenceEvaluator

coherence_eval = CoherenceEvaluator(model_config)

result = coherence_eval(
    question="Explain cloud computing",
    answer="""Cloud computing delivers computing services over the internet.
    These services include servers, storage, databases, and networking.
    Benefits include scalability, cost efficiency, and global reach."""
)

print(f"Coherence score: {result['coherence']}")
```

### Fluency Evaluator

Measures language quality:

```python
from azure.ai.evaluation import FluencyEvaluator

fluency_eval = FluencyEvaluator(model_config)

result = fluency_eval(
    question="What is AI?",
    answer="Artificial intelligence is the simulation of human intelligence by machines."
)

print(f"Fluency score: {result['fluency']}")
```

## Content Safety Evaluation

```python
from azure.ai.evaluation import ContentSafetyEvaluator

safety_eval = ContentSafetyEvaluator(
    azure_ai_project={
        "subscription_id": os.environ["SUBSCRIPTION_ID"],
        "resource_group_name": os.environ["RESOURCE_GROUP"],
        "project_name": os.environ["PROJECT_NAME"]
    }
)

result = safety_eval(
    question="User input here",
    answer="Model response here"
)

print(f"Violence: {result['violence']}")
print(f"Sexual: {result['sexual']}")
print(f"Self-harm: {result['self_harm']}")
print(f"Hate/Unfairness: {result['hate_unfairness']}")
```

## Batch Evaluation

```python
from azure.ai.evaluation import evaluate

# Prepare evaluation data
eval_data = [
    {
        "question": "What is Azure?",
        "context": "Azure is Microsoft's cloud computing platform.",
        "answer": "Azure is Microsoft's cloud platform offering compute, storage, and more."
    },
    {
        "question": "How does Azure pricing work?",
        "context": "Azure uses pay-as-you-go pricing based on resource consumption.",
        "answer": "You pay for what you use with Azure's consumption-based model."
    }
]

# Run batch evaluation
results = evaluate(
    data=eval_data,
    evaluators={
        "relevance": RelevanceEvaluator(model_config),
        "groundedness": GroundednessEvaluator(model_config),
        "coherence": CoherenceEvaluator(model_config)
    },
    evaluator_config={
        "relevance": {
            "question": "${data.question}",
            "answer": "${data.answer}"
        },
        "groundedness": {
            "question": "${data.question}",
            "answer": "${data.answer}",
            "context": "${data.context}"
        },
        "coherence": {
            "question": "${data.question}",
            "answer": "${data.answer}"
        }
    },
    output_path="./eval_results"
)

# Summary metrics
print(f"Average relevance: {results.metrics['relevance.relevance.mean']:.2f}")
print(f"Average groundedness: {results.metrics['groundedness.groundedness.mean']:.2f}")
print(f"Average coherence: {results.metrics['coherence.coherence.mean']:.2f}")
```

## Custom Evaluators

```python
from azure.ai.evaluation import Evaluator

class DomainAccuracyEvaluator(Evaluator):
    """Custom evaluator for domain-specific accuracy."""

    def __init__(self, knowledge_base: dict):
        self.knowledge_base = knowledge_base

    def __call__(
        self,
        question: str,
        answer: str,
        **kwargs
    ) -> dict:
        # Check for factual accuracy against knowledge base
        facts_mentioned = self._extract_facts(answer)
        correct_facts = 0
        total_facts = len(facts_mentioned)

        for fact in facts_mentioned:
            if self._verify_fact(fact):
                correct_facts += 1

        accuracy = correct_facts / total_facts if total_facts > 0 else 1.0

        return {
            "domain_accuracy": accuracy,
            "facts_checked": total_facts,
            "facts_correct": correct_facts
        }

    def _extract_facts(self, text: str) -> list:
        # Extract factual claims from text
        # This is a simplified example
        return text.split(". ")

    def _verify_fact(self, fact: str) -> bool:
        # Verify against knowledge base
        for key, value in self.knowledge_base.items():
            if key.lower() in fact.lower():
                return value.lower() in fact.lower()
        return True  # Assume true if not in KB

# Use custom evaluator
kb = {"azure regions": "60+ regions worldwide"}
domain_eval = DomainAccuracyEvaluator(kb)

result = domain_eval(
    question="How many Azure regions are there?",
    answer="Azure has 60+ regions worldwide."
)
print(f"Domain accuracy: {result['domain_accuracy']}")
```

## Composite Evaluation

```python
from azure.ai.evaluation import CompositeEvaluator

class RAGEvaluator(CompositeEvaluator):
    """Comprehensive evaluator for RAG applications."""

    def __init__(self, model_config: dict, project_config: dict):
        super().__init__({
            "relevance": RelevanceEvaluator(model_config),
            "groundedness": GroundednessEvaluator(model_config),
            "coherence": CoherenceEvaluator(model_config),
            "fluency": FluencyEvaluator(model_config),
            "safety": ContentSafetyEvaluator(project_config)
        })

    def __call__(self, **kwargs) -> dict:
        results = super().__call__(**kwargs)

        # Calculate composite score
        quality_scores = [
            results.get("relevance", 0),
            results.get("groundedness", 0),
            results.get("coherence", 0),
            results.get("fluency", 0)
        ]

        safety_passed = all(
            results.get(metric, "safe") == "safe"
            for metric in ["violence", "sexual", "self_harm", "hate_unfairness"]
        )

        results["composite_score"] = sum(quality_scores) / len(quality_scores)
        results["safety_passed"] = safety_passed
        results["overall_passed"] = (
            results["composite_score"] >= 3.5 and safety_passed
        )

        return results

# Usage
rag_eval = RAGEvaluator(model_config, project_config)
result = rag_eval(
    question="What is Azure?",
    answer="Azure is Microsoft's cloud platform.",
    context="Azure provides cloud services..."
)
print(f"Overall passed: {result['overall_passed']}")
```

## CI/CD Integration

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - main

stages:
  - stage: Evaluate
    jobs:
      - job: AIEvaluation
        pool:
          vmImage: 'ubuntu-latest'
        steps:
          - task: UsePythonVersion@0
            inputs:
              versionSpec: '3.11'

          - script: |
              pip install azure-ai-evaluation azure-identity
            displayName: 'Install dependencies'

          - script: |
              python run_evaluation.py \
                --data ./test_data.jsonl \
                --output ./results \
                --threshold 3.5
            displayName: 'Run AI Evaluation'
            env:
              AZURE_OPENAI_ENDPOINT: $(AZURE_OPENAI_ENDPOINT)
              AZURE_OPENAI_KEY: $(AZURE_OPENAI_KEY)

          - task: PublishPipelineArtifact@1
            inputs:
              targetPath: './results'
              artifact: 'evaluation-results'

          - script: |
              python check_thresholds.py ./results
            displayName: 'Check Quality Thresholds'
```

```python
# check_thresholds.py
import json
import sys

def check_thresholds(results_path: str, min_score: float = 3.5):
    with open(f"{results_path}/metrics.json") as f:
        metrics = json.load(f)

    failed = []

    if metrics.get("relevance.relevance.mean", 0) < min_score:
        failed.append(f"Relevance: {metrics['relevance.relevance.mean']:.2f}")

    if metrics.get("groundedness.groundedness.mean", 0) < min_score:
        failed.append(f"Groundedness: {metrics['groundedness.groundedness.mean']:.2f}")

    if failed:
        print("Quality thresholds not met:")
        for f in failed:
            print(f"  - {f}")
        sys.exit(1)

    print("All quality thresholds passed!")
    sys.exit(0)

if __name__ == "__main__":
    check_thresholds(sys.argv[1])
```

## Monitoring Over Time

```python
from azure.monitor.ingestion import LogsIngestionClient
from azure.identity import DefaultAzureCredential
from datetime import datetime

class EvaluationMonitor:
    def __init__(self, dcr_endpoint: str, dcr_id: str, stream_name: str):
        self.client = LogsIngestionClient(
            endpoint=dcr_endpoint,
            credential=DefaultAzureCredential()
        )
        self.dcr_id = dcr_id
        self.stream_name = stream_name

    def log_evaluation(self, results: dict, metadata: dict = None):
        """Log evaluation results to Azure Monitor."""
        log_entry = {
            "TimeGenerated": datetime.utcnow().isoformat(),
            "RelevanceScore": results.get("relevance", 0),
            "GroundednessScore": results.get("groundedness", 0),
            "CoherenceScore": results.get("coherence", 0),
            "SafetyPassed": results.get("safety_passed", True),
            "CompositeScore": results.get("composite_score", 0),
            "ModelVersion": metadata.get("model_version", "unknown"),
            "FlowVersion": metadata.get("flow_version", "unknown")
        }

        self.client.upload(
            rule_id=self.dcr_id,
            stream_name=self.stream_name,
            logs=[log_entry]
        )

# Usage
monitor = EvaluationMonitor(dcr_endpoint, dcr_id, stream_name)
monitor.log_evaluation(eval_results, {"model_version": "gpt-4o-2024-05-13"})
```

## Best Practices

1. **Evaluate continuously** - Not just at deployment
2. **Use multiple metrics** - No single metric tells the whole story
3. **Set appropriate thresholds** - Based on your use case
4. **Monitor trends** - Detect gradual degradation
5. **Include safety** - Always evaluate for harmful content

## What's Next

Tomorrow I'll cover tracing and debugging for AI applications.

## Resources

- [Azure AI Evaluation SDK](https://learn.microsoft.com/azure/ai-studio/how-to/evaluate-sdk)
- [Evaluation Best Practices](https://learn.microsoft.com/azure/ai-studio/concepts/evaluation-approach)
- [Safety Evaluations](https://learn.microsoft.com/azure/ai-studio/how-to/evaluate-content-safety)
