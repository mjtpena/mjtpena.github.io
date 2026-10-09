---
title: "Azure Data Factory Web Activity: Integrating REST APIs in Data Pipelines"
description: "The Web activity in ADF is the HTTP client that lets your pipeline call external REST APIs—triggering a Logic App, posting a Teams notification, calling a…"
author: "Michael John Peña"
draft: false
date: 2021-08-30
tags: ["Azure", "Data Factory", "Web Activity", "REST API", "Integration"]
---

The Web activity in ADF is the HTTP client that lets your pipeline call external REST APIs—triggering a Logic App, posting a Teams notification, calling a custom API, or invoking any REST endpoint as part of pipeline orchestration. The authentication options matter: Managed Identity authentication (for Azure services that support it), Basic auth, Client Certificate, or no auth for public APIs. The response body is available in subsequent activities via `@activity('WebActivity').output.body`, enabling conditional logic based on API responses or passing API return values into subsequent activities. I use the Web activity most for: posting pipeline status to Teams channels via incoming webhooks, triggering Logic Apps for approval workflows in Durable Functions-style human-in-the-loop patterns, and calling custom APIs for data enrichment that doesn't have a native ADF connector.

## Basic Web Activity

```json
{
    "name": "CallRestApi",
    "type": "WebActivity",
    "typeProperties": {
        "url": "https://api.service.com/v1/data",
        "method": "GET",
        "headers": {
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        "authentication": {
            "type": "MSI",
            "resource": "https://api.service.com"
        }
    }
}
```

## POST Request with Body

```json
{
    "name": "PostToApi",
    "type": "WebActivity",
    "typeProperties": {
        "url": "https://api.service.com/v1/process",
        "method": "POST",
        "headers": {
            "Content-Type": "application/json"
        },
        "body": {
            "value": "@json(concat('{\"jobId\": \"', pipeline().RunId, '\", \"tableName\": \"', pipeline().parameters.tableName, '\", \"timestamp\": \"', utcnow(), '\"}'))",
            "type": "Expression"
        }
    }
}
```

## Authentication Methods

### API Key Authentication

```json
{
    "name": "ApiKeyAuth",
    "type": "WebActivity",
    "typeProperties": {
        "url": "https://api.service.com/data",
        "method": "GET",
        "headers": {
            "X-API-Key": {
                "value": "@pipeline().parameters.apiKey",
                "type": "Expression"
            }
        }
    }
}
```

### OAuth Bearer Token

```json
{
    "name": "GetOAuthToken",
    "type": "WebActivity",
    "typeProperties": {
        "url": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
        "method": "POST",
        "headers": {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        "body": "grant_type=client_credentials&client_id={client_id}&client_secret={secret}&scope=https://api.service.com/.default"
    }
}
```

```json
{
    "name": "CallApiWithToken",
    "type": "WebActivity",
    "dependsOn": [
        {
            "activity": "GetOAuthToken",
            "dependencyConditions": ["Succeeded"]
        }
    ],
    "typeProperties": {
        "url": "https://api.service.com/data",
        "method": "GET",
        "headers": {
            "Authorization": {
                "value": "@concat('Bearer ', activity('GetOAuthToken').output.access_token)",
                "type": "Expression"
            }
        }
    }
}
```

### Managed Identity Authentication

```json
{
    "name": "MsiAuthWebActivity",
    "type": "WebActivity",
    "typeProperties": {
        "url": "https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Sql/servers/{server}/databases?api-version=2021-02-01-preview",
        "method": "GET",
        "authentication": {
            "type": "MSI",
            "resource": "https://management.azure.com"
        }
    }
}
```

## Calling Azure Functions

```json
{
    "name": "CallAzureFunction",
    "type": "WebActivity",
    "typeProperties": {
        "url": {
            "value": "@concat('https://', pipeline().parameters.functionAppName, '.azurewebsites.net/api/ProcessData')",
            "type": "Expression"
        },
        "method": "POST",
        "headers": {
            "Content-Type": "application/json",
            "x-functions-key": {
                "value": "@pipeline().parameters.functionKey",
                "type": "Expression"
            }
        },
        "body": {
            "value": "@pipeline().parameters.functionInput",
            "type": "Expression"
        }
    },
    "linkedServiceName": {
        "referenceName": "AzureFunctionLinkedService",
        "type": "LinkedServiceReference"
    }
}
```

## Error Handling and Retry

```json
{
    "name": "WebActivityWithRetry",
    "type": "WebActivity",
    "policy": {
        "timeout": "0.00:10:00",
        "retry": 3,
        "retryIntervalInSeconds": 30,
        "secureOutput": false,
        "secureInput": false
    },
    "typeProperties": {
        "url": "https://api.service.com/data",
        "method": "GET"
    }
}
```

## Handling Web Activity Output

```json
{
    "name": "ProcessApiResponse",
    "properties": {
        "activities": [
            {
                "name": "CallApi",
                "type": "WebActivity",
                "typeProperties": {
                    "url": "https://api.service.com/orders",
                    "method": "GET"
                }
            },
            {
                "name": "CheckResponse",
                "type": "IfCondition",
                "dependsOn": [
                    {
                        "activity": "CallApi",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "expression": {
                        "value": "@greater(length(activity('CallApi').output.data), 0)",
                        "type": "Expression"
                    },
                    "ifTrueActivities": [
                        {
                            "name": "ProcessData",
                            "type": "ForEach",
                            "typeProperties": {
                                "items": {
                                    "value": "@activity('CallApi').output.data",
                                    "type": "Expression"
                                },
                                "activities": [
                                    {
                                        "name": "InsertRecord",
                                        "type": "SqlServerStoredProcedure",
                                        "typeProperties": {
                                            "storedProcedureName": "sp_InsertOrder",
                                            "storedProcedureParameters": {
                                                "OrderId": { "value": "@item().id" },
                                                "CustomerName": { "value": "@item().customer.name" },
                                                "Amount": { "value": "@item().totalAmount" }
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

## Paginated API Calls

```json
{
    "name": "PaginatedApiPipeline",
    "properties": {
        "variables": {
            "hasMorePages": { "type": "Bool", "defaultValue": "true" },
            "pageNumber": { "type": "Int", "defaultValue": "1" },
            "allResults": { "type": "Array" }
        },
        "activities": [
            {
                "name": "FetchAllPages",
                "type": "Until",
                "typeProperties": {
                    "expression": {
                        "value": "@equals(variables('hasMorePages'), false)",
                        "type": "Expression"
                    },
                    "timeout": "0.01:00:00",
                    "activities": [
                        {
                            "name": "FetchPage",
                            "type": "WebActivity",
                            "typeProperties": {
                                "url": {
                                    "value": "@concat('https://api.service.com/data?page=', variables('pageNumber'), '&pageSize=100')",
                                    "type": "Expression"
                                },
                                "method": "GET"
                            }
                        },
                        {
                            "name": "ProcessPage",
                            "type": "Copy",
                            "dependsOn": [
                                {
                                    "activity": "FetchPage",
                                    "dependencyConditions": ["Succeeded"]
                                }
                            ],
                            "typeProperties": {
                                "source": {
                                    "type": "RestSource",
                                    "additionalColumns": [
                                        {
                                            "name": "PageNumber",
                                            "value": {
                                                "value": "@string(variables('pageNumber'))",
                                                "type": "Expression"
                                            }
                                        }
                                    ]
                                },
                                "sink": { "type": "ParquetSink" }
                            }
                        },
                        {
                            "name": "CheckMorePages",
                            "type": "SetVariable",
                            "dependsOn": [
                                {
                                    "activity": "ProcessPage",
                                    "dependencyConditions": ["Succeeded"]
                                }
                            ],
                            "typeProperties": {
                                "variableName": "hasMorePages",
                                "value": {
                                    "value": "@activity('FetchPage').output.hasMorePages",
                                    "type": "Expression"
                                }
                            }
                        },
                        {
                            "name": "IncrementPage",
                            "type": "SetVariable",
                            "dependsOn": [
                                {
                                    "activity": "CheckMorePages",
                                    "dependencyConditions": ["Succeeded"]
                                }
                            ],
                            "typeProperties": {
                                "variableName": "pageNumber",
                                "value": {
                                    "value": "@add(variables('pageNumber'), 1)",
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

## Webhook Integration

```json
{
    "name": "WebhookNotification",
    "type": "WebActivity",
    "typeProperties": {
        "url": "https://hooks.slack.com/services/xxx/yyy/zzz",
        "method": "POST",
        "headers": {
            "Content-Type": "application/json"
        },
        "body": {
            "value": "@json(concat('{\"text\": \"Pipeline ', pipeline().Pipeline, ' completed with status: ', pipeline().parameters.status, '\", \"channel\": \"#data-ops\"}'))",
            "type": "Expression"
        }
    }
}
```

## Secure Input/Output

```json
{
    "name": "SecureWebActivity",
    "type": "WebActivity",
    "policy": {
        "secureInput": true,
        "secureOutput": true
    },
    "typeProperties": {
        "url": "https://api.service.com/sensitive-data",
        "method": "POST",
        "headers": {
            "Authorization": {
                "value": "@concat('Bearer ', pipeline().parameters.sensitiveToken)",
                "type": "Expression"
            }
        },
        "body": {
            "value": "@pipeline().parameters.sensitivePayload",
            "type": "Expression"
        }
    }
}
```

## Best Practices

1. **Use Managed Identity**: When possible, avoid storing credentials
2. **Set appropriate timeouts**: Prevent hanging pipelines
3. **Handle pagination**: For APIs returning large datasets
4. **Secure sensitive data**: Use secureInput/secureOutput
5. **Implement retry logic**: Handle transient failures

The Web Activity opens up endless integration possibilities, allowing Azure Data Factory to orchestrate workflows across diverse systems and services through REST APIs.
