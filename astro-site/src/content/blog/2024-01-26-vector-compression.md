---
title: "Vector Compression in Azure AI Search: Reducing Costs Without Sacrificing Quality"
description: "Vector compression reduced storage costs dramatically in a production index I worked on. Here are the practical trade-offs and configuration tips I used to…"
author: Michael John Peña
draft: false
date: 2024-01-26
tags:
  - Vector Search
  - Compression
  - Azure AI Search
  - Cost Optimization
  - Performance
---

Vector compression reduced storage costs dramatically in a production index I worked on. Here are the practical trade-offs and configuration tips I used to balance cost and recall.

## Understanding Vector Compression

```
Original Vector (1536 dimensions, float32)
→ 1536 × 4 bytes = 6,144 bytes per vector

Compressed Vector (scalar quantization, int8)
→ 1536 × 1 byte = 1,536 bytes per vector

Savings: 75% reduction in storage
```

## Configuration

```python
from azure.search.documents.indexes.models import (
    VectorSearch, VectorSearchProfile, HnswAlgorithmConfiguration,
    ScalarQuantizationCompression, VectorSearchCompression
)

vector_search = VectorSearch(
    algorithms=[
        HnswAlgorithmConfiguration(
            name="hnsw-config",
            parameters={
                "m": 4,
                "efConstruction": 400,
                "efSearch": 500
            }
        )
    ],
    compressions=[
        ScalarQuantizationCompression(
            name="scalar-quantization",
            rerank_with_original_vectors=True,
            default_oversampling=10.0,
            parameters={
                "quantized_data_type": "int8"
            }
        )
    ],
    profiles=[
        VectorSearchProfile(
            name="compressed-profile",
            algorithm_configuration_name="hnsw-config",
            compression_configuration_name="scalar-quantization"
        )
    ]
)
```

## Key Parameters

### Oversampling

```python
# Oversampling retrieves more candidates to compensate for compression loss
oversampling_configs = {
    "minimal": 2.0,    # Faster, lower quality
    "balanced": 10.0,  # Good balance (default)
    "quality": 20.0    # Higher quality, slower
}
```

### Reranking

```python
# Rerank with original vectors for better accuracy
compression = ScalarQuantizationCompression(
    name="high-quality-compression",
    rerank_with_original_vectors=True,  # Recommended
    default_oversampling=10.0
)
```

## Query with Compression

```python
from azure.search.documents.models import VectorizedQuery

def search_compressed_index(query_vector: list, oversampling: float = None):
    """Search a compressed vector index."""

    vector_query = VectorizedQuery(
        vector=query_vector,
        k_nearest_neighbors=10,
        fields="content_vector"
    )

    # Override oversampling if needed
    if oversampling:
        vector_query.oversampling = oversampling

    return search_client.search(
        vector_queries=[vector_query],
        top=10
    )
```

## Quality vs Cost Tradeoffs

```python
def compare_compression_quality(test_queries: list, ground_truth: dict):
    """Compare compressed vs uncompressed search quality."""

    results = {
        "uncompressed": [],
        "compressed_no_rerank": [],
        "compressed_with_rerank": []
    }

    for query in test_queries:
        expected = ground_truth[query["id"]]

        # Test each configuration
        for config_name, search_func in [
            ("uncompressed", search_uncompressed),
            ("compressed_no_rerank", search_compressed_no_rerank),
            ("compressed_with_rerank", search_compressed_with_rerank)
        ]:
            result_ids = search_func(query["vector"])
            recall = len(set(result_ids) & set(expected)) / len(expected)
            results[config_name].append(recall)

    return {
        name: sum(recalls) / len(recalls)
        for name, recalls in results.items()
    }

# Typical results:
# uncompressed: 0.95
# compressed_no_rerank: 0.85
# compressed_with_rerank: 0.93
```

## Cost Savings Calculator

```python
def calculate_savings(
    document_count: int,
    vector_dimensions: int,
    use_compression: bool
):
    """Calculate storage cost savings from compression."""

    bytes_per_float32 = 4
    bytes_per_int8 = 1

    if use_compression:
        vector_size = vector_dimensions * bytes_per_int8
        # Add overhead for original vectors (used in reranking)
        total_size = vector_size + (vector_dimensions * bytes_per_float32 * 0.1)
    else:
        total_size = vector_dimensions * bytes_per_float32

    total_storage_gb = (document_count * total_size) / (1024**3)

    # Azure AI Search pricing (approximate)
    cost_per_gb_month = 0.25  # Standard tier

    monthly_cost = total_storage_gb * cost_per_gb_month

    return {
        "storage_gb": total_storage_gb,
        "monthly_cost": monthly_cost
    }

# Example: 10M documents, 1536 dimensions
uncompressed = calculate_savings(10_000_000, 1536, False)
compressed = calculate_savings(10_000_000, 1536, True)

print(f"Uncompressed: {uncompressed['storage_gb']:.1f} GB, ${uncompressed['monthly_cost']:.2f}/month")
print(f"Compressed: {compressed['storage_gb']:.1f} GB, ${compressed['monthly_cost']:.2f}/month")
print(f"Savings: ${uncompressed['monthly_cost'] - compressed['monthly_cost']:.2f}/month")
```

## Best Practices

1. **Always enable reranking** - Minimal cost for significant quality improvement
2. **Start with default oversampling** - Adjust based on quality metrics
3. **Test before deploying** - Measure recall against your data
4. **Monitor latency** - Reranking adds some overhead
5. **Consider hybrid search** - Keyword matching compensates for compression loss

## Conclusion

Vector compression is a no-brainer for large-scale deployments. With reranking enabled, you get 75% storage savings with minimal quality impact. Enable it by default and adjust oversampling if needed.
