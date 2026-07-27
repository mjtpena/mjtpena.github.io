---
title: "Microsoft Fabric Licensing and Capacity Planning Guide"
author: "Michael John Peña"
draft: false
date: 2023-11-11
tags: ["Microsoft Fabric", "Licensing", "Capacity", "Azure", "Planning"]

---

I wrote "Microsoft Fabric Licensing and Capacity Planning Guide" to share practical, production-minded guidance on this topic.

Fabric licensing is genuinely different from the Azure pay-as-you-go mental model that most Azure practitioners are familiar with, and understanding the capacity model upfront saves significant planning pain later. Fabric runs on a reservation model: you purchase a Fabric Capacity (F-SKU) that provides a fixed number of Capacity Units (CUs) per hour, and all Fabric workloads in workspaces assigned to that capacity share those CUs. The SKUs range from F2 (2 CUs, minimum viable for development) to F2048 (2048 CUs, large enterprise). The critical behaviour: Fabric uses a smoothing algorithm that allows short bursts above capacity to be absorbed by unused capacity from adjacent periods, but sustained over-consumption causes throttling. The right sizing approach: instrument your workloads in the Capacity Metrics app during a representative load period, then purchase the F-SKU that keeps peak consumption within a comfortable margin of your reserved CUs.

## Fabric Licensing Options

### 1. Fabric Capacity (Pay-as-you-go)

Azure-based consumption model with Capacity Units (CUs):

| SKU | CUs | Memory | Spark vCores | Ideal For |
|-----|-----|--------|--------------|-----------|
| F2 | 2 | 3 GB | 2 | Dev/Test |
| F4 | 4 | 6 GB | 4 | Small teams |
| F8 | 8 | 12 GB | 8 | Department |
| F16 | 16 | 24 GB | 16 | Medium workloads |
| F32 | 32 | 48 GB | 32 | Large workloads |
| F64 | 64 | 96 GB | 64 | Enterprise |
| F128+ | 128+ | 192+ GB | 128+ | Large enterprise |

### 2. Power BI Premium per Capacity

Existing P SKUs now include Fabric workloads:

```python
# Capacity SKU mapping
capacity_mapping = {
    "P1": {"cus": 8, "fabric_sku": "F8"},
    "P2": {"cus": 16, "fabric_sku": "F16"},
    "P3": {"cus": 32, "fabric_sku": "F32"},
    "P4": {"cus": 64, "fabric_sku": "F64"},
    "P5": {"cus": 128, "fabric_sku": "F128"}
}

def get_equivalent_fabric_sku(pbi_sku: str) -> dict:
    return capacity_mapping.get(pbi_sku, {"error": "Unknown SKU"})
```

### 3. Fabric Trial

60-day trial with F64 equivalent capacity - perfect for evaluation.

## Capacity Planning Framework

### Step 1: Assess Current Workloads

```python
from dataclasses import dataclass
from typing import List
import json

@dataclass
class Workload:
    name: str
    type: str  # 'spark', 'warehouse', 'realtime', 'powerbi'
    daily_runs: int
    avg_duration_minutes: float
    peak_concurrent_users: int
    data_volume_gb: float

def assess_workloads(workloads: List[Workload]) -> dict:
    """Assess total capacity needs from workloads."""
    total_compute_hours = sum(
        w.daily_runs * w.avg_duration_minutes / 60
        for w in workloads
    )

    peak_users = max(w.peak_concurrent_users for w in workloads)
    total_storage = sum(w.data_volume_gb for w in workloads)

    return {
        "daily_compute_hours": total_compute_hours,
        "peak_concurrent_users": peak_users,
        "total_storage_gb": total_storage,
        "workload_breakdown": {
            w_type: sum(
                w.daily_runs * w.avg_duration_minutes
                for w in workloads if w.type == w_type
            )
            for w_type in set(w.type for w in workloads)
        }
    }

# Example assessment
workloads = [
    Workload("ETL Pipeline", "spark", 24, 30, 1, 500),
    Workload("Reports Refresh", "powerbi", 48, 5, 50, 100),
    Workload("Ad-hoc Queries", "warehouse", 100, 2, 20, 200),
    Workload("Stream Processing", "realtime", 1, 1440, 5, 50)
]

assessment = assess_workloads(workloads)
print(json.dumps(assessment, indent=2))
```

### Step 2: Calculate Required Capacity

```python
def recommend_capacity(assessment: dict, growth_factor: float = 1.3) -> dict:
    """Recommend Fabric capacity based on assessment."""
    compute_hours = assessment["daily_compute_hours"]
    peak_users = assessment["peak_concurrent_users"]

    # Base calculation
    base_cus = 0

    # Spark workloads: ~2 CUs per concurrent Spark job
    spark_cus = assessment["workload_breakdown"].get("spark", 0) / 60 * 2

    # Warehouse: ~1 CU per 10 concurrent queries
    warehouse_cus = peak_users / 10

    # Power BI: ~4 CUs per 100 concurrent viewers
    powerbi_cus = peak_users / 100 * 4

    # Real-time: ~8 CUs minimum for always-on processing
    realtime_cus = 8 if assessment["workload_breakdown"].get("realtime", 0) > 0 else 0

    total_cus = (spark_cus + warehouse_cus + powerbi_cus + realtime_cus) * growth_factor

    # Map to SKU
    skus = [
        ("F2", 2), ("F4", 4), ("F8", 8), ("F16", 16),
        ("F32", 32), ("F64", 64), ("F128", 128), ("F256", 256)
    ]

    recommended_sku = "F256"  # default to largest
    for sku_name, sku_cus in skus:
        if sku_cus >= total_cus:
            recommended_sku = sku_name
            break

    return {
        "calculated_cus": round(total_cus, 1),
        "recommended_sku": recommended_sku,
        "breakdown": {
            "spark": round(spark_cus, 1),
            "warehouse": round(warehouse_cus, 1),
            "powerbi": round(powerbi_cus, 1),
            "realtime": round(realtime_cus, 1)
        },
        "growth_factor_applied": growth_factor
    }

recommendation = recommend_capacity(assessment)
print(json.dumps(recommendation, indent=2))
```

### Step 3: Cost Estimation

```python
# Azure pricing (approximate, check current prices)
FABRIC_PRICING = {
    "F2": {"hourly": 0.36, "monthly_reserved": 180},
    "F4": {"hourly": 0.72, "monthly_reserved": 360},
    "F8": {"hourly": 1.44, "monthly_reserved": 720},
    "F16": {"hourly": 2.88, "monthly_reserved": 1440},
    "F32": {"hourly": 5.76, "monthly_reserved": 2880},
    "F64": {"hourly": 11.52, "monthly_reserved": 5760},
    "F128": {"hourly": 23.04, "monthly_reserved": 11520}
}

def estimate_costs(sku: str, usage_pattern: str = "always_on") -> dict:
    """Estimate monthly costs for a Fabric SKU."""
    if sku not in FABRIC_PRICING:
        return {"error": "Unknown SKU"}

    pricing = FABRIC_PRICING[sku]

    if usage_pattern == "always_on":
        payg_cost = pricing["hourly"] * 24 * 30
        reserved_cost = pricing["monthly_reserved"]
        savings = payg_cost - reserved_cost
    elif usage_pattern == "business_hours":  # 10 hours/day, weekdays
        payg_cost = pricing["hourly"] * 10 * 22
        reserved_cost = pricing["monthly_reserved"]  # Still need capacity
        savings = payg_cost - reserved_cost if payg_cost > reserved_cost else 0
    else:  # burst
        payg_cost = pricing["hourly"] * 8 * 30  # 8 hours average
        reserved_cost = pricing["monthly_reserved"]
        savings = 0

    return {
        "sku": sku,
        "pattern": usage_pattern,
        "payg_monthly": round(payg_cost, 2),
        "reserved_monthly": reserved_cost,
        "savings_with_reserved": round(savings, 2),
        "recommendation": "reserved" if savings > 0 else "payg"
    }

# Compare costs
for pattern in ["always_on", "business_hours", "burst"]:
    estimate = estimate_costs("F32", pattern)
    print(f"{pattern}: ${estimate['payg_monthly']} PAYG vs ${estimate['reserved_monthly']} Reserved")
```

## Autoscale and Burst

Fabric supports smoothing and burst capabilities:

```python
# Capacity settings configuration
capacity_config = {
    "sku": "F32",
    "smoothing": {
        "enabled": True,
        "window_minutes": 5  # Average usage over 5-minute windows
    },
    "burst": {
        "enabled": True,
        "max_burst_factor": 1.5,  # Can burst to 150% of capacity
        "accumulated_seconds": 86400  # 24 hours of burst credits
    },
    "auto_pause": {
        "enabled": False,  # Only for dev/test
        "idle_minutes": 30
    }
}

def calculate_burst_availability(
    base_capacity: int,
    burst_factor: float,
    usage_history: List[float]
) -> dict:
    """Calculate available burst capacity."""
    avg_usage = sum(usage_history) / len(usage_history)
    underutilization = max(0, base_capacity - avg_usage)

    # Burst credits accumulate when under capacity
    burst_credits = underutilization * len(usage_history)
    max_burst = base_capacity * burst_factor

    return {
        "base_capacity": base_capacity,
        "average_usage": round(avg_usage, 1),
        "burst_credits_available": round(burst_credits, 1),
        "max_burst_capacity": max_burst,
        "can_burst": burst_credits > 0
    }
```

## Best Practices

1. **Start small, scale up** - Begin with F8 for most workloads
2. **Use reserved capacity** for predictable workloads
3. **Enable smoothing** to handle usage spikes
4. **Monitor capacity metrics** in the Fabric admin portal
5. **Consider multi-region** for global deployments

Tomorrow, we'll explore Fabric Governance and how to manage your data platform securely.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
