---
title: "Fabric CI/CD: Building Deployment Pipelines"
author: "Michael John Peña"
draft: false
date: 2024-04-07
tags: ["Microsoft Fabric", "CI/CD", "DevOps", "Deployment", "Automation"]

---

I wrote "Fabric CI/CD: Building Deployment Pipelines" to share practical, production-minded guidance on this topic.

Implementing CI/CD for Microsoft Fabric ensures reliable, repeatable deployments of analytics artifacts. This guide covers building end-to-end deployment pipelines.

## Fabric Deployment Pipeline Concepts

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum

class DeploymentStage(Enum):
    DEVELOPMENT = "development"
    TEST = "test"
    PRODUCTION = "production"

@dataclass
class FabricDeploymentPipeline:
    name: str
    stages: List[DeploymentStage]
    workspace_mappings: Dict[DeploymentStage, str]  # stage -> workspace_id

@dataclass
class DeploymentRule:
    item_type: str
    auto_deploy: bool
    require_approval: bool
    conditions: List[str]
```

## Fabric Deployment API Client

```python
import requests
from azure.identity import DefaultAzureCredential
from typing import List, Optional
import time

class FabricDeploymentClient:
    """Client for Fabric Deployment Pipelines API"""

    def __init__(self):
        self.credential = DefaultAzureCredential()
        self.base_url = "https://api.fabric.microsoft.com/v1"

    def _get_headers(self) -> dict:
        token = self.credential.get_token(
            "https://api.fabric.microsoft.com/.default"
        )
        return {
            "Authorization": f"Bearer {token.token}",
            "Content-Type": "application/json"
        }

    def list_pipelines(self) -> List[dict]:
        """List all deployment pipelines"""
        url = f"{self.base_url}/deploymentPipelines"
        response = requests.get(url, headers=self._get_headers())
        return response.json().get("value", [])

    def get_pipeline(self, pipeline_id: str) -> dict:
        """Get pipeline details"""
        url = f"{self.base_url}/deploymentPipelines/{pipeline_id}"
        response = requests.get(url, headers=self._get_headers())
        return response.json()

    def get_pipeline_stages(self, pipeline_id: str) -> List[dict]:
        """Get stages in a pipeline"""
        url = f"{self.base_url}/deploymentPipelines/{pipeline_id}/stages"
        response = requests.get(url, headers=self._get_headers())
        return response.json().get("value", [])

    def deploy(
        self,
        pipeline_id: str,
        source_stage: int,
        target_stage: int,
        items: Optional[List[dict]] = None,
        options: Optional[dict] = None
    ) -> dict:
        """Deploy items between stages"""

        url = f"{self.base_url}/deploymentPipelines/{pipeline_id}/deploy"

        payload = {
            "sourceStageOrder": source_stage,
            "targetStageOrder": target_stage,
            "isBackwardDeployment": target_stage < source_stage
        }

        if items:
            payload["items"] = items

        if options:
            payload["options"] = options

        response = requests.post(url, headers=self._get_headers(), json=payload)
        return response.json()

    def deploy_all(
        self,
        pipeline_id: str,
        source_stage: int,
        target_stage: int
    ) -> dict:
        """Deploy all items between stages"""

        url = f"{self.base_url}/deploymentPipelines/{pipeline_id}/deployAll"

        payload = {
            "sourceStageOrder": source_stage,
            "targetStageOrder": target_stage,
            "options": {
                "allowCreateNewArtifact": True,
                "allowOverwriteArtifact": True
            }
        }

        response = requests.post(url, headers=self._get_headers(), json=payload)
        return response.json()

    def get_deployment_operation(
        self,
        pipeline_id: str,
        operation_id: str
    ) -> dict:
        """Get status of deployment operation"""

        url = f"{self.base_url}/deploymentPipelines/{pipeline_id}/operations/{operation_id}"
        response = requests.get(url, headers=self._get_headers())
        return response.json()

    def wait_for_deployment(
        self,
        pipeline_id: str,
        operation_id: str,
        timeout_seconds: int = 300
    ) -> dict:
        """Wait for deployment to complete"""

        start_time = time.time()

        while time.time() - start_time < timeout_seconds:
            operation = self.get_deployment_operation(pipeline_id, operation_id)
            status = operation.get("status")

            if status in ["Succeeded", "Failed"]:
                return operation

            time.sleep(10)

        raise TimeoutError(f"Deployment did not complete within {timeout_seconds}s")

# Usage
client = FabricDeploymentClient()

# List pipelines
pipelines = client.list_pipelines()
for p in pipelines:
    print(f"Pipeline: {p['displayName']} (ID: {p['id']})")

# Deploy from dev (stage 0) to test (stage 1)
result = client.deploy_all(
    pipeline_id="your-pipeline-id",
    source_stage=0,
    target_stage=1
)
print(f"Deployment started: {result.get('id')}")
```

## Azure DevOps Pipeline

```yaml
# azure-pipelines-fabric.yml

trigger:
  branches:
    include:
      - main
      - develop

variables:
  - group: fabric-deployment-vars
  - name: pipelineId
    value: 'your-fabric-pipeline-id'

stages:
  - stage: Build
    displayName: 'Build and Validate'
    jobs:
      - job: Validate
        pool:
          vmImage: 'ubuntu-latest'
        steps:
          - task: UsePythonVersion@0
            inputs:
              versionSpec: '3.10'

          - script: |
              pip install azure-identity requests
            displayName: 'Install dependencies'

          - script: |
              python scripts/validate_fabric_items.py
            displayName: 'Validate Fabric Items'

  - stage: DeployDev
    displayName: 'Deploy to Development'
    dependsOn: Build
    condition: eq(variables['Build.SourceBranch'], 'refs/heads/develop')
    jobs:
      - deployment: DeployDev
        environment: 'fabric-dev'
        pool:
          vmImage: 'ubuntu-latest'
        strategy:
          runOnce:
            deploy:
              steps:
                - script: |
                    python scripts/deploy_fabric.py \
                      --pipeline-id $(pipelineId) \
                      --source-stage 0 \
                      --target-stage 0 \
                      --sync-git
                  displayName: 'Sync Development'

  - stage: DeployTest
    displayName: 'Deploy to Test'
    dependsOn: DeployDev
    jobs:
      - deployment: DeployTest
        environment: 'fabric-test'
        pool:
          vmImage: 'ubuntu-latest'
        strategy:
          runOnce:
            deploy:
              steps:
                - script: |
                    python scripts/deploy_fabric.py \
                      --pipeline-id $(pipelineId) \
                      --source-stage 0 \
                      --target-stage 1
                  displayName: 'Deploy to Test Stage'

  - stage: DeployProd
    displayName: 'Deploy to Production'
    dependsOn: DeployTest
    condition: eq(variables['Build.SourceBranch'], 'refs/heads/main')
    jobs:
      - deployment: DeployProd
        environment: 'fabric-prod'
        pool:
          vmImage: 'ubuntu-latest'
        strategy:
          runOnce:
            deploy:
              steps:
                - script: |
                    python scripts/deploy_fabric.py \
                      --pipeline-id $(pipelineId) \
                      --source-stage 1 \
                      --target-stage 2
                  displayName: 'Deploy to Production Stage'
```

## Deployment Script

```python
#!/usr/bin/env python3
# scripts/deploy_fabric.py

import argparse
import sys
import requests
from azure.identity import DefaultAzureCredential

# Use the FabricDeploymentClient class defined above
# or create a simplified version here:

class FabricDeployClient:
    """Simplified deployment client for scripts"""

    def __init__(self):
        self.credential = DefaultAzureCredential()
        self.base_url = "https://api.fabric.microsoft.com/v1"

    def _get_headers(self):
        token = self.credential.get_token("https://api.fabric.microsoft.com/.default")
        return {"Authorization": f"Bearer {token.token}", "Content-Type": "application/json"}

    def deploy_all(self, pipeline_id, source_stage, target_stage):
        url = f"{self.base_url}/deploymentPipelines/{pipeline_id}/deployAll"
        payload = {"sourceStageOrder": source_stage, "targetStageOrder": target_stage}
        return requests.post(url, headers=self._get_headers(), json=payload).json()

def main():
    parser = argparse.ArgumentParser(description='Deploy Fabric items')
    parser.add_argument('--pipeline-id', required=True)
    parser.add_argument('--source-stage', type=int, required=True)
    parser.add_argument('--target-stage', type=int, required=True)
    parser.add_argument('--sync-git', action='store_true')
    parser.add_argument('--items', nargs='*', help='Specific items to deploy')

    args = parser.parse_args()

    client = FabricDeployClient()

    try:
        print(f"Starting deployment from stage {args.source_stage} to {args.target_stage}")

        if args.items:
            result = client.deploy(
                pipeline_id=args.pipeline_id,
                source_stage=args.source_stage,
                target_stage=args.target_stage,
                items=[{"name": item} for item in args.items]
            )
        else:
            result = client.deploy_all(
                pipeline_id=args.pipeline_id,
                source_stage=args.source_stage,
                target_stage=args.target_stage
            )

        operation_id = result.get("id")
        print(f"Deployment operation: {operation_id}")

        # Wait for completion
        final_status = client.wait_for_deployment(
            args.pipeline_id,
            operation_id,
            timeout_seconds=600
        )

        if final_status.get("status") == "Succeeded":
            print("Deployment succeeded!")
            sys.exit(0)
        else:
            print(f"Deployment failed: {final_status.get('error')}")
            sys.exit(1)

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
```

## Testing Deployments

```python
class FabricDeploymentTests:
    """Tests to run after deployment"""

    def __init__(self, workspace_id: str):
        self.workspace_id = workspace_id
        self.client = FabricDeploymentClient()

    def run_all_tests(self) -> dict:
        """Run all post-deployment tests"""

        results = {
            "passed": [],
            "failed": []
        }

        tests = [
            self.test_semantic_models,
            self.test_reports,
            self.test_dataflows,
            self.test_notebooks
        ]

        for test in tests:
            try:
                test()
                results["passed"].append(test.__name__)
            except AssertionError as e:
                results["failed"].append({
                    "test": test.__name__,
                    "error": str(e)
                })

        return results

    def test_semantic_models(self):
        """Verify semantic models are refreshable"""
        # Check that semantic models can connect to data sources
        pass

    def test_reports(self):
        """Verify reports load correctly"""
        # Check report definitions are valid
        pass

    def test_dataflows(self):
        """Verify dataflows are configured"""
        # Check dataflow connections
        pass

    def test_notebooks(self):
        """Verify notebooks are valid"""
        # Check notebook syntax
        pass
```

## Conclusion

CI/CD for Fabric enables reliable, automated deployments across environments. Combine deployment pipelines with Git integration and automated testing for a complete DevOps workflow.

