---
title: ARM Template Specs for Enterprise Template Management
author: Michael John Peña
draft: false
date: 2021-06-12
url: /blog/arm-template-specs/
tags:
  - Azure
  - ARM Templates
  - Infrastructure as Code
  - DevOps

---

I wrote "2021-06-12-arm-template-specs" to share practical, production-minded guidance on this topic.

## Creating Template Specs

### Basic Template Spec via CLI

```bash
# Create a template spec from a local file
az ts create \
  --name webapp-template \
  --version 1.0.0 \
  --resource-group template-specs-rg \
  --location australiaeast \
  --template-file ./templates/webapp.json \
  --description "Standard web application infrastructure"

# Create with linked templates
az ts create \
  --name full-stack-template \
  --version 1.0.0 \
  --resource-group template-specs-rg \
  --location australiaeast \
  --template-file ./main.json \
  --linked-templates ./modules/ \
  --description "Full stack application with database"
```

### Template Spec Structure

```json
// webapp.json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "metadata": {
    "description": "Deploys a standard web application with App Service and Application Insights"
  },
  "parameters": {
    "appName": {
      "type": "string",
      "metadata": {
        "description": "Name of the application"
      }
    },
    "environment": {
      "type": "string",
      "allowedValues": ["dev", "staging", "prod"],
      "metadata": {
        "description": "Deployment environment"
      }
    },
    "location": {
      "type": "string",
      "defaultValue": "[resourceGroup().location]"
    }
  },
  "variables": {
    "appServicePlanName": "[concat('asp-', parameters('appName'), '-', parameters('environment'))]",
    "webAppName": "[concat('app-', parameters('appName'), '-', parameters('environment'))]",
    "appInsightsName": "[concat('appi-', parameters('appName'), '-', parameters('environment'))]",
    "isProd": "[equals(parameters('environment'), 'prod')]",
    "skuName": "[if(variables('isProd'), 'S1', 'B1')]"
  },
  "resources": [
    {
      "type": "Microsoft.Web/serverfarms",
      "apiVersion": "2021-02-01",
      "name": "[variables('appServicePlanName')]",
      "location": "[parameters('location')]",
      "sku": {
        "name": "[variables('skuName')]"
      },
      "kind": "linux",
      "properties": {
        "reserved": true
      }
    },
    {
      "type": "Microsoft.Insights/components",
      "apiVersion": "2020-02-02",
      "name": "[variables('appInsightsName')]",
      "location": "[parameters('location')]",
      "kind": "web",
      "properties": {
        "Application_Type": "web"
      }
    },
    {
      "type": "Microsoft.Web/sites",
      "apiVersion": "2021-02-01",
      "name": "[variables('webAppName')]",
      "location": "[parameters('location')]",
      "dependsOn": [
        "[resourceId('Microsoft.Web/serverfarms', variables('appServicePlanName'))]",
        "[resourceId('Microsoft.Insights/components', variables('appInsightsName'))]"
      ],
      "identity": {
        "type": "SystemAssigned"
      },
      "properties": {
        "serverFarmId": "[resourceId('Microsoft.Web/serverfarms', variables('appServicePlanName'))]",
        "httpsOnly": true,
        "siteConfig": {
          "linuxFxVersion": "DOTNETCORE|6.0",
          "alwaysOn": "[variables('isProd')]",
          "http20Enabled": true,
          "minTlsVersion": "1.2",
          "appSettings": [
            {
              "name": "ASPNETCORE_ENVIRONMENT",
              "value": "[if(variables('isProd'), 'Production', 'Development')]"
            },
            {
              "name": "APPLICATIONINSIGHTS_CONNECTION_STRING",
              "value": "[reference(resourceId('Microsoft.Insights/components', variables('appInsightsName'))).ConnectionString]"
            }
          ]
        }
      }
    }
  ],
  "outputs": {
    "webAppUrl": {
      "type": "string",
      "value": "[concat('https://', reference(resourceId('Microsoft.Web/sites', variables('webAppName'))).defaultHostName)]"
    },
    "webAppPrincipalId": {
      "type": "string",
      "value": "[reference(resourceId('Microsoft.Web/sites', variables('webAppName')), '2021-02-01', 'full').identity.principalId]"
    }
  }
}
```

## Versioning Template Specs

```bash
# Create new version
az ts create \
  --name webapp-template \
  --version 1.1.0 \
  --resource-group template-specs-rg \
  --template-file ./templates/webapp-v1.1.json

# List versions
az ts list \
  --resource-group template-specs-rg \
  --name webapp-template \
  --query "[].{Name:name, Version:version, Description:description}"

# Show specific version
az ts show \
  --name webapp-template \
  --version 1.0.0 \
  --resource-group template-specs-rg
```

## Deploying from Template Specs

### CLI Deployment

```bash
# Get template spec ID
TEMPLATE_SPEC_ID=$(az ts show \
  --name webapp-template \
  --version 1.0.0 \
  --resource-group template-specs-rg \
  --query id \
  --output tsv)

# Deploy using template spec
az deployment group create \
  --resource-group my-app-rg \
  --template-spec $TEMPLATE_SPEC_ID \
  --parameters appName=mywebapp environment=dev
```

### PowerShell Deployment

```powershell
# Get template spec
$templateSpec = Get-AzTemplateSpec `
  -ResourceGroupName "template-specs-rg" `
  -Name "webapp-template" `
  -Version "1.0.0"

# Deploy
New-AzResourceGroupDeployment `
  -ResourceGroupName "my-app-rg" `
  -TemplateSpecId $templateSpec.Versions[0].Id `
  -appName "mywebapp" `
  -environment "prod"
```

### Deploying from Another Template

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "templateSpecResourceGroup": {
      "type": "string",
      "defaultValue": "template-specs-rg"
    }
  },
  "resources": [
    {
      "type": "Microsoft.Resources/deployments",
      "apiVersion": "2021-04-01",
      "name": "webAppDeployment",
      "properties": {
        "mode": "Incremental",
        "templateLink": {
          "id": "[resourceId(parameters('templateSpecResourceGroup'), 'Microsoft.Resources/templateSpecs/versions', 'webapp-template', '1.0.0')]"
        },
        "parameters": {
          "appName": {
            "value": "myapp"
          },
          "environment": {
            "value": "dev"
          }
        }
      }
    }
  ]
}
```

## Template Spec with Linked Templates

### Main Template

```json
// main.json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "appName": { "type": "string" },
    "environment": { "type": "string" },
    "sqlAdminPassword": { "type": "securestring" }
  },
  "resources": [
    {
      "type": "Microsoft.Resources/deployments",
      "apiVersion": "2021-04-01",
      "name": "appServiceDeployment",
      "properties": {
        "mode": "Incremental",
        "templateLink": {
          "relativePath": "modules/appService.json"
        },
        "parameters": {
          "appName": { "value": "[parameters('appName')]" },
          "environment": { "value": "[parameters('environment')]" }
        }
      }
    },
    {
      "type": "Microsoft.Resources/deployments",
      "apiVersion": "2021-04-01",
      "name": "sqlDeployment",
      "properties": {
        "mode": "Incremental",
        "templateLink": {
          "relativePath": "modules/sqlDatabase.json"
        },
        "parameters": {
          "appName": { "value": "[parameters('appName')]" },
          "environment": { "value": "[parameters('environment')]" },
          "adminPassword": { "value": "[parameters('sqlAdminPassword')]" }
        }
      }
    },
    {
      "type": "Microsoft.Resources/deployments",
      "apiVersion": "2021-04-01",
      "name": "keyVaultDeployment",
      "dependsOn": [
        "appServiceDeployment",
        "sqlDeployment"
      ],
      "properties": {
        "mode": "Incremental",
        "templateLink": {
          "relativePath": "modules/keyVault.json"
        },
        "parameters": {
          "appName": { "value": "[parameters('appName')]" },
          "environment": { "value": "[parameters('environment')]" },
          "appServicePrincipalId": {
            "value": "[reference('appServiceDeployment').outputs.principalId.value]"
          },
          "sqlConnectionString": {
            "value": "[reference('sqlDeployment').outputs.connectionString.value]"
          }
        }
      }
    }
  ]
}
```

### Creating Template Spec with Linked Templates

```bash
# Directory structure
# templates/
#   main.json
#   modules/
#     appService.json
#     sqlDatabase.json
#     keyVault.json

az ts create \
  --name full-stack-template \
  --version 1.0.0 \
  --resource-group template-specs-rg \
  --location australiaeast \
  --template-file ./templates/main.json \
  --linked-templates ./templates/modules/ \
  --description "Full stack with App Service, SQL, and Key Vault"
```

## RBAC for Template Specs

```bash
# Grant reader access to deployment team
az role assignment create \
  --role "Template Spec Reader" \
  --assignee deployment-team@company.com \
  --scope "/subscriptions/{sub-id}/resourceGroups/template-specs-rg/providers/Microsoft.Resources/templateSpecs/webapp-template"

# Grant contributor access for template management
az role assignment create \
  --role "Template Spec Contributor" \
  --assignee infra-team@company.com \
  --scope "/subscriptions/{sub-id}/resourceGroups/template-specs-rg"
```

## CI/CD Integration

### Azure DevOps Pipeline

```yaml
trigger:
  paths:
    include:
      - templates/*

pool:
  vmImage: 'ubuntu-latest'

variables:
  templateSpecsRg: 'template-specs-rg'
  location: 'australiaeast'

stages:
  - stage: ValidateAndPublish
    jobs:
      - job: Validate
        steps:
          - task: AzureCLI@2
            displayName: 'Validate templates'
            inputs:
              azureSubscription: 'Azure-Connection'
              scriptType: 'bash'
              scriptLocation: 'inlineScript'
              inlineScript: |
                for template in templates/*.json; do
                  echo "Validating $template"
                  az deployment group validate \
                    --resource-group $(templateSpecsRg) \
                    --template-file $template \
                    --parameters appName=test environment=dev
                done

      - job: Publish
        dependsOn: Validate
        condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
        steps:
          - task: AzureCLI@2
            displayName: 'Publish template specs'
            inputs:
              azureSubscription: 'Azure-Connection'
              scriptType: 'bash'
              scriptLocation: 'inlineScript'
              inlineScript: |
                VERSION=$(date +%Y.%m.%d).$(Build.BuildId)

                az ts create \
                  --name webapp-template \
                  --version $VERSION \
                  --resource-group $(templateSpecsRg) \
                  --location $(location) \
                  --template-file ./templates/webapp.json \
                  --yes
```

### GitHub Actions Workflow

```yaml
name: Publish Template Specs

on:
  push:
    branches: [main]
    paths:
      - 'templates/**'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Publish Template Spec
        run: |
          VERSION=$(date +%Y.%m.%d).${{ github.run_number }}

          az ts create \
            --name webapp-template \
            --version $VERSION \
            --resource-group template-specs-rg \
            --location australiaeast \
            --template-file ./templates/webapp.json \
            --yes

          echo "Published version: $VERSION"
```

## Exporting Template Specs

```bash
# Export template spec to files
az ts export \
  --name webapp-template \
  --version 1.0.0 \
  --resource-group template-specs-rg \
  --output-folder ./exported-templates
```

## Conclusion

ARM Template Specs provide a governed, versioned approach to managing infrastructure templates. With native RBAC integration and first-class Azure resource status, Template Specs are ideal for organizations that need to standardize deployments while maintaining flexibility. Combined with CI/CD pipelines, they enable a robust GitOps workflow for infrastructure management.

## References

- [ARM Template Specs Documentation](https://docs.microsoft.com/en-us/azure/azure-resource-manager/templates/template-specs)
- [Template Specs with Linked Templates](https://docs.microsoft.com/en-us/azure/azure-resource-manager/templates/template-specs-create-linked)

