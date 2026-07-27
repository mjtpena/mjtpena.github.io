---
title: "Azure DevOps YAML Pipelines for Data Projects"
author: Michael John Peña
draft: false
date: 2020-09-03
tags:
  - Azure
  - DevOps
  - CI/CD
  - Data Engineering
---

The Azure DevOps Classic editor is comfortable, and I've watched many teams resist moving away from it for that exact reason. Until they need to branch a pipeline alongside a feature branch, or copy a pipeline between projects, or review pipeline changes in a pull request — and then the YAML model is suddenly the obvious answer. Pipeline-as-code, version controlled with the application it builds. Once you're there, you don't go back.

## Basic Pipeline Structure

```yaml
trigger:
  branches:
    include:
      - main
      - develop

pool:
  vmImage: 'ubuntu-latest'

variables:
  pythonVersion: '3.8'
  databricksHost: $(DATABRICKS_HOST)
  databricksToken: $(DATABRICKS_TOKEN)

stages:
  - stage: Test
    jobs:
      - job: UnitTests
        steps:
          - task: UsePythonVersion@0
            inputs:
              versionSpec: '$(pythonVersion)'

          - script: |
              pip install -r requirements.txt
              pip install pytest pytest-cov
            displayName: 'Install dependencies'

          - script: |
              pytest tests/ --cov=src --cov-report=xml
            displayName: 'Run tests'

          - task: PublishCodeCoverageResults@1
            inputs:
              codeCoverageTool: 'Cobertura'
              summaryFileLocation: 'coverage.xml'

  - stage: Deploy
    dependsOn: Test
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    jobs:
      - job: DeployNotebooks
        steps:
          - script: |
              pip install databricks-cli
              databricks configure --token <<< "$DATABRICKS_TOKEN"
              databricks workspace import_dir ./notebooks /Shared/project --overwrite
            displayName: 'Deploy to Databricks'
            env:
              DATABRICKS_HOST: $(databricksHost)
              DATABRICKS_TOKEN: $(databricksToken)
```

## Key Patterns

1. **Separate stages** for test and deploy
2. **Conditional deployment** only from main branch
3. **Secret variables** stored in pipeline variables, not YAML
4. **Artifact publishing** for audit trails

Pipeline-as-code means your deployment process is reviewed, versioned, and reproducible.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
