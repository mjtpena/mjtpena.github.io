---
title: "Azure Cost Management: Control Cloud Spending"
author: Michael John Peña
draft: false
date: 2020-11-07
tags:
  - Azure
  - Cost Management
  - FinOps
  - Governance
---

Every cloud bill story I've heard starts the same way: "we didn't realise it was running." A test VM left on over a long weekend, a Premium SSD attached to a stopped machine, an App Service plan sized for production hosting a forgotten staging slot. Cost Management is the dashboard that turns those surprises into something you can see *before* the invoice arrives. Analyse, budget, alert, and—just as importantly—give finance a view they can read without engineering translating.

## Cost Analysis

```bash
# Get current month costs
az consumption usage list \
    --start-date 2020-11-01 \
    --end-date 2020-11-07 \
    --query "[].{Name:instanceName, Cost:pretaxCost}" \
    --output table
```

## Budgets

```bash
# Create budget with alerts
az consumption budget create \
    --budget-name "Monthly-Limit" \
    --amount 10000 \
    --category Cost \
    --time-grain Monthly \
    --start-date 2020-11-01 \
    --end-date 2021-10-31 \
    --notifications '{
        "Actual_GreaterThan_80_Percent": {
            "enabled": true,
            "operator": "GreaterThan",
            "threshold": 80,
            "contactEmails": ["finance@company.com"],
            "contactRoles": ["Owner"]
        },
        "Forecasted_GreaterThan_100_Percent": {
            "enabled": true,
            "operator": "GreaterThan",
            "threshold": 100,
            "thresholdType": "Forecasted",
            "contactEmails": ["alerts@company.com"]
        }
    }'
```

## Cost Allocation Tags

```bash
# Tag resources for cost allocation
az tag create --resource-id /subscriptions/.../resourceGroups/myRG \
    --tags CostCenter=Engineering Project=Alpha Environment=Production

# Query costs by tag
az consumption usage list \
    --query "[?tags.CostCenter=='Engineering'].{Resource:instanceName, Cost:pretaxCost}"
```

## Azure Advisor Recommendations

```bash
# Get cost recommendations
az advisor recommendation list \
    --category Cost \
    --output table
```

Common recommendations:
- Right-size underutilized VMs
- Delete unattached disks
- Purchase reserved instances
- Use spot VMs for batch workloads

## Reserved Instances

Save up to 72% with 1-3 year commitments:

```bash
# View reservation recommendations
az consumption reservation recommendation list \
    --scope subscription \
    --look-back-period Last30Days

# Purchase reservation (via portal recommended)
```

| Term | Savings |
|------|---------|
| 1 Year | ~35% |
| 3 Year | ~60% |

## Spot VMs

```bash
# Create spot VM (up to 90% savings)
az vm create \
    --name mySpotVM \
    --resource-group myRG \
    --priority Spot \
    --eviction-policy Deallocate \
    --max-price 0.05 \
    --image UbuntuLTS
```

## Auto-Shutdown

```bash
# Schedule VM shutdown
az vm auto-shutdown \
    --resource-group myRG \
    --name myVM \
    --time 1800 \
    --timezone "Pacific Standard Time"
```

## Cost Export

```bash
# Export daily costs to storage
az costmanagement export create \
    --name DailyCostExport \
    --scope "/subscriptions/{sub-id}" \
    --storage-account mystorageaccount \
    --storage-container exports \
    --timeframe MonthToDate \
    --recurrence Daily \
    --schedule-status Active
```

## Power BI Integration

```powerquery
// Connect to Cost Management API
let
    Source = AzureCostManagement.Contents(
        "subscriptions/{subscription-id}",
        [
            Granularity = "Daily",
            GroupBy = {"ResourceGroup", "ServiceName"}
        ]
    )
in
    Source
```

## Cost-Saving Checklist

- [ ] Right-size VMs based on utilization
- [ ] Use reserved instances for steady workloads
- [ ] Use spot VMs for batch processing
- [ ] Auto-shutdown dev/test resources
- [ ] Delete unused resources
- [ ] Use appropriate storage tiers
- [ ] Implement resource lifecycle policies
- [ ] Set up budget alerts

Cost Management: visibility is the first step to optimization.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
