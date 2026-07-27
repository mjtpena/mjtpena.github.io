---
title: Azure Pipelines Templates for Reusable CI/CD
author: Michael John Peña
draft: false
date: 2021-06-07
url: /blog/azure-pipelines-templates/
tags:
  - Azure DevOps
  - CI/CD
  - Templates
  - DevOps

---

I wrote "2021-06-07-azure-pipelines-templates" to share practical, production-minded guidance on this topic.

## Template Types

Azure Pipelines supports four template types:

1. **Stage templates** - Reusable stages
2. **Job templates** - Reusable jobs
3. **Step templates** - Reusable steps
4. **Variable templates** - Reusable variables

## Step Templates

### Basic Step Template

```yaml
# templates/steps/dotnet-restore-build.yml
parameters:
  - name: buildConfiguration
    type: string
    default: 'Release'
  - name: dotnetVersion
    type: string
    default: '6.0.x'

steps:
  - task: UseDotNet@2
    displayName: 'Setup .NET SDK'
    inputs:
      version: ${{ parameters.dotnetVersion }}
      includePreviewVersions: true

  - task: DotNetCoreCLI@2
    displayName: 'Restore packages'
    inputs:
      command: 'restore'
      projects: '**/*.csproj'
      feedsToUse: 'config'
      nugetConfigPath: 'nuget.config'

  - task: DotNetCoreCLI@2
    displayName: 'Build solution'
    inputs:
      command: 'build'
      projects: '**/*.csproj'
      arguments: '--configuration ${{ parameters.buildConfiguration }} --no-restore'
```

### Step Template with Conditional Logic

```yaml
# templates/steps/docker-build-push.yml
parameters:
  - name: imageName
    type: string
  - name: dockerFile
    type: string
    default: 'Dockerfile'
  - name: pushImage
    type: boolean
    default: true
  - name: registry
    type: string
    default: 'myregistry.azurecr.io'

steps:
  - task: Docker@2
    displayName: 'Build Docker image'
    inputs:
      command: 'build'
      dockerfile: ${{ parameters.dockerFile }}
      repository: ${{ parameters.registry }}/${{ parameters.imageName }}
      tags: |
        $(Build.BuildId)
        latest

  - ${{ if eq(parameters.pushImage, true) }}:
    - task: Docker@2
      displayName: 'Push Docker image'
      inputs:
        command: 'push'
        repository: ${{ parameters.registry }}/${{ parameters.imageName }}
        tags: |
          $(Build.BuildId)
          latest
```

## Job Templates

### Deployment Job Template

```yaml
# templates/jobs/deploy-app-service.yml
parameters:
  - name: environmentName
    type: string
  - name: azureSubscription
    type: string
  - name: appServiceName
    type: string
  - name: resourceGroup
    type: string
  - name: slotName
    type: string
    default: 'staging'
  - name: useSlot
    type: boolean
    default: true

jobs:
  - deployment: Deploy_${{ parameters.environmentName }}
    displayName: 'Deploy to ${{ parameters.environmentName }}'
    environment: ${{ parameters.environmentName }}
    pool:
      vmImage: 'ubuntu-latest'
    strategy:
      runOnce:
        deploy:
          steps:
            - download: current
              artifact: drop

            - ${{ if eq(parameters.useSlot, true) }}:
              - task: AzureWebApp@1
                displayName: 'Deploy to staging slot'
                inputs:
                  azureSubscription: ${{ parameters.azureSubscription }}
                  appType: 'webApp'
                  appName: ${{ parameters.appServiceName }}
                  deployToSlotOrASE: true
                  resourceGroupName: ${{ parameters.resourceGroup }}
                  slotName: ${{ parameters.slotName }}
                  package: '$(Pipeline.Workspace)/drop/*.zip'

              - task: AzureAppServiceManage@0
                displayName: 'Swap staging to production'
                inputs:
                  azureSubscription: ${{ parameters.azureSubscription }}
                  Action: 'Swap Slots'
                  WebAppName: ${{ parameters.appServiceName }}
                  ResourceGroupName: ${{ parameters.resourceGroup }}
                  SourceSlot: ${{ parameters.slotName }}

            - ${{ if eq(parameters.useSlot, false) }}:
              - task: AzureWebApp@1
                displayName: 'Deploy directly to production'
                inputs:
                  azureSubscription: ${{ parameters.azureSubscription }}
                  appType: 'webApp'
                  appName: ${{ parameters.appServiceName }}
                  package: '$(Pipeline.Workspace)/drop/*.zip'
```

### Test Job Template with Matrix

```yaml
# templates/jobs/run-tests.yml
parameters:
  - name: testProjects
    type: string
    default: '**/*Tests.csproj'
  - name: platforms
    type: object
    default:
      - os: 'ubuntu-latest'
        name: 'Linux'
      - os: 'windows-latest'
        name: 'Windows'

jobs:
  - ${{ each platform in parameters.platforms }}:
    - job: Test_${{ platform.name }}
      displayName: 'Run tests on ${{ platform.name }}'
      pool:
        vmImage: ${{ platform.os }}
      steps:
        - task: UseDotNet@2
          inputs:
            version: '6.0.x'

        - task: DotNetCoreCLI@2
          displayName: 'Run tests'
          inputs:
            command: 'test'
            projects: ${{ parameters.testProjects }}
            arguments: '--configuration Release --collect:"XPlat Code Coverage"'

        - task: PublishCodeCoverageResults@1
          inputs:
            codeCoverageTool: 'Cobertura'
            summaryFileLocation: '$(Agent.TempDirectory)/**/coverage.cobertura.xml'
```

## Stage Templates

### Complete CI Stage Template

```yaml
# templates/stages/ci-stage.yml
parameters:
  - name: buildConfiguration
    type: string
    default: 'Release'
  - name: runTests
    type: boolean
    default: true
  - name: runCodeAnalysis
    type: boolean
    default: true
  - name: publishArtifact
    type: boolean
    default: true

stages:
  - stage: CI
    displayName: 'Continuous Integration'
    jobs:
      - job: Build
        pool:
          vmImage: 'ubuntu-latest'
        steps:
          - template: ../steps/dotnet-restore-build.yml
            parameters:
              buildConfiguration: ${{ parameters.buildConfiguration }}

          - ${{ if eq(parameters.runTests, true) }}:
            - task: DotNetCoreCLI@2
              displayName: 'Run unit tests'
              inputs:
                command: 'test'
                projects: '**/*Tests.csproj'
                arguments: '--configuration ${{ parameters.buildConfiguration }} --no-build'

          - ${{ if eq(parameters.runCodeAnalysis, true) }}:
            - task: SonarCloudPrepare@1
              inputs:
                SonarCloud: 'SonarCloud'
                organization: 'myorg'
                scannerMode: 'MSBuild'
                projectKey: 'myproject'

            - task: SonarCloudAnalyze@1
            - task: SonarCloudPublish@1

          - ${{ if eq(parameters.publishArtifact, true) }}:
            - task: DotNetCoreCLI@2
              displayName: 'Publish application'
              inputs:
                command: 'publish'
                publishWebProjects: true
                arguments: '--configuration ${{ parameters.buildConfiguration }} --output $(Build.ArtifactStagingDirectory)'
                zipAfterPublish: true

            - publish: $(Build.ArtifactStagingDirectory)
              artifact: drop
```

### CD Stage Template

```yaml
# templates/stages/cd-stage.yml
parameters:
  - name: environmentName
    type: string
  - name: azureSubscription
    type: string
  - name: appServiceName
    type: string
  - name: resourceGroup
    type: string
  - name: dependsOn
    type: object
    default: []
  - name: condition
    type: string
    default: 'succeeded()'

stages:
  - stage: Deploy_${{ parameters.environmentName }}
    displayName: 'Deploy to ${{ parameters.environmentName }}'
    dependsOn: ${{ parameters.dependsOn }}
    condition: ${{ parameters.condition }}
    jobs:
      - template: ../jobs/deploy-app-service.yml
        parameters:
          environmentName: ${{ parameters.environmentName }}
          azureSubscription: ${{ parameters.azureSubscription }}
          appServiceName: ${{ parameters.appServiceName }}
          resourceGroup: ${{ parameters.resourceGroup }}
```

## Variable Templates

### Environment-Specific Variables

```yaml
# templates/variables/dev.yml
variables:
  environmentName: 'development'
  appServiceName: 'myapp-dev'
  resourceGroup: 'rg-myapp-dev'
  azureSubscription: 'Azure-Dev-Connection'
  appInsightsKey: '$(DevAppInsightsKey)'

# templates/variables/prod.yml
variables:
  environmentName: 'production'
  appServiceName: 'myapp-prod'
  resourceGroup: 'rg-myapp-prod'
  azureSubscription: 'Azure-Prod-Connection'
  appInsightsKey: '$(ProdAppInsightsKey)'
```

## Composing Templates

### Main Pipeline Using All Templates

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - main
      - develop
      - feature/*

pr:
  branches:
    include:
      - main
      - develop

resources:
  repositories:
    - repository: templates
      type: git
      name: MyProject/pipeline-templates
      ref: refs/heads/main

variables:
  - template: templates/variables/common.yml

stages:
  # CI Stage
  - template: templates/stages/ci-stage.yml
    parameters:
      buildConfiguration: 'Release'
      runTests: true
      runCodeAnalysis: true

  # Deploy to Dev (on develop branch or main)
  - template: templates/stages/cd-stage.yml
    parameters:
      environmentName: 'development'
      azureSubscription: 'Azure-Dev'
      appServiceName: 'myapp-dev'
      resourceGroup: 'rg-dev'
      dependsOn: ['CI']
      condition: |
        and(
          succeeded(),
          or(
            eq(variables['Build.SourceBranch'], 'refs/heads/develop'),
            eq(variables['Build.SourceBranch'], 'refs/heads/main')
          )
        )

  # Deploy to Staging (main branch only)
  - template: templates/stages/cd-stage.yml
    parameters:
      environmentName: 'staging'
      azureSubscription: 'Azure-Staging'
      appServiceName: 'myapp-staging'
      resourceGroup: 'rg-staging'
      dependsOn: ['Deploy_development']
      condition: |
        and(
          succeeded(),
          eq(variables['Build.SourceBranch'], 'refs/heads/main')
        )

  # Deploy to Production (main branch with approval)
  - template: templates/stages/cd-stage.yml
    parameters:
      environmentName: 'production'
      azureSubscription: 'Azure-Prod'
      appServiceName: 'myapp-prod'
      resourceGroup: 'rg-prod'
      dependsOn: ['Deploy_staging']
      condition: |
        and(
          succeeded(),
          eq(variables['Build.SourceBranch'], 'refs/heads/main')
        )
```

## Template Expressions

### Iterating Over Objects

```yaml
# templates/steps/deploy-multiple-regions.yml
parameters:
  - name: regions
    type: object
    default:
      - name: 'AustraliaEast'
        appName: 'myapp-aue'
      - name: 'SoutheastAsia'
        appName: 'myapp-sea'
      - name: 'WestEurope'
        appName: 'myapp-weu'

steps:
  - ${{ each region in parameters.regions }}:
    - task: AzureWebApp@1
      displayName: 'Deploy to ${{ region.name }}'
      inputs:
        azureSubscription: 'Azure-Prod'
        appName: ${{ region.appName }}
        package: '$(Pipeline.Workspace)/drop/*.zip'
```

### Conditional Template Insertion

```yaml
# templates/jobs/build-job.yml
parameters:
  - name: includeSecurityScan
    type: boolean
    default: false
  - name: securityScanTool
    type: string
    default: 'WhiteSource'

jobs:
  - job: Build
    steps:
      - template: ../steps/dotnet-restore-build.yml

      - ${{ if eq(parameters.includeSecurityScan, true) }}:
        - ${{ if eq(parameters.securityScanTool, 'WhiteSource') }}:
          - task: WhiteSource@21
            inputs:
              projectName: '$(Build.Repository.Name)'

        - ${{ if eq(parameters.securityScanTool, 'Snyk') }}:
          - task: SnykSecurityScan@1
            inputs:
              serviceConnectionEndpoint: 'Snyk'
```

## Shared Template Repository

### Setting Up Template Repository

```yaml
# In consuming pipeline
resources:
  repositories:
    - repository: templates
      type: git
      name: SharedProject/pipeline-templates
      ref: refs/tags/v1.0.0  # Use tags for versioning

stages:
  - template: stages/ci.yml@templates
    parameters:
      buildConfiguration: 'Release'
```

### Template Repository Structure

```
pipeline-templates/
├── stages/
│   ├── ci.yml
│   ├── cd-webapp.yml
│   └── cd-function.yml
├── jobs/
│   ├── build-dotnet.yml
│   ├── build-node.yml
│   └── deploy-azure.yml
├── steps/
│   ├── dotnet-restore-build.yml
│   ├── docker-build-push.yml
│   └── azure-login.yml
├── variables/
│   ├── common.yml
│   ├── dev.yml
│   └── prod.yml
└── README.md
```

## Conclusion

Azure Pipelines templates are essential for maintaining DRY (Don't Repeat Yourself) principles in CI/CD. By investing time in well-designed templates, you create a foundation that accelerates future pipeline development and ensures consistency across your organization. Start with step templates for common tasks, progress to job and stage templates, and eventually establish a shared template repository.

## References

- [Azure Pipelines Template Reference](https://docs.microsoft.com/en-us/azure/devops/pipelines/process/templates)
- [Template Expressions](https://docs.microsoft.com/en-us/azure/devops/pipelines/process/expressions)

