---
title: "Building Reusable Components in Azure ML"
author: "Michael John Peña"
draft: false
date: 2022-08-18
tags: ["Azure", "Machine Learning", "Components", "MLOps", "Reusability"]

---

I wrote "Building Reusable Components in Azure ML" to share practical, production-minded guidance on this topic.

## Component Anatomy

```python
from azure.ai.ml import command, Input, Output
from azure.ai.ml.entities import Environment

# Define a component using Python SDK
data_cleaning_component = command(
    name="data_cleaning",
    version="1.0.0",
    display_name="Data Cleaning Component",
    description="Cleans and validates input data",
    inputs={
        "input_data": Input(type="uri_file", description="Raw input data"),
        "null_threshold": Input(type="number", default=0.3, description="Max null ratio allowed"),
        "remove_duplicates": Input(type="boolean", default=True)
    },
    outputs={
        "cleaned_data": Output(type="uri_file", description="Cleaned output data"),
        "quality_report": Output(type="uri_file", description="Data quality report")
    },
    code="./components/data_cleaning",
    command="""python clean.py \
        --input ${{inputs.input_data}} \
        --null-threshold ${{inputs.null_threshold}} \
        --remove-duplicates ${{inputs.remove_duplicates}} \
        --output ${{outputs.cleaned_data}} \
        --report ${{outputs.quality_report}}""",
    environment=Environment(
        image="mcr.microsoft.com/azureml/openmpi4.1.0-ubuntu20.04:latest",
        conda_file="./components/data_cleaning/conda.yaml"
    ),
    is_deterministic=True
)

# Register the component
ml_client.components.create_or_update(data_cleaning_component)
```

## Component Script

```python
# components/data_cleaning/clean.py
import argparse
import pandas as pd
import json
from pathlib import Path

def clean_data(
    input_path: str,
    output_path: str,
    report_path: str,
    null_threshold: float,
    remove_duplicates: bool
):
    """Clean the input data"""
    df = pd.read_csv(input_path)

    quality_report = {
        "original_rows": len(df),
        "original_columns": len(df.columns),
        "issues_found": []
    }

    # Remove columns with too many nulls
    null_ratios = df.isnull().mean()
    cols_to_drop = null_ratios[null_ratios > null_threshold].index.tolist()

    if cols_to_drop:
        df = df.drop(columns=cols_to_drop)
        quality_report["issues_found"].append({
            "type": "high_null_columns",
            "columns": cols_to_drop
        })

    # Remove duplicates
    if remove_duplicates:
        dup_count = df.duplicated().sum()
        if dup_count > 0:
            df = df.drop_duplicates()
            quality_report["issues_found"].append({
                "type": "duplicates",
                "count": int(dup_count)
            })

    # Fill remaining nulls
    for col in df.columns:
        if df[col].dtype in ['int64', 'float64']:
            df[col] = df[col].fillna(df[col].median())
        else:
            df[col] = df[col].fillna(df[col].mode().iloc[0])

    quality_report["final_rows"] = len(df)
    quality_report["final_columns"] = len(df.columns)

    # Save outputs
    df.to_csv(output_path, index=False)

    with open(report_path, 'w') as f:
        json.dump(quality_report, f, indent=2)

    print(f"Cleaned data: {quality_report['original_rows']} -> {quality_report['final_rows']} rows")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--null-threshold", type=float, default=0.3)
    parser.add_argument("--remove-duplicates", type=bool, default=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)

    args = parser.parse_args()

    clean_data(
        args.input,
        args.output,
        args.report,
        args.null_threshold,
        args.remove_duplicates
    )
```

## Component YAML Definition

```yaml
# components/data_cleaning/component.yaml
$schema: https://azuremlschemas.azureedge.net/latest/commandComponent.schema.json
name: data_cleaning
version: 1.0.0
display_name: Data Cleaning Component
type: command
description: Cleans and validates input data

inputs:
  input_data:
    type: uri_file
    description: Raw input data file
  null_threshold:
    type: number
    default: 0.3
    description: Maximum null ratio allowed per column
  remove_duplicates:
    type: boolean
    default: true
    description: Whether to remove duplicate rows

outputs:
  cleaned_data:
    type: uri_file
    description: Cleaned output data
  quality_report:
    type: uri_file
    description: Data quality report in JSON format

code: .
environment:
  conda_file: conda.yaml
  image: mcr.microsoft.com/azureml/openmpi4.1.0-ubuntu20.04:latest

command: >-
  python clean.py
  --input ${{inputs.input_data}}
  --null-threshold ${{inputs.null_threshold}}
  --remove-duplicates ${{inputs.remove_duplicates}}
  --output ${{outputs.cleaned_data}}
  --report ${{outputs.quality_report}}

is_deterministic: true
```

## Feature Engineering Component

```python
feature_engineering_component = command(
    name="feature_engineering",
    version="1.0.0",
    display_name="Feature Engineering",
    inputs={
        "input_data": Input(type="uri_file"),
        "feature_config": Input(type="uri_file", optional=True),
        "target_column": Input(type="string")
    },
    outputs={
        "feature_data": Output(type="uri_file"),
        "feature_metadata": Output(type="uri_file")
    },
    code="./components/feature_engineering",
    command="""python engineer_features.py \
        --input ${{inputs.input_data}} \
        --config ${{inputs.feature_config}} \
        --target ${{inputs.target_column}} \
        --output ${{outputs.feature_data}} \
        --metadata ${{outputs.feature_metadata}}""",
    environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu@latest"
)

# components/feature_engineering/engineer_features.py
import pandas as pd
import numpy as np
import json
import argparse

def engineer_features(input_path, config_path, target_column, output_path, metadata_path):
    df = pd.read_csv(input_path)

    feature_metadata = {
        "original_features": df.columns.tolist(),
        "engineered_features": [],
        "target_column": target_column
    }

    # Load config if provided
    config = {}
    if config_path and Path(config_path).exists():
        with open(config_path) as f:
            config = json.load(f)

    # Numerical transformations
    numerical_cols = df.select_dtypes(include=[np.number]).columns
    for col in numerical_cols:
        if col != target_column:
            # Log transform for skewed features
            if df[col].skew() > 1:
                df[f"{col}_log"] = np.log1p(df[col])
                feature_metadata["engineered_features"].append(f"{col}_log")

            # Squared terms
            if config.get("include_squared", True):
                df[f"{col}_squared"] = df[col] ** 2
                feature_metadata["engineered_features"].append(f"{col}_squared")

    # Categorical encoding
    categorical_cols = df.select_dtypes(include=['object']).columns
    for col in categorical_cols:
        dummies = pd.get_dummies(df[col], prefix=col)
        df = pd.concat([df, dummies], axis=1)
        df = df.drop(columns=[col])
        feature_metadata["engineered_features"].extend(dummies.columns.tolist())

    # Save outputs
    df.to_csv(output_path, index=False)
    with open(metadata_path, 'w') as f:
        json.dump(feature_metadata, f, indent=2)
```

## Model Training Component

```python
training_component = command(
    name="model_training",
    version="1.0.0",
    display_name="Model Training",
    inputs={
        "train_data": Input(type="uri_file"),
        "validation_data": Input(type="uri_file", optional=True),
        "target_column": Input(type="string"),
        "model_type": Input(type="string", default="random_forest"),
        "hyperparameters": Input(type="uri_file", optional=True)
    },
    outputs={
        "model": Output(type="mlflow_model"),
        "metrics": Output(type="uri_file")
    },
    code="./components/training",
    command="""python train.py \
        --train-data ${{inputs.train_data}} \
        --validation-data ${{inputs.validation_data}} \
        --target ${{inputs.target_column}} \
        --model-type ${{inputs.model_type}} \
        --hyperparameters ${{inputs.hyperparameters}} \
        --model-output ${{outputs.model}} \
        --metrics-output ${{outputs.metrics}}""",
    environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu@latest"
)
```

## Component Versioning

```python
# Create new version of a component
data_cleaning_v2 = command(
    name="data_cleaning",
    version="2.0.0",  # New version
    display_name="Data Cleaning Component v2",
    # ... updated implementation
)

ml_client.components.create_or_update(data_cleaning_v2)

# Load specific version
v1_component = ml_client.components.get("data_cleaning", version="1.0.0")
latest_component = ml_client.components.get("data_cleaning")  # Gets latest

# List all versions
for component in ml_client.components.list(name="data_cleaning"):
    print(f"Version: {component.version}, Created: {component.creation_context.created_at}")
```

## Using Components in Pipelines

```python
from azure.ai.ml import dsl

# Load registered components
data_cleaning = ml_client.components.get("data_cleaning", version="1.0.0")
feature_engineering = ml_client.components.get("feature_engineering")
model_training = ml_client.components.get("model_training")

@dsl.pipeline(
    name="full_ml_pipeline",
    compute="cpu-cluster"
)
def ml_pipeline(raw_data: Input, target_column: str):
    # Use components
    clean_step = data_cleaning(
        input_data=raw_data,
        null_threshold=0.3,
        remove_duplicates=True
    )

    feature_step = feature_engineering(
        input_data=clean_step.outputs.cleaned_data,
        target_column=target_column
    )

    train_step = model_training(
        train_data=feature_step.outputs.feature_data,
        target_column=target_column,
        model_type="random_forest"
    )

    return {"model": train_step.outputs.model}

# Submit pipeline
pipeline_job = ml_client.jobs.create_or_update(
    ml_pipeline(
        raw_data=Input(path="azureml://datastores/workspaceblobstore/paths/data.csv"),
        target_column="target"
    ),
    experiment_name="component-pipeline"
)
```

Well-designed components enable team collaboration and accelerate ML development through reuse.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
