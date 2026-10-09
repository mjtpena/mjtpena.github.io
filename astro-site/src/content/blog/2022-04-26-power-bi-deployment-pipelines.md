---
title: "Power BI Deployment Pipelines: CI/CD for Analytics"
author: Michael John Peña
draft: false
date: 2022-04-26
tags:
  - Power BI
  - DevOps
  - CI/CD
  - Deployment
  - Enterprise
---

## Pipeline Stages

```yaml
stages:
  development:
    purpose: Active development and experimentation
    users: Report developers
    refresh: Manual or scheduled

  test:
    purpose: UAT and validation
    users: Business testers
    refresh: Scheduled

  production:
    purpose: Live business reporting
    users: End users
    refresh: Scheduled with monitoring
```

## Creating a Pipeline

```python
# Using REST API
def create_pipeline(name):
    response = requests.post(
        f"{base_url}/pipelines",
        headers=headers,
        json={"displayName": name}
    )
    return response.json()

def assign_workspace_to_stage(pipeline_id, workspace_id, stage):
    # stage: 0=Development, 1=Test, 2=Production
    response = requests.post(
        f"{base_url}/pipelines/{pipeline_id}/stages/{stage}/assignWorkspace",
        headers=headers,
        json={"workspaceId": workspace_id}
    )
    return response.json()
```

## Deployment Operations

### Deploy to Next Stage

```python
def deploy_all(pipeline_id, source_stage):
    response = requests.post(
        f"{base_url}/pipelines/{pipeline_id}/deployAll",
        headers=headers,
        json={
            "sourceStageOrder": source_stage,
            "options": {
                "allowOverwriteArtifact": True,
                "allowCreateArtifact": True
            }
        }
    )
    return response.json()

def deploy_selective(pipeline_id, source_stage, items):
    response = requests.post(
        f"{base_url}/pipelines/{pipeline_id}/deploy",
        headers=headers,
        json={
            "sourceStageOrder": source_stage,
            "reports": [{"sourceId": r} for r in items["reports"]],
            "datasets": [{"sourceId": d} for d in items["datasets"]],
            "options": {
                "allowOverwriteArtifact": True
            }
        }
    )
    return response.json()
```

### Deployment Rules

```python
def create_deployment_rule(pipeline_id, dataset_id, rule):
    # Rule for parameter changes between stages
    response = requests.post(
        f"{base_url}/pipelines/{pipeline_id}/stages/1/deploymentRules",
        headers=headers,
        json={
            "datasetId": dataset_id,
            "rules": [
                {
                    "ruleType": "Parameter",
                    "ruleName": "ServerName",
                    "ruleConfiguration": {
                        "value": rule["test_server"]
                    }
                }
            ]
        }
    )
    return response.json()
```

## Automation with Azure DevOps

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - main
      - develop

stages:
  - stage: DeployToDev
    condition: eq(variables['Build.SourceBranch'], 'refs/heads/develop')
    jobs:
      - job: DeployReports
        steps:
          - task: PowerShell@2
            inputs:
              filePath: 'scripts/deploy-powerbi.ps1'
              arguments: '-Stage Development'

  - stage: DeployToTest
    condition: eq(variables['Build.SourceBranch'], 'refs/heads/main')
    jobs:
      - job: DeployReports
        steps:
          - task: PowerShell@2
            inputs:
              filePath: 'scripts/deploy-powerbi.ps1'
              arguments: '-Stage Test'

  - stage: DeployToProd
    condition: eq(variables['Build.SourceBranch'], 'refs/heads/main')
    dependsOn: DeployToTest
    jobs:
      - deployment: DeployReports
        environment: 'production'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: PowerShell@2
                  inputs:
                    filePath: 'scripts/deploy-powerbi.ps1'
                    arguments: '-Stage Production'
```

## PowerShell Deployment Script

```powershell
param(
    [string]$Stage
)

$stageMap = @{
    "Development" = 0
    "Test" = 1
    "Production" = 2
}

$sourceStage = $stageMap[$Stage] - 1

# Authenticate
$token = Get-PowerBIAccessToken

# Deploy
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

$body = @{
    sourceStageOrder = $sourceStage
    options = @{
        allowOverwriteArtifact = $true
        allowCreateArtifact = $true
    }
} | ConvertTo-Json

Invoke-RestMethod `
    -Uri "https://api.powerbi.com/v1.0/myorg/pipelines/$PipelineId/deployAll" `
    -Method Post `
    -Headers $headers `
    -Body $body

Write-Host "Deployment to $Stage completed"
```

## Best Practices

```yaml
workflow:
  - Develop in dedicated workspace
  - Test with production-like data
  - Use deployment rules for environment config
  - Require approvals for production

governance:
  - Document deployment procedures
  - Track changes and versions
  - Maintain rollback capability
  - Audit all deployments

automation:
  - Integrate with CI/CD pipelines
  - Automate testing before promotion
  - Schedule off-peak deployments
```

## Conclusion

Deployment Pipelines bring enterprise ALM to Power BI:
- Controlled content promotion
- Environment-specific configurations
- Audit trail of deployments
- Integration with DevOps processes

## Resources

- [Deployment Pipelines Documentation](https://docs.microsoft.com/en-us/power-bi/create-reports/deployment-pipelines-overview)
- [REST API Reference](https://docs.microsoft.com/en-us/rest/api/power-bi/pipelines)
