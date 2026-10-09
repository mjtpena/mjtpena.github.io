---
title: "Azure Logic Apps Standard: Single-Tenant Workflows"
description: "Logic Apps Consumption was great for \"wire up two SaaS apps quickly\" and increasingly painful at scale—shared multi-tenant runtime, no VNet integration…"
author: Michael John Peña
draft: false
date: 2021-01-10
tags:
  - Azure
  - Logic Apps
  - Integration
  - Serverless
---

Logic Apps Consumption was great for "wire up two SaaS apps quickly" and increasingly painful at scale—shared multi-tenant runtime, no VNet integration, per-action billing that surprised everyone. Standard rebuilds Logic Apps on the single-tenant Functions runtime. You get VNet integration, local development in VS Code, multiple workflows per app, and a pricing model that actually scales. I've started defaulting to Standard for any workflow that's heading to production.

## Standard vs Consumption

| Feature | Standard | Consumption |
|---------|----------|-------------|
| Hosting | Single-tenant | Multi-tenant |
| Runtime | Functions runtime | Shared |
| Local dev | VS Code support | Portal only |
| Networking | VNet integration | Limited |
| Pricing | App Service plan | Per action |

## Create Standard Logic App

```bash
# Create App Service plan
az appservice plan create \
    --name my-logic-plan \
    --resource-group myRG \
    --sku WS1 \
    --is-linux false

# Create Logic App Standard
az logicapp create \
    --name my-logic-app \
    --resource-group myRG \
    --plan my-logic-plan \
    --storage-account mystorageaccount
```

## Workflow Definition

```json
{
    "definition": {
        "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
        "contentVersion": "1.0.0.0",
        "triggers": {
            "When_a_HTTP_request_is_received": {
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
        },
        "actions": {
            "Parse_Order": {
                "type": "ParseJson",
                "inputs": {
                    "content": "@triggerBody()",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "orderId": { "type": "string" },
                            "amount": { "type": "number" }
                        }
                    }
                },
                "runAfter": {}
            },
            "Condition": {
                "type": "If",
                "expression": {
                    "and": [
                        {
                            "greater": ["@body('Parse_Order')?['amount']", 1000]
                        }
                    ]
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
                            "path": "/v2/Mail"
                        }
                    }
                },
                "else": {
                    "actions": {
                        "Auto_approve": {
                            "type": "Http",
                            "inputs": {
                                "method": "POST",
                                "uri": "https://api.example.com/approve",
                                "body": "@body('Parse_Order')"
                            }
                        }
                    }
                },
                "runAfter": {
                    "Parse_Order": ["Succeeded"]
                }
            }
        }
    }
}
```

## Local Development with VS Code

```json
// .vscode/settings.json
{
    "azureLogicAppsStandard.autoRuntimeDependenciesValidation": true,
    "azureLogicAppsStandard.projectRuntime": "~4"
}
```

```json
// host.json
{
    "version": "2.0",
    "extensionBundle": {
        "id": "Microsoft.Azure.Functions.ExtensionBundle.Workflows",
        "version": "[1.*, 2.0.0)"
    }
}
```

## Built-in Connectors

```json
{
    "actions": {
        "Call_Azure_Function": {
            "type": "Function",
            "inputs": {
                "function": {
                    "id": "/subscriptions/.../functions/ProcessOrder"
                },
                "body": "@triggerBody()"
            }
        },
        "Service_Bus_Send": {
            "type": "ServiceProvider",
            "inputs": {
                "parameters": {
                    "entityName": "orders",
                    "message": {
                        "contentData": "@body('Parse_Order')"
                    }
                },
                "serviceProviderConfiguration": {
                    "connectionName": "serviceBus",
                    "operationId": "sendMessage",
                    "serviceProviderId": "/serviceProviders/serviceBus"
                }
            }
        }
    }
}
```

## Stateful vs Stateless Workflows

```json
// Stateful - persists run history
{
    "kind": "Stateful",
    "definition": { ... }
}

// Stateless - in-memory only, faster
{
    "kind": "Stateless",
    "definition": { ... }
}
```

## VNet Integration

```bash
# Enable VNet integration
az logicapp vnet-integration add \
    --name my-logic-app \
    --resource-group myRG \
    --vnet myVNet \
    --subnet logic-apps-subnet
```

## Deployment

```yaml
# Azure DevOps pipeline
trigger:
  - main

pool:
  vmImage: 'windows-latest'

steps:
  - task: AzureCLI@2
    inputs:
      azureSubscription: 'my-subscription'
      scriptType: 'ps'
      scriptLocation: 'inlineScript'
      inlineScript: |
        az logicapp deployment source config-zip `
          --name my-logic-app `
          --resource-group myRG `
          --src $(Build.ArtifactStagingDirectory)/logicapp.zip
```

Logic Apps Standard: enterprise integration with developer control.
