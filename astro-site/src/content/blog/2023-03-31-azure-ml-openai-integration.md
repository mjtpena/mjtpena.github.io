---
title: "Integrating Azure Machine Learning with Azure OpenAI"
author: Michael John Pena
draft: false
date: 2023-03-31
tags:
  - Azure
  - OpenAI
  - AI
  - Machine Learning
  - MLOps

---

I wrote "Integrating Azure Machine Learning with Azure OpenAI" to share practical, production-minded guidance on this topic.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Azure Machine Learning                     │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │   Data   │  │ Feature  │  │  Model   │  │ Deploy   │    │
│  │  Prep    │→ │  Store   │→ │ Training │→ │ Endpoint │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│        │              │             │             │          │
│        ▼              ▼             ▼             ▼          │
│  ┌───────────────────────────────────────────────────┐     │
│  │              Azure OpenAI Service                  │     │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐        │     │
│  │  │Embeddings│  │   GPT    │  │  Fine-   │        │     │
│  │  │          │  │  Models  │  │  Tuned   │        │     │
│  │  └──────────┘  └──────────┘  └──────────┘        │     │
│  └───────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## Setting Up the Integration

```python
from azure.ai.ml import MLClient
from azure.identity import DefaultAzureCredential
import openai

class AzureMLOpenAIIntegration:
    """Integrate Azure ML with Azure OpenAI."""

    def __init__(
        self,
        subscription_id: str,
        resource_group: str,
        workspace_name: str,
        openai_endpoint: str,
        openai_key: str
    ):
        # Azure ML client
        self.ml_client = MLClient(
            DefaultAzureCredential(),
            subscription_id,
            resource_group,
            workspace_name
        )

        # Azure OpenAI configuration
        openai.api_type = "azure"
        openai.api_base = openai_endpoint
        openai.api_key = openai_key
        openai.api_version = "2023-03-15-preview"

    def get_ml_workspace(self):
        """Get ML workspace details."""
        return self.ml_client.workspaces.get(self.workspace_name)
```

## Pattern 1: Embeddings in ML Pipelines

Use Azure OpenAI embeddings within Azure ML data processing:

```python
from azure.ai.ml import command, Input, Output
from azure.ai.ml.entities import Environment
import pandas as pd

# Custom environment with OpenAI SDK
embedding_env = Environment(
    name="openai-embedding-env",
    conda_file="conda.yaml",
    image="mcr.microsoft.com/azureml/openmpi4.1.0-ubuntu20.04"
)

# Embedding generation script
EMBEDDING_SCRIPT = """
import argparse
import pandas as pd
import openai
import json
import os

def get_embeddings(texts, model="text-embedding-ada-002"):
    embeddings = []
    for i in range(0, len(texts), 100):  # Batch
        batch = texts[i:i+100]
        response = openai.Embedding.create(
            input=batch,
            engine=model
        )
        batch_embeddings = [r['embedding'] for r in response['data']]
        embeddings.extend(batch_embeddings)
    return embeddings

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input_data', type=str)
    parser.add_argument('--output_data', type=str)
    parser.add_argument('--text_column', type=str, default='text')
    args = parser.parse_args()

    # Configure OpenAI
    openai.api_type = "azure"
    openai.api_base = os.environ['OPENAI_ENDPOINT']
    openai.api_key = os.environ['OPENAI_KEY']
    openai.api_version = "2023-03-15-preview"

    # Load data
    df = pd.read_parquet(args.input_data)

    # Generate embeddings
    texts = df[args.text_column].tolist()
    embeddings = get_embeddings(texts)

    # Add to dataframe
    df['embedding'] = embeddings

    # Save
    df.to_parquet(args.output_data)

if __name__ == '__main__':
    main()
"""

# Create Azure ML job
def create_embedding_job(
    ml_client,
    input_data_path: str,
    output_data_path: str,
    compute_name: str
):
    """Create embedding generation job."""

    from azure.ai.ml import command

    embedding_job = command(
        code="./src",
        command="python embed.py --input_data ${{inputs.input_data}} --output_data ${{outputs.output_data}}",
        inputs={
            "input_data": Input(type="uri_file", path=input_data_path)
        },
        outputs={
            "output_data": Output(type="uri_file", path=output_data_path)
        },
        environment=embedding_env,
        compute=compute_name,
        environment_variables={
            "OPENAI_ENDPOINT": "${{secrets.OPENAI_ENDPOINT}}",
            "OPENAI_KEY": "${{secrets.OPENAI_KEY}}"
        }
    )

    return ml_client.jobs.create_or_update(embedding_job)
```

## Pattern 2: LLM-Enhanced Feature Engineering

```python
class LLMFeatureEngineer:
    """Use LLMs for feature engineering in ML pipelines."""

    def __init__(self, client):
        self.client = client

    async def extract_features(
        self,
        text: str,
        feature_schema: dict
    ) -> dict:
        """Extract structured features from text."""

        schema_str = json.dumps(feature_schema, indent=2)

        prompt = f"""Extract features from this text according to the schema.

Schema:
{schema_str}

Text:
{text}

Return JSON matching the schema exactly."""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        try:
            return json.loads(response.content)
        except:
            return {}

    async def generate_synthetic_features(
        self,
        row: dict,
        feature_descriptions: dict
    ) -> dict:
        """Generate synthetic features using LLM."""

        row_str = json.dumps(row, indent=2)
        features_str = json.dumps(feature_descriptions, indent=2)

        prompt = f"""Based on this data row, generate the described features.

Data Row:
{row_str}

Features to Generate:
{features_str}

Return JSON with generated feature values."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1
        )

        try:
            return json.loads(response.content)
        except:
            return {}

# Azure ML component for LLM feature engineering
def create_llm_feature_component():
    """Create Azure ML component for LLM features."""

    from azure.ai.ml import command
    from azure.ai.ml.entities import CommandComponent

    return CommandComponent(
        name="llm_feature_extraction",
        display_name="LLM Feature Extraction",
        description="Extract features using Azure OpenAI",
        inputs={
            "input_data": {"type": "uri_folder"},
            "feature_schema": {"type": "uri_file"}
        },
        outputs={
            "output_data": {"type": "uri_folder"}
        },
        code="./components/llm_features",
        command="python extract_features.py --input ${{inputs.input_data}} --schema ${{inputs.feature_schema}} --output ${{outputs.output_data}}",
        environment=embedding_env
    )
```

## Pattern 3: Hybrid ML + LLM Pipeline

```python
from azure.ai.ml import dsl, Input, Output

@dsl.pipeline(
    name="hybrid_ml_llm_pipeline",
    description="Pipeline combining traditional ML with LLM"
)
def create_hybrid_pipeline(
    raw_data: Input,
    model_name: str = "hybrid_classifier"
):
    """Create hybrid ML + LLM pipeline."""

    # Step 1: Data preprocessing (traditional)
    preprocess_step = preprocess_component(
        input_data=raw_data
    )

    # Step 2: Generate embeddings (Azure OpenAI)
    embedding_step = embedding_component(
        input_data=preprocess_step.outputs.processed_data
    )

    # Step 3: Extract LLM features (Azure OpenAI)
    llm_features_step = llm_feature_component(
        input_data=preprocess_step.outputs.processed_data
    )

    # Step 4: Combine features
    combine_step = combine_features_component(
        embeddings=embedding_step.outputs.embeddings,
        llm_features=llm_features_step.outputs.features,
        tabular_features=preprocess_step.outputs.features
    )

    # Step 5: Train ML model
    train_step = train_model_component(
        training_data=combine_step.outputs.combined_features,
        model_name=model_name
    )

    # Step 6: Evaluate
    eval_step = evaluate_component(
        model=train_step.outputs.model,
        test_data=combine_step.outputs.test_features
    )

    return {
        "model": train_step.outputs.model,
        "metrics": eval_step.outputs.metrics
    }
```

## Pattern 4: LLM Model Evaluation

```python
class LLMModelEvaluator:
    """Evaluate models using LLM-based metrics."""

    async def evaluate_with_llm(
        self,
        predictions: list[dict],
        ground_truth: list[dict],
        criteria: list[str]
    ) -> dict:
        """Evaluate predictions using LLM judgment."""

        results = []
        for pred, truth in zip(predictions, ground_truth):
            eval_result = await self._evaluate_single(pred, truth, criteria)
            results.append(eval_result)

        # Aggregate
        aggregated = {}
        for criterion in criteria:
            scores = [r.get(criterion, 0) for r in results]
            aggregated[criterion] = {
                "mean": sum(scores) / len(scores),
                "min": min(scores),
                "max": max(scores)
            }

        return aggregated

    async def _evaluate_single(
        self,
        prediction: dict,
        ground_truth: dict,
        criteria: list[str]
    ) -> dict:
        """Evaluate single prediction."""

        criteria_str = "\n".join(f"- {c}" for c in criteria)

        prompt = f"""Evaluate this prediction against the ground truth.

Ground Truth:
{json.dumps(ground_truth, indent=2)}

Prediction:
{json.dumps(prediction, indent=2)}

Rate each criterion from 0 to 1:
{criteria_str}

Return JSON: {{"criterion_name": score, ...}}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        try:
            return json.loads(response.content)
        except:
            return {c: 0.5 for c in criteria}
```

## Pattern 5: Prompt Templates as ML Artifacts

```python
from azure.ai.ml.entities import Model
import yaml

class PromptTemplateManager:
    """Manage prompts as Azure ML artifacts."""

    def __init__(self, ml_client):
        self.ml_client = ml_client

    def register_prompt(
        self,
        name: str,
        version: str,
        template: dict
    ) -> Model:
        """Register prompt template as ML model artifact."""

        # Save template
        template_path = f"prompts/{name}_{version}.yaml"
        with open(template_path, 'w') as f:
            yaml.dump(template, f)

        # Register as model
        model = Model(
            name=name,
            version=version,
            path=template_path,
            type="custom_model",
            description="LLM Prompt Template",
            tags={
                "type": "prompt_template",
                "model": template.get("model", "unknown"),
                "task": template.get("task", "unknown")
            }
        )

        return self.ml_client.models.create_or_update(model)

    def get_prompt(self, name: str, version: str = None) -> dict:
        """Get prompt template."""
        if version:
            model = self.ml_client.models.get(name, version)
        else:
            model = self.ml_client.models.get(name, label="latest")

        # Download and load
        download_path = self.ml_client.models.download(
            name=model.name,
            version=model.version
        )

        with open(download_path) as f:
            return yaml.safe_load(f)
```

## Best Practices

1. **Use Azure ML for orchestration** - Pipelines, scheduling, monitoring
2. **Store embeddings efficiently** - Use feature store or vector DB
3. **Version prompts as artifacts** - Track changes with model registry
4. **Combine model types** - Traditional ML + embeddings + LLM features
5. **Monitor token usage** - Track costs in pipeline runs
6. **Cache embeddings** - Don't regenerate unnecessarily

The combination of Azure ML's operational capabilities with Azure OpenAI's language understanding creates powerful, production-ready AI systems.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
