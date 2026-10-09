---
title: "Fabric Deployment Pipelines: Promoting Content Across Environments"
description: "Deployment Pipelines provide controlled, auditable content promotion across environments. Tomorrow, I will cover Fabric Monitoring."
author: Michael John Peña
draft: false
date: 2023-06-11
tags:
  - Microsoft Fabric
  - Deployment Pipelines
  - DevOps
  - CI/CD
  - alm
---

## Deployment Pipeline Concept

```
┌─────────────────────────────────────────────────────┐
│            Fabric Deployment Pipeline                │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐      │
│  │   DEV    │───▶│   TEST   │───▶│   PROD   │      │
│  │Workspace │    │Workspace │    │Workspace │      │
│  └──────────┘    └──────────┘    └──────────┘      │
│       │               │               │             │
│       │               │               │             │
│  ┌────┴────┐    ┌────┴────┐    ┌────┴────┐        │
│  │Lakehouse│    │Lakehouse│    │Lakehouse│        │
│  │Notebooks│    │Notebooks│    │Notebooks│        │
│  │Pipelines│    │Pipelines│    │Pipelines│        │
│  │Reports  │    │Reports  │    │Reports  │        │
│  └─────────┘    └─────────┘    └─────────┘        │
│                                                      │
│  Deployment Rules:                                  │
│  - Parameter substitution per stage                │
│  - Connection string updates                        │
│  - Selective deployment                            │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Creating a Deployment Pipeline

```python
# Steps in Fabric Portal:
# 1. Go to Deployment Pipelines
# 2. Create new pipeline
# 3. Assign workspaces to stages

pipeline_config = {
    "name": "Sales Analytics Pipeline",
    "stages": [
        {
            "name": "Development",
            "workspace": "Sales Analytics - Dev",
            "order": 0
        },
        {
            "name": "Test",
            "workspace": "Sales Analytics - Test",
            "order": 1
        },
        {
            "name": "Production",
            "workspace": "Sales Analytics - Prod",
            "order": 2
        }
    ]
}
```

## Deployment Rules

Configure rules to automatically update values when deploying:

```python
# Deployment rules configuration
deployment_rules = {
    "lakehouse_rules": [
        {
            "item_name": "SalesLakehouse",
            "parameter": "Environment",
            "dev_value": "dev",
            "test_value": "test",
            "prod_value": "prod"
        }
    ],
    "connection_rules": [
        {
            "item_name": "DataPipeline",
            "parameter": "SourceServer",
            "dev_value": "dev-server.database.windows.net",
            "test_value": "test-server.database.windows.net",
            "prod_value": "prod-server.database.windows.net"
        },
        {
            "item_name": "DataPipeline",
            "parameter": "SourceDatabase",
            "dev_value": "SalesDB_Dev",
            "test_value": "SalesDB_Test",
            "prod_value": "SalesDB_Prod"
        }
    ],
    "dataflow_rules": [
        {
            "item_name": "SalesDataflow",
            "parameter": "TargetTable",
            "dev_value": "sales_dev",
            "test_value": "sales_test",
            "prod_value": "sales"
        }
    ]
}
```

### Setting Rules via UI

```python
# In Deployment Pipeline:
# 1. Click "Deployment settings" (gear icon)
# 2. Select item type (Dataflow, Pipeline, etc.)
# 3. Select specific item
# 4. Configure parameter rules
# 5. Save

# Rule types:
rule_types = {
    "data_source_rules": "Change connection strings per stage",
    "parameter_rules": "Update pipeline/dataflow parameters",
    "lakehouse_rules": "Point to different Lakehouse per stage",
    "warehouse_rules": "Point to different Warehouse per stage"
}
```

## Deploying Content

### Manual Deployment

```python
# Deploy from Dev to Test:
# 1. Open Deployment Pipeline
# 2. Click "Deploy" button between Dev and Test
# 3. Select items to deploy
# 4. Review changes
# 5. Click "Deploy"

# Deployment comparison shows:
comparison_info = {
    "new_items": "Items that don't exist in target",
    "changed_items": "Items with differences",
    "unchanged_items": "Items that are identical",
    "deleted_items": "Items removed from source"
}
```

### Selective Deployment

```python
# Deploy specific items only:
# 1. Select specific items instead of "Select all"
# 2. Choose notebooks, pipelines, or reports individually
# 3. Deploy selected items

# Best practices:
# - Deploy related items together
# - Test dependencies are included
# - Verify Lakehouse connections
```

### API-Based Deployment

```python
from azure.identity import DefaultAzureCredential
import requests

def deploy_to_stage(
    pipeline_id: str,
    source_stage: int,
    target_stage: int,
    items: list = None
):
    """Deploy content between stages"""

    credential = DefaultAzureCredential()
    token = credential.get_token("https://api.fabric.microsoft.com/.default")

    url = f"https://api.fabric.microsoft.com/v1/deploymentPipelines/{pipeline_id}/deploy"

    headers = {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json"
    }

    payload = {
        "sourceStageOrder": source_stage,
        "targetStageOrder": target_stage,
        "note": "Automated deployment",
        "options": {
            "allowPurgeData": False,
            "allowTakeOver": True,
            "allowSkipTilesWithMissingPrerequisites": True
        }
    }

    if items:
        payload["items"] = [{"itemId": item_id} for item_id in items]

    response = requests.post(url, headers=headers, json=payload)
    return response.json()

# Deploy from Dev (0) to Test (1)
result = deploy_to_stage(
    pipeline_id="pipeline-guid",
    source_stage=0,
    target_stage=1
)
print(f"Deployment status: {result}")
```

## Deployment Validation

```python
def validate_before_deployment(pipeline_id: str, source_stage: int, target_stage: int):
    """Check for potential deployment issues"""

    issues = []

    # Check for missing dependencies
    # Check for breaking changes
    # Validate deployment rules are configured

    # API call to get pipeline stages
    stages = get_pipeline_stages(pipeline_id)

    source_items = stages[source_stage]["items"]
    target_items = stages[target_stage]["items"]

    # Check for items that would be deleted
    for target_item in target_items:
        if target_item not in source_items:
            issues.append(f"Item will be removed: {target_item['name']}")

    # Check for new dependencies
    for source_item in source_items:
        if source_item.get("dependencies"):
            for dep in source_item["dependencies"]:
                if dep not in [i["id"] for i in source_items]:
                    issues.append(f"Missing dependency: {dep} for {source_item['name']}")

    return issues
```

## Deployment Best Practices

```python
deployment_best_practices = {
    "process": [
        "Always deploy to Test before Production",
        "Validate in Test environment thoroughly",
        "Document changes in deployment notes",
        "Schedule production deployments during low-usage periods"
    ],
    "configuration": [
        "Use deployment rules for environment-specific settings",
        "Don't hardcode environment values in items",
        "Use parameters for all environment-specific values",
        "Test deployment rules in Dev->Test first"
    ],
    "safety": [
        "Review changes before deploying",
        "Keep production workspace permissions restricted",
        "Maintain backups of critical reports",
        "Have rollback plan ready"
    ],
    "automation": [
        "Use APIs for CI/CD integration",
        "Implement approval workflows",
        "Set up deployment notifications",
        "Log all deployments for auditing"
    ]
}
```

## Integration with Azure DevOps

```yaml
# azure-pipelines.yml - Deployment stage
stages:
  - stage: Deploy_To_Test
    displayName: 'Deploy to Test Environment'
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/develop'))
    jobs:
      - deployment: DeployTest
        environment: 'Fabric-Test'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: PowerShell@2
                  displayName: 'Deploy via Fabric API'
                  inputs:
                    targetType: 'inline'
                    script: |
                      $token = (Get-AzAccessToken -ResourceUrl "https://api.fabric.microsoft.com").Token

                      $headers = @{
                        "Authorization" = "Bearer $token"
                        "Content-Type" = "application/json"
                      }

                      $body = @{
                        sourceStageOrder = 0
                        targetStageOrder = 1
                        note = "Azure DevOps deployment - Build $(Build.BuildId)"
                      } | ConvertTo-Json

                      $response = Invoke-RestMethod `
                        -Uri "https://api.fabric.microsoft.com/v1/deploymentPipelines/$(PIPELINE_ID)/deploy" `
                        -Method Post `
                        -Headers $headers `
                        -Body $body

                      Write-Host "Deployment initiated: $($response.id)"
```

Deployment Pipelines provide controlled, auditable content promotion across environments. Tomorrow, I will cover Fabric Monitoring.

## Resources

- [Deployment Pipelines Overview](https://learn.microsoft.com/en-us/fabric/cicd/deployment-pipelines/intro-to-deployment-pipelines)
- [Deployment Rules](https://learn.microsoft.com/en-us/fabric/cicd/deployment-pipelines/create-rules)
- [Deployment Pipeline API](https://learn.microsoft.com/en-us/rest/api/fabric/deploymentpipelines)
