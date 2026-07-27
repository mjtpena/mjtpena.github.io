---
title: "Power Platform Managed Environments: Enterprise Governance at Scale"
author: Michael John Pena
draft: false
date: 2021-11-07
tags:
  - Power Platform
  - Governance
  - Microsoft
  - Enterprise
  - Low Code

---

I wrote "Power Platform Managed Environments: Enterprise Governance at Scale" to share practical, production-minded guidance on this topic.

## What Are Managed Environments?

Managed Environments provide a set of premium governance capabilities:

- **Usage insights**: Detailed analytics on environment usage
- **Sharing limits**: Control who can share apps and flows
- **Solution checker enforcement**: Mandatory quality checks
- **Data policies**: Enhanced data loss prevention
- **Weekly digest**: Automated reports to administrators

## Enabling Managed Environments

Enable through the Power Platform Admin Center or PowerShell:

```powershell
# Install the Power Platform Administration module
Install-Module -Name Microsoft.PowerApps.Administration.PowerShell

# Connect to Power Platform
Add-PowerAppsAccount

# Get the environment
$env = Get-AdminPowerAppEnvironment -EnvironmentName "Production"

# Enable managed environment
Set-AdminPowerAppEnvironmentGovernanceConfiguration `
    -EnvironmentName $env.EnvironmentName `
    -EnableManagedEnvironment $true
```

## Setting Sharing Limits

Control how apps and flows can be shared:

```powershell
# Configure sharing limits
Set-AdminPowerAppEnvironmentGovernanceConfiguration `
    -EnvironmentName "Production" `
    -EnableManagedEnvironment $true `
    -LimitSharingMode "ExcludeSharingToSecurityGroups" `
    -MaxShareLimit 20

# More restrictive: Only allow sharing with specific security groups
Set-AdminPowerAppEnvironmentGovernanceConfiguration `
    -EnvironmentName "Production" `
    -LimitSharingMode "OnlyShareWithSecurityGroups" `
    -ShareTargetSecurityGroups @(
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "b2c3d4e5-f6a7-8901-bcde-f12345678901"
    )
```

## Solution Checker Enforcement

Require all solutions to pass quality checks:

```powershell
# Enable solution checker
Set-AdminPowerAppEnvironmentGovernanceConfiguration `
    -EnvironmentName "Production" `
    -EnableSolutionChecker $true `
    -SolutionCheckerMode "Block" `
    -SolutionCheckerRuleset "AppSource"
```

When developing solutions, run the checker locally:

```powershell
# Check a solution before deployment
$results = Invoke-PowerAppChecker `
    -EnvironmentUrl "https://yourorg.crm.dynamics.com" `
    -SolutionPath "MySolution.zip" `
    -RuleSet "AppSource"

# Review results
$results.IssueSummary | Format-Table

# Critical issues will block deployment in managed environments
$results.Issues | Where-Object { $_.Severity -eq "Critical" }
```

## Data Loss Prevention Policies

Create comprehensive DLP policies:

```powershell
# Create a new DLP policy
$policy = New-DlpPolicy -DisplayName "Enterprise Data Policy" `
    -EnvironmentType "Production"

# Define connector groups
$businessConnectors = @(
    "shared_office365",
    "shared_sharepointonline",
    "shared_dynamicscrmOnline",
    "shared_sql",
    "shared_azureblob"
)

$blockedConnectors = @(
    "shared_twitter",
    "shared_facebook",
    "shared_dropbox"
)

# Configure the policy
Set-DlpPolicy -PolicyName $policy.Name `
    -BusinessDataGroup $businessConnectors `
    -BlockedGroup $blockedConnectors `
    -DefaultGroup "NonBusiness"

# Apply to specific environments
Add-DlpPolicyEnvironment -PolicyName $policy.Name `
    -EnvironmentName "Production"
```

## Custom Connectors Governance

Control custom connector creation and usage:

```powershell
# Get existing custom connectors
$connectors = Get-AdminPowerAppConnector -EnvironmentName "Production" `
    | Where-Object { $_.Properties.apiDefinitions.originalSwaggerUrl -ne $null }

# Review connector details
$connectors | ForEach-Object {
    [PSCustomObject]@{
        Name = $_.DisplayName
        Publisher = $_.Properties.publisher
        Tier = $_.Properties.tier
        CreatedBy = $_.Properties.createdBy.email
        CreatedTime = $_.Properties.createdTime
    }
} | Format-Table

# Add custom connector to DLP policy
$customConnectorId = "shared_mycompanyapi"
Add-DlpPolicyConnector -PolicyName "Enterprise Data Policy" `
    -ConnectorId $customConnectorId `
    -Group "Business"
```

## Weekly Digest Configuration

Set up automated governance reports:

```powershell
# Configure weekly digest recipients
Set-AdminPowerAppEnvironmentGovernanceConfiguration `
    -EnvironmentName "Production" `
    -EnableWeeklyDigest $true `
    -WeeklyDigestRecipients @(
        "admin@company.com",
        "governance-team@company.com"
    )
```

The digest includes:
- New apps created
- Apps shared broadly
- Flows with errors
- Connector usage statistics
- Policy violations

## Usage Insights with Power BI

Create custom governance dashboards:

```powerquery
// Power Query to fetch environment analytics
let
    Source = OData.Feed(
        "https://yourorg.api.crm.dynamics.com/api/data/v9.2/",
        null,
        [Implementation = "2.0"]
    ),

    // Get Power Apps usage
    apps = Source{[Name="workflows"]}[Data],

    // Filter and transform
    filteredApps = Table.SelectRows(apps, each [statecode] = 1),

    // Add calculated columns
    enriched = Table.AddColumn(filteredApps, "DaysSinceModified",
        each Duration.Days(DateTime.LocalNow() - [modifiedon]))

in
    enriched
```

DAX measures for governance metrics:

```dax
// Apps not modified in 90 days
Stale Apps =
CALCULATE(
    COUNTROWS(Apps),
    Apps[DaysSinceModified] > 90
)

// Apps shared with everyone
Broadly Shared Apps =
CALCULATE(
    COUNTROWS(Apps),
    Apps[ShareLevel] = "Organization"
)

// Policy violation trend
Violations This Month =
CALCULATE(
    COUNTROWS(PolicyViolations),
    DATESMTD(PolicyViolations[Date])
)
```

## Environment Lifecycle Management

Automate environment provisioning with governance:

```powershell
# Create a new managed environment
function New-ManagedEnvironment {
    param(
        [string]$DisplayName,
        [string]$Location,
        [string]$Purpose,
        [string[]]$Admins
    )

    # Create the environment
    $env = New-AdminPowerAppEnvironment `
        -DisplayName $DisplayName `
        -LocationName $Location `
        -EnvironmentSku "Production" `
        -ProvisionDatabase $true

    # Wait for provisioning
    do {
        Start-Sleep -Seconds 30
        $env = Get-AdminPowerAppEnvironment -EnvironmentName $env.EnvironmentName
    } while ($env.CommonDataServiceDatabaseProvisioningState -ne "Succeeded")

    # Enable managed environment
    Set-AdminPowerAppEnvironmentGovernanceConfiguration `
        -EnvironmentName $env.EnvironmentName `
        -EnableManagedEnvironment $true `
        -EnableSolutionChecker $true `
        -EnableWeeklyDigest $true

    # Assign administrators
    foreach ($admin in $Admins) {
        Set-AdminPowerAppEnvironmentRoleAssignment `
            -EnvironmentName $env.EnvironmentName `
            -PrincipalType "User" `
            -PrincipalObjectId $admin `
            -RoleName "Environment Admin"
    }

    # Apply DLP policy
    Add-DlpPolicyEnvironment `
        -PolicyName "Enterprise Data Policy" `
        -EnvironmentName $env.EnvironmentName

    return $env
}

# Usage
$newEnv = New-ManagedEnvironment `
    -DisplayName "Sales Department - Production" `
    -Location "unitedstates" `
    -Purpose "Sales team applications" `
    -Admins @("admin1@company.com", "admin2@company.com")
```

## Monitoring with Azure Monitor

Export Power Platform analytics to Azure:

```bicep
// Bicep template for analytics infrastructure
param location string = resourceGroup().location
param workspaceName string

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2021-06-01' = {
  name: workspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 90
  }
}

resource diagnosticSetting 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'PowerPlatformDiagnostics'
  properties: {
    workspaceId: logAnalytics.id
    logs: [
      {
        category: 'PowerAppsAnalytics'
        enabled: true
      }
      {
        category: 'PowerAutomateAnalytics'
        enabled: true
      }
    ]
  }
}
```

KQL queries for monitoring:

```kql
// Apps with high error rates
PowerAppsAnalytics
| where TimeGenerated > ago(7d)
| where EventType == "AppError"
| summarize ErrorCount = count() by AppName, AppId
| where ErrorCount > 10
| order by ErrorCount desc

// Flow failures by connector
PowerAutomateAnalytics
| where TimeGenerated > ago(24h)
| where Status == "Failed"
| extend ConnectorName = tostring(parse_json(ActionDetails).connectorName)
| summarize Failures = count() by ConnectorName
| order by Failures desc
```

Managed Environments represent a significant maturation of Power Platform governance. For enterprises that want to enable citizen development while maintaining control, these features are essential.

## Resources

- [Managed Environments Overview](https://docs.microsoft.com/en-us/power-platform/admin/managed-environment-overview)
- [Power Platform DLP Policies](https://docs.microsoft.com/en-us/power-platform/admin/wp-data-loss-prevention)
- [Power Platform Admin PowerShell](https://docs.microsoft.com/en-us/powershell/module/microsoft.powerapps.administration.powershell)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
