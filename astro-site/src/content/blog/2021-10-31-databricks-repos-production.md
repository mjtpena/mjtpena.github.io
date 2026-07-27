---
title: "Repos in Databricks: Managing Production Deployments"
author: "Michael John Peña"
draft: false
date: 2021-10-31
tags: ["Azure", "Databricks", "Repos", "Production", "DevOps", "MLOps"]

---

I wrote "Repos in Databricks: Managing Production Deployments" to share practical, production-minded guidance on this topic.

Databricks Repos in production use means the code running in your prod workspace is explicitly linked to a specific Git commit—not "whatever notebooks someone uploaded last week." The deployment pattern: a CI/CD pipeline (Azure DevOps or GitHub Actions) runs unit tests on the PR branch, merges to main after approval, then calls the Databricks Repos API to update the prod workspace Repo to the new main commit. The workspace contains no manually edited notebooks; all changes go through the Git workflow. Environment promotion (dev→test→prod) is repo branch promotion: the dev workspace tracks the `main` branch, prod uses tagged releases. This architecture makes rollback trivial (revert the Repo to the previous commit), makes the change history auditable (every code change has a Git commit, PR, and reviewer), and makes disaster recovery straightforward (the entire workspace code base exists in Git).

## Production Repo Architecture

### Folder Structure

```
/Repos/
├── Production/
│   └── data-platform/          # main branch, read-only
├── Staging/
│   └── data-platform/          # develop branch, testing
├── Shared/
│   └── libraries/              # Shared utility libraries
└── Users/
    └── developer@company.com/
        └── data-platform/      # Feature branches
```

### Access Control

```python
import requests

def set_repo_permissions(workspace_url, token, repo_path, permissions):
    # Get repo ID
    repos = requests.get(
        f"{workspace_url}/api/2.0/repos",
        headers={"Authorization": f"Bearer {token}"}
    ).json()

    repo_id = next(
        (r["id"] for r in repos.get("repos", []) if r["path"] == repo_path),
        None
    )

    if not repo_id:
        raise Exception(f"Repo not found: {repo_path}")

    # Set permissions
    url = f"{workspace_url}/api/2.0/permissions/repos/{repo_id}"
    response = requests.put(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        },
        json={"access_control_list": permissions}
    )
    return response.json()

# Production repo: read-only for most users
prod_permissions = [
    {"group_name": "admins", "permission_level": "CAN_MANAGE"},
    {"group_name": "developers", "permission_level": "CAN_READ"},
    {"group_name": "data-engineers", "permission_level": "CAN_READ"}
]

set_repo_permissions(
    WORKSPACE_URL, TOKEN,
    "/Repos/Production/data-platform",
    prod_permissions
)
```

## Deployment Pipeline

### Complete Deployment Script

```python
#!/usr/bin/env python3
"""
Production deployment script for Databricks Repos
"""

import os
import json
import requests
import time
from typing import Dict, List, Optional

class DatabricksDeployer:
    def __init__(self, workspace_url: str, token: str):
        self.workspace_url = workspace_url.rstrip('/')
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

    def _request(self, method: str, endpoint: str, data: Optional[Dict] = None):
        url = f"{self.workspace_url}/api/2.0/{endpoint}"
        response = requests.request(method, url, headers=self.headers, json=data)
        response.raise_for_status()
        return response.json() if response.text else {}

    def get_repo(self, path: str) -> Optional[Dict]:
        repos = self._request("GET", "repos")
        return next(
            (r for r in repos.get("repos", []) if r["path"] == path),
            None
        )

    def create_repo(self, url: str, provider: str, path: str, branch: str) -> Dict:
        return self._request("POST", "repos", {
            "url": url,
            "provider": provider,
            "path": path,
            "branch": branch
        })

    def update_repo(self, repo_id: int, branch: str) -> Dict:
        return self._request("PATCH", f"repos/{repo_id}", {"branch": branch})

    def deploy_repo(self, config: Dict) -> Dict:
        """Deploy or update a repo"""
        existing = self.get_repo(config["path"])

        if existing:
            print(f"Updating existing repo: {config['path']}")
            return self.update_repo(existing["id"], config["branch"])
        else:
            print(f"Creating new repo: {config['path']}")
            return self.create_repo(
                config["url"],
                config["provider"],
                config["path"],
                config["branch"]
            )

    def deploy_job(self, job_config: Dict) -> int:
        """Deploy or update a job"""
        jobs = self._request("GET", "jobs/list")
        existing = next(
            (j for j in jobs.get("jobs", [])
             if j["settings"]["name"] == job_config["name"]),
            None
        )

        if existing:
            print(f"Updating job: {job_config['name']}")
            self._request("POST", "jobs/reset", {
                "job_id": existing["job_id"],
                "new_settings": job_config
            })
            return existing["job_id"]
        else:
            print(f"Creating job: {job_config['name']}")
            result = self._request("POST", "jobs/create", job_config)
            return result["job_id"]

    def run_job(self, job_id: int, params: Optional[Dict] = None) -> int:
        """Run a job and return run_id"""
        payload = {"job_id": job_id}
        if params:
            payload["notebook_params"] = params

        result = self._request("POST", "jobs/run-now", payload)
        return result["run_id"]

    def wait_for_run(self, run_id: int, timeout: int = 3600) -> Dict:
        """Wait for a job run to complete"""
        start = time.time()
        while time.time() - start < timeout:
            result = self._request("GET", f"jobs/runs/get?run_id={run_id}")
            state = result.get("state", {}).get("life_cycle_state")

            if state == "TERMINATED":
                return result
            elif state in ["INTERNAL_ERROR", "SKIPPED"]:
                raise Exception(f"Run failed: {state}")

            time.sleep(30)

        raise TimeoutError(f"Run {run_id} did not complete in {timeout}s")


def deploy_production(config_path: str):
    """Main deployment function"""
    with open(config_path) as f:
        config = json.load(f)

    deployer = DatabricksDeployer(
        config["workspace_url"],
        os.environ["DATABRICKS_TOKEN"]
    )

    # Step 1: Deploy repos
    print("\n=== Deploying Repos ===")
    for repo_config in config.get("repos", []):
        deployer.deploy_repo(repo_config)

    # Step 2: Deploy jobs
    print("\n=== Deploying Jobs ===")
    job_ids = {}
    for job_file in config.get("job_files", []):
        with open(job_file) as f:
            job_config = json.load(f)
        job_id = deployer.deploy_job(job_config)
        job_ids[job_config["name"]] = job_id

    # Step 3: Run validation job
    print("\n=== Running Validation ===")
    if "validation_job" in config:
        validation_id = job_ids.get(config["validation_job"])
        if validation_id:
            run_id = deployer.run_job(validation_id)
            result = deployer.wait_for_run(run_id)

            if result["state"]["result_state"] != "SUCCESS":
                raise Exception("Validation failed!")
            print("Validation passed!")

    print("\n=== Deployment Complete ===")
    return job_ids


if __name__ == "__main__":
    import sys
    config_path = sys.argv[1] if len(sys.argv) > 1 else "config/production.json"
    deploy_production(config_path)
```

### Deployment Configuration

```json
{
  "workspace_url": "https://adb-123456789.0.azuredatabricks.net",
  "repos": [
    {
      "url": "https://github.com/company/data-platform",
      "provider": "gitHub",
      "path": "/Repos/Production/data-platform",
      "branch": "main"
    },
    {
      "url": "https://github.com/company/shared-libs",
      "provider": "gitHub",
      "path": "/Repos/Shared/libraries",
      "branch": "main"
    }
  ],
  "job_files": [
    "jobs/daily_etl.json",
    "jobs/weekly_reports.json",
    "jobs/validation.json"
  ],
  "validation_job": "Data Validation"
}
```

## Job Configuration with Repos

### Job Using Repo Notebook

```json
{
  "name": "Daily Sales ETL",
  "new_cluster": {
    "spark_version": "9.1.x-scala2.12",
    "node_type_id": "Standard_E8s_v3",
    "num_workers": 8,
    "spark_conf": {
      "spark.databricks.delta.optimizeWrite.enabled": "true"
    }
  },
  "notebook_task": {
    "notebook_path": "/Repos/Production/data-platform/notebooks/etl/daily_sales",
    "base_parameters": {
      "env": "production"
    }
  },
  "schedule": {
    "quartz_cron_expression": "0 0 6 * * ?",
    "timezone_id": "UTC"
  },
  "email_notifications": {
    "on_failure": ["alerts@company.com"]
  },
  "max_retries": 3,
  "timeout_seconds": 7200
}
```

### Job with Python Wheel from Repo

```json
{
  "name": "ML Pipeline",
  "new_cluster": {
    "spark_version": "9.1.x-scala2.12",
    "node_type_id": "Standard_NC6s_v3",
    "num_workers": 2
  },
  "python_wheel_task": {
    "package_name": "ml_pipeline",
    "entry_point": "train",
    "parameters": ["--env", "production"]
  },
  "libraries": [
    {
      "whl": "dbfs:/wheels/ml_pipeline-1.0.0-py3-none-any.whl"
    }
  ]
}
```

## Environment Management

### Environment-Specific Configuration

```python
# notebooks/config/environment.py

import os
import json

def get_environment():
    """Detect current environment based on repo path"""
    notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()

    if "/Repos/Production/" in notebook_path:
        return "production"
    elif "/Repos/Staging/" in notebook_path:
        return "staging"
    else:
        return "development"

def load_config():
    """Load environment-specific configuration"""
    env = get_environment()

    # Path relative to repo root
    config_path = f"/Workspace/Repos/{'Production' if env == 'production' else 'Staging'}/data-platform/config/{env}.json"

    with open(config_path) as f:
        return json.load(f)

# Usage in notebook
config = load_config()
storage_account = config["storage_account"]
database = config["database"]
```

### Configuration Files

```json
// config/production.json
{
  "storage_account": "prodstorageaccount",
  "database": "production_db",
  "key_vault": "prod-keyvault",
  "log_level": "WARNING",
  "enable_monitoring": true
}
```

```json
// config/staging.json
{
  "storage_account": "stagingstorageaccount",
  "database": "staging_db",
  "key_vault": "staging-keyvault",
  "log_level": "INFO",
  "enable_monitoring": true
}
```

## Blue-Green Deployments

### Strategy

```python
def blue_green_deploy(deployer, config):
    """
    Blue-Green deployment strategy:
    1. Deploy to inactive slot
    2. Run validation
    3. Switch traffic
    4. Keep old version for rollback
    """
    current_slot = get_current_active_slot()  # "blue" or "green"
    new_slot = "green" if current_slot == "blue" else "blue"

    # Deploy to new slot
    new_repo_path = f"/Repos/Production-{new_slot.capitalize()}/data-platform"
    deployer.deploy_repo({
        "url": config["repo_url"],
        "provider": config["provider"],
        "path": new_repo_path,
        "branch": config["branch"]
    })

    # Update jobs to point to new slot
    for job_config in config["jobs"]:
        job_config["notebook_task"]["notebook_path"] = job_config["notebook_task"]["notebook_path"].replace(
            f"Production-{current_slot.capitalize()}",
            f"Production-{new_slot.capitalize()}"
        )
        deployer.deploy_job(job_config)

    # Run validation
    validation_run = deployer.run_job(config["validation_job_id"])
    result = deployer.wait_for_run(validation_run)

    if result["state"]["result_state"] != "SUCCESS":
        print("Validation failed! Rolling back...")
        # Revert jobs to old slot
        for job_config in config["jobs"]:
            job_config["notebook_task"]["notebook_path"] = job_config["notebook_task"]["notebook_path"].replace(
                f"Production-{new_slot.capitalize()}",
                f"Production-{current_slot.capitalize()}"
            )
            deployer.deploy_job(job_config)
        raise Exception("Deployment failed validation")

    # Update active slot marker
    set_active_slot(new_slot)
    print(f"Deployment successful! Active slot: {new_slot}")
```

## Rollback Procedures

### Quick Rollback Script

```python
#!/usr/bin/env python3
"""
Emergency rollback script
"""

import os
import sys
from deployer import DatabricksDeployer

def rollback(environment: str, commit_sha: str):
    """Rollback to a specific commit"""
    deployer = DatabricksDeployer(
        os.environ["DATABRICKS_HOST"],
        os.environ["DATABRICKS_TOKEN"]
    )

    repo_path = f"/Repos/Production/data-platform"

    # Get repo
    repo = deployer.get_repo(repo_path)
    if not repo:
        raise Exception(f"Repo not found: {repo_path}")

    # Update to specific commit
    # Note: This requires the commit to be on the current branch
    print(f"Rolling back to commit: {commit_sha}")

    # Alternative: Switch to a tagged release branch
    deployer.update_repo(repo["id"], f"release/{commit_sha[:8]}")

    print("Rollback complete!")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: rollback.py <commit_sha>")
        sys.exit(1)

    rollback("production", sys.argv[1])
```

## Monitoring and Alerting

### Deployment Monitoring

```python
# Track deployments in Delta table
def log_deployment(spark, deployment_info):
    from pyspark.sql import Row
    from datetime import datetime

    row = Row(
        timestamp=datetime.now(),
        environment=deployment_info["environment"],
        repo_path=deployment_info["repo_path"],
        branch=deployment_info["branch"],
        commit_sha=deployment_info.get("commit_sha"),
        deployed_by=deployment_info["deployed_by"],
        status=deployment_info["status"]
    )

    df = spark.createDataFrame([row])
    df.write.format("delta").mode("append").saveAsTable("audit.deployments")

# Query deployment history
deployment_history = spark.sql("""
    SELECT *
    FROM audit.deployments
    WHERE environment = 'production'
    ORDER BY timestamp DESC
    LIMIT 10
""")
```

## Best Practices Summary

1. **Separate environments** - Production, Staging, Development repos
2. **Restrict production access** - Read-only for most users
3. **Automated deployments** - Use CI/CD pipelines
4. **Validation gates** - Run tests before promoting
5. **Version tagging** - Tag releases for easy rollback
6. **Audit logging** - Track all deployments
7. **Blue-green strategy** - Zero-downtime deployments
8. **Quick rollback** - Have rollback procedures ready

## Conclusion

Databricks Repos transforms how teams manage production deployments. By combining Git integration with proper CI/CD practices, you can achieve reliable, auditable, and reproducible deployments.

This concludes our October 2021 series on Azure, Data, and AI topics. We've covered everything from AKS cluster management to Azure Data Explorer, Synapse Analytics, and Databricks best practices. Happy building!

