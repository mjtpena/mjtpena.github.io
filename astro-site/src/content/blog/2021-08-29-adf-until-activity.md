---
title: "Azure Data Factory Until Activity: Implementing Loops and Polling Patterns"
author: "Michael John Peña"
draft: false
date: 2021-08-29
tags: ["Azure", "Data Factory", "Until", "Loops", "Polling"]
---

The Until activity in ADF is the polling loop that keeps running until a condition is true—useful for pipelines that trigger an external process and need to wait for it to complete before proceeding. The pattern: trigger a Databricks job via REST API using a Web activity, then use Until with a nested Web activity that polls the job status API every 30 seconds. The Until expression evaluates a boolean condition on the nested activities' output: `@equals(activity('CheckJobStatus').output.state, 'SUCCEEDED')`. A timeout parameter prevents infinite loops when the external process fails silently. I use Until most often for long-running Databricks jobs, external API batch requests that complete asynchronously, and data readiness checks (wait until a file arrives in a folder before processing it).

## Basic Until Structure

```json
{
    "name": "WaitForFileReady",
    "type": "Until",
    "typeProperties": {
        "expression": {
            "value": "@equals(variables('fileReady'), true)",
            "type": "Expression"
        },
        "timeout": "0.01:00:00",
        "activities": [
            {
                "name": "CheckFile",
                "type": "GetMetadata",
                "typeProperties": {
                    "dataset": {
                        "referenceName": "SourceFileDataset",
                        "type": "DatasetReference"
                    },
                    "fieldList": ["exists"]
                }
            },
            {
                "name": "SetFileReadyVariable",
                "type": "SetVariable",
                "dependsOn": [
                    {
                        "activity": "CheckFile",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "variableName": "fileReady",
                    "value": {
                        "value": "@activity('CheckFile').output.exists",
                        "type": "Expression"
                    }
                }
            },
            {
                "name": "WaitBeforeRetry",
                "type": "Wait",
                "dependsOn": [
                    {
                        "activity": "SetFileReadyVariable",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "waitTimeInSeconds": 60
                }
            }
        ]
    }
}
```

## Polling External API

```json
{
    "name": "PollExternalJob",
    "properties": {
        "variables": {
            "jobStatus": { "type": "String", "defaultValue": "Running" },
            "pollCount": { "type": "Int", "defaultValue": "0" }
        },
        "activities": [
            {
                "name": "StartExternalJob",
                "type": "WebActivity",
                "typeProperties": {
                    "url": "https://api.external-service.com/jobs",
                    "method": "POST",
                    "body": {
                        "jobType": "DataProcessing",
                        "parameters": "@pipeline().parameters.jobParams"
                    }
                }
            },
            {
                "name": "WaitForJobCompletion",
                "type": "Until",
                "dependsOn": [
                    {
                        "activity": "StartExternalJob",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "expression": {
                        "value": "@or(equals(variables('jobStatus'), 'Completed'), equals(variables('jobStatus'), 'Failed'))",
                        "type": "Expression"
                    },
                    "timeout": "0.02:00:00",
                    "activities": [
                        {
                            "name": "CheckJobStatus",
                            "type": "WebActivity",
                            "typeProperties": {
                                "url": {
                                    "value": "@concat('https://api.external-service.com/jobs/', activity('StartExternalJob').output.jobId, '/status')",
                                    "type": "Expression"
                                },
                                "method": "GET"
                            }
                        },
                        {
                            "name": "UpdateJobStatus",
                            "type": "SetVariable",
                            "dependsOn": [
                                {
                                    "activity": "CheckJobStatus",
                                    "dependencyConditions": ["Succeeded"]
                                }
                            ],
                            "typeProperties": {
                                "variableName": "jobStatus",
                                "value": {
                                    "value": "@activity('CheckJobStatus').output.status",
                                    "type": "Expression"
                                }
                            }
                        },
                        {
                            "name": "IncrementPollCount",
                            "type": "SetVariable",
                            "dependsOn": [
                                {
                                    "activity": "UpdateJobStatus",
                                    "dependencyConditions": ["Succeeded"]
                                }
                            ],
                            "typeProperties": {
                                "variableName": "pollCount",
                                "value": {
                                    "value": "@add(variables('pollCount'), 1)",
                                    "type": "Expression"
                                }
                            }
                        },
                        {
                            "name": "WaitBetweenPolls",
                            "type": "Wait",
                            "dependsOn": [
                                {
                                    "activity": "IncrementPollCount",
                                    "dependencyConditions": ["Succeeded"]
                                }
                            ],
                            "typeProperties": {
                                "waitTimeInSeconds": 30
                            }
                        }
                    ]
                }
            },
            {
                "name": "CheckFinalStatus",
                "type": "IfCondition",
                "dependsOn": [
                    {
                        "activity": "WaitForJobCompletion",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "expression": {
                        "value": "@equals(variables('jobStatus'), 'Failed')",
                        "type": "Expression"
                    },
                    "ifTrueActivities": [
                        {
                            "name": "FailPipeline",
                            "type": "Fail",
                            "typeProperties": {
                                "message": "External job failed",
                                "errorCode": "500"
                            }
                        }
                    ]
                }
            }
        ]
    }
}
```

## Retry Pattern with Exponential Backoff

```json
{
    "name": "RetryWithBackoff",
    "properties": {
        "variables": {
            "success": { "type": "Bool", "defaultValue": "false" },
            "retryCount": { "type": "Int", "defaultValue": "0" },
            "waitSeconds": { "type": "Int", "defaultValue": "5" }
        },
        "activities": [
            {
                "name": "RetryLoop",
                "type": "Until",
                "typeProperties": {
                    "expression": {
                        "value": "@or(variables('success'), greater(variables('retryCount'), 5))",
                        "type": "Expression"
                    },
                    "timeout": "0.00:30:00",
                    "activities": [
                        {
                            "name": "AttemptOperation",
                            "type": "WebActivity",
                            "typeProperties": {
                                "url": "https://api.service.com/operation",
                                "method": "POST"
                            }
                        },
                        {
                            "name": "SetSuccess",
                            "type": "SetVariable",
                            "dependsOn": [
                                {
                                    "activity": "AttemptOperation",
                                    "dependencyConditions": ["Succeeded"]
                                }
                            ],
                            "typeProperties": {
                                "variableName": "success",
                                "value": true
                            }
                        },
                        {
                            "name": "IncrementRetry",
                            "type": "SetVariable",
                            "dependsOn": [
                                {
                                    "activity": "AttemptOperation",
                                    "dependencyConditions": ["Failed"]
                                }
                            ],
                            "typeProperties": {
                                "variableName": "retryCount",
                                "value": {
                                    "value": "@add(variables('retryCount'), 1)",
                                    "type": "Expression"
                                }
                            }
                        },
                        {
                            "name": "CalculateBackoff",
                            "type": "SetVariable",
                            "dependsOn": [
                                {
                                    "activity": "IncrementRetry",
                                    "dependencyConditions": ["Succeeded"]
                                }
                            ],
                            "typeProperties": {
                                "variableName": "waitSeconds",
                                "value": {
                                    "value": "@mul(5, variables('retryCount'))",
                                    "type": "Expression"
                                }
                            }
                        },
                        {
                            "name": "WaitBeforeRetry",
                            "type": "Wait",
                            "dependsOn": [
                                {
                                    "activity": "CalculateBackoff",
                                    "dependencyConditions": ["Succeeded"]
                                }
                            ],
                            "typeProperties": {
                                "waitTimeInSeconds": {
                                    "value": "@variables('waitSeconds')",
                                    "type": "Expression"
                                }
                            }
                        }
                    ]
                }
            }
        ]
    }
}
```

## Waiting for Database Availability

```json
{
    "name": "WaitForDatabase",
    "type": "Until",
    "typeProperties": {
        "expression": {
            "value": "@variables('databaseReady')",
            "type": "Expression"
        },
        "timeout": "0.00:30:00",
        "activities": [
            {
                "name": "TestConnection",
                "type": "Lookup",
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": "SELECT 1 as IsAlive"
                    },
                    "dataset": {
                        "referenceName": "TargetDatabase",
                        "type": "DatasetReference"
                    }
                },
                "policy": {
                    "timeout": "0.00:00:30"
                }
            },
            {
                "name": "SetDatabaseReady",
                "type": "SetVariable",
                "dependsOn": [
                    {
                        "activity": "TestConnection",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "variableName": "databaseReady",
                    "value": true
                }
            },
            {
                "name": "HandleConnectionFailure",
                "type": "Wait",
                "dependsOn": [
                    {
                        "activity": "TestConnection",
                        "dependencyConditions": ["Failed"]
                    }
                ],
                "typeProperties": {
                    "waitTimeInSeconds": 10
                }
            }
        ]
    }
}
```

## Processing Items Until Empty

```json
{
    "name": "ProcessQueueUntilEmpty",
    "properties": {
        "variables": {
            "hasMoreItems": { "type": "Bool", "defaultValue": "true" }
        },
        "activities": [
            {
                "name": "ProcessUntilEmpty",
                "type": "Until",
                "typeProperties": {
                    "expression": {
                        "value": "@equals(variables('hasMoreItems'), false)",
                        "type": "Expression"
                    },
                    "timeout": "0.12:00:00",
                    "activities": [
                        {
                            "name": "GetBatch",
                            "type": "Lookup",
                            "typeProperties": {
                                "source": {
                                    "type": "AzureSqlSource",
                                    "sqlReaderQuery": "SELECT TOP 100 * FROM ProcessingQueue WHERE Status = 'Pending' ORDER BY CreatedDate"
                                },
                                "firstRowOnly": false
                            }
                        },
                        {
                            "name": "CheckIfMoreItems",
                            "type": "SetVariable",
                            "dependsOn": [
                                {
                                    "activity": "GetBatch",
                                    "dependencyConditions": ["Succeeded"]
                                }
                            ],
                            "typeProperties": {
                                "variableName": "hasMoreItems",
                                "value": {
                                    "value": "@greater(activity('GetBatch').output.count, 0)",
                                    "type": "Expression"
                                }
                            }
                        },
                        {
                            "name": "ProcessBatch",
                            "type": "ForEach",
                            "dependsOn": [
                                {
                                    "activity": "CheckIfMoreItems",
                                    "dependencyConditions": ["Succeeded"]
                                }
                            ],
                            "typeProperties": {
                                "items": "@activity('GetBatch').output.value",
                                "isSequential": false,
                                "batchCount": 10,
                                "activities": [
                                    {
                                        "name": "ProcessItem",
                                        "type": "ExecutePipeline",
                                        "typeProperties": {
                                            "pipeline": {
                                                "referenceName": "ProcessItemPipeline",
                                                "type": "PipelineReference"
                                            },
                                            "parameters": {
                                                "itemId": "@item().Id"
                                            }
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                }
            }
        ]
    }
}
```

## Monitoring Until Activity

```python
# Python - Monitor Until activity iterations
def monitor_until_activity(client, resource_group, factory_name, run_id,
                           until_activity_name):
    """Monitor iterations of an Until activity"""

    iterations = []
    start_time = datetime.utcnow()

    while True:
        activity_runs = client.activity_runs.query_by_pipeline_run(
            resource_group,
            factory_name,
            run_id,
            {
                'lastUpdatedAfter': start_time - timedelta(hours=1),
                'lastUpdatedBefore': datetime.utcnow()
            }
        )

        until_activities = [
            a for a in activity_runs.value
            if until_activity_name in a.activity_name
        ]

        for activity in until_activities:
            iteration_info = {
                'iteration': len(iterations) + 1,
                'status': activity.status,
                'start_time': activity.activity_run_start,
                'end_time': activity.activity_run_end,
                'duration_ms': activity.duration_in_ms
            }
            iterations.append(iteration_info)

        # Check if Until completed
        main_activity = next(
            (a for a in activity_runs.value
             if a.activity_name == until_activity_name),
            None
        )

        if main_activity and main_activity.status in ['Succeeded', 'Failed']:
            break

        time.sleep(10)

    return {
        'total_iterations': len(iterations),
        'final_status': main_activity.status if main_activity else 'Unknown',
        'iterations': iterations
    }
```

## Best Practices

1. **Always set timeout**: Prevent infinite loops
2. **Include wait activities**: Avoid tight polling loops
3. **Log iteration status**: Track progress within the loop
4. **Handle failure states**: Don't just wait for success
5. **Use variables wisely**: Track state between iterations

The Until Activity enables sophisticated control flow patterns that go beyond simple linear pipelines, allowing you to build resilient integrations that wait for and respond to external events.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
