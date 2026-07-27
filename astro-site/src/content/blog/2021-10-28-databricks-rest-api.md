---
title: "Databricks REST API for Advanced Automation"
author: "Michael John Peña"
draft: false
date: 2021-10-28
tags: ["Azure", "Databricks", "REST API", "Automation", "Python"]

---

I wrote "Databricks REST API for Advanced Automation" to share practical, production-minded guidance on this topic.

The Databricks REST API exposes every workspace capability that the UI and CLI provide—and then some—making it the integration point for external orchestrators, monitoring systems, and custom tooling that need to interact with Databricks programmatically. The API families: Jobs API (run management, triggering, status polling), Clusters API (create, resize, start, stop), Workspace API (notebook import/export), DBFS API (file operations), Secrets API (secret scope management), and Permissions API (access control). For CI/CD pipelines, the Jobs Runs API's `run-now` and `get` endpoints provide the trigger-and-poll pattern: trigger a job run, poll for completion, check the result state. Authentication is via Personal Access Token in the `Authorization: Bearer` header or Databricks-native OAuth (in preview in October 2021). The API is well-documented and stable, making it reliable for production automation.

## Authentication

### Personal Access Token

```python
import requests

DATABRICKS_HOST = "https://adb-123456789.0.azuredatabricks.net"
TOKEN = "dapi1234567890abcdef"

headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json"
}
```

### Azure AD Token

```python
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
token = credential.get_token("2ff814a6-3304-4ab8-85cb-cd0e6f879c1d/.default")

headers = {
    "Authorization": f"Bearer {token.token}",
    "Content-Type": "application/json"
}
```

## API Client Class

```python
import requests
import json
from typing import Dict, Any, Optional

class DatabricksClient:
    def __init__(self, host: str, token: str):
        self.host = host.rstrip('/')
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

    def _request(self, method: str, endpoint: str, data: Optional[Dict] = None) -> Dict:
        url = f"{self.host}/api/2.0/{endpoint}"
        response = requests.request(
            method=method,
            url=url,
            headers=self.headers,
            json=data
        )
        response.raise_for_status()
        return response.json() if response.text else {}

    def get(self, endpoint: str) -> Dict:
        return self._request("GET", endpoint)

    def post(self, endpoint: str, data: Dict) -> Dict:
        return self._request("POST", endpoint, data)

    def put(self, endpoint: str, data: Dict) -> Dict:
        return self._request("PUT", endpoint, data)

    def delete(self, endpoint: str, data: Optional[Dict] = None) -> Dict:
        return self._request("DELETE", endpoint, data)


# Usage
client = DatabricksClient(DATABRICKS_HOST, TOKEN)
```

## Clusters API

### List Clusters

```python
def list_clusters(client: DatabricksClient) -> list:
    response = client.get("clusters/list")
    return response.get("clusters", [])

# Get cluster by name
def get_cluster_by_name(client: DatabricksClient, name: str) -> Optional[Dict]:
    clusters = list_clusters(client)
    for cluster in clusters:
        if cluster.get("cluster_name") == name:
            return cluster
    return None

clusters = list_clusters(client)
for cluster in clusters:
    print(f"{cluster['cluster_name']}: {cluster['state']}")
```

### Create Cluster

```python
def create_cluster(client: DatabricksClient, config: Dict) -> str:
    response = client.post("clusters/create", config)
    return response["cluster_id"]

cluster_config = {
    "cluster_name": "api-created-cluster",
    "spark_version": "9.1.x-scala2.12",
    "node_type_id": "Standard_DS3_v2",
    "num_workers": 4,
    "autotermination_minutes": 30,
    "spark_conf": {
        "spark.sql.adaptive.enabled": "true"
    },
    "custom_tags": {
        "Environment": "Development",
        "CreatedBy": "API"
    }
}

cluster_id = create_cluster(client, cluster_config)
print(f"Created cluster: {cluster_id}")
```

### Cluster Lifecycle Management

```python
def start_cluster(client: DatabricksClient, cluster_id: str):
    client.post("clusters/start", {"cluster_id": cluster_id})

def stop_cluster(client: DatabricksClient, cluster_id: str):
    client.post("clusters/delete", {"cluster_id": cluster_id})

def wait_for_cluster_state(client: DatabricksClient, cluster_id: str, target_state: str, timeout: int = 600):
    import time
    start_time = time.time()

    while time.time() - start_time < timeout:
        response = client.get(f"clusters/get?cluster_id={cluster_id}")
        state = response.get("state")

        if state == target_state:
            return True
        elif state in ["ERROR", "TERMINATED"]:
            raise Exception(f"Cluster entered {state} state")

        time.sleep(10)

    raise TimeoutError(f"Cluster did not reach {target_state} within {timeout}s")
```

## Jobs API

### Create Job

```python
def create_job(client: DatabricksClient, job_config: Dict) -> int:
    response = client.post("jobs/create", job_config)
    return response["job_id"]

etl_job = {
    "name": "Daily Sales ETL",
    "new_cluster": {
        "spark_version": "9.1.x-scala2.12",
        "node_type_id": "Standard_E8s_v3",
        "num_workers": 8
    },
    "notebook_task": {
        "notebook_path": "/Production/ETL/daily_sales",
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

job_id = create_job(client, etl_job)
print(f"Created job: {job_id}")
```

### Run Job

```python
def run_job_now(client: DatabricksClient, job_id: int, parameters: Optional[Dict] = None) -> int:
    payload = {"job_id": job_id}
    if parameters:
        payload["notebook_params"] = parameters

    response = client.post("jobs/run-now", payload)
    return response["run_id"]

def get_run_status(client: DatabricksClient, run_id: int) -> Dict:
    return client.get(f"jobs/runs/get?run_id={run_id}")

def wait_for_run(client: DatabricksClient, run_id: int, timeout: int = 3600) -> Dict:
    import time
    start_time = time.time()

    while time.time() - start_time < timeout:
        status = get_run_status(client, run_id)
        life_cycle_state = status.get("state", {}).get("life_cycle_state")

        if life_cycle_state == "TERMINATED":
            return status
        elif life_cycle_state in ["INTERNAL_ERROR", "SKIPPED"]:
            raise Exception(f"Run failed with state: {life_cycle_state}")

        time.sleep(30)

    raise TimeoutError(f"Run did not complete within {timeout}s")

# Execute and wait
run_id = run_job_now(client, job_id, {"date": "2021-10-28"})
result = wait_for_run(client, run_id)
print(f"Run completed: {result['state']['result_state']}")
```

## Workspace API

### Import Notebook

```python
import base64

def import_notebook(client: DatabricksClient, local_path: str, workspace_path: str, language: str = "PYTHON"):
    with open(local_path, "r") as f:
        content = base64.b64encode(f.read().encode()).decode()

    payload = {
        "path": workspace_path,
        "language": language,
        "content": content,
        "overwrite": True,
        "format": "SOURCE"
    }

    client.post("workspace/import", payload)
    print(f"Imported {local_path} to {workspace_path}")

def export_notebook(client: DatabricksClient, workspace_path: str, local_path: str):
    response = client.get(f"workspace/export?path={workspace_path}&format=SOURCE")
    content = base64.b64decode(response["content"]).decode()

    with open(local_path, "w") as f:
        f.write(content)

    print(f"Exported {workspace_path} to {local_path}")
```

### Batch Import

```python
import os

def import_directory(client: DatabricksClient, local_dir: str, workspace_dir: str):
    for root, dirs, files in os.walk(local_dir):
        for file in files:
            if file.endswith(('.py', '.scala', '.sql', '.r')):
                local_path = os.path.join(root, file)
                relative_path = os.path.relpath(local_path, local_dir)
                workspace_path = f"{workspace_dir}/{relative_path}".replace('\\', '/')

                # Remove extension for workspace path
                workspace_path = os.path.splitext(workspace_path)[0]

                # Determine language
                ext = os.path.splitext(file)[1].lower()
                language_map = {'.py': 'PYTHON', '.scala': 'SCALA', '.sql': 'SQL', '.r': 'R'}
                language = language_map.get(ext, 'PYTHON')

                import_notebook(client, local_path, workspace_path, language)

# Usage
import_directory(client, "./notebooks", "/Shared/Production")
```

## DBFS API

### Upload File

```python
import base64

def upload_file(client: DatabricksClient, local_path: str, dbfs_path: str, chunk_size: int = 1024 * 1024):
    # Open stream
    response = client.post("dbfs/create", {"path": dbfs_path, "overwrite": True})
    handle = response["handle"]

    # Upload in chunks
    with open(local_path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break

            encoded = base64.b64encode(chunk).decode()
            client.post("dbfs/add-block", {"handle": handle, "data": encoded})

    # Close stream
    client.post("dbfs/close", {"handle": handle})
    print(f"Uploaded {local_path} to {dbfs_path}")

def download_file(client: DatabricksClient, dbfs_path: str, local_path: str):
    offset = 0
    chunk_size = 1024 * 1024

    with open(local_path, "wb") as f:
        while True:
            response = client.get(f"dbfs/read?path={dbfs_path}&offset={offset}&length={chunk_size}")

            if response.get("bytes_read", 0) == 0:
                break

            content = base64.b64decode(response["data"])
            f.write(content)
            offset += response["bytes_read"]

    print(f"Downloaded {dbfs_path} to {local_path}")
```

## Instance Pools API

```python
def create_instance_pool(client: DatabricksClient, config: Dict) -> str:
    response = client.post("instance-pools/create", config)
    return response["instance_pool_id"]

pool_config = {
    "instance_pool_name": "production-pool",
    "node_type_id": "Standard_E8s_v3",
    "min_idle_instances": 2,
    "max_capacity": 50,
    "idle_instance_autotermination_minutes": 30,
    "preloaded_spark_versions": ["9.1.x-scala2.12"],
    "custom_tags": {
        "Environment": "Production"
    }
}

pool_id = create_instance_pool(client, pool_config)
```

## Secrets API

```python
def create_secret_scope(client: DatabricksClient, scope_name: str):
    client.post("secrets/scopes/create", {"scope": scope_name})
    print(f"Created scope: {scope_name}")

def put_secret(client: DatabricksClient, scope: str, key: str, value: str):
    client.post("secrets/put", {
        "scope": scope,
        "key": key,
        "string_value": value
    })
    print(f"Set secret: {scope}/{key}")

def list_secrets(client: DatabricksClient, scope: str) -> list:
    response = client.get(f"secrets/list?scope={scope}")
    return response.get("secrets", [])
```

## Complete Deployment Script

```python
#!/usr/bin/env python3
"""
Complete Databricks deployment script
Uses the DatabricksClient class defined above (in a production setup,
you'd put the class in a separate module like databricks_client.py)
"""

import os
import json
# Assumes DatabricksClient class from above is saved as databricks_client.py
# from databricks_client import DatabricksClient
# Or use directly with requests as shown in the API Client Class section

def deploy(env: str):
    # Load configuration
    config_file = f"config/{env}.json"
    with open(config_file) as f:
        config = json.load(f)

    # Use the DatabricksClient class defined earlier in this post
    client = DatabricksClient(config["host"], os.environ["DATABRICKS_TOKEN"])

    # Deploy notebooks
    print("Deploying notebooks...")
    import_directory(client, "./notebooks", config["notebook_path"])

    # Deploy jobs
    print("Deploying jobs...")
    for job_file in os.listdir("./jobs"):
        if job_file.endswith(".json"):
            with open(f"./jobs/{job_file}") as f:
                job_config = json.load(f)

            # Check if job exists
            existing_jobs = client.get("jobs/list").get("jobs", [])
            existing = next(
                (j for j in existing_jobs if j["settings"]["name"] == job_config["name"]),
                None
            )

            if existing:
                client.post("jobs/reset", {
                    "job_id": existing["job_id"],
                    "new_settings": job_config
                })
                print(f"Updated job: {job_config['name']}")
            else:
                job_id = create_job(client, job_config)
                print(f"Created job: {job_config['name']} (ID: {job_id})")

    print("Deployment complete!")

if __name__ == "__main__":
    import sys
    env = sys.argv[1] if len(sys.argv) > 1 else "development"
    deploy(env)
```

## Best Practices

1. **Handle rate limits** - Implement retry logic with exponential backoff
2. **Use pagination** - Handle large result sets properly
3. **Validate responses** - Check for errors in API responses
4. **Secure tokens** - Never hardcode tokens, use environment variables
5. **Log operations** - Track API calls for debugging
6. **Idempotent operations** - Design for re-runnable deployments

## Conclusion

The Databricks REST API provides complete programmatic control over your Databricks environment. Combined with the CLI, you can build sophisticated automation and CI/CD pipelines.

Tomorrow, we'll explore notebook workflows for orchestrating data pipelines.

