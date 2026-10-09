---
title: "Azure Databricks Jobs: Scheduled and Triggered Workflows"
description: "Notebooks are great until you need them to run on Tuesday at 2am, retry on failure, and chain into the next step. That's where Databricks Jobs come in.…"
author: Michael John Peña
draft: false
date: 2020-11-03
tags:
  - Azure
  - Databricks
  - Data Engineering
  - Workflows
---

Notebooks are great until you need them to run on Tuesday at 2am, retry on failure, and chain into the next step. That's where Databricks Jobs come in. Schedule them, trigger on events, or chain dependent tasks into a small DAG. I tend to reach for Jobs when a notebook graduates from "I'm exploring" to "the business now depends on this."

## Creating a Job (UI)

1. Jobs → Create Job
2. Configure task (notebook, JAR, Python)
3. Set cluster configuration
4. Define schedule or trigger

## Jobs API

```python
import requests

databricks_instance = "https://adb-xxx.azuredatabricks.net"
token = "dapi..."

# Create job
job_spec = {
    "name": "Daily ETL",
    "tasks": [
        {
            "task_key": "extract",
            "notebook_task": {
                "notebook_path": "/ETL/Extract"
            },
            "new_cluster": {
                "spark_version": "10.4.x-scala2.12",
                "node_type_id": "Standard_DS3_v2",
                "num_workers": 2
            }
        },
        {
            "task_key": "transform",
            "depends_on": [{"task_key": "extract"}],
            "notebook_task": {
                "notebook_path": "/ETL/Transform"
            },
            "job_cluster_key": "shared_cluster"
        },
        {
            "task_key": "load",
            "depends_on": [{"task_key": "transform"}],
            "notebook_task": {
                "notebook_path": "/ETL/Load"
            },
            "job_cluster_key": "shared_cluster"
        }
    ],
    "job_clusters": [
        {
            "job_cluster_key": "shared_cluster",
            "new_cluster": {
                "spark_version": "10.4.x-scala2.12",
                "node_type_id": "Standard_DS3_v2",
                "num_workers": 4
            }
        }
    ],
    "schedule": {
        "quartz_cron_expression": "0 0 6 * * ?",
        "timezone_id": "America/New_York"
    }
}

response = requests.post(
    f"{databricks_instance}/api/2.1/jobs/create",
    headers={"Authorization": f"Bearer {token}"},
    json=job_spec
)
job_id = response.json()["job_id"]
```

## Multi-Task Workflows

```
        ┌──────────┐
        │  Extract │
        └────┬─────┘
             │
    ┌────────┴────────┐
    │                 │
┌───┴───┐        ┌───┴───┐
│Trans A│        │Trans B│
└───┬───┘        └───┬───┘
    │                 │
    └────────┬────────┘
             │
        ┌────┴────┐
        │  Load   │
        └─────────┘
```

## Parameterized Jobs

```python
# Notebook with parameters
dbutils.widgets.text("date", "2020-11-03")
dbutils.widgets.dropdown("environment", "dev", ["dev", "staging", "prod"])

date = dbutils.widgets.get("date")
env = dbutils.widgets.get("environment")

# Use parameters
df = spark.read.parquet(f"/data/{env}/sales/{date}")
```

```python
# Run with parameters
response = requests.post(
    f"{databricks_instance}/api/2.1/jobs/run-now",
    headers={"Authorization": f"Bearer {token}"},
    json={
        "job_id": job_id,
        "notebook_params": {
            "date": "2020-11-03",
            "environment": "prod"
        }
    }
)
run_id = response.json()["run_id"]
```

## Job Clusters vs All-Purpose

```python
# Job cluster (ephemeral, cost-effective)
"new_cluster": {
    "spark_version": "10.4.x-scala2.12",
    "node_type_id": "Standard_DS3_v2",
    "num_workers": 4,
    "spark_conf": {
        "spark.speculation": "true"
    }
}

# Existing cluster (for development)
"existing_cluster_id": "0101-123456-abcd"
```

## Alerting

```python
job_spec["email_notifications"] = {
    "on_start": ["team@company.com"],
    "on_success": ["team@company.com"],
    "on_failure": ["alerts@company.com", "oncall@company.com"]
}

job_spec["webhook_notifications"] = {
    "on_failure": [
        {"id": "slack-webhook-id"}
    ]
}
```

## Retry Policies

```python
{
    "task_key": "flaky_task",
    "max_retries": 3,
    "min_retry_interval_millis": 60000,
    "retry_on_timeout": True
}
```

## Monitoring Runs

```python
# Get run status
response = requests.get(
    f"{databricks_instance}/api/2.1/jobs/runs/get",
    headers={"Authorization": f"Bearer {token}"},
    params={"run_id": run_id}
)
status = response.json()["state"]["life_cycle_state"]
# PENDING, RUNNING, TERMINATED
```

Databricks Jobs: production data workflows made simple.
