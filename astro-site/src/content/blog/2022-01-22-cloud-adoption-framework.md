---
title: "Cloud Adoption Framework: Your Guide to Azure Success"
description: "The Microsoft Cloud Adoption Framework (CAF) is the comprehensive guidance body that addresses the full journey of cloud adoption—not just the technical…"
author: Michael John Peña
draft: false
date: 2022-01-22
url: /blog/cloud-adoption-framework/
tags:
  - Azure
  - cloud-adoption
  - Strategy
  - Best-Practices
---

The Microsoft Cloud Adoption Framework (CAF) is the comprehensive guidance body that addresses the full journey of cloud adoption—not just the technical "how do I deploy this service" questions but the organisational, strategic, and operational questions that determine whether a cloud adoption program succeeds or stalls. The CAF lifecycle: Strategy (define business justification and expected outcomes), Plan (align cloud adoption with business goals and build a skills readiness plan), Ready (prepare the Azure environment through Landing Zones), Adopt (migrate existing workloads and/or innovate with new cloud-native solutions), Govern (implement governance across cost, security, identity, and resource consistency), and Manage (establish operational baselines for cloud-hosted workloads). The CAF documentation includes decision trees, templates, implementation guides, and tool references for each phase. For organisations starting their Azure adoption, CAF provides the map; the Azure Landing Zone accelerator implements the destination that CAF's Ready phase describes.

## CAF Methodology

The framework consists of several phases:

1. **Strategy** - Define business justification
2. **Plan** - Create adoption plan
3. **Ready** - Prepare environment
4. **Adopt** - Migrate or innovate
5. **Govern** - Implement governance
6. **Manage** - Manage operations

## Strategy Phase

Document your cloud strategy:

```yaml
# cloud-strategy.yaml
business_outcomes:
  - name: "Reduce operational costs"
    metric: "30% reduction in infrastructure costs"
    timeline: "12 months"

  - name: "Improve time to market"
    metric: "50% faster deployment cycles"
    timeline: "6 months"

  - name: "Enable innovation"
    metric: "3 new cloud-native applications"
    timeline: "18 months"

motivations:
  - cost_savings
  - scalability
  - business_agility
  - modernization

current_state:
  total_workloads: 150
  data_centers: 2
  annual_it_spend: 5000000
  on_premises_percentage: 80

target_state:
  cloud_percentage: 70
  on_premises_percentage: 20
  hybrid_percentage: 10
```

## Plan Phase - Digital Estate Assessment

```powershell
# Assess current workloads
$assessment = @()

Get-AzVM | ForEach-Object {
    $vm = $_
    $metrics = Get-AzMetric -ResourceId $vm.Id -MetricName "Percentage CPU" -TimeGrain 01:00:00 -StartTime (Get-Date).AddDays(-30)

    $assessment += [PSCustomObject]@{
        Name = $vm.Name
        Size = $vm.HardwareProfile.VmSize
        Location = $vm.Location
        AvgCPU = ($metrics.Data | Measure-Object -Property Average -Average).Average
        MigrationComplexity = if ($vm.StorageProfile.DataDisks.Count -gt 5) { "High" } else { "Medium" }
    }
}

# Categorize workloads
$assessment | ForEach-Object {
    $_.RecommendedAction = switch ($true) {
        ($_.AvgCPU -lt 5) { "Retire/Decommission" }
        ($_.AvgCPU -lt 20) { "Right-size then Migrate" }
        ($_.MigrationComplexity -eq "High") { "Rearchitect" }
        default { "Rehost (Lift and Shift)" }
    }
}

$assessment | Export-Csv "workload-assessment.csv"
```

## Ready Phase - Landing Zone Deployment

```bicep
// landing-zone-ready.bicep
targetScope = 'subscription'

param environment string
param location string = 'australiaeast'

// Core resource groups
var resourceGroups = [
  'rg-networking-${environment}'
  'rg-security-${environment}'
  'rg-management-${environment}'
  'rg-workloads-${environment}'
]

resource rgs 'Microsoft.Resources/resourceGroups@2021-04-01' = [for name in resourceGroups: {
  name: name
  location: location
  tags: {
    environment: environment
    framework: 'CAF'
  }
}]

// Networking foundation
module networking 'modules/networking.bicep' = {
  name: 'networking-deployment'
  scope: resourceGroup('rg-networking-${environment}')
  params: {
    location: location
    environment: environment
  }
  dependsOn: [rgs]
}

// Security baseline
module security 'modules/security.bicep' = {
  name: 'security-deployment'
  scope: resourceGroup('rg-security-${environment}')
  params: {
    location: location
  }
  dependsOn: [rgs]
}

// Management services
module management 'modules/management.bicep' = {
  name: 'management-deployment'
  scope: resourceGroup('rg-management-${environment}')
  params: {
    location: location
  }
  dependsOn: [rgs]
}
```

## Govern Phase - Policy Implementation

```bicep
// governance/caf-policies.bicep
targetScope = 'managementGroup'

// Cost management policies
resource budgetPolicy 'Microsoft.Authorization/policyDefinitions@2021-06-01' = {
  name: 'require-budget'
  properties: {
    displayName: 'Require budget on subscriptions'
    mode: 'All'
    policyRule: {
      if: {
        field: 'type'
        equals: 'Microsoft.Resources/subscriptions'
      }
      then: {
        effect: 'auditIfNotExists'
        details: {
          type: 'Microsoft.Consumption/budgets'
          existenceCondition: {
            field: 'Microsoft.Consumption/budgets/amount'
            greater: 0
          }
        }
      }
    }
  }
}

// Security policies
resource securityPolicySet 'Microsoft.Authorization/policySetDefinitions@2021-06-01' = {
  name: 'caf-security-baseline'
  properties: {
    displayName: 'CAF Security Baseline'
    policyDefinitions: [
      {
        policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/a451c1ef-c6ca-483d-87ed-f49761e3ffb5'  // Audit VMs without managed disks
      }
      {
        policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/404c3081-a854-4457-ae30-26a93ef643f9'  // Secure transfer for storage
      }
      {
        policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/9daedab3-fb2d-461e-b861-71790eead4f6'  // TDE on SQL databases
      }
    ]
  }
}
```

## Manage Phase - Operations Baseline

```bicep
// management/operations-baseline.bicep
param location string

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2021-12-01-preview' = {
  name: 'log-caf-operations'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 90
  }
}

resource actionGroup 'Microsoft.Insights/actionGroups@2022-06-01' = {
  name: 'ag-operations'
  location: 'global'
  properties: {
    enabled: true
    groupShortName: 'ops-alerts'
    emailReceivers: [
      {
        name: 'Operations Team'
        emailAddress: 'ops@company.com'
      }
    ]
  }
}

// VM availability alert
resource vmAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-vm-availability'
  location: 'global'
  properties: {
    severity: 1
    enabled: true
    scopes: [subscription().id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.MultipleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'vm-availability'
          metricName: 'VmAvailabilityMetric'
          dimensions: []
          operator: 'LessThan'
          threshold: 1
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
  }
}
```

The Cloud Adoption Framework provides a structured approach to cloud adoption, ensuring you address all critical aspects of your journey to Azure.
