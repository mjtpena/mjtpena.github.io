---
title: "Azure Logic Apps: Connectors for Everything"
author: Michael John Peña
draft: false
date: 2020-10-19
tags:
  - Azure
  - Logic Apps
  - Integration
  - Low-Code

---

I wrote "Azure Logic Apps: Connectors for Everything" to share practical, production-minded guidance on this topic.

## Popular Connectors

| Category | Connectors |
|----------|------------|
| Microsoft | Office 365, SharePoint, Dynamics 365, Teams |
| Data | SQL Server, Cosmos DB, Azure Blob, Excel |
| Communication | Outlook, Twilio, SendGrid, Slack |
| Social | Twitter, Facebook, LinkedIn |
| Enterprise | SAP, Salesforce, ServiceNow |

## Basic Workflow

```json
{
    "definition": {
        "$schema": "https://schema.management.azure.com/schemas/2016-06-01/workflowdefinition.json#",
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
                    "path": "/v2/Mail/OnNewEmail"
                }
            }
        },
        "actions": {
            "Send_Teams_message": {
                "type": "ApiConnection",
                "inputs": {
                    "body": {
                        "body": {
                            "content": "New email from @{triggerBody()?['from']}"
                        }
                    },
                    "host": {
                        "connection": {
                            "name": "@parameters('$connections')['teams']['connectionId']"
                        }
                    },
                    "method": "post",
                    "path": "/v3/beta/teams/@{encodeURIComponent('team-id')}/channels/@{encodeURIComponent('channel-id')}/messages"
                }
            }
        }
    }
}
```

## HTTP Triggers

Accept webhooks from any source.

```json
{
    "triggers": {
        "manual": {
            "type": "Request",
            "kind": "Http",
            "inputs": {
                "schema": {
                    "type": "object",
                    "properties": {
                        "orderId": { "type": "string" },
                        "amount": { "type": "number" }
                    }
                }
            }
        }
    }
}
```

## Conditions and Loops

```json
{
    "actions": {
        "Condition": {
            "type": "If",
            "expression": {
                "and": [
                    {
                        "greater": ["@triggerBody()?['amount']", 1000]
                    }
                ]
            },
            "actions": {
                "Send_approval_email": { }
            },
            "else": {
                "actions": {
                    "Auto_approve": { }
                }
            }
        },
        "For_each_item": {
            "type": "Foreach",
            "foreach": "@triggerBody()?['items']",
            "actions": {
                "Process_item": { }
            }
        }
    }
}
```

## SQL Connector

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
    },
    "Insert_row": {
        "type": "ApiConnection",
        "inputs": {
            "body": {
                "OrderId": "@triggerBody()?['orderId']",
                "Status": "Processed",
                "ProcessedDate": "@utcNow()"
            },
            "host": {
                "connection": {
                    "name": "@parameters('$connections')['sql']['connectionId']"
                }
            },
            "method": "post",
            "path": "/datasets/default/tables/@{encodeURIComponent('ProcessedOrders')}/items"
        }
    }
}
```

## Custom Connectors

Create connectors for your APIs.

```yaml
# OpenAPI definition for custom connector
swagger: "2.0"
info:
  title: "My Custom API"
  version: "1.0"
host: "api.mycompany.com"
schemes: ["https"]
paths:
  /orders:
    get:
      summary: "Get orders"
      operationId: "GetOrders"
      responses:
        200:
          description: "Success"
          schema:
            type: array
            items:
              $ref: "#/definitions/Order"
definitions:
  Order:
    type: object
    properties:
      id:
        type: string
      total:
        type: number
```

## Enterprise Integration

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Salesforce  │────▶│ Logic App   │────▶│ Dynamics    │
│  (Trigger)  │     │ (Transform) │     │   365       │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  ServiceNow │
                    │  (Ticket)   │
                    └─────────────┘
```

Logic Apps is the integration glue for enterprise systems.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
