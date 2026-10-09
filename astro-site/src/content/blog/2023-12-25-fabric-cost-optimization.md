---
title: "Cost Optimization in Microsoft Fabric"
description: "Cost optimisation isn't about cutting features — it's about aligning spend with business value. During holiday slowdowns I help teams identify idle…"
author: "Michael John Peña"
draft: false
date: 2023-12-25
tags: ["Microsoft Fabric", "Cost Optimization", "FinOps", "Cost Management", "Cloud Economics"]
---

Cost optimisation isn't about cutting features — it's about aligning spend with business value. During holiday slowdowns I help teams identify idle capacities, ineffective autoscale rules, and costly query patterns. These tactics reduce spend immediately without harming throughput.

## Understanding Fabric Costs

## Understanding Fabric Costs

```python
from dataclasses import dataclass
from typing import List, Dict

@dataclass
class CostCategory:
    category: str
    description: str
    cost_drivers: List[str]
    optimization_strategies: List[str]

fabric_cost_categories = {
    "compute": CostCategory(
        category="Compute (Capacity Units)",
        description="Primary cost driver - Spark and SQL compute",
        cost_drivers=[
            "Number of concurrent jobs",
            "Job duration",
            "Cluster size",
            "Always-on vs on-demand"
        ],
        optimization_strategies=[
            "Right-size capacity SKU",
            "Schedule jobs during off-peak",
            "Optimize query performance",
            "Use reserved capacity for predictable workloads"
        ]
    ),
    "storage": CostCategory(
        category="Storage (OneLake)",
        description="Data storage costs",
        cost_drivers=[
            "Data volume",
            "Data retention",
            "Redundancy requirements",
            "Snapshot history"
        ],
        optimization_strategies=[
            "Implement data lifecycle policies",
            "Compress data appropriately",
            "Clean up unused tables",
            "Manage Delta log retention"
        ]
    ),
    "egress": CostCategory(
        category="Data Egress",
        description="Data leaving Azure/Fabric",
        cost_drivers=[
            "Cross-region queries",
            "External tool access",
            "Data exports"
        ],
        optimization_strategies=[
            "Keep compute and data in same region",
            "Minimize external data access",
            "Use shortcuts instead of copying"
        ]
    )
}
```

## Cost Optimization Strategies

```python
class CostOptimizer:
    """Fabric cost optimization toolkit."""

    def analyze_capacity_efficiency(self, usage_data: List[Dict]) -> Dict:
        """Analyze capacity efficiency."""
        total_hours = len(usage_data)
        utilized_hours = sum(1 for u in usage_data if u.get("utilization", 0) > 10)

        efficiency = (utilized_hours / total_hours * 100) if total_hours > 0 else 0

        recommendations = []
        if efficiency < 30:
            recommendations.append("Very low utilization - consider smaller SKU or pay-as-you-go")
        elif efficiency < 50:
            recommendations.append("Moderate utilization - consider scheduling workloads together")

        return {
            "total_hours": total_hours,
            "utilized_hours": utilized_hours,
            "efficiency_percent": efficiency,
            "recommendations": recommendations
        }

    def calculate_reserved_savings(self, current_monthly: float, utilization: float) -> Dict:
        """Calculate potential savings from reserved capacity."""
        # Reserved capacity is ~50% cheaper but requires commitment
        reserved_monthly = current_monthly * 0.5

        # Break-even utilization for reserved
        break_even = 0.5  # 50% utilization

        if utilization > break_even:
            savings = current_monthly - reserved_monthly
            recommendation = "Switch to reserved capacity"
        else:
            savings = 0
            recommendation = "Stay with pay-as-you-go"

        return {
            "current_monthly": current_monthly,
            "reserved_monthly": reserved_monthly,
            "current_utilization": utilization,
            "break_even_utilization": break_even,
            "potential_monthly_savings": savings,
            "annual_savings": savings * 12,
            "recommendation": recommendation
        }

    def identify_optimization_opportunities(self, workspace_analysis: Dict) -> List[Dict]:
        """Identify cost optimization opportunities."""
        opportunities = []

        # Check for unused assets
        unused_tables = workspace_analysis.get("tables_not_queried_30d", [])
        if unused_tables:
            storage_gb = sum(t.get("size_gb", 0) for t in unused_tables)
            opportunities.append({
                "type": "Unused Tables",
                "description": f"{len(unused_tables)} tables not queried in 30 days",
                "potential_savings_gb": storage_gb,
                "action": "Review and archive or delete unused tables"
            })

        # Check for unoptimized tables
        unoptimized = workspace_analysis.get("tables_without_vorder", [])
        if unoptimized:
            opportunities.append({
                "type": "Unoptimized Tables",
                "description": f"{len(unoptimized)} tables without V-Order",
                "potential_savings": "Reduced query time = reduced CU consumption",
                "action": "Apply V-Order optimization"
            })

        # Check for inefficient queries
        slow_queries = workspace_analysis.get("queries_over_30s", [])
        if slow_queries:
            opportunities.append({
                "type": "Slow Queries",
                "description": f"{len(slow_queries)} queries running > 30 seconds",
                "potential_savings": "Significant CU reduction with optimization",
                "action": "Review and optimize slow queries"
            })

        return opportunities

cost_optimization_strategies = {
    "scheduling": {
        "description": "Schedule workloads efficiently",
        "implementation": """
# 1. Identify off-peak hours (typically nights/weekends)
# 2. Schedule batch jobs during off-peak
# 3. Stagger job start times to avoid peaks

# Example: Pipeline scheduling best practices
scheduling_guidelines = {
    "etl_jobs": "2:00 AM - 6:00 AM (off-peak)",
    "report_refresh": "6:00 AM - 8:00 AM (before business hours)",
    "ad_hoc_analysis": "Business hours (user-driven)",
    "ml_training": "Weekends or nights"
}
""",
        "estimated_savings": "10-30%"
    },
    "right_sizing": {
        "description": "Match capacity to actual needs",
        "implementation": """
# 1. Monitor utilization for 2-4 weeks
# 2. Identify peak and average usage
# 3. Select SKU that handles 80% of peaks

def recommend_sku(peak_cu: float, avg_cu: float) -> str:
    # Account for burst capability
    target_cu = max(peak_cu * 0.8, avg_cu * 1.5)

    skus = [("F2", 2), ("F4", 4), ("F8", 8), ("F16", 16), ("F32", 32)]
    for name, cu in skus:
        if cu >= target_cu:
            return name
    return "F64+"
""",
        "estimated_savings": "20-40%"
    },
    "query_optimization": {
        "description": "Reduce compute through better queries",
        "implementation": """
# Top optimizations:
# 1. Add appropriate filters
# 2. Select only needed columns
# 3. Use partitioning and Z-order
# 4. Implement incremental processing

# Before (expensive)
df = spark.table("large_table")
result = df.groupBy("category").sum("amount")

# After (optimized)
df = spark.table("large_table").filter("date >= '2023-12-01'")
result = df.select("category", "amount").groupBy("category").sum("amount")
""",
        "estimated_savings": "30-50%"
    },
    "storage_lifecycle": {
        "description": "Manage data lifecycle",
        "implementation": """
# Implement retention policies
retention_policy = {
    "bronze_layer": "90 days (raw data)",
    "silver_layer": "1 year (cleaned data)",
    "gold_layer": "3 years (aggregated)",
    "archive": "7 years (compliance)"
}

# Clean up Delta log files
VACUUM table_name RETAIN 168 HOURS;  # 7 days

# Delete old partitions
DELETE FROM table_name WHERE date < '2022-01-01';
""",
        "estimated_savings": "10-20%"
    }
}
```

## Cost Monitoring Dashboard

```python
class CostDashboard:
    """Generate cost monitoring reports."""

    def generate_cost_report(self, cost_data: Dict) -> str:
        """Generate comprehensive cost report."""
        return f"""
# Fabric Cost Report

## Monthly Summary
- **Total Cost:** ${cost_data.get('total_cost', 0):,.2f}
- **Compute Cost:** ${cost_data.get('compute_cost', 0):,.2f} ({cost_data.get('compute_pct', 0):.1f}%)
- **Storage Cost:** ${cost_data.get('storage_cost', 0):,.2f} ({cost_data.get('storage_pct', 0):.1f}%)

## Trend Analysis
- **Month-over-Month Change:** {cost_data.get('mom_change', 0):+.1f}%
- **Year-over-Year Change:** {cost_data.get('yoy_change', 0):+.1f}%

## Cost by Workspace

| Workspace | Cost | % of Total |
|-----------|------|-----------|
{self._format_workspace_costs(cost_data.get('by_workspace', {}))}

## Optimization Opportunities

{self._format_opportunities(cost_data.get('opportunities', []))}

## Recommendations

1. {cost_data.get('top_recommendation', 'Review utilization patterns')}
2. Consider reserved capacity for predictable workloads
3. Implement query optimization for top consumers
"""

    def _format_workspace_costs(self, workspaces: Dict) -> str:
        """Format workspace costs table."""
        lines = []
        for ws, data in workspaces.items():
            lines.append(f"| {ws} | ${data.get('cost', 0):,.2f} | {data.get('pct', 0):.1f}% |")
        return "\n".join(lines)

    def _format_opportunities(self, opportunities: List[Dict]) -> str:
        """Format optimization opportunities."""
        if not opportunities:
            return "No immediate opportunities identified."

        lines = []
        for i, opp in enumerate(opportunities[:5], 1):
            lines.append(f"{i}. **{opp.get('type', 'Unknown')}**: {opp.get('description', '')}")
        return "\n".join(lines)
```

Tomorrow, we'll look at 2024 predictions for AI and data!
