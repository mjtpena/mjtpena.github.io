---
title: "Jobs in Azure Container Apps: Event-Driven Batch Processing"
description: "Jobs in Container Apps provide flexible batch processing capabilities. Tomorrow, I will cover Dapr 1.11 updates."
author: Michael John Peña
draft: false
date: 2023-05-29
tags:
  - Azure Container Apps
  - Jobs
  - Batch Processing
  - Event-Driven
  - Serverless
---

## Job Types

Container Apps supports three types of job triggers:

```
┌─────────────────────────────────────────────────────┐
│              Container Apps Jobs                     │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐    │
│  │  Manual    │  │  Scheduled │  │   Event    │    │
│  │  Trigger   │  │  (Cron)    │  │  Trigger   │    │
│  └────────────┘  └────────────┘  └────────────┘    │
│       │               │               │             │
│       │               │               │             │
│       ▼               ▼               ▼             │
│  ┌──────────────────────────────────────────────┐  │
│  │            Job Executions                     │  │
│  │  - Parallel replicas                          │  │
│  │  - Retry on failure                          │  │
│  │  - Timeout handling                          │  │
│  └──────────────────────────────────────────────┘  │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Manual Jobs

Perfect for on-demand processing triggered by APIs or workflows:

```bicep
// manual-job.bicep
resource manualJob 'Microsoft.App/jobs@2023-05-01' = {
  name: 'data-export-job'
  location: location
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Manual'
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      replicaTimeout: 3600  // 1 hour
      replicaRetryLimit: 2
      registries: [
        {
          server: acrServer
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'exporter'
          image: '${acrServer}/data-exporter:latest'
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: [
            {
              name: 'EXPORT_FORMAT'
              value: 'parquet'
            }
          ]
        }
      ]
    }
  }
  identity: {
    type: 'SystemAssigned'
  }
}
```

### Triggering Manual Jobs

```python
from azure.mgmt.appcontainers import ContainerAppsAPIClient
from azure.identity import DefaultAzureCredential
import json

client = ContainerAppsAPIClient(
    credential=DefaultAzureCredential(),
    subscription_id=subscription_id
)

def run_export_job(export_config: dict):
    """Trigger data export job with custom configuration"""

    execution = client.jobs.begin_start(
        resource_group_name="container-rg",
        job_name="data-export-job",
        body={
            "template": {
                "containers": [
                    {
                        "name": "exporter",
                        "image": f"{acr_server}/data-exporter:latest",
                        "env": [
                            {"name": "EXPORT_FORMAT", "value": export_config.get("format", "parquet")},
                            {"name": "DATE_RANGE_START", "value": export_config.get("start_date")},
                            {"name": "DATE_RANGE_END", "value": export_config.get("end_date")},
                            {"name": "OUTPUT_PATH", "value": export_config.get("output_path")}
                        ]
                    }
                ]
            }
        }
    ).result()

    return execution.name

# Usage
execution_name = run_export_job({
    "format": "csv",
    "start_date": "2023-01-01",
    "end_date": "2023-05-31",
    "output_path": "exports/q1-q2-2023.csv"
})
print(f"Started job execution: {execution_name}")
```

## Scheduled Jobs

Run jobs on a schedule using cron expressions:

```bicep
// scheduled-job.bicep
resource scheduledJob 'Microsoft.App/jobs@2023-05-01' = {
  name: 'daily-report-job'
  location: location
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Schedule'
      scheduleTriggerConfig: {
        cronExpression: '0 6 * * *'  // Every day at 6 AM UTC
        parallelism: 1
        replicaCompletionCount: 1
      }
      replicaTimeout: 1800  // 30 minutes
      replicaRetryLimit: 3
    }
    template: {
      containers: [
        {
          name: 'reporter'
          image: '${acrServer}/daily-reporter:latest'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'SMTP_HOST'
              value: 'smtp.sendgrid.net'
            }
            {
              name: 'SMTP_API_KEY'
              secretRef: 'smtp-key'
            }
            {
              name: 'REPORT_RECIPIENTS'
              value: 'team@company.com'
            }
          ]
        }
      ]
    }
  }
}
```

### Common Cron Patterns

```python
cron_patterns = {
    "every_minute": "* * * * *",
    "every_5_minutes": "*/5 * * * *",
    "every_hour": "0 * * * *",
    "daily_midnight": "0 0 * * *",
    "daily_6am": "0 6 * * *",
    "weekdays_9am": "0 9 * * 1-5",
    "weekly_monday": "0 0 * * 1",
    "monthly_first": "0 0 1 * *",
    "quarterly": "0 0 1 1,4,7,10 *"
}
```

## Event-Driven Jobs

Scale jobs based on events from queues, topics, or other sources:

```bicep
// event-driven-job.bicep
resource eventJob 'Microsoft.App/jobs@2023-05-01' = {
  name: 'order-processor-job'
  location: location
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Event'
      eventTriggerConfig: {
        parallelism: 10  // Up to 10 parallel executions
        replicaCompletionCount: 1
        scale: {
          minExecutions: 0
          maxExecutions: 100
          pollingInterval: 30  // Check every 30 seconds
          rules: [
            {
              name: 'queue-trigger'
              type: 'azure-queue'
              metadata: {
                queueName: 'orders'
                queueLength: '5'  // Scale up when 5+ messages
                accountName: storageAccountName
              }
              auth: [
                {
                  secretRef: 'storage-connection'
                  triggerParameter: 'connection'
                }
              ]
            }
          ]
        }
      }
      replicaTimeout: 300
      replicaRetryLimit: 3
      secrets: [
        {
          name: 'storage-connection'
          value: storageConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'processor'
          image: '${acrServer}/order-processor:latest'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'QUEUE_NAME'
              value: 'orders'
            }
            {
              name: 'STORAGE_CONNECTION'
              secretRef: 'storage-connection'
            }
          ]
        }
      ]
    }
  }
}
```

### Service Bus Trigger

```bicep
scale: {
  minExecutions: 0
  maxExecutions: 50
  rules: [
    {
      name: 'servicebus-trigger'
      type: 'azure-servicebus'
      metadata: {
        queueName: 'orders'
        messageCount: '10'
        namespace: serviceBusNamespace
      }
      auth: [
        {
          secretRef: 'sb-connection'
          triggerParameter: 'connection'
        }
      ]
    }
  ]
}
```

### Kafka Trigger

```bicep
scale: {
  minExecutions: 0
  maxExecutions: 30
  rules: [
    {
      name: 'kafka-trigger'
      type: 'kafka'
      metadata: {
        bootstrapServers: 'kafka.example.com:9092'
        consumerGroup: 'order-processors'
        topic: 'orders'
        lagThreshold: '100'
      }
    }
  ]
}
```

## Parallel Processing Pattern

```python
# parallel-processor.py
import os
import json
from azure.storage.queue import QueueClient
from concurrent.futures import ThreadPoolExecutor, as_completed

def process_message(message):
    """Process a single message"""
    try:
        data = json.loads(message.content)
        # Process the data
        result = process_order(data)
        return {"success": True, "order_id": data["order_id"], "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}

def main():
    connection_string = os.environ["STORAGE_CONNECTION"]
    queue_name = os.environ["QUEUE_NAME"]
    batch_size = int(os.environ.get("BATCH_SIZE", "32"))

    queue_client = QueueClient.from_connection_string(connection_string, queue_name)

    # Receive batch of messages
    messages = queue_client.receive_messages(max_messages=batch_size, visibility_timeout=300)
    messages_list = list(messages)

    if not messages_list:
        print("No messages to process")
        return

    print(f"Processing {len(messages_list)} messages")

    # Process in parallel
    results = []
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(process_message, msg): msg for msg in messages_list}

        for future in as_completed(futures):
            msg = futures[future]
            result = future.result()
            results.append(result)

            if result["success"]:
                # Delete successfully processed message
                queue_client.delete_message(msg)
            else:
                print(f"Failed to process message: {result['error']}")

    # Summary
    successful = sum(1 for r in results if r["success"])
    print(f"Processed: {successful}/{len(results)} successful")

if __name__ == "__main__":
    main()
```

## Monitoring Jobs

```python
from azure.mgmt.appcontainers import ContainerAppsAPIClient

def get_job_executions(job_name: str, resource_group: str):
    """Get recent job executions"""
    client = ContainerAppsAPIClient(
        credential=DefaultAzureCredential(),
        subscription_id=subscription_id
    )

    executions = client.job_execution.list(
        resource_group_name=resource_group,
        job_name=job_name
    )

    for execution in executions:
        print(f"Execution: {execution.name}")
        print(f"  Status: {execution.status}")
        print(f"  Start: {execution.start_time}")
        print(f"  End: {execution.end_time}")

        if execution.template and execution.template.containers:
            for container in execution.template.containers:
                print(f"  Container: {container.name}")

        print()

# Get executions
get_job_executions("order-processor-job", "container-rg")
```

Jobs in Container Apps provide flexible batch processing capabilities. Tomorrow, I will cover Dapr 1.11 updates.

## Resources

- [Container Apps Jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs)
- [Job Tutorial](https://learn.microsoft.com/en-us/azure/container-apps/tutorial-jobs-github-actions)
- [KEDA Scalers](https://keda.sh/docs/2.10/scalers/)
