---
title: Mastering Azure DevOps YAML Pipelines
author: Michael John Peña
draft: false
date: 2021-06-06
url: /blog/azure-devops-yaml-pipelines/
tags:
  - Azure DevOps
  - CI/CD
  - YAML
  - DevOps

---

I wrote "2021-06-06-azure-devops-yaml-pipelines" to share practical, production-minded guidance on this topic.

## Basic Pipeline Structure

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - main
      - develop
  paths:
    include:
      - src/*
    exclude:
      - docs/*

pool:
  vmImage: 'ubuntu-latest'

variables:
  buildConfiguration: 'Release'
  dotnetVersion: '6.0.x'

stages:
  - stage: Build
    jobs:
      - job: BuildJob
        steps:
          - task: UseDotNet@2
            inputs:
              version: '$(dotnetVersion)'
              includePreviewVersions: true

          - task: DotNetCoreCLI@2
            displayName: 'Restore'
            inputs:
              command: 'restore'
              projects: '**/*.csproj'

          - task: DotNetCoreCLI@2
            displayName: 'Build'
            inputs:
              command: 'build'
              arguments: '--configuration $(buildConfiguration)'

          - task: DotNetCoreCLI@2
            displayName: 'Test'
            inputs:
              command: 'test'
              arguments: '--configuration $(buildConfiguration) --collect:"XPlat Code Coverage"'

          - task: PublishCodeCoverageResults@1
            inputs:
              codeCoverageTool: 'Cobertura'
              summaryFileLocation: '$(Agent.TempDirectory)/**/coverage.cobertura.xml'
```

## Multi-Stage Pipelines

```yaml
trigger:
  - main

stages:
  - stage: Build
    displayName: 'Build Stage'
    jobs:
      - job: Build
        pool:
          vmImage: 'ubuntu-latest'
        steps:
          - task: DotNetCoreCLI@2
            inputs:
              command: 'publish'
              publishWebProjects: true
              arguments: '--configuration Release --output $(Build.ArtifactStagingDirectory)'

          - publish: $(Build.ArtifactStagingDirectory)
            artifact: drop

  - stage: DeployDev
    displayName: 'Deploy to Development'
    dependsOn: Build
    condition: succeeded()
    jobs:
      - deployment: DeployDev
        environment: 'development'
        pool:
          vmImage: 'ubuntu-latest'
        strategy:
          runOnce:
            deploy:
              steps:
                - download: current
                  artifact: drop

                - task: AzureWebApp@1
                  inputs:
                    azureSubscription: 'Azure-Dev'
                    appName: 'myapp-dev'
                    package: '$(Pipeline.Workspace)/drop/*.zip'

  - stage: DeployProd
    displayName: 'Deploy to Production'
    dependsOn: DeployDev
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    jobs:
      - deployment: DeployProd
        environment: 'production'
        pool:
          vmImage: 'ubuntu-latest'
        strategy:
          runOnce:
            deploy:
              steps:
                - download: current
                  artifact: drop

                - task: AzureWebApp@1
                  inputs:
                    azureSubscription: 'Azure-Prod'
                    appName: 'myapp-prod'
                    package: '$(Pipeline.Workspace)/drop/*.zip'
```

## Variable Groups and Templates

### Defining Variable Groups

```yaml
# Variables can be defined in Azure DevOps UI or via CLI
# az pipelines variable-group create --name "Production-Variables" --variables ConnectionString=xxx

variables:
  - group: Production-Variables
  - name: localVariable
    value: 'local-value'
```

### Variable Templates

```yaml
# templates/variables-dev.yml
variables:
  environment: 'development'
  appServiceName: 'myapp-dev'
  resourceGroup: 'rg-dev'

# templates/variables-prod.yml
variables:
  environment: 'production'
  appServiceName: 'myapp-prod'
  resourceGroup: 'rg-prod'

# Main pipeline
stages:
  - stage: DeployDev
    variables:
      - template: templates/variables-dev.yml
    jobs:
      - job: Deploy
        steps:
          - script: echo "Deploying to $(environment)"
```

## Job and Step Templates

### Step Template

```yaml
# templates/dotnet-build-steps.yml
parameters:
  - name: buildConfiguration
    type: string
    default: 'Release'
  - name: projects
    type: string
    default: '**/*.csproj'

steps:
  - task: UseDotNet@2
    inputs:
      version: '6.0.x'

  - task: DotNetCoreCLI@2
    displayName: 'Restore'
    inputs:
      command: 'restore'
      projects: '${{ parameters.projects }}'

  - task: DotNetCoreCLI@2
    displayName: 'Build'
    inputs:
      command: 'build'
      projects: '${{ parameters.projects }}'
      arguments: '--configuration ${{ parameters.buildConfiguration }}'

  - task: DotNetCoreCLI@2
    displayName: 'Test'
    inputs:
      command: 'test'
      projects: '**/*Tests.csproj'
      arguments: '--configuration ${{ parameters.buildConfiguration }}'
```

### Job Template

```yaml
# templates/deploy-webapp-job.yml
parameters:
  - name: environment
    type: string
  - name: azureSubscription
    type: string
  - name: appName
    type: string

jobs:
  - deployment: Deploy${{ parameters.environment }}
    displayName: 'Deploy to ${{ parameters.environment }}'
    environment: ${{ parameters.environment }}
    pool:
      vmImage: 'ubuntu-latest'
    strategy:
      runOnce:
        deploy:
          steps:
            - download: current
              artifact: drop

            - task: AzureWebApp@1
              inputs:
                azureSubscription: ${{ parameters.azureSubscription }}
                appName: ${{ parameters.appName }}
                package: '$(Pipeline.Workspace)/drop/*.zip'
```

### Using Templates

```yaml
# azure-pipelines.yml
trigger:
  - main

stages:
  - stage: Build
    jobs:
      - job: Build
        pool:
          vmImage: 'ubuntu-latest'
        steps:
          - template: templates/dotnet-build-steps.yml
            parameters:
              buildConfiguration: 'Release'
              projects: 'src/**/*.csproj'

          - task: DotNetCoreCLI@2
            displayName: 'Publish'
            inputs:
              command: 'publish'
              arguments: '--configuration Release --output $(Build.ArtifactStagingDirectory)'

          - publish: $(Build.ArtifactStagingDirectory)
            artifact: drop

  - stage: DeployDev
    dependsOn: Build
    jobs:
      - template: templates/deploy-webapp-job.yml
        parameters:
          environment: 'development'
          azureSubscription: 'Azure-Dev'
          appName: 'myapp-dev'

  - stage: DeployProd
    dependsOn: DeployDev
    condition: eq(variables['Build.SourceBranch'], 'refs/heads/main')
    jobs:
      - template: templates/deploy-webapp-job.yml
        parameters:
          environment: 'production'
          azureSubscription: 'Azure-Prod'
          appName: 'myapp-prod'
```

## Conditional Execution

```yaml
stages:
  - stage: Build
    jobs:
      - job: Build
        steps:
          # Always run
          - script: echo "Building..."

          # Run only on main branch
          - script: echo "Main branch build"
            condition: eq(variables['Build.SourceBranch'], 'refs/heads/main')

          # Run on PR builds
          - script: echo "PR build"
            condition: eq(variables['Build.Reason'], 'PullRequest')

          # Run if previous step succeeded
          - script: echo "Previous step succeeded"
            condition: succeeded()

          # Run even if previous steps failed
          - script: echo "Cleanup"
            condition: always()

          # Complex conditions
          - script: echo "Production release"
            condition: |
              and(
                succeeded(),
                eq(variables['Build.SourceBranch'], 'refs/heads/main'),
                ne(variables['Build.Reason'], 'PullRequest')
              )
```

## Matrix Builds

```yaml
jobs:
  - job: Build
    strategy:
      matrix:
        Linux:
          vmImage: 'ubuntu-latest'
          os: 'linux'
        Windows:
          vmImage: 'windows-latest'
          os: 'windows'
        macOS:
          vmImage: 'macOS-latest'
          os: 'macos'
    pool:
      vmImage: $(vmImage)
    steps:
      - script: echo "Building on $(os)"
      - task: DotNetCoreCLI@2
        inputs:
          command: 'build'
```

## Parallel Jobs

```yaml
jobs:
  - job: UnitTests
    pool:
      vmImage: 'ubuntu-latest'
    steps:
      - script: dotnet test UnitTests/

  - job: IntegrationTests
    pool:
      vmImage: 'ubuntu-latest'
    steps:
      - script: dotnet test IntegrationTests/

  - job: SecurityScan
    pool:
      vmImage: 'ubuntu-latest'
    steps:
      - task: WhiteSource@21
        inputs:
          projectName: 'MyProject'

  - job: PublishArtifact
    dependsOn:
      - UnitTests
      - IntegrationTests
      - SecurityScan
    condition: succeeded('UnitTests', 'IntegrationTests', 'SecurityScan')
    steps:
      - script: echo "All checks passed, publishing..."
```

## Secure Files and Variables

```yaml
jobs:
  - job: Deploy
    steps:
      # Download secure file
      - task: DownloadSecureFile@1
        name: certificate
        inputs:
          secureFile: 'production-cert.pfx'

      # Use secure file
      - script: |
          certutil -f -p $(certPassword) -importpfx $(certificate.secureFilePath)
        displayName: 'Install certificate'

      # Use secret variable
      - task: AzureCLI@2
        inputs:
          azureSubscription: 'Azure-Prod'
          scriptType: 'bash'
          scriptLocation: 'inlineScript'
          inlineScript: |
            az webapp config appsettings set \
              --name myapp \
              --resource-group myrg \
              --settings "ConnectionString=$(connectionString)"
```

## Approvals and Checks

Configure in Azure DevOps UI or via YAML:

```yaml
stages:
  - stage: DeployProd
    jobs:
      - deployment: Production
        environment: 'production'  # Configure approvals on this environment
        strategy:
          runOnce:
            deploy:
              steps:
                - script: echo "Deploying to production"
```

## Caching Dependencies

```yaml
variables:
  NUGET_PACKAGES: $(Pipeline.Workspace)/.nuget/packages

steps:
  - task: Cache@2
    displayName: 'Cache NuGet packages'
    inputs:
      key: 'nuget | "$(Agent.OS)" | **/packages.lock.json'
      restoreKeys: |
        nuget | "$(Agent.OS)"
      path: $(NUGET_PACKAGES)

  - task: DotNetCoreCLI@2
    inputs:
      command: 'restore'
      projects: '**/*.csproj'
```

## Conclusion

Azure DevOps YAML pipelines provide powerful, version-controlled CI/CD capabilities. By leveraging templates, variable groups, and conditional execution, you can build maintainable pipelines that scale across multiple projects and environments. The key is to start simple and progressively add complexity as your needs evolve.

## References

- [Azure Pipelines YAML Schema](https://docs.microsoft.com/en-us/azure/devops/pipelines/yaml-schema)
- [Pipeline Templates](https://docs.microsoft.com/en-us/azure/devops/pipelines/process/templates)

