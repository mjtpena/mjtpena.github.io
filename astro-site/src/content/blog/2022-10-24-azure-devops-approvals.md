---
title: "Approvals and Checks in Azure DevOps"
description: "Approvals and checks ensure deployments meet organizational requirements."
author: "Michael John Peña"
draft: false
date: 2022-10-24
tags: ["Azure", "Azure DevOps", "Approvals", "Governance"]
---

## Approval Workflows

```yaml
# Environment with approval requirements
# Configure in Azure DevOps UI: Environments > production > Approvals and checks

stages:
  - stage: Production
    jobs:
      - deployment: Deploy
        environment: 'production'  # Requires approval
        strategy:
          runOnce:
            deploy:
              steps:
                - task: AzureWebApp@1
                  inputs:
                    azureSubscription: 'AzureConnection'
                    appName: 'myproductionapp'
```

## Check Types

```yaml
# Checks available for environments:
checks:
  - type: Approvals
    config:
      approvers: ['team-lead@company.com', 'DevOps Team']
      timeout: 72 hours
      instructions: 'Review deployment artifacts'

  - type: Business Hours
    config:
      timezone: 'Pacific Standard Time'
      days: [Monday, Tuesday, Wednesday, Thursday, Friday]
      startTime: '09:00'
      endTime: '17:00'

  - type: Exclusive Lock
    config:
      timeout: 60 minutes

  - type: Branch Control
    config:
      allowedBranches: ['refs/heads/main', 'refs/heads/release/*']

  - type: Required Template
    config:
      templates: ['security-scan.yml', 'compliance-check.yml']
```

Approvals and checks ensure deployments meet organizational requirements.
