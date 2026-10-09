---
title: "Fabric Git Integration: Version Control for Your Data Platform"
description: "Git integration in Fabric is something I've been waiting for since the first preview. Power BI's lack of proper version control has been a persistent…"
author: Michael John Peña
draft: false
date: 2023-06-10
tags:
  - Microsoft Fabric
  - Git
  - Version Control
  - DevOps
  - CI/CD
---

Git integration in Fabric is something I've been waiting for since the first preview. Power BI's lack of proper version control has been a persistent frustration for teams trying to apply software engineering discipline to their data platform — deploying from files rather than clicking through a UI, reviewing changes in pull requests, rolling back cleanly. Fabric's Git integration connects a workspace to an Azure DevOps repository (GitHub support is coming but not here at preview launch) and stores item definitions as structured folders — notebooks as .ipynb files, pipelines as JSON definitions, semantic models in TMDL format. The commit/update workflow feels close enough to standard Git that a developer familiar with pull requests can navigate it quickly.

## Git Integration Overview

```
┌─────────────────────────────────────────────────────┐
│              Fabric Git Integration                  │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │            Fabric Workspace                      ││
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐          ││
│  │  │Lakehouse│ │Notebook │ │ Pipeline│          ││
│  │  └─────────┘ └─────────┘ └─────────┘          ││
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐          ││
│  │  │Dataflow │ │Semantic │ │ Report  │          ││
│  │  │         │ │ Model   │ │         │          ││
│  │  └─────────┘ └─────────┘ └─────────┘          ││
│  └──────────────────┬──────────────────────────────┘│
│                     │                               │
│                     │ Sync                          │
│                     ▼                               │
│  ┌─────────────────────────────────────────────────┐│
│  │              Git Repository                      ││
│  │  (Azure DevOps or GitHub)                       ││
│  │                                                  ││
│  │  /workspace/                                     ││
│  │    /lakehouse.Lakehouse/                        ││
│  │    /notebook.Notebook/                          ││
│  │    /pipeline.DataPipeline/                      ││
│  │    /dataflow.Dataflow/                          ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Setting Up Git Integration

### Connect to Azure DevOps

```python
# Steps in Fabric Portal:
# 1. Workspace settings > Git integration
# 2. Select Git provider (Azure DevOps or GitHub)
# 3. Authenticate and select organization
# 4. Select repository and branch
# 5. Choose folder for workspace content

git_config = {
    "provider": "AzureDevOps",
    "organization": "myorg",
    "project": "DataPlatform",
    "repository": "fabric-workspace",
    "branch": "main",
    "folder": "/dev-workspace"
}
```

### Connect to GitHub

```python
# For GitHub:
# 1. Workspace settings > Git integration
# 2. Select GitHub
# 3. Authenticate with GitHub
# 4. Select repository

github_config = {
    "provider": "GitHub",
    "owner": "myorg",
    "repository": "fabric-workspace",
    "branch": "main",
    "folder": "/workspaces/development"
}
```

## Supported Item Types

```python
# Items that can be version controlled
supported_items = {
    "fully_supported": [
        "Notebooks",
        "Spark Job Definitions",
        "Pipelines",
        "Dataflows Gen2",
        "Semantic Models (TMDL format)",
        "Reports (PBIR format)",
        "Paginated Reports",
        "Environments"
    ],
    "metadata_only": [
        "Lakehouses (definition, not data)",
        "Warehouses (definition, not data)",
        "KQL Databases",
        "Eventstreams"
    ],
    "not_supported": [
        "Data content in tables",
        "Files in Lakehouse Files folder",
        "Actual data"
    ]
}
```

## Working with Git

### Commit Changes

```python
# After making changes in Fabric:
# 1. Click "Source control" in workspace
# 2. Review changes
# 3. Select items to commit
# 4. Enter commit message
# 5. Commit

# Changes are pushed to the connected Git branch
```

### Pull Changes

```python
# To get changes from Git:
# 1. Click "Source control"
# 2. Click "Update all"
# 3. Review incoming changes
# 4. Confirm update

# Workspace items are updated from Git
```

### Branching Strategy

```
┌─────────────────────────────────────────────────────┐
│              Recommended Branch Strategy             │
├─────────────────────────────────────────────────────┤
│                                                      │
│  main (Production)                                  │
│    │                                                │
│    ├── release/v1.0                                │
│    │                                                │
│    └── develop                                      │
│          │                                          │
│          ├── feature/new-pipeline                  │
│          │                                          │
│          ├── feature/lakehouse-updates             │
│          │                                          │
│          └── bugfix/fix-dataflow                   │
│                                                      │
│  Workspaces:                                        │
│  - Dev workspace    → develop branch               │
│  - Test workspace   → release branch               │
│  - Prod workspace   → main branch                  │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## File Structure in Git

```
fabric-workspace/
├── workspace/
│   ├── SalesLakehouse.Lakehouse/
│   │   └── .platform                    # Lakehouse definition
│   │
│   ├── TransformSales.Notebook/
│   │   ├── .platform
│   │   └── notebook-content.py          # Notebook code
│   │
│   ├── DailySalesPipeline.DataPipeline/
│   │   ├── .platform
│   │   └── pipeline-content.json        # Pipeline definition
│   │
│   ├── SalesDataflow.Dataflow/
│   │   ├── .platform
│   │   └── dataflow-content.json        # Dataflow M code
│   │
│   ├── SalesModel.SemanticModel/
│   │   ├── .platform
│   │   ├── model.tmdl                   # Model definition
│   │   ├── tables/
│   │   │   ├── Sales.tmdl
│   │   │   └── Customer.tmdl
│   │   ├── relationships.tmdl
│   │   └── cultures/
│   │       └── en-US.tmdl
│   │
│   └── SalesReport.Report/
│       ├── .platform
│       └── report.json                  # Report definition
│
└── .gitignore
```

## CI/CD with Azure DevOps

### Build Pipeline

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - main
      - develop

pool:
  vmImage: 'ubuntu-latest'

stages:
  - stage: Validate
    jobs:
      - job: ValidateFabricArtifacts
        steps:
          - task: UsePythonVersion@0
            inputs:
              versionSpec: '3.10'

          - script: |
              pip install jsonschema pyyaml
            displayName: 'Install validation tools'

          - script: |
              python scripts/validate_notebooks.py
              python scripts/validate_pipelines.py
            displayName: 'Validate Fabric artifacts'

  - stage: Deploy_Dev
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/develop'))
    jobs:
      - deployment: DeployToDev
        environment: 'Development'
        strategy:
          runOnce:
            deploy:
              steps:
                - script: |
                    echo "Dev workspace syncs automatically via Git"
                  displayName: 'Dev deployment note'

  - stage: Deploy_Prod
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    jobs:
      - deployment: DeployToProd
        environment: 'Production'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: PowerShell@2
                  inputs:
                    targetType: 'inline'
                    script: |
                      # Use Fabric APIs to trigger deployment
                      # Or use deployment pipelines
                  displayName: 'Deploy to Production'
```

### Validation Script

```python
# scripts/validate_notebooks.py
import json
import os
import sys

def validate_notebook(path):
    """Validate notebook structure"""
    errors = []

    if not os.path.exists(path):
        errors.append(f"Notebook path not found: {path}")
        return errors

    # Check for required files
    platform_file = os.path.join(path, ".platform")
    if not os.path.exists(platform_file):
        errors.append(f"Missing .platform file in {path}")

    # Validate notebook content
    for file in os.listdir(path):
        if file.endswith('.py'):
            notebook_path = os.path.join(path, file)
            with open(notebook_path, 'r') as f:
                content = f.read()
                # Check for common issues
                if 'hardcoded_password' in content.lower():
                    errors.append(f"Potential hardcoded credential in {notebook_path}")
                if 'localhost' in content and 'test' not in path.lower():
                    errors.append(f"Localhost reference in {notebook_path}")

    return errors

def main():
    workspace_path = "workspace"
    all_errors = []

    for item in os.listdir(workspace_path):
        if item.endswith('.Notebook'):
            item_path = os.path.join(workspace_path, item)
            errors = validate_notebook(item_path)
            all_errors.extend(errors)

    if all_errors:
        print("Validation errors found:")
        for error in all_errors:
            print(f"  - {error}")
        sys.exit(1)
    else:
        print("All notebooks validated successfully")
        sys.exit(0)

if __name__ == "__main__":
    main()
```

## Best Practices

```python
git_best_practices = {
    "branching": [
        "Use feature branches for development",
        "Protect main/release branches",
        "Require pull request reviews",
        "Use meaningful branch names"
    ],
    "commits": [
        "Write descriptive commit messages",
        "Commit related changes together",
        "Don't commit sensitive data",
        "Review changes before committing"
    ],
    "workflow": [
        "Sync frequently to avoid conflicts",
        "Test changes before pushing",
        "Use deployment pipelines for promotion",
        "Document workspace dependencies"
    ],
    "collaboration": [
        "Establish team conventions",
        "Use consistent naming",
        "Review pull requests thoroughly",
        "Communicate workspace changes"
    ]
}
```

Git integration enables proper version control and CI/CD for Fabric. Tomorrow, I will cover Fabric Deployment Pipelines.

## Resources

- [Git Integration Overview](https://learn.microsoft.com/en-us/fabric/cicd/git-integration/intro-to-git-integration)
- [Git Best Practices](https://learn.microsoft.com/en-us/fabric/cicd/git-integration/git-best-practices)
- [CI/CD with Fabric](https://learn.microsoft.com/en-us/fabric/cicd/cicd-overview)
