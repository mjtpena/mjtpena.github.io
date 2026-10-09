---
title: "Azure DevOps vs GitHub Actions: Choosing the Right CI/CD Platform"
author: Michael John Peña
draft: false
date: 2022-11-27
tags:
  - Azure DevOps
  - GitHub Actions
  - CI/CD
  - DevOps
  - Automation
---

## Quick Comparison

| Feature | Azure DevOps | GitHub Actions |
|---------|-------------|----------------|
| YAML Config | azure-pipelines.yml | .github/workflows/*.yml |
| Hosted Runners | Microsoft-hosted | GitHub-hosted |
| Self-hosted | Yes | Yes |
| Marketplace | Visual Studio Marketplace | GitHub Marketplace |
| Artifacts | Azure Artifacts | GitHub Packages |
| Integration | Azure services | GitHub ecosystem |

## Build Pipeline Examples

### Azure DevOps Pipeline

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - main
      - release/*
  paths:
    exclude:
      - docs/*
      - README.md

pool:
  vmImage: 'ubuntu-latest'

variables:
  buildConfiguration: 'Release'
  dotnetVersion: '7.0.x'

stages:
  - stage: Build
    displayName: 'Build and Test'
    jobs:
      - job: BuildJob
        steps:
          - task: UseDotNet@2
            displayName: 'Install .NET SDK'
            inputs:
              version: $(dotnetVersion)

          - task: DotNetCoreCLI@2
            displayName: 'Restore packages'
            inputs:
              command: restore
              projects: '**/*.csproj'

          - task: DotNetCoreCLI@2
            displayName: 'Build solution'
            inputs:
              command: build
              projects: '**/*.csproj'
              arguments: '--configuration $(buildConfiguration) --no-restore'

          - task: DotNetCoreCLI@2
            displayName: 'Run tests'
            inputs:
              command: test
              projects: '**/*Tests.csproj'
              arguments: '--configuration $(buildConfiguration) --collect:"XPlat Code Coverage"'

          - task: PublishCodeCoverageResults@1
            displayName: 'Publish code coverage'
            inputs:
              codeCoverageTool: 'Cobertura'
              summaryFileLocation: '$(Agent.TempDirectory)/**/coverage.cobertura.xml'

          - task: DotNetCoreCLI@2
            displayName: 'Publish artifacts'
            inputs:
              command: publish
              publishWebProjects: true
              arguments: '--configuration $(buildConfiguration) --output $(Build.ArtifactStagingDirectory)'

          - task: PublishBuildArtifacts@1
            displayName: 'Upload artifacts'
            inputs:
              pathToPublish: '$(Build.ArtifactStagingDirectory)'
              artifactName: 'webapp'

  - stage: DeployDev
    displayName: 'Deploy to Development'
    dependsOn: Build
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    jobs:
      - deployment: DeployWebApp
        environment: 'Development'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: AzureWebApp@1
                  inputs:
                    azureSubscription: 'Azure-Connection'
                    appName: 'webapp-dev'
                    package: '$(Pipeline.Workspace)/webapp/**/*.zip'
```

### GitHub Actions Workflow

```yaml
# .github/workflows/build-deploy.yml
name: Build and Deploy

on:
  push:
    branches:
      - main
      - 'release/*'
    paths-ignore:
      - 'docs/**'
      - 'README.md'
  pull_request:
    branches:
      - main

env:
  BUILD_CONFIGURATION: Release
  DOTNET_VERSION: '7.0.x'

jobs:
  build:
    name: Build and Test
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Setup .NET
        uses: actions/setup-dotnet@v3
        with:
          dotnet-version: ${{ env.DOTNET_VERSION }}

      - name: Restore dependencies
        run: dotnet restore

      - name: Build
        run: dotnet build --configuration ${{ env.BUILD_CONFIGURATION }} --no-restore

      - name: Test
        run: dotnet test --configuration ${{ env.BUILD_CONFIGURATION }} --no-build --collect:"XPlat Code Coverage"

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: '**/coverage.cobertura.xml'

      - name: Publish
        run: dotnet publish --configuration ${{ env.BUILD_CONFIGURATION }} --output ./publish

      - name: Upload artifact
        uses: actions/upload-artifact@v3
        with:
          name: webapp
          path: ./publish

  deploy-dev:
    name: Deploy to Development
    needs: build
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    environment: Development

    steps:
      - name: Download artifact
        uses: actions/download-artifact@v3
        with:
          name: webapp
          path: ./webapp

      - name: Login to Azure
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Deploy to Azure Web App
        uses: azure/webapps-deploy@v2
        with:
          app-name: 'webapp-dev'
          package: ./webapp
```

## Matrix Builds

### Azure DevOps

```yaml
strategy:
  matrix:
    linux:
      vmImage: 'ubuntu-latest'
    windows:
      vmImage: 'windows-latest'
    mac:
      vmImage: 'macOS-latest'

pool:
  vmImage: $(vmImage)

steps:
  - script: dotnet test
    displayName: 'Run tests on $(vmImage)'
```

### GitHub Actions

```yaml
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        dotnet-version: ['6.0.x', '7.0.x']

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-dotnet@v3
        with:
          dotnet-version: ${{ matrix.dotnet-version }}

      - run: dotnet test
```

## Environment Protection

### Azure DevOps

```yaml
# Environments defined in Azure DevOps UI
stages:
  - stage: Production
    jobs:
      - deployment: Deploy
        environment: 'Production'  # Has approval gates configured
        strategy:
          runOnce:
            deploy:
              steps:
                - script: echo "Deploying to production"
```

### GitHub Actions

```yaml
jobs:
  deploy-prod:
    runs-on: ubuntu-latest
    environment:
      name: Production
      url: https://myapp.azurewebsites.net

    steps:
      - name: Deploy
        run: echo "Deploying to production"
        # Environment has required reviewers configured in GitHub settings
```

## Reusable Components

### Azure DevOps Templates

```yaml
# templates/dotnet-build.yml
parameters:
  - name: buildConfiguration
    type: string
    default: 'Release'
  - name: projects
    type: string
    default: '**/*.csproj'

steps:
  - task: DotNetCoreCLI@2
    displayName: 'Restore'
    inputs:
      command: restore
      projects: ${{ parameters.projects }}

  - task: DotNetCoreCLI@2
    displayName: 'Build'
    inputs:
      command: build
      projects: ${{ parameters.projects }}
      arguments: '--configuration ${{ parameters.buildConfiguration }}'

# Using the template
stages:
  - stage: Build
    jobs:
      - job: BuildJob
        steps:
          - template: templates/dotnet-build.yml
            parameters:
              buildConfiguration: 'Release'
```

### GitHub Actions Reusable Workflows

```yaml
# .github/workflows/reusable-dotnet-build.yml
name: Reusable .NET Build

on:
  workflow_call:
    inputs:
      build-configuration:
        type: string
        default: 'Release'
      dotnet-version:
        type: string
        default: '7.0.x'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-dotnet@v3
        with:
          dotnet-version: ${{ inputs.dotnet-version }}

      - run: dotnet build --configuration ${{ inputs.build-configuration }}

# Using the reusable workflow
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  call-build:
    uses: ./.github/workflows/reusable-dotnet-build.yml
    with:
      build-configuration: 'Release'
      dotnet-version: '7.0.x'
```

## When to Choose Azure DevOps

- **Enterprise features**: Advanced security, compliance, audit trails
- **Full ALM**: Work items, repos, boards, test plans in one place
- **Complex pipelines**: Multi-stage deployments with approvals
- **Azure integration**: Native integration with Azure services
- **Existing investment**: Already using Azure DevOps for other features

## When to Choose GitHub Actions

- **Open source**: Free for public repositories
- **GitHub-native**: Code and CI/CD in one place
- **Community actions**: Large marketplace of community actions
- **Simplicity**: Easier to get started
- **Modern syntax**: More intuitive YAML syntax

## Hybrid Approach

You can use both together:

```yaml
# GitHub Actions that triggers Azure DevOps
name: Trigger Azure Pipeline

on:
  push:
    branches: [main]

jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Azure Pipeline
        run: |
          curl -X POST \
            -H "Authorization: Basic ${{ secrets.AZURE_DEVOPS_PAT }}" \
            -H "Content-Type: application/json" \
            -d '{"definition": {"id": 1}}' \
            "https://dev.azure.com/org/project/_apis/build/builds?api-version=6.0"
```

## Conclusion

Both platforms are excellent choices. Azure DevOps excels in enterprise scenarios with its full ALM suite, while GitHub Actions offers simplicity and a vibrant community ecosystem. Many organizations successfully use both - GitHub Actions for open-source projects and quick CI, Azure DevOps for complex enterprise deployments.

## Resources

- [Azure DevOps Documentation](https://docs.microsoft.com/en-us/azure/devops/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Azure DevOps Pipelines YAML](https://docs.microsoft.com/en-us/azure/devops/pipelines/yaml-schema)
- [GitHub Actions Workflow Syntax](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions)
