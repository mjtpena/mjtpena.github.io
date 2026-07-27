---
title: "Azure DevOps Pipeline Templates: Reusable CI/CD"
author: Michael John Peña
draft: false
date: 2020-10-21
tags:
  - Azure DevOps
  - CI/CD
  - DevOps
  - Pipelines

---

I wrote "Azure DevOps Pipeline Templates: Reusable CI/CD" to share practical, production-minded guidance on this topic.

## Template Types

- **Stage templates**: Reusable stages
- **Job templates**: Reusable jobs
- **Step templates**: Reusable steps
- **Variable templates**: Shared variables

## Step Template

```yaml
# templates/build-dotnet.yml
parameters:
  - name: projectPath
    type: string
  - name: buildConfiguration
    type: string
    default: 'Release'

steps:
  - task: DotNetCoreCLI@2
    displayName: 'Restore packages'
    inputs:
      command: 'restore'
      projects: '${{ parameters.projectPath }}'

  - task: DotNetCoreCLI@2
    displayName: 'Build'
    inputs:
      command: 'build'
      projects: '${{ parameters.projectPath }}'
      arguments: '--configuration ${{ parameters.buildConfiguration }} --no-restore'

  - task: DotNetCoreCLI@2
    displayName: 'Test'
    inputs:
      command: 'test'
      projects: '${{ parameters.projectPath }}'
      arguments: '--configuration ${{ parameters.buildConfiguration }} --no-build'
```

## Using Step Template

```yaml
# azure-pipelines.yml
trigger:
  - main

pool:
  vmImage: 'ubuntu-latest'

steps:
  - template: templates/build-dotnet.yml
    parameters:
      projectPath: 'src/MyApp/MyApp.csproj'
      buildConfiguration: 'Release'
```

## Job Template

```yaml
# templates/deploy-webapp.yml
parameters:
  - name: environment
    type: string
  - name: azureSubscription
    type: string
  - name: appName
    type: string

jobs:
  - deployment: Deploy
    displayName: 'Deploy to ${{ parameters.environment }}'
    environment: ${{ parameters.environment }}
    strategy:
      runOnce:
        deploy:
          steps:
            - download: current
              artifact: drop

            - task: AzureWebApp@1
              displayName: 'Deploy to Azure Web App'
              inputs:
                azureSubscription: '${{ parameters.azureSubscription }}'
                appType: 'webApp'
                appName: '${{ parameters.appName }}'
                package: '$(Pipeline.Workspace)/drop/**/*.zip'
```

## Stage Template

```yaml
# templates/stage-deploy.yml
parameters:
  - name: stageName
    type: string
  - name: environment
    type: string
  - name: dependsOn
    type: object
    default: []

stages:
  - stage: ${{ parameters.stageName }}
    displayName: 'Deploy to ${{ parameters.environment }}'
    dependsOn: ${{ parameters.dependsOn }}
    jobs:
      - template: deploy-webapp.yml
        parameters:
          environment: ${{ parameters.environment }}
          azureSubscription: 'MyAzureConnection'
          appName: 'myapp-${{ parameters.environment }}'
```

## Complete Pipeline with Templates

```yaml
# azure-pipelines.yml
trigger:
  - main

variables:
  - template: templates/variables.yml

stages:
  - stage: Build
    jobs:
      - job: BuildJob
        pool:
          vmImage: 'ubuntu-latest'
        steps:
          - template: templates/build-dotnet.yml
            parameters:
              projectPath: '**/*.csproj'

          - task: PublishBuildArtifacts@1
            inputs:
              pathtoPublish: '$(Build.ArtifactStagingDirectory)'
              artifactName: 'drop'

  - template: templates/stage-deploy.yml
    parameters:
      stageName: DeployDev
      environment: 'development'
      dependsOn: ['Build']

  - template: templates/stage-deploy.yml
    parameters:
      stageName: DeployStaging
      environment: 'staging'
      dependsOn: ['DeployDev']

  - template: templates/stage-deploy.yml
    parameters:
      stageName: DeployProd
      environment: 'production'
      dependsOn: ['DeployStaging']
```

## Variable Templates

```yaml
# templates/variables.yml
variables:
  buildConfiguration: 'Release'
  dotnetVersion: '6.0.x'
  azureSubscription: 'MyAzureServiceConnection'
```

## Extending Templates

```yaml
# Base template with required structure
# templates/base-pipeline.yml
parameters:
  - name: customSteps
    type: stepList
    default: []

stages:
  - stage: Build
    jobs:
      - job: Build
        steps:
          - checkout: self
          - ${{ parameters.customSteps }}
          - task: PublishBuildArtifacts@1
```

Templates transform pipeline chaos into maintainable, standardized CI/CD.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
