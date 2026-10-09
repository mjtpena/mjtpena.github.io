---
title: Managing Data with Azure ML Datasets
description: "Proper data management with Azure ML Datasets is foundational to building reproducible, auditable machine learning pipelines."
author: Michael John Pena
draft: false
date: 2021-09-03
tags:
  - Azure
  - Machine Learning
  - Data Engineering
  - Azure ML
  - MLOps
---

## Types of Data Assets

Azure ML supports several types of data assets:

1. **URI File**: Reference to a single file
2. **URI Folder**: Reference to a folder of files
3. **MLTable**: Tabular data with schema definition

## Creating Data Assets

### Using Python SDK

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import Data
from azure.ai.ml.constants import AssetTypes
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
ml_client = MLClient(
    credential=credential,
    subscription_id="your-subscription-id",
    resource_group_name="myresourcegroup",
    workspace_name="myworkspace"
)

# Create a file data asset
file_data = Data(
    name="customer-churn-data",
    description="Customer churn prediction dataset",
    path="azureml://datastores/workspaceblobstore/paths/data/churn.csv",
    type=AssetTypes.URI_FILE,
    version="1"
)

ml_client.data.create_or_update(file_data)
print("File data asset created!")

# Create a folder data asset
folder_data = Data(
    name="training-images",
    description="Training images for object detection",
    path="azureml://datastores/workspaceblobstore/paths/images/",
    type=AssetTypes.URI_FOLDER,
    version="1"
)

ml_client.data.create_or_update(folder_data)
```

### Creating MLTable for Tabular Data

```python
from azure.ai.ml.entities import Data
from azure.ai.ml.constants import AssetTypes

# First, create an MLTable definition file
mltable_definition = """
paths:
  - file: ./data/*.csv
transformations:
  - read_delimited:
      delimiter: ','
      encoding: utf8
      header: all_files_same_headers
  - drop_columns:
      columns:
        - 'id'
  - convert_column_types:
      columns:
        - column_name: 'age'
          to_type: int
        - column_name: 'salary'
          to_type: float
"""

# Create the MLTable data asset
mltable_data = Data(
    name="customer-data-mltable",
    description="Customer data with schema",
    path="azureml://datastores/workspaceblobstore/paths/mltable/",
    type=AssetTypes.MLTABLE,
    version="1"
)

ml_client.data.create_or_update(mltable_data)
```

## Versioning Datasets

```python
# Create a new version of existing dataset
updated_data = Data(
    name="customer-churn-data",
    description="Customer churn data - updated with 2021 records",
    path="azureml://datastores/workspaceblobstore/paths/data/churn_2021.csv",
    type=AssetTypes.URI_FILE,
    version="2"
)

ml_client.data.create_or_update(updated_data)

# List all versions
versions = ml_client.data.list(name="customer-churn-data")
for v in versions:
    print(f"Version: {v.version}, Created: {v.creation_context.created_at}")
```

## Using Datasets in Training Jobs

```python
from azure.ai.ml import command, Input

# Reference a specific version of the dataset
training_job = command(
    code="./src",
    command="python train.py --data ${{inputs.training_data}}",
    inputs={
        "training_data": Input(
            type="uri_file",
            path="azureml:customer-churn-data:2"  # version 2
        )
    },
    environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu@latest",
    compute="cpu-cluster"
)

ml_client.jobs.create_or_update(training_job)
```

## Loading Data in Training Scripts

```python
# train.py
import argparse
import pandas as pd
import mltable

def load_uri_file(path):
    """Load data from URI file input"""
    df = pd.read_csv(path)
    return df

def load_mltable(path):
    """Load data from MLTable input"""
    tbl = mltable.load(path)
    df = tbl.to_pandas_dataframe()
    return df

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=str, required=True)
    parser.add_argument("--data_type", type=str, default="uri_file")
    args = parser.parse_args()

    if args.data_type == "uri_file":
        df = load_uri_file(args.data)
    elif args.data_type == "mltable":
        df = load_mltable(args.data)

    print(f"Loaded {len(df)} records")
    print(df.head())

    # Continue with training...

if __name__ == "__main__":
    main()
```

## Registering Data from Local Files

```python
from azure.ai.ml.entities import Data
from azure.ai.ml.constants import AssetTypes

# Upload local file and create data asset
local_data = Data(
    name="local-training-data",
    description="Training data uploaded from local machine",
    path="./local_data/training.csv",  # Local path
    type=AssetTypes.URI_FILE
)

# This will upload the file and create the data asset
created_data = ml_client.data.create_or_update(local_data)
print(f"Created data asset with path: {created_data.path}")
```

## Data Lineage and Tracking

Azure ML automatically tracks data lineage. When you use a dataset in a job:

```python
# View data lineage
data_asset = ml_client.data.get(name="customer-churn-data", version="1")
print(f"Data path: {data_asset.path}")
print(f"Created: {data_asset.creation_context.created_at}")
print(f"Created by: {data_asset.creation_context.created_by}")

# Find jobs that used this dataset
jobs = ml_client.jobs.list()
for job in jobs:
    if hasattr(job, 'inputs'):
        for input_name, input_val in job.inputs.items():
            if "customer-churn-data" in str(input_val):
                print(f"Job {job.name} used this dataset")
```

## Best Practices

1. **Always version your datasets**: This ensures reproducibility
2. **Use descriptive names and descriptions**: Makes discovery easier
3. **Prefer MLTable for structured data**: Get schema validation and type coercion
4. **Store data in datastores**: Use Azure Blob Storage or ADLS Gen2
5. **Document data sources**: Track where your data originates

Proper data management with Azure ML Datasets is foundational to building reproducible, auditable machine learning pipelines.
