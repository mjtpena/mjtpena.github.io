---
title: "Microsoft Fabric Capacity Planning: Right-Sizing Your Data Platform"
description: "For development and test environments, implement auto-pause policies to reduce costs during inactive periods. Monitor utilization patterns and adjust…"
author: Michael John Peña
draft: false
date: 2025-10-03
tags:
  - Microsoft Fabric
  - Capacity Planning
  - Data Platform
  - Cost Management
  - Performance
---

## Understanding Fabric Capacity Units

Fabric capacities are measured in CUs, which are consumed differently by various workloads. Data Engineering, Data Science, and Real-Time Analytics each have distinct consumption patterns:

```python
from dataclasses import dataclass
from typing import Dict, List
from enum import Enum

class WorkloadType(Enum):
    DATA_ENGINEERING = "data_engineering"
    DATA_SCIENCE = "data_science"
    REAL_TIME_ANALYTICS = "real_time_analytics"
    DATA_WAREHOUSE = "data_warehouse"
    POWER_BI = "power_bi"

@dataclass
class CapacityRequirement:
    workload: WorkloadType
    peak_cu_per_hour: float
    average_cu_per_hour: float
    burst_duration_hours: float
    concurrent_users: int

def calculate_required_capacity(requirements: List[CapacityRequirement]) -> dict:
    """Calculate total capacity needed across workloads."""

    # Sum peak requirements with 20% headroom
    total_peak = sum(r.peak_cu_per_hour for r in requirements) * 1.2

    # Calculate weighted average for baseline
    total_average = sum(r.average_cu_per_hour for r in requirements)

    # Determine recommended SKU
    fabric_skus = {
        "F2": 2, "F4": 4, "F8": 8, "F16": 16,
        "F32": 32, "F64": 64, "F128": 128,
        "F256": 256, "F512": 512, "F1024": 1024
    }

    recommended_sku = None
    for sku, capacity in fabric_skus.items():
        if capacity >= total_peak:
            recommended_sku = sku
            break

    return {
        "peak_requirement": total_peak,
        "average_requirement": total_average,
        "recommended_sku": recommended_sku,
        "utilization_at_peak": (total_peak / fabric_skus.get(recommended_sku, 1)) * 100
    }
```

## Monitoring Capacity Utilization

Use the Fabric Capacity Metrics app to track actual consumption:

```python
import requests
from datetime import datetime, timedelta

class FabricCapacityMonitor:
    def __init__(self, workspace_id: str, access_token: str):
        self.workspace_id = workspace_id
        self.headers = {"Authorization": f"Bearer {access_token}"}
        self.base_url = "https://api.fabric.microsoft.com/v1"

    def get_capacity_metrics(self, days_back: int = 7) -> dict:
        """Retrieve capacity utilization metrics."""

        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=days_back)

        response = requests.get(
            f"{self.base_url}/capacities/{self.workspace_id}/metrics",
            headers=self.headers,
            params={
                "startDateTime": start_date.isoformat(),
                "endDateTime": end_date.isoformat(),
                "granularity": "hourly"
            }
        )

        metrics = response.json()

        return {
            "peak_utilization": max(m["utilizationPercent"] for m in metrics["values"]),
            "average_utilization": sum(m["utilizationPercent"] for m in metrics["values"]) / len(metrics["values"]),
            "throttling_events": sum(1 for m in metrics["values"] if m["throttled"])
        }
```

## Implementing Auto-Pause for Cost Savings

For development and test environments, implement auto-pause policies to reduce costs during inactive periods. Monitor utilization patterns and adjust capacity reservations quarterly based on actual usage data.
