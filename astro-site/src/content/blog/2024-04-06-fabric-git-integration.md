---
title: "Fabric Git Integration: Version Control for Analytics"
author: "Michael John Peña"
draft: false
date: 2024-04-06
tags: ["Microsoft Fabric", "Git", "DevOps", "Version Control", "Data"]

---

I wrote "Fabric Git Integration: Version Control for Analytics" to share practical, production-minded guidance on this topic.

Microsoft Fabric's Git integration brings modern version control practices to analytics. This guide covers setting up and using Git with Fabric workspaces.

## Git Integration Overview

```python
FABRIC_GIT_SUPPORTED_ITEMS = {
    "fully_supported": [
        "Notebooks",
        "Spark Job Definitions",
        "Reports",
        "Paginated Reports",
        "Semantic Models (Datasets)",
        "Pipelines",
        "Dataflows Gen2"
    ],
    "metadata_only": [
        "Lakehouses",
        "Warehouses",
        "KQL Databases"
    ],
    "not_supported": [
        "Datamarts",
        "Real-Time Analytics"
    ]
}
```

## Setting Up Git Integration

```python
# Fabric Git integration can be configured via the UI or API

import requests
from azure.identity import DefaultAzureCredential

class FabricGitManager:
    """Manage Fabric Git integration"""

    def __init__(self, workspace_id: str):
        self.workspace_id = workspace_id
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

    def connect_to_git(
        self,
        git_provider: str,
        organization: str,
        project: str,
        repository: str,
        branch: str,
        directory: str = "/"
    ) -> dict:
        """Connect workspace to Git repository"""

        url = f"{self.base_url}/workspaces/{self.workspace_id}/git/connect"

        payload = {
            "gitProviderDetails": {
                "organizationName": organization,
                "projectName": project,
                "gitProviderType": git_provider,  # "AzureDevOps" or "GitHub"
                "repositoryName": repository,
                "branchName": branch,
                "directoryName": directory
            }
        }

        response = requests.post(url, headers=self._get_headers(), json=payload)
        return response.json()

    def get_git_status(self) -> dict:
        """Get current Git status of workspace"""

        url = f"{self.base_url}/workspaces/{self.workspace_id}/git/status"
        response = requests.get(url, headers=self._get_headers())
        return response.json()

    def commit_to_git(
        self,
        message: str,
        items: list = None
    ) -> dict:
        """Commit workspace changes to Git"""

        url = f"{self.base_url}/workspaces/{self.workspace_id}/git/commitToGit"

        payload = {
            "mode": "All" if items is None else "Selective",
            "comment": message
        }

        if items:
            payload["items"] = items

        response = requests.post(url, headers=self._get_headers(), json=payload)
        return response.json()

    def update_from_git(self) -> dict:
        """Update workspace from Git repository"""

        url = f"{self.base_url}/workspaces/{self.workspace_id}/git/updateFromGit"

        payload = {
            "conflictResolution": {
                "conflictResolutionType": "Workspace"  # or "RemoteGit"
            }
        }

        response = requests.post(url, headers=self._get_headers(), json=payload)
        return response.json()

    def disconnect_from_git(self) -> dict:
        """Disconnect workspace from Git"""

        url = f"{self.base_url}/workspaces/{self.workspace_id}/git/disconnect"
        response = requests.post(url, headers=self._get_headers())
        return response.json()

# Usage
git_manager = FabricGitManager("workspace-id")

# Connect to Azure DevOps
git_manager.connect_to_git(
    git_provider="AzureDevOps",
    organization="myorg",
    project="analytics",
    repository="fabric-workspace",
    branch="main",
    directory="/fabric"
)
```

## Branching Strategy for Fabric

```python
# Recommended branching strategy for Fabric workspaces

FABRIC_BRANCHING_STRATEGY = {
    "branches": {
        "main": {
            "purpose": "Production-ready code",
            "workspace": "Production workspace",
            "protection": ["require_pr", "require_review"]
        },
        "develop": {
            "purpose": "Integration branch",
            "workspace": "Development workspace",
            "protection": ["require_pr"]
        },
        "feature/*": {
            "purpose": "Feature development",
            "workspace": "Feature workspaces (optional)",
            "protection": []
        }
    },
    "workflow": [
        "1. Create feature branch from develop",
        "2. Make changes in feature workspace",
        "3. Commit and push to feature branch",
        "4. Create PR to develop",
        "5. Review and merge to develop",
        "6. Test in development workspace",
        "7. Create PR from develop to main",
        "8. Deploy to production workspace"
    ]
}
```

## Workspace Synchronization

```python
class WorkspaceSync:
    """Synchronize Fabric workspaces with Git"""

    def __init__(self, workspace_mappings: dict):
        """
        workspace_mappings: {
            "branch_name": "workspace_id"
        }
        """
        self.mappings = workspace_mappings
        self.managers = {
            branch: FabricGitManager(ws_id)
            for branch, ws_id in workspace_mappings.items()
        }

    def sync_workspace(self, branch: str):
        """Sync workspace with its connected branch"""

        if branch not in self.managers:
            raise ValueError(f"No workspace mapping for branch: {branch}")

        manager = self.managers[branch]

        # Get status
        status = manager.get_git_status()

        if status.get("hasUncommittedChanges"):
            print(f"Warning: {branch} workspace has uncommitted changes")
            return

        # Update from Git
        result = manager.update_from_git()
        print(f"Updated {branch} workspace from Git")
        return result

    def promote(self, source_branch: str, target_branch: str, message: str):
        """Promote changes between workspaces"""

        # This would typically be done through Git PRs
        # Here we show the workspace perspective

        source_manager = self.managers[source_branch]
        target_manager = self.managers[target_branch]

        # Commit source changes
        source_manager.commit_to_git(f"Pre-promotion commit: {message}")

        # Update target from Git (after Git-side merge)
        target_manager.update_from_git()

        print(f"Promoted from {source_branch} to {target_branch}")

# Usage
sync = WorkspaceSync({
    "main": "prod-workspace-id",
    "develop": "dev-workspace-id"
})

# Sync development workspace
sync.sync_workspace("develop")
```

## Git Workflow Automation

```yaml
# Azure DevOps Pipeline for Fabric Git Integration
# azure-pipelines.yml

trigger:
  branches:
    include:
      - main
      - develop

pool:
  vmImage: 'ubuntu-latest'

stages:
  - stage: ValidateChanges
    jobs:
      - job: Validate
        steps:
          - script: |
              echo "Validating Fabric changes..."
              # Add validation scripts here
            displayName: 'Validate Changes'

  - stage: DeployToDev
    condition: eq(variables['Build.SourceBranch'], 'refs/heads/develop')
    jobs:
      - deployment: DeployDev
        environment: 'fabric-development'
        strategy:
          runOnce:
            deploy:
              steps:
                - script: |
                    python scripts/sync_workspace.py --workspace dev --branch develop
                  displayName: 'Sync Development Workspace'

  - stage: DeployToProd
    condition: eq(variables['Build.SourceBranch'], 'refs/heads/main')
    jobs:
      - deployment: DeployProd
        environment: 'fabric-production'
        strategy:
          runOnce:
            deploy:
              steps:
                - script: |
                    python scripts/sync_workspace.py --workspace prod --branch main
                  displayName: 'Sync Production Workspace'
```

## Best Practices

```python
GIT_INTEGRATION_BEST_PRACTICES = {
    "organization": [
        "One repository per workspace or logical group",
        "Clear directory structure in repository",
        "Meaningful commit messages"
    ],
    "branching": [
        "Protect main/production branches",
        "Use pull requests for all changes",
        "Match branches to workspace environments"
    ],
    "workflow": [
        "Commit frequently with small changes",
        "Resolve conflicts in development first",
        "Test thoroughly before promoting"
    ],
    "collaboration": [
        "Document workspace-branch mappings",
        "Establish code review standards",
        "Use consistent naming conventions"
    ]
}
```

## Conclusion

Git integration brings proper version control to Fabric analytics development. Use branching strategies, automated pipelines, and workspace synchronization for reliable analytics deployments.

