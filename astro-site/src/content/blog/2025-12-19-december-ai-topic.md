---
title: "The Ultimate Azure Cost Optimization Checklist for 2026"
author: Michael John Peña
draft: false
date: 2025-12-19
tags:
  - Azure
  - Cost-Optimization
  - FinOps
  - Best-Practices
  - Cloud

---

I wrote "The Ultimate Azure Cost Optimization Checklist for 2026" to share practical, production-minded guidance on this topic.

## Compute Optimization

### Virtual Machines

```bash
# Find underutilized VMs (Azure CLI)
az monitor metrics list \
  --resource /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Compute/virtualMachines/{vm} \
  --metric "Percentage CPU" \
  --interval PT1H \
  --aggregation Average \
  --start-time $(date -d '7 days ago' -Iseconds) \
  --query "value[].timeseries[].data[].average" \
  | jq 'map(select(. < 10)) | length'
```

**Actions:**
- [ ] Right-size VMs based on actual usage
- [ ] Use Reserved Instances for predictable workloads (save up to 72%)
- [ ] Implement auto-shutdown for dev/test environments
- [ ] Use Spot VMs for fault-tolerant workloads

### Azure Kubernetes Service

```yaml
# Implement cluster autoscaler
apiVersion: v1
kind: ConfigMap
metadata:
  name: cluster-autoscaler-config
data:
  scale-down-delay-after-add: "10m"
  scale-down-unneeded-time: "10m"
  scale-down-utilization-threshold: "0.5"
```

**Actions:**
- [ ] Enable cluster autoscaler
- [ ] Use node pool autoscaling
- [ ] Implement KEDA for scale-to-zero
- [ ] Use spot node pools for batch workloads

## Storage Optimization

```python
# Lifecycle management policy
lifecycle_policy = {
    "rules": [
        {
            "name": "MoveToArchive",
            "type": "Lifecycle",
            "definition": {
                "filters": {"blobTypes": ["blockBlob"]},
                "actions": {
                    "baseBlob": {
                        "tierToCool": {"daysAfterModificationGreaterThan": 30},
                        "tierToArchive": {"daysAfterModificationGreaterThan": 90},
                        "delete": {"daysAfterModificationGreaterThan": 365}
                    }
                }
            }
        }
    ]
}
```

**Actions:**
- [ ] Implement tiering policies (Hot to Cool to Archive)
- [ ] Enable soft delete with appropriate retention
- [ ] Use reserved capacity for predictable storage
- [ ] Delete orphaned disks and snapshots

## Database Optimization

```sql
-- Identify unused indexes (Azure SQL)
SELECT
    OBJECT_NAME(i.object_id) AS TableName,
    i.name AS IndexName,
    ius.user_seeks + ius.user_scans + ius.user_lookups AS TotalReads,
    ius.user_updates AS TotalWrites
FROM sys.indexes i
LEFT JOIN sys.dm_db_index_usage_stats ius
    ON i.object_id = ius.object_id AND i.index_id = ius.index_id
WHERE OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
    AND (ius.user_seeks + ius.user_scans + ius.user_lookups) = 0
ORDER BY ius.user_updates DESC;
```

**Actions:**
- [ ] Use serverless tier for variable workloads
- [ ] Enable auto-pause for dev/test
- [ ] Right-size DTUs/vCores based on metrics
- [ ] Use elastic pools for multiple databases

## AI/ML Cost Control

```python
class AIBudgetController:
    def __init__(self, daily_budget: float):
        self.daily_budget = daily_budget
        self.today_spend = 0

    async def check_budget(self, estimated_cost: float) -> bool:
        if self.today_spend + estimated_cost > self.daily_budget:
            await self.alert_budget_exceeded()
            return False
        return True

    def record_spend(self, tokens: int, model: str):
        cost = self.calculate_cost(tokens, model)
        self.today_spend += cost
```

**Actions:**
- [ ] Implement token budgets per user/application
- [ ] Use GPT-4o-mini where GPT-4 isn't necessary
- [ ] Cache common responses
- [ ] Monitor and alert on cost anomalies

## Governance

- [ ] Implement Azure Policy for cost constraints
- [ ] Use cost allocation tags
- [ ] Set up budget alerts
- [ ] Review costs weekly

Start the new year with optimized cloud spend. These changes compound over time into significant savings.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
