---
title: "Azure OpenAI PTU: Provisioned Throughput Units Explained"
author: Michael John Peña
draft: false
date: 2024-02-11
tags:
  - Azure OpenAI
  - PTU
  - Provisioned Throughput
  - Enterprise AI
  - Capacity Planning
---

## PTU vs Pay-As-You-Go

| Aspect | Pay-As-You-Go | PTU |
|--------|---------------|-----|
| Pricing | Per token | Per PTU-hour |
| Throughput | Shared, variable | Dedicated, consistent |
| Latency | Variable | Lower, consistent |
| Commitment | None | Monthly |
| Best For | Variable workloads | High-volume production |

## When to Use PTU

```python
def should_use_ptu(
    daily_requests: int,
    avg_tokens_per_request: int,
    latency_sensitive: bool,
    predictable_volume: bool
) -> dict:
    """Evaluate if PTU makes sense."""

    monthly_tokens = daily_requests * avg_tokens_per_request * 30

    # PTU typically makes sense above 10M tokens/month
    volume_threshold = monthly_tokens > 10_000_000

    # Latency-sensitive applications benefit more
    latency_benefit = latency_sensitive

    # Predictable workloads maximize PTU utilization
    utilization_benefit = predictable_volume

    recommendation = volume_threshold and (latency_benefit or utilization_benefit)

    return {
        "recommend_ptu": recommendation,
        "monthly_tokens": monthly_tokens,
        "reasons": {
            "high_volume": volume_threshold,
            "latency_sensitive": latency_benefit,
            "predictable": utilization_benefit
        }
    }
```

## Capacity Planning

```python
def calculate_ptu_requirement(
    target_requests_per_minute: int,
    model: str,
    avg_input_tokens: int,
    avg_output_tokens: int
) -> int:
    """Estimate PTU requirement for workload."""

    # PTU capacity varies by model (approximate)
    ptu_capacity = {
        "gpt-4": {"tpm_per_ptu": 8000},
        "gpt-4-turbo": {"tpm_per_ptu": 18000},
        "gpt-35-turbo": {"tpm_per_ptu": 60000}
    }

    tokens_per_minute = target_requests_per_minute * (avg_input_tokens + avg_output_tokens)
    tpm_per_ptu = ptu_capacity.get(model, ptu_capacity["gpt-4-turbo"])["tpm_per_ptu"]

    required_ptu = math.ceil(tokens_per_minute / tpm_per_ptu)

    return {
        "tokens_per_minute": tokens_per_minute,
        "required_ptu": required_ptu,
        "model": model
    }
```

## Cost Comparison

```python
def compare_ptu_vs_payg(
    monthly_tokens: int,
    model: str = "gpt-4-turbo"
) -> dict:
    """Compare PTU vs pay-as-you-go costs."""

    # Approximate pricing
    payg_cost_per_1k = 0.01 + 0.03  # input + output average
    ptu_cost_per_hour = 6.0  # Approximate, varies by region

    payg_monthly = (monthly_tokens / 1000) * payg_cost_per_1k
    ptu_monthly = ptu_cost_per_hour * 24 * 30  # $4,320/month per PTU

    # Determine required PTUs
    tokens_per_minute = monthly_tokens / (30 * 24 * 60)
    required_ptu = max(1, math.ceil(tokens_per_minute / 18000))

    ptu_total_monthly = ptu_monthly * required_ptu

    return {
        "payg_monthly": payg_monthly,
        "ptu_monthly": ptu_total_monthly,
        "ptu_count": required_ptu,
        "savings": payg_monthly - ptu_total_monthly,
        "ptu_recommended": ptu_total_monthly < payg_monthly
    }
```

## Monitoring PTU Usage

```python
class PTUMonitor:
    def __init__(self, capacity_ptu: int):
        self.capacity = capacity_ptu
        self.usage_log = []

    def record_request(self, tokens: int, latency_ms: float):
        self.usage_log.append({
            "timestamp": datetime.utcnow(),
            "tokens": tokens,
            "latency_ms": latency_ms
        })

    def get_utilization(self, window_minutes: int = 5) -> float:
        cutoff = datetime.utcnow() - timedelta(minutes=window_minutes)
        recent = [u for u in self.usage_log if u["timestamp"] > cutoff]

        tokens_used = sum(u["tokens"] for u in recent)
        capacity_tokens = self.capacity * 18000 * window_minutes  # TPM * minutes

        return tokens_used / capacity_tokens if capacity_tokens > 0 else 0
```

## Best Practices

1. **Right-size capacity** - Start with estimated need, adjust based on monitoring
2. **Monitor utilization** - Target 70-80% for efficiency
3. **Plan for peaks** - Include headroom for traffic spikes
4. **Use regional capacity** - Deploy in regions with availability
5. **Combine with PAYG** - Use PTU for baseline, PAYG for overflow

## Conclusion

PTU provides predictable performance and costs for high-volume Azure OpenAI workloads. Evaluate based on your volume, latency requirements, and workload predictability.
