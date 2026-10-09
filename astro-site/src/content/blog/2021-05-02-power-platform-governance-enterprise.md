---
title: "Power Platform Governance for Enterprise: DLP Policies and Environments"
description: "Power Platform governance is the problem that doesn't announce itself until it's already serious. I've walked into tenants where three hundred flows were…"
author: Michael John Peña
draft: false
date: 2021-05-02
tags:
  - Azure
  - Power Platform
  - Governance
  - DLP
  - Enterprise
---

Power Platform governance is the problem that doesn't announce itself until it's already serious. I've walked into tenants where three hundred flows were running, half connecting to personal OneDrive accounts or unapproved external services, and nobody had a complete list. The Centre of Excellence Starter Kit is where governance starts—DLP policies that define which connectors can coexist in a flow, environment strategy (default environment for personal productivity, managed environments for business-critical apps), Power Platform admin centre visibility into app and flow inventory. The governance posture needs to be established early; retrofitting it into an active tenant is possible but involves renegotiating expectations with users who built freely.

## The Governance Challenge

Power Platform's strength is its accessibility - business users can build apps and automations without IT involvement. But this creates risks:
- Sensitive data flowing to unauthorized services
- Shadow IT proliferation
- No audit trail for business-critical processes
- Compliance violations

Microsoft has been adding governance capabilities, and understanding these tools is essential for enterprise deployments.

## Data Loss Prevention (DLP) Policies

DLP policies control which connectors can be used together in apps and flows. You group connectors into three categories:
- **Business**: Connectors for business data
- **Non-Business**: Connectors for personal or external use
- **Blocked**: Connectors that cannot be used at all

Connectors in different groups cannot be used together.

```powershell
# Create a new DLP policy using PowerShell
Import-Module Microsoft.PowerApps.Administration.PowerShell

# Create policy
$policyDisplayName = "Enterprise Data Protection"

$newPolicy = New-AdminDlpPolicy -DisplayName $policyDisplayName -EnvironmentType "OnlyEnvironments"

# Get the policy ID
$policyId = $newPolicy.PolicyName

# Add connectors to Business group
$businessConnectors = @(
    "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
    "/providers/Microsoft.PowerApps/apis/shared_office365",
    "/providers/Microsoft.PowerApps/apis/shared_dynamicscrmonline",
    "/providers/Microsoft.PowerApps/apis/shared_commondataservice"
)

# Add connectors to Blocked group
$blockedConnectors = @(
    "/providers/Microsoft.PowerApps/apis/shared_dropbox",
    "/providers/Microsoft.PowerApps/apis/shared_googledrive"
)

# Apply the policy to production environment
Add-AdminDlpPolicyEnvironment -PolicyName $policyId -EnvironmentName "your-environment-guid"
```

## Environment Strategy

Environments are containers for Power Platform resources. A typical enterprise setup includes:

1. **Default Environment**: Where all users land initially - apply strict DLP
2. **Development Environments**: Sandbox environments for building
3. **Test Environments**: For validation before production
4. **Production Environments**: For business-critical apps

```powershell
# Create a new environment
$envParams = @{
    DisplayName = "Sales Team Production"
    Location = "australia"
    EnvironmentSku = "Production"
    ProvisionDatabase = $true
    WaitUntilFinished = $true
}

$newEnv = New-AdminPowerAppEnvironment @envParams

# Set up security groups for access
$securityGroupId = "your-security-group-guid"
Set-AdminPowerAppEnvironmentRoleAssignment -EnvironmentName $newEnv.EnvironmentName `
    -PrincipalObjectId $securityGroupId -PrincipalType "Group" -RoleName "EnvironmentMaker"
```

## Center of Excellence (CoE) Starter Kit

Microsoft provides the CoE Starter Kit - a collection of apps, flows, and dashboards for managing Power Platform at scale.

Key components:
- **Admin View**: See all apps, flows, and connectors across environments
- **DLP Editor**: Visual interface for managing DLP policies
- **App Quarantine**: Review and approve new apps
- **Usage Analytics**: Understand adoption patterns

Install it from the Power Platform admin center or via solution import.

```powershell
# Download and import the CoE Starter Kit solution
# First, download from https://aka.ms/CoEStarterKit

# Import using PowerShell
Import-Module Microsoft.Xrm.Tooling.CrmConnector.PowerShell

$conn = Get-CrmConnection -InteractiveMode

# Import core solution
Import-CrmSolution -SolutionFilePath ".\CenterofExcellenceCore_x_x_x_xx_managed.zip" `
    -ConnectionString $conn -AsyncOperation -PublishWorkflows
```

## Connector Classification Best Practices

When setting up DLP policies, consider:

**Business Connectors (Trusted)**
- Microsoft 365 services
- Dynamics 365
- Azure services
- Line-of-business systems via custom connectors

**Non-Business Connectors (Personal Use)**
- Social media
- Consumer cloud storage
- Third-party SaaS without enterprise agreements

**Blocked Connectors**
- Competitors' services
- Services that violate compliance requirements
- Deprecated services

## Custom Connector Governance

Custom connectors need special attention because they can connect to any API:

```powershell
# Get all custom connectors in tenant
$customConnectors = Get-AdminPowerAppConnector -FilterNonCustomConnectors

foreach ($connector in $customConnectors) {
    Write-Host "Connector: $($connector.DisplayName)"
    Write-Host "Environment: $($connector.EnvironmentName)"
    Write-Host "Created By: $($connector.CreatedBy.displayName)"
    Write-Host "---"
}

# Review and add custom connectors to DLP policies
# This requires manual review of each connector's purpose
```

## Monitoring and Alerts

Set up monitoring to catch governance issues:

```json
{
  "definition": {
    "triggers": {
      "When_a_record_is_created": {
        "type": "OpenApiConnectionWebhook",
        "inputs": {
          "host": {
            "connectionName": "shared_commondataservice",
            "apiId": "/providers/Microsoft.PowerApps/apis/shared_commondataservice"
          },
          "parameters": {
            "subscriptionRequest/entityname": "workflow",
            "subscriptionRequest/sdkmessage": "Create"
          }
        }
      }
    },
    "actions": {
      "Send_approval_email": {
        "type": "OpenApiConnection",
        "inputs": {
          "host": {
            "connectionName": "shared_office365",
            "apiId": "/providers/Microsoft.PowerApps/apis/shared_office365"
          },
          "method": "post",
          "path": "/v2/Mail",
          "body": {
            "To": "platform-admins@company.com",
            "Subject": "New Flow Created - Review Required",
            "Body": "A new flow was created and requires review."
          }
        }
      }
    }
  }
}
```

## Tenant-Wide vs Environment-Specific Policies

You can apply DLP policies at two levels:

- **Tenant-Wide**: Applies to all environments including new ones
- **Environment-Specific**: Applies only to selected environments

Best practice: Start with a restrictive tenant-wide policy, then create more permissive environment-specific policies for trusted teams.

## The Governance Journey

Implementing governance is a journey, not a destination:

1. **Discover**: Understand current usage with CoE analytics
2. **Plan**: Define policies based on security and compliance requirements
3. **Implement**: Roll out policies gradually, starting with new environments
4. **Communicate**: Train users on why policies exist
5. **Iterate**: Refine policies based on feedback and incidents

## Resources

- [Power Platform Center of Excellence](https://docs.microsoft.com/en-us/power-platform/guidance/coe/starter-kit)
- [DLP Policy Documentation](https://docs.microsoft.com/en-us/power-platform/admin/wp-data-loss-prevention)
- [Power Platform Admin PowerShell](https://docs.microsoft.com/en-us/power-platform/admin/powerapps-powershell)
