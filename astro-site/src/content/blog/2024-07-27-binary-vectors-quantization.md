---
title: "Binary Vectors and Quantization in Azure AI Search"
description: "With quantization, this can be reduced to 1-2 GB."
author: Michael John Peña
draft: false
date: 2024-07-27
tags:
  - Azure
  - Vector Search
  - Quantization
  - Binary Vectors
  - Performance
---

## The Storage Challenge

Consider a typical RAG application:
- 1 million documents
- 1536-dimension embeddings (OpenAI ada-002)
- Float32 storage

**Storage calculation:**
- 1,000,000 x 1,536 x 4 bytes = 6.14 GB just for vectors
- Add HNSW graph overhead: ~12-15 GB total

With quantization, this can be reduced to 1-2 GB.

## Binary Quantization

Binary quantization converts each dimension to a single bit:

```python
import numpy as np

def binary_quantize(vector: list[float]) -> bytes:
    """Convert float vector to binary representation."""
    arr = np.array(vector)

    # Threshold at mean (or 0 for normalized vectors)
    threshold = 0  # For normalized embeddings
    binary = (arr > threshold).astype(np.uint8)

    # Pack bits into bytes
    packed = np.packbits(binary)
    return packed.tobytes()

def hamming_distance(binary1: bytes, binary2: bytes) -> int:
    """Calculate Hamming distance between binary vectors."""
    b1 = np.frombuffer(binary1, dtype=np.uint8)
    b2 = np.frombuffer(binary2, dtype=np.uint8)

    # XOR and count bits
    xor_result = np.bitwise_xor(b1, b2)
    return sum(bin(byte).count('1') for byte in xor_result)

# Example
original_vector = [0.1, -0.2, 0.3, -0.4, 0.5, -0.6, 0.7, -0.8]  # 8 dimensions
binary = binary_quantize(original_vector)

print(f"Original size: {len(original_vector) * 4} bytes")  # 32 bytes
print(f"Binary size: {len(binary)} bytes")  # 1 byte
print(f"Compression: {len(original_vector) * 4 / len(binary)}x")  # 32x
```

## Scalar Quantization

Scalar quantization compresses each dimension to fewer bits:

```python
def scalar_quantize_int8(vector: list[float]) -> tuple[bytes, float, float]:
    """Quantize float vector to int8."""
    arr = np.array(vector)

    # Calculate scale and offset
    min_val = arr.min()
    max_val = arr.max()
    scale = (max_val - min_val) / 255  # Map to 0-255

    # Quantize
    quantized = ((arr - min_val) / scale).astype(np.uint8)

    return quantized.tobytes(), scale, min_val

def scalar_dequantize_int8(quantized: bytes, scale: float, min_val: float) -> np.ndarray:
    """Dequantize int8 back to float."""
    arr = np.frombuffer(quantized, dtype=np.uint8)
    return arr.astype(np.float32) * scale + min_val

# Example
original = np.random.randn(1536).astype(np.float32)
quantized, scale, min_val = scalar_quantize_int8(original.tolist())
reconstructed = scalar_dequantize_int8(quantized, scale, min_val)

# Measure error
mse = np.mean((original - reconstructed) ** 2)
print(f"Original size: {original.nbytes} bytes")  # 6144 bytes
print(f"Quantized size: {len(quantized)} bytes")  # 1536 bytes
print(f"Compression: 4x")
print(f"Mean squared error: {mse:.6f}")
```

## Product Quantization

Product quantization divides the vector into subspaces and quantizes each independently:

```python
from sklearn.cluster import KMeans
import pickle

class ProductQuantizer:
    def __init__(self, n_subvectors: int = 8, n_clusters: int = 256):
        self.n_subvectors = n_subvectors
        self.n_clusters = n_clusters
        self.codebooks = []

    def fit(self, vectors: np.ndarray):
        """Train codebooks on vector set."""
        n_samples, dim = vectors.shape
        subvector_dim = dim // self.n_subvectors

        self.codebooks = []

        for i in range(self.n_subvectors):
            start = i * subvector_dim
            end = start + subvector_dim
            subvectors = vectors[:, start:end]

            kmeans = KMeans(n_clusters=self.n_clusters, n_init=10)
            kmeans.fit(subvectors)
            self.codebooks.append(kmeans)

    def encode(self, vector: np.ndarray) -> np.ndarray:
        """Encode vector to cluster indices."""
        subvector_dim = len(vector) // self.n_subvectors
        codes = np.zeros(self.n_subvectors, dtype=np.uint8)

        for i, codebook in enumerate(self.codebooks):
            start = i * subvector_dim
            end = start + subvector_dim
            subvector = vector[start:end].reshape(1, -1)
            codes[i] = codebook.predict(subvector)[0]

        return codes

    def decode(self, codes: np.ndarray) -> np.ndarray:
        """Decode cluster indices back to approximate vector."""
        reconstructed = []

        for i, code in enumerate(codes):
            centroid = self.codebooks[i].cluster_centers_[code]
            reconstructed.extend(centroid)

        return np.array(reconstructed)

    def compute_distances(self, query: np.ndarray, codes_batch: np.ndarray) -> np.ndarray:
        """Efficiently compute distances using lookup tables."""
        subvector_dim = len(query) // self.n_subvectors

        # Precompute distances from query subvectors to all centroids
        distance_tables = np.zeros((self.n_subvectors, self.n_clusters))

        for i, codebook in enumerate(self.codebooks):
            start = i * subvector_dim
            end = start + subvector_dim
            query_sub = query[start:end]

            for j, centroid in enumerate(codebook.cluster_centers_):
                distance_tables[i, j] = np.sum((query_sub - centroid) ** 2)

        # Sum up distances using lookup
        distances = np.zeros(len(codes_batch))
        for idx, codes in enumerate(codes_batch):
            for i, code in enumerate(codes):
                distances[idx] += distance_tables[i, code]

        return distances

# Usage
pq = ProductQuantizer(n_subvectors=8, n_clusters=256)

# Train on corpus
training_vectors = np.random.randn(10000, 1536).astype(np.float32)
pq.fit(training_vectors)

# Encode
original = np.random.randn(1536).astype(np.float32)
codes = pq.encode(original)

print(f"Original size: {original.nbytes} bytes")  # 6144 bytes
print(f"PQ codes size: {codes.nbytes} bytes")  # 8 bytes
print(f"Compression: {original.nbytes / codes.nbytes}x")  # 768x
```

## Azure AI Search Quantization Support

Azure AI Search supports scalar quantization in preview:

```python
from azure.search.documents.indexes.models import (
    SearchIndex, SearchField, SearchFieldDataType,
    VectorSearch, HnswAlgorithmConfiguration,
    VectorSearchProfile, ScalarQuantizationCompression
)

index = SearchIndex(
    name="quantized-index",
    fields=[
        SearchField(name="id", type=SearchFieldDataType.String, key=True),
        SearchField(name="content", type=SearchFieldDataType.String),
        SearchField(
            name="embedding",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            vector_search_dimensions=1536,
            vector_search_profile_name="quantized-profile"
        )
    ],
    vector_search=VectorSearch(
        algorithms=[
            HnswAlgorithmConfiguration(name="hnsw")
        ],
        profiles=[
            VectorSearchProfile(
                name="quantized-profile",
                algorithm_configuration_name="hnsw",
                compression_configuration_name="scalar-compression"
            )
        ],
        compressions=[
            ScalarQuantizationCompression(
                compression_name="scalar-compression",
                rescoring_enabled=True,  # Rescore with original vectors
                default_oversampling=10.0  # Oversample for better recall
            )
        ]
    )
)
```

## Two-Stage Search with Quantization

Use quantized vectors for first-stage retrieval, then rescore with full vectors:

```python
class TwoStageSearch:
    def __init__(self, client, full_vectors_store):
        self.client = client
        self.full_vectors = full_vectors_store

    def search(self, query_embedding: list[float], top_k: int = 10) -> list[dict]:
        # Stage 1: Fast search with quantized vectors
        # Over-retrieve to compensate for quantization error
        oversample_factor = 5

        vector_query = VectorizedQuery(
            vector=query_embedding,
            k_nearest_neighbors=top_k * oversample_factor,
            fields="embedding"
        )

        candidates = list(self.client.search(
            search_text=None,
            vector_queries=[vector_query],
            select=["id", "content"]
        ))

        # Stage 2: Rescore with full precision vectors
        candidate_ids = [c["id"] for c in candidates]
        full_embeddings = self.full_vectors.get_many(candidate_ids)

        query_arr = np.array(query_embedding)
        rescored = []

        for candidate in candidates:
            doc_id = candidate["id"]
            if doc_id in full_embeddings:
                doc_embedding = np.array(full_embeddings[doc_id])
                # Cosine similarity
                similarity = np.dot(query_arr, doc_embedding) / (
                    np.linalg.norm(query_arr) * np.linalg.norm(doc_embedding)
                )
                rescored.append({
                    **candidate,
                    "rescore": float(similarity)
                })

        # Sort by rescored similarity
        rescored.sort(key=lambda x: x["rescore"], reverse=True)

        return rescored[:top_k]
```

## Choosing the Right Quantization

| Method | Compression | Recall Impact | Best For |
|--------|-------------|---------------|----------|
| Binary | 32x | 5-15% drop | Very large scale, fast filtering |
| Int8 Scalar | 4x | 1-3% drop | General purpose, good balance |
| Product | 96-768x | 3-8% drop | Extreme scale, memory constrained |

## Monitoring Quantization Quality

```python
def evaluate_quantization(
    original_vectors: np.ndarray,
    quantized_search_func,
    sample_queries: int = 100,
    k: int = 10
) -> dict:
    """Evaluate recall impact of quantization."""

    recalls = []

    for i in range(sample_queries):
        query = original_vectors[i]

        # Ground truth: exact search
        distances = np.linalg.norm(original_vectors - query, axis=1)
        true_neighbors = set(np.argsort(distances)[1:k+1])  # Exclude self

        # Quantized search
        quantized_neighbors = set(quantized_search_func(query, k))

        # Calculate recall
        recall = len(true_neighbors & quantized_neighbors) / k
        recalls.append(recall)

    return {
        "mean_recall": np.mean(recalls),
        "min_recall": np.min(recalls),
        "std_recall": np.std(recalls)
    }
```

## Best Practices

1. **Start with scalar quantization**: Best balance of compression and accuracy
2. **Enable rescoring**: Two-stage search recovers most accuracy loss
3. **Oversample appropriately**: 3-10x depending on accuracy requirements
4. **Test on your data**: Quantization impact varies by domain
5. **Monitor recall metrics**: Track degradation over time

## Conclusion

Quantization is essential for scaling vector search. Binary and scalar quantization in Azure AI Search enable significantly larger indices without proportional cost increases.

Start with scalar quantization with rescoring enabled. This provides 4x compression with minimal recall impact for most applications.
