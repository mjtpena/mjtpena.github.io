---
title: Azure Resource Manager Templates Best Practices
author: Michael John Peña
draft: false
date: 2021-02-21
url: /blog/arm-templates-best-practices/
tags:
  - Azure
  - ARM Templates
  - Infrastructure as Code
  - DevOps
  - Bicep
---

I've written a lot of ARM templates in the past three years, and I've also inherited a lot of ARM templates written by people who were having a bad day. The difference between maintainable and unmaintainable is usually not complexity—it's a handful of discipline choices made early: linked templates instead of a single 4,000-line blob, parameter files per environment instead of hardcoded values, `description` on every parameter so the next person doesn't have to guess, and `apiVersion` pinned to something you've tested. Bicep is the future (and I'd use it for anything new), but these ARM practices still matter while you're migrating legacy.

## Template Structure

### Basic Template

```json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "metadata": {
        "description": "Deploys a web application with SQL database",
        "author": "Michael John Pena",
        "version": "1.0.0"
    },
    "parameters": {},
    "variables": {},
    "functions": [],
    "resources": [],
    "outputs": {}
}
```

### Parameters Best Practices

```json
{
    "parameters": {
        "environment": {
            "type": "string",
            "allowedValues": ["dev", "staging", "prod"],
            "metadata": {
                "description": "Environment name for resource naming"
            }
        },
        "location": {
            "type": "string",
            "defaultValue": "[resourceGroup().location]",
            "metadata": {
                "description": "Location for all resources"
            }
        },
        "appServicePlanSku": {
            "type": "object",
            "defaultValue": {
                "name": "S1",
                "tier": "Standard",
                "capacity": 1
            },
            "metadata": {
                "description": "SKU configuration for App Service Plan"
            }
        },
        "sqlAdminPassword": {
            "type": "securestring",
            "metadata": {
                "description": "SQL Server admin password"
            }
        },
        "tags": {
            "type": "object",
            "defaultValue": {
                "environment": "[parameters('environment')]",
                "managedBy": "ARM Template"
            }
        }
    }
}
```

### Variables for Naming Conventions

```json
{
    "variables": {
        "prefix": "[concat('app', parameters('environment'))]",
        "appServicePlanName": "[concat(variables('prefix'), '-plan')]",
        "webAppName": "[concat(variables('prefix'), '-web-', uniqueString(resourceGroup().id))]",
        "sqlServerName": "[concat(variables('prefix'), '-sql-', uniqueString(resourceGroup().id))]",
        "sqlDatabaseName": "[concat(variables('prefix'), '-db')]",
        "storageAccountName": "[concat(replace(variables('prefix'), '-', ''), uniqueString(resourceGroup().id))]",
        "appInsightsName": "[concat(variables('prefix'), '-insights')]",
        "keyVaultName": "[concat(variables('prefix'), '-kv-', uniqueString(resourceGroup().id))]"
    }
}
```

## Resource Dependencies

```json
{
    "resources": [
        {
            "type": "Microsoft.Web/serverfarms",
            "apiVersion": "2021-02-01",
            "name": "[variables('appServicePlanName')]",
            "location": "[parameters('location')]",
            "tags": "[parameters('tags')]",
            "sku": "[parameters('appServicePlanSku')]",
            "properties": {}
        },
        {
            "type": "Microsoft.Web/sites",
            "apiVersion": "2021-02-01",
            "name": "[variables('webAppName')]",
            "location": "[parameters('location')]",
            "tags": "[parameters('tags')]",
            "dependsOn": [
                "[resourceId('Microsoft.Web/serverfarms', variables('appServicePlanName'))]",
                "[resourceId('Microsoft.Insights/components', variables('appInsightsName'))]"
            ],
            "identity": {
                "type": "SystemAssigned"
            },
            "properties": {
                "serverFarmId": "[resourceId('Microsoft.Web/serverfarms', variables('appServicePlanName'))]",
                "siteConfig": {
                    "appSettings": [
                        {
                            "name": "APPINSIGHTS_INSTRUMENTATIONKEY",
                            "value": "[reference(resourceId('Microsoft.Insights/components', variables('appInsightsName'))).InstrumentationKey]"
                        },
                        {
                            "name": "APPLICATIONINSIGHTS_CONNECTION_STRING",
                            "value": "[reference(resourceId('Microsoft.Insights/components', variables('appInsightsName'))).ConnectionString]"
                        },
                        {
                            "name": "KeyVaultUri",
                            "value": "[reference(resourceId('Microsoft.KeyVault/vaults', variables('keyVaultName'))).vaultUri]"
                        }
                    ],
                    "connectionStrings": [
                        {
                            "name": "DefaultConnection",
                            "connectionString": "[concat('Server=tcp:', reference(resourceId('Microsoft.Sql/servers', variables('sqlServerName'))).fullyQualifiedDomainName, ',1433;Database=', variables('sqlDatabaseName'), ';')]",
                            "type": "SQLAzure"
                        }
                    ]
                }
            }
        }
    ]
}
```

## Linked Templates for Modularity

### Main Template

```json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "templateBaseUrl": {
            "type": "string",
            "defaultValue": "https://raw.githubusercontent.com/myorg/templates/main/"
        },
        "environment": {
            "type": "string"
        }
    },
    "resources": [
        {
            "type": "Microsoft.Resources/deployments",
            "apiVersion": "2021-04-01",
            "name": "networkDeployment",
            "properties": {
                "mode": "Incremental",
                "templateLink": {
                    "uri": "[concat(parameters('templateBaseUrl'), 'modules/network.json')]",
                    "contentVersion": "1.0.0.0"
                },
                "parameters": {
                    "environment": {"value": "[parameters('environment')]"}
                }
            }
        },
        {
            "type": "Microsoft.Resources/deployments",
            "apiVersion": "2021-04-01",
            "name": "storageDeployment",
            "properties": {
                "mode": "Incremental",
                "templateLink": {
                    "uri": "[concat(parameters('templateBaseUrl'), 'modules/storage.json')]"
                },
                "parameters": {
                    "environment": {"value": "[parameters('environment')]"},
                    "subnetId": {"value": "[reference('networkDeployment').outputs.storageSubnetId.value]"}
                }
            },
            "dependsOn": ["networkDeployment"]
        },
        {
            "type": "Microsoft.Resources/deployments",
            "apiVersion": "2021-04-01",
            "name": "webAppDeployment",
            "properties": {
                "mode": "Incremental",
                "templateLink": {
                    "uri": "[concat(parameters('templateBaseUrl'), 'modules/webapp.json')]"
                },
                "parameters": {
                    "environment": {"value": "[parameters('environment')]"},
                    "subnetId": {"value": "[reference('networkDeployment').outputs.webSubnetId.value]"},
                    "storageAccountName": {"value": "[reference('storageDeployment').outputs.storageAccountName.value]"}
                }
            },
            "dependsOn": ["networkDeployment", "storageDeployment"]
        }
    ],
    "outputs": {
        "webAppUrl": {
            "type": "string",
            "value": "[reference('webAppDeployment').outputs.url.value]"
        }
    }
}
```

## Conditional Deployments

```json
{
    "parameters": {
        "deployDiagnostics": {
            "type": "bool",
            "defaultValue": true
        },
        "environment": {
            "type": "string"
        }
    },
    "variables": {
        "isProduction": "[equals(parameters('environment'), 'prod')]"
    },
    "resources": [
        {
            "condition": "[parameters('deployDiagnostics')]",
            "type": "Microsoft.Insights/diagnosticSettings",
            "apiVersion": "2021-05-01-preview",
            "name": "diagnostics",
            "scope": "[resourceId('Microsoft.Web/sites', variables('webAppName'))]",
            "dependsOn": [
                "[resourceId('Microsoft.Web/sites', variables('webAppName'))]"
            ],
            "properties": {
                "workspaceId": "[resourceId('Microsoft.OperationalInsights/workspaces', variables('logAnalyticsName'))]",
                "logs": [
                    {
                        "category": "AppServiceHTTPLogs",
                        "enabled": true
                    }
                ]
            }
        },
        {
            "condition": "[variables('isProduction')]",
            "type": "Microsoft.Web/sites/slots",
            "apiVersion": "2021-02-01",
            "name": "[concat(variables('webAppName'), '/staging')]",
            "location": "[parameters('location')]",
            "dependsOn": [
                "[resourceId('Microsoft.Web/sites', variables('webAppName'))]"
            ],
            "properties": {
                "serverFarmId": "[resourceId('Microsoft.Web/serverfarms', variables('appServicePlanName'))]"
            }
        }
    ]
}
```

## Copy Loops

```json
{
    "parameters": {
        "storageAccounts": {
            "type": "array",
            "defaultValue": [
                {"name": "data", "sku": "Standard_LRS"},
                {"name": "logs", "sku": "Standard_GRS"},
                {"name": "backup", "sku": "Standard_RAGRS"}
            ]
        }
    },
    "resources": [
        {
            "type": "Microsoft.Storage/storageAccounts",
            "apiVersion": "2021-06-01",
            "name": "[concat(variables('prefix'), parameters('storageAccounts')[copyIndex()].name, uniqueString(resourceGroup().id))]",
            "location": "[parameters('location')]",
            "tags": "[parameters('tags')]",
            "copy": {
                "name": "storageCopy",
                "count": "[length(parameters('storageAccounts'))]",
                "mode": "Parallel"
            },
            "sku": {
                "name": "[parameters('storageAccounts')[copyIndex()].sku]"
            },
            "kind": "StorageV2",
            "properties": {
                "minimumTlsVersion": "TLS1_2",
                "supportsHttpsTrafficOnly": true,
                "allowBlobPublicAccess": false
            }
        }
    ]
}
```

## User-Defined Functions

```json
{
    "functions": [
        {
            "namespace": "naming",
            "members": {
                "resourceName": {
                    "parameters": [
                        {"name": "prefix", "type": "string"},
                        {"name": "resourceType", "type": "string"},
                        {"name": "environment", "type": "string"}
                    ],
                    "output": {
                        "type": "string",
                        "value": "[toLower(concat(parameters('prefix'), '-', parameters('resourceType'), '-', parameters('environment')))]"
                    }
                },
                "uniqueName": {
                    "parameters": [
                        {"name": "prefix", "type": "string"},
                        {"name": "resourceType", "type": "string"}
                    ],
                    "output": {
                        "type": "string",
                        "value": "[toLower(concat(parameters('prefix'), parameters('resourceType'), uniqueString(resourceGroup().id)))]"
                    }
                }
            }
        }
    ],
    "variables": {
        "webAppName": "[naming.resourceName('app', 'web', parameters('environment'))]",
        "storageAccountName": "[naming.uniqueName('st', 'app')]"
    }
}
```

## Outputs for Downstream Processes

```json
{
    "outputs": {
        "webAppName": {
            "type": "string",
            "value": "[variables('webAppName')]"
        },
        "webAppUrl": {
            "type": "string",
            "value": "[concat('https://', reference(resourceId('Microsoft.Web/sites', variables('webAppName'))).defaultHostName)]"
        },
        "webAppIdentityPrincipalId": {
            "type": "string",
            "value": "[reference(resourceId('Microsoft.Web/sites', variables('webAppName')), '2021-02-01', 'Full').identity.principalId]"
        },
        "resourceIds": {
            "type": "object",
            "value": {
                "webApp": "[resourceId('Microsoft.Web/sites', variables('webAppName'))]",
                "appServicePlan": "[resourceId('Microsoft.Web/serverfarms', variables('appServicePlanName'))]",
                "sqlServer": "[resourceId('Microsoft.Sql/servers', variables('sqlServerName'))]"
            }
        }
    }
}
```

## Deployment Scripts

```json
{
    "resources": [
        {
            "type": "Microsoft.Resources/deploymentScripts",
            "apiVersion": "2020-10-01",
            "name": "configureApp",
            "location": "[parameters('location')]",
            "kind": "AzurePowerShell",
            "identity": {
                "type": "UserAssigned",
                "userAssignedIdentities": {
                    "[resourceId('Microsoft.ManagedIdentity/userAssignedIdentities', variables('identityName'))]": {}
                }
            },
            "dependsOn": [
                "[resourceId('Microsoft.Web/sites', variables('webAppName'))]"
            ],
            "properties": {
                "azPowerShellVersion": "6.4",
                "timeout": "PT30M",
                "arguments": "[format('-WebAppName {0} -ResourceGroup {1}', variables('webAppName'), resourceGroup().name)]",
                "scriptContent": "
                    param([string]$WebAppName, [string]$ResourceGroup)

                    # Configure web app settings
                    $settings = @{
                        'WEBSITE_RUN_FROM_PACKAGE' = '1'
                        'WEBSITE_ENABLE_SYNC_UPDATE_SITE' = 'true'
                    }

                    Set-AzWebApp -Name $WebAppName -ResourceGroupName $ResourceGroup -AppSettings $settings

                    $output = @{
                        'configured' = $true
                        'timestamp' = (Get-Date).ToString('o')
                    }

                    $DeploymentScriptOutputs = $output
                ",
                "cleanupPreference": "OnSuccess",
                "retentionInterval": "P1D"
            }
        }
    ]
}
```

## Best Practices Summary

1. **Use consistent naming** with variables and functions
2. **Externalize parameters** for environment-specific values
3. **Use secure parameters** for sensitive data
4. **Modularize with linked templates** for reusability
5. **Always specify API versions** explicitly
6. **Add metadata and comments** for documentation
7. **Use conditions** for optional resources
8. **Validate templates** before deployment
9. **Use What-If** to preview changes
10. **Consider migrating to Bicep** for improved authoring experience

## Conclusion

ARM templates remain a powerful tool for Infrastructure as Code on Azure. By following these best practices, you can create maintainable, reusable templates that scale with your organization's needs.

For new projects, consider using Bicep, which compiles to ARM templates but offers a cleaner syntax and better tooling support.
