---
title: "ARM What-If: Preview Changes Before Deploying"
author: Michael John Peña
draft: false
date: 2022-01-18
url: /blog/arm-what-if/
tags:
  - azure
  - arm
  - bicep
  - deployment

---

I wrote "ARM What-If: Preview Changes Before Deploying" to share practical, production-minded guidance on this topic.

## Understanding What-If

What-if compares your template with the current state of Azure resources and shows:
- Resources that will be created
- Resources that will be modified
- Resources that will be deleted
- Resources with no changes

## Using What-If with Azure CLI

```bash
# What-if for resource group deployment
az deployment group what-if \
  --resource-group rg-production \
  --template-file main.bicep \
  --parameters @parameters.prod.json

# What-if for subscription deployment
az deployment sub what-if \
  --location australiaeast \
  --template-file main.bicep \
  --parameters environment=prod

# What-if with specific result format
az deployment group what-if \
  --resource-group rg-production \
  --template-file main.bicep \
  --result-format FullResourcePayloads
```

## What-If in PowerShell

```powershell
# Test deployment with what-if
$params = @{
    ResourceGroupName = 'rg-production'
    TemplateFile = 'main.bicep'
    TemplateParameterFile = 'parameters.prod.json'
}

$result = Get-AzResourceGroupDeploymentWhatIfResult @params

# Analyze results
$result.Changes | ForEach-Object {
    Write-Host "Resource: $($_.RelativeResourceId)"
    Write-Host "Change Type: $($_.ChangeType)"

    if ($_.Delta) {
        $_.Delta | ForEach-Object {
            Write-Host "  Property: $($_.Path)"
            Write-Host "  Before: $($_.Before)"
            Write-Host "  After: $($_.After)"
        }
    }
    Write-Host "---"
}

# Check for destructive changes
$destructive = $result.Changes | Where-Object {
    $_.ChangeType -in @('Delete', 'Modify')
}

if ($destructive.Count -gt 0) {
    Write-Warning "Destructive changes detected!"
    $destructive | Format-Table RelativeResourceId, ChangeType
}
```

## Integrating What-If in CI/CD

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - main

stages:
  - stage: Validate
    jobs:
      - job: WhatIf
        pool:
          vmImage: 'ubuntu-latest'
        steps:
          - task: AzureCLI@2
            displayName: 'What-If Analysis'
            inputs:
              azureSubscription: 'Azure-Connection'
              scriptType: 'bash'
              scriptLocation: 'inlineScript'
              inlineScript: |
                # Run what-if and capture output
                az deployment group what-if \
                  --resource-group $(resourceGroup) \
                  --template-file main.bicep \
                  --parameters @parameters.$(environment).json \
                  --no-pretty-print > whatif-output.json

                # Check for deletions
                if grep -q '"Delete"' whatif-output.json; then
                  echo "##vso[task.logissue type=warning]Deployment will DELETE resources!"
                  echo "##vso[task.setvariable variable=hasDeletes;isOutput=true]true"
                fi

                # Display results
                cat whatif-output.json | jq '.'
            name: whatif

      - job: RequireApproval
        dependsOn: WhatIf
        condition: eq(dependencies.WhatIf.outputs['whatif.hasDeletes'], 'true')
        pool: server
        steps:
          - task: ManualValidation@0
            inputs:
              notifyUsers: 'platform-team@company.com'
              instructions: 'Review what-if results. Deployment will DELETE resources.'
              onTimeout: 'reject'

  - stage: Deploy
    dependsOn: Validate
    jobs:
      - deployment: DeployInfra
        environment: 'Production'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: AzureCLI@2
                  inputs:
                    azureSubscription: 'Azure-Connection'
                    scriptType: 'bash'
                    scriptLocation: 'inlineScript'
                    inlineScript: |
                      az deployment group create \
                        --resource-group $(resourceGroup) \
                        --template-file main.bicep \
                        --parameters @parameters.$(environment).json
```

## GitHub Actions Integration

```yaml
# .github/workflows/deploy.yml
name: Deploy Infrastructure

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  what-if:
    runs-on: ubuntu-latest
    outputs:
      has-changes: ${{ steps.whatif.outputs.has-changes }}
    steps:
      - uses: actions/checkout@v3

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: What-If
        id: whatif
        run: |
          result=$(az deployment group what-if \
            --resource-group ${{ vars.RESOURCE_GROUP }} \
            --template-file main.bicep \
            --parameters environment=${{ github.ref == 'refs/heads/main' && 'prod' || 'dev' }} \
            --no-pretty-print)

          echo "$result" | jq '.'

          # Check for any changes
          change_count=$(echo "$result" | jq '.changes | length')
          if [ "$change_count" -gt 0 ]; then
            echo "has-changes=true" >> $GITHUB_OUTPUT
          else
            echo "has-changes=false" >> $GITHUB_OUTPUT
          fi

      - name: Comment on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v6
        with:
          script: |
            const output = `## What-If Results
            \`\`\`
            ${{ steps.whatif.outputs.result }}
            \`\`\``;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: output
            });

  deploy:
    needs: what-if
    if: github.ref == 'refs/heads/main' && needs.what-if.outputs.has-changes == 'true'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v3
      - uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Deploy
        run: |
          az deployment group create \
            --resource-group ${{ vars.RESOURCE_GROUP }} \
            --template-file main.bicep \
            --parameters environment=prod
```

What-if is an essential safety net for infrastructure deployments, preventing costly mistakes before they happen.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
