---
title: "Azure Chaos Studio: Chaos Engineering for Resilient Applications"
author: Michael John Pena
draft: false
date: 2021-11-21
tags:
  - Azure
  - Chaos Engineering
  - Resilience
  - Testing
  - DevOps

---

I wrote "Azure Chaos Studio: Chaos Engineering for Resilient Applications" to share practical, production-minded guidance on this topic.

## What is Chaos Engineering?

Chaos engineering is the practice of experimenting on a system to build confidence in its ability to withstand turbulent conditions. Netflix pioneered this with Chaos Monkey, and now Azure brings similar capabilities to the cloud.

## Getting Started with Chaos Studio

### Enable Chaos Studio

```bash
# Register the provider
az provider register --namespace Microsoft.Chaos

# Enable chaos target on a VM
az rest --method PUT \
    --url "https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Compute/virtualMachines/{vm}/providers/Microsoft.Chaos/targets/microsoft-agent?api-version=2021-09-15-preview" \
    --body '{
        "properties": {}
    }'

# Enable capability (e.g., CPU pressure)
az rest --method PUT \
    --url "https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Compute/virtualMachines/{vm}/providers/Microsoft.Chaos/targets/microsoft-agent/capabilities/CPUPressure-1.0?api-version=2021-09-15-preview" \
    --body '{
        "properties": {}
    }'
```

### Bicep for Chaos Targets

```bicep
param vmName string
param location string = resourceGroup().location

resource vm 'Microsoft.Compute/virtualMachines@2021-07-01' existing = {
  name: vmName
}

resource chaosTarget 'Microsoft.Chaos/targets@2021-09-15-preview' = {
  name: 'microsoft-agent'
  scope: vm
  properties: {}
}

resource cpuPressure 'Microsoft.Chaos/targets/capabilities@2021-09-15-preview' = {
  parent: chaosTarget
  name: 'CPUPressure-1.0'
  properties: {}
}

resource memoryPressure 'Microsoft.Chaos/targets/capabilities@2021-09-15-preview' = {
  parent: chaosTarget
  name: 'VirtualMemoryPressure-1.0'
  properties: {}
}

resource diskIOPressure 'Microsoft.Chaos/targets/capabilities@2021-09-15-preview' = {
  parent: chaosTarget
  name: 'DiskIOPressure-1.0'
  properties: {}
}

resource networkDisconnect 'Microsoft.Chaos/targets/capabilities@2021-09-15-preview' = {
  parent: chaosTarget
  name: 'NetworkDisconnect-1.0'
  properties: {}
}
```

## Creating Chaos Experiments

### CPU Stress Experiment

```json
{
  "identity": {
    "type": "SystemAssigned"
  },
  "location": "eastus",
  "properties": {
    "selectors": [
      {
        "id": "selector1",
        "type": "List",
        "targets": [
          {
            "id": "/subscriptions/.../providers/Microsoft.Compute/virtualMachines/vm-web-01/providers/Microsoft.Chaos/targets/microsoft-agent",
            "type": "ChaosTarget"
          }
        ]
      }
    ],
    "steps": [
      {
        "name": "Step 1 - CPU Stress",
        "branches": [
          {
            "name": "Branch 1",
            "actions": [
              {
                "name": "CPU Pressure 80%",
                "type": "continuous",
                "duration": "PT10M",
                "selectorId": "selector1",
                "parameters": [
                  {
                    "key": "pressureLevel",
                    "value": "80"
                  }
                ],
                "urn": "urn:csci:microsoft:agent:cpuPressure/1.0"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

### Network Fault Experiment

```json
{
  "identity": {
    "type": "SystemAssigned"
  },
  "location": "eastus",
  "properties": {
    "selectors": [
      {
        "id": "webTier",
        "type": "List",
        "targets": [
          {
            "id": "/subscriptions/.../providers/Microsoft.Compute/virtualMachines/vm-web-01/providers/Microsoft.Chaos/targets/microsoft-agent",
            "type": "ChaosTarget"
          },
          {
            "id": "/subscriptions/.../providers/Microsoft.Compute/virtualMachines/vm-web-02/providers/Microsoft.Chaos/targets/microsoft-agent",
            "type": "ChaosTarget"
          }
        ]
      }
    ],
    "steps": [
      {
        "name": "Step 1 - Network Latency",
        "branches": [
          {
            "name": "Introduce Latency",
            "actions": [
              {
                "name": "Network Latency 200ms",
                "type": "continuous",
                "duration": "PT5M",
                "selectorId": "webTier",
                "parameters": [
                  {
                    "key": "latencyInMilliseconds",
                    "value": "200"
                  },
                  {
                    "key": "destinationFilters",
                    "value": "[{\"address\": \"10.0.2.0/24\", \"subnetMask\": \"255.255.255.0\"}]"
                  }
                ],
                "urn": "urn:csci:microsoft:agent:networkLatency/1.0"
              }
            ]
          }
        ]
      },
      {
        "name": "Step 2 - Network Disconnect",
        "branches": [
          {
            "name": "Disconnect Database",
            "actions": [
              {
                "name": "Block DB Traffic",
                "type": "continuous",
                "duration": "PT2M",
                "selectorId": "webTier",
                "parameters": [
                  {
                    "key": "destinationFilters",
                    "value": "[{\"address\": \"10.0.3.0/24\", \"subnetMask\": \"255.255.255.0\", \"portLow\": 1433, \"portHigh\": 1433}]"
                  }
                ],
                "urn": "urn:csci:microsoft:agent:networkDisconnect/1.0"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

### Azure Service Faults

```json
{
  "identity": {
    "type": "SystemAssigned"
  },
  "location": "eastus",
  "properties": {
    "selectors": [
      {
        "id": "cosmosSelector",
        "type": "List",
        "targets": [
          {
            "id": "/subscriptions/.../providers/Microsoft.DocumentDB/databaseAccounts/my-cosmos/providers/Microsoft.Chaos/targets/microsoft-cosmosdb",
            "type": "ChaosTarget"
          }
        ]
      }
    ],
    "steps": [
      {
        "name": "Cosmos DB Failover",
        "branches": [
          {
            "name": "Failover Branch",
            "actions": [
              {
                "name": "Failover to Secondary Region",
                "type": "discrete",
                "selectorId": "cosmosSelector",
                "parameters": [
                  {
                    "key": "readRegion",
                    "value": "West US 2"
                  }
                ],
                "urn": "urn:csci:microsoft:cosmosDB:failover/1.0"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

## Running Experiments

### CLI Execution

```bash
# Create the experiment
az rest --method PUT \
    --url "https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Chaos/experiments/cpu-stress-experiment?api-version=2021-09-15-preview" \
    --body @experiment.json

# Start the experiment
az rest --method POST \
    --url "https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Chaos/experiments/cpu-stress-experiment/start?api-version=2021-09-15-preview"

# Check status
az rest --method GET \
    --url "https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Chaos/experiments/cpu-stress-experiment/statuses?api-version=2021-09-15-preview"

# Get execution details
az rest --method GET \
    --url "https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Chaos/experiments/cpu-stress-experiment/executionDetails?api-version=2021-09-15-preview"
```

### PowerShell Automation

```powershell
function Start-ChaosExperiment {
    param(
        [string]$SubscriptionId,
        [string]$ResourceGroup,
        [string]$ExperimentName
    )

    $uri = "https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.Chaos/experiments/$ExperimentName/start?api-version=2021-09-15-preview"

    $token = (Get-AzAccessToken -ResourceUrl "https://management.azure.com").Token

    $response = Invoke-RestMethod -Uri $uri -Method POST -Headers @{
        "Authorization" = "Bearer $token"
    }

    return $response
}

function Get-ChaosExperimentStatus {
    param(
        [string]$SubscriptionId,
        [string]$ResourceGroup,
        [string]$ExperimentName
    )

    $uri = "https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.Chaos/experiments/$ExperimentName/statuses?api-version=2021-09-15-preview"

    $token = (Get-AzAccessToken -ResourceUrl "https://management.azure.com").Token

    $response = Invoke-RestMethod -Uri $uri -Method GET -Headers @{
        "Authorization" = "Bearer $token"
    }

    return $response.value | Sort-Object -Property createdDateUtc -Descending | Select-Object -First 1
}

# Usage
$result = Start-ChaosExperiment -SubscriptionId $sub -ResourceGroup $rg -ExperimentName "cpu-stress"

do {
    Start-Sleep -Seconds 30
    $status = Get-ChaosExperimentStatus -SubscriptionId $sub -ResourceGroup $rg -ExperimentName "cpu-stress"
    Write-Host "Status: $($status.status)"
} while ($status.status -eq "Running")
```

## Observability During Experiments

### Azure Monitor Integration

```kql
// Monitor VM metrics during chaos
Perf
| where TimeGenerated > ago(30m)
| where Computer == "vm-web-01"
| where ObjectName == "Processor" and CounterName == "% Processor Time"
| summarize AvgCPU = avg(CounterValue) by bin(TimeGenerated, 1m)
| render timechart

// Application response times during chaos
requests
| where timestamp > ago(30m)
| summarize
    AvgDuration = avg(duration),
    P95Duration = percentile(duration, 95),
    FailureRate = countif(success == false) * 100.0 / count()
    by bin(timestamp, 1m)
| render timechart

// Dependency failures during network chaos
dependencies
| where timestamp > ago(30m)
| where success == false
| summarize FailureCount = count() by target, resultCode, bin(timestamp, 1m)
| render timechart
```

### Custom Alerts

```bicep
param workspaceName string
param actionGroupId string

resource workspace 'Microsoft.OperationalInsights/workspaces@2021-06-01' existing = {
  name: workspaceName
}

resource chaosAlert 'Microsoft.Insights/scheduledQueryRules@2021-08-01' = {
  name: 'ChaosExperimentHighErrorRate'
  location: resourceGroup().location
  properties: {
    description: 'Alert when error rate exceeds threshold during chaos experiments'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    scopes: [workspace.id]
    criteria: {
      allOf: [
        {
          query: '''
            requests
            | summarize FailureRate = countif(success == false) * 100.0 / count()
            | where FailureRate > 10
          '''
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
        }
      ]
    }
    actions: {
      actionGroups: [actionGroupId]
    }
  }
}
```

## CI/CD Integration

### Azure DevOps Pipeline

```yaml
trigger: none

parameters:
  - name: experimentName
    displayName: Chaos Experiment Name
    type: string
    default: 'resilience-test'

stages:
  - stage: PreChaos
    displayName: 'Pre-Chaos Baseline'
    jobs:
      - job: BaselineMetrics
        steps:
          - task: AzureCLI@2
            displayName: 'Capture baseline metrics'
            inputs:
              azureSubscription: 'Azure-Connection'
              scriptType: 'bash'
              scriptLocation: 'inlineScript'
              inlineScript: |
                # Run load test for baseline
                az load test run create \
                    --test-id baseline-test \
                    --resource-group rg-loadtest \
                    --load-test-resource loadtest-resource

  - stage: ChaosExperiment
    displayName: 'Run Chaos Experiment'
    dependsOn: PreChaos
    jobs:
      - job: RunChaos
        steps:
          - task: AzureCLI@2
            displayName: 'Start chaos experiment'
            inputs:
              azureSubscription: 'Azure-Connection'
              scriptType: 'bash'
              scriptLocation: 'inlineScript'
              inlineScript: |
                # Start chaos experiment
                az rest --method POST \
                    --url "https://management.azure.com/subscriptions/$(subscriptionId)/resourceGroups/$(resourceGroup)/providers/Microsoft.Chaos/experiments/${{ parameters.experimentName }}/start?api-version=2021-09-15-preview"

                # Wait for completion
                while true; do
                    status=$(az rest --method GET \
                        --url "https://management.azure.com/subscriptions/$(subscriptionId)/resourceGroups/$(resourceGroup)/providers/Microsoft.Chaos/experiments/${{ parameters.experimentName }}/statuses?api-version=2021-09-15-preview" \
                        --query "value[0].status" -o tsv)

                    echo "Experiment status: $status"

                    if [ "$status" == "Succeeded" ] || [ "$status" == "Failed" ] || [ "$status" == "Canceled" ]; then
                        break
                    fi

                    sleep 30
                done

                if [ "$status" != "Succeeded" ]; then
                    echo "##vso[task.complete result=Failed;]Chaos experiment did not succeed"
                fi

  - stage: PostChaos
    displayName: 'Post-Chaos Validation'
    dependsOn: ChaosExperiment
    jobs:
      - job: ValidateResilience
        steps:
          - task: AzureCLI@2
            displayName: 'Validate application recovered'
            inputs:
              azureSubscription: 'Azure-Connection'
              scriptType: 'bash'
              scriptLocation: 'inlineScript'
              inlineScript: |
                # Run health checks
                response=$(curl -s -o /dev/null -w "%{http_code}" https://myapp.azurewebsites.net/health)

                if [ "$response" != "200" ]; then
                    echo "##vso[task.complete result=Failed;]Application health check failed"
                fi

                # Compare metrics with baseline
                # ... additional validation
```

## Best Practices

1. **Start small**: Begin with non-production environments
2. **Define steady state**: Know what "healthy" looks like
3. **Minimize blast radius**: Use resource groups and selectors
4. **Monitor closely**: Have alerts and dashboards ready
5. **Have a rollback plan**: Know how to stop experiments
6. **Document learnings**: Record what you discover

Azure Chaos Studio makes chaos engineering accessible and safe. By deliberately breaking things in controlled ways, you build confidence in your system's ability to handle real-world failures.

## Resources

- [Azure Chaos Studio Documentation](https://docs.microsoft.com/en-us/azure/chaos-studio/chaos-studio-overview)
- [Chaos Engineering Principles](https://principlesofchaos.org/)
- [Fault Library Reference](https://docs.microsoft.com/en-us/azure/chaos-studio/chaos-studio-fault-library)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
