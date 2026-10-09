---
title: Batch Inference at Scale with Azure ML Batch Endpoints
description: "Batch endpoints enable cost-effective, scalable inference for large datasets without the complexity of managing infrastructure."
author: Michael John Pena
draft: false
date: 2021-09-10
tags:
  - Azure
  - Machine Learning
  - Batch Processing
  - MLOps
  - Data Engineering
---

## When to Use Batch Endpoints

- Processing millions of records
- Scheduled scoring jobs (daily, weekly)
- No real-time latency requirements
- Cost-sensitive workloads
- Large file processing (images, documents)

## Creating a Batch Endpoint

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import BatchEndpoint, BatchDeployment
from azure.ai.ml.constants import BatchDeploymentOutputAction
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
ml_client = MLClient(
    credential=credential,
    subscription_id="your-subscription-id",
    resource_group_name="myresourcegroup",
    workspace_name="myworkspace"
)

# Create batch endpoint
batch_endpoint = BatchEndpoint(
    name="customer-scoring-batch",
    description="Batch scoring for customer data"
)

ml_client.batch_endpoints.begin_create_or_update(batch_endpoint).result()
print(f"Batch endpoint created: {batch_endpoint.name}")
```

## Batch Scoring Script

```python
# batch_score.py
import os
import pandas as pd
import joblib
from pathlib import Path

def init():
    """Initialize the model."""
    global model

    model_path = os.path.join(os.getenv('AZUREML_MODEL_DIR'), 'model.pkl')
    model = joblib.load(model_path)
    print(f"Model loaded from {model_path}")

def run(mini_batch):
    """
    Process a mini-batch of files.

    Args:
        mini_batch: List of file paths to process

    Returns:
        List of results (one per input file)
    """
    results = []

    for file_path in mini_batch:
        print(f"Processing: {file_path}")

        # Read input file
        df = pd.read_csv(file_path)

        # Prepare features
        features = df.drop(['id'], axis=1, errors='ignore')

        # Make predictions
        predictions = model.predict(features)
        probabilities = model.predict_proba(features)

        # Combine results
        df['prediction'] = predictions
        df['probability'] = probabilities.max(axis=1)

        # Return as string (will be written to output)
        results.append(df.to_csv(index=False))

    return results
```

## Batch Deployment Configuration

```python
from azure.ai.ml.entities import (
    BatchDeployment,
    BatchRetrySettings,
    CodeConfiguration
)

batch_deployment = BatchDeployment(
    name="scoring-v1",
    endpoint_name="customer-scoring-batch",
    model="azureml:customer-churn-model:2",
    code_configuration=CodeConfiguration(
        code="./src/batch",
        scoring_script="batch_score.py"
    ),
    environment="azureml:sklearn-inference-env:1",
    compute="cpu-cluster",
    instance_count=4,
    mini_batch_size=10,  # Files per mini-batch
    output_action=BatchDeploymentOutputAction.APPEND_ROW,
    output_file_name="predictions.csv",
    retry_settings=BatchRetrySettings(
        max_retries=3,
        timeout=300
    ),
    logging_level="info",
    max_concurrency_per_instance=2,
    error_threshold=10  # Allow up to 10 failed items
)

ml_client.batch_deployments.begin_create_or_update(batch_deployment).result()

# Set as default deployment
batch_endpoint = ml_client.batch_endpoints.get("customer-scoring-batch")
batch_endpoint.defaults.deployment_name = "scoring-v1"
ml_client.batch_endpoints.begin_create_or_update(batch_endpoint).result()
```

## Invoking Batch Endpoints

```python
from azure.ai.ml import Input
from azure.ai.ml.constants import AssetTypes

# Invoke with data asset
job = ml_client.batch_endpoints.invoke(
    endpoint_name="customer-scoring-batch",
    input=Input(
        type=AssetTypes.URI_FOLDER,
        path="azureml://datastores/workspaceblobstore/paths/batch-input/"
    )
)

print(f"Batch job submitted: {job.name}")

# Monitor job progress
import time
while True:
    job = ml_client.jobs.get(job.name)
    print(f"Status: {job.status}")

    if job.status in ['Completed', 'Failed', 'Canceled']:
        break

    time.sleep(30)

# Get output location
if job.status == 'Completed':
    print(f"Output path: {job.outputs.default.path}")
```

## Processing Large Datasets

```python
# batch_score_chunked.py
import os
import pandas as pd
import numpy as np
import joblib
from typing import List

model = None
chunk_size = 10000

def init():
    global model
    model_path = os.path.join(os.getenv('AZUREML_MODEL_DIR'), 'model.pkl')
    model = joblib.load(model_path)

def run(mini_batch: List[str]) -> List[str]:
    """Process files in chunks to handle memory efficiently."""
    results = []

    for file_path in mini_batch:
        output_rows = []

        # Process file in chunks
        for chunk in pd.read_csv(file_path, chunksize=chunk_size):
            # Extract features
            ids = chunk['id'].values
            features = chunk.drop(['id'], axis=1)

            # Predict
            predictions = model.predict(features)

            # Collect results
            for id_val, pred in zip(ids, predictions):
                output_rows.append(f"{id_val},{pred}")

        results.extend(output_rows)

    return results
```

## Parallel Processing with Partitioned Data

```yaml
# batch-deployment.yml
$schema: https://azuremlschemas.azureedge.net/latest/batchDeployment.schema.json
name: parallel-scoring
endpoint_name: customer-scoring-batch
model: azureml:customer-churn-model:2
code_configuration:
  code: ./src/batch
  scoring_script: batch_score.py
environment: azureml:sklearn-inference-env:1
compute: cpu-cluster
resources:
  instance_count: 10
mini_batch_size: 5
max_concurrency_per_instance: 4
retry_settings:
  max_retries: 3
  timeout: 600
output_action: append_row
output_file_name: predictions.csv
environment_variables:
  BATCH_SIZE: "1000"
```

## Scheduled Batch Jobs

```python
from azure.ai.ml.entities import JobSchedule, RecurrenceTrigger, RecurrencePattern

# Create a schedule for nightly batch scoring
schedule = JobSchedule(
    name="nightly-batch-scoring",
    trigger=RecurrenceTrigger(
        frequency="day",
        interval=1,
        schedule=RecurrencePattern(hours=2, minutes=0),  # 2:00 AM
        time_zone="America/Los_Angeles"
    ),
    create_job=lambda: ml_client.batch_endpoints.invoke(
        endpoint_name="customer-scoring-batch",
        input=Input(
            type=AssetTypes.URI_FOLDER,
            path="azureml://datastores/workspaceblobstore/paths/daily-data/"
        )
    )
)

# Note: Actual scheduling would use Azure Data Factory or Logic Apps
# for production scenarios
```

## Error Handling and Recovery

```python
# batch_score_robust.py
import os
import logging
import pandas as pd
import joblib
from typing import List

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

model = None

def init():
    global model
    model_path = os.path.join(os.getenv('AZUREML_MODEL_DIR'), 'model.pkl')
    model = joblib.load(model_path)

def run(mini_batch: List[str]) -> List[str]:
    results = []

    for file_path in mini_batch:
        try:
            logger.info(f"Processing: {file_path}")
            df = pd.read_csv(file_path)

            # Validate data
            required_columns = ['feature1', 'feature2', 'feature3']
            missing = set(required_columns) - set(df.columns)
            if missing:
                logger.error(f"Missing columns in {file_path}: {missing}")
                results.append(f"ERROR,{file_path},missing_columns")
                continue

            # Handle missing values
            df = df.fillna(0)

            # Predict
            features = df[required_columns]
            predictions = model.predict(features)

            # Format output
            for idx, pred in enumerate(predictions):
                results.append(f"{df.iloc[idx]['id']},{pred}")

        except Exception as e:
            logger.error(f"Error processing {file_path}: {str(e)}")
            results.append(f"ERROR,{file_path},{str(e)}")

    return results
```

## Monitoring Batch Jobs

```python
# Monitor running batch jobs
jobs = ml_client.jobs.list(
    parent_job_name=None,
    tags={"batch_endpoint": "customer-scoring-batch"}
)

for job in jobs:
    print(f"""
    Job: {job.name}
    Status: {job.status}
    Started: {job.creation_context.created_at}
    """)

# Get detailed job metrics
job = ml_client.jobs.get("batch-job-name")
print(f"Progress: {job.properties.get('progress', 'N/A')}")
```

## Best Practices

1. **Right-size mini-batches**: Balance parallelism and overhead
2. **Handle failures gracefully**: Use retry settings and error thresholds
3. **Monitor memory usage**: Process large files in chunks
4. **Use appropriate compute**: Match instance count to data volume
5. **Validate inputs**: Check data quality before processing
6. **Log extensively**: Enable debugging for failed items

Batch endpoints enable cost-effective, scalable inference for large datasets without the complexity of managing infrastructure.
