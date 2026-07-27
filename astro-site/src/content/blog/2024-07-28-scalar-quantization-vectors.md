---
title: "Scalar Quantization for Vector Search: A Practical Guide"
author: Michael John Peña
draft: false
date: 2024-07-28
tags:
  - Azure
  - Vector Search
  - Quantization
  - Performance
  - Optimization

---

I wrote "Scalar Quantization for Vector Search: A Practical Guide" to share practical, production-minded guidance on this topic.

## How Scalar Quantization Works

Scalar quantization maps floating-point values to integers by dividing the value range into buckets:

```
Float32 range: [-1.0 ... 0.0 ... +1.0]
                  |     |     |
Int8 range:    [-128 ... 0 ... +127]
```

```python
import numpy as np
from dataclasses import dataclass

@dataclass
class QuantizationParams:
    scale: float
    zero_point: float
    min_val: float
    max_val: float

def calculate_quantization_params(vectors: np.ndarray) -> QuantizationParams:
    """Calculate optimal quantization parameters from data."""
    min_val = vectors.min()
    max_val = vectors.max()

    # For int8 (-128 to 127)
    qmin, qmax = -128, 127

    scale = (max_val - min_val) / (qmax - qmin)
    zero_point = qmin - min_val / scale

    return QuantizationParams(
        scale=scale,
        zero_point=zero_point,
        min_val=min_val,
        max_val=max_val
    )

def quantize_vector(vector: np.ndarray, params: QuantizationParams) -> np.ndarray:
    """Quantize float vector to int8."""
    quantized = np.round(vector / params.scale + params.zero_point)
    return np.clip(quantized, -128, 127).astype(np.int8)

def dequantize_vector(quantized: np.ndarray, params: QuantizationParams) -> np.ndarray:
    """Dequantize int8 back to float."""
    return (quantized.astype(np.float32) - params.zero_point) * params.scale
```

## Quantization Error Analysis

Understanding quantization error helps set expectations:

```python
def analyze_quantization_error(
    original: np.ndarray,
    reconstructed: np.ndarray
) -> dict:
    """Analyze error introduced by quantization."""
    error = original - reconstructed

    return {
        "mse": float(np.mean(error ** 2)),
        "mae": float(np.mean(np.abs(error))),
        "max_error": float(np.max(np.abs(error))),
        "snr_db": float(10 * np.log10(np.mean(original ** 2) / np.mean(error ** 2))),
        "correlation": float(np.corrcoef(original.flatten(), reconstructed.flatten())[0, 1])
    }

# Example with real embeddings
original_vectors = np.random.randn(1000, 1536).astype(np.float32)
original_vectors = original_vectors / np.linalg.norm(original_vectors, axis=1, keepdims=True)  # Normalize

params = calculate_quantization_params(original_vectors)
quantized = np.array([quantize_vector(v, params) for v in original_vectors])
reconstructed = np.array([dequantize_vector(q, params) for q in quantized])

for i in range(3):
    error = analyze_quantization_error(original_vectors[i], reconstructed[i])
    print(f"Vector {i}: MSE={error['mse']:.6f}, Correlation={error['correlation']:.4f}")
```

## Azure AI Search Implementation

```python
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex, SearchField, SearchFieldDataType,
    VectorSearch, HnswAlgorithmConfiguration, VectorSearchProfile,
    ScalarQuantizationCompression, ScalarQuantizationParameters
)
from azure.core.credentials import AzureKeyCredential

def create_quantized_index(endpoint: str, key: str, index_name: str):
    """Create an index with scalar quantization."""

    client = SearchIndexClient(endpoint, AzureKeyCredential(key))

    index = SearchIndex(
        name=index_name,
        fields=[
            SearchField(
                name="id",
                type=SearchFieldDataType.String,
                key=True
            ),
            SearchField(
                name="title",
                type=SearchFieldDataType.String,
                searchable=True
            ),
            SearchField(
                name="content",
                type=SearchFieldDataType.String,
                searchable=True
            ),
            SearchField(
                name="embedding",
                type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
                vector_search_dimensions=1536,
                vector_search_profile_name="quantized-profile"
            ),
            # Store original for rescoring (optional)
            SearchField(
                name="embedding_full",
                type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
                vector_search_dimensions=1536,
                vector_search_profile_name="full-profile",
                stored=True,
                hidden=True  # Don't return in search results
            )
        ],
        vector_search=VectorSearch(
            algorithms=[
                HnswAlgorithmConfiguration(
                    name="hnsw",
                    parameters={
                        "m": 4,
                        "efConstruction": 400,
                        "efSearch": 500,
                        "metric": "cosine"
                    }
                )
            ],
            profiles=[
                VectorSearchProfile(
                    name="quantized-profile",
                    algorithm_configuration_name="hnsw",
                    compression_configuration_name="scalar-compression"
                ),
                VectorSearchProfile(
                    name="full-profile",
                    algorithm_configuration_name="hnsw"
                )
            ],
            compressions=[
                ScalarQuantizationCompression(
                    compression_name="scalar-compression",
                    parameters=ScalarQuantizationParameters(
                        quantized_data_type="int8"
                    ),
                    rescoring_enabled=True,
                    default_oversampling=10.0
                )
            ]
        )
    )

    client.create_or_update_index(index)
    return index
```

## Search with Quantization

```python
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery

def search_with_quantization(
    client: SearchClient,
    query_embedding: list[float],
    top_k: int = 10,
    oversampling: float = None
) -> list[dict]:
    """Search using quantized vectors with optional rescoring."""

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=top_k,
        fields="embedding"
    )

    # Oversampling can be specified per-query
    if oversampling:
        vector_query.oversampling = oversampling

    results = client.search(
        search_text=None,
        vector_queries=[vector_query],
        select=["id", "title", "content"],
        top=top_k
    )

    return [
        {
            "id": r["id"],
            "title": r["title"],
            "content": r["content"][:200],
            "score": r["@search.score"]
        }
        for r in results
    ]
```

## Recall Optimization Techniques

### Oversampling Strategy

```python
def adaptive_oversampling(
    query_embedding: list[float],
    base_oversampling: float = 5.0,
    query_type: str = "default"
) -> float:
    """Determine oversampling factor based on query characteristics."""

    # High precision queries need more oversampling
    if query_type == "exact_match":
        return base_oversampling * 2

    # Exploratory queries can use less
    if query_type == "exploration":
        return base_oversampling * 0.5

    # For normalized embeddings, check magnitude
    magnitude = np.linalg.norm(query_embedding)
    if magnitude < 0.8:  # Unusual query
        return base_oversampling * 1.5

    return base_oversampling
```

### Hybrid Quantization

Use both quantized and full vectors strategically:

```python
class HybridQuantizedSearch:
    def __init__(self, client: SearchClient):
        self.client = client

    def search(
        self,
        query_embedding: list[float],
        top_k: int = 10,
        accuracy_mode: str = "balanced"
    ) -> list[dict]:
        """Search with configurable accuracy/speed trade-off."""

        if accuracy_mode == "fast":
            # Use only quantized vectors
            return self._search_quantized(query_embedding, top_k, oversampling=3.0)

        elif accuracy_mode == "accurate":
            # Use quantized for candidate generation, rescore with full
            candidates = self._search_quantized(query_embedding, top_k * 10, oversampling=10.0)
            return self._rescore_with_full(query_embedding, candidates, top_k)

        else:  # balanced
            # Use quantized with moderate oversampling and rescoring
            return self._search_quantized(query_embedding, top_k, oversampling=5.0)

    def _search_quantized(
        self,
        query_embedding: list[float],
        top_k: int,
        oversampling: float
    ) -> list[dict]:
        vector_query = VectorizedQuery(
            vector=query_embedding,
            k_nearest_neighbors=top_k,
            fields="embedding",
            oversampling=oversampling
        )

        results = self.client.search(
            search_text=None,
            vector_queries=[vector_query],
            top=top_k
        )

        return list(results)

    def _rescore_with_full(
        self,
        query_embedding: list[float],
        candidates: list[dict],
        top_k: int
    ) -> list[dict]:
        """Rescore candidates using full precision embeddings."""
        query_arr = np.array(query_embedding)

        rescored = []
        for candidate in candidates:
            # Fetch full embedding
            doc = self.client.get_document(candidate["id"])
            full_embedding = np.array(doc.get("embedding_full", []))

            if len(full_embedding) > 0:
                similarity = np.dot(query_arr, full_embedding) / (
                    np.linalg.norm(query_arr) * np.linalg.norm(full_embedding)
                )
                rescored.append({
                    **candidate,
                    "rescore": float(similarity)
                })

        rescored.sort(key=lambda x: x["rescore"], reverse=True)
        return rescored[:top_k]
```

## Monitoring and Evaluation

```python
class QuantizationMonitor:
    def __init__(self):
        self.metrics = []

    def evaluate_search(
        self,
        query: str,
        query_embedding: list[float],
        quantized_results: list[dict],
        full_results: list[dict],
        k: int = 10
    ):
        """Compare quantized search to full precision search."""
        quantized_ids = set(r["id"] for r in quantized_results[:k])
        full_ids = set(r["id"] for r in full_results[:k])

        recall = len(quantized_ids & full_ids) / k

        # Position-aware metrics
        quantized_ranks = {r["id"]: i for i, r in enumerate(quantized_results[:k])}
        full_ranks = {r["id"]: i for i, r in enumerate(full_results[:k])}

        rank_differences = []
        for doc_id in quantized_ids & full_ids:
            rank_differences.append(abs(quantized_ranks[doc_id] - full_ranks[doc_id]))

        avg_rank_diff = np.mean(rank_differences) if rank_differences else 0

        metric = {
            "query": query,
            "recall_at_k": recall,
            "avg_rank_difference": avg_rank_diff,
            "timestamp": datetime.utcnow().isoformat()
        }

        self.metrics.append(metric)
        return metric

    def get_summary(self) -> dict:
        if not self.metrics:
            return {}

        recalls = [m["recall_at_k"] for m in self.metrics]
        rank_diffs = [m["avg_rank_difference"] for m in self.metrics]

        return {
            "total_queries": len(self.metrics),
            "mean_recall": np.mean(recalls),
            "min_recall": np.min(recalls),
            "mean_rank_difference": np.mean(rank_diffs),
            "queries_below_90_recall": sum(1 for r in recalls if r < 0.9)
        }
```

## Cost-Benefit Analysis

```python
def calculate_savings(
    num_vectors: int,
    dimensions: int,
    current_tier: str
) -> dict:
    """Calculate storage and cost savings from quantization."""

    # Storage per vector
    float32_bytes = dimensions * 4
    int8_bytes = dimensions  # 4x compression

    total_float32 = num_vectors * float32_bytes
    total_int8 = num_vectors * int8_bytes

    # Approximate Azure Search pricing (varies by tier)
    tier_gb_prices = {
        "basic": 0.10,
        "standard": 0.25,
        "standard2": 0.50
    }

    price_per_gb = tier_gb_prices.get(current_tier, 0.25)

    float32_cost = (total_float32 / 1e9) * price_per_gb
    int8_cost = (total_int8 / 1e9) * price_per_gb

    return {
        "original_storage_gb": total_float32 / 1e9,
        "quantized_storage_gb": total_int8 / 1e9,
        "storage_reduction": (total_float32 - total_int8) / total_float32,
        "monthly_savings": float32_cost - int8_cost,
        "vectors": num_vectors
    }

# Example
savings = calculate_savings(
    num_vectors=10_000_000,
    dimensions=1536,
    current_tier="standard"
)

print(f"Storage reduction: {savings['storage_reduction']:.0%}")
print(f"Original: {savings['original_storage_gb']:.1f} GB")
print(f"Quantized: {savings['quantized_storage_gb']:.1f} GB")
```

## Best Practices

1. **Enable rescoring**: Always use rescoring for production workloads
2. **Tune oversampling**: Start with 5-10x, adjust based on recall metrics
3. **Monitor recall**: Track recall@k compared to full precision
4. **Consider hybrid**: Use full precision for top results if needed
5. **Test with your data**: Quantization impact varies by embedding type

## Conclusion

Scalar quantization provides an excellent balance of compression and accuracy for most vector search applications. With proper configuration and rescoring, you can achieve 4x storage reduction with minimal impact on search quality.

Enable it in Azure AI Search, monitor your recall metrics, and enjoy the cost savings.

