---
title: "Azure Logic Apps: Enterprise Integration Patterns"
description: "Logic Apps is the first thing I build in when a client says \"we need to integrate with Salesforce, then push to SAP, then notify the team in Teams.\"…"
author: Michael John Peña
draft: false
date: 2020-11-28
tags:
  - Azure
  - Logic Apps
  - Integration
  - Serverless
---

Logic Apps is the first thing I build in when a client says "we need to integrate with Salesforce, then push to SAP, then notify the team in Teams." Hundreds of connectors, a visual designer, and—now in Standard preview—single-tenant hosting on the Functions runtime. Standard is the version I've been waiting for: VNet integration, local development in VS Code, and the ability to run multiple workflows in one app. Pricing model finally makes sense too.

## Why Logic Apps?

Logic Apps excels at:

- **System Integration**: Connect SaaS apps, on-premises systems, and Azure services
- **Business Process Automation**: Automate approval workflows, notifications, and data synchronization
- **B2B Integration**: EDI, AS2, and enterprise messaging patterns
- **Event-Driven Architectures**: React to events across your organization

## Creating a Logic App

```bash
# Create a Logic App (Consumption plan)
az logic workflow create \
    --name my-workflow \
    --resource-group myRG \
    --location eastus \
    --definition @workflow-definition.json
```

## Workflow Definition

```json
{
    "definition": {
        "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
        "triggers": {
            "When_a_HTTP_request_is_received": {
                "type": "Request",
                "kind": "Http",
                "inputs": {
                    "schema": {
                        "type": "object",
                        "properties": {
                            "orderId": { "type": "string" },
                            "customerEmail": { "type": "string" },
                            "amount": { "type": "number" }
                        }
                    }
                }
            }
        },
        "actions": {
            "Get_customer_details": {
                "type": "Http",
                "inputs": {
                    "method": "GET",
                    "uri": "https://api.example.com/customers/@{triggerBody()?['customerId']}"
                },
                "runAfter": {}
            },
            "Condition": {
                "type": "If",
                "expression": {
                    "and": [{
                        "greater": ["@triggerBody()?['amount']", 1000]
                    }]
                },
                "actions": {
                    "Send_approval_email": {
                        "type": "ApiConnection",
                        "inputs": {
                            "host": {
                                "connection": {
                                    "name": "@parameters('$connections')['office365']['connectionId']"
                                }
                            },
                            "method": "post",
                            "path": "/v2/Mail",
                            "body": {
                                "To": "approvers@company.com",
                                "Subject": "High-value order requires approval",
                                "Body": "Order @{triggerBody()?['orderId']} for $@{triggerBody()?['amount']}"
                            }
                        }
                    }
                },
                "else": {
                    "actions": {
                        "Process_order": {
                            "type": "Http",
                            "inputs": {
                                "method": "POST",
                                "uri": "https://api.example.com/orders/process",
                                "body": "@triggerBody()"
                            }
                        }
                    }
                },
                "runAfter": {
                    "Get_customer_details": ["Succeeded"]
                }
            },
            "Response": {
                "type": "Response",
                "inputs": {
                    "statusCode": 200,
                    "body": {
                        "status": "processed",
                        "orderId": "@triggerBody()?['orderId']"
                    }
                },
                "runAfter": {
                    "Condition": ["Succeeded"]
                }
            }
        }
    }
}
```

## Common Triggers

### Schedule Trigger

```json
{
    "triggers": {
        "Recurrence": {
            "type": "Recurrence",
            "recurrence": {
                "frequency": "Day",
                "interval": 1,
                "schedule": {
                    "hours": ["9"],
                    "minutes": ["0"]
                },
                "timeZone": "Pacific Standard Time"
            }
        }
    }
}
```

### Event Grid Trigger

```json
{
    "triggers": {
        "When_a_resource_event_occurs": {
            "type": "ApiConnectionWebhook",
            "inputs": {
                "host": {
                    "connection": {
                        "name": "@parameters('$connections')['azureeventgrid']['connectionId']"
                    }
                },
                "body": {
                    "properties": {
                        "topic": "/subscriptions/.../resourceGroups/.../providers/Microsoft.Storage/storageAccounts/mystorage",
                        "events": ["Microsoft.Storage.BlobCreated"]
                    }
                }
            }
        }
    }
}
```

### Service Bus Trigger

```json
{
    "triggers": {
        "When_a_message_is_received": {
            "type": "ApiConnection",
            "inputs": {
                "host": {
                    "connection": {
                        "name": "@parameters('$connections')['servicebus']['connectionId']"
                    }
                },
                "method": "get",
                "path": "/@{encodeURIComponent('orders')}/messages/head",
                "queries": {
                    "queueType": "Main"
                }
            },
            "recurrence": {
                "frequency": "Minute",
                "interval": 1
            }
        }
    }
}
```

## Working with Connectors

Logic Apps offers 400+ connectors:

### Office 365

```json
{
    "Send_an_email": {
        "type": "ApiConnection",
        "inputs": {
            "host": {
                "connection": {
                    "name": "@parameters('$connections')['office365']['connectionId']"
                }
            },
            "method": "post",
            "path": "/v2/Mail",
            "body": {
                "To": "@{triggerBody()?['email']}",
                "Subject": "Your order confirmation",
                "Body": "<p>Thank you for your order!</p>",
                "Importance": "Normal"
            }
        }
    }
}
```

### SQL Server

```json
{
    "Get_rows": {
        "type": "ApiConnection",
        "inputs": {
            "host": {
                "connection": {
                    "name": "@parameters('$connections')['sql']['connectionId']"
                }
            },
            "method": "get",
            "path": "/datasets/default/tables/@{encodeURIComponent('Orders')}/items",
            "queries": {
                "$filter": "Status eq 'Pending'"
            }
        }
    }
}
```

### Azure Blob Storage

```json
{
    "Create_blob": {
        "type": "ApiConnection",
        "inputs": {
            "host": {
                "connection": {
                    "name": "@parameters('$connections')['azureblob']['connectionId']"
                }
            },
            "method": "post",
            "path": "/datasets/default/files",
            "queries": {
                "folderPath": "/output",
                "name": "@{guid()}.json"
            },
            "body": "@body('Transform_data')"
        }
    }
}
```

## Error Handling

### Retry Policies

```json
{
    "Call_external_API": {
        "type": "Http",
        "inputs": {
            "method": "POST",
            "uri": "https://api.example.com/process"
        },
        "retryPolicy": {
            "type": "exponential",
            "count": 4,
            "interval": "PT7S",
            "minimumInterval": "PT5S",
            "maximumInterval": "PT1H"
        }
    }
}
```

### Scopes for Try-Catch

```json
{
    "Try_scope": {
        "type": "Scope",
        "actions": {
            "Risky_operation": { }
        }
    },
    "Catch_scope": {
        "type": "Scope",
        "actions": {
            "Log_error": {
                "type": "Http",
                "inputs": {
                    "method": "POST",
                    "uri": "https://api.example.com/log",
                    "body": "@result('Try_scope')"
                }
            }
        },
        "runAfter": {
            "Try_scope": ["Failed", "TimedOut"]
        }
    }
}
```

## Monitoring and Diagnostics

### Enable Diagnostic Logging

```bash
az monitor diagnostic-settings create \
    --name logic-app-diagnostics \
    --resource /subscriptions/.../Microsoft.Logic/workflows/my-workflow \
    --logs '[{"category": "WorkflowRuntime", "enabled": true}]' \
    --workspace /subscriptions/.../Microsoft.OperationalInsights/workspaces/my-workspace
```

### Query Run History

```kusto
// Azure Monitor query
AzureDiagnostics
| where ResourceType == "WORKFLOWS"
| where status_s == "Failed"
| project TimeGenerated, workflowName_s, error_message_s
| order by TimeGenerated desc
```

## Pricing Considerations

Logic Apps (Consumption) pricing:
- Actions: ~$0.000025 per action
- Standard connectors: ~$0.000125 per call
- Enterprise connectors: ~$0.001 per call
- Integration Account: $0.42/hour (for B2B scenarios)

## Best Practices

1. **Use parameters**: Externalize configuration for different environments
2. **Implement retry policies**: Handle transient failures gracefully
3. **Use scopes**: Group related actions for better error handling
4. **Monitor proactively**: Set up alerts for failed runs
5. **Secure connections**: Use managed identities where possible
6. **Version control**: Export ARM templates and store in source control

Logic Apps: enterprise integration without the complexity.

## Resources

- [Logic Apps Documentation](https://docs.microsoft.com/en-us/azure/logic-apps/)
- [Connector Reference](https://docs.microsoft.com/en-us/connectors/)
- [Enterprise Integration Pack](https://docs.microsoft.com/en-us/azure/logic-apps/logic-apps-enterprise-integration-overview)
