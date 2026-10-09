---
title: Optimizing Cloud Spend with Azure Cost Management
description: "Cloud bills have a way of arriving late and being everyone's problem at once. Cost Management is the tool that moves that conversation from quarterly shock…"
author: Michael John Peña
draft: false
date: 2021-02-25
url: /blog/azure-cost-management/
tags:
  - Azure
  - Cost Management
  - FinOps
  - Cloud Optimization
  - Governance
---

Cloud bills have a way of arriving late and being everyone's problem at once. Cost Management is the tool that moves that conversation from quarterly shock to ongoing discipline. Budgets with email and action group alerts, cost analysis filtered by tag and resource group, Advisor recommendations that surface the orphaned disks and undersized reserved instances. I keep a Cost Management view pinned in every client's Azure portal with a 30-day trend by service—five minutes a week is enough to catch drift before it becomes a conversation with the CFO.

## Understanding Your Costs

### Cost Analysis

```bash
# Get current month costs by resource group
az consumption usage list \
    --start-date 2021-02-01 \
    --end-date 2021-02-28 \
    --query "[].{ResourceGroup:instanceId, Cost:pretaxCost, Currency:currency}" \
    --output table

# Get costs by service
az consumption usage list \
    --start-date 2021-02-01 \
    --end-date 2021-02-28 \
    --query "[].{Service:consumedService, Cost:pretaxCost}" \
    --output table
```

### Cost Analysis API

```python
from azure.identity import DefaultAzureCredential
from azure.mgmt.costmanagement import CostManagementClient
from datetime import datetime, timedelta
import pandas as pd

credential = DefaultAzureCredential()
client = CostManagementClient(credential)

def get_cost_by_resource_group(subscription_id, start_date, end_date):
    """Get costs grouped by resource group."""

    scope = f"/subscriptions/{subscription_id}"

    query = {
        "type": "ActualCost",
        "timeframe": "Custom",
        "timePeriod": {
            "from": start_date.isoformat(),
            "to": end_date.isoformat()
        },
        "dataset": {
            "granularity": "Daily",
            "aggregation": {
                "totalCost": {
                    "name": "PreTaxCost",
                    "function": "Sum"
                }
            },
            "grouping": [
                {
                    "type": "Dimension",
                    "name": "ResourceGroup"
                }
            ]
        }
    }

    result = client.query.usage(scope, query)

    # Convert to DataFrame
    columns = [col.name for col in result.columns]
    data = [row for row in result.rows]

    return pd.DataFrame(data, columns=columns)

def get_cost_forecast(subscription_id, forecast_days=30):
    """Get cost forecast."""

    scope = f"/subscriptions/{subscription_id}"
    end_date = datetime.now() + timedelta(days=forecast_days)

    query = {
        "type": "ActualCost",
        "timeframe": "Custom",
        "timePeriod": {
            "from": datetime.now().isoformat(),
            "to": end_date.isoformat()
        },
        "dataset": {
            "granularity": "Daily",
            "aggregation": {
                "totalCost": {
                    "name": "PreTaxCost",
                    "function": "Sum"
                }
            }
        }
    }

    result = client.forecast.usage(scope, query)
    return result

# Usage
subscription_id = "your-subscription-id"
start_date = datetime(2021, 2, 1)
end_date = datetime(2021, 2, 28)

costs_df = get_cost_by_resource_group(subscription_id, start_date, end_date)
print(costs_df.sort_values('PreTaxCost', ascending=False).head(10))
```

## Budget Management

### Creating Budgets

```bash
# Create a monthly budget
az consumption budget create \
    --budget-name monthly-budget \
    --amount 10000 \
    --category cost \
    --time-grain monthly \
    --start-date 2021-02-01 \
    --end-date 2021-12-31 \
    --resource-group rg-production

# Create budget with alerts
az consumption budget create \
    --budget-name production-budget \
    --amount 5000 \
    --category cost \
    --time-grain monthly \
    --start-date 2021-02-01 \
    --end-date 2021-12-31 \
    --resource-group rg-production \
    --notifications '{
        "Actual_GreaterThan_80_Percent": {
            "enabled": true,
            "operator": "GreaterThan",
            "threshold": 80,
            "contactEmails": ["finance@company.com"],
            "thresholdType": "Actual"
        },
        "Forecasted_GreaterThan_100_Percent": {
            "enabled": true,
            "operator": "GreaterThan",
            "threshold": 100,
            "contactEmails": ["finance@company.com", "ops@company.com"],
            "thresholdType": "Forecasted"
        }
    }'
```

### Budget ARM Template

```json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "budgetName": {
            "type": "string",
            "defaultValue": "department-budget"
        },
        "amount": {
            "type": "int",
            "defaultValue": 10000
        },
        "contactEmails": {
            "type": "array"
        }
    },
    "resources": [
        {
            "type": "Microsoft.Consumption/budgets",
            "apiVersion": "2021-10-01",
            "name": "[parameters('budgetName')]",
            "properties": {
                "category": "Cost",
                "amount": "[parameters('amount')]",
                "timeGrain": "Monthly",
                "timePeriod": {
                    "startDate": "2021-02-01",
                    "endDate": "2021-12-31"
                },
                "notifications": {
                    "Actual_GreaterThan_80_Percent": {
                        "enabled": true,
                        "operator": "GreaterThan",
                        "threshold": 80,
                        "thresholdType": "Actual",
                        "contactEmails": "[parameters('contactEmails')]"
                    },
                    "Forecasted_GreaterThan_100_Percent": {
                        "enabled": true,
                        "operator": "GreaterThan",
                        "threshold": 100,
                        "thresholdType": "Forecasted",
                        "contactEmails": "[parameters('contactEmails')]",
                        "contactRoles": ["Owner", "Contributor"]
                    }
                }
            }
        }
    ]
}
```

## Cost Allocation with Tags

```bash
# Tag resources for cost allocation
az resource tag \
    --tags CostCenter=Engineering Project=Analytics Environment=Production \
    --ids "/subscriptions/{sub-id}/resourceGroups/rg-analytics"

# Query costs by tag
# Use Cost Analysis in portal or API with tag filters
```

### Enforce Tags with Azure Policy

```json
{
    "mode": "Indexed",
    "policyRule": {
        "if": {
            "anyOf": [
                {
                    "field": "tags['CostCenter']",
                    "exists": "false"
                },
                {
                    "field": "tags['Project']",
                    "exists": "false"
                }
            ]
        },
        "then": {
            "effect": "deny"
        }
    }
}
```

## Cost Optimization Recommendations

### Advisor Cost Recommendations

```python
from azure.mgmt.advisor import AdvisorManagementClient

def get_cost_recommendations(subscription_id):
    """Get Azure Advisor cost recommendations."""

    credential = DefaultAzureCredential()
    client = AdvisorManagementClient(credential, subscription_id)

    recommendations = client.recommendations.list(
        filter="Category eq 'Cost'"
    )

    cost_savings = []
    for rec in recommendations:
        if rec.extended_properties:
            savings = rec.extended_properties.get('annualSavingsAmount', 0)
            cost_savings.append({
                'resource': rec.impacted_value,
                'recommendation': rec.short_description.problem,
                'solution': rec.short_description.solution,
                'annual_savings': float(savings),
                'impact': rec.impact
            })

    return sorted(cost_savings, key=lambda x: x['annual_savings'], reverse=True)

# Usage
recommendations = get_cost_recommendations(subscription_id)
for rec in recommendations[:10]:
    print(f"Resource: {rec['resource']}")
    print(f"  Recommendation: {rec['recommendation']}")
    print(f"  Annual Savings: ${rec['annual_savings']:,.2f}")
    print()
```

### Identify Unused Resources

```kusto
// Find idle VMs (low CPU usage)
Perf
| where TimeGenerated > ago(7d)
| where ObjectName == "Processor" and CounterName == "% Processor Time"
| summarize AvgCPU = avg(CounterValue), MaxCPU = max(CounterValue) by Computer
| where AvgCPU < 5 and MaxCPU < 20
| project Computer, AvgCPU, MaxCPU, Recommendation = "Consider downsizing or deallocating"

// Find unattached disks
resources
| where type == "microsoft.compute/disks"
| where properties.diskState == "Unattached"
| project name, resourceGroup, location, sku = properties.sku.name, sizeGB = properties.diskSizeGB

// Find old snapshots
resources
| where type == "microsoft.compute/snapshots"
| extend createdDate = todatetime(properties.timeCreated)
| where createdDate < ago(30d)
| project name, resourceGroup, createdDate, sizeGB = properties.diskSizeGB
```

## Automation for Cost Control

### Auto-shutdown VMs

```python
from azure.mgmt.compute import ComputeManagementClient
from azure.mgmt.devtestlabs import DevTestLabsClient
import schedule
import time

def shutdown_dev_vms():
    """Shutdown development VMs outside business hours."""

    credential = DefaultAzureCredential()
    compute_client = ComputeManagementClient(credential, subscription_id)

    # Get VMs with Environment=Development tag
    vms = compute_client.virtual_machines.list_all()

    for vm in vms:
        if vm.tags and vm.tags.get('Environment') == 'Development':
            # Get VM status
            status = compute_client.virtual_machines.instance_view(
                vm.id.split('/')[4],  # resource group
                vm.name
            )

            # Check if running
            for stat in status.statuses:
                if 'running' in stat.code.lower():
                    print(f"Deallocating VM: {vm.name}")
                    compute_client.virtual_machines.begin_deallocate(
                        vm.id.split('/')[4],
                        vm.name
                    )

# Schedule shutdown at 7 PM
schedule.every().day.at("19:00").do(shutdown_dev_vms)

while True:
    schedule.run_pending()
    time.sleep(60)
```

### Right-size Recommendations

```python
def get_rightsizing_recommendations():
    """Analyze VM utilization and recommend right-sizing."""

    # Query metrics for all VMs
    query = """
    Perf
    | where TimeGenerated > ago(14d)
    | where ObjectName == "Processor" or ObjectName == "Memory"
    | summarize
        AvgCPU = avgif(CounterValue, ObjectName == "Processor"),
        MaxCPU = maxif(CounterValue, ObjectName == "Processor"),
        AvgMemory = avgif(CounterValue, ObjectName == "Memory" and CounterName == "% Committed Bytes In Use"),
        MaxMemory = maxif(CounterValue, ObjectName == "Memory" and CounterName == "% Committed Bytes In Use")
        by Computer
    """

    # Execute query and analyze results
    results = execute_log_query(query)

    recommendations = []
    for row in results:
        if row['AvgCPU'] < 20 and row['MaxCPU'] < 50 and row['AvgMemory'] < 50:
            recommendations.append({
                'vm': row['Computer'],
                'avgCPU': row['AvgCPU'],
                'avgMemory': row['AvgMemory'],
                'recommendation': 'Consider downsizing - consistently underutilized'
            })
        elif row['AvgCPU'] > 80 or row['AvgMemory'] > 80:
            recommendations.append({
                'vm': row['Computer'],
                'avgCPU': row['AvgCPU'],
                'avgMemory': row['AvgMemory'],
                'recommendation': 'Consider upsizing - consistently high utilization'
            })

    return recommendations
```

## Cost Reporting

```python
import matplotlib.pyplot as plt
from datetime import datetime, timedelta

def generate_cost_report(subscription_id):
    """Generate monthly cost report."""

    # Get costs for last 6 months
    costs_by_month = []
    for i in range(6):
        start_date = datetime.now().replace(day=1) - timedelta(days=30*i)
        end_date = (start_date + timedelta(days=32)).replace(day=1) - timedelta(days=1)

        df = get_cost_by_resource_group(subscription_id, start_date, end_date)
        total_cost = df['PreTaxCost'].sum()

        costs_by_month.append({
            'month': start_date.strftime('%Y-%m'),
            'cost': total_cost
        })

    # Create visualization
    months = [c['month'] for c in costs_by_month]
    costs = [c['cost'] for c in costs_by_month]

    plt.figure(figsize=(10, 6))
    plt.bar(months, costs)
    plt.xlabel('Month')
    plt.ylabel('Cost ($)')
    plt.title('Monthly Azure Costs')
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.savefig('cost_report.png')

    return costs_by_month
```

## Best Practices

1. **Implement tagging strategy** for cost allocation
2. **Set up budgets with alerts** for all subscriptions
3. **Review Advisor recommendations** regularly
4. **Use auto-shutdown** for non-production resources
5. **Consider Reserved Instances** for predictable workloads
6. **Monitor and optimize** storage costs
7. **Right-size resources** based on actual utilization

## Conclusion

Azure Cost Management provides the tools needed to understand, allocate, and optimize cloud spending. By implementing budgets, tagging, and automated optimization, you can maintain control over costs while maximizing the value of your cloud investment.

Start with visibility through cost analysis, then progressively implement budgets, alerts, and optimization automation.
