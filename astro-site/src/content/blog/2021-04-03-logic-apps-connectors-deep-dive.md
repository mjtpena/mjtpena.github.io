---
title: Logic Apps Connectors - A Deep Dive into Enterprise Integration
author: Michael John Peña
draft: false
date: 2021-04-03
url: /blog/logic-apps-connectors-deep-dive/
tags:
  - Azure
  - Logic Apps
  - Integration
  - Connectors
  - Enterprise
---

Logic Apps connectors are the product feature that makes integration architects either love or dread the platform. Over 400 connectors covering everything from SAP ERP to Salesforce to on-premises SQL Server through the on-premises data gateway. The love part: you can prototype a complex integration in an afternoon that would take weeks to code. The dread part: managed connector behaviour changes without warning, throttling limits are buried in documentation, and the "enterprise" connectors require a Premium or ISE tier that materially changes the cost model. Today's post is the deep dive on the connector taxonomy, the ISE vs. shared service trade-offs, and the patterns I use to avoid the expensive edge cases.

## Understanding Connector Types

Logic Apps connectors fall into several categories:

### Built-in Connectors
These run natively within the Logic Apps runtime, offering the best performance:

- **HTTP** - Generic REST API calls
- **Request/Response** - Expose your workflow as an API
- **Schedule** - Time-based triggers
- **Batch** - Process messages in batches

### Managed Connectors
Microsoft-managed connectors that communicate with external services:

- **Standard** - Office 365, SQL Server, Azure Services
- **Enterprise** - SAP, IBM MQ, Oracle DB (additional cost)
- **Premium** - Salesforce, ServiceNow (additional cost)

### Custom Connectors
Build your own connectors using OpenAPI specifications.

## Common Connector Patterns

### Pattern 1: Database Integration with SQL Server

```json
{
    "definition": {
        "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
        "triggers": {
            "When_an_item_is_created": {
                "type": "ApiConnection",
                "inputs": {
                    "host": {
                        "connection": {
                            "name": "@parameters('$connections')['sql']['connectionId']"
                        }
                    },
                    "method": "get",
                    "path": "/datasets/default/tables/@{encodeURIComponent('[dbo].[Orders]')}/onnewitems"
                },
                "recurrence": {
                    "frequency": "Minute",
                    "interval": 1
                }
            }
        },
        "actions": {
            "Process_Order": {
                "type": "ApiConnection",
                "inputs": {
                    "host": {
                        "connection": {
                            "name": "@parameters('$connections')['sql']['connectionId']"
                        }
                    },
                    "method": "patch",
                    "path": "/v2/datasets/default/tables/@{encodeURIComponent('[dbo].[Orders]')}/items/@{encodeURIComponent(triggerBody()?['Id'])}",
                    "body": {
                        "Status": "Processing",
                        "ProcessedDate": "@utcNow()"
                    }
                }
            }
        }
    }
}
```

### Pattern 2: Office 365 Email Processing

Automatically process incoming emails with attachments:

```json
{
    "triggers": {
        "When_a_new_email_arrives": {
            "type": "ApiConnection",
            "inputs": {
                "host": {
                    "connection": {
                        "name": "@parameters('$connections')['office365']['connectionId']"
                    }
                },
                "method": "get",
                "path": "/v2/Mail/OnNewEmail",
                "queries": {
                    "folderPath": "Inbox",
                    "hasAttachment": true,
                    "includeAttachments": true,
                    "importance": "Any"
                }
            },
            "recurrence": {
                "frequency": "Minute",
                "interval": 3
            }
        }
    },
    "actions": {
        "For_each_attachment": {
            "type": "Foreach",
            "foreach": "@triggerBody()?['Attachments']",
            "actions": {
                "Upload_to_Blob": {
                    "type": "ApiConnection",
                    "inputs": {
                        "host": {
                            "connection": {
                                "name": "@parameters('$connections')['azureblob']['connectionId']"
                            }
                        },
                        "method": "post",
                        "path": "/v2/datasets/default/files",
                        "queries": {
                            "folderPath": "/email-attachments",
                            "name": "@items('For_each_attachment')?['Name']"
                        },
                        "body": "@base64ToBinary(items('For_each_attachment')?['ContentBytes'])"
                    }
                }
            }
        }
    }
}
```

### Pattern 3: Salesforce to Dynamics 365 Sync

```json
{
    "triggers": {
        "When_a_record_is_created_Salesforce": {
            "type": "ApiConnection",
            "inputs": {
                "host": {
                    "connection": {
                        "name": "@parameters('$connections')['salesforce']['connectionId']"
                    }
                },
                "method": "get",
                "path": "/datasets/default/tables/@{encodeURIComponent('Account')}/onnewitems"
            },
            "recurrence": {
                "frequency": "Minute",
                "interval": 5
            }
        }
    },
    "actions": {
        "Create_Account_in_Dynamics": {
            "type": "ApiConnection",
            "inputs": {
                "host": {
                    "connection": {
                        "name": "@parameters('$connections')['dynamicscrmonline']['connectionId']"
                    }
                },
                "method": "post",
                "path": "/v2/datasets/@{encodeURIComponent(encodeURIComponent('org123.crm.dynamics.com'))}/tables/@{encodeURIComponent(encodeURIComponent('accounts'))}/items",
                "body": {
                    "name": "@triggerBody()?['Name']",
                    "telephone1": "@triggerBody()?['Phone']",
                    "emailaddress1": "@triggerBody()?['Email']",
                    "address1_city": "@triggerBody()?['BillingCity']",
                    "description": "Synced from Salesforce: @{triggerBody()?['Id']}"
                }
            }
        }
    }
}
```

## Creating Custom Connectors

When existing connectors don't meet your needs, create custom connectors.

### Step 1: Define OpenAPI Specification

```yaml
swagger: '2.0'
info:
  title: Custom Inventory API
  version: '1.0'
host: api.mycompany.com
basePath: /v1
schemes:
  - https
securityDefinitions:
  apiKeyHeader:
    type: apiKey
    name: X-API-Key
    in: header
paths:
  /inventory/{productId}:
    get:
      summary: Get product inventory
      operationId: GetInventory
      parameters:
        - name: productId
          in: path
          required: true
          type: string
      responses:
        '200':
          description: Success
          schema:
            $ref: '#/definitions/InventoryResponse'
    put:
      summary: Update inventory
      operationId: UpdateInventory
      parameters:
        - name: productId
          in: path
          required: true
          type: string
        - name: body
          in: body
          required: true
          schema:
            $ref: '#/definitions/InventoryUpdate'
      responses:
        '200':
          description: Success
definitions:
  InventoryResponse:
    type: object
    properties:
      productId:
        type: string
      quantity:
        type: integer
      warehouse:
        type: string
  InventoryUpdate:
    type: object
    properties:
      quantity:
        type: integer
      reason:
        type: string
```

### Step 2: Register in Azure Portal

1. Navigate to **Custom connectors** in Logic Apps
2. Create from **OpenAPI file**
3. Configure authentication
4. Test the connector
5. Create connection and use in workflows

## Connector Authentication Patterns

### OAuth 2.0 with Azure AD

```json
{
    "type": "ActiveDirectoryOAuth",
    "audience": "https://graph.microsoft.com",
    "clientId": "@parameters('clientId')",
    "clientSecret": "@parameters('clientSecret')",
    "tenant": "@parameters('tenantId')"
}
```

### API Key Authentication

```json
{
    "type": "ApiKey",
    "name": "X-API-Key",
    "in": "Header"
}
```

### Managed Identity

```json
{
    "type": "ManagedServiceIdentity",
    "audience": "https://storage.azure.com/"
}
```

## Error Handling and Retry Policies

Configure retry behavior for unreliable connections:

```json
{
    "actions": {
        "Call_External_API": {
            "type": "Http",
            "inputs": {
                "method": "POST",
                "uri": "https://api.external.com/process"
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
}
```

## Monitoring and Diagnostics

Enable diagnostic logging for connector troubleshooting:

```powershell
# Enable diagnostic settings
$workspaceId = "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/{workspace}"

Set-AzDiagnosticSetting -ResourceId $logicAppId `
    -WorkspaceId $workspaceId `
    -Enabled $true `
    -Category @("WorkflowRuntime", "Metrics")
```

Query connector performance:

```kusto
AzureDiagnostics
| where ResourceType == "WORKFLOWS"
| where Category == "WorkflowRuntime"
| where OperationName contains "connector"
| summarize
    AvgDuration = avg(duration_d),
    FailureCount = countif(status_s == "Failed"),
    SuccessCount = countif(status_s == "Succeeded")
    by connectorName_s, bin(TimeGenerated, 1h)
```

## Best Practices

1. **Use connection references** in solutions for ALM
2. **Implement dead-letter queues** for failed messages
3. **Monitor connector throttling** and adjust concurrency
4. **Use secure inputs/outputs** for sensitive data
5. **Leverage caching** where possible to reduce API calls

## Conclusion

Logic Apps connectors provide a powerful abstraction for enterprise integration. By understanding the connector types, authentication patterns, and best practices, you can build robust integration solutions that connect your enterprise systems seamlessly. The combination of built-in, managed, and custom connectors ensures you can integrate with virtually any system.
