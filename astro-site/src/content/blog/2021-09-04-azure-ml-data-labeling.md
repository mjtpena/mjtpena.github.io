---
title: Data Labeling Projects in Azure Machine Learning
author: Michael John Pena
draft: false
date: 2021-09-04
tags:
  - Azure
  - Machine Learning
  - Data Labeling
  - Computer Vision
  - NLP

---

I wrote "2021-09-04-azure-ml-data-labeling" to share practical, production-minded guidance on this topic.

## Types of Labeling Projects

Azure ML supports several labeling project types:

1. **Image Classification (Multi-class)**: One label per image
2. **Image Classification (Multi-label)**: Multiple labels per image
3. **Object Detection (Bounding Box)**: Draw boxes around objects
4. **Instance Segmentation**: Pixel-level object labeling
5. **Text Classification**: Categorize text documents

## Creating a Labeling Project via Azure CLI

```bash
# Create an image classification labeling project
az ml labeling-job create \
  --file labeling-project.yml \
  --resource-group myresourcegroup \
  --workspace-name myworkspace
```

## Project Configuration YAML

```yaml
# labeling-project.yml
$schema: https://azuremlschemas.azureedge.net/latest/labelingJob.schema.json
name: product-classification-labeling
type: image_classification
description: "Classify product images into categories"

data:
  path: azureml://datastores/workspaceblobstore/paths/images/products/

label_categories:
  - electronics
  - clothing
  - furniture
  - food
  - toys

labeling_instructions: |
  Please classify each product image into one of the following categories:
  - Electronics: phones, computers, TVs, etc.
  - Clothing: shirts, pants, shoes, etc.
  - Furniture: chairs, tables, beds, etc.
  - Food: packaged food items
  - Toys: children's toys and games

ml_assist_enabled: true
```

## Creating Object Detection Project

```yaml
# object-detection-labeling.yml
$schema: https://azuremlschemas.azureedge.net/latest/labelingJob.schema.json
name: vehicle-detection-labeling
type: object_detection_bounding_box
description: "Detect and label vehicles in street images"

data:
  path: azureml://datastores/workspaceblobstore/paths/images/street/

label_categories:
  - car
  - truck
  - bus
  - motorcycle
  - bicycle
  - pedestrian

labeling_instructions: |
  Draw bounding boxes around all vehicles and pedestrians:
  1. Draw tight boxes that fully contain the object
  2. Label each box with the correct category
  3. If objects overlap, label both separately
  4. Mark occluded objects if at least 50% visible

ml_assist_enabled: true
ml_assist:
  model_name: "fasterrcnn_resnet50_fpn"
  confidence_threshold: 0.5
```

## Managing Labelers

```python
from azure.ai.ml import MLClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
ml_client = MLClient(
    credential=credential,
    subscription_id="your-subscription-id",
    resource_group_name="myresourcegroup",
    workspace_name="myworkspace"
)

# Note: Labeler management is typically done through Azure ML Studio
# You can assign labelers by adding them to the workspace with specific roles

# List labeling jobs
labeling_jobs = ml_client.jobs.list(job_type="labeling")
for job in labeling_jobs:
    print(f"Project: {job.name}, Status: {job.status}")
```

## ML-Assisted Labeling

ML-assisted labeling uses your labeled data to train models that pre-label remaining data:

```yaml
# Enable ML-assist with custom settings
ml_assist_enabled: true
ml_assist:
  compute:
    instance_type: Standard_NC6
    instance_count: 1
  # Model will retrain after this many new labels
  trigger_after_n_labels: 100
  # Pre-labels shown to labelers if confidence > threshold
  confidence_threshold: 0.7
```

## Exporting Labeled Data

```python
# After labeling is complete, export the data
from azure.ai.ml.entities import Data
from azure.ai.ml.constants import AssetTypes

# The labeled data is exported as a dataset
# Get the labeling job to find the output dataset
labeling_job = ml_client.jobs.get("product-classification-labeling")

# The output path contains JSONL files with labels
print(f"Labeled data path: {labeling_job.outputs.labeled_data.path}")

# Create a data asset from the labeled output
labeled_dataset = Data(
    name="product-images-labeled",
    path=labeling_job.outputs.labeled_data.path,
    type=AssetTypes.URI_FOLDER,
    description="Labeled product images from labeling project"
)

ml_client.data.create_or_update(labeled_dataset)
```

## Working with Exported Labels

```python
# process_labels.py
import json
import pandas as pd
from pathlib import Path

def load_image_labels(labels_path):
    """Load labeled data from JSONL export"""
    labels = []

    for jsonl_file in Path(labels_path).glob("*.jsonl"):
        with open(jsonl_file, 'r') as f:
            for line in f:
                record = json.loads(line)
                labels.append({
                    'image_url': record['image_url'],
                    'label': record['label'],
                    'labeler': record.get('labeler_id', 'unknown'),
                    'confidence': record.get('confidence', 1.0)
                })

    return pd.DataFrame(labels)

def load_object_detection_labels(labels_path):
    """Load bounding box labels"""
    annotations = []

    for jsonl_file in Path(labels_path).glob("*.jsonl"):
        with open(jsonl_file, 'r') as f:
            for line in f:
                record = json.loads(line)
                for bbox in record.get('label', []):
                    annotations.append({
                        'image_url': record['image_url'],
                        'label': bbox['label'],
                        'x': bbox['topX'],
                        'y': bbox['topY'],
                        'width': bbox['bottomX'] - bbox['topX'],
                        'height': bbox['bottomY'] - bbox['topY']
                    })

    return pd.DataFrame(annotations)

# Convert to common formats
def export_to_coco(df, output_path):
    """Export to COCO format for object detection"""
    coco_format = {
        "images": [],
        "annotations": [],
        "categories": []
    }

    # Build categories
    unique_labels = df['label'].unique()
    for i, label in enumerate(unique_labels):
        coco_format["categories"].append({
            "id": i,
            "name": label
        })

    # Build images and annotations
    label_to_id = {l: i for i, l in enumerate(unique_labels)}

    for img_id, (image_url, group) in enumerate(df.groupby('image_url')):
        coco_format["images"].append({
            "id": img_id,
            "file_name": image_url.split('/')[-1]
        })

        for _, row in group.iterrows():
            coco_format["annotations"].append({
                "image_id": img_id,
                "category_id": label_to_id[row['label']],
                "bbox": [row['x'], row['y'], row['width'], row['height']]
            })

    with open(output_path, 'w') as f:
        json.dump(coco_format, f)
```

## Quality Metrics

Track labeling quality with consensus labeling:

```yaml
# Enable consensus labeling
consensus:
  enabled: true
  minimum_labelers_per_item: 3
  # Agreement threshold for auto-approval
  agreement_threshold: 0.8
```

## Best Practices

1. **Write clear labeling instructions**: Include examples and edge cases
2. **Start with a small pilot**: Label a sample manually to refine guidelines
3. **Enable ML-assist early**: Even 100-200 labels can help pre-label
4. **Use consensus for quality**: Multiple labelers catch errors
5. **Monitor labeler agreement**: Track inter-annotator agreement scores

Data labeling in Azure ML streamlines the process of creating high-quality training data, essential for building accurate machine learning models.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
