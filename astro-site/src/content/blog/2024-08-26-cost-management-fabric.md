---
title: "Cost Management in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-08-26
tags:
  - Microsoft Fabric
  - Cost Management
  - FinOps
  - Budgeting
  - Optimization
---

## Fabric Pricing Model

```
Fabric Cost Structure:
┌─────────────────────────────────────────────────────────────┐
│                    Monthly Fabric Cost                       │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  Capacity Cost                        │   │
│  │                                                       │   │
│  │   Base Cost = Capacity SKU × Hours Running            │   │
│  │                                                       │   │
│  │   F64 = $8,384/month (if running 24/7)               │   │
│  │   F32 = $4,192/month                                  │   │
│  │   F16 = $2,096/month                                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                            +                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                 Burst Cost (if enabled)               │   │
│  │                                                       │   │
│  │   Burst Cost = Additional CUs × Same hourly rate      │   │
│  └──────────────────────────────────────────────────────┘   │
│                            +                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  OneLake Storage                      │   │
│  │                                                       │   │
│  │   $0.023/GB/month (pay-as-you-go storage)            │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Cost Tracking

### Building a Cost Dashboard

```python
class FabricCostTracker:
    """Track and analyze Fabric costs."""

    def __init__(self, capacity_sku: str, hourly_rate: float):
        self.capacity_sku = capacity_sku
        self.hourly_rate = hourly_rate
        self.usage_records = []

    def record_usage(
        self,
        date: str,
        hours_active: float,
        burst_cu_hours: float = 0,
        storage_gb: float = 0
    ):
        """Record daily usage."""

        base_cost = self.hourly_rate * hours_active
        burst_cost = burst_cu_hours * (self.hourly_rate / self._get_base_cus())
        storage_cost = storage_gb * 0.023 / 30  # Daily storage cost

        self.usage_records.append({
            "date": date,
            "hours_active": hours_active,
            "base_cost": base_cost,
            "burst_cu_hours": burst_cu_hours,
            "burst_cost": burst_cost,
            "storage_gb": storage_gb,
            "storage_cost": storage_cost,
            "total_cost": base_cost + burst_cost + storage_cost
        })

    def _get_base_cus(self) -> int:
        """Get base CUs for SKU."""
        sku_cus = {
            "F2": 2, "F4": 4, "F8": 8, "F16": 16,
            "F32": 32, "F64": 64, "F128": 128
        }
        return sku_cus.get(self.capacity_sku, 64)

    def get_monthly_summary(self, month: str) -> dict:
        """Get monthly cost summary."""

        month_records = [r for r in self.usage_records if r["date"].startswith(month)]

        if not month_records:
            return {"message": "No data for this month"}

        return {
            "month": month,
            "total_days": len(month_records),
            "total_active_hours": sum(r["hours_active"] for r in month_records),
            "total_base_cost": sum(r["base_cost"] for r in month_records),
            "total_burst_cost": sum(r["burst_cost"] for r in month_records),
            "total_storage_cost": sum(r["storage_cost"] for r in month_records),
            "total_cost": sum(r["total_cost"] for r in month_records),
            "average_daily_cost": sum(r["total_cost"] for r in month_records) / len(month_records)
        }

    def forecast_monthly_cost(self, days_so_far: int, month_days: int = 30) -> dict:
        """Forecast end-of-month cost based on current usage."""

        if days_so_far == 0:
            return {"message": "No data yet"}

        recent_records = self.usage_records[-days_so_far:]
        avg_daily = sum(r["total_cost"] for r in recent_records) / days_so_far

        return {
            "days_tracked": days_so_far,
            "avg_daily_cost": avg_daily,
            "forecasted_monthly_cost": avg_daily * month_days,
            "remaining_days": month_days - days_so_far,
            "remaining_forecast": avg_daily * (month_days - days_so_far)
        }

# Usage
tracker = FabricCostTracker(capacity_sku="F64", hourly_rate=11.64)

# Record daily usage
tracker.record_usage("2024-08-01", hours_active=24, burst_cu_hours=50, storage_gb=500)
tracker.record_usage("2024-08-02", hours_active=24, burst_cu_hours=30, storage_gb=510)
tracker.record_usage("2024-08-03", hours_active=18, burst_cu_hours=0, storage_gb=515)

summary = tracker.get_monthly_summary("2024-08")
print(f"Month-to-date cost: ${summary['total_cost']:.2f}")

forecast = tracker.forecast_monthly_cost(days_so_far=3, month_days=31)
print(f"Forecasted monthly cost: ${forecast['forecasted_monthly_cost']:.2f}")
```

### Cost Allocation by Workload

```python
class WorkloadCostAllocator:
    """Allocate costs to specific workloads."""

    def __init__(self):
        self.workload_usage = {}

    def record_workload_usage(
        self,
        workload_name: str,
        cu_hours: float,
        timestamp: str
    ):
        """Record CU consumption by workload."""

        if workload_name not in self.workload_usage:
            self.workload_usage[workload_name] = []

        self.workload_usage[workload_name].append({
            "timestamp": timestamp,
            "cu_hours": cu_hours
        })

    def calculate_cost_allocation(self, total_cost: float) -> dict:
        """Allocate total cost based on CU consumption."""

        # Calculate total CU-hours
        total_cu_hours = sum(
            sum(u["cu_hours"] for u in usage)
            for usage in self.workload_usage.values()
        )

        if total_cu_hours == 0:
            return {"message": "No usage recorded"}

        allocations = {}
        for workload, usage in self.workload_usage.items():
            workload_cu_hours = sum(u["cu_hours"] for u in usage)
            percentage = workload_cu_hours / total_cu_hours * 100
            allocated_cost = total_cost * (workload_cu_hours / total_cu_hours)

            allocations[workload] = {
                "cu_hours": workload_cu_hours,
                "percentage": percentage,
                "allocated_cost": allocated_cost
            }

        return {
            "total_cost": total_cost,
            "total_cu_hours": total_cu_hours,
            "allocations": allocations
        }

    def get_top_consumers(self, n: int = 5) -> list:
        """Get top N cost consumers."""

        workload_totals = {
            name: sum(u["cu_hours"] for u in usage)
            for name, usage in self.workload_usage.items()
        }

        sorted_workloads = sorted(
            workload_totals.items(),
            key=lambda x: x[1],
            reverse=True
        )

        return sorted_workloads[:n]

# Usage
allocator = WorkloadCostAllocator()

# Record workload usage
allocator.record_workload_usage("ETL Pipeline", 100, "2024-08-01")
allocator.record_workload_usage("Power BI Refresh", 50, "2024-08-01")
allocator.record_workload_usage("Data Science", 75, "2024-08-01")
allocator.record_workload_usage("Ad-hoc Queries", 25, "2024-08-01")

# Calculate allocation
allocation = allocator.calculate_cost_allocation(total_cost=1000)

print("Cost Allocation:")
for workload, details in allocation["allocations"].items():
    print(f"  {workload}: ${details['allocated_cost']:.2f} ({details['percentage']:.1f}%)")
```

## Cost Optimization Strategies

### Strategy 1: Capacity Right-Sizing

```python
class CapacityRightSizer:
    """Recommend optimal capacity size."""

    def __init__(self):
        self.capacity_options = {
            "F2": {"cus": 2, "monthly_cost": 262},
            "F4": {"cus": 4, "monthly_cost": 524},
            "F8": {"cus": 8, "monthly_cost": 1048},
            "F16": {"cus": 16, "monthly_cost": 2096},
            "F32": {"cus": 32, "monthly_cost": 4192},
            "F64": {"cus": 64, "monthly_cost": 8384},
            "F128": {"cus": 128, "monthly_cost": 16768}
        }

    def analyze_usage(self, usage_metrics: dict) -> dict:
        """Analyze usage and recommend capacity."""

        avg_cus = usage_metrics.get("average_cus", 0)
        peak_cus = usage_metrics.get("peak_cus", 0)
        p95_cus = usage_metrics.get("p95_cus", peak_cus * 0.9)

        # Find minimum capacity that handles p95
        recommended = None
        for sku, specs in sorted(self.capacity_options.items(),
                                  key=lambda x: x[1]["cus"]):
            if specs["cus"] >= p95_cus * 0.8:  # 80% of p95
                recommended = sku
                break

        current_sku = usage_metrics.get("current_sku", "F64")
        current_cost = self.capacity_options[current_sku]["monthly_cost"]
        recommended_cost = self.capacity_options[recommended]["monthly_cost"] if recommended else current_cost

        return {
            "current_sku": current_sku,
            "current_monthly_cost": current_cost,
            "recommended_sku": recommended,
            "recommended_monthly_cost": recommended_cost,
            "potential_savings": current_cost - recommended_cost,
            "savings_percent": (current_cost - recommended_cost) / current_cost * 100 if current_cost > 0 else 0,
            "analysis": {
                "average_cus": avg_cus,
                "peak_cus": peak_cus,
                "p95_cus": p95_cus
            }
        }

# Usage
rightsizer = CapacityRightSizer()

usage = {
    "current_sku": "F64",
    "average_cus": 25,
    "peak_cus": 55,
    "p95_cus": 45
}

recommendation = rightsizer.analyze_usage(usage)
print(f"Current: {recommendation['current_sku']} (${recommendation['current_monthly_cost']}/mo)")
print(f"Recommended: {recommendation['recommended_sku']} (${recommendation['recommended_monthly_cost']}/mo)")
print(f"Potential savings: ${recommendation['potential_savings']}/mo ({recommendation['savings_percent']:.1f}%)")
```

### Strategy 2: Pause During Off-Hours

```python
class PauseScheduler:
    """Calculate savings from pausing capacity."""

    def __init__(self, hourly_rate: float):
        self.hourly_rate = hourly_rate

    def calculate_pause_savings(
        self,
        pause_hours_per_day: int,
        days_per_month: int = 30
    ) -> dict:
        """Calculate monthly savings from pausing."""

        hours_paused = pause_hours_per_day * days_per_month
        savings = hours_paused * self.hourly_rate

        always_on_cost = 24 * days_per_month * self.hourly_rate
        with_pause_cost = (24 - pause_hours_per_day) * days_per_month * self.hourly_rate

        return {
            "hours_paused_monthly": hours_paused,
            "monthly_savings": savings,
            "always_on_cost": always_on_cost,
            "with_pause_cost": with_pause_cost,
            "savings_percent": savings / always_on_cost * 100
        }

    def recommend_pause_schedule(self, usage_pattern: list) -> dict:
        """Recommend optimal pause schedule based on usage."""

        # Identify hours with minimal usage
        threshold = sum(usage_pattern) / len(usage_pattern) * 0.1  # 10% of average

        pause_candidates = [
            hour for hour, usage in enumerate(usage_pattern)
            if usage < threshold
        ]

        return {
            "recommended_pause_hours": pause_candidates,
            "hours_to_pause": len(pause_candidates),
            "suggested_schedule": self._format_schedule(pause_candidates),
            "estimated_savings": self.calculate_pause_savings(len(pause_candidates))
        }

    def _format_schedule(self, hours: list) -> str:
        """Format hours into schedule string."""

        if not hours:
            return "No pause recommended"

        # Find contiguous ranges
        ranges = []
        start = hours[0]
        end = hours[0]

        for h in hours[1:]:
            if h == end + 1:
                end = h
            else:
                ranges.append((start, end))
                start = h
                end = h
        ranges.append((start, end))

        return ", ".join(f"{s:02d}:00-{e+1:02d}:00" for s, e in ranges)

# Usage
scheduler = PauseScheduler(hourly_rate=11.64)

# 24-hour usage pattern
usage_pattern = [
    5, 3, 2, 2, 3, 10,    # 00:00 - 05:00
    40, 60, 65, 70, 65, 60,  # 06:00 - 11:00
    55, 60, 65, 70, 65, 55,  # 12:00 - 17:00
    40, 25, 15, 10, 8, 6     # 18:00 - 23:00
]

recommendation = scheduler.recommend_pause_schedule(usage_pattern)
print(f"Recommended pause hours: {recommendation['hours_to_pause']}")
print(f"Schedule: {recommendation['suggested_schedule']}")
print(f"Monthly savings: ${recommendation['estimated_savings']['monthly_savings']:.2f}")
```

### Strategy 3: Workload Optimization

```python
class WorkloadOptimizer:
    """Optimize workloads to reduce cost."""

    def analyze_inefficiencies(self, workload_metrics: list) -> list:
        """Identify cost inefficiencies in workloads."""

        recommendations = []

        for workload in workload_metrics:
            name = workload["name"]
            cu_hours = workload["cu_hours"]
            duration = workload["duration_hours"]
            efficiency = workload.get("efficiency_score", 0.5)

            # Check for inefficiencies
            if efficiency < 0.5:
                recommendations.append({
                    "workload": name,
                    "issue": "Low efficiency",
                    "current_cu_hours": cu_hours,
                    "potential_reduction": cu_hours * (1 - efficiency),
                    "action": "Review query plans and data layout"
                })

            if duration > 4 and cu_hours / duration < 10:
                recommendations.append({
                    "workload": name,
                    "issue": "Long-running but low CU",
                    "current_cu_hours": cu_hours,
                    "action": "Consider increasing parallelism to complete faster"
                })

        return recommendations

    def estimate_optimization_savings(
        self,
        recommendations: list,
        cost_per_cu_hour: float
    ) -> dict:
        """Estimate savings from optimizations."""

        total_reducible = sum(
            r.get("potential_reduction", 0)
            for r in recommendations
        )

        return {
            "optimizations": len(recommendations),
            "reducible_cu_hours": total_reducible,
            "estimated_monthly_savings": total_reducible * cost_per_cu_hour * 30
        }

# Usage
optimizer = WorkloadOptimizer()

workloads = [
    {"name": "ETL Job", "cu_hours": 100, "duration_hours": 2, "efficiency_score": 0.8},
    {"name": "Report Gen", "cu_hours": 50, "duration_hours": 1, "efficiency_score": 0.4},
    {"name": "Data Copy", "cu_hours": 30, "duration_hours": 6, "efficiency_score": 0.3}
]

recommendations = optimizer.analyze_inefficiencies(workloads)
savings = optimizer.estimate_optimization_savings(recommendations, cost_per_cu_hour=0.18)

print(f"Optimization opportunities: {savings['optimizations']}")
print(f"Estimated monthly savings: ${savings['estimated_monthly_savings']:.2f}")
```

## Cost Alerts and Budgets

```python
class CostAlertManager:
    """Manage cost alerts and budgets."""

    def __init__(self, monthly_budget: float):
        self.monthly_budget = monthly_budget
        self.alerts = []

    def check_budget(self, current_spend: float, day_of_month: int) -> dict:
        """Check if spending is on track with budget."""

        days_in_month = 30
        expected_spend = (self.monthly_budget / days_in_month) * day_of_month
        variance = current_spend - expected_spend
        variance_percent = (variance / expected_spend * 100) if expected_spend > 0 else 0

        status = "on_track"
        if variance_percent > 20:
            status = "over_budget"
        elif variance_percent > 10:
            status = "warning"

        return {
            "day_of_month": day_of_month,
            "current_spend": current_spend,
            "expected_spend": expected_spend,
            "variance": variance,
            "variance_percent": variance_percent,
            "projected_monthly": (current_spend / day_of_month) * days_in_month,
            "status": status
        }

    def configure_alert(
        self,
        name: str,
        threshold_percent: float,
        notification_method: str
    ):
        """Configure a cost alert."""

        self.alerts.append({
            "name": name,
            "threshold_percent": threshold_percent,
            "threshold_amount": self.monthly_budget * (threshold_percent / 100),
            "notification_method": notification_method
        })

    def check_alerts(self, current_spend: float) -> list:
        """Check which alerts should fire."""

        triggered = []
        for alert in self.alerts:
            if current_spend >= alert["threshold_amount"]:
                triggered.append({
                    "alert_name": alert["name"],
                    "threshold_amount": alert["threshold_amount"],
                    "current_spend": current_spend,
                    "notification_method": alert["notification_method"]
                })

        return triggered

# Usage
alerts = CostAlertManager(monthly_budget=10000)

# Configure alerts
alerts.configure_alert("50% Budget", 50, "email")
alerts.configure_alert("75% Budget", 75, "email")
alerts.configure_alert("90% Budget", 90, "email + slack")
alerts.configure_alert("100% Budget", 100, "email + slack + page")

# Check budget status
status = alerts.check_budget(current_spend=6500, day_of_month=15)
print(f"Status: {status['status']}")
print(f"Variance: {status['variance_percent']:.1f}%")
print(f"Projected monthly: ${status['projected_monthly']:.2f}")

# Check alerts
triggered = alerts.check_alerts(current_spend=6500)
for alert in triggered:
    print(f"Alert triggered: {alert['alert_name']}")
```

## Best Practices

1. **Monitor regularly**: Daily cost tracking enables early intervention
2. **Set alerts**: Budget alerts prevent surprises
3. **Allocate costs**: Understand which workloads drive costs
4. **Optimize continuously**: Regular review of inefficiencies
5. **Consider pause schedules**: Significant savings from off-hours pause

## Conclusion

Effective cost management in Microsoft Fabric requires understanding the pricing model, tracking usage, and implementing optimization strategies. Combine right-sizing, pause schedules, and workload optimization to maximize value while minimizing spend.

Regular monitoring and alerts ensure you stay within budget while meeting performance requirements.
