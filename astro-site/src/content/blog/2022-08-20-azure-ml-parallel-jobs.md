---
title: "Parallel Jobs in Azure ML for Large-Scale Processing"
description: "Parallel jobs enable processing datasets of any size by distributing work across your compute cluster."
author: "Michael John Peña"
draft: false
date: 2022-08-20
tags: ["Azure", "Machine Learning", "Parallel Processing", "Batch", "Scalability"]
---

## Parallel Run Configuration

```python
from azure.ai.ml import MLClient, Input, Output
from azure.ai.ml.parallel import parallel_run_function, RunFunction
from azure.identity import DefaultAzureCredential

ml_client = MLClient(
    credential=DefaultAzureCredential(),
    subscription_id="your-subscription",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Define parallel run
batch_scoring = parallel_run_function(
    name="batch_scoring",
    display_name="Parallel Batch Scoring",
    description="Score large datasets in parallel",

    # Input/Output configuration
    inputs={
        "input_data": Input(type="uri_folder"),
        "model": Input(type="mlflow_model")
    },
    outputs={
        "predictions": Output(type="uri_folder")
    },
    input_data="${{inputs.input_data}}",

    # Parallelization settings
    instance_count=4,
    max_concurrency_per_instance=2,
    mini_batch_size="10",  # 10 files per mini-batch

    # Error handling
    error_threshold=10,
    mini_batch_error_threshold=5,
    retry_settings={
        "max_retries": 3,
        "timeout": 60
    },

    # Logging
    logging_level="INFO",
    append_row_to="${{outputs.predictions}}/predictions.csv",

    # Task configuration
    task=RunFunction(
        code="./src/scoring",
        entry_script="score.py",
        environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu@latest"
    )
)

# Register the component
ml_client.components.create_or_update(batch_scoring)
```

## Scoring Script for Parallel Run

```python
# src/scoring/score.py
import os
import pandas as pd
import mlflow
from azureml.core import Run

def init():
    """Initialize the model"""
    global model

    # Get model from input
    run = Run.get_context()
    model_path = run.input_datasets.get("model") or os.environ.get("AZUREML_MODEL_DIR")

    model = mlflow.sklearn.load_model(model_path)
    print(f"Model loaded from {model_path}")

def run(mini_batch):
    """Process a mini-batch of files"""
    results = []

    for file_path in mini_batch:
        try:
            # Read file
            df = pd.read_csv(file_path)

            # Make predictions
            predictions = model.predict(df)
            probabilities = model.predict_proba(df)

            # Add results
            df["prediction"] = predictions
            df["probability"] = probabilities.max(axis=1)
            df["source_file"] = os.path.basename(file_path)

            results.append(df)

        except Exception as e:
            print(f"Error processing {file_path}: {e}")
            continue

    if results:
        combined = pd.concat(results)
        return combined
    else:
        return pd.DataFrame()
```

## Using Parallel Job in Pipeline

```python
from azure.ai.ml import dsl, Input

# Load the parallel component
batch_scoring_component = ml_client.components.get("batch_scoring")

@dsl.pipeline(
    name="batch_inference_pipeline",
    description="Run batch inference on large dataset",
    compute="cpu-cluster"
)
def batch_inference_pipeline(
    input_data: Input,
    model: Input
):
    scoring_step = batch_scoring_component(
        input_data=input_data,
        model=model
    )

    return {
        "predictions": scoring_step.outputs.predictions
    }

# Submit pipeline
pipeline_job = ml_client.jobs.create_or_update(
    batch_inference_pipeline(
        input_data=Input(
            path="azureml://datastores/workspaceblobstore/paths/batch-data/",
            type="uri_folder"
        ),
        model=Input(
            path="azureml://models/my-model/versions/1",
            type="mlflow_model"
        )
    ),
    experiment_name="batch-inference"
)
```

## Mini-Batch Processing Strategies

```python
# Strategy 1: File-based mini-batches
parallel_job_file = parallel_run_function(
    name="file_parallel",
    mini_batch_size="10",  # 10 files per batch
    input_data="${{inputs.input_data}}",
    # ...
)

# Strategy 2: Row-based mini-batches (for tabular data)
parallel_job_rows = parallel_run_function(
    name="row_parallel",
    mini_batch_size="1000",  # 1000 rows per batch
    input_data="${{inputs.input_data}}",
    mini_batch_row_size=1000,
    # ...
)

# Strategy 3: Memory-based mini-batches
parallel_job_memory = parallel_run_function(
    name="memory_parallel",
    mini_batch_size="100MB",  # 100MB per batch
    input_data="${{inputs.input_data}}",
    # ...
)
```

## Advanced Error Handling

```python
# src/scoring/score_with_error_handling.py
import os
import logging
import traceback
from typing import List

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class BatchProcessor:
    def __init__(self):
        self.model = None
        self.failed_files = []
        self.processed_count = 0

    def init(self):
        """Initialize resources"""
        import mlflow
        self.model = mlflow.sklearn.load_model(os.environ.get("AZUREML_MODEL_DIR"))

    def run(self, mini_batch: List[str]):
        """Process mini-batch with comprehensive error handling"""
        results = []

        for file_path in mini_batch:
            try:
                result = self._process_file(file_path)
                results.append(result)
                self.processed_count += 1

            except FileNotFoundError:
                logger.error(f"File not found: {file_path}")
                self.failed_files.append((file_path, "not_found"))

            except pd.errors.EmptyDataError:
                logger.error(f"Empty file: {file_path}")
                self.failed_files.append((file_path, "empty"))

            except Exception as e:
                logger.error(f"Error processing {file_path}: {e}")
                logger.error(traceback.format_exc())
                self.failed_files.append((file_path, str(e)))

        logger.info(f"Processed {len(results)}/{len(mini_batch)} files in this batch")
        return results

    def _process_file(self, file_path: str):
        """Process a single file"""
        df = pd.read_csv(file_path)

        if df.empty:
            raise pd.errors.EmptyDataError("DataFrame is empty")

        # Validate schema
        required_columns = ["feature1", "feature2", "feature3"]
        missing = set(required_columns) - set(df.columns)
        if missing:
            raise ValueError(f"Missing columns: {missing}")

        # Make predictions
        predictions = self.model.predict(df[required_columns])

        return {
            "file": os.path.basename(file_path),
            "predictions": predictions.tolist(),
            "count": len(predictions)
        }

# Module-level functions for parallel run
processor = BatchProcessor()

def init():
    processor.init()

def run(mini_batch):
    return processor.run(mini_batch)
```

## Monitoring Parallel Jobs

```python
# Monitor job progress
job = ml_client.jobs.get(pipeline_job.name)

while job.status not in ["Completed", "Failed", "Canceled"]:
    print(f"Status: {job.status}")

    # Get child job details
    child_jobs = list(ml_client.jobs.list(parent_job_name=job.name))
    for child in child_jobs:
        print(f"  {child.name}: {child.status}")

    time.sleep(30)
    job = ml_client.jobs.get(pipeline_job.name)

print(f"Final status: {job.status}")

# Get logs
logs = ml_client.jobs.download(
    name=pipeline_job.name,
    download_path="./logs",
    output_name="logs"
)
```

## Scaling Considerations

```python
# Configure for maximum throughput
high_throughput_job = parallel_run_function(
    name="high_throughput_scoring",

    # Scale out with more instances
    instance_count=10,

    # Maximize parallelism per instance
    max_concurrency_per_instance=8,

    # Larger mini-batches for efficiency
    mini_batch_size="50",

    # Relaxed error thresholds for large jobs
    error_threshold=100,
    mini_batch_error_threshold=10,

    # Longer timeout for complex processing
    retry_settings={
        "max_retries": 3,
        "timeout": 300
    },

    # Use larger compute
    compute="Standard_DS4_v2",

    task=RunFunction(
        code="./src/scoring",
        entry_script="score.py",
        environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu@latest"
    )
)
```

Parallel jobs enable processing datasets of any size by distributing work across your compute cluster.
