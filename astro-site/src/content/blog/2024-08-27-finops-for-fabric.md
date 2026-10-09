---
title: "FinOps for Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-08-27
tags:
  - Microsoft Fabric
  - FinOps
  - Cost Optimization
  - Cloud Economics
  - Governance
---

## FinOps Framework for Fabric

```
FinOps Lifecycle:
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│         ┌─────────────┐                                     │
│         │   INFORM    │ ◄── Visibility, Allocation,        │
│         └──────┬──────┘     Benchmarking                    │
│                │                                             │
│                ▼                                             │
│         ┌─────────────┐                                     │
│         │  OPTIMIZE   │ ◄── Right-sizing, Scheduling,       │
│         └──────┬──────┘     Efficiency                      │
│                │                                             │
│                ▼                                             │
│         ┌─────────────┐                                     │
│         │   OPERATE   │ ◄── Budgets, Policies,              │
│         └──────┬──────┘     Automation                      │
│                │                                             │
│                └──────────────► (continuous cycle)          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Phase 1: Inform

### Cost Visibility

```python
class FabricFinOpsInform:
    """FinOps Inform phase - visibility and allocation."""

    def __init__(self, capacity_id: str):
        self.capacity_id = capacity_id
        self.cost_data = []

    def build_cost_taxonomy(self) -> dict:
        """Define cost categories for Fabric."""

        return {
            "compute": {
                "description": "Capacity-based compute costs",
                "components": [
                    "Base capacity (SKU)",
                    "Burst usage",
                    "Spark clusters",
                    "Data warehouse compute"
                ],
                "driver": "Capacity Units (CUs)"
            },
            "storage": {
                "description": "OneLake storage costs",
                "components": [
                    "Active data",
                    "Soft-deleted data",
                    "Snapshots/versions"
                ],
                "driver": "GB stored"
            },
            "egress": {
                "description": "Data transfer costs",
                "components": [
                    "Cross-region",
                    "External downloads"
                ],
                "driver": "GB transferred"
            }
        }

    def allocate_costs(
        self,
        total_cost: float,
        workload_usage: dict
    ) -> dict:
        """Allocate costs to business units/projects."""

        total_usage = sum(workload_usage.values())

        allocations = {}
        for workload, usage in workload_usage.items():
            percentage = (usage / total_usage * 100) if total_usage > 0 else 0
            allocated = total_cost * (usage / total_usage) if total_usage > 0 else 0

            allocations[workload] = {
                "usage_cu_hours": usage,
                "percentage": percentage,
                "allocated_cost": allocated
            }

        return {
            "total_cost": total_cost,
            "allocations": allocations,
            "unallocated": 0
        }

    def calculate_unit_economics(
        self,
        total_cost: float,
        business_metrics: dict
    ) -> dict:
        """Calculate cost per business metric."""

        return {
            "cost_per_query": total_cost / business_metrics.get("queries_executed", 1),
            "cost_per_report": total_cost / business_metrics.get("reports_refreshed", 1),
            "cost_per_gb_processed": total_cost / business_metrics.get("gb_processed", 1),
            "cost_per_active_user": total_cost / business_metrics.get("active_users", 1)
        }

    def benchmark_costs(self, current_metrics: dict) -> dict:
        """Benchmark against industry standards."""

        # Industry benchmarks (illustrative)
        benchmarks = {
            "cost_per_gb_processed": {"low": 0.01, "median": 0.05, "high": 0.15},
            "cost_per_active_user": {"low": 10, "median": 50, "high": 150}
        }

        comparisons = {}
        for metric, value in current_metrics.items():
            if metric in benchmarks:
                if value <= benchmarks[metric]["low"]:
                    status = "excellent"
                elif value <= benchmarks[metric]["median"]:
                    status = "good"
                elif value <= benchmarks[metric]["high"]:
                    status = "acceptable"
                else:
                    status = "needs_improvement"

                comparisons[metric] = {
                    "current": value,
                    "benchmark_median": benchmarks[metric]["median"],
                    "status": status
                }

        return comparisons

# Usage
inform = FabricFinOpsInform("capacity-123")

# Allocate costs
allocation = inform.allocate_costs(
    total_cost=10000,
    workload_usage={
        "Sales Analytics": 400,
        "Finance Reporting": 250,
        "Marketing ETL": 200,
        "Data Science": 150
    }
)

print("Cost Allocation:")
for workload, details in allocation["allocations"].items():
    print(f"  {workload}: ${details['allocated_cost']:.2f} ({details['percentage']:.1f}%)")

# Calculate unit economics
unit_economics = inform.calculate_unit_economics(
    total_cost=10000,
    business_metrics={
        "queries_executed": 50000,
        "reports_refreshed": 500,
        "gb_processed": 10000,
        "active_users": 200
    }
)

print(f"\nCost per query: ${unit_economics['cost_per_query']:.4f}")
print(f"Cost per active user: ${unit_economics['cost_per_active_user']:.2f}")
```

## Phase 2: Optimize

### Optimization Framework

```python
class FabricFinOpsOptimize:
    """FinOps Optimize phase - efficiency and right-sizing."""

    def __init__(self):
        self.optimization_opportunities = []

    def identify_waste(self, usage_data: dict) -> list:
        """Identify waste and inefficiency."""

        waste_items = []

        # Check for idle capacity
        if usage_data.get("avg_utilization", 100) < 30:
            waste_items.append({
                "type": "idle_capacity",
                "description": "Average utilization below 30%",
                "impact": "high",
                "action": "Consider downsizing capacity",
                "estimated_savings_percent": 100 - usage_data.get("avg_utilization", 100) * 2
            })

        # Check for unused workspaces
        for workspace in usage_data.get("workspaces", []):
            if workspace.get("days_since_activity", 0) > 30:
                waste_items.append({
                    "type": "unused_workspace",
                    "description": f"Workspace '{workspace['name']}' inactive for 30+ days",
                    "impact": "medium",
                    "action": "Review and potentially archive"
                })

        # Check for oversized datasets
        for dataset in usage_data.get("datasets", []):
            if dataset.get("refresh_frequency", "daily") == "daily" and \
               dataset.get("query_frequency", 100) < 10:
                waste_items.append({
                    "type": "over_refreshed_dataset",
                    "description": f"Dataset '{dataset['name']}' refreshed daily but rarely queried",
                    "impact": "medium",
                    "action": "Reduce refresh frequency"
                })

        return waste_items

    def recommend_rightsizing(self, current_config: dict) -> dict:
        """Recommend capacity right-sizing."""

        current_sku = current_config.get("sku", "F64")
        peak_usage = current_config.get("peak_cu_usage", 50)
        avg_usage = current_config.get("avg_cu_usage", 30)
        p95_usage = current_config.get("p95_cu_usage", 45)

        sku_cus = {
            "F8": 8, "F16": 16, "F32": 32, "F64": 64, "F128": 128
        }

        current_cus = sku_cus.get(current_sku, 64)

        # Recommend based on P95
        recommended_sku = current_sku
        for sku, cus in sorted(sku_cus.items(), key=lambda x: x[1]):
            if cus >= p95_usage * 1.2:  # 20% headroom
                recommended_sku = sku
                break

        return {
            "current_sku": current_sku,
            "current_cus": current_cus,
            "recommended_sku": recommended_sku,
            "recommended_cus": sku_cus.get(recommended_sku, current_cus),
            "analysis": {
                "avg_usage": avg_usage,
                "peak_usage": peak_usage,
                "p95_usage": p95_usage,
                "current_headroom_percent": (current_cus - peak_usage) / current_cus * 100
            }
        }

    def calculate_optimization_roi(
        self,
        optimization: dict,
        implementation_cost: float
    ) -> dict:
        """Calculate ROI for an optimization."""

        monthly_savings = optimization.get("estimated_monthly_savings", 0)
        payback_months = implementation_cost / monthly_savings if monthly_savings > 0 else float('inf')

        return {
            "optimization": optimization.get("description"),
            "monthly_savings": monthly_savings,
            "implementation_cost": implementation_cost,
            "payback_months": payback_months,
            "one_year_roi": (monthly_savings * 12 - implementation_cost) / implementation_cost * 100 if implementation_cost > 0 else 0,
            "recommendation": "Implement" if payback_months < 6 else "Evaluate" if payback_months < 12 else "Defer"
        }

# Usage
optimize = FabricFinOpsOptimize()

# Identify waste
waste = optimize.identify_waste({
    "avg_utilization": 25,
    "workspaces": [
        {"name": "Old Project", "days_since_activity": 45},
        {"name": "Active Project", "days_since_activity": 1}
    ],
    "datasets": [
        {"name": "Legacy Report", "refresh_frequency": "daily", "query_frequency": 5}
    ]
})

print("Waste Identified:")
for item in waste:
    print(f"  [{item['impact'].upper()}] {item['description']}")

# Rightsizing recommendation
rightsizing = optimize.recommend_rightsizing({
    "sku": "F64",
    "peak_cu_usage": 45,
    "avg_cu_usage": 25,
    "p95_cu_usage": 38
})

print(f"\nRightsizing: {rightsizing['current_sku']} -> {rightsizing['recommended_sku']}")
```

## Phase 3: Operate

### Governance and Automation

```python
class FabricFinOpsOperate:
    """FinOps Operate phase - governance and automation."""

    def __init__(self, monthly_budget: float):
        self.monthly_budget = monthly_budget
        self.policies = []

    def define_cost_policy(
        self,
        name: str,
        description: str,
        condition: str,
        action: str
    ):
        """Define a cost governance policy."""

        self.policies.append({
            "name": name,
            "description": description,
            "condition": condition,
            "action": action
        })

    def evaluate_policies(self, current_state: dict) -> list:
        """Evaluate policies against current state."""

        violations = []

        for policy in self.policies:
            # Simplified policy evaluation
            if policy["name"] == "budget_threshold":
                if current_state.get("current_spend", 0) > self.monthly_budget * 0.9:
                    violations.append({
                        "policy": policy["name"],
                        "violation": "Spending exceeds 90% of budget",
                        "recommended_action": policy["action"]
                    })

            elif policy["name"] == "idle_resources":
                if current_state.get("avg_utilization", 100) < 20:
                    violations.append({
                        "policy": policy["name"],
                        "violation": "Utilization below 20%",
                        "recommended_action": policy["action"]
                    })

        return violations

    def automate_cost_actions(self, action: str, parameters: dict) -> dict:
        """Automate cost optimization actions."""

        automation_actions = {
            "pause_capacity": {
                "description": "Pause Fabric capacity during off-hours",
                "implementation": "Azure Automation runbook",
                "schedule": parameters.get("pause_schedule", "weekends")
            },
            "scale_down": {
                "description": "Scale down capacity to lower SKU",
                "implementation": "API call to Azure Resource Manager",
                "target_sku": parameters.get("target_sku", "F32")
            },
            "alert_stakeholders": {
                "description": "Send cost alert to stakeholders",
                "implementation": "Email/Teams notification",
                "recipients": parameters.get("recipients", [])
            }
        }

        return automation_actions.get(action, {"error": "Unknown action"})

    def generate_finops_scorecard(
        self,
        metrics: dict
    ) -> dict:
        """Generate FinOps maturity scorecard."""

        scores = {
            "visibility": self._score_visibility(metrics),
            "allocation": self._score_allocation(metrics),
            "optimization": self._score_optimization(metrics),
            "governance": self._score_governance(metrics)
        }

        overall = sum(scores.values()) / len(scores)

        return {
            "scores": scores,
            "overall_score": overall,
            "maturity_level": (
                "Crawl" if overall < 40
                else "Walk" if overall < 70
                else "Run"
            ),
            "recommendations": self._generate_recommendations(scores)
        }

    def _score_visibility(self, metrics: dict) -> int:
        score = 0
        if metrics.get("has_cost_dashboard"): score += 25
        if metrics.get("has_daily_tracking"): score += 25
        if metrics.get("has_forecasting"): score += 25
        if metrics.get("has_anomaly_detection"): score += 25
        return score

    def _score_allocation(self, metrics: dict) -> int:
        score = 0
        if metrics.get("has_tagging"): score += 25
        if metrics.get("allocation_coverage", 0) > 90: score += 25
        if metrics.get("has_showback"): score += 25
        if metrics.get("has_chargeback"): score += 25
        return score

    def _score_optimization(self, metrics: dict) -> int:
        score = 0
        if metrics.get("utilization", 0) > 60: score += 25
        if metrics.get("has_rightsizing_reviews"): score += 25
        if metrics.get("has_waste_elimination"): score += 25
        if metrics.get("has_automation"): score += 25
        return score

    def _score_governance(self, metrics: dict) -> int:
        score = 0
        if metrics.get("has_budget"): score += 25
        if metrics.get("has_policies"): score += 25
        if metrics.get("has_alerts"): score += 25
        if metrics.get("has_regular_reviews"): score += 25
        return score

    def _generate_recommendations(self, scores: dict) -> list:
        recs = []
        for area, score in scores.items():
            if score < 50:
                recs.append(f"Improve {area} practices (current score: {score})")
        return recs

# Usage
operate = FabricFinOpsOperate(monthly_budget=10000)

# Define policies
operate.define_cost_policy(
    "budget_threshold",
    "Alert when spending exceeds 90% of budget",
    "current_spend > budget * 0.9",
    "Send alert to finance team"
)

operate.define_cost_policy(
    "idle_resources",
    "Flag underutilized capacity",
    "avg_utilization < 20%",
    "Review for downsizing"
)

# Evaluate
violations = operate.evaluate_policies({
    "current_spend": 9500,
    "avg_utilization": 15
})

for v in violations:
    print(f"Policy violation: {v['policy']} - {v['violation']}")

# Generate scorecard
scorecard = operate.generate_finops_scorecard({
    "has_cost_dashboard": True,
    "has_daily_tracking": True,
    "has_forecasting": False,
    "has_anomaly_detection": False,
    "has_tagging": True,
    "allocation_coverage": 85,
    "has_showback": True,
    "has_chargeback": False,
    "utilization": 65,
    "has_rightsizing_reviews": True,
    "has_waste_elimination": False,
    "has_automation": False,
    "has_budget": True,
    "has_policies": True,
    "has_alerts": True,
    "has_regular_reviews": False
})

print(f"\nFinOps Maturity: {scorecard['maturity_level']} (Score: {scorecard['overall_score']:.0f})")
```

## FinOps Team Structure

```python
finops_team = {
    "roles": {
        "finops_practitioner": {
            "responsibilities": [
                "Monitor costs daily",
                "Identify optimization opportunities",
                "Maintain cost dashboards",
                "Coordinate with stakeholders"
            ],
            "skills": ["Cost analysis", "Cloud pricing", "Data visualization"]
        },
        "engineering_liaison": {
            "responsibilities": [
                "Implement optimizations",
                "Review architecture for efficiency",
                "Automate cost controls"
            ],
            "skills": ["Fabric development", "Automation", "Performance tuning"]
        },
        "finance_partner": {
            "responsibilities": [
                "Set budgets",
                "Approve allocations",
                "Report to leadership"
            ],
            "skills": ["Financial analysis", "Budgeting", "Reporting"]
        }
    },
    "cadence": {
        "daily": "Review cost anomalies",
        "weekly": "Optimization review meeting",
        "monthly": "Budget vs actual review",
        "quarterly": "FinOps maturity assessment"
    }
}
```

## Best Practices

1. **Start with visibility**: You can't optimize what you can't see
2. **Allocate costs**: Enable accountability through showback/chargeback
3. **Automate policies**: Reduce manual overhead
4. **Measure continuously**: Track FinOps maturity over time
5. **Collaborate**: FinOps requires engineering, finance, and business alignment

## Conclusion

FinOps for Microsoft Fabric brings cloud financial management best practices to your analytics platform. The Inform-Optimize-Operate cycle ensures continuous improvement in cost efficiency while maintaining performance.

Start with visibility, progress to optimization, and mature into automated governance for maximum value from your Fabric investment.
