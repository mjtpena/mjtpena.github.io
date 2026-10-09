---
title: "Advanced Checks in Azure DevOps Pipelines"
description: "Checks provide automated validation gates for enterprise deployments."
author: "Michael John Peña"
draft: false
date: 2022-10-25
tags: ["Azure", "Azure DevOps", "Pipelines", "Security"]
---

## Custom API Checks

```yaml
# REST API check configuration
# Environments > Settings > Checks > Add > Invoke REST API

check_config:
  name: 'External Validation'
  endpoint: 'https://api.validation-service.com/check'
  method: POST
  headers:
    Authorization: 'Bearer $(ValidationToken)'
    Content-Type: 'application/json'
  body: |
    {
      "buildId": "$(Build.BuildId)",
      "environment": "production",
      "artifacts": "$(System.ArtifactsDirectory)"
    }
  successCriteria: 'eq(root[''status''], ''approved'')'
  timeout: 30
  retryInterval: 5
```

## Azure Monitor Check

```yaml
# Query Azure Monitor for health
check_config:
  name: 'Application Health'
  type: 'Azure Monitor'
  subscription: 'production-subscription'
  resourceGroup: 'app-resources'
  resourceType: 'Microsoft.Insights/components'
  metricAlerts:
    - name: 'High Error Rate'
      condition: 'errorRate < 1%'
    - name: 'Response Time'
      condition: 'avgResponseTime < 500ms'
```

## Policy Compliance Check

```yaml
# Ensure Azure Policy compliance
check_config:
  name: 'Azure Policy'
  type: 'Azure Policy Compliance'
  subscription: 'production-subscription'
  scope: '/subscriptions/xxx/resourceGroups/app-rg'
  requiredPolicies:
    - 'Require HTTPS'
    - 'Allowed locations'
    - 'Require tags'
```

Checks provide automated validation gates for enterprise deployments.
