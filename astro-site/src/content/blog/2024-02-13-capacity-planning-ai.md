---
title: "Capacity Planning for AI Workloads: A Practical Guide"
author: Michael John Peña
draft: false
date: 2024-02-13
tags:
  - Capacity Planning
  - AI Infrastructure
  - Azure
  - Scaling
  - Enterprise AI

---

I wrote "Capacity Planning for AI Workloads: A Practical Guide" to share practical, production-minded guidance on this topic.

## Capacity Dimensions

### 1. Compute Capacity

```python
def estimate_compute_requirements(
    requests_per_second: float,
    avg_tokens_input: int,
    avg_tokens_output: int,
    target_latency_ms: int
) -> dict:
    """Estimate compute capacity for LLM workload."""

    # Rough estimates - adjust based on actual benchmarks
    tokens_per_second = requests_per_second * (avg_tokens_input + avg_tokens_output)

    # GPT-4 Turbo approximate throughput
    tokens_per_ptu_second = 300  # Varies significantly

    required_ptu = math.ceil(tokens_per_second / tokens_per_ptu_second)

    return {
        "tokens_per_second": tokens_per_second,
        "required_ptu": required_ptu,
        "requests_per_second": requests_per_second,
        "estimated_latency_ok": required_ptu * tokens_per_ptu_second >= tokens_per_second
    }
```

### 2. Storage Capacity

```python
def estimate_storage_requirements(
    document_count: int,
    avg_document_size_kb: int,
    vector_dimensions: int = 1536
) -> dict:
    """Estimate storage for RAG system."""

    # Raw document storage
    raw_storage_gb = (document_count * avg_document_size_kb) / (1024 * 1024)

    # Vector storage (4 bytes per float32 dimension)
    chunks_per_doc = 5  # Assume 5 chunks per document
    vector_storage_gb = (document_count * chunks_per_doc * vector_dimensions * 4) / (1024 ** 3)

    # Index overhead (approximately 2x vectors)
    index_storage_gb = vector_storage_gb * 2

    return {
        "raw_storage_gb": raw_storage_gb,
        "vector_storage_gb": vector_storage_gb,
        "index_storage_gb": index_storage_gb,
        "total_storage_gb": raw_storage_gb + vector_storage_gb + index_storage_gb
    }
```

### 3. Memory Capacity

```python
def estimate_memory_requirements(
    concurrent_requests: int,
    context_window_tokens: int,
    model_parameters: str
) -> dict:
    """Estimate memory for serving."""

    # Token memory (approximate)
    bytes_per_token = 4  # Rough estimate
    context_memory_per_request = context_window_tokens * bytes_per_token

    # Model memory (varies dramatically by model)
    model_memory = {
        "7B": 14,    # GB for inference
        "13B": 26,
        "70B": 140
    }

    total_context_memory = concurrent_requests * context_memory_per_request
    total_model_memory = model_memory.get(model_parameters, 20) * 1024 ** 3

    return {
        "context_memory_gb": total_context_memory / (1024 ** 3),
        "model_memory_gb": total_model_memory / (1024 ** 3),
        "total_memory_gb": (total_context_memory + total_model_memory) / (1024 ** 3)
    }
```

## Growth Planning

```python
class CapacityPlanner:
    def __init__(self, current_usage: dict, growth_rate_monthly: float = 0.1):
        self.current = current_usage
        self.growth_rate = growth_rate_monthly

    def project_capacity(self, months: int) -> list[dict]:
        """Project capacity needs over time."""

        projections = []

        for month in range(months):
            growth_factor = (1 + self.growth_rate) ** month

            projections.append({
                "month": month,
                "requests_per_day": self.current["requests_per_day"] * growth_factor,
                "storage_gb": self.current["storage_gb"] * growth_factor,
                "estimated_cost": self.current["monthly_cost"] * growth_factor
            })

        return projections
```

## Best Practices

1. **Start with benchmarks** - Measure actual performance
2. **Plan for peaks** - 2-3x average for safety
3. **Build in headroom** - 20-30% buffer
4. **Monitor continuously** - Adjust based on reality
5. **Review quarterly** - Capacity needs change

## Conclusion

AI capacity planning requires understanding compute, storage, and memory requirements. Start with estimates, validate with benchmarks, and continuously adjust based on monitoring.

