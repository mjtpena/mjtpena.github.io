---
title: "Azure DevOps Environments and Deployments"
author: "Michael John Peña"
draft: false
date: 2022-10-22
tags: ["Azure", "Azure DevOps", "Environments", "Deployment"]

---

I wrote "Azure DevOps Environments and Deployments" to share practical, production-minded guidance on this topic.

## Configuring Environments

```yaml
# Pipeline with environment deployments
trigger: [main]

stages:
  - stage: DeployDev
    jobs:
      - deployment: DeployToDev
        environment: 'development'
        strategy:
          runOnce:
            deploy:
              steps:
                - script: echo "Deploying to dev"

  - stage: DeployStaging
    dependsOn: DeployDev
    jobs:
      - deployment: DeployToStaging
        environment: 'staging'
        strategy:
          runOnce:
            deploy:
              steps:
                - script: echo "Deploying to staging"

  - stage: DeployProd
    dependsOn: DeployStaging
    jobs:
      - deployment: DeployToProduction
        environment: 'production'
        strategy:
          canary:
            increments: [10, 50, 100]
            deploy:
              steps:
                - script: echo "Deploying ${{ strategy.name }}"
            on:
              failure:
                steps:
                  - script: echo "Rolling back"
```

## Environment Configuration

- Approvals and checks
- Deployment history tracking
- Resource targeting (Kubernetes, VMs)
- Exclusive locks
- Business hours restrictions

Environments provide governance and visibility for deployments across your infrastructure.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
