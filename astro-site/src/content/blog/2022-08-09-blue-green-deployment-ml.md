---
title: "Blue-Green Deployment for ML Models"
description: "Blue-green deployment provides a safe, zero-downtime approach to updating ML models in production."
author: "Michael John Peña"
draft: false
date: 2022-08-09
tags: ["Azure", "Machine Learning", "MLOps", "Deployment", "Blue-Green"]
---

## Understanding Blue-Green Deployment

In blue-green deployment:
- **Blue**: Current production deployment
- **Green**: New version being tested
- Traffic switches instantly when green is validated

## Setting Up Blue-Green

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import (
    ManagedOnlineEndpoint,
    ManagedOnlineDeployment,
    Model,
    Environment,
    CodeConfiguration
)
from azure.identity import DefaultAzureCredential

ml_client = MLClient(
    credential=DefaultAzureCredential(),
    subscription_id="your-subscription",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Create endpoint
endpoint = ManagedOnlineEndpoint(
    name="model-endpoint",
    description="Production ML endpoint",
    auth_mode="key"
)

ml_client.online_endpoints.begin_create_or_update(endpoint).result()
```

## Deploy Blue (Current Version)

```python
# Blue deployment - v1 of the model
blue_model = Model(path="./models/v1", name="prediction-model", version="1")
registered_blue = ml_client.models.create_or_update(blue_model)

blue_deployment = ManagedOnlineDeployment(
    name="blue",
    endpoint_name="model-endpoint",
    model=registered_blue,
    environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu@latest",
    code_configuration=CodeConfiguration(
        code="./src",
        scoring_script="score.py"
    ),
    instance_type="Standard_DS2_v2",
    instance_count=2
)

ml_client.online_deployments.begin_create_or_update(blue_deployment).result()

# Route all traffic to blue
endpoint.traffic = {"blue": 100}
ml_client.online_endpoints.begin_create_or_update(endpoint).result()

print("Blue deployment live with 100% traffic")
```

## Deploy Green (New Version)

```python
# Green deployment - v2 of the model
green_model = Model(path="./models/v2", name="prediction-model", version="2")
registered_green = ml_client.models.create_or_update(green_model)

green_deployment = ManagedOnlineDeployment(
    name="green",
    endpoint_name="model-endpoint",
    model=registered_green,
    environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu@latest",
    code_configuration=CodeConfiguration(
        code="./src",
        scoring_script="score_v2.py"
    ),
    instance_type="Standard_DS2_v2",
    instance_count=2
)

ml_client.online_deployments.begin_create_or_update(green_deployment).result()
print("Green deployment created (no traffic yet)")
```

## Testing Green Deployment

```python
import requests
import json

def test_deployment(endpoint_name, deployment_name, test_data):
    """Test a specific deployment"""
    endpoint = ml_client.online_endpoints.get(endpoint_name)
    api_key = ml_client.online_endpoints.get_keys(endpoint_name).primary_key

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "azureml-model-deployment": deployment_name  # Target specific deployment
    }

    response = requests.post(
        endpoint.scoring_uri,
        data=json.dumps(test_data),
        headers=headers
    )

    return response.json()

# Test green deployment without affecting production traffic
test_data = {"data": [[1, 2, 3, 4, 5]]}

print("Testing Green deployment:")
green_result = test_deployment("model-endpoint", "green", test_data)
print(f"Green response: {green_result}")

print("\nTesting Blue deployment (current production):")
blue_result = test_deployment("model-endpoint", "blue", test_data)
print(f"Blue response: {blue_result}")
```

## Validation Tests

```python
class DeploymentValidator:
    def __init__(self, ml_client, endpoint_name):
        self.ml_client = ml_client
        self.endpoint_name = endpoint_name

    def validate_deployment(self, deployment_name, test_cases):
        """Run validation tests against a deployment"""
        results = []

        for test in test_cases:
            try:
                response = test_deployment(
                    self.endpoint_name,
                    deployment_name,
                    test["input"]
                )

                # Check response
                passed = self._check_response(response, test.get("expected"))
                results.append({
                    "test": test["name"],
                    "passed": passed,
                    "response": response
                })
            except Exception as e:
                results.append({
                    "test": test["name"],
                    "passed": False,
                    "error": str(e)
                })

        return results

    def _check_response(self, response, expected):
        """Check if response meets expectations"""
        if expected is None:
            return "predictions" in response

        if "predictions" in expected:
            return response.get("predictions") == expected["predictions"]

        return True

    def run_smoke_tests(self, deployment_name):
        """Run basic smoke tests"""
        test_cases = [
            {
                "name": "basic_prediction",
                "input": {"data": [[1, 2, 3, 4, 5]]},
                "expected": None  # Just check it returns predictions
            },
            {
                "name": "batch_prediction",
                "input": {"data": [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]]},
                "expected": None
            },
            {
                "name": "edge_case_zeros",
                "input": {"data": [[0, 0, 0, 0, 0]]},
                "expected": None
            }
        ]

        return self.validate_deployment(deployment_name, test_cases)

# Run validation
validator = DeploymentValidator(ml_client, "model-endpoint")
validation_results = validator.run_smoke_tests("green")

all_passed = all(r["passed"] for r in validation_results)
print(f"Validation {'PASSED' if all_passed else 'FAILED'}")
for result in validation_results:
    status = "PASS" if result["passed"] else "FAIL"
    print(f"  [{status}] {result['test']}")
```

## Switch Traffic

```python
def switch_traffic(ml_client, endpoint_name, from_deployment, to_deployment):
    """Switch all traffic from one deployment to another"""
    endpoint = ml_client.online_endpoints.get(endpoint_name)

    # Instant switch
    endpoint.traffic = {to_deployment: 100, from_deployment: 0}
    ml_client.online_endpoints.begin_create_or_update(endpoint).result()

    print(f"Traffic switched from {from_deployment} to {to_deployment}")

# Switch to green after validation passes
if all_passed:
    switch_traffic(ml_client, "model-endpoint", "blue", "green")
    print("Green is now production!")
else:
    print("Validation failed - keeping blue as production")
```

## Rollback Procedure

```python
def rollback(ml_client, endpoint_name, to_deployment):
    """Rollback to previous deployment"""
    endpoint = ml_client.online_endpoints.get(endpoint_name)

    # Get current traffic allocation
    current_traffic = endpoint.traffic
    print(f"Current traffic: {current_traffic}")

    # Switch back
    endpoint.traffic = {to_deployment: 100}
    ml_client.online_endpoints.begin_create_or_update(endpoint).result()

    print(f"Rolled back to {to_deployment}")

# Example rollback
# rollback(ml_client, "model-endpoint", "blue")
```

## Cleanup Old Deployment

```python
def cleanup_old_deployment(ml_client, endpoint_name, deployment_name):
    """Remove old deployment after successful switch"""
    # Verify it has no traffic
    endpoint = ml_client.online_endpoints.get(endpoint_name)
    if endpoint.traffic.get(deployment_name, 0) > 0:
        raise ValueError(f"Cannot delete {deployment_name} - still has traffic")

    # Delete
    ml_client.online_deployments.begin_delete(
        name=deployment_name,
        endpoint_name=endpoint_name
    ).result()

    print(f"Deleted {deployment_name}")

# After green is stable, clean up blue
# cleanup_old_deployment(ml_client, "model-endpoint", "blue")
```

Blue-green deployment provides a safe, zero-downtime approach to updating ML models in production.
