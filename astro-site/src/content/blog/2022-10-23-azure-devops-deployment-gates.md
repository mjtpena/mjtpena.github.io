---
title: "Deployment Gates in Azure DevOps"
author: "Michael John Peña"
draft: false
date: 2022-10-23
tags: ["Azure", "Azure DevOps", "Deployment", "Gates"]

---

I wrote "Deployment Gates in Azure DevOps" to share practical, production-minded guidance on this topic.

## Gate Types

```yaml
# Pipeline with deployment gates
stages:
  - stage: Deploy
    jobs:
      - deployment: DeployToProduction
        environment: 'production'
        strategy:
          runOnce:
            preDeploy:
              steps:
                - script: echo "Pre-deployment checks"
            deploy:
              steps:
                - task: AzureWebApp@1
                  inputs:
                    azureSubscription: 'Connection'
                    appName: 'myapp'
            routeTraffic:
              steps:
                - script: echo "Routing traffic"
            postRouteTraffic:
              steps:
                - script: echo "Post-routing validation"
            on:
              failure:
                steps:
                  - script: echo "Deployment failed"
              success:
                steps:
                  - script: echo "Deployment successful"
```

## Common Gates

- Azure Monitor alerts check
- Work item query validation
- REST API invocation
- Azure Policy compliance
- Security scan validation

Gates automate quality assurance in your deployment pipelines.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
