---
title: Azure Cost Management Budgets and Alerts
author: Michael John Peña
draft: false
date: 2021-06-17
url: /blog/azure-cost-management-budgets/
tags:
  - Azure
  - Cost Management
  - FinOps
  - Governance

---

I wrote "2021-06-17-azure-cost-management-budgets" to share practical, production-minded guidance on this topic.

## Creating Budgets via Azure CLI

```bash
# Create monthly budget at subscription level
az consumption budget create \
  --budget-name "Monthly-Subscription-Budget" \
  --amount 10000 \
  --time-grain Monthly \
  --start-date "2021-06-01" \
  --end-date "2022-06-01" \
  --category Cost \
  --resource-group "" \
  --notifications "{
    \"Notification1\": {
      \"enabled\": true,
      \"operator\": \"GreaterThan\",
      \"threshold\": 80,
      \"contactEmails\": [\"finance@company.com\", \"ops@company.com\"],
      \"thresholdType\": \"Actual\"
    },
    \"Notification2\": {
      \"enabled\": true,
      \"operator\": \"GreaterThan\",
      \"threshold\": 100,
      \"contactEmails\": [\"finance@company.com\", \"ops@company.com\", \"cto@company.com\"],
      \"thresholdType\": \"Actual\"
    },
    \"Notification3\": {
      \"enabled\": true,
      \"operator\": \"GreaterThan\",
      \"threshold\": 100,
      \"contactEmails\": [\"finance@company.com\"],
      \"thresholdType\": \"Forecasted\"
    }
  }"

# Create budget for specific resource group
az consumption budget create \
  --budget-name "Development-RG-Budget" \
  --amount 1000 \
  --time-grain Monthly \
  --start-date "2021-06-01" \
  --end-date "2022-06-01" \
  --category Cost \
  --resource-group "rg-development" \
  --notifications "{
    \"OverBudget\": {
      \"enabled\": true,
      \"operator\": \"GreaterThan\",
      \"threshold\": 90,
      \"contactEmails\": [\"dev-lead@company.com\"]
    }
  }"
```

## Bicep Budget Definitions

```bicep
// budgets.bicep
targetScope = 'subscription'

@description('Monthly budget amount')
param budgetAmount int = 10000

@description('Budget start date')
param startDate string = '2021-06-01'

@description('Alert email addresses')
param alertEmails array = []

@description('Action group resource ID for automation')
param actionGroupId string = ''

resource monthlyBudget 'Microsoft.Consumption/budgets@2021-10-01' = {
  name: 'Monthly-Budget'
  properties: {
    category: 'Cost'
    amount: budgetAmount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
      endDate: '2025-12-31'
    }
    notifications: {
      Actual_80_Percent: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: alertEmails
        contactGroups: !empty(actionGroupId) ? [actionGroupId] : []
      }
      Actual_100_Percent: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: alertEmails
        contactGroups: !empty(actionGroupId) ? [actionGroupId] : []
      }
      Forecasted_100_Percent: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: alertEmails
      }
    }
  }
}

// Budget with filter for specific services
resource computeBudget 'Microsoft.Consumption/budgets@2021-10-01' = {
  name: 'Compute-Budget'
  properties: {
    category: 'Cost'
    amount: 5000
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
      endDate: '2025-12-31'
    }
    filter: {
      dimensions: {
        name: 'ServiceName'
        operator: 'In'
        values: [
          'Virtual Machines'
          'Virtual Machine Scale Sets'
        ]
      }
    }
    notifications: {
      HighCompute: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 90
        thresholdType: 'Actual'
        contactEmails: alertEmails
      }
    }
  }
}
```

## Budget-Triggered Automation

### Azure Function for Budget Alerts

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Azure.Identity;
using Azure.ResourceManager;
using Azure.ResourceManager.Compute;

public class BudgetAlertFunction
{
    private readonly ILogger<BudgetAlertFunction> _logger;

    public BudgetAlertFunction(ILogger<BudgetAlertFunction> logger)
    {
        _logger = logger;
    }

    [Function("BudgetAlertHandler")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestData req)
    {
        var alertData = await req.ReadFromJsonAsync<BudgetAlert>();

        _logger.LogInformation(
            "Budget alert received: {BudgetName}, Threshold: {Threshold}%, Current: {Current}",
            alertData.BudgetName,
            alertData.NotificationThresholdAmount,
            alertData.SpentAmount);

        // Check if we need to take action
        if (alertData.SpentAmount >= alertData.BudgetAmount * 0.95m)
        {
            // Critical threshold - stop non-essential resources
            await StopNonEssentialResourcesAsync(alertData.SubscriptionId);
        }
        else if (alertData.SpentAmount >= alertData.BudgetAmount * 0.80m)
        {
            // Warning threshold - scale down resources
            await ScaleDownResourcesAsync(alertData.SubscriptionId);
        }

        var response = req.CreateResponse(System.Net.HttpStatusCode.OK);
        await response.WriteAsJsonAsync(new { Status = "Processed" });
        return response;
    }

    private async Task StopNonEssentialResourcesAsync(string subscriptionId)
    {
        var armClient = new ArmClient(new DefaultAzureCredential());
        var subscription = await armClient.GetSubscriptions().GetAsync(subscriptionId);

        // Find VMs tagged as non-essential
        await foreach (var vm in subscription.Value.GetVirtualMachinesAsync())
        {
            if (vm.Data.Tags?.TryGetValue("Essential", out var value) == true &&
                value?.ToLower() == "false")
            {
                _logger.LogInformation("Stopping non-essential VM: {VmName}", vm.Data.Name);
                await vm.DeallocateAsync(Azure.WaitUntil.Started);
            }
        }
    }

    private async Task ScaleDownResourcesAsync(string subscriptionId)
    {
        var armClient = new ArmClient(new DefaultAzureCredential());
        var subscription = await armClient.GetSubscriptions().GetAsync(subscriptionId);

        // Scale down App Service Plans
        // Note: Simplified - actual implementation would need more logic
        _logger.LogInformation("Initiating scale-down for subscription: {SubId}", subscriptionId);
    }
}

public record BudgetAlert
{
    public string BudgetName { get; init; }
    public string SubscriptionId { get; init; }
    public decimal BudgetAmount { get; init; }
    public decimal SpentAmount { get; init; }
    public decimal NotificationThresholdAmount { get; init; }
}
```

### Logic App for Budget Response

```json
{
  "definition": {
    "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
    "contentVersion": "1.0.0.0",
    "triggers": {
      "When_a_HTTP_request_is_received": {
        "type": "Request",
        "kind": "Http",
        "inputs": {
          "schema": {
            "type": "object",
            "properties": {
              "budgetName": { "type": "string" },
              "notificationThresholdAmount": { "type": "number" },
              "spentAmount": { "type": "number" },
              "subscriptionId": { "type": "string" }
            }
          }
        }
      }
    },
    "actions": {
      "Check_Threshold": {
        "type": "If",
        "expression": {
          "and": [
            {
              "greaterOrEquals": [
                "@triggerBody()?['spentAmount']",
                "@mul(triggerBody()?['notificationThresholdAmount'], 0.9)"
              ]
            }
          ]
        },
        "actions": {
          "Send_Critical_Alert": {
            "type": "ApiConnection",
            "inputs": {
              "host": {
                "connection": {
                  "name": "@parameters('$connections')['teams']['connectionId']"
                }
              },
              "method": "post",
              "path": "/v3/teams/{teamId}/channels/{channelId}/messages",
              "body": {
                "body": {
                  "content": "CRITICAL: Budget @{triggerBody()?['budgetName']} has reached @{triggerBody()?['spentAmount']} of @{triggerBody()?['notificationThresholdAmount']}"
                }
              }
            }
          },
          "Create_PagerDuty_Incident": {
            "type": "Http",
            "inputs": {
              "method": "POST",
              "uri": "https://events.pagerduty.com/v2/enqueue",
              "headers": {
                "Content-Type": "application/json"
              },
              "body": {
                "routing_key": "@{parameters('pagerDutyKey')}",
                "event_action": "trigger",
                "payload": {
                  "summary": "Azure Budget Alert - Critical",
                  "severity": "critical",
                  "source": "Azure Cost Management"
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## Cost Analysis Queries

### PowerShell Cost Reporting

```powershell
# Get cost breakdown by service
function Get-MonthlyCostReport {
    param(
        [DateTime]$StartDate = (Get-Date).AddDays(-30),
        [DateTime]$EndDate = (Get-Date)
    )

    $subscriptionId = (Get-AzContext).Subscription.Id

    $query = @{
        type = "ActualCost"
        timeframe = "Custom"
        timePeriod = @{
            from = $StartDate.ToString("yyyy-MM-dd")
            to = $EndDate.ToString("yyyy-MM-dd")
        }
        dataset = @{
            granularity = "None"
            aggregation = @{
                totalCost = @{
                    name = "Cost"
                    function = "Sum"
                }
            }
            grouping = @(
                @{
                    type = "Dimension"
                    name = "ServiceName"
                }
            )
        }
    }

    $response = Invoke-AzRestMethod `
        -Path "/subscriptions/$subscriptionId/providers/Microsoft.CostManagement/query?api-version=2021-10-01" `
        -Method POST `
        -Payload ($query | ConvertTo-Json -Depth 10)

    $result = $response.Content | ConvertFrom-Json

    $costs = $result.properties.rows | ForEach-Object {
        [PSCustomObject]@{
            ServiceName = $_[1]
            Cost = [math]::Round($_[0], 2)
            Currency = $result.properties.columns[0].name
        }
    }

    return $costs | Sort-Object Cost -Descending
}

# Get cost trend
function Get-CostTrend {
    param(
        [int]$DaysBack = 30
    )

    $subscriptionId = (Get-AzContext).Subscription.Id

    $query = @{
        type = "ActualCost"
        timeframe = "Custom"
        timePeriod = @{
            from = (Get-Date).AddDays(-$DaysBack).ToString("yyyy-MM-dd")
            to = (Get-Date).ToString("yyyy-MM-dd")
        }
        dataset = @{
            granularity = "Daily"
            aggregation = @{
                totalCost = @{
                    name = "Cost"
                    function = "Sum"
                }
            }
        }
    }

    $response = Invoke-AzRestMethod `
        -Path "/subscriptions/$subscriptionId/providers/Microsoft.CostManagement/query?api-version=2021-10-01" `
        -Method POST `
        -Payload ($query | ConvertTo-Json -Depth 10)

    $result = $response.Content | ConvertFrom-Json

    return $result.properties.rows | ForEach-Object {
        [PSCustomObject]@{
            Date = $_[1]
            Cost = [math]::Round($_[0], 2)
        }
    }
}
```

## Cost Allocation Tags

### Enforcing Cost Center Tags

```bicep
// Tag policy assignment
targetScope = 'subscription'

resource requireCostCenterPolicy 'Microsoft.Authorization/policyAssignments@2021-06-01' = {
  name: 'require-costcenter-tag'
  properties: {
    displayName: 'Require CostCenter tag on resource groups'
    policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/96670d01-0a4d-4649-9c89-2d3abc0a5025'
    parameters: {
      tagName: {
        value: 'CostCenter'
      }
    }
    enforcementMode: 'Default'
  }
}

resource inheritTagPolicy 'Microsoft.Authorization/policyAssignments@2021-06-01' = {
  name: 'inherit-costcenter-tag'
  properties: {
    displayName: 'Inherit CostCenter tag from resource group'
    policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/cd3aa116-8754-49c9-a813-ad46512ece54'
    parameters: {
      tagName: {
        value: 'CostCenter'
      }
    }
    enforcementMode: 'Default'
  }
}
```

## Scheduled Cost Reports

### Azure Function for Weekly Reports

```csharp
[Function("WeeklyCostReport")]
public async Task Run(
    [TimerTrigger("0 0 8 * * MON")] TimerInfo timer)
{
    var costData = await _costService.GetWeeklyCostSummaryAsync();

    var report = new StringBuilder();
    report.AppendLine("# Weekly Azure Cost Report");
    report.AppendLine($"Period: {costData.StartDate:d} - {costData.EndDate:d}");
    report.AppendLine($"\n## Total Cost: ${costData.TotalCost:N2}");
    report.AppendLine($"Change from last week: {costData.PercentageChange:+0.0;-0.0}%");

    report.AppendLine("\n## Cost by Service");
    foreach (var service in costData.ServiceCosts.OrderByDescending(s => s.Cost).Take(10))
    {
        report.AppendLine($"- {service.ServiceName}: ${service.Cost:N2}");
    }

    report.AppendLine("\n## Budget Status");
    foreach (var budget in costData.BudgetStatus)
    {
        var percentage = (budget.Spent / budget.Amount) * 100;
        var status = percentage > 90 ? "CRITICAL" : percentage > 75 ? "WARNING" : "OK";
        report.AppendLine($"- {budget.Name}: ${budget.Spent:N2} of ${budget.Amount:N2} ({percentage:0}%) [{status}]");
    }

    await _emailService.SendReportAsync(
        "finance@company.com",
        "Weekly Azure Cost Report",
        report.ToString());
}
```

## Conclusion

Effective cost management requires proactive monitoring and automated responses. Azure Cost Management budgets provide the foundation for cost governance, while automation enables rapid response to spending anomalies. By combining budgets with alerts, tags, and automated actions, you can maintain cost control without sacrificing operational agility.

## References

- [Azure Cost Management Documentation](https://docs.microsoft.com/en-us/azure/cost-management-billing/)
- [Create and Manage Budgets](https://docs.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets)

