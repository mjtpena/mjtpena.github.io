---
title: "Understanding Smoothing and Bursting in Fabric"
description: "Smoothing averages capacity consumption over a time window, allowing brief spikes without immediate throttling."
author: Michael John Peña
draft: false
date: 2024-08-25
tags:
  - Microsoft Fabric
  - Capacity
  - Smoothing
  - Bursting
  - Performance
---

## How Smoothing Works

Smoothing averages capacity consumption over a time window, allowing brief spikes without immediate throttling.

```
Without Smoothing:
┌─────────────────────────────────────────────────────────────┐
│  Capacity Limit: 64 CU                                      │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│       ████                                                  │
│       ████  ████                                 ████       │
│       ████  ████              ████               ████       │
│  ████ ████  ████         ████ ████          ████ ████       │
│  ████ ████  ████    ████ ████ ████     ████ ████ ████       │
│  ████ ████  ████    ████ ████ ████     ████ ████ ████       │
│  ─────────────────────────────────────────────────────────  │
│  Time →                                                     │
│                                                             │
│  Spikes above 64 CU = THROTTLED immediately                │
└─────────────────────────────────────────────────────────────┘

With Smoothing (5-min window):
┌─────────────────────────────────────────────────────────────┐
│  Capacity Limit: 64 CU (average over window)               │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│       ████                                                  │
│       ████  ████                                 ████       │
│  ──── ████──████ ──────────────────────────── ████ ────     │
│  ████ ████  ████         ████               ████ ████       │
│  ████ ████  ████    ████ ████          ████ ████ ████       │
│  ████ ████  ████    ████ ████     ████ ████ ████ ████       │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Average line stays under 64 CU = NO THROTTLING            │
└─────────────────────────────────────────────────────────────┘
```

## Smoothing Configuration

```python
class SmoothingAnalyzer:
    """Analyze and configure smoothing behavior."""

    def __init__(self, capacity_cus: int, window_minutes: int = 5):
        self.capacity_cus = capacity_cus
        self.window_minutes = window_minutes
        self.consumption_history = []

    def record_consumption(self, cus: int, timestamp=None):
        """Record CU consumption at a point in time."""

        from datetime import datetime

        if timestamp is None:
            timestamp = datetime.utcnow()

        self.consumption_history.append({
            "timestamp": timestamp,
            "cus": cus
        })

    def calculate_smoothed_consumption(self) -> float:
        """Calculate smoothed consumption over window."""

        from datetime import datetime, timedelta

        cutoff = datetime.utcnow() - timedelta(minutes=self.window_minutes)

        recent = [
            c["cus"] for c in self.consumption_history
            if c["timestamp"] > cutoff
        ]

        if not recent:
            return 0

        return sum(recent) / len(recent)

    def will_throttle(self, additional_cus: int) -> dict:
        """Check if additional consumption will cause throttling."""

        current_smoothed = self.calculate_smoothed_consumption()
        projected = current_smoothed + additional_cus

        headroom = self.capacity_cus - projected

        return {
            "current_smoothed_cus": current_smoothed,
            "projected_cus": projected,
            "capacity_cus": self.capacity_cus,
            "will_throttle": projected > self.capacity_cus,
            "headroom_cus": max(0, headroom),
            "recommendation": (
                "Safe to proceed" if headroom > additional_cus * 0.5
                else "Consider waiting or scaling" if headroom > 0
                else "Will likely throttle"
            )
        }

    def simulate_workload(self, consumption_pattern: list) -> dict:
        """Simulate workload and check for throttling."""

        from datetime import datetime, timedelta

        throttle_periods = []
        base_time = datetime.utcnow()

        for i, cus in enumerate(consumption_pattern):
            timestamp = base_time + timedelta(minutes=i)
            self.record_consumption(cus, timestamp)

            smoothed = self.calculate_smoothed_consumption()
            if smoothed > self.capacity_cus:
                throttle_periods.append({
                    "minute": i,
                    "consumption": cus,
                    "smoothed": smoothed,
                    "over_by": smoothed - self.capacity_cus
                })

        return {
            "total_minutes": len(consumption_pattern),
            "throttle_periods": len(throttle_periods),
            "throttle_details": throttle_periods,
            "max_consumption": max(consumption_pattern),
            "avg_consumption": sum(consumption_pattern) / len(consumption_pattern)
        }

# Usage
analyzer = SmoothingAnalyzer(capacity_cus=64, window_minutes=5)

# Simulate spiky workload
pattern = [40, 80, 100, 50, 30, 60, 90, 40, 35, 45]  # CU per minute

result = analyzer.simulate_workload(pattern)
print(f"Max consumption: {result['max_consumption']} CU")
print(f"Average consumption: {result['avg_consumption']:.1f} CU")
print(f"Throttle periods: {result['throttle_periods']}")
```

## Bursting Explained

Bursting allows temporary consumption above base capacity, with consumption accumulated and "paid back" later.

```python
class BurstingCalculator:
    """Calculate and manage burst capacity."""

    def __init__(
        self,
        base_capacity_cus: int,
        burst_limit_percent: int = 100
    ):
        self.base_cus = base_capacity_cus
        self.burst_limit_percent = burst_limit_percent
        self.max_burst_cus = base_capacity_cus * (burst_limit_percent / 100)
        self.accumulated_burst = 0

    def get_burst_capacity(self) -> dict:
        """Get current burst capacity status."""

        available_burst = self.max_burst_cus - self.accumulated_burst

        return {
            "base_capacity_cus": self.base_cus,
            "max_burst_cus": self.max_burst_cus,
            "total_available_cus": self.base_cus + self.max_burst_cus,
            "accumulated_burst_cus": self.accumulated_burst,
            "available_burst_cus": available_burst,
            "burst_percent_used": (self.accumulated_burst / self.max_burst_cus * 100)
                                   if self.max_burst_cus > 0 else 0
        }

    def consume(self, cus: int) -> dict:
        """Record consumption and track burst usage."""

        if cus <= self.base_cus:
            # Under base capacity - can recover burst
            recovery = min(self.accumulated_burst, self.base_cus - cus)
            self.accumulated_burst = max(0, self.accumulated_burst - recovery)

            return {
                "consumed_cus": cus,
                "from_base": cus,
                "from_burst": 0,
                "recovered_cus": recovery,
                "status": "normal"
            }
        else:
            # Over base - using burst
            burst_used = cus - self.base_cus
            self.accumulated_burst += burst_used

            if self.accumulated_burst > self.max_burst_cus:
                throttled = self.accumulated_burst - self.max_burst_cus
                self.accumulated_burst = self.max_burst_cus

                return {
                    "consumed_cus": cus - throttled,
                    "from_base": self.base_cus,
                    "from_burst": burst_used - throttled,
                    "throttled_cus": throttled,
                    "status": "throttled"
                }
            else:
                return {
                    "consumed_cus": cus,
                    "from_base": self.base_cus,
                    "from_burst": burst_used,
                    "throttled_cus": 0,
                    "status": "bursting"
                }

    def simulate_day(self, hourly_consumption: list) -> dict:
        """Simulate a day of consumption with burst tracking."""

        results = []
        for hour, cus in enumerate(hourly_consumption):
            result = self.consume(cus)
            result["hour"] = hour
            result["burst_accumulated"] = self.accumulated_burst
            results.append(result)

        throttled_hours = sum(1 for r in results if r["status"] == "throttled")
        burst_hours = sum(1 for r in results if r["status"] == "bursting")

        return {
            "hourly_results": results,
            "summary": {
                "normal_hours": 24 - throttled_hours - burst_hours,
                "burst_hours": burst_hours,
                "throttled_hours": throttled_hours,
                "max_burst_accumulated": max(r["burst_accumulated"] for r in results),
                "total_throttled_cus": sum(r.get("throttled_cus", 0) for r in results)
            }
        }

# Usage
calculator = BurstingCalculator(base_capacity_cus=64, burst_limit_percent=100)

# Simulate 24-hour pattern
hourly_pattern = [
    30, 25, 20, 20, 25, 40,   # 00:00 - 05:00 (low)
    60, 80, 90, 85, 75, 70,   # 06:00 - 11:00 (ramp up)
    65, 70, 75, 80, 85, 70,   # 12:00 - 17:00 (business hours)
    50, 40, 35, 30, 25, 25    # 18:00 - 23:00 (wind down)
]

simulation = calculator.simulate_day(hourly_pattern)
print(f"Burst hours: {simulation['summary']['burst_hours']}")
print(f"Throttled hours: {simulation['summary']['throttled_hours']}")
print(f"Max burst accumulated: {simulation['summary']['max_burst_accumulated']:.1f} CU")
```

## Optimizing for Smoothing and Bursting

### Workload Distribution

```python
class WorkloadDistributor:
    """Distribute workloads to optimize smoothing and bursting."""

    def __init__(self, capacity_cus: int):
        self.capacity_cus = capacity_cus

    def analyze_workload_timing(self, jobs: list) -> dict:
        """Analyze if jobs are well distributed."""

        # Group by hour
        hourly_load = {}
        for job in jobs:
            hour = job["scheduled_hour"]
            cus = job["estimated_cus"]
            hourly_load[hour] = hourly_load.get(hour, 0) + cus

        # Find problematic hours
        overloaded = {
            h: load for h, load in hourly_load.items()
            if load > self.capacity_cus
        }

        underloaded = {
            h: load for h, load in hourly_load.items()
            if load < self.capacity_cus * 0.3
        }

        return {
            "hourly_distribution": hourly_load,
            "overloaded_hours": overloaded,
            "underloaded_hours": underloaded,
            "peak_hour": max(hourly_load, key=hourly_load.get) if hourly_load else None,
            "peak_load": max(hourly_load.values()) if hourly_load else 0
        }

    def suggest_redistribution(self, jobs: list) -> list:
        """Suggest how to redistribute jobs for better smoothing."""

        analysis = self.analyze_workload_timing(jobs)
        suggestions = []

        # Find jobs to move
        for job in jobs:
            hour = job["scheduled_hour"]
            if hour in analysis["overloaded_hours"]:
                # Find alternative hour
                for alt_hour, load in sorted(analysis["hourly_distribution"].items(),
                                              key=lambda x: x[1]):
                    if load + job["estimated_cus"] <= self.capacity_cus * 0.8:
                        suggestions.append({
                            "job_name": job["name"],
                            "current_hour": hour,
                            "suggested_hour": alt_hour,
                            "reason": f"Hour {hour} is overloaded ({analysis['overloaded_hours'][hour]} CUs)"
                        })
                        break

        return suggestions

# Usage
distributor = WorkloadDistributor(capacity_cus=64)

jobs = [
    {"name": "ETL Job 1", "scheduled_hour": 8, "estimated_cus": 30},
    {"name": "ETL Job 2", "scheduled_hour": 8, "estimated_cus": 25},
    {"name": "Report Refresh", "scheduled_hour": 8, "estimated_cus": 20},
    {"name": "Data Quality", "scheduled_hour": 9, "estimated_cus": 15},
    {"name": "ML Training", "scheduled_hour": 2, "estimated_cus": 40}
]

analysis = distributor.analyze_workload_timing(jobs)
print(f"Peak hour: {analysis['peak_hour']} with {analysis['peak_load']} CUs")

suggestions = distributor.suggest_redistribution(jobs)
for s in suggestions:
    print(f"Move {s['job_name']} from hour {s['current_hour']} to {s['suggested_hour']}")
```

### Burst Budget Planning

```python
class BurstBudgetPlanner:
    """Plan burst budget allocation."""

    def __init__(self, base_cus: int, max_burst_percent: int = 100):
        self.base_cus = base_cus
        self.max_burst_cus = base_cus * (max_burst_percent / 100)
        self.daily_burst_budget = self.max_burst_cus * 24  # CU-hours

    def allocate_burst_budget(self, workloads: list) -> dict:
        """Allocate burst budget across workloads."""

        # Calculate total burst needed
        total_burst_needed = sum(
            max(0, w["peak_cus"] - self.base_cus) * w["duration_hours"]
            for w in workloads
        )

        if total_burst_needed <= self.daily_burst_budget:
            # All workloads can burst as needed
            allocations = [
                {
                    "workload": w["name"],
                    "allocated_burst_cu_hours": max(0, w["peak_cus"] - self.base_cus) * w["duration_hours"],
                    "status": "fully_allocated"
                }
                for w in workloads
            ]
        else:
            # Need to prioritize
            sorted_workloads = sorted(workloads, key=lambda x: x.get("priority", 5))
            remaining_budget = self.daily_burst_budget

            allocations = []
            for w in sorted_workloads:
                burst_needed = max(0, w["peak_cus"] - self.base_cus) * w["duration_hours"]
                allocated = min(burst_needed, remaining_budget)
                remaining_budget -= allocated

                allocations.append({
                    "workload": w["name"],
                    "requested_burst_cu_hours": burst_needed,
                    "allocated_burst_cu_hours": allocated,
                    "status": "fully_allocated" if allocated >= burst_needed else "partially_allocated"
                })

        return {
            "daily_burst_budget_cu_hours": self.daily_burst_budget,
            "total_burst_requested": total_burst_needed,
            "allocations": allocations,
            "budget_sufficient": total_burst_needed <= self.daily_burst_budget
        }

# Usage
planner = BurstBudgetPlanner(base_cus=64, max_burst_percent=100)

workloads = [
    {"name": "Critical ETL", "peak_cus": 100, "duration_hours": 2, "priority": 1},
    {"name": "BI Refresh", "peak_cus": 80, "duration_hours": 1, "priority": 2},
    {"name": "Analytics Job", "peak_cus": 90, "duration_hours": 3, "priority": 3}
]

allocation = planner.allocate_burst_budget(workloads)
print(f"Budget sufficient: {allocation['budget_sufficient']}")
for a in allocation["allocations"]:
    print(f"  {a['workload']}: {a['allocated_burst_cu_hours']:.0f} CU-hours ({a['status']})")
```

## Monitoring Smoothing and Bursting

```python
class SmoothingBurstingMonitor:
    """Monitor smoothing and bursting effectiveness."""

    def __init__(self, capacity_cus: int):
        self.capacity_cus = capacity_cus
        self.metrics = []

    def record_metrics(
        self,
        instant_cus: int,
        smoothed_cus: float,
        burst_accumulated: float
    ):
        """Record monitoring metrics."""

        from datetime import datetime

        self.metrics.append({
            "timestamp": datetime.utcnow().isoformat(),
            "instant_cus": instant_cus,
            "smoothed_cus": smoothed_cus,
            "burst_accumulated": burst_accumulated,
            "headroom": self.capacity_cus - smoothed_cus
        })

    def generate_health_report(self) -> dict:
        """Generate health report for smoothing/bursting."""

        if not self.metrics:
            return {"message": "No metrics recorded"}

        instant_values = [m["instant_cus"] for m in self.metrics]
        smoothed_values = [m["smoothed_cus"] for m in self.metrics]
        burst_values = [m["burst_accumulated"] for m in self.metrics]

        spikes_absorbed = sum(
            1 for i, s in zip(instant_values, smoothed_values)
            if i > self.capacity_cus and s <= self.capacity_cus
        )

        return {
            "metrics_count": len(self.metrics),
            "instant_avg": sum(instant_values) / len(instant_values),
            "instant_max": max(instant_values),
            "smoothed_avg": sum(smoothed_values) / len(smoothed_values),
            "smoothed_max": max(smoothed_values),
            "spikes_absorbed_by_smoothing": spikes_absorbed,
            "max_burst_accumulated": max(burst_values),
            "health_score": self._calculate_health_score()
        }

    def _calculate_health_score(self) -> int:
        """Calculate overall health score (0-100)."""

        if not self.metrics:
            return 0

        # Factors: low burst accumulation, good headroom, minimal spikes
        avg_headroom = sum(m["headroom"] for m in self.metrics) / len(self.metrics)
        max_burst = max(m["burst_accumulated"] for m in self.metrics)

        headroom_score = min(50, (avg_headroom / self.capacity_cus) * 100)
        burst_score = max(0, 50 - (max_burst / self.capacity_cus) * 50)

        return int(headroom_score + burst_score)

# Usage
monitor = SmoothingBurstingMonitor(capacity_cus=64)

# Simulate some metrics
monitor.record_metrics(instant_cus=70, smoothed_cus=55, burst_accumulated=10)
monitor.record_metrics(instant_cus=90, smoothed_cus=62, burst_accumulated=20)
monitor.record_metrics(instant_cus=50, smoothed_cus=58, burst_accumulated=15)

report = monitor.generate_health_report()
print(f"Health Score: {report['health_score']}/100")
print(f"Spikes absorbed by smoothing: {report['spikes_absorbed_by_smoothing']}")
```

## Best Practices

1. **Understand your patterns**: Know when spikes occur
2. **Distribute workloads**: Avoid concurrent peaks
3. **Monitor burst accumulation**: Don't exhaust burst budget
4. **Plan for recovery**: Allow low periods for burst recovery
5. **Right-size base capacity**: Balance smoothing benefits with cost

## Conclusion

Smoothing and bursting provide flexibility in handling variable workloads without constant throttling. Understanding how these features work helps you design workloads that maximize their benefits while staying within capacity limits.

Plan workloads to leverage smoothing for brief spikes and burst for sustained higher demand, while ensuring adequate recovery periods.
