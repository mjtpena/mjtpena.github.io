---
title: "Power Platform ALM: Application Lifecycle Management Best Practices"
description: "Proper ALM ensures Power Platform solutions are reliable, maintainable, and can be safely deployed across environments."
author: Michael John Peña
draft: false
date: 2022-02-08
url: /blog/power-platform-alm/
tags:
  - power-platform
  - alm
  - DevOps
  - Governance
---

## Environment Strategy

A typical environment structure:

```
Development -> Build/Test -> UAT -> Production
     |             |          |          |
  Sandbox      Sandbox    Sandbox    Production
  (per dev)   (automated)  (QA)      (locked)
```

## Solution Structure

Organize solutions for maintainability:

```
├── Core Solution (Foundation)
│   ├── Common Tables
│   ├── Security Roles
│   └── Environment Variables
│
├── Feature Solutions
│   ├── Sales Module
│   │   ├── Tables
│   │   ├── Model-Driven App
│   │   └── Flows
│   │
│   └── Service Module
│       ├── Tables
│       ├── Canvas Apps
│       └── Flows
│
└── Customizations Solution (Org-specific)
    └── Configuration Data
```

## Solution Export with PowerShell

```powershell
# Connect to Power Platform
Install-Module -Name Microsoft.PowerApps.Administration.PowerShell
Install-Module -Name Microsoft.Xrm.Data.PowerShell

$conn = Connect-CrmOnline -ServerUrl "https://yourorg.crm.dynamics.com"

# Export solution
$solutionName = "SalesModule"
$version = "1.0.0.1"

# Update solution version
Set-CrmSolutionVersion -conn $conn -SolutionName $solutionName -Version $version

# Export as managed
Export-CrmSolution -conn $conn `
    -SolutionName $solutionName `
    -Managed $true `
    -SolutionFilePath ".\exports\${solutionName}_${version}_managed.zip"

# Export as unmanaged for source control
Export-CrmSolution -conn $conn `
    -SolutionName $solutionName `
    -Managed $false `
    -SolutionFilePath ".\exports\${solutionName}_${version}_unmanaged.zip"
```

## Solution Unpacking for Source Control

```powershell
# Unpack solution for version control
pac solution unpack `
    --zipfile ".\exports\SalesModule_1.0.0.1_unmanaged.zip" `
    --folder ".\src\SalesModule" `
    --packagetype Both `
    --allowDelete true `
    --allowWrite true

# Structure after unpacking:
# src/SalesModule/
# ├── Entities/
# │   └── account/
# │       ├── Entity.xml
# │       └── FormXml/
# ├── Workflows/
# ├── CanvasApps/
# └── solution.xml
```

## Azure DevOps Pipeline

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - main
  paths:
    include:
      - src/SalesModule/**

pool:
  vmImage: 'windows-latest'

variables:
  - group: PowerPlatform-Credentials
  - name: solutionName
    value: 'SalesModule'

stages:
  - stage: Build
    jobs:
      - job: PackSolution
        steps:
          - task: PowerPlatformToolInstaller@2
            inputs:
              DefaultVersion: true

          - task: PowerPlatformPackSolution@2
            inputs:
              SolutionSourceFolder: '$(Build.SourcesDirectory)/src/$(solutionName)'
              SolutionOutputFile: '$(Build.ArtifactStagingDirectory)/$(solutionName).zip'
              SolutionType: 'Managed'

          - task: PublishBuildArtifacts@1
            inputs:
              PathtoPublish: '$(Build.ArtifactStagingDirectory)'
              ArtifactName: 'solution'

  - stage: DeployTest
    dependsOn: Build
    jobs:
      - deployment: DeployToTest
        environment: 'PowerPlatform-Test'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: PowerPlatformToolInstaller@2

                - task: PowerPlatformImportSolution@2
                  inputs:
                    authenticationType: 'PowerPlatformSPN'
                    PowerPlatformSPN: 'PowerPlatform-Test-Connection'
                    SolutionInputFile: '$(Pipeline.Workspace)/solution/$(solutionName).zip'
                    AsyncOperation: true
                    MaxAsyncWaitTime: '60'

  - stage: DeployProduction
    dependsOn: DeployTest
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    jobs:
      - deployment: DeployToProd
        environment: 'PowerPlatform-Production'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: PowerPlatformToolInstaller@2

                - task: PowerPlatformImportSolution@2
                  inputs:
                    authenticationType: 'PowerPlatformSPN'
                    PowerPlatformSPN: 'PowerPlatform-Prod-Connection'
                    SolutionInputFile: '$(Pipeline.Workspace)/solution/$(solutionName).zip'
                    AsyncOperation: true
```

## GitHub Actions Alternative

```yaml
# .github/workflows/power-platform-deploy.yml
name: Power Platform Deployment

on:
  push:
    branches: [main]
    paths:
      - 'src/**'

env:
  SOLUTION_NAME: SalesModule

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install Power Platform CLI
        run: |
          dotnet tool install --global Microsoft.PowerApps.CLI.Tool

      - name: Pack Solution
        run: |
          pac solution pack `
            --zipfile "${{ github.workspace }}/solution/${{ env.SOLUTION_NAME }}.zip" `
            --folder "${{ github.workspace }}/src/${{ env.SOLUTION_NAME }}" `
            --packagetype Managed

      - name: Upload artifact
        uses: actions/upload-artifact@v3
        with:
          name: solution
          path: solution/

  deploy-test:
    needs: build
    runs-on: windows-latest
    environment: test
    steps:
      - name: Download artifact
        uses: actions/download-artifact@v3
        with:
          name: solution

      - name: Import Solution
        run: |
          pac auth create `
            --url ${{ secrets.TEST_ENVIRONMENT_URL }} `
            --applicationId ${{ secrets.CLIENT_ID }} `
            --clientSecret ${{ secrets.CLIENT_SECRET }} `
            --tenant ${{ secrets.TENANT_ID }}

          pac solution import `
            --path "${{ env.SOLUTION_NAME }}.zip" `
            --async true `
            --max-async-wait-time 60
```

## Configuration Data Migration

```powershell
# Export configuration data
$schemaPath = ".\config\data-schema.xml"

# Create schema file
@"
<entities>
  <entity name="systemuser" displayname="User" etc="8">
    <fields>
      <field name="systemuserid" displayname="User" type="guid" primaryKey="true"/>
      <field name="fullname" displayname="Full Name"/>
    </fields>
  </entity>
  <entity name="team" displayname="Team" etc="9">
    <!-- Define fields -->
  </entity>
</entities>
"@ | Out-File $schemaPath

# Export data
Export-CrmDataFile -conn $conn `
    -SchemaFile $schemaPath `
    -DataFile ".\config\configuration-data.zip"

# Import data to target
Import-CrmDataFile -conn $targetConn `
    -DataFile ".\config\configuration-data.zip"
```

Proper ALM ensures Power Platform solutions are reliable, maintainable, and can be safely deployed across environments.
