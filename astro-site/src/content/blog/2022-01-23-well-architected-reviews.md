---
title: "Azure Well-Architected Reviews: Building Better Workloads"
description: "Regular Well-Architected Reviews ensure your workloads remain optimized across all five pillars as they evolve."
author: Michael John Peña
draft: false
date: 2022-01-23
url: /blog/well-architected-reviews/
tags:
  - Azure
  - Architecture
  - Well-Architected
  - Best-Practices
---

## The Five Pillars

1. **Reliability** - Resiliency and availability
2. **Security** - Protect against threats
3. **Cost Optimization** - Manage costs effectively
4. **Operational Excellence** - Operations and monitoring
5. **Performance Efficiency** - Scale to meet demand

## Conducting a Well-Architected Assessment

Use the Well-Architected Review tool:

```powershell
# Install Az.Advisor module
Install-Module -Name Az.Advisor -Force

# Get Well-Architected recommendations
$recommendations = Get-AzAdvisorRecommendation |
    Where-Object { $_.Category -in @('HighAvailability', 'Security', 'Performance', 'Cost') }

# Group by category
$grouped = $recommendations | Group-Object Category

foreach ($group in $grouped) {
    Write-Host "`n=== $($group.Name) ===" -ForegroundColor Cyan
    foreach ($rec in $group.Group) {
        Write-Host "  - $($rec.ShortDescription.Problem)"
        Write-Host "    Impact: $($rec.Impact)"
        Write-Host "    Resource: $($rec.ResourceMetadata.ResourceId)"
    }
}
```

## Reliability Pillar

Implement resilient patterns:

```bicep
// reliability/multi-region-deployment.bicep
param primaryLocation string = 'australiaeast'
param secondaryLocation string = 'australiasoutheast'

// Primary region deployment
module primaryRegion 'modules/app-deployment.bicep' = {
  name: 'primary-deployment'
  params: {
    location: primaryLocation
    isPrimary: true
  }
}

// Secondary region deployment
module secondaryRegion 'modules/app-deployment.bicep' = {
  name: 'secondary-deployment'
  params: {
    location: secondaryLocation
    isPrimary: false
  }
}

// Traffic Manager for failover
resource trafficManager 'Microsoft.Network/trafficManagerProfiles@2018-08-01' = {
  name: 'tm-global-app'
  location: 'global'
  properties: {
    profileStatus: 'Enabled'
    trafficRoutingMethod: 'Priority'
    dnsConfig: {
      relativeName: 'myapp-global'
      ttl: 60
    }
    monitorConfig: {
      protocol: 'HTTPS'
      port: 443
      path: '/health'
      intervalInSeconds: 30
      timeoutInSeconds: 10
      toleratedNumberOfFailures: 3
    }
    endpoints: [
      {
        name: 'primary'
        type: 'Microsoft.Network/trafficManagerProfiles/azureEndpoints'
        properties: {
          priority: 1
          targetResourceId: primaryRegion.outputs.appServiceId
          endpointStatus: 'Enabled'
        }
      }
      {
        name: 'secondary'
        type: 'Microsoft.Network/trafficManagerProfiles/azureEndpoints'
        properties: {
          priority: 2
          targetResourceId: secondaryRegion.outputs.appServiceId
          endpointStatus: 'Enabled'
        }
      }
    ]
  }
}
```

## Security Pillar

Implement defense in depth:

```bicep
// security/defense-in-depth.bicep
param location string

// Network security
resource nsg 'Microsoft.Network/networkSecurityGroups@2021-08-01' = {
  name: 'nsg-app-tier'
  location: location
  properties: {
    securityRules: [
      {
        name: 'AllowHttpsInbound'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '443'
        }
      }
      {
        name: 'DenyAllInbound'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

// Key Vault for secrets
resource keyVault 'Microsoft.KeyVault/vaults@2021-11-01-preview' = {
  name: 'kv-app-secrets'
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
    }
  }
}

// Diagnostic settings for audit
resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: keyVault
  name: 'security-audit'
  properties: {
    workspaceId: logAnalytics.id
    logs: [
      {
        category: 'AuditEvent'
        enabled: true
        retentionPolicy: {
          enabled: true
          days: 365
        }
      }
    ]
  }
}
```

## Cost Optimization Pillar

```powershell
# Cost analysis script
$costData = Get-AzConsumptionUsageDetail -StartDate (Get-Date).AddDays(-30) -EndDate (Get-Date)

# Identify cost drivers
$topResources = $costData |
    Group-Object InstanceId |
    ForEach-Object {
        [PSCustomObject]@{
            Resource = $_.Name
            TotalCost = ($_.Group | Measure-Object -Property PretaxCost -Sum).Sum
        }
    } |
    Sort-Object TotalCost -Descending |
    Select-Object -First 10

# Recommendations
$topResources | ForEach-Object {
    $resource = Get-AzResource -ResourceId $_.Resource -ErrorAction SilentlyContinue
    if ($resource) {
        $advisor = Get-AzAdvisorRecommendation |
            Where-Object { $_.ResourceMetadata.ResourceId -eq $_.Resource -and $_.Category -eq 'Cost' }

        [PSCustomObject]@{
            ResourceName = $resource.Name
            ResourceType = $resource.ResourceType
            MonthlyCost = [math]::Round($_.TotalCost, 2)
            Recommendations = $advisor.ShortDescription.Problem -join '; '
        }
    }
}
```

## Assessment Automation

```yaml
# .github/workflows/well-architected-review.yml
name: Well-Architected Assessment

on:
  schedule:
    - cron: '0 0 1 * *'  # Monthly
  workflow_dispatch:

jobs:
  assess:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Run Assessment
        run: |
          # Get Advisor recommendations
          az advisor recommendation list \
            --category HighAvailability Security Performance Cost \
            --output json > assessment-results.json

          # Generate report
          python scripts/generate-war-report.py assessment-results.json

      - name: Upload Report
        uses: actions/upload-artifact@v3
        with:
          name: well-architected-report
          path: well-architected-report.html

      - name: Create Issue for High Impact Items
        uses: actions/github-script@v6
        with:
          script: |
            const fs = require('fs');
            const results = JSON.parse(fs.readFileSync('assessment-results.json'));
            const highImpact = results.filter(r => r.impact === 'High');

            if (highImpact.length > 0) {
              const body = highImpact.map(r =>
                `- **${r.category}**: ${r.shortDescription.problem}`
              ).join('\n');

              await github.rest.issues.create({
                owner: context.repo.owner,
                repo: context.repo.repo,
                title: 'Well-Architected Review: High Impact Recommendations',
                body: `## Monthly Assessment\n\n${body}`,
                labels: ['well-architected', 'infrastructure']
              });
            }
```

Regular Well-Architected Reviews ensure your workloads remain optimized across all five pillars as they evolve.
