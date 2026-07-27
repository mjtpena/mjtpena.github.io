---
title: "Fabric Capacity Management: Right-Sizing Your Platform"
author: "Michael John Peña"
draft: false
date: 2023-12-24
tags: ["Microsoft Fabric", "Capacity", "Cost Management", "Planning", "Operations"]

---

I wrote "Fabric Capacity Management: Right-Sizing Your Platform" to share practical, production-minded guidance on this topic.

Right-sizing Fabric capacity is a finance-and-engineering problem: choose a capacity SKU that matches peak loading patterns, instrument CU consumption, and schedule heavy workloads. The strategies below come from real customers who avoided throttle-induced incidents.

## Understanding Fabric Capacity

## Understanding Fabric Capacity

```python
from dataclasses import dataclass
from typing import List, Dict

@dataclass
class FabricSKU:
    name: str
    capacity_units: int
    spark_vcores: int
    max_memory_gb: int
    price_per_hour: float
    recommended_workloads: List[str]

fabric_skus = {
    "F2": FabricSKU("F2", 2, 2, 3, 0.36, ["Dev/Test", "POC"]),
    "F4": FabricSKU("F4", 4, 4, 6, 0.72, ["Small teams", "Light workloads"]),
    "F8": FabricSKU("F8", 8, 8, 12, 1.44, ["Departmental", "Medium workloads"]),
    "F16": FabricSKU("F16", 16, 16, 24, 2.88, ["Medium teams", "Multiple workloads"]),
    "F32": FabricSKU("F32", 32, 32, 48, 5.76, ["Large workloads", "Enterprise"]),
    "F64": FabricSKU("F64", 64, 64, 96, 11.52, ["Large enterprise", "High concurrency"]),
    "F128": FabricSKU("F128", 128, 128, 192, 23.04, ["Very large enterprise"]),
}

class CapacityCalculator:
    """Calculate capacity requirements."""

    def calculate_spark_requirements(self, workloads: List[Dict]) -> Dict:
        """Calculate Spark capacity needs."""
        total_vcore_hours = 0
        peak_concurrent = 0

        for workload in workloads:
            # Calculate vCore-hours
            duration_hours = workload.get("duration_minutes", 60) / 60
            vcores = workload.get("vcores", 4)
            runs_per_day = workload.get("runs_per_day", 1)

            vcore_hours = vcores * duration_hours * runs_per_day
            total_vcore_hours += vcore_hours

            # Track peak concurrency
            concurrent = workload.get("concurrent_jobs", 1)
            peak_concurrent = max(peak_concurrent, concurrent * vcores)

        return {
            "daily_vcore_hours": total_vcore_hours,
            "peak_vcores_needed": peak_concurrent,
            "recommended_sku": self._recommend_sku(peak_concurrent)
        }

    def _recommend_sku(self, peak_vcores: int) -> str:
        """Recommend SKU based on peak vCore requirement."""
        for sku_name, sku in fabric_skus.items():
            if sku.spark_vcores >= peak_vcores:
                return sku_name
        return "F128"  # Largest SKU

    def estimate_monthly_cost(self, sku: str, usage_pattern: str) -> Dict:
        """Estimate monthly cost based on usage pattern."""
        sku_info = fabric_skus.get(sku)
        if not sku_info:
            return {"error": "Unknown SKU"}

        if usage_pattern == "always_on":
            hours = 24 * 30  # 720 hours
        elif usage_pattern == "business_hours":
            hours = 10 * 22  # 10 hours/day, 22 business days
        elif usage_pattern == "batch_only":
            hours = 8 * 30  # 8 hours/day average
        else:
            hours = 12 * 30  # Default assumption

        payg_cost = sku_info.price_per_hour * hours
        reserved_cost = sku_info.price_per_hour * 720 * 0.5  # 50% discount for reserved

        return {
            "sku": sku,
            "usage_pattern": usage_pattern,
            "estimated_hours": hours,
            "payg_monthly": payg_cost,
            "reserved_monthly": reserved_cost,
            "recommendation": "Reserved" if hours > 500 else "Pay-as-you-go"
        }
```

## Capacity Monitoring

```python
class CapacityMonitor:
    """Monitor Fabric capacity utilization."""

    def __init__(self):
        self.utilization_history = []

    def record_utilization(self, utilization: Dict):
        """Record utilization snapshot."""
        self.utilization_history.append({
            **utilization,
            "timestamp": datetime.now()
        })

    def analyze_utilization(self, days: int = 7) -> Dict:
        """Analyze utilization patterns."""
        # Filter to specified period
        cutoff = datetime.now() - timedelta(days=days)
        recent = [u for u in self.utilization_history if u["timestamp"] > cutoff]

        if not recent:
            return {"error": "No data available"}

        utilizations = [u.get("utilization_percent", 0) for u in recent]

        return {
            "period_days": days,
            "data_points": len(recent),
            "avg_utilization": sum(utilizations) / len(utilizations),
            "max_utilization": max(utilizations),
            "min_utilization": min(utilizations),
            "over_80_percent": sum(1 for u in utilizations if u > 80),
            "under_20_percent": sum(1 for u in utilizations if u < 20)
        }

    def generate_recommendations(self, analysis: Dict) -> List[str]:
        """Generate capacity recommendations."""
        recommendations = []

        avg = analysis.get("avg_utilization", 50)
        max_util = analysis.get("max_utilization", 0)
        over_80 = analysis.get("over_80_percent", 0)

        if avg < 20:
            recommendations.append("Consider downsizing - average utilization very low")
        elif avg < 40:
            recommendations.append("Capacity may be oversized - review workload requirements")

        if over_80 > len(self.utilization_history) * 0.1:
            recommendations.append("Frequent high utilization - consider upsizing or autoscale")

        if max_util >= 100:
            recommendations.append("Capacity saturation detected - workloads may be throttled")

        if not recommendations:
            recommendations.append("Capacity appears well-sized for current workloads")

        return recommendations

    def generate_capacity_report(self) -> str:
        """Generate capacity utilization report."""
        analysis = self.analyze_utilization(30)
        recommendations = self.generate_recommendations(analysis)

        return f"""
# Fabric Capacity Utilization Report

## 30-Day Summary
- Average Utilization: {analysis.get('avg_utilization', 0):.1f}%
- Peak Utilization: {analysis.get('max_utilization', 0):.1f}%
- High Utilization Events (>80%): {analysis.get('over_80_percent', 0)}
- Low Utilization Events (<20%): {analysis.get('under_20_percent', 0)}

## Recommendations
{chr(10).join(f'- {r}' for r in recommendations)}

## Actions
- [ ] Review workload schedules
- [ ] Consider reserved capacity if sustained usage
- [ ] Evaluate autoscale options
- [ ] Optimize high-consumption workloads
"""
```

## Autoscale and Smoothing

```python
autoscale_strategies = {
    "smoothing": {
        "description": "Smooth out usage spikes over time",
        "how_it_works": """
Smoothing averages capacity consumption over a time window (e.g., 5 minutes).
This prevents brief spikes from causing throttling.
""",
        "configuration": """
# Enable via Fabric Admin Portal
# Settings > Capacity Settings > Smoothing
# Recommended: Enable for all production capacities
""",
        "benefits": [
            "Handles temporary spikes gracefully",
            "More predictable performance",
            "Better cost efficiency"
        ]
    },
    "burst": {
        "description": "Borrow capacity from future allocations",
        "how_it_works": """
When under capacity limit, you accumulate 'burst' credits.
These credits can be used to handle temporary overages.
""",
        "configuration": """
# Burst is enabled by default
# Monitor burst credit consumption in Capacity Metrics
""",
        "benefits": [
            "Handle unexpected load spikes",
            "Avoid immediate throttling",
            "Flexibility without upsizing"
        ]
    }
}

class CapacityPlanner:
    """Plan capacity for future needs."""

    def project_growth(self, current_usage: Dict, growth_rate: float, months: int) -> List[Dict]:
        """Project capacity needs with growth."""
        projections = []
        current = current_usage.get("avg_cu_usage", 10)

        for month in range(1, months + 1):
            projected = current * ((1 + growth_rate) ** month)
            projections.append({
                "month": month,
                "projected_cu": projected,
                "recommended_sku": self._sku_for_cu(projected)
            })

        return projections

    def _sku_for_cu(self, cu_needed: float) -> str:
        """Get SKU for capacity units needed."""
        for sku_name, sku in fabric_skus.items():
            if sku.capacity_units >= cu_needed:
                return sku_name
        return "F128+"

    def generate_capacity_plan(self, current: Dict, growth_rate: float) -> str:
        """Generate capacity planning document."""
        projections = self.project_growth(current, growth_rate, 12)

        plan = """
# Fabric Capacity Plan

## Current State
- Current SKU: {current_sku}
- Average Utilization: {avg_util}%
- Monthly Cost: ${monthly_cost:.2f}

## 12-Month Projection (assuming {growth}% monthly growth)

| Month | Projected CUs | Recommended SKU |
|-------|--------------|-----------------|
""".format(
            current_sku=current.get("current_sku", "Unknown"),
            avg_util=current.get("avg_utilization", 0),
            monthly_cost=current.get("monthly_cost", 0),
            growth=growth_rate * 100
        )

        for proj in projections:
            plan += f"| {proj['month']} | {proj['projected_cu']:.1f} | {proj['recommended_sku']} |\n"

        return plan
```

Tomorrow, we'll explore cost optimization strategies for Fabric!\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
