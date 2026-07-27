---
title: "Power Platform Solution Layering: Managing Dependencies"
author: Michael John Peña
draft: false
date: 2022-02-09
url: /blog/power-platform-solution-layering/
tags:
  - power-platform
  - solutions
  - architecture
  - governance

---

I wrote "Power Platform Solution Layering: Managing Dependencies" to share practical, production-minded guidance on this topic.

## Solution Layer Concepts

Solutions are applied in layers:
1. System Layer (Microsoft base)
2. Managed Solutions (in order of installation)
3. Unmanaged Layer (Active customizations)

## Viewing Solution Layers

```powershell
# Using Power Platform CLI
pac solution list --environment https://yourorg.crm.dynamics.com

# View component layers
$componentId = "account"
$componentType = 1  # Entity

Get-CrmRecordsByFetch -conn $conn -Fetch @"
<fetch>
  <entity name='solutioncomponent'>
    <attribute name='solutionid' />
    <attribute name='objectid' />
    <filter>
      <condition attribute='objectid' operator='eq' value='$componentId' />
      <condition attribute='componenttype' operator='eq' value='$componentType' />
    </filter>
    <link-entity name='solution' from='solutionid' to='solutionid'>
      <attribute name='friendlyname' />
      <attribute name='ismanaged' />
      <attribute name='installedon' />
      <order attribute='installedon' descending='false' />
    </link-entity>
  </entity>
</fetch>
"@
```

## Solution Architecture Patterns

### Segmented Solution Pattern

```
Base Solution (Core Platform)
├── Security Solution (Roles, Teams)
├── Data Model Solution (Entities, Relationships)
├── Business Logic Solution (Flows, Plugins)
└── UI Solution (Apps, Forms)
```

### Publisher Configuration

```xml
<!-- customizations.xml -->
<ImportExportXml>
  <Entities />
  <Publishers>
    <Publisher>
      <UniqueName>contoso</UniqueName>
      <LocalizedNames>
        <LocalizedName description="Contoso" languagecode="1033" />
      </LocalizedNames>
      <CustomizationPrefix>cont</CustomizationPrefix>
      <CustomizationOptionValuePrefix>10000</CustomizationOptionValuePrefix>
    </Publisher>
  </Publishers>
</ImportExportXml>
```

## Dependency Management

```powershell
# Check solution dependencies
function Get-SolutionDependencies {
    param(
        [string]$SolutionName,
        $Connection
    )

    $solution = Get-CrmRecords -conn $Connection `
        -EntityLogicalName solution `
        -FilterAttribute uniquename `
        -FilterOperator eq `
        -FilterValue $SolutionName

    $components = Get-CrmRecordsByFetch -conn $Connection -Fetch @"
<fetch>
  <entity name='solutioncomponent'>
    <all-attributes />
    <filter>
      <condition attribute='solutionid' operator='eq' value='$($solution.CrmRecords[0].solutionid)' />
    </filter>
  </entity>
</fetch>
"@

    $dependencies = @()
    foreach ($component in $components.CrmRecords) {
        $deps = Get-CrmRecordsByFetch -conn $Connection -Fetch @"
<fetch>
  <entity name='dependency'>
    <all-attributes />
    <filter>
      <condition attribute='dependentcomponentobjectid' operator='eq' value='$($component.objectid)' />
    </filter>
  </entity>
</fetch>
"@
        $dependencies += $deps.CrmRecords
    }

    return $dependencies
}
```

## Handling Layer Conflicts

### Removing Unmanaged Layer

```powershell
# Remove active customization from a component
function Remove-ActiveCustomization {
    param(
        [Guid]$SolutionId,
        [Guid]$ComponentId,
        [int]$ComponentType,
        $Connection
    )

    $request = New-Object Microsoft.Crm.Sdk.Messages.RemoveSolutionComponentRequest
    $request.SolutionUniqueName = "Active"
    $request.ComponentId = $ComponentId
    $request.ComponentType = $ComponentType

    $Connection.Execute($request)
}
```

### Merging Solutions

```powershell
# Clone solution to create patch or upgrade
$cloneRequest = @{
    "ParentSolutionUniqueName" = "SalesModule"
    "DisplayName" = "Sales Module Patch 1"
    "VersionNumber" = "1.0.0.1"
}

# For patch
pac solution clone --name "SalesModule" --outputPath "./patches" --include-customization

# For upgrade
pac solution clone-patch --name "SalesModulePatch1" --parentSolution "SalesModule" --version "1.0.0.1"
```

## CI/CD with Layer Awareness

```yaml
# azure-pipelines.yml
stages:
  - stage: PreDeploymentChecks
    jobs:
      - job: CheckDependencies
        steps:
          - task: PowerPlatformToolInstaller@2

          - task: PowerShell@2
            displayName: 'Validate Solution Dependencies'
            inputs:
              targetType: inline
              script: |
                # Check if required solutions exist in target
                $requiredSolutions = @(
                    @{ Name = "CorePlatform"; MinVersion = "1.0.0.0" }
                    @{ Name = "SecurityModule"; MinVersion = "1.0.0.0" }
                )

                pac auth create --url $(TargetEnvironmentUrl) --applicationId $(ClientId) --clientSecret $(ClientSecret) --tenant $(TenantId)

                $installedSolutions = pac solution list --json | ConvertFrom-Json

                foreach ($required in $requiredSolutions) {
                    $installed = $installedSolutions | Where-Object { $_.UniqueName -eq $required.Name }
                    if (-not $installed) {
                        Write-Error "Missing required solution: $($required.Name)"
                        exit 1
                    }
                    if ([version]$installed.Version -lt [version]$required.MinVersion) {
                        Write-Error "Solution $($required.Name) version $($installed.Version) is below minimum $($required.MinVersion)"
                        exit 1
                    }
                }

  - stage: Deploy
    dependsOn: PreDeploymentChecks
    jobs:
      - deployment: DeploySolution
        steps:
          # Deploy base solutions first
          - task: PowerPlatformImportSolution@2
            displayName: 'Import Core Platform'
            inputs:
              SolutionInputFile: 'CorePlatform.zip'

          # Then deploy dependent solutions
          - task: PowerPlatformImportSolution@2
            displayName: 'Import Sales Module'
            inputs:
              SolutionInputFile: 'SalesModule.zip'
```

## Best Practices

1. **Use a consistent publisher** - One publisher per organization
2. **Segment solutions** - Separate by function and team
3. **Avoid unmanaged customizations** - Always work in solutions
4. **Test upgrades** - Verify layer behavior before production
5. **Document dependencies** - Maintain dependency matrix
6. **Use solution checker** - Validate before deployment

Understanding solution layering prevents deployment issues and ensures predictable behavior across environments.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
