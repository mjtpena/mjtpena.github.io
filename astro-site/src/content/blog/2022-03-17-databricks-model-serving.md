---
title: "Databricks Model Serving: Real-Time ML Inference at Scale"
author: Michael John Peña
draft: false
date: 2022-03-17
tags:
  - Azure
  - Databricks
  - Model Serving
  - ML Inference
  - MLOps
---

## Model Serving Overview

Key features:
- **Serverless**: No infrastructure management
- **Auto-scaling**: Handles variable traffic automatically
- **Low latency**: Sub-second response times
- **Feature Store integration**: Automatic feature lookups
- **A/B testing**: Built-in traffic splitting

## Enabling Model Serving

```python
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import EndpointCoreConfigInput, ServedModelInput

w = WorkspaceClient()

# Create a model serving endpoint
endpoint_config = EndpointCoreConfigInput(
    name="churn-prediction-endpoint",
    served_models=[
        ServedModelInput(
            model_name="churn-predictor",
            model_version="3",
            workload_size="Small",
            scale_to_zero_enabled=True
        )
    ]
)

w.serving_endpoints.create(
    name="churn-prediction-endpoint",
    config=endpoint_config
)
```

## REST API Configuration

```python
# Via REST API
import requests
import json

workspace_url = "https://adb-xxx.azuredatabricks.net"
token = os.environ["DATABRICKS_TOKEN"]

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

# Create endpoint
endpoint_config = {
    "name": "recommendation-endpoint",
    "config": {
        "served_models": [
            {
                "model_name": "product-recommender",
                "model_version": "1",
                "workload_size": "Small",
                "scale_to_zero_enabled": True
            }
        ],
        "traffic_config": {
            "routes": [
                {
                    "served_model_name": "product-recommender-1",
                    "traffic_percentage": 100
                }
            ]
        }
    }
}

response = requests.post(
    f"{workspace_url}/api/2.0/serving-endpoints",
    headers=headers,
    json=endpoint_config
)

print(response.json())
```

## Querying the Endpoint

```python
# Python client
import requests

def predict(endpoint_name, instances):
    url = f"{workspace_url}/serving-endpoints/{endpoint_name}/invocations"

    payload = {
        "instances": instances
    }

    response = requests.post(
        url,
        headers=headers,
        json=payload
    )

    return response.json()

# Example: Predict churn for customers
predictions = predict(
    "churn-prediction-endpoint",
    [
        {"customer_id": "C001", "total_orders": 5, "lifetime_value": 500.0},
        {"customer_id": "C002", "total_orders": 20, "lifetime_value": 2500.0}
    ]
)

print(predictions)
# {"predictions": [0.75, 0.12]}
```

### Calling from Different Languages

```javascript
// JavaScript/Node.js
const axios = require('axios');

async function predict(endpointName, instances) {
    const response = await axios.post(
        `${workspaceUrl}/serving-endpoints/${endpointName}/invocations`,
        { instances },
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );
    return response.data;
}
```

```csharp
// C#/.NET
using System.Net.Http;
using System.Text.Json;

public async Task<PredictionResponse> PredictAsync(string endpointName, object[] instances)
{
    var client = new HttpClient();
    client.DefaultRequestHeaders.Add("Authorization", $"Bearer {token}");

    var payload = new { instances };
    var content = new StringContent(
        JsonSerializer.Serialize(payload),
        Encoding.UTF8,
        "application/json"
    );

    var response = await client.PostAsync(
        $"{workspaceUrl}/serving-endpoints/{endpointName}/invocations",
        content
    );

    var responseBody = await response.Content.ReadAsStringAsync();
    return JsonSerializer.Deserialize<PredictionResponse>(responseBody);
}
```

## Feature Store Integration

Serve models that automatically look up features:

```python
# Log model with feature store
from databricks.feature_store import FeatureStoreClient

fs = FeatureStoreClient()

# When logging the model, include the training set
fs.log_model(
    model=trained_model,
    artifact_path="model",
    flavor=mlflow.sklearn,
    training_set=training_set,  # Contains feature lookup definitions
    registered_model_name="churn-predictor-with-features"
)

# Create endpoint - it will automatically look up features
endpoint_config = {
    "name": "churn-with-features",
    "config": {
        "served_models": [{
            "model_name": "churn-predictor-with-features",
            "model_version": "1",
            "workload_size": "Small"
        }]
    }
}

# When calling the endpoint, only provide lookup keys
predictions = predict(
    "churn-with-features",
    [{"customer_id": "C001"}, {"customer_id": "C002"}]
)
# Features are automatically fetched from the Feature Store
```

## A/B Testing

Deploy multiple model versions:

```python
# Update endpoint with A/B test configuration
ab_test_config = {
    "served_models": [
        {
            "name": "model-a",
            "model_name": "churn-predictor",
            "model_version": "2",
            "workload_size": "Small"
        },
        {
            "name": "model-b",
            "model_name": "churn-predictor",
            "model_version": "3",
            "workload_size": "Small"
        }
    ],
    "traffic_config": {
        "routes": [
            {"served_model_name": "model-a", "traffic_percentage": 80},
            {"served_model_name": "model-b", "traffic_percentage": 20}
        ]
    }
}

# Update endpoint
response = requests.put(
    f"{workspace_url}/api/2.0/serving-endpoints/churn-prediction-endpoint/config",
    headers=headers,
    json=ab_test_config
)

# Monitor which model served each request
def predict_with_metadata(endpoint_name, instances):
    response = requests.post(
        f"{workspace_url}/serving-endpoints/{endpoint_name}/invocations",
        headers={**headers, "X-Databricks-Return-Metadata": "true"},
        json={"instances": instances}
    )
    return response.json()

# Response includes which model version served the request
```

## Canary Deployments

Gradually roll out new models:

```python
class CanaryDeployment:
    def __init__(self, endpoint_name, current_model, new_model):
        self.endpoint_name = endpoint_name
        self.current_model = current_model
        self.new_model = new_model
        self.traffic_percentages = [5, 10, 25, 50, 100]
        self.current_stage = 0

    def advance_stage(self):
        if self.current_stage >= len(self.traffic_percentages):
            print("Deployment complete")
            return

        new_traffic = self.traffic_percentages[self.current_stage]
        old_traffic = 100 - new_traffic

        config = {
            "traffic_config": {
                "routes": [
                    {"served_model_name": self.current_model, "traffic_percentage": old_traffic},
                    {"served_model_name": self.new_model, "traffic_percentage": new_traffic}
                ]
            }
        }

        response = requests.put(
            f"{workspace_url}/api/2.0/serving-endpoints/{self.endpoint_name}/config",
            headers=headers,
            json=config
        )

        self.current_stage += 1
        print(f"Advanced to {new_traffic}% traffic on new model")

    def rollback(self):
        config = {
            "traffic_config": {
                "routes": [
                    {"served_model_name": self.current_model, "traffic_percentage": 100},
                    {"served_model_name": self.new_model, "traffic_percentage": 0}
                ]
            }
        }

        requests.put(
            f"{workspace_url}/api/2.0/serving-endpoints/{self.endpoint_name}/config",
            headers=headers,
            json=config
        )
        print("Rolled back to current model")
```

## Monitoring and Observability

```python
# Get endpoint metrics
def get_endpoint_metrics(endpoint_name, hours=24):
    end_time = datetime.utcnow()
    start_time = end_time - timedelta(hours=hours)

    response = requests.get(
        f"{workspace_url}/api/2.0/serving-endpoints/{endpoint_name}/metrics",
        headers=headers,
        params={
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat()
        }
    )

    return response.json()

# Parse metrics
metrics = get_endpoint_metrics("churn-prediction-endpoint")
print(f"Total requests: {metrics['request_count']}")
print(f"Average latency: {metrics['avg_latency_ms']}ms")
print(f"Error rate: {metrics['error_rate']}")

# Set up alerts via Azure Monitor
# Model serving metrics are automatically exported
```

### Custom Metrics Logging

```python
# Log custom metrics from within your model
import mlflow

class MonitoredModel(mlflow.pyfunc.PythonModel):
    def __init__(self, model):
        self.model = model

    def predict(self, context, model_input):
        import time

        start = time.time()
        predictions = self.model.predict(model_input)
        latency = time.time() - start

        # Log custom metrics
        mlflow.log_metric("prediction_latency", latency)
        mlflow.log_metric("batch_size", len(model_input))

        # Log prediction distribution
        mlflow.log_metric("mean_prediction", predictions.mean())

        return predictions
```

## Cost Optimization

```python
# Configure auto-scaling for cost efficiency
scaling_config = {
    "served_models": [{
        "model_name": "churn-predictor",
        "model_version": "3",
        "workload_size": "Small",
        "scale_to_zero_enabled": True,  # Save costs during idle periods
        "min_provisioned_throughput": 0,
        "max_provisioned_throughput": 10000
    }]
}

# Workload sizes and their characteristics:
# - Small: Up to 4 concurrent requests
# - Medium: Up to 16 concurrent requests
# - Large: Up to 64 concurrent requests

# For predictable traffic, provision capacity
high_traffic_config = {
    "served_models": [{
        "model_name": "churn-predictor",
        "model_version": "3",
        "workload_size": "Medium",
        "scale_to_zero_enabled": False,  # Keep warm for low latency
        "min_provisioned_throughput": 1000
    }]
}
```

## Custom Python Environments

```python
# Define custom environment for complex dependencies
import mlflow

# Create conda environment
conda_env = {
    "channels": ["defaults", "conda-forge"],
    "dependencies": [
        "python=3.9",
        "pip",
        {
            "pip": [
                "scikit-learn==1.0.2",
                "xgboost==1.5.0",
                "shap==0.40.0",
                "custom-package==1.0.0"
            ]
        }
    ]
}

# Log model with custom environment
mlflow.sklearn.log_model(
    model,
    "model",
    conda_env=conda_env,
    registered_model_name="model-with-custom-env"
)
```

## Real-Time Feature Engineering

```python
# Combine pre-computed features with real-time features
class RealTimeFeatureModel(mlflow.pyfunc.PythonModel):
    def __init__(self, model, feature_store_client):
        self.model = model
        self.fs = feature_store_client

    def predict(self, context, model_input):
        # model_input contains raw request data
        customer_ids = model_input["customer_id"].tolist()

        # Fetch pre-computed features from Feature Store
        stored_features = self.fs.read_table(
            "production.features.customer_features"
        ).filter(col("customer_id").isin(customer_ids))

        # Compute real-time features
        real_time_features = self.compute_real_time_features(model_input)

        # Combine features
        combined = stored_features.join(
            real_time_features,
            "customer_id"
        )

        # Predict
        return self.model.predict(combined)

    def compute_real_time_features(self, input_data):
        # Compute features from request data
        # e.g., time since last session, current cart value
        return input_data
```

## Best Practices

### High Availability

```python
# Deploy to multiple endpoints for redundancy
endpoints = ["prod-east", "prod-west"]

# Use a load balancer to distribute traffic
# Configure health checks
health_check_config = {
    "health_check_enabled": True,
    "health_check_interval_seconds": 30
}
```

### Request Validation

```python
# Validate inputs before prediction
class ValidatedModel(mlflow.pyfunc.PythonModel):
    def __init__(self, model, schema):
        self.model = model
        self.schema = schema

    def predict(self, context, model_input):
        # Validate input schema
        for col, dtype in self.schema.items():
            if col not in model_input.columns:
                raise ValueError(f"Missing required column: {col}")
            if model_input[col].dtype != dtype:
                raise ValueError(f"Invalid type for {col}")

        # Validate value ranges
        if (model_input["age"] < 0).any():
            raise ValueError("Age cannot be negative")

        return self.model.predict(model_input)
```

## Conclusion

Databricks Model Serving simplifies the deployment of ML models to production:
- Serverless infrastructure eliminates operational overhead
- Feature Store integration ensures consistency
- A/B testing and canary deployments enable safe releases
- Auto-scaling handles variable traffic efficiently

The integration with the broader Databricks ecosystem - MLflow, Feature Store, and Unity Catalog - provides a complete MLOps solution.

## Resources

- [Model Serving Documentation](https://docs.databricks.com/machine-learning/model-serving/index.html)
- [Serving Endpoints API](https://docs.databricks.com/api/workspace/servingendpoints)
- [Feature Store Serving](https://docs.databricks.com/machine-learning/feature-store/feature-serving.html)
