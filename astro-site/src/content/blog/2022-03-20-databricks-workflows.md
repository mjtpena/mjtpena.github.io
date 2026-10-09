---
title: "Databricks Workflows: Orchestrating Data and ML Pipelines"
author: Michael John Peña
draft: false
date: 2022-03-20
tags:
  - Azure
  - Databricks
  - Workflows
  - Orchestration
  - Data Engineering
---

## Workflows Overview

Key features:
- **Jobs**: Multi-task workflows with dependencies
- **Triggers**: Schedule, file arrival, or API-based
- **Compute**: Job clusters or serverless
- **Monitoring**: Built-in alerting and observability
- **Repair**: Automatic or manual retry capabilities

## Creating a Basic Job

### Via UI

1. Navigate to Workflows > Jobs > Create Job
2. Add tasks (notebooks, Python, SQL, JAR, etc.)
3. Configure dependencies between tasks
4. Set schedule and alerts
5. Configure compute

### Via API

```python
import requests
import json

workspace_url = "https://adb-xxx.azuredatabricks.net"
token = os.environ["DATABRICKS_TOKEN"]

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

# Create a multi-task job
job_config = {
    "name": "daily-etl-pipeline",
    "tasks": [
        {
            "task_key": "extract_data",
            "notebook_task": {
                "notebook_path": "/Production/ETL/extract_sources",
                "base_parameters": {
                    "source": "sales",
                    "date": "{{job.start_time.iso_date}}"
                }
            },
            "job_cluster_key": "etl_cluster"
        },
        {
            "task_key": "transform_data",
            "depends_on": [{"task_key": "extract_data"}],
            "notebook_task": {
                "notebook_path": "/Production/ETL/transform_sales"
            },
            "job_cluster_key": "etl_cluster"
        },
        {
            "task_key": "load_to_warehouse",
            "depends_on": [{"task_key": "transform_data"}],
            "notebook_task": {
                "notebook_path": "/Production/ETL/load_warehouse"
            },
            "job_cluster_key": "etl_cluster"
        },
        {
            "task_key": "run_quality_checks",
            "depends_on": [{"task_key": "load_to_warehouse"}],
            "sql_task": {
                "warehouse_id": "abc123",
                "file": {
                    "path": "/Production/SQL/quality_checks.sql"
                }
            }
        },
        {
            "task_key": "notify_completion",
            "depends_on": [{"task_key": "run_quality_checks"}],
            "notebook_task": {
                "notebook_path": "/Production/Utils/send_notification"
            },
            "job_cluster_key": "etl_cluster"
        }
    ],
    "job_clusters": [
        {
            "job_cluster_key": "etl_cluster",
            "new_cluster": {
                "spark_version": "11.3.x-scala2.12",
                "node_type_id": "Standard_D4ds_v5",
                "num_workers": 4,
                "spark_conf": {
                    "spark.sql.adaptive.enabled": "true"
                }
            }
        }
    ],
    "schedule": {
        "quartz_cron_expression": "0 0 6 * * ?",  # 6 AM daily
        "timezone_id": "UTC"
    },
    "email_notifications": {
        "on_failure": ["data-team@company.com"]
    }
}

response = requests.post(
    f"{workspace_url}/api/2.1/jobs/create",
    headers=headers,
    json=job_config
)

job_id = response.json()["job_id"]
print(f"Created job: {job_id}")
```

## Task Types

### Notebook Task

```python
{
    "task_key": "process_data",
    "notebook_task": {
        "notebook_path": "/Production/process",
        "base_parameters": {
            "env": "production",
            "date": "{{job.start_time.iso_date}}"
        },
        "source": "WORKSPACE"  # or "GIT"
    }
}
```

### Python Script Task

```python
{
    "task_key": "run_python",
    "python_wheel_task": {
        "package_name": "my_package",
        "entry_point": "main",
        "parameters": ["--env", "production"]
    },
    "libraries": [
        {"whl": "dbfs:/libs/my_package-1.0.0-py3-none-any.whl"}
    ]
}
```

### SQL Task

```python
{
    "task_key": "run_sql",
    "sql_task": {
        "warehouse_id": "abc123",
        "query": {
            "query_id": "query-uuid"  # Reference a saved query
        }
        # Or use a file:
        # "file": {"path": "/Production/SQL/query.sql"}
    }
}
```

### dbt Task

```python
{
    "task_key": "run_dbt",
    "dbt_task": {
        "project_directory": "/Workspace/dbt_project",
        "commands": [
            "dbt deps",
            "dbt run --select +orders",
            "dbt test"
        ],
        "warehouse_id": "abc123"
    }
}
```

### Delta Live Tables Task

```python
{
    "task_key": "run_dlt",
    "pipeline_task": {
        "pipeline_id": "pipeline-uuid",
        "full_refresh": False
    }
}
```

## Task Dependencies

```python
# Linear dependency
tasks = [
    {"task_key": "A"},
    {"task_key": "B", "depends_on": [{"task_key": "A"}]},
    {"task_key": "C", "depends_on": [{"task_key": "B"}]}
]

# Parallel execution
tasks = [
    {"task_key": "A"},
    {"task_key": "B1", "depends_on": [{"task_key": "A"}]},
    {"task_key": "B2", "depends_on": [{"task_key": "A"}]},  # B1 and B2 run in parallel
    {"task_key": "C", "depends_on": [{"task_key": "B1"}, {"task_key": "B2"}]}  # C waits for both
]

# Conditional execution
tasks = [
    {
        "task_key": "check_data",
        "notebook_task": {"notebook_path": "/check"}
    },
    {
        "task_key": "process_if_ready",
        "depends_on": [{"task_key": "check_data"}],
        "condition_task": {
            "op": "EQUAL_TO",
            "left": "{{tasks.check_data.values.data_ready}}",
            "right": "true"
        },
        "notebook_task": {"notebook_path": "/process"}
    }
]
```

## Passing Data Between Tasks

```python
# In source notebook (task A):
dbutils.jobs.taskValues.set(key="row_count", value=12345)
dbutils.jobs.taskValues.set(key="status", value="success")
dbutils.jobs.taskValues.set(key="output_path", value="/data/output/2022-03-20")

# In dependent notebook (task B):
row_count = dbutils.jobs.taskValues.get(
    taskKey="A",
    key="row_count",
    default=0
)
output_path = dbutils.jobs.taskValues.get(taskKey="A", key="output_path")

print(f"Processing {row_count} rows from {output_path}")
```

## Dynamic Task Parameters

```python
# Use job parameters and dynamic references
job_config = {
    "name": "parameterized-job",
    "parameters": [
        {"name": "environment", "default": "production"},
        {"name": "date", "default": "{{job.start_time.iso_date}}"}
    ],
    "tasks": [
        {
            "task_key": "process",
            "notebook_task": {
                "notebook_path": "/process",
                "base_parameters": {
                    "env": "{{job.parameters.environment}}",
                    "date": "{{job.parameters.date}}",
                    "run_id": "{{job.run_id}}"
                }
            }
        }
    ]
}

# Trigger with custom parameters
run_config = {
    "job_id": job_id,
    "job_parameters": {
        "environment": "staging",
        "date": "2022-03-15"
    }
}

response = requests.post(
    f"{workspace_url}/api/2.1/jobs/run-now",
    headers=headers,
    json=run_config
)
```

## Scheduling Options

```python
# Cron schedule
schedule = {
    "quartz_cron_expression": "0 0 */4 * * ?",  # Every 4 hours
    "timezone_id": "America/New_York",
    "pause_status": "UNPAUSED"
}

# Common cron patterns:
# "0 0 6 * * ?"     - Daily at 6 AM
# "0 0 6 ? * MON"   - Every Monday at 6 AM
# "0 0 6 1 * ?"     - First day of every month at 6 AM
# "0 0 */4 * * ?"   - Every 4 hours
# "0 */30 * * * ?"  - Every 30 minutes

# File arrival trigger
trigger = {
    "file_arrival": {
        "url": "abfss://container@storage.dfs.core.windows.net/incoming/",
        "min_time_between_triggers_seconds": 60,
        "wait_after_last_change_seconds": 30
    }
}

# Continuous trigger (for streaming)
continuous = {
    "continuous": {
        "pause_status": "UNPAUSED"
    }
}
```

## Error Handling and Retries

```python
task_config = {
    "task_key": "resilient_task",
    "notebook_task": {"notebook_path": "/task"},

    # Retry configuration
    "max_retries": 3,
    "min_retry_interval_millis": 60000,  # 1 minute

    # Timeout
    "timeout_seconds": 3600,  # 1 hour

    # Run conditions
    "run_if": "ALL_SUCCESS"  # or "AT_LEAST_ONE_SUCCESS", "NONE_FAILED", "ALL_DONE"
}
```

## Monitoring and Alerting

```python
# Configure notifications
notifications = {
    "email_notifications": {
        "on_start": ["alerts@company.com"],
        "on_success": ["reports@company.com"],
        "on_failure": ["oncall@company.com"],
        "no_alert_for_skipped_runs": True
    },
    "webhook_notifications": {
        "on_failure": [
            {
                "id": "webhook-id"
            }
        ]
    }
}

# Get job run status
def get_run_status(run_id):
    response = requests.get(
        f"{workspace_url}/api/2.1/jobs/runs/get",
        headers=headers,
        params={"run_id": run_id}
    )
    return response.json()

# List recent runs
def list_runs(job_id, limit=10):
    response = requests.get(
        f"{workspace_url}/api/2.1/jobs/runs/list",
        headers=headers,
        params={"job_id": job_id, "limit": limit}
    )
    return response.json()["runs"]
```

## Repairing Failed Runs

```python
def repair_run(run_id, tasks_to_rerun):
    """Repair a failed run by rerunning specific tasks"""

    response = requests.post(
        f"{workspace_url}/api/2.1/jobs/runs/repair",
        headers=headers,
        json={
            "run_id": run_id,
            "rerun_tasks": tasks_to_rerun,
            "latest_repair_id": None  # Gets latest repair state
        }
    )

    return response.json()

# Example: Rerun failed task and its dependents
repair_result = repair_run(
    run_id=12345,
    tasks_to_rerun=["failed_task"]
)
```

## Job Clusters vs All-Purpose Clusters

```python
# Job cluster: Created for the job, terminated after
job_cluster = {
    "job_cluster_key": "ephemeral_cluster",
    "new_cluster": {
        "spark_version": "11.3.x-scala2.12",
        "node_type_id": "Standard_D4ds_v5",
        "num_workers": 4,
        "autotermination_minutes": 0  # Not needed for job clusters
    }
}

# Existing cluster: Use an always-on cluster
existing_cluster = {
    "task_key": "quick_task",
    "existing_cluster_id": "cluster-id",
    "notebook_task": {"notebook_path": "/quick"}
}

# Serverless: Let Databricks manage compute
serverless_task = {
    "task_key": "serverless_task",
    "notebook_task": {"notebook_path": "/process"},
    "environment_key": "default"  # Uses serverless compute
}
```

## Best Practices

### Idempotent Tasks

```python
# Make tasks idempotent - safe to retry
def process_data(date):
    output_path = f"/data/processed/{date}"

    # Check if already processed
    if path_exists(output_path):
        # Option 1: Skip
        return {"status": "skipped", "reason": "already processed"}

        # Option 2: Overwrite
        # delete_path(output_path)

    # Process data
    df = extract_data(date)
    df = transform_data(df)
    df.write.mode("overwrite").parquet(output_path)

    return {"status": "success", "path": output_path}
```

### Modular Design

```python
# Break pipelines into reusable components
# Instead of one monolithic notebook:
# - /ETL/extract.py
# - /ETL/transform.py
# - /ETL/load.py
# - /ETL/validate.py

# This allows:
# - Independent testing
# - Parallel execution where possible
# - Easy debugging
# - Selective reruns
```

## Conclusion

Databricks Workflows provides enterprise-grade orchestration:
- Native integration with all Databricks services
- Flexible task types and dependencies
- Built-in monitoring and alerting
- Repair capabilities for failed runs
- Cost optimization with job clusters

For most data engineering and ML workflows on Databricks, Workflows is the natural choice over external orchestrators.

## Resources

- [Workflows Documentation](https://docs.databricks.com/workflows/index.html)
- [Jobs API Reference](https://docs.databricks.com/api/workspace/jobs)
- [Task Types](https://docs.databricks.com/workflows/jobs/create-run-jobs.html)
