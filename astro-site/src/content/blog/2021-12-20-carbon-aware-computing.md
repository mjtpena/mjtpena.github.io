---
title: "Carbon-Aware Computing: Building Climate-Conscious Applications"
author: Michael John Pena
draft: false
date: 2021-12-20
tags:
  - Carbon Aware
  - Sustainability
  - Green Software
  - Azure
  - Climate Tech

---

I wrote "Carbon-Aware Computing: Building Climate-Conscious Applications" to share practical, production-minded guidance on this topic.

## Understanding Grid Carbon Intensity

Electricity grids mix various energy sources. Carbon intensity varies by:
- Time of day (solar peaks midday)
- Weather (wind varies)
- Demand (peak hours often use dirtier peaker plants)
- Season (heating/cooling loads)

```python
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Optional
import httpx

@dataclass
class CarbonIntensityData:
    timestamp: datetime
    intensity_g_co2_kwh: float
    is_low_carbon: bool
    energy_mix: dict

class CarbonIntensityProvider:
    """Interface with carbon intensity data providers"""

    def __init__(self, provider: str = "electricitymap"):
        self.provider = provider
        self.base_urls = {
            "electricitymap": "https://api.electricitymap.org/v3",
            "watttime": "https://api2.watttime.org/v2"
        }

    async def get_current_intensity(self, region: str) -> CarbonIntensityData:
        """Get current carbon intensity for a region"""
        async with httpx.AsyncClient() as client:
            if self.provider == "electricitymap":
                response = await client.get(
                    f"{self.base_urls['electricitymap']}/carbon-intensity/latest",
                    params={"zone": region},
                    headers={"auth-token": self.api_key}
                )
                data = response.json()
                return CarbonIntensityData(
                    timestamp=datetime.fromisoformat(data["datetime"]),
                    intensity_g_co2_kwh=data["carbonIntensity"],
                    is_low_carbon=data["carbonIntensity"] < 200,
                    energy_mix=data.get("powerBreakdown", {})
                )

    async def get_forecast(
        self,
        region: str,
        hours: int = 24
    ) -> List[CarbonIntensityData]:
        """Get carbon intensity forecast"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_urls['electricitymap']}/carbon-intensity/forecast",
                params={"zone": region},
                headers={"auth-token": self.api_key}
            )
            data = response.json()

            forecasts = []
            for point in data["forecast"][:hours]:
                forecasts.append(CarbonIntensityData(
                    timestamp=datetime.fromisoformat(point["datetime"]),
                    intensity_g_co2_kwh=point["carbonIntensity"],
                    is_low_carbon=point["carbonIntensity"] < 200,
                    energy_mix={}
                ))

            return forecasts

    def find_optimal_window(
        self,
        forecasts: List[CarbonIntensityData],
        duration_hours: int,
        deadline: Optional[datetime] = None
    ) -> Optional[datetime]:
        """Find the optimal time window for lowest carbon intensity"""

        if deadline:
            forecasts = [f for f in forecasts if f.timestamp <= deadline]

        if len(forecasts) < duration_hours:
            return None

        # Sliding window to find lowest average intensity
        best_start = None
        best_avg_intensity = float('inf')

        for i in range(len(forecasts) - duration_hours + 1):
            window = forecasts[i:i + duration_hours]
            avg_intensity = sum(f.intensity_g_co2_kwh for f in window) / len(window)

            if avg_intensity < best_avg_intensity:
                best_avg_intensity = avg_intensity
                best_start = window[0].timestamp

        return best_start
```

## Carbon-Aware Kubernetes Scheduler

```yaml
# Carbon-aware pod scheduling
apiVersion: v1
kind: ConfigMap
metadata:
  name: carbon-aware-config
  namespace: kube-system
data:
  config.yaml: |
    carbonIntensityProvider: electricitymap
    regions:
      - name: australiaeast
        zone: AU-NSW
        priority: 3
      - name: northeurope
        zone: IE
        priority: 1
      - name: swedencentral
        zone: SE
        priority: 1
    thresholds:
      lowCarbon: 100
      mediumCarbon: 300
      highCarbon: 500
    scheduling:
      enableDeferral: true
      maxDeferralHours: 6
      preferLowCarbonRegions: true\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
