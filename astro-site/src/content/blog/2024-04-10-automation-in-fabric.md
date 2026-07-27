---
title: "Automation in Fabric: Scheduling and Orchestration"
author: "Michael John Peña"
draft: false
date: 2024-04-10
tags: ["Microsoft Fabric", "Automation", "Orchestration", "Data Engineering", "ETL"]

---

I wrote "Automation in Fabric: Scheduling and Orchestration" to share practical, production-minded guidance on this topic.

Automation is key to maintaining reliable data pipelines. This guide covers scheduling, orchestration, and automation patterns in Microsoft Fabric.

## Automation Options in Fabric

```python
FABRIC_AUTOMATION_OPTIONS = {
    "data_pipelines": {
        "description": "Built-in orchestration with activities",
        "best_for": ["ETL workflows", "Data movement", "Scheduled jobs"],
        "scheduling": "Built-in scheduler with cron expressions"
    },
    "notebooks": {
        "description": "Spark notebooks for data processing",
        "best_for": ["Complex transformations", "ML workflows", "Ad-hoc analysis"],
        "scheduling": "Via pipelines or direct scheduling"
    },
    "dataflows": {
        "description": "Low-code data preparation",
        "best_for": ["Simple transformations", "Data cleansing"],
        "scheduling": "Refresh schedules"
    },
    "semantic_models": {
        "description": "Dataset refresh automation",
        "best_for": ["Report data refresh", "Incremental updates"],
        "scheduling": "Refresh schedules with incremental options"
    },
    "external": {
        "description": "Azure Functions, Logic Apps, ADF",
        "best_for": ["Complex orchestration", "Cross-service automation"],
        "scheduling": "Timer triggers, event triggers"
    }
}
```

## Data Pipeline Scheduling

```python
# Pipeline definition with scheduling
pipeline_with_schedule = {
    "name": "daily_etl_pipeline",
    "properties": {
        "activities": [
            {
                "name": "IngestData",
                "type": "Copy",
                "typeProperties": {
                    "source": {"type": "AzureBlobSource"},
                    "sink": {"type": "LakehouseSink"}
                }
            },
            {
                "name": "TransformData",
                "type": "SynapseNotebook",
                "dependsOn": [
                    {"activity": "IngestData", "dependencyConditions": ["Succeeded"]}
                ],
                "typeProperties": {
                    "notebook": {"referenceName": "transform_notebook"}
                }
            },
            {
                "name": "RefreshModel",
                "type": "SemanticModelRefresh",
                "dependsOn": [
                    {"activity": "TransformData", "dependencyConditions": ["Succeeded"]}
                ],
                "typeProperties": {
                    "dataset": {"referenceName": "SalesAnalysis"}
                }
            }
        ],
        "triggers": [
            {
                "name": "DailyTrigger",
                "type": "ScheduleTrigger",
                "typeProperties": {
                    "recurrence": {
                        "frequency": "Day",
                        "interval": 1,
                        "startTime": "2024-04-10T06:00:00Z",
                        "timeZone": "UTC"
                    }
                }
            }
        ]
    }
}
```

## Notebook Orchestration

```python
from notebookutils import mssparkutils
from datetime import datetime, timedelta
import json

class NotebookOrchestrator:
    """Orchestrate notebook execution"""

    def __init__(self):
        self.execution_log = []

    def run_notebook(
        self,
        notebook_name: str,
        parameters: dict = None,
        timeout: int = 1800
    ) -> dict:
        """Run a notebook with parameters"""

        start_time = datetime.now()

        try:
            result = mssparkutils.notebook.run(
                notebook_name,
                timeout_seconds=timeout,
                arguments=parameters or {}
            )

            execution_result = {
                "notebook": notebook_name,
                "status": "Succeeded",
                "result": result,
                "start_time": start_time.isoformat(),
                "duration_seconds": (datetime.now() - start_time).total_seconds()
            }

        except Exception as e:
            execution_result = {
                "notebook": notebook_name,
                "status": "Failed",
                "error": str(e),
                "start_time": start_time.isoformat(),
                "duration_seconds": (datetime.now() - start_time).total_seconds()
            }

        self.execution_log.append(execution_result)
        return execution_result

    def run_sequence(
        self,
        notebooks: list,
        stop_on_failure: bool = True
    ) -> list:
        """Run notebooks in sequence"""

        results = []

        for notebook_config in notebooks:
            if isinstance(notebook_config, str):
                name = notebook_config
                params = {}
            else:
                name = notebook_config["name"]
                params = notebook_config.get("parameters", {})

            result = self.run_notebook(name, params)
            results.append(result)

            if stop_on_failure and result["status"] == "Failed":
                break

        return results

    def run_parallel(
        self,
        notebooks: list,
        max_concurrent: int = 4
    ) -> list:
        """Run notebooks in parallel"""

        # Note: True parallel execution requires external orchestration
        # This is a simplified sequential implementation

        from concurrent.futures import ThreadPoolExecutor

        results = []

        def run_single(config):
            if isinstance(config, str):
                return self.run_notebook(config)
            return self.run_notebook(
                config["name"],
                config.get("parameters", {})
            )

        with ThreadPoolExecutor(max_workers=max_concurrent) as executor:
            results = list(executor.map(run_single, notebooks))

        return results

# Usage
orchestrator = NotebookOrchestrator()

# Run sequence
results = orchestrator.run_sequence([
    "01_ingest_data",
    {"name": "02_transform", "parameters": {"date": "2024-04-10"}},
    "03_validate",
    "04_publish"
])

# Check results
for r in results:
    print(f"{r['notebook']}: {r['status']} ({r['duration_seconds']:.1f}s)")
```

## Event-Driven Automation

```python
# Using Azure Event Grid with Fabric

from azure.eventgrid import EventGridPublisherClient
from azure.core.credentials import AzureKeyCredential
import json

class FabricEventAutomation:
    """Event-driven automation for Fabric"""

    def __init__(self, event_grid_endpoint: str, event_grid_key: str):
        self.client = EventGridPublisherClient(
            event_grid_endpoint,
            AzureKeyCredential(event_grid_key)
        )

    def publish_event(
        self,
        event_type: str,
        subject: str,
        data: dict
    ):
        """Publish event to trigger automation"""

        from azure.eventgrid import EventGridEvent

        event = EventGridEvent(
            event_type=event_type,
            subject=subject,
            data=data,
            data_version="1.0"
        )

        self.client.send([event])

    def trigger_pipeline_on_file_arrival(
        self,
        file_path: str,
        pipeline_name: str
    ):
        """Publish event when file arrives"""

        self.publish_event(
            event_type="Fabric.FileArrived",
            subject=f"files/{file_path}",
            data={
                "filePath": file_path,
                "pipelineName": pipeline_name,
                "timestamp": datetime.now().isoformat()
            }
        )

# Logic App / Azure Function handler
def handle_file_event(event: dict):
    """Handle file arrival event and trigger pipeline via REST API"""

    import requests
    from azure.identity import DefaultAzureCredential

    file_path = event["data"]["filePath"]
    pipeline_name = event["data"]["pipelineName"]
    workspace_id = event["data"]["workspaceId"]

    # Get token for Fabric API
    credential = DefaultAzureCredential()
    token = credential.get_token("https://api.fabric.microsoft.com/.default")

    headers = {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json"
    }

    # Trigger pipeline via Fabric REST API
    url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items/{pipeline_name}/jobs/instances?jobType=Pipeline"

    response = requests.post(
        url,
        headers=headers,
        json={"executionData": {"parameters": {"input_file": file_path}}}
    )

    return response.json()
```

## Monitoring and Alerting

```python
from datetime import datetime, timedelta
from typing import List, Dict

class AutomationMonitor:
    """Monitor automated jobs"""

    def __init__(self, fabric_client):
        self.client = fabric_client
        self.alert_handlers = []

    def add_alert_handler(self, handler):
        """Add handler for alerts"""
        self.alert_handlers.append(handler)

    def check_job_status(self, job_type: str, hours: int = 24) -> List[Dict]:
        """Check status of recent jobs"""

        # Get recent job runs
        cutoff = datetime.now() - timedelta(hours=hours)

        if job_type == "pipeline":
            runs = self.client.get_pipeline_runs()
        elif job_type == "notebook":
            runs = self.client.get_notebook_runs()
        elif job_type == "refresh":
            runs = self.client.get_refresh_history()
        else:
            runs = []

        # Filter recent runs
        recent = [r for r in runs if r.get("startTime", "") > cutoff.isoformat()]

        # Check for failures
        failures = [r for r in recent if r.get("status") == "Failed"]

        if failures:
            self._send_alerts(failures)

        return recent

    def _send_alerts(self, failures: List[Dict]):
        """Send alerts for failures"""

        for handler in self.alert_handlers:
            handler(failures)

# Alert handlers
def email_alert(failures):
    """Send email alert"""
    # Implement email sending
    print(f"Email alert: {len(failures)} job failures")

def teams_alert(failures):
    """Send Teams message"""
    # Implement Teams webhook
    print(f"Teams alert: {len(failures)} job failures")

# Usage
monitor = AutomationMonitor(fabric_client)
monitor.add_alert_handler(email_alert)
monitor.add_alert_handler(teams_alert)

# Check pipeline status
pipeline_status = monitor.check_job_status("pipeline", hours=24)
```

## Best Practices

```python
AUTOMATION_BEST_PRACTICES = {
    "idempotency": [
        "Design pipelines to be safely re-runnable",
        "Use watermarks for incremental loads",
        "Handle duplicate data gracefully"
    ],
    "error_handling": [
        "Implement retry logic with backoff",
        "Log errors with context",
        "Set up alerting for failures"
    ],
    "monitoring": [
        "Track execution times and trends",
        "Set up dashboards for job status",
        "Monitor resource utilization"
    ],
    "testing": [
        "Test pipelines in development first",
        "Use parameterization for environments",
        "Validate data quality after runs"
    ]
}
```

## Conclusion

Automation in Fabric combines built-in scheduling with external orchestration options. Use data pipelines for standard ETL, notebooks for complex logic, and event-driven patterns for real-time scenarios.

