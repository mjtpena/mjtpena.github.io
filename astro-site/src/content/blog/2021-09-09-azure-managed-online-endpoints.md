---
title: Deep Dive into Azure ML Managed Online Endpoints
author: Michael John Pena
draft: false
date: 2021-09-09
tags:
  - Azure
  - Machine Learning
  - REST API
  - Managed Endpoints
  - MLOps

---

I wrote "2021-09-09-azure-managed-online-endpoints" to share practical, production-minded guidance on this topic.

## Key Features

- **Fully Managed**: No infrastructure to manage
- **Auto-scaling**: Scale based on load or schedule
- **Blue-Green Deployments**: Safe updates with traffic splitting
- **Built-in Monitoring**: Metrics and logging out of the box
- **Enterprise Security**: Private endpoints, managed identity

## Creating Endpoints via YAML

```yaml
# endpoint.yml
$schema: https://azuremlschemas.azureedge.net/latest/managedOnlineEndpoint.schema.json
name: product-recommender
description: Real-time product recommendation service
auth_mode: key
tags:
  team: recommendations
  environment: production
```

```yaml
# deployment.yml
$schema: https://azuremlschemas.azureedge.net/latest/managedOnlineDeployment.schema.json
name: blue
endpoint_name: product-recommender
model: azureml:recommendation-model:1
code_configuration:
  code: ./src
  scoring_script: score.py
environment: azureml:recommendation-env:1
instance_type: Standard_DS3_v2
instance_count: 3
request_settings:
  request_timeout_ms: 3000
  max_concurrent_requests_per_instance: 50
  max_queue_wait_ms: 500
liveness_probe:
  initial_delay: 30
  period: 10
  timeout: 5
  success_threshold: 1
  failure_threshold: 3
readiness_probe:
  initial_delay: 10
  period: 10
  timeout: 5
  success_threshold: 1
  failure_threshold: 3
scale_settings:
  type: target_utilization
  min_instances: 2
  max_instances: 10
  target_utilization_percentage: 70
  polling_interval: 60
  scale_down_delay: 300
```

## Deploying via CLI

```bash
# Create endpoint
az ml online-endpoint create --file endpoint.yml

# Create deployment
az ml online-deployment create --file deployment.yml

# Set traffic
az ml online-endpoint update --name product-recommender --traffic "blue=100"
```

## Advanced Scoring Script

```python
# score.py
import os
import json
import logging
import time
from typing import List, Dict, Any
import numpy as np
import onnxruntime as ort
from inference_schema.schema_decorators import input_schema, output_schema
from inference_schema.parameter_types.numpy_parameter_type import NumpyParameterType

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global model reference
model_session = None

def init():
    """Initialize the model session."""
    global model_session

    model_path = os.path.join(
        os.getenv('AZUREML_MODEL_DIR'),
        'model.onnx'
    )

    logger.info(f"Loading model from {model_path}")

    # ONNX Runtime session options
    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess_options.intra_op_num_threads = 4

    model_session = ort.InferenceSession(model_path, sess_options)
    logger.info("Model loaded successfully")

# Define input/output schema for auto-documentation
input_sample = np.array([[1.0, 2.0, 3.0, 4.0, 5.0]])
output_sample = np.array([[0.1, 0.9]])

@input_schema('data', NumpyParameterType(input_sample))
@output_schema(NumpyParameterType(output_sample))
def run(data: np.ndarray) -> Dict[str, Any]:
    """
    Run inference on the input data.

    Args:
        data: Input features as numpy array

    Returns:
        Dictionary with predictions and metadata
    """
    start_time = time.time()

    try:
        # Validate input
        if not isinstance(data, np.ndarray):
            data = np.array(json.loads(data))

        # Ensure correct shape
        if len(data.shape) == 1:
            data = data.reshape(1, -1)

        # Run inference
        input_name = model_session.get_inputs()[0].name
        output_name = model_session.get_outputs()[0].name

        predictions = model_session.run(
            [output_name],
            {input_name: data.astype(np.float32)}
        )[0]

        # Calculate latency
        latency_ms = (time.time() - start_time) * 1000

        return {
            "predictions": predictions.tolist(),
            "latency_ms": round(latency_ms, 2),
            "batch_size": len(data)
        }

    except Exception as e:
        logger.error(f"Inference error: {str(e)}")
        raise
```

## Auto-Scaling Configuration

```python
from azure.ai.ml.entities import (
    ManagedOnlineDeployment,
    TargetUtilizationScaleSettings
)

# Target utilization based scaling
deployment = ManagedOnlineDeployment(
    name="production",
    endpoint_name="product-recommender",
    model="azureml:recommendation-model:1",
    instance_type="Standard_DS3_v2",
    instance_count=2,
    scale_settings=TargetUtilizationScaleSettings(
        min_instances=2,
        max_instances=10,
        target_utilization_percentage=70,
        polling_interval=60,
        scale_down_delay_in_seconds=300
    )
)

ml_client.online_deployments.begin_create_or_update(deployment)
```

## Private Endpoints for Security

```python
from azure.ai.ml.entities import ManagedOnlineEndpoint

# Create endpoint with private networking
private_endpoint = ManagedOnlineEndpoint(
    name="secure-recommender",
    description="Private recommendation service",
    auth_mode="aml_token",  # Use workspace token auth
    public_network_access="disabled"  # Only accessible via private endpoint
)

ml_client.online_endpoints.begin_create_or_update(private_endpoint)
```

## Managed Identity Authentication

```python
from azure.ai.ml.entities import ManagedOnlineDeployment
from azure.identity import ManagedIdentityCredential

# Deployment with managed identity for accessing other Azure services
deployment = ManagedOnlineDeployment(
    name="blue",
    endpoint_name="product-recommender",
    model="azureml:recommendation-model:1",
    environment="azureml:recommendation-env:1",
    instance_type="Standard_DS3_v2",
    instance_count=2,
    environment_variables={
        "KEY_VAULT_NAME": "my-keyvault",
        "COSMOS_DB_NAME": "my-cosmosdb"
    }
)

# The scoring script can use managed identity
# score.py snippet:
"""
from azure.identity import ManagedIdentityCredential
from azure.keyvault.secrets import SecretClient

credential = ManagedIdentityCredential()
vault_url = f"https://{os.environ['KEY_VAULT_NAME']}.vault.azure.net"
client = SecretClient(vault_url=vault_url, credential=credential)
secret = client.get_secret("api-key")
"""
```

## Monitoring and Metrics

```python
# View endpoint metrics via CLI
# az monitor metrics list --resource <endpoint-resource-id>

# Common metrics:
# - RequestsPerMinute
# - RequestLatency_P50, P90, P99
# - CPUUtilization
# - MemoryUtilization
# - DeploymentCapacity

# Get logs
logs = ml_client.online_deployments.get_logs(
    name="blue",
    endpoint_name="product-recommender",
    lines=500,
    container_type="inference-server"  # or "storage-initializer"
)

for line in logs.split('\n'):
    if 'ERROR' in line or 'WARNING' in line:
        print(line)
```

## Load Testing

```python
# load_test.py
import asyncio
import aiohttp
import time
import statistics

async def send_request(session, url, headers, data):
    start = time.time()
    async with session.post(url, headers=headers, json=data) as response:
        await response.json()
        return time.time() - start

async def load_test(url, headers, data, num_requests=100, concurrency=10):
    connector = aiohttp.TCPConnector(limit=concurrency)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [send_request(session, url, headers, data) for _ in range(num_requests)]
        latencies = await asyncio.gather(*tasks)

    print(f"Total requests: {num_requests}")
    print(f"Concurrency: {concurrency}")
    print(f"Mean latency: {statistics.mean(latencies)*1000:.2f} ms")
    print(f"P50 latency: {statistics.median(latencies)*1000:.2f} ms")
    print(f"P99 latency: {sorted(latencies)[int(0.99*len(latencies))]*1000:.2f} ms")

# Run load test
endpoint = ml_client.online_endpoints.get("product-recommender")
api_key = ml_client.online_endpoints.get_keys("product-recommender").primary_key

asyncio.run(load_test(
    url=endpoint.scoring_uri,
    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    data={"data": [[1.0, 2.0, 3.0, 4.0, 5.0]]},
    num_requests=1000,
    concurrency=50
))
```

## Best Practices

1. **Right-size instances**: Start small, scale based on metrics
2. **Enable auto-scaling**: Handle traffic spikes gracefully
3. **Use health probes**: Ensure reliable service availability
4. **Implement request timeouts**: Protect against slow requests
5. **Monitor P99 latency**: Track tail latency, not just averages
6. **Use private endpoints**: For sensitive production workloads

Managed online endpoints provide a robust, production-ready platform for serving ML models with enterprise-grade features out of the box.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
