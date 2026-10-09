---
title: "Reserved Capacity Planning for Azure"
author: Michael John Peña
draft: false
date: 2022-12-20
tags:
  - Azure
  - Reserved Instances
  - Cost Optimization
  - Planning
  - FinOps
---

## Understanding Reserved Capacity

Azure offers reservations for:
- Virtual Machines
- Azure SQL Database
- Cosmos DB
- Storage
- Azure Synapse Analytics
- App Service
- Azure Databricks
- Azure Cache for Redis

## Commitment Options

| Term | Typical Savings | Best For |
|------|-----------------|----------|
| 1 Year | 20-40% | Moderate confidence in usage |
| 3 Year | 40-72% | Stable, predictable workloads |

## Analysis Framework

```python
from dataclasses import dataclass
from typing import List
import pandas as pd

@dataclass
class ResourceUsage:
    resource_type: str
    sku: str
    region: str
    monthly_hours: float
    monthly_cost: float

@dataclass
class ReservationRecommendation:
    resource_type: str
    sku: str
    region: str
    quantity: int
    term_years: int
    monthly_savings: float
    total_savings: float
    break_even_months: int
    confidence: str

class ReservationAnalyzer:
    # Approximate savings percentages
    SAVINGS = {
        "VirtualMachines": {"1yr": 0.35, "3yr": 0.55},
        "SqlDatabase": {"1yr": 0.30, "3yr": 0.50},
        "CosmosDB": {"1yr": 0.25, "3yr": 0.45},
    }

    def analyze(self, usage_data: List[ResourceUsage]) -> List[ReservationRecommendation]:
        """Analyze usage and generate reservation recommendations."""

        recommendations = []

        # Group by resource type, SKU, and region
        df = pd.DataFrame([vars(u) for u in usage_data])
        grouped = df.groupby(['resource_type', 'sku', 'region']).agg({
            'monthly_hours': 'mean',
            'monthly_cost': 'mean'
        }).reset_index()

        for _, row in grouped.iterrows():
            # Calculate uptime percentage
            max_hours = 730  # Hours in a month
            uptime_pct = row['monthly_hours'] / max_hours

            if uptime_pct < 0.5:
                continue  # Not a good candidate

            # Determine recommended term
            if uptime_pct > 0.9:
                term = 3
                confidence = "High"
            elif uptime_pct > 0.7:
                term = 1
                confidence = "Medium"
            else:
                term = 1
                confidence = "Low"

            # Calculate savings
            savings_key = f"{term}yr"
            savings_pct = self.SAVINGS.get(row['resource_type'], {}).get(savings_key, 0.20)

            monthly_savings = row['monthly_cost'] * savings_pct
            total_savings = monthly_savings * (term * 12)

            # Calculate break-even (accounting for upfront cost)
            upfront_cost = row['monthly_cost'] * (1 - savings_pct) * term * 12
            break_even = int(upfront_cost / monthly_savings) if monthly_savings > 0 else 999

            recommendations.append(ReservationRecommendation(
                resource_type=row['resource_type'],
                sku=row['sku'],
                region=row['region'],
                quantity=1,
                term_years=term,
                monthly_savings=monthly_savings,
                total_savings=total_savings,
                break_even_months=break_even,
                confidence=confidence
            ))

        return sorted(recommendations, key=lambda x: x.total_savings, reverse=True)
```

## VM Reservation Strategy

```python
def vm_reservation_strategy(vm_inventory: List[dict]) -> dict:
    """Create VM reservation purchase strategy."""

    strategy = {
        "immediate_purchase": [],
        "consider_carefully": [],
        "not_recommended": [],
        "total_monthly_savings": 0
    }

    for vm in vm_inventory:
        uptime = vm["uptime_percentage"]
        stability = vm["deployment_stability"]  # How long it's been running
        growth_trend = vm["growth_trend"]  # Increasing/stable/decreasing

        if uptime > 90 and stability == "stable" and growth_trend != "decreasing":
            # Strong candidate for 3-year reservation
            savings = calculate_savings(vm, term=3)
            strategy["immediate_purchase"].append({
                "vm": vm["name"],
                "sku": vm["sku"],
                "region": vm["region"],
                "term": "3 years",
                "monthly_savings": savings
            })
            strategy["total_monthly_savings"] += savings

        elif uptime > 70:
            # Consider 1-year reservation
            savings = calculate_savings(vm, term=1)
            strategy["consider_carefully"].append({
                "vm": vm["name"],
                "sku": vm["sku"],
                "reason": f"Uptime: {uptime}%, Trend: {growth_trend}",
                "potential_savings": savings
            })

        else:
            strategy["not_recommended"].append({
                "vm": vm["name"],
                "reason": f"Low uptime ({uptime}%) - use pay-as-you-go"
            })

    return strategy
```

## Database Reservation Considerations

```python
# Azure SQL Database reservation analysis
def analyze_sql_reservations(databases: List[dict]) -> dict:
    """Analyze Azure SQL databases for reservation opportunities."""

    recommendations = {
        "vcore_reservations": [],
        "dtu_to_vcore_migration": [],
        "elastic_pool_opportunities": []
    }

    # Group by vCore count
    vcore_groups = {}
    for db in databases:
        if db["pricing_model"] == "vCore":
            key = (db["vcore_count"], db["region"])
            vcore_groups.setdefault(key, []).append(db)

    for (vcores, region), dbs in vcore_groups.items():
        total_usage_hours = sum(db["monthly_hours"] for db in dbs)
        if total_usage_hours > 700 * len(dbs):  # >95% uptime average
            recommendations["vcore_reservations"].append({
                "vcores": vcores,
                "region": region,
                "database_count": len(dbs),
                "recommendation": "3-year reservation",
                "estimated_savings": "~55%"
            })

    return recommendations
```

## Cosmos DB Reserved Capacity

```python
def cosmos_db_reservation_analysis(containers: List[dict]) -> dict:
    """Analyze Cosmos DB for reserved throughput."""

    analysis = {
        "reserved_throughput_candidates": [],
        "autoscale_recommendations": [],
        "serverless_candidates": []
    }

    for container in containers:
        avg_rus = container["avg_ru_usage"]
        peak_rus = container["peak_ru_usage"]
        provisioned_rus = container["provisioned_ru"]

        utilization = avg_rus / provisioned_rus if provisioned_rus > 0 else 0

        if utilization > 0.7:
            # Good candidate for reserved throughput
            analysis["reserved_throughput_candidates"].append({
                "container": container["name"],
                "current_rus": provisioned_rus,
                "recommended_reserved": int(avg_rus * 1.2),  # 20% buffer
                "savings": "~25% (1yr) or ~45% (3yr)"
            })

        elif utilization < 0.3 and peak_rus > avg_rus * 3:
            # Highly variable - consider autoscale
            analysis["autoscale_recommendations"].append({
                "container": container["name"],
                "current_rus": provisioned_rus,
                "recommended": f"Autoscale {int(avg_rus)} - {int(peak_rus)}"
            })

        elif avg_rus < 1000:
            # Low usage - consider serverless
            analysis["serverless_candidates"].append({
                "container": container["name"],
                "avg_rus": avg_rus,
                "note": "Evaluate serverless option"
            })

    return analysis
```

## Reservation Management

### Flexibility Options

```yaml
reservation_flexibility:
  instance_size_flexibility:
    description: VMs in same series can share reservation
    example:
      - D2s_v3 reservation covers 1x D2s_v3
      - Same reservation covers 0.5x D4s_v3
      - Or 0.25x D8s_v3
    recommendation: Enable for all VM reservations

  scope_options:
    single_subscription:
      use_when: Clear cost allocation needed
      flexibility: Limited

    shared_scope:
      use_when: Multiple subscriptions, maximize utilization
      flexibility: High
      recommendation: Default choice for most organizations

    resource_group:
      use_when: Specific workload isolation
      flexibility: Limited
```

### Exchange and Refund Policies

```python
reservation_policies = {
    "exchange": {
        "allowed": True,
        "fee": "None",
        "restrictions": [
            "Must exchange for same type (VM for VM)",
            "New reservation must be equal or greater value",
            "Regional restrictions may apply"
        ]
    },
    "refund": {
        "allowed": True,
        "fee": "12% early termination fee",
        "limit": "$50,000 per rolling 12 months",
        "note": "Consider exchange instead of refund when possible"
    }
}
```

## Planning Calendar

```yaml
reservation_planning_calendar:
  january:
    - Analyze previous year's usage
    - Identify stable workloads
    - Plan Q1 purchases

  quarterly:
    - Review utilization of existing reservations
    - Assess new workloads for eligibility
    - Exchange underutilized reservations

  ongoing:
    - Monitor utilization dashboards
    - Track new Azure reservation offerings
    - Update forecasts based on business changes
```

## Conclusion

Reserved capacity offers significant savings but requires careful analysis. Focus on stable, predictable workloads with high utilization. Start with 1-year terms to build confidence, then move to 3-year terms for proven stable resources. Always maintain some pay-as-you-go capacity for flexibility.

## Resources

- [Azure Reservations](https://docs.microsoft.com/azure/cost-management-billing/reservations/)
- [VM Size Flexibility](https://docs.microsoft.com/azure/virtual-machines/reserved-vm-instance-size-flexibility)
- [Reservation Recommendations](https://docs.microsoft.com/azure/cost-management-billing/reservations/reserved-instance-purchase-recommendations)
