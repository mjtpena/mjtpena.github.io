---
title: "Microsoft Fabric Capacity Optimization"
author: Michael John Peña
draft: false
date: 2024-08-23
tags:
  - Microsoft Fabric
  - Capacity
  - Cost Optimization
  - Performance
  - FinOps
---

## Understanding Fabric Capacity

```
Fabric Capacity Model:
┌─────────────────────────────────────────────────────────────┐
│                    Fabric Capacity (F64)                     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  Capacity Units (CUs)                 │   │
│  │                                                       │   │
│  │   64 CUs available per billing period (per second)   │   │
│  │                                                       │   │
│  │   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │   │
│  │   │ Spark   │ │Warehouse│ │ Power BI│ │Dataflow │    │   │
│  │   │  Jobs   │ │ Queries │ │ Refresh │ │  Gen2   │    │   │
│  │   │  25 CU  │ │  15 CU  │ │  10 CU  │ │  14 CU  │    │   │
│  │   └─────────┘ └─────────┘ └─────────┘ └─────────┘    │   │
│  │                                                       │   │
│  │   Total: 64 CU used (at capacity)                    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Capacity Tiers

```python
capacity_tiers = {
    "F2": {
        "cus": 2,
        "spark_vcores": 4,
        "use_case": "Development, POC",
        "monthly_cost_estimate": "$262"
    },
    "F4": {
        "cus": 4,
        "spark_vcores": 8,
        "use_case": "Small team development",
        "monthly_cost_estimate": "$524"
    },
    "F8": {
        "cus": 8,
        "spark_vcores": 16,
        "use_case": "Small production",
        "monthly_cost_estimate": "$1,048"
    },
    "F16": {
        "cus": 16,
        "spark_vcores": 32,
        "use_case": "Medium production",
        "monthly_cost_estimate": "$2,096"
    },
    "F32": {
        "cus": 32,
        "spark_vcores": 64,
        "use_case": "Large production",
        "monthly_cost_estimate": "$4,192"
    },
    "F64": {
        "cus": 64,
        "spark_vcores": 128,
        "use_case": "Enterprise production",
        "monthly_cost_estimate": "$8,384"
    },
    "F128": {
        "cus": 128,
        "spark_vcores": 256,
        "use_case": "Large enterprise",
        "monthly_cost_estimate": "$16,768"
    }
}

def recommend_capacity(
    concurrent_spark_jobs: int,
    concurrent_queries: int,
    daily_refreshes: int
) -> str:
    """Recommend capacity tier based on requirements."""

    # Rough CU requirements
    spark_cus = concurrent_spark_jobs * 8  # ~8 CUs per Spark job
    query_cus = concurrent_queries * 2      # ~2 CUs per query
    refresh_cus = daily_refreshes * 0.5     # Amortized over day

    total_peak_cus = spark_cus + query_cus + refresh_cus

    # Find smallest tier that fits
    for tier, specs in sorted(capacity_tiers.items(), key=lambda x: x[1]["cus"]):
        if specs["cus"] >= total_peak_cus * 1.2:  # 20% headroom
            return {
                "recommended_tier": tier,
                "estimated_peak_cus": total_peak_cus,
                "tier_cus": specs["cus"],
                "headroom_percent": (specs["cus"] - total_peak_cus) / specs["cus"] * 100
            }

    return {"recommended_tier": "F128", "note": "May need multiple capacities"}

# Usage
recommendation = recommend_capacity(
    concurrent_spark_jobs=3,
    concurrent_queries=10,
    daily_refreshes=20
)
print(f"Recommended: {recommendation['recommended_tier']}")
```

## Monitoring Capacity Usage

### Capacity Metrics

```python
class CapacityMonitor:
    """Monitor Fabric capacity usage."""

    def __init__(self, capacity_id: str):
        self.capacity_id = capacity_id

    def get_usage_metrics(self, hours: int = 24) -> dict:
        """Get capacity usage metrics."""

        # This would connect to Fabric Admin APIs
        # Simulated response structure
        return {
            "capacity_id": self.capacity_id,
            "period_hours": hours,
            "metrics": {
                "average_utilization_percent": 65,
                "peak_utilization_percent": 95,
                "throttled_minutes": 15,
                "operations_count": 1250
            },
            "by_workload": {
                "spark": {"cu_hours": 120, "percent": 45},
                "warehouse": {"cu_hours": 80, "percent": 30},
                "dataflow": {"cu_hours": 40, "percent": 15},
                "power_bi": {"cu_hours": 27, "percent": 10}
            }
        }

    def get_throttling_events(self) -> list:
        """Get recent throttling events."""

        # Throttling occurs when demand exceeds capacity
        return [
            {
                "timestamp": "2024-08-23T14:30:00Z",
                "duration_minutes": 5,
                "cause": "Multiple large Spark jobs",
                "impacted_workloads": ["Spark", "Warehouse queries"]
            },
            {
                "timestamp": "2024-08-23T09:00:00Z",
                "duration_minutes": 10,
                "cause": "Power BI refresh + ETL overlap",
                "impacted_workloads": ["Power BI", "Dataflow"]
            }
        ]

    def get_optimization_recommendations(self, metrics: dict) -> list:
        """Generate optimization recommendations."""

        recommendations = []

        if metrics["metrics"]["peak_utilization_percent"] > 90:
            recommendations.append({
                "priority": "HIGH",
                "issue": "Peak utilization exceeds 90%",
                "recommendation": "Consider upgrading capacity or staggering workloads"
            })

        if metrics["metrics"]["throttled_minutes"] > 0:
            recommendations.append({
                "priority": "HIGH",
                "issue": f"Throttling occurred ({metrics['metrics']['throttled_minutes']} mins)",
                "recommendation": "Review workload scheduling to avoid concurrent peaks"
            })

        if metrics["metrics"]["average_utilization_percent"] < 30:
            recommendations.append({
                "priority": "MEDIUM",
                "issue": "Low average utilization",
                "recommendation": "Consider downsizing capacity to reduce costs"
            })

        return recommendations

# Usage
monitor = CapacityMonitor("capacity-123")

metrics = monitor.get_usage_metrics(hours=24)
print(f"Average utilization: {metrics['metrics']['average_utilization_percent']}%")

recommendations = monitor.get_optimization_recommendations(metrics)
for rec in recommendations:
    print(f"[{rec['priority']}] {rec['issue']}: {rec['recommendation']}")
```

## Workload Scheduling

### Staggering Workloads

```python
class WorkloadScheduler:
    """Schedule workloads to optimize capacity usage."""

    def __init__(self, capacity_cus: int):
        self.capacity_cus = capacity_cus
        self.scheduled_jobs = []

    def estimate_job_cus(self, job_type: str, size: str = "medium") -> int:
        """Estimate CU consumption for job type."""

        cu_estimates = {
            "spark_etl": {"small": 8, "medium": 16, "large": 32},
            "warehouse_query": {"small": 2, "medium": 4, "large": 8},
            "dataflow": {"small": 4, "medium": 8, "large": 16},
            "power_bi_refresh": {"small": 4, "medium": 8, "large": 16}
        }

        return cu_estimates.get(job_type, {}).get(size, 8)

    def can_schedule(self, job_cus: int, time_slot: str) -> bool:
        """Check if job can be scheduled without exceeding capacity."""

        scheduled_at_time = [
            j for j in self.scheduled_jobs
            if j["time_slot"] == time_slot
        ]

        current_usage = sum(j["estimated_cus"] for j in scheduled_at_time)

        return (current_usage + job_cus) <= self.capacity_cus * 0.8  # 80% threshold

    def schedule_job(
        self,
        job_name: str,
        job_type: str,
        preferred_time: str,
        size: str = "medium"
    ) -> dict:
        """Schedule job, finding alternative time if needed."""

        job_cus = self.estimate_job_cus(job_type, size)

        # Try preferred time first
        if self.can_schedule(job_cus, preferred_time):
            scheduled_time = preferred_time
        else:
            # Find alternative time
            for hour in range(24):
                time_slot = f"{hour:02d}:00"
                if self.can_schedule(job_cus, time_slot):
                    scheduled_time = time_slot
                    break
            else:
                return {"error": "No available time slot"}

        job = {
            "name": job_name,
            "type": job_type,
            "time_slot": scheduled_time,
            "estimated_cus": job_cus
        }

        self.scheduled_jobs.append(job)
        return job

    def get_schedule_visualization(self) -> str:
        """Generate schedule visualization."""

        hourly_usage = {}
        for job in self.scheduled_jobs:
            slot = job["time_slot"]
            hourly_usage[slot] = hourly_usage.get(slot, 0) + job["estimated_cus"]

        lines = ["Hour | Usage | Bar"]
        lines.append("-" * 40)

        for hour in range(24):
            slot = f"{hour:02d}:00"
            usage = hourly_usage.get(slot, 0)
            bar_length = int(usage / self.capacity_cus * 20)
            bar = "#" * bar_length
            lines.append(f"{slot} | {usage:3d}CU | {bar}")

        return "\n".join(lines)

# Usage
scheduler = WorkloadScheduler(capacity_cus=64)

# Schedule jobs
scheduler.schedule_job("Daily ETL", "spark_etl", "02:00", "large")
scheduler.schedule_job("Morning Refresh", "power_bi_refresh", "06:00", "medium")
scheduler.schedule_job("Sales Report", "warehouse_query", "08:00", "medium")
scheduler.schedule_job("Marketing ETL", "spark_etl", "02:00", "medium")  # Will conflict

print(scheduler.get_schedule_visualization())
```

## Capacity Scaling Strategies

### Auto-pause and Resume

```python
class CapacityScaler:
    """Manage capacity scaling."""

    def __init__(self, capacity_id: str):
        self.capacity_id = capacity_id

    def should_pause(self, metrics: dict, idle_threshold_minutes: int = 60) -> bool:
        """Determine if capacity should be paused."""

        # Check if there's been activity
        if metrics.get("last_activity_minutes_ago", 0) > idle_threshold_minutes:
            return True

        # Check if outside business hours
        from datetime import datetime
        current_hour = datetime.now().hour
        if current_hour < 6 or current_hour > 22:  # Outside 6 AM - 10 PM
            if metrics.get("scheduled_jobs_next_hour", 0) == 0:
                return True

        return False

    def should_resume(self, pending_requests: int) -> bool:
        """Determine if capacity should be resumed."""

        return pending_requests > 0

    def recommend_scaling(self, metrics: dict) -> dict:
        """Recommend scaling action."""

        avg_util = metrics.get("average_utilization_percent", 50)
        peak_util = metrics.get("peak_utilization_percent", 50)
        throttling = metrics.get("throttled_minutes", 0)

        if throttling > 30 or peak_util > 95:
            return {
                "action": "SCALE_UP",
                "reason": "Frequent throttling or high peak utilization",
                "current_tier": metrics.get("current_tier"),
                "recommended_tier": self._next_tier(metrics.get("current_tier"))
            }
        elif avg_util < 20 and peak_util < 50:
            return {
                "action": "SCALE_DOWN",
                "reason": "Consistently low utilization",
                "current_tier": metrics.get("current_tier"),
                "recommended_tier": self._previous_tier(metrics.get("current_tier"))
            }
        else:
            return {
                "action": "NO_CHANGE",
                "reason": "Utilization within acceptable range"
            }

    def _next_tier(self, current: str) -> str:
        tiers = ["F2", "F4", "F8", "F16", "F32", "F64", "F128"]
        idx = tiers.index(current) if current in tiers else 0
        return tiers[min(idx + 1, len(tiers) - 1)]

    def _previous_tier(self, current: str) -> str:
        tiers = ["F2", "F4", "F8", "F16", "F32", "F64", "F128"]
        idx = tiers.index(current) if current in tiers else 0
        return tiers[max(idx - 1, 0)]

# Usage
scaler = CapacityScaler("capacity-123")

metrics = {
    "average_utilization_percent": 75,
    "peak_utilization_percent": 98,
    "throttled_minutes": 45,
    "current_tier": "F32"
}

recommendation = scaler.recommend_scaling(metrics)
print(f"Recommendation: {recommendation['action']}")
print(f"Reason: {recommendation['reason']}")
```

## Cost Optimization Techniques

### Right-sizing Workloads

```python
class WorkloadOptimizer:
    """Optimize workloads for capacity efficiency."""

    def analyze_spark_job(self, job_metrics: dict) -> dict:
        """Analyze Spark job for optimization opportunities."""

        recommendations = []

        # Check executor efficiency
        if job_metrics.get("executor_idle_time_percent", 0) > 30:
            recommendations.append({
                "area": "Executors",
                "issue": "High executor idle time",
                "fix": "Reduce number of executors or increase parallelism"
            })

        # Check shuffle
        if job_metrics.get("shuffle_spill_gb", 0) > 10:
            recommendations.append({
                "area": "Shuffle",
                "issue": "Significant shuffle spill to disk",
                "fix": "Increase executor memory or optimize partitioning"
            })

        # Check data skew
        if job_metrics.get("max_partition_size_ratio", 1) > 5:
            recommendations.append({
                "area": "Data Skew",
                "issue": "Significant data skew detected",
                "fix": "Use salting or enable AQE skew handling"
            })

        return {
            "job_id": job_metrics.get("job_id"),
            "recommendations": recommendations,
            "estimated_cu_savings": len(recommendations) * 10  # Rough estimate
        }

    def optimize_query_patterns(self, query_log: list) -> list:
        """Identify query patterns to optimize."""

        optimizations = []

        # Group by query pattern
        patterns = {}
        for query in query_log:
            pattern = query.get("pattern", "unknown")
            if pattern not in patterns:
                patterns[pattern] = {"count": 0, "total_cus": 0}
            patterns[pattern]["count"] += 1
            patterns[pattern]["total_cus"] += query.get("cus", 0)

        # Find expensive patterns
        for pattern, stats in patterns.items():
            if stats["total_cus"] > 100:
                optimizations.append({
                    "pattern": pattern,
                    "query_count": stats["count"],
                    "total_cus": stats["total_cus"],
                    "recommendation": "Consider caching or materializing results"
                })

        return optimizations

# Usage
optimizer = WorkloadOptimizer()

# Analyze Spark job
job_metrics = {
    "job_id": "job-123",
    "executor_idle_time_percent": 45,
    "shuffle_spill_gb": 15,
    "max_partition_size_ratio": 8
}

analysis = optimizer.analyze_spark_job(job_metrics)
print(f"Recommendations for {analysis['job_id']}:")
for rec in analysis["recommendations"]:
    print(f"  - [{rec['area']}] {rec['issue']}: {rec['fix']}")
```

## Best Practices

1. **Monitor utilization patterns**: Understand your usage before optimizing
2. **Stagger workloads**: Avoid concurrent peaks
3. **Right-size jobs**: Use appropriate resources for each workload
4. **Consider auto-pause**: For development capacities
5. **Review regularly**: Capacity needs change over time

## Conclusion

Effective capacity optimization balances performance requirements with cost efficiency. Regular monitoring, smart scheduling, and workload optimization help organizations maximize their Fabric investment.

Start with right-sized capacity, monitor usage patterns, and adjust based on actual needs rather than assumptions.
