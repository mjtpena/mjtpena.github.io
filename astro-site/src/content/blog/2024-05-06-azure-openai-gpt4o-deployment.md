---
title: "Deploying GPT-4o on Azure OpenAI Service"
author: Michael John Peña
draft: false
date: 2024-05-06
tags:
  - Azure
  - OpenAI
  - GPT-4o
  - Azure OpenAI
  - Deployment
---

## Creating a GPT-4o Deployment

### Azure Portal

1. Navigate to your Azure OpenAI resource
2. Go to Model deployments > Deploy model
3. Select `gpt-4o` from the model list
4. Configure deployment settings
5. Deploy

### Azure CLI

```bash
# Create Azure OpenAI resource (if needed)
az cognitiveservices account create \
    --name myopenai \
    --resource-group mygroup \
    --kind OpenAI \
    --sku S0 \
    --location eastus

# Deploy GPT-4o model
az cognitiveservices account deployment create \
    --name myopenai \
    --resource-group mygroup \
    --deployment-name gpt4o-deployment \
    --model-name gpt-4o \
    --model-version "2024-05-13" \
    --model-format OpenAI \
    --sku-capacity 10 \
    --sku-name Standard
```

### Bicep/ARM Template

```bicep
resource openaiAccount 'Microsoft.CognitiveServices/accounts@2023-10-01-preview' = {
  name: 'myopenai'
  location: 'eastus'
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: 'myopenai'
  }
}

resource gpt4oDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-10-01-preview' = {
  parent: openaiAccount
  name: 'gpt4o'
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o'
      version: '2024-05-13'
    }
  }
  sku: {
    name: 'Standard'
    capacity: 10
  }
}
```

## Regional Availability

As of May 2024, GPT-4o is available in:

| Region | Status |
|--------|--------|
| East US | GA |
| East US 2 | GA |
| West US | GA |
| West US 3 | GA |
| North Central US | GA |
| South Central US | GA |
| West Europe | GA |
| Sweden Central | GA |
| UK South | Preview |
| Australia East | Preview |

## Quota and Rate Limits

GPT-4o quotas are separate from GPT-4 Turbo:

```python
# Check current quota usage
from azure.identity import DefaultAzureCredential
from azure.mgmt.cognitiveservices import CognitiveServicesManagementClient

credential = DefaultAzureCredential()
client = CognitiveServicesManagementClient(credential, subscription_id)

# List deployments and their quotas
deployments = client.deployments.list(
    resource_group_name="mygroup",
    account_name="myopenai"
)

for deployment in deployments:
    print(f"Deployment: {deployment.name}")
    print(f"  Model: {deployment.properties.model.name}")
    print(f"  Capacity: {deployment.sku.capacity} TPM")
```

## Configuring the Client

```python
from openai import AzureOpenAI
import os

# Using API key authentication
client = AzureOpenAI(
    api_version="2024-05-01-preview",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    api_key=os.environ["AZURE_OPENAI_KEY"]
)

# Using Azure AD authentication (recommended)
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

credential = DefaultAzureCredential()
token_provider = get_bearer_token_provider(
    credential,
    "https://cognitiveservices.azure.com/.default"
)

client = AzureOpenAI(
    api_version="2024-05-01-preview",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    azure_ad_token_provider=token_provider
)
```

## Network Security Configuration

### Private Endpoint

```bicep
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-05-01' = {
  name: 'openai-pe'
  location: 'eastus'
  properties: {
    subnet: {
      id: subnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'openai-connection'
        properties: {
          privateLinkServiceId: openaiAccount.id
          groupIds: ['account']
        }
      }
    ]
  }
}

resource privateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.openai.azure.com'
  location: 'global'
}
```

### Managed Identity Access

```bicep
resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openaiAccount.id, functionApp.id, 'Cognitive Services OpenAI User')
  scope: openaiAccount
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd' // Cognitive Services OpenAI User
    )
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
```

## Content Filtering

Azure OpenAI includes content filtering by default:

```python
try:
    response = client.chat.completions.create(
        model="gpt4o",
        messages=[{"role": "user", "content": user_input}]
    )
except openai.BadRequestError as e:
    if "content_filter" in str(e):
        # Handle content filter trigger
        print("Content was filtered due to policy")
```

Configure custom content filtering:

```bash
# Create content filter configuration
az cognitiveservices account deployment create \
    --name myopenai \
    --resource-group mygroup \
    --deployment-name gpt4o-filtered \
    --model-name gpt-4o \
    --model-version "2024-05-13" \
    --model-format OpenAI \
    --sku-capacity 10 \
    --sku-name Standard \
    --content-filter-policy-name "custom-filter"
```

## Monitoring and Diagnostics

Enable diagnostic settings:

```bicep
resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'openai-diagnostics'
  scope: openaiAccount
  properties: {
    workspaceId: logAnalyticsWorkspace.id
    logs: [
      {
        category: 'Audit'
        enabled: true
      }
      {
        category: 'RequestResponse'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}
```

Query usage metrics:

```kusto
// Azure Monitor query for GPT-4o usage
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.COGNITIVESERVICES"
| where Category == "RequestResponse"
| where model_s == "gpt-4o"
| summarize
    TotalRequests = count(),
    TotalTokens = sum(toint(total_tokens_s)),
    AvgLatency = avg(DurationMs)
    by bin(TimeGenerated, 1h)
| order by TimeGenerated desc
```

## Cost Management

Set up budgets and alerts:

```bicep
resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: 'openai-budget'
  properties: {
    category: 'Cost'
    amount: 1000
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: '2024-05-01'
    }
    filter: {
      dimensions: {
        name: 'ResourceId'
        values: [openaiAccount.id]
      }
    }
    notifications: {
      forecastAlert: {
        enabled: true
        threshold: 80
        operator: 'GreaterThan'
        contactEmails: ['admin@company.com']
      }
    }
  }
}
```

## Best Practices

1. **Use Azure AD authentication** - More secure than API keys
2. **Enable private endpoints** - Keep traffic on Azure backbone
3. **Set up diagnostic logging** - Monitor usage and costs
4. **Configure content filters** - Meet compliance requirements
5. **Use managed identities** - Avoid credential management

## What's Next

Tomorrow I'll cover cost reduction strategies when using GPT-4o.

## Resources

- [Azure OpenAI Service Documentation](https://learn.microsoft.com/azure/ai-services/openai/)
- [Quotas and Limits](https://learn.microsoft.com/azure/ai-services/openai/quotas-limits)
- [Content Filtering](https://learn.microsoft.com/azure/ai-services/openai/concepts/content-filter)
