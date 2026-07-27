---
title: "Azure Pipelines Improvements"
author: "Michael John Peña"
draft: false
date: 2022-10-21
tags: ["Azure", "Azure DevOps", "Pipelines", "CI/CD"]

---

I wrote "Azure Pipelines Improvements" to share practical, production-minded guidance on this topic.

## Advanced Pipeline Features

```yaml
# Template for reusable steps
# templates/build-steps.yml
parameters:
  - name: buildConfiguration
    default: 'Release'
  - name: dotnetVersion
    default: '7.0.x'

steps:
  - task: UseDotNet@2
    inputs:
      version: ${{ parameters.dotnetVersion }}

  - task: DotNetCoreCLI@2
    displayName: 'Restore'
    inputs:
      command: restore

  - task: DotNetCoreCLI@2
    displayName: 'Build'
    inputs:
      command: build
      arguments: '--configuration ${{ parameters.buildConfiguration }}'
```

```yaml
# Main pipeline using templates
trigger: [main]

stages:
  - stage: Build
    jobs:
      - job: BuildJob
        pool:
          vmImage: 'ubuntu-latest'
        steps:
          - template: templates/build-steps.yml
            parameters:
              buildConfiguration: 'Release'

  - stage: Deploy
    dependsOn: Build
    jobs:
      - deployment: DeployWeb
        environment: 'production'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: AzureWebApp@1
                  inputs:
                    azureSubscription: 'AzureConnection'
                    appName: 'mywebapp'
```

Azure Pipelines templates and stages enable maintainable, scalable CI/CD implementations.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
