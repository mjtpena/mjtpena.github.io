---
title: "HNSW Tuning for Azure AI Search: A Practical Guide"
author: Michael John Peña
draft: false
date: 2024-07-30
tags:
  - Azure
  - Vector Search
  - HNSW
  - Performance
  - Tuning

---

I wrote "HNSW Tuning for Azure AI Search: A Practical Guide" to share practical, production-minded guidance on this topic.

## HNSW Fundamentals

HNSW builds a multi-layer graph where:
- **Higher layers**: Sparse, for fast long-range navigation
- **Lower layers**: Dense, for precise local search
- **Layer 0**: Contains all vectors

```
Layer 2:    A ─────────────────── B
            │
Layer 1:    A ─── C ─── D ─── B ─── E
            │     │     │     │     │
Layer 0:    A-F-C-G-D-H-B-I-E-J-K-L-M
```

## Key Parameters Explained

### M (Max Connections)

Controls how many edges each node has:

```python
from azure.search.documents.indexes.models import HnswAlgorithmConfiguration

# Low M: Smaller index, faster indexing, lower recall
low_m_config = HnswAlgorithmConfiguration(
    name="low-m",
    parameters={"m": 4, "efConstruction": 400, "efSearch": 500}
)
# Index size: ~4 edges per node
# Best for: Cost-sensitive, large indices

# Medium M: Balanced
medium_m_config = HnswAlgorithmConfiguration(
    name="medium-m",
    parameters={"m": 8, "efConstruction": 400, "efSearch": 500}
)
# Index size: ~8 edges per node
# Best for: Most production workloads

# High M: Better recall, larger index
high_m_config = HnswAlgorithmConfiguration(
    name="high-m",
    parameters={"m": 16, "efConstruction": 400, "efSearch": 500}
)
# Index size: ~16 edges per node
# Best for: High-precision requirements
```

### efConstruction (Build-Time Effort)

How hard the algorithm tries to find good connections during indexing:

```python
# Lower efConstruction: Faster indexing, potentially lower quality
fast_build = HnswAlgorithmConfiguration(
    name="fast-build",
    parameters={"m": 4, "efConstruction": 200, "efSearch": 500}
)
# Build time: Fastest
# Quality: Lower

# Standard efConstruction
standard_build = HnswAlgorithmConfiguration(
    name="standard-build",
    parameters={"m": 4, "efConstruction": 400, "efSearch": 500}
)
# Build time: Moderate
# Quality: Good

# High efConstruction: Slower indexing, better graph quality
quality_build = HnswAlgorithmConfiguration(
    name="quality-build",
    parameters={"m": 4, "efConstruction": 800, "efSearch": 500}
)
# Build time: 2-3x slower
# Quality: Best
```

### efSearch (Search-Time Effort)

How many candidates to consider during search:

```python
# Fast search: Lower recall
fast_search = HnswAlgorithmConfiguration(
    name="fast-search",
    parameters={"m": 4, "efConstruction": 400, "efSearch": 100}
)
# Latency: ~2ms
# Recall@10: ~85%

# Balanced search
balanced_search = HnswAlgorithmConfiguration(
    name="balanced-search",
    parameters={"m": 4, "efConstruction": 400, "efSearch": 500}
)
# Latency: ~5ms
# Recall@10: ~95%

# High recall search
high_recall_search = HnswAlgorithmConfiguration(
    name="high-recall-search",
    parameters={"m": 4, "efConstruction": 400, "efSearch": 1000}
)
# Latency: ~10ms
# Recall@10: ~99%
```

## Tuning Methodology

### Step 1: Establish Baseline

```python
def benchmark_configuration(
    client,
    config_name: str,
    queries: list,
    ground_truth: list,
    k: int = 10
) -> dict:
    """Benchmark a specific configuration."""
    import time

    latencies = []
    recalls = []

    for query, truth in zip(queries, ground_truth):
        start = time.perf_counter()
        results = list(client.search(
            search_text=None,
            vector_queries=[VectorizedQuery(
                vector=query,
                k_nearest_neighbors=k,
                fields="embedding"
            )],
            top=k
        ))
        elapsed = (time.perf_counter() - start) * 1000

        latencies.append(elapsed)

        result_ids = set(r["id"] for r in results)
        truth_ids = set(truth[:k])
        recalls.append(len(result_ids & truth_ids) / k)

    return {
        "config": config_name,
        "mean_latency_ms": np.mean(latencies),
        "p95_latency_ms": np.percentile(latencies, 95),
        "p99_latency_ms": np.percentile(latencies, 99),
        "mean_recall": np.mean(recalls),
        "min_recall": np.min(recalls)
    }
```

### Step 2: Grid Search

```python
def grid_search_hnsw(
    create_index_func,
    benchmark_func,
    queries,
    ground_truth
):
    """Grid search over HNSW parameters."""
    results = []

    m_values = [4, 8, 12, 16]
    ef_construction_values = [200, 400, 600, 800]
    ef_search_values = [100, 300, 500, 800, 1000]

    for m in m_values:
        for ef_construction in ef_construction_values:
            # Create index with these build parameters
            config_name = f"m{m}_efc{ef_construction}"
            create_index_func(m=m, ef_construction=ef_construction)

            for ef_search in ef_search_values:
                # Benchmark at different search parameters
                benchmark = benchmark_func(
                    config_name=f"{config_name}_efs{ef_search}",
                    queries=queries,
                    ground_truth=ground_truth,
                    ef_search=ef_search
                )
                results.append(benchmark)

    return pd.DataFrame(results)
```

### Step 3: Find Pareto Optimal

```python
def find_pareto_optimal(results_df, latency_col="p95_latency_ms", recall_col="mean_recall"):
    """Find configurations on the Pareto frontier."""
    pareto = []

    for i, row in results_df.iterrows():
        is_dominated = False
        for j, other in results_df.iterrows():
            if i == j:
                continue
            # Check if 'other' dominates 'row'
            if (other[latency_col] <= row[latency_col] and
                other[recall_col] >= row[recall_col] and
                (other[latency_col] < row[latency_col] or other[recall_col] > row[recall_col])):
                is_dominated = True
                break

        if not is_dominated:
            pareto.append(row)

    return pd.DataFrame(pareto)
```

## Workload-Specific Configurations

### Real-Time Search (Chatbots, Autocomplete)

```python
realtime_config = HnswAlgorithmConfiguration(
    name="realtime",
    parameters={
        "m": 4,
        "efConstruction": 400,
        "efSearch": 200,  # Lower for speed
        "metric": "cosine"
    }
)
# Target: <5ms p95 latency
# Acceptable recall: >90%
```

### Batch Processing (Document Retrieval)

```python
batch_config = HnswAlgorithmConfiguration(
    name="batch",
    parameters={
        "m": 8,
        "efConstruction": 600,
        "efSearch": 800,  # Higher for recall
        "metric": "cosine"
    }
)
# Target: >98% recall
# Acceptable latency: <50ms
```

### High-Stakes Search (Legal, Medical)

```python
high_stakes_config = HnswAlgorithmConfiguration(
    name="high-stakes",
    parameters={
        "m": 16,
        "efConstruction": 800,
        "efSearch": 1000,  # Maximum recall
        "metric": "cosine"
    }
)
# Target: >99% recall
# Latency: Secondary concern
```

## Dynamic efSearch

Adjust efSearch per query based on requirements:

```python
class AdaptiveSearchClient:
    def __init__(self, base_client):
        self.client = base_client

    def search(
        self,
        query_embedding: list[float],
        k: int = 10,
        accuracy_level: str = "balanced"
    ):
        """Search with accuracy-appropriate efSearch."""

        # Map accuracy level to oversampling
        oversampling_map = {
            "fast": 1.0,       # efSearch ≈ k
            "balanced": 5.0,   # efSearch ≈ 5k
            "accurate": 10.0,  # efSearch ≈ 10k
            "exact": 20.0      # efSearch ≈ 20k
        }

        oversampling = oversampling_map.get(accuracy_level, 5.0)

        vector_query = VectorizedQuery(
            vector=query_embedding,
            k_nearest_neighbors=k,
            fields="embedding",
            oversampling=oversampling  # Effectively increases efSearch
        )

        return list(self.client.search(
            search_text=None,
            vector_queries=[vector_query],
            top=k
        ))
```

## Monitoring HNSW Performance

```python
class HNSWMonitor:
    def __init__(self):
        self.metrics = []

    def record_search(
        self,
        latency_ms: float,
        result_count: int,
        ef_search: int,
        k: int
    ):
        self.metrics.append({
            "timestamp": datetime.utcnow(),
            "latency_ms": latency_ms,
            "result_count": result_count,
            "ef_search": ef_search,
            "k": k
        })

    def get_daily_stats(self) -> dict:
        today = datetime.utcnow().date()
        today_metrics = [
            m for m in self.metrics
            if m["timestamp"].date() == today
        ]

        if not today_metrics:
            return {}

        latencies = [m["latency_ms"] for m in today_metrics]

        return {
            "queries": len(today_metrics),
            "mean_latency": np.mean(latencies),
            "p50_latency": np.percentile(latencies, 50),
            "p95_latency": np.percentile(latencies, 95),
            "p99_latency": np.percentile(latencies, 99),
            "max_latency": max(latencies)
        }

    def alert_on_degradation(self, threshold_p95: float = 20.0):
        """Alert if p95 latency exceeds threshold."""
        stats = self.get_daily_stats()
        if stats.get("p95_latency", 0) > threshold_p95:
            print(f"ALERT: p95 latency {stats['p95_latency']:.1f}ms exceeds {threshold_p95}ms")
            return True
        return False
```

## Index Size Estimation

```python
def estimate_index_size(
    num_vectors: int,
    dimensions: int,
    m: int,
    dtype_bytes: int = 4  # float32
) -> dict:
    """Estimate HNSW index size."""

    # Vector storage
    vector_bytes = num_vectors * dimensions * dtype_bytes

    # Graph storage (edges)
    # Each vector has ~M*2 edges on average (bidirectional)
    # Each edge is a 4-byte integer (neighbor ID)
    edges_per_vector = m * 2
    graph_bytes = num_vectors * edges_per_vector * 4

    # Overhead (metadata, etc.) ~10%
    overhead_bytes = (vector_bytes + graph_bytes) * 0.1

    total_bytes = vector_bytes + graph_bytes + overhead_bytes

    return {
        "vector_storage_gb": vector_bytes / 1e9,
        "graph_storage_gb": graph_bytes / 1e9,
        "overhead_gb": overhead_bytes / 1e9,
        "total_gb": total_bytes / 1e9,
        "bytes_per_vector": total_bytes / num_vectors
    }

# Example
size = estimate_index_size(
    num_vectors=10_000_000,
    dimensions=1536,
    m=8
)
print(f"Estimated index size: {size['total_gb']:.1f} GB")
```

## Best Practices

1. **Start with defaults**: m=4, efConstruction=400, efSearch=500
2. **Measure on real queries**: Synthetic benchmarks can mislead
3. **Consider the build/search trade-off**: Higher efConstruction = better graph = better search
4. **Use oversampling for per-query tuning**: Don't rebuild for different accuracy needs
5. **Monitor in production**: Performance can change with data distribution

## Conclusion

HNSW tuning is about finding the right balance for your specific workload. Start with balanced settings, measure recall and latency on representative queries, and adjust based on your priorities.

The best configuration is workload-specific - there's no universal "best" setting. Invest time in benchmarking with your actual data.

