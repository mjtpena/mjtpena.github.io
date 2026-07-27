---
title: "Git Integration in Databricks for Version Control"
author: "Michael John Peña"
draft: false
date: 2021-10-30
tags: ["Azure", "Databricks", "Git", "Version Control", "DevOps"]

---

I wrote "Git Integration in Databricks for Version Control" to share practical, production-minded guidance on this topic.

Databricks Git integration (Repos) connects the workspace directly to GitHub, GitLab, Azure DevOps, or Bitbucket, replacing the manual pattern of downloading notebook `.py` files and committing them outside the workspace. With Repos, notebooks live in the repository as source files; pulling changes, creating branches, and pushing commits happen in the workspace UI or via API. The collaborative development pattern: each engineer works in a personal branch of the repository, uses the workspace Repos UI to develop and test, and raises a PR when ready; the CI/CD pipeline runs automated tests against the PR branch before merging to main. The shift from "notebooks on DBFS" to "notebooks in Git" is a meaningful step toward treating data engineering like software engineering—it enables code review, history tracking, and branching strategies that DBFS notebook storage doesn't support.

## Supported Git Providers

Databricks supports:
- Azure DevOps
- GitHub
- GitLab
- Bitbucket
- AWS CodeCommit

## Setting Up Git Credentials

### Personal Access Token (GitHub)

1. Generate token in GitHub with `repo` scope
2. Add to Databricks:

```
User Settings > Git Integration > Git provider: GitHub
Enter username and token
```

### Azure DevOps

```
User Settings > Git Integration > Git provider: Azure DevOps Services
Enter Azure DevOps username and PAT
```

### Via API

```python
import requests

def set_git_credentials(workspace_url, token, git_provider, git_username, git_token):
    url = f"{workspace_url}/api/2.0/git-credentials"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    payload = {
        "git_provider": git_provider,
        "git_username": git_username,
        "personal_access_token": git_token
    }

    response = requests.post(url, headers=headers, json=payload)
    return response.json()

# Usage
set_git_credentials(
    "https://adb-123.0.azuredatabricks.net",
    DATABRICKS_TOKEN,
    "azureDevOpsServices",
    "user@company.com",
    AZURE_DEVOPS_PAT
)
```

## Creating a Repo in Databricks

### Via UI

1. Navigate to Repos
2. Click "Add Repo"
3. Enter repository URL
4. Select branch

### Via API

```python
def create_repo(workspace_url, token, repo_url, provider, path):
    url = f"{workspace_url}/api/2.0/repos"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    payload = {
        "url": repo_url,
        "provider": provider,
        "path": path
    }

    response = requests.post(url, headers=headers, json=payload)
    return response.json()

# Create repo
repo = create_repo(
    WORKSPACE_URL,
    TOKEN,
    "https://github.com/company/data-platform",
    "gitHub",
    "/Repos/user@company.com/data-platform"
)
```

## Branch Management

### Switching Branches

```python
def update_repo_branch(workspace_url, token, repo_id, branch):
    url = f"{workspace_url}/api/2.0/repos/{repo_id}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    payload = {"branch": branch}

    response = requests.patch(url, headers=headers, json=payload)
    return response.json()

# Switch to feature branch
update_repo_branch(WORKSPACE_URL, TOKEN, repo_id, "feature/new-etl")
```

### Pull Latest Changes

```python
def pull_repo(workspace_url, token, repo_id):
    url = f"{workspace_url}/api/2.0/repos/{repo_id}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    # Getting repo triggers a pull
    response = requests.get(url, headers=headers)
    return response.json()
```

## Project Structure

### Recommended Repository Structure

```
data-platform/
├── .gitignore
├── README.md
├── notebooks/
│   ├── etl/
│   │   ├── extract.py
│   │   ├── transform.py
│   │   └── load.py
│   ├── analytics/
│   │   └── reports.py
│   └── ml/
│       └── training.py
├── src/
│   ├── __init__.py
│   ├── utils/
│   │   ├── __init__.py
│   │   └── helpers.py
│   └── models/
│       ├── __init__.py
│       └── data_models.py
├── tests/
│   ├── __init__.py
│   └── test_utils.py
├── config/
│   ├── dev.json
│   ├── staging.json
│   └── prod.json
└── jobs/
    ├── daily_etl.json
    └── weekly_reports.json
```

### .gitignore for Databricks

```gitignore
# Databricks
.databricks/
*.egg-info/
dist/
build/

# Python
__pycache__/
*.py[cod]
*$py.class
.Python
*.so

# Jupyter/Databricks notebooks
.ipynb_checkpoints/

# IDE
.idea/
.vscode/
*.swp

# Environment
.env
.venv/

# Logs
*.log
logs/

# OS
.DS_Store
Thumbs.db
```

## Working with Python Packages

### Importing Local Modules

```python
# In notebook, add src to path
import sys
sys.path.append("/Workspace/Repos/user@company.com/data-platform/src")

# Now import your modules
from utils.helpers import process_data
from models.data_models import SalesRecord
```

### Using Relative Imports

```python
# src/etl/extract.py
from ..utils.helpers import clean_data
from ..models.data_models import RawRecord
```

## CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/databricks-ci.yml
name: Databricks CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Set up Python
        uses: actions/setup-python@v2
        with:
          python-version: '3.8'

      - name: Install dependencies
        run: |
          pip install pytest pyspark
          pip install -r requirements.txt

      - name: Run tests
        run: pytest tests/

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Install Databricks CLI
        run: pip install databricks-cli

      - name: Configure Databricks
        env:
          DATABRICKS_HOST: ${{ secrets.DATABRICKS_HOST }}
          DATABRICKS_TOKEN: ${{ secrets.DATABRICKS_TOKEN }}
        run: |
          echo "[DEFAULT]" > ~/.databrickscfg
          echo "host = $DATABRICKS_HOST" >> ~/.databrickscfg
          echo "token = $DATABRICKS_TOKEN" >> ~/.databrickscfg

      - name: Update Repos
        run: |
          # Get repo ID and update
          REPO_ID=$(databricks repos list --output JSON | jq -r '.repos[] | select(.path=="/Repos/Production/data-platform") | .id')
          databricks repos update --repo-id $REPO_ID --branch main
```

### Azure DevOps Pipeline

```yaml
# azure-pipelines.yml
trigger:
  - main
  - develop

pool:
  vmImage: 'ubuntu-latest'

stages:
  - stage: Test
    jobs:
      - job: RunTests
        steps:
          - task: UsePythonVersion@0
            inputs:
              versionSpec: '3.8'

          - script: |
              pip install pytest pyspark
              pip install -r requirements.txt
            displayName: 'Install dependencies'

          - script: pytest tests/ --junitxml=test-results.xml
            displayName: 'Run tests'

          - task: PublishTestResults@2
            inputs:
              testResultsFormat: 'JUnit'
              testResultsFiles: 'test-results.xml'

  - stage: Deploy
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    jobs:
      - job: DeployToDatabricks
        steps:
          - script: pip install databricks-cli
            displayName: 'Install Databricks CLI'

          - script: |
              echo "[DEFAULT]" > ~/.databrickscfg
              echo "host = $(DATABRICKS_HOST)" >> ~/.databrickscfg
              echo "token = $(DATABRICKS_TOKEN)" >> ~/.databrickscfg
            displayName: 'Configure Databricks CLI'

          - script: |
              python scripts/deploy.py --env production
            displayName: 'Deploy to Databricks'
```

## Multi-Environment Strategy

### Environment-Specific Branches

```
main        -> Production
develop     -> Staging
feature/*   -> Development
```

### Repo Structure Per Environment

```
/Repos/
├── Production/
│   └── data-platform/  (main branch)
├── Staging/
│   └── data-platform/  (develop branch)
└── user@company.com/
    └── data-platform/  (feature branches)
```

### Automated Sync Script

```python
# scripts/sync_repos.py
import requests

def sync_environment_repos(workspace_url, token, repo_configs):
    for config in repo_configs:
        repo_id = get_repo_id(workspace_url, token, config["path"])

        if repo_id:
            # Update existing repo
            update_repo_branch(workspace_url, token, repo_id, config["branch"])
            print(f"Updated {config['path']} to {config['branch']}")
        else:
            # Create new repo
            create_repo(
                workspace_url, token,
                config["url"],
                config["provider"],
                config["path"]
            )
            print(f"Created {config['path']}")

# Configuration
repos = [
    {
        "url": "https://github.com/company/data-platform",
        "provider": "gitHub",
        "path": "/Repos/Production/data-platform",
        "branch": "main"
    },
    {
        "url": "https://github.com/company/data-platform",
        "provider": "gitHub",
        "path": "/Repos/Staging/data-platform",
        "branch": "develop"
    }
]

sync_environment_repos(WORKSPACE_URL, TOKEN, repos)
```

## Best Practices

1. **Use feature branches** - Develop in isolated branches
2. **PR reviews** - Require reviews before merging
3. **Automated testing** - Run tests on PRs
4. **Environment separation** - Different repos for prod/dev
5. **Consistent structure** - Follow standard project layout
6. **Document notebooks** - Include README files
7. **Version dependencies** - Use requirements.txt

## Conclusion

Git integration transforms Databricks into a proper development environment with version control, collaboration, and CI/CD capabilities. By following these practices, teams can maintain code quality and streamline deployments.

Tomorrow, we'll wrap up the series with Repos in Databricks for managing production deployments.

