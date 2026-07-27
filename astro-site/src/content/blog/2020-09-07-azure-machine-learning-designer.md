---
title: "Azure Machine Learning Designer for No-Code ML"
author: Michael John Peña
draft: false
date: 2020-09-07
tags:
  - Azure
  - Machine Learning
  - No-Code
  - AI

---

I wrote "Azure Machine Learning Designer for No-Code ML" to share practical, production-minded guidance on this topic.

## When to Use Designer

- Quick prototyping
- Teams without ML engineers
- Standardized ML patterns
- Explainable models (less black box)

## Building a Classification Pipeline

1. **Data Input**: Drag dataset or Upload data
2. **Data Preparation**:
   - Select Columns in Dataset
   - Clean Missing Data
   - Normalize Data
3. **Split Data**: 70% train, 30% test
4. **Train Model**: Two-Class Boosted Decision Tree
5. **Score Model**: Apply to test data
6. **Evaluate Model**: View metrics

## Key Components

| Component | Purpose |
|-----------|---------|
| Select Columns | Choose features |
| Clean Missing Data | Handle nulls |
| SMOTE | Balance classes |
| Normalize Data | Scale features |
| Split Data | Train/test split |
| Train Model | Fit algorithm |
| Score Model | Make predictions |
| Evaluate Model | Calculate metrics |

## Deploying as Endpoint

1. Create inference pipeline from training pipeline
2. Submit to compute
3. Deploy as real-time endpoint
4. Get REST API URL

```python
import requests

scoring_uri = "https://your-endpoint.azureml.net/score"
api_key = "your-key"

data = {"data": [[5.1, 3.5, 1.4, 0.2]]}
headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

response = requests.post(scoring_uri, json=data, headers=headers)
print(response.json())
```

Designer democratizes ML for teams that don't live in code.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
