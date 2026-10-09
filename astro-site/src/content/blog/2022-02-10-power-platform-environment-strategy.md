---
title: "Power Platform Environment Strategy: Planning for Scale"
description: "A well-planned environment strategy enables teams to move fast while maintaining governance and security."
author: Michael John Peña
draft: false
date: 2022-02-10
url: /blog/power-platform-environment-strategy/
tags:
  - power-platform
  - Governance
  - environments
  - Architecture
---

## Environment Types

- **Default**: Auto-created, limited for production use
- **Production**: Full capacity, managed solutions
- **Sandbox**: Copy of production or blank, for testing
- **Developer**: Individual developer environments
- **Trial**: Temporary, evaluation purposes

## Common Patterns

### Development Pattern

```
Developer Environments (Individual)
├── Dev-JohnSmith
├── Dev-JaneDoe
└── Dev-BobJohnson

Shared Development
├── Dev-SalesTeam
└── Dev-ServiceTeam

Build/Integration
└── Build (automated deployments)

QA/UAT
├── Test (automated testing)
└── UAT (user acceptance)

Production
├── Production (primary)
└── DR (disaster recovery - optional)
```

## Environment Provisioning with PowerShell

```powershell
# Import required modules
Install-Module -Name Microsoft.PowerApps.Administration.PowerShell -Force

# Connect
Add-PowerAppsAccount

# Create production environment
New-AdminPowerAppEnvironment `
    -DisplayName "Contoso Production" `
    -Location "australia" `
    -EnvironmentSku "Production" `
    -ProvisionDatabase `
    -CurrencyName "AUD" `
    -LanguageName "English"

# Create sandbox for testing
New-AdminPowerAppEnvironment `
    -DisplayName "Contoso UAT" `
    -Location "australia" `
    -EnvironmentSku "Sandbox" `
    -ProvisionDatabase `
    -CurrencyName "AUD" `
    -LanguageName "English"

# Create developer environment
New-AdminPowerAppEnvironment `
    -DisplayName "Dev-JohnSmith" `
    -Location "australia" `
    -EnvironmentSku "Developer"
```

## Environment Security

```powershell
# Set environment security group
Set-AdminPowerAppEnvironmentSecurityGroup `
    -EnvironmentName "00000000-0000-0000-0000-000000000000" `
    -SecurityGroupId "11111111-1111-1111-1111-111111111111"

# Configure DLP policy
New-DlpPolicy `
    -PolicyName "Production Data Policy" `
    -BlockedConnectors @(
        "shared_twitter",
        "shared_facebook"
    ) `
    -BusinessDataGroup @(
        "shared_commondataserviceforapps",
        "shared_office365",
        "shared_sharepointonline"
    ) `
    -NonBusinessDataGroup @(
        "shared_azureblob",
        "shared_sql"
    ) `
    -Environments @("00000000-0000-0000-0000-000000000000")
```

## Automated Environment Setup

```yaml
# .github/workflows/setup-environment.yml
name: Setup Power Platform Environment

on:
  workflow_dispatch:
    inputs:
      environment_name:
        description: 'Environment display name'
        required: true
      environment_type:
        description: 'Environment type'
        required: true
        type: choice
        options:
          - Developer
          - Sandbox
          - Production

jobs:
  create-environment:
    runs-on: ubuntu-latest
    steps:
      - name: Install Power Platform CLI
        run: |
          dotnet tool install --global Microsoft.PowerApps.CLI.Tool

      - name: Authenticate
        run: |
          pac auth create \
            --applicationId ${{ secrets.CLIENT_ID }} \
            --clientSecret ${{ secrets.CLIENT_SECRET }} \
            --tenant ${{ secrets.TENANT_ID }}

      - name: Create Environment
        run: |
          pac admin create \
            --name "${{ github.event.inputs.environment_name }}" \
            --type ${{ github.event.inputs.environment_type }} \
            --region australia \
            --currency AUD \
            --language 1033

      - name: Apply Base Solutions
        if: github.event.inputs.environment_type != 'Developer'
        run: |
          # Import foundation solutions
          pac solution import \
            --path "./solutions/CorePlatform.zip" \
            --async true

      - name: Configure Security
        run: |
          # Apply security group based on environment type
          if [ "${{ github.event.inputs.environment_type }}" == "Production" ]; then
            # Production security group
            echo "Applying production security"
          fi
```

## Environment Lifecycle Management

```powershell
# Copy production to sandbox (for testing)
Copy-PowerAppEnvironment `
    -SourceEnvironmentName "00000000-0000-0000-0000-000000000000" `
    -TargetEnvironmentName "11111111-1111-1111-1111-111111111111" `
    -CopyType "FullCopy"

# Reset sandbox environment
Reset-PowerAppEnvironment `
    -EnvironmentName "11111111-1111-1111-1111-111111111111" `
    -CurrencyName "AUD" `
    -LanguageName "English"

# Delete old developer environments
$oldEnvironments = Get-AdminPowerAppEnvironment |
    Where-Object {
        $_.Properties.EnvironmentType -eq "Developer" -and
        $_.Properties.LastModifiedTime -lt (Get-Date).AddDays(-90)
    }

foreach ($env in $oldEnvironments) {
    Write-Host "Removing: $($env.DisplayName)"
    Remove-AdminPowerAppEnvironment -EnvironmentName $env.EnvironmentName
}
```

## Monitoring Environments

```powershell
function Get-EnvironmentHealthReport {
    $environments = Get-AdminPowerAppEnvironment

    $report = @()
    foreach ($env in $environments) {
        $apps = Get-AdminPowerApp -EnvironmentName $env.EnvironmentName
        $flows = Get-AdminFlow -EnvironmentName $env.EnvironmentName

        $report += [PSCustomObject]@{
            Name = $env.DisplayName
            Type = $env.Properties.EnvironmentType
            State = $env.Properties.States.Runtime.Id
            Apps = $apps.Count
            Flows = $flows.Count
            StorageCapacity = $env.Properties.Capacity.Storage
            Created = $env.Properties.CreatedTime
            LastModified = $env.Properties.LastModifiedTime
        }
    }

    return $report
}

$healthReport = Get-EnvironmentHealthReport
$healthReport | Format-Table -AutoSize
$healthReport | Export-Csv "environment-health.csv"
```

## Best Practices

1. **Isolate production** - Strict access controls
2. **Use managed solutions only** - In production
3. **Automate provisioning** - Consistent configurations
4. **Implement DLP policies** - Protect data
5. **Regular cleanup** - Remove unused environments
6. **Monitor capacity** - Track usage and limits
7. **Document ownership** - Clear responsibility

A well-planned environment strategy enables teams to move fast while maintaining governance and security.
