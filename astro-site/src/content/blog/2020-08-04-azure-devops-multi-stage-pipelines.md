---
title: "Building Multi-Stage YAML Pipelines in Azure DevOps"
description: "Classic CI/CD pipelines as a clickable thing in a UI: I keep migrating clients off them. Half the time the original person who built the pipeline has left…"
author: Michael John Peña
draft: false
date: 2020-08-04
tags:
  - Azure DevOps
  - CI/CD
  - DevOps
  - YAML
---

Classic CI/CD pipelines as a clickable thing in a UI: I keep migrating clients off them. Half the time the original person who built the pipeline has left, the build "just works," and nobody knows how. YAML pipelines with their entire definition committed alongside the code solve that, and Azure DevOps multi-stage YAML has matured to the point where I'd recommend it over the Classic editor for any new pipeline. This is the skeleton I start with.

## Why YAML Pipelines?

- **Version controlled** - Pipeline definition lives with your code
- **Reviewable** - Changes go through pull requests
- **Reusable** - Create templates for common patterns
- **Portable** - Easy to copy between projects

## Basic Structure

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - main
      - develop

pool:
  vmImage: 'ubuntu-latest'

variables:
  buildConfiguration: 'Release'
  dotnetVersion: '3.1.x'

stages:
  - stage: Build
    displayName: 'Build and Test'
    jobs:
      - job: BuildJob
        steps:
          - task: UseDotNet@2
            displayName: 'Use .NET Core SDK'
            inputs:
              version: $(dotnetVersion)

          - task: DotNetCoreCLI@2
            displayName: 'Restore packages'
            inputs:
              command: 'restore'
              projects: '**/*.csproj'

          - task: DotNetCoreCLI@2
            displayName: 'Build solution'
            inputs:
              command: 'build'
              projects: '**/*.csproj'
              arguments: '--configuration $(buildConfiguration)'

          - task: DotNetCoreCLI@2
            displayName: 'Run tests'
            inputs:
              command: 'test'
              projects: '**/*Tests.csproj'
              arguments: '--configuration $(buildConfiguration) --collect:"XPlat Code Coverage"'

          - task: PublishBuildArtifacts@1
            displayName: 'Publish artifacts'
            inputs:
              PathtoPublish: '$(Build.ArtifactStagingDirectory)'
              ArtifactName: 'drop'
```

## Adding Deployment Stages

```yaml
stages:
  - stage: Build
    # ... build jobs from above

  - stage: DeployDev
    displayName: 'Deploy to Development'
    dependsOn: Build
    condition: succeeded()
    jobs:
      - deployment: DeployWebApp
        displayName: 'Deploy Web App'
        environment: 'Development'
        strategy:
          runOnce:
            deploy:
              steps:
                - download: current
                  artifact: drop

                - task: AzureWebApp@1
                  displayName: 'Deploy to Azure Web App'
                  inputs:
                    azureSubscription: 'Azure-Service-Connection'
                    appType: 'webApp'
                    appName: 'myapp-dev'
                    package: '$(Pipeline.Workspace)/drop/**/*.zip'

  - stage: DeployProd
    displayName: 'Deploy to Production'
    dependsOn: DeployDev
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    jobs:
      - deployment: DeployWebApp
        displayName: 'Deploy Web App'
        environment: 'Production'
        strategy:
          runOnce:
            deploy:
              steps:
                - download: current
                  artifact: drop

                - task: AzureWebApp@1
                  displayName: 'Deploy to Azure Web App'
                  inputs:
                    azureSubscription: 'Azure-Service-Connection'
                    appType: 'webApp'
                    appName: 'myapp-prod'
                    package: '$(Pipeline.Workspace)/drop/**/*.zip'
```

## Using Templates

Create reusable templates for common tasks:

```yaml
# templates/dotnet-build.yml
parameters:
  - name: buildConfiguration
    default: 'Release'
  - name: projects
    default: '**/*.csproj'

steps:
  - task: DotNetCoreCLI@2
    displayName: 'Restore packages'
    inputs:
      command: 'restore'
      projects: ${{ parameters.projects }}

  - task: DotNetCoreCLI@2
    displayName: 'Build'
    inputs:
      command: 'build'
      projects: ${{ parameters.projects }}
      arguments: '--configuration ${{ parameters.buildConfiguration }}'
```

Use the template:

```yaml
stages:
  - stage: Build
    jobs:
      - job: BuildJob
        steps:
          - template: templates/dotnet-build.yml
            parameters:
              buildConfiguration: 'Release'
```

## Environment Approvals

Configure approvals in Azure DevOps:

1. Go to Pipelines > Environments
2. Select your environment (e.g., Production)
3. Click the three dots > Approvals and checks
4. Add approvers

## Variable Groups

Store sensitive configuration securely:

```yaml
variables:
  - group: 'Production-Secrets'
  - name: buildConfiguration
    value: 'Release'
```

## Conditional Execution

```yaml
- stage: DeployProd
  condition: |
    and(
      succeeded(),
      eq(variables['Build.SourceBranch'], 'refs/heads/main'),
      ne(variables['Build.Reason'], 'PullRequest')
    )
```

## Running Jobs in Parallel

```yaml
- stage: Test
  jobs:
    - job: UnitTests
      steps:
        - script: dotnet test --filter Category=Unit

    - job: IntegrationTests
      steps:
        - script: dotnet test --filter Category=Integration

    - job: E2ETests
      dependsOn: []  # Run in parallel
      steps:
        - script: npm run e2e
```

Multi-stage YAML pipelines are not the most exciting thing I work on, but they're the thing that makes everything else possible. Worth the investment to get right early, because you only build the deployment pipeline once if you do it well — and three times if you don't.
