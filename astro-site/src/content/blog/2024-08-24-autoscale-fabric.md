---
title: "Autoscale in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-08-24
tags:
  - Microsoft Fabric
  - Autoscale
  - Capacity
  - Cost Management
  - Performance

---

I wrote "Autoscale in Microsoft Fabric" to share practical, production-minded guidance on this topic.

## How Autoscale Works

```
Autoscale Flow:
┌─────────────────────────────────────────────────────────────┐
│                    Load Monitoring                           │
│                          │                                   │
│                    ┌─────▼─────┐                            │
│                    │  Demand   │                            │
│                    │  Metrics  │                            │
│                    └─────┬─────┘                            │
│                          │                                   │
│         ┌────────────────┼────────────────┐                 │
│         │                │                │                 │
│    ┌────▼────┐     ┌─────▼─────┐    ┌────▼────┐            │
│    │  Low    │     │  Normal   │    │  High   │            │
│    │ Demand  │     │  Demand   │    │ Demand  │            │
│    └────┬────┘     └─────┬─────┘    └────┬────┘            │
│         │                │                │                 │
│    ┌────▼────┐     ┌─────▼─────┐    ┌────▼────┐            │
│    │Scale In │     │No Change  │    │Scale Out│            │
│    │ (Pause) │     │           │    │(Burst)  │            │
│    └─────────┘     └───────────┘    └─────────┘            │
│                                                             │
│                    Base Capacity: F32                       │
│                    Max Scale: F64 (100% burst)              │
└─────────────────────────────────────────────────────────────┘
```

## Configuring Autoscale

### Basic Autoscale Settings

```python
class AutoscaleConfig:
    """Configure autoscale settings for Fabric capacity."""

    def __init__(self, capacity_id: str):
        self.capacity_id = capacity_id
        self.config = {}

    def configure_autoscale(
        self,
        enabled: bool = True,
        max_scale_percent: int = 100,
        scale_up_threshold: int = 80,
        scale_down_threshold: int = 30,
        cooldown_minutes: int = 10
    ):
        """Configure autoscale parameters."""

        self.config = {
            "enabled": enabled,
            "max_scale_percent": max_scale_percent,  # Up to 100% additional
            "thresholds": {
                "scale_up_percent": scale_up_threshold,
                "scale_down_percent": scale_down_threshold
            },
            "cooldown_minutes": cooldown_minutes,
            "schedule": None  # Can add schedule-based rules
        }

        return self.config

    def add_schedule_rule(
        self,
        name: str,
        start_time: str,
        end_time: str,
        days: list,
        min_capacity_percent: int
    ):
        """Add schedule-based autoscale rule."""

        if self.config.get("schedule") is None:
            self.config["schedule"] = []

        self.config["schedule"].append({
            "name": name,
            "start_time": start_time,
            "end_time": end_time,
            "days": days,
            "min_capacity_percent": min_capacity_percent
        })

    def get_effective_config(self) -> dict:
        """Get the effective configuration."""
        return self.config

# Usage
autoscale = AutoscaleConfig("capacity-123")

# Basic configuration
autoscale.configure_autoscale(
    enabled=True,
    max_scale_percent=100,
    scale_up_threshold=80,
    scale_down_threshold=30,
    cooldown_minutes=10
)

# Add schedule for business hours
autoscale.add_schedule_rule(
    name="Business Hours",
    start_time="08:00",
    end_time="18:00",
    days=["Mon", "Tue", "Wed", "Thu", "Fri"],
    min_capacity_percent=50  # Maintain at least 50% during business hours
)

# Add schedule for overnight batch
autoscale.add_schedule_rule(
    name="Nightly Batch",
    start_time="02:00",
    end_time="05:00",
    days=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    min_capacity_percent=100  # Full capacity for batch jobs
)

print(autoscale.get_effective_config())
```

### Autoscale via Azure Portal/API

```python
import requests
from azure.identity import DefaultAzureCredential

class FabricCapacityAPI:
    """Interact with Fabric capacity management APIs."""

    def __init__(self, subscription_id: str, resource_group: str):
        self.subscription_id = subscription_id
        self.resource_group = resource_group
        self.credential = DefaultAzureCredential()
        self.base_url = "https://management.azure.com"

    def _get_headers(self):
        token = self.credential.get_token("https://management.azure.com/.default")
        return {
            "Authorization": f"Bearer {token.token}",
            "Content-Type": "application/json"
        }

    def enable_autoscale(
        self,
        capacity_name: str,
        max_capacity_units: int
    ) -> dict:
        """Enable autoscale on capacity."""

        url = (
            f"{self.base_url}/subscriptions/{self.subscription_id}"
            f"/resourceGroups/{self.resource_group}"
            f"/providers/Microsoft.Fabric/capacities/{capacity_name}"
            f"?api-version=2023-11-01"
        )

        # Get current capacity
        response = requests.get(url, headers=self._get_headers())
        current = response.json()

        # Update with autoscale settings
        current["properties"]["administration"] = {
            "autoscale": {
                "enabled": True,
                "maxCapacityUnits": max_capacity_units
            }
        }

        response = requests.put(
            url,
            headers=self._get_headers(),
            json=current
        )

        return response.json()

    def get_autoscale_status(self, capacity_name: str) -> dict:
        """Get current autoscale status."""

        url = (
            f"{self.base_url}/subscriptions/{self.subscription_id}"
            f"/resourceGroups/{self.resource_group}"
            f"/providers/Microsoft.Fabric/capacities/{capacity_name}"
            f"?api-version=2023-11-01"
        )

        response = requests.get(url, headers=self._get_headers())
        data = response.json()

        return {
            "capacity_name": capacity_name,
            "sku": data.get("sku", {}).get("name"),
            "autoscale_enabled": data.get("properties", {}).get("administration", {}).get("autoscale", {}).get("enabled", False),
            "current_state": data.get("properties", {}).get("state")
        }

# Usage
api = FabricCapacityAPI(
    subscription_id="sub-id",
    resource_group="fabric-rg"
)

# Enable autoscale
api.enable_autoscale(
    capacity_name="my-fabric-capacity",
    max_capacity_units=128  # F128 max
)

# Check status
status = api.get_autoscale_status("my-fabric-capacity")
print(f"Autoscale enabled: {status['autoscale_enabled']}")
```

## Autoscale Behaviors

### Scale Up (Burst)

```python
class AutoscaleAnalyzer:
    """Analyze autoscale behavior and patterns."""

    def __init__(self):
        self.scale_events = []

    def record_scale_event(
        self,
        event_type: str,  # "scale_up" or "scale_down"
        trigger_metric: str,
        metric_value: float,
        from_cus: int,
        to_cus: int
    ):
        """Record a scaling event."""

        from datetime import datetime

        self.scale_events.append({
            "timestamp": datetime.utcnow().isoformat(),
            "event_type": event_type,
            "trigger_metric": trigger_metric,
            "metric_value": metric_value,
            "from_cus": from_cus,
            "to_cus": to_cus
        })

    def analyze_scale_patterns(self) -> dict:
        """Analyze scaling patterns."""

        if not self.scale_events:
            return {"message": "No scale events recorded"}

        scale_ups = [e for e in self.scale_events if e["event_type"] == "scale_up"]
        scale_downs = [e for e in self.scale_events if e["event_type"] == "scale_down"]

        return {
            "total_events": len(self.scale_events),
            "scale_ups": len(scale_ups),
            "scale_downs": len(scale_downs),
            "most_common_trigger": self._most_common_trigger(),
            "recommendations": self._generate_recommendations()
        }

    def _most_common_trigger(self) -> str:
        triggers = {}
        for event in self.scale_events:
            trigger = event["trigger_metric"]
            triggers[trigger] = triggers.get(trigger, 0) + 1

        return max(triggers, key=triggers.get) if triggers else "none"

    def _generate_recommendations(self) -> list:
        recommendations = []

        # Frequent scale-ups might indicate base capacity too low
        scale_ups = [e for e in self.scale_events if e["event_type"] == "scale_up"]
        if len(scale_ups) > 10:  # More than 10 in the analysis period
            recommendations.append(
                "Frequent scale-ups detected. Consider increasing base capacity."
            )

        # Rapid oscillation might indicate thresholds too close
        if len(self.scale_events) > 20:
            recommendations.append(
                "High scaling frequency. Consider adjusting thresholds or cooldown period."
            )

        return recommendations

# Simulated analysis
analyzer = AutoscaleAnalyzer()

# Record some events
analyzer.record_scale_event("scale_up", "cpu_percent", 85, 32, 48)
analyzer.record_scale_event("scale_up", "queue_length", 15, 48, 64)
analyzer.record_scale_event("scale_down", "cpu_percent", 25, 64, 48)

patterns = analyzer.analyze_scale_patterns()
print(f"Scale events: {patterns['total_events']}")
print(f"Most common trigger: {patterns['most_common_trigger']}")
```

### Smoothing and Bursting

```python
class SmoothingConfig:
    """Configure smoothing behavior for capacity consumption."""

    def __init__(self, base_capacity_cus: int):
        self.base_cus = base_capacity_cus
        self.smoothing_window_minutes = 5

    def explain_smoothing(self) -> dict:
        """Explain how smoothing works."""

        return {
            "concept": "Smoothing averages consumption over a time window",
            "benefit": "Prevents throttling from brief spikes",
            "how_it_works": [
                "1. Capacity consumption is measured every few seconds",
                "2. Consumption is averaged over a smoothing window (e.g., 5 min)",
                "3. Throttling only occurs if average exceeds capacity",
                "4. Brief spikes above capacity are absorbed"
            ],
            "example": {
                "scenario": "5-minute window, 64 CU capacity",
                "minute_1": "100 CU consumed",
                "minute_2": "30 CU consumed",
                "minute_3": "40 CU consumed",
                "minute_4": "50 CU consumed",
                "minute_5": "80 CU consumed",
                "average": "60 CU (no throttling)",
                "without_smoothing": "Minute 1 would throttle"
            }
        }

    def calculate_burst_capacity(self, max_scale_percent: int) -> dict:
        """Calculate burst capacity available."""

        burst_cus = self.base_cus * (max_scale_percent / 100)
        total_available = self.base_cus + burst_cus

        return {
            "base_capacity_cus": self.base_cus,
            "burst_capacity_cus": burst_cus,
            "total_available_cus": total_available,
            "burst_cost_multiplier": 1.0,  # Burst uses same rate
            "billing_note": "Burst consumption billed at same rate as base"
        }

# Usage
smoothing = SmoothingConfig(base_capacity_cus=64)

explanation = smoothing.explain_smoothing()
print("How Smoothing Works:")
for step in explanation["how_it_works"]:
    print(f"  {step}")

burst = smoothing.calculate_burst_capacity(max_scale_percent=100)
print(f"\nBurst Capacity: {burst['base_capacity_cus']} base + {burst['burst_capacity_cus']} burst = {burst['total_available_cus']} total CUs")
```

## Monitoring Autoscale

### Tracking Autoscale Metrics

```python
class AutoscaleMonitor:
    """Monitor autoscale performance and efficiency."""

    def __init__(self, capacity_id: str):
        self.capacity_id = capacity_id

    def get_autoscale_metrics(self, hours: int = 24) -> dict:
        """Get autoscale-related metrics."""

        # This would connect to monitoring APIs
        # Simulated response
        return {
            "period_hours": hours,
            "base_capacity_cus": 64,
            "metrics": {
                "avg_consumed_cus": 52,
                "peak_consumed_cus": 95,
                "burst_usage_percent": 15,  # % of time in burst
                "scale_events": 8,
                "throttled_requests": 0
            },
            "cost_analysis": {
                "base_cost_estimate": 150.00,
                "burst_cost_estimate": 22.50,
                "total_cost": 172.50,
                "cost_without_autoscale": 300.00,  # If provisioned for peak
                "savings_percent": 42.5
            }
        }

    def generate_autoscale_report(self, metrics: dict) -> str:
        """Generate autoscale performance report."""

        report = f"""
# Autoscale Performance Report

## Capacity Utilization
- Base Capacity: {metrics['base_capacity_cus']} CUs
- Average Consumption: {metrics['metrics']['avg_consumed_cus']} CUs ({metrics['metrics']['avg_consumed_cus']/metrics['base_capacity_cus']*100:.1f}%)
- Peak Consumption: {metrics['metrics']['peak_consumed_cus']} CUs
- Time in Burst: {metrics['metrics']['burst_usage_percent']}%

## Scaling Activity
- Scale Events: {metrics['metrics']['scale_events']}
- Throttled Requests: {metrics['metrics']['throttled_requests']}

## Cost Analysis
- Base Cost: ${metrics['cost_analysis']['base_cost_estimate']:.2f}
- Burst Cost: ${metrics['cost_analysis']['burst_cost_estimate']:.2f}
- Total Cost: ${metrics['cost_analysis']['total_cost']:.2f}
- Cost if Fixed at Peak: ${metrics['cost_analysis']['cost_without_autoscale']:.2f}
- Savings: {metrics['cost_analysis']['savings_percent']:.1f}%

## Recommendations
"""
        # Add recommendations based on metrics
        if metrics['metrics']['burst_usage_percent'] > 50:
            report += "- Consider increasing base capacity (frequent bursting)\n"

        if metrics['metrics']['avg_consumed_cus'] < metrics['base_capacity_cus'] * 0.3:
            report += "- Consider reducing base capacity (low average utilization)\n"

        if metrics['metrics']['throttled_requests'] > 0:
            report += "- Review workload patterns (throttling occurred)\n"

        return report

# Usage
monitor = AutoscaleMonitor("capacity-123")

metrics = monitor.get_autoscale_metrics(hours=24)
report = monitor.generate_autoscale_report(metrics)
print(report)
```

## Best Practices

### Autoscale Optimization

```python
autoscale_best_practices = {
    "right_size_base": {
        "description": "Set base capacity to handle typical load",
        "guidance": "Base should handle 70-80% of daily workload",
        "benefit": "Minimizes burst costs while ensuring performance"
    },
    "appropriate_burst_limit": {
        "description": "Set burst limit based on peak requirements",
        "guidance": "Allow burst to 100% for most workloads",
        "benefit": "Handles peaks without over-provisioning"
    },
    "tune_thresholds": {
        "description": "Adjust scale triggers based on workload",
        "guidance": "Scale up at 80%, scale down at 30%",
        "benefit": "Prevents thrashing while remaining responsive"
    },
    "use_schedules": {
        "description": "Pre-warm capacity for known peaks",
        "guidance": "Schedule higher minimum before batch jobs",
        "benefit": "Faster response to predictable demand"
    },
    "monitor_regularly": {
        "description": "Review autoscale patterns weekly",
        "guidance": "Adjust based on actual usage patterns",
        "benefit": "Continuous optimization"
    }
}

def get_autoscale_checklist() -> list:
    """Get autoscale configuration checklist."""

    return [
        "Base capacity sized for typical workload",
        "Burst limit allows for peak handling",
        "Scale thresholds prevent oscillation",
        "Cooldown period prevents rapid scaling",
        "Schedules configured for predictable peaks",
        "Monitoring alerts set for throttling",
        "Cost alerts set for unexpected burst usage"
    ]

# Print checklist
print("Autoscale Configuration Checklist:")
for item in get_autoscale_checklist():
    print(f"  [ ] {item}")
```

## Conclusion

Autoscale in Microsoft Fabric provides the flexibility to handle variable workloads while optimizing costs. Configure base capacity for typical load, allow burst for peaks, and use schedules for predictable patterns.

Regular monitoring ensures your autoscale configuration remains optimal as workload patterns evolve.

